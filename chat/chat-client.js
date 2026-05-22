/**
 * Chat client — orchestrates a turn against the in-browser WebLLM
 * engine. Drives the tool-call loop:
 *
 *   1. Send messages + tool defs to the engine.
 *   2. Stream the assistant's response into the UI.
 *   3. If the model emitted tool_calls, execute them, append the results
 *      to the message history, and loop. Stop after MAX_TOOL_ITERATIONS
 *      so a misbehaving model can't run forever.
 *
 * No remote LLM — the whole conversation happens on the visitor's GPU.
 * The page gates entry on WebGPU support and only loads this module
 * once the engine has been initialized.
 */

import { webllmChat } from './webllm-adapter.js';

// Dev hot-reload: app.js can re-import this module with a `?t=…` cache-bust
// to pick up code changes without a page reload (which would drop the
// WebLLM engine and force a multi-second re-init from OPFS). We forward
// our own query string into our dynamic imports so tools.js and
// system-prompt.js get refreshed in lock-step. webllm-adapter is
// imported statically with NO cache-bust so the engine stays alive.
const cacheBust = new URL(import.meta.url).search;
const [
  { getToolDefinitions, runTool, getHome },
  { buildSystemPrompt },
  { formatAttachmentForModel }
] = await Promise.all([
  import(`./tools.js${cacheBust}`),
  import(`./system-prompt.js${cacheBust}`),
  import(`./document-loader.js${cacheBust}`)
]);

const MAX_TOOL_ITERATIONS = 4;

/**
 * @typedef {Object} ToolCallEvent
 * @property {'started'|'completed'|'failed'} phase
 * @property {string} id
 * @property {string} name
 * @property {string} [argumentsRaw]
 * @property {string} [resultPreview]
 * @property {string} [error]
 */

/**
 * @typedef {Object} RunTurnOptions
 * @property {Array<object>} history        — message history (mutated by reference).
 * @property {string} userText
 * @property {Array<import('./document-loader.js').Attachment>} [attachments]
 *   Documents dropped/attached by the user. Content is expanded into
 *   the wire-version of the user message but the structured list is
 *   also stamped onto the stored history entry so the UI can render
 *   chips and so storage.js can strip the heavy `content` field
 *   before saving.
 * @property {object} toolCtx               — passed to tool executors.
 * @property {AbortSignal} signal
 * @property {(delta: { content?: string }) => void} [onAssistantDelta]
 * @property {(event: ToolCallEvent) => void} [onToolEvent]
 * @property {() => void} [onAssistantMessageStart]
 * @property {() => void} [onAssistantMessageEnd]
 * @property {() => void} [onAssistantTextRetracted]
 *   Called when the streamed assistant text needs to be discarded — e.g.
 *   the model wrote a tool call in text form and we recovered it into a
 *   real tool call, so the user shouldn't see the pseudo-call leftover.
 */

/**
 * Run one full conversational turn.
 *
 * Returns when the model produces a final assistant message with no
 * tool calls, the abort signal fires, or MAX_TOOL_ITERATIONS is reached.
 *
 * @param {RunTurnOptions} opts
 * @returns {Promise<{ aborted: boolean, iterations: number }>}
 */
export async function runChatTurn(opts) {
  const { history, userText, toolCtx, signal } = opts;
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  // Tests can pass a fake `engine` to bypass WebLLM. Same shape as
  // webllmChat: takes {messages, tools, toolChoice, signal, onDelta},
  // returns {content, toolCalls, finishReason}.
  const engine = typeof opts.engine === 'function' ? opts.engine : webllmChat;

  // Attachments are content for the model to read, not a request for a
  // tool call — "summarize this PDF" should land as plain text. We
  // explicitly suppress action-intent detection when an attachment is
  // present so e.g. "summarize/read/list this" don't force a doomed
  // tool_choice: 'required' against tools that can't analyze the doc.
  const initialHost = typeof toolCtx.host === 'string' ? toolCtx.host : 'chat';
  const intent =
    attachments.length > 0 ? false : detectActionIntent(userText, { host: initialHost });
  console.log('[chat:turn] start', {
    userText,
    actionIntentDetected: intent,
    attachmentCount: attachments.length,
    embedded: !!toolCtx.embed?.isEmbedded,
    host: initialHost
  });

  // Refresh / install the system prompt at the head of history. We
  // rewrite it every turn so "current time", the app catalog, and the
  // active-file content (in code-ide host mode) all stay accurate
  // without having to re-load the conversation. The catalog fetch is
  // cached by toolCtx.appsRegistry, so this is a near-free await on
  // the second turn onward.
  const apps = await safeFetchApps(toolCtx);
  const host = typeof toolCtx.host === 'string' ? toolCtx.host : 'chat';
  const activeFile = typeof toolCtx.activeFile === 'function' ? toolCtx.activeFile() : null;
  // Optional per-host context. Code IDE supplies a `projectTree`
  // snapshot — a tiny ASCII listing of the workspace — so the model
  // picks paths that match the user's actual project instead of
  // guessing. Other hosts can ignore it.
  let projectTree = null;
  if (typeof toolCtx.projectTree === 'function') {
    try {
      const t = await toolCtx.projectTree();
      if (typeof t === 'string') projectTree = t;
    } catch {
      // Tree snapshot is best-effort; fall through with null.
    }
  }
  // Host-specific workspace root. Hosts that aren't rooted at the user's
  // home directory (e.g. Code IDE, where the standalone in-memory fs is
  // rooted at "/" and the OS-embedded view is rooted at the documents
  // dir) hand us a root string so the prompt and the path resolver can
  // both use it. Falls back to getHome() for the chat host.
  const workspaceRoot =
    typeof toolCtx.workspaceRoot === 'function' ? toolCtx.workspaceRoot() : null;
  installSystemPrompt(history, {
    embedded: !!toolCtx.embed?.isEmbedded,
    apps,
    home: getHome(),
    host,
    activeFile,
    projectTree,
    workspaceRoot
  });

  /** @type {Record<string, any>} */
  const userMessage = { role: 'user', content: userText };
  if (attachments.length > 0) {
    // We keep the full content here so the wire-version (built via
    // stripUiOnlyFields) can expand it into the prompt. storage.js
    // strips the `content` field of each attachment before saving so
    // localStorage doesn't fill up with PDF text.
    userMessage.attachments = attachments;
  }
  history.push(userMessage);

  // Hosts can hand us a `toolNames` whitelist (Code IDE drops
  // launchApp/notify/listApps/webFetch — they don't make sense for an
  // editor). When absent, the full chat catalog is exposed.
  const toolNames = Array.isArray(toolCtx.toolNames) ? toolCtx.toolNames : null;
  const tools = getToolDefinitions(toolNames);
  let iterations = 0;
  // Track tool-error retries separately from the normal iteration cap.
  // When a tool returns `{ok: false}` we treat the next iteration as
  // a "second chance" with tool_choice=required so the model can't
  // shrug and end the turn with prose. Without this the user's last
  // log will end with "Apologies for the confusion. Here's how you
  // COULD create a file…" — and nothing actually happens.
  let toolErrorRetries = 0;
  const MAX_TOOL_ERROR_RETRIES = 2;
  /** @type {{ name: string, error: string } | null} */
  let pendingErrorRetry = null;

  while (iterations < MAX_TOOL_ITERATIONS) {
    if (signal.aborted) {
      return { aborted: true, iterations };
    }
    iterations += 1;

    opts.onAssistantMessageStart?.();

    /** @type {{ content: string, toolCalls: Array<{id: string, name: string, arguments: string}>, finishReason: string }} */
    let result;
    // Force tool calls on the first iteration AND on any iteration
    // immediately after a tool error (up to MAX_TOOL_ERROR_RETRIES).
    // Otherwise normal iterations are 'auto' so the model can
    // summarize a successful tool result without being forced to call
    // another tool.
    const forceToolCall =
      (iterations === 1 && intent) ||
      (pendingErrorRetry !== null && toolErrorRetries < MAX_TOOL_ERROR_RETRIES);
    const toolChoice = forceToolCall ? 'required' : 'auto';

    if (pendingErrorRetry) {
      console.warn('[chat:turn] retrying after tool error', {
        name: pendingErrorRetry.name,
        error: pendingErrorRetry.error.slice(0, 200),
        retryNumber: toolErrorRetries + 1,
        toolChoice
      });
      // Push a system reminder that the model will see in this
      // iteration. Be blunt: include the literal error from the tool
      // and tell the model NOT to apologize, just to retry with a
      // corrected call.
      history.push({
        role: 'system',
        content:
          `Your last \`${pendingErrorRetry.name}\` call FAILED with: "${pendingErrorRetry.error}" ` +
          'Do not apologize. Do not narrate. Do not explain how the user could do it themselves. ' +
          'Immediately re-call the tool through the structured tool_calls channel with the problem fixed. ' +
          'If the error suggested a concrete fix (a specific path, a missing field, an existing file), apply that exact fix in your next call.'
      });
      toolErrorRetries += 1;
      pendingErrorRetry = null;
    }
    // WebLLM doesn't strictly grammar-constrain `tool_choice: 'required'`
    // with Hermes-3 — the model can still produce prose like "I've opened
    // Paint for you." instead of a real tool_call. Belt-and-suspenders:
    // inline a directive onto the wire-version of the last user message
    // (NOT into history) so the model sees a per-turn reminder right
    // next to the action request.
    const baseMessages = stripUiOnlyFields(history);
    const fittedMessages = fitMessagesToContextWindow(baseMessages);
    const messagesToSend = forceToolCall ? withActionDirective(fittedMessages) : fittedMessages;
    console.log(`[chat:turn] iteration ${iterations}`, {
      toolChoice,
      injectedDirective: forceToolCall,
      wireCharCount: estimateMessagesChars(messagesToSend)
    });
    try {
      result = await engine({
        messages: messagesToSend,
        tools,
        toolChoice,
        signal,
        onDelta: (delta) => {
          if (delta.content) {
            opts.onAssistantDelta?.({ content: delta.content });
          }
        }
      });
    } catch (err) {
      if (err && /** @type {Error} */ (err).name === 'AbortError') {
        return { aborted: true, iterations };
      }
      throw err;
    }

    opts.onAssistantMessageEnd?.();

    // Recovery: when the model returned text instead of a structured
    // tool_call despite tool_choice=required, try to extract a tool
    // call out of the text. Hermes-3 + WebLLM occasionally writes
    // things like `Action → tool: - launchApp - appId: "paint"` or
    // `<tool_call>{json}</tool_call>` into the message body when the
    // grammar constraint doesn't bite. We synthesize a tool call from
    // the text so the user's intent still goes through.
    if (forceToolCall && result.toolCalls.length === 0 && result.content) {
      const knownNames = tools.map((t) => /** @type {any} */ (t).function?.name).filter(Boolean);
      let extracted = extractToolCallFromText(result.content, tools);

      // Second-stage rescue: the model didn't even write pseudocode —
      // it just hallucinated "I opened Play Accordion for you" in
      // prose. Look at the USER's text against the apps catalog; if
      // there's a clear match, synthesize a launchApp call from it.
      // (The most common failure mode is action-intent + launchApp,
      // and the user's text usually contains the app name verbatim.)
      if (!extracted && knownNames.includes('launchApp')) {
        const inferred = inferLaunchAppFromText(userText, apps);
        if (inferred) {
          console.warn(
            '[chat:turn] model emitted prose instead of a tool call — synthesizing launchApp from user text',
            { matchedAppId: inferred.id, userText, modelText: result.content.slice(0, 200) }
          );
          extracted = {
            name: 'launchApp',
            arguments: JSON.stringify({ appId: inferred.id })
          };
        }
      }

      if (extracted) {
        console.warn(
          '[chat:turn] model emitted tool call as TEXT — recovering via fallback parser',
          { extracted, originalContent: result.content.slice(0, 300) }
        );
        result.toolCalls = [
          {
            id: `call_synth_${Math.random().toString(36).slice(2, 10)}`,
            name: extracted.name,
            arguments: extracted.arguments
          }
        ];
        // Hide the model's pseudo-tool-call text — the user shouldn't
        // see "Action → tool: - launchApp - appId: paint" in their
        // chat bubble. The tool call card and the next iteration's
        // summary are what they'll see instead.
        if (opts.onAssistantTextRetracted) {
          opts.onAssistantTextRetracted();
        }
        result.content = '';
      }
    }

    // Partial-pseudo-tool-call detection: the model emitted prose that
    // mentions a known tool name in call-like form (e.g.
    // "tool_calls\ncreateFile(\"/HelloWorld.java\")") but extraction
    // either returned null OR rejected it because required params were
    // missing. Without this branch we'd just push the prose into the
    // chat, exit the turn, and the user would stare at "createFile(...)"
    // in their bubble with no diff, no file, no error.
    //
    // Instead: retract the bubble, inject a SYSTEM reminder telling the
    // model exactly what it forgot, and continue the loop so it gets
    // another iteration to emit a real structured call. The reminder
    // lives in the wire-history (so the model sees it) but is also
    // surfaced to the UI via the onToolEvent channel as a "retrying…"
    // breadcrumb so the user knows something is happening.
    if (
      forceToolCall &&
      result.toolCalls.length === 0 &&
      detectPartialToolCallAttempt(result.content, tools)
    ) {
      const detected = detectPartialToolCallAttempt(result.content, tools);
      console.warn(
        '[chat:turn] model emitted a partial pseudo-tool-call — nudging it to retry with all required fields',
        { detected, originalContent: result.content.slice(0, 300) }
      );
      if (opts.onAssistantTextRetracted) opts.onAssistantTextRetracted();
      opts.onToolEvent?.({
        phase: 'failed',
        id: `partial_${Math.random().toString(36).slice(2, 10)}`,
        name: detected.name,
        error: detected.missing.length
          ? `Model forgot the ${detected.missing.join(', ')} field(s). Asking it to retry…`
          : 'Model wrote the call as prose. Asking it to retry as a structured call…'
      });
      const missingClause = detected.missing.length
        ? `was missing required fields: ${detected.missing.join(', ')}. ` +
          `Re-emit with EVERY required field populated (especially the full ${
            detected.missing.includes('content') ? '`content`' : 'arguments'
          } value).`
        : 'was written in prose instead of as a real tool call. ' +
          'Emit it through the structured tool_calls channel.';
      history.push({
        role: 'system',
        content:
          `Your last reply tried to invoke the \`${detected.name}\` tool but it ${missingClause} ` +
          'Do not narrate. Do not write the call inside the message body. ' +
          'Just call the tool through the structured tool_calls channel with ALL required arguments.'
      });
      // Skip pushing the bad assistant message AND skip the no-tool-calls
      // early-return. Continue the loop for another shot.
      continue;
    }

    // WebLLM + Hermes-3 rejects messages with `content: null` even when
    // the OpenAI spec says null is fine alongside `tool_calls`. Use an
    // empty string when there's no textual content (e.g. the rescue
    // path retracted it after synthesizing a tool call).
    const assistantMessage = {
      role: 'assistant',
      content: typeof result.content === 'string' ? result.content : '',
      ...(result.toolCalls.length
        ? {
            tool_calls: result.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments }
            }))
          }
        : {})
    };
    history.push(assistantMessage);

    if (!result.toolCalls.length) {
      console.log('[chat:turn] no tool calls — turn complete', {
        finalContentPreview: (result.content || '').slice(0, 200)
      });
      return { aborted: false, iterations };
    }

    console.log(
      `[chat:turn] iteration ${iterations} produced ${result.toolCalls.length} tool call(s) — dispatching`
    );

    // Execute each tool call sequentially. Order matters for things like
    // listFiles → readFile where the second call depends on the first.
    for (const call of result.toolCalls) {
      if (signal.aborted) return { aborted: true, iterations };

      console.log('[chat:tool] dispatching', {
        name: call.name,
        args: call.arguments,
        id: call.id
      });

      opts.onToolEvent?.({
        phase: 'started',
        id: call.id,
        name: call.name,
        argumentsRaw: call.arguments
      });

      let toolResult;
      try {
        toolResult = await runTool(call.name, call.arguments, toolCtx);
        console.log('[chat:tool] completed', {
          name: call.name,
          id: call.id,
          resultPreview: previewResult(toolResult)
        });
        opts.onToolEvent?.({
          phase: 'completed',
          id: call.id,
          name: call.name,
          resultPreview: previewResult(toolResult)
        });
      } catch (err) {
        const message = err && /** @type {Error} */ (err).message;
        toolResult = JSON.stringify({ ok: false, error: message || String(err) });
        console.error('[chat:tool] threw', { name: call.name, id: call.id, error: message });
        opts.onToolEvent?.({
          phase: 'failed',
          id: call.id,
          name: call.name,
          error: message || String(err)
        });
      }

      history.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: toolResult
      });

      // If the tool returned `{ok: false}`, flag the next iteration
      // for an error-retry. We only set this for the LAST failing
      // tool in the batch — if a later call in the same iteration
      // succeeded, the model can still summarize from that.
      let parsedResult = null;
      try {
        parsedResult = JSON.parse(toolResult);
      } catch {
        /* non-JSON tool result is unusual but not a hard error */
      }
      if (
        parsedResult &&
        parsedResult.ok === false &&
        typeof parsedResult.error === 'string' &&
        toolErrorRetries < MAX_TOOL_ERROR_RETRIES
      ) {
        pendingErrorRetry = { name: call.name, error: parsedResult.error };
      } else if (parsedResult && parsedResult.ok !== false) {
        // A successful call resets the retry counter — a follow-up
        // failure later in the turn still gets its own retry budget.
        pendingErrorRetry = null;
      }
    }
  }

  // Hit the iteration cap. Inject a synthetic note so the model can
  // wrap up on its next turn (if invoked again) rather than getting
  // stuck thinking the loop is infinite.
  history.push({
    role: 'system',
    content:
      'Hit the tool-call iteration limit for this turn. Please summarize for the user without further tool calls.'
  });
  return { aborted: false, iterations };
}

/**
 * @param {Array<object>} history
 * @param {{
 *   embedded: boolean,
 *   apps: Array<object>,
 *   home: string,
 *   host?: string,
 *   activeFile?: object | null,
 *   projectTree?: string | null,
 *   workspaceRoot?: string | null
 * }} opts
 */
function installSystemPrompt(history, opts) {
  const fresh = buildSystemPrompt({
    now: new Date(),
    embedded: opts.embedded,
    apps: opts.apps,
    home: opts.home,
    host: opts.host,
    activeFile: opts.activeFile,
    projectTree: opts.projectTree,
    workspaceRoot: opts.workspaceRoot
  });
  const idx = history.findIndex((m) => m.role === 'system');
  if (idx === -1) {
    history.unshift({ role: 'system', content: fresh });
  } else {
    history[idx] = { role: 'system', content: fresh };
  }
}

/**
 * Crude intent detector — when the user's message looks action-y, we
 * force `tool_choice: 'required'` so the model can't shrug and answer
 * in prose (the failure mode where it hallucinates a fake `ls` output
 * instead of calling `listFiles`).
 *
 * False positives are cheap — the model will pick a reasonable tool
 * from the catalog. False negatives are expensive — they're exactly
 * the hallucinations we're trying to kill. So bias generous.
 *
 * @param {string} userText
 */
function detectActionIntent(userText, opts = {}) {
  if (typeof userText !== 'string' || !userText) return false;
  const host = typeof opts.host === 'string' ? opts.host : 'chat';
  const isCodeIde = host === 'code-ide';

  // Action verbs that map to our tool surface. Bias generous —
  // "play piano", "use paint", "boot up terminal" should all force a
  // tool call rather than letting the model role-play having done it.
  if (
    /\b(open|launch|start|run|play|use|boot|fire up|bring up|switch to|go to|navigate|show me|list|read|cat|fetch|summarize|scrape|notify|remind|browse|visit)\b/i.test(
      userText
    )
  ) {
    return true;
  }
  // Code-editing verbs — primarily for the Code IDE host, but harmless
  // in plain chat ("write me a poem about cats" still gets free-form
  // text because there's no matching tool, so tool_choice: 'required'
  // bounces back through the recovery path; the cost is one extra
  // model call). Without these, "create a shell script" / "make a
  // file foo.sh" / "add a null check" land in tool_choice: 'auto'
  // and the model defaults to explaining instead of calling the tool.
  if (
    /\b(create|make|write|generate|build|scaffold|stub out|new file|add|insert|prepend|append|edit|modify|change|update|patch|fix|refactor|rename|extract|inline|wrap|unwrap|delete|remove|replace|rewrite)\b/i.test(
      userText
    )
  ) {
    return true;
  }
  // Soft-request verbs: "I want X", "I'd like X", "can you X",
  // "could you X", "please X", "let's X", "give me X", "I need X".
  // Production failure 2026-05-19: "ok so, I want a python script
  // that says hello world" landed in tool_choice: 'auto' because
  // none of the above matched. The user clearly wanted a file
  // created. Adding the soft-request pattern catches every "polite
  // ask" phrasing.
  if (
    /\b(?:i\s+(?:want|need|would\s+like)|i'd\s+like|can\s+you|could\s+you|would\s+you|please|let'?s|give\s+me|gimme|help\s+me)\b/i.test(
      userText
    )
  ) {
    return true;
  }
  // Artifact nouns — when the user names a kind of code thing
  // ("a python script", "a function that…", "a class", "unit tests
  // for X", "a config file"), they're asking for one regardless of
  // what verb they used. Especially relevant in Code IDE where the
  // host can ONLY do file-related things. Allow plural forms
  // ("tests", "scripts", "classes").
  if (
    /\b(?:scripts?|functions?|classe?s?|methods?|modules?|components?|tests?|specs?|configs?|templates?|snippets?|stubs?|skeletons?)\b/i.test(
      userText
    )
  ) {
    return true;
  }
  // Anything mentioning a filesystem path or URL is probably a tool job.
  if (/(?:\s\/[\w.-]|^\/[\w.-]|https?:\/\/|\s~\/?\s?$|\s~\/)/i.test(userText)) {
    return true;
  }
  // "what apps", "what's in /…", "contents of …"
  if (/\bwhat (?:apps|'?s in|files|is in)\b/i.test(userText)) {
    return true;
  }
  if (/\bcontents of\b/i.test(userText)) {
    return true;
  }

  // Code IDE bias: this host only has file tools. Almost any user
  // input is going to be an editing request. The ONLY exception is
  // a clear question about the AI itself or chit-chat. Force action
  // intent unless the message is obviously a question that doesn't
  // need a file action.
  if (isCodeIde) {
    // A clear question to the assistant ("what is X", "how does Y
    // work", "why did you Z", "explain Q") — only true when there
    // are NO code-ish nouns / file refs. We've already returned
    // true above if any of those matched.
    if (
      /^\s*(?:what|why|how|when|who|where|explain|tell\s+me|describe)\b/i.test(userText) ||
      /^\s*(?:hi|hello|hey|thanks?|thank\s+you|ok|cool|nice)\b\s*[!?.]?\s*$/i.test(userText)
    ) {
      return false;
    }
    // Everything else in Code IDE → action intent. The user is
    // sitting in front of an editor, they want to do something
    // with code.
    return true;
  }

  return false;
}

/** Resolve the apps registry without ever throwing — empty list is OK. */
async function safeFetchApps(toolCtx) {
  if (!toolCtx || typeof toolCtx.appsRegistry !== 'function') return [];
  try {
    const apps = await toolCtx.appsRegistry();
    return Array.isArray(apps) ? apps : [];
  } catch {
    return [];
  }
}

/**
 * The Hermes-3 q4f16_1 WebLLM build is compiled with a 4096-token
 * `context_window_size`. We reserve ~600 tokens for the assistant's
 * reply and ~100 for tool-call scaffolding, leaving ~3400 tokens for
 * everything we send. At ~3.5 chars/token that's about 12 000 chars
 * total across all messages.
 *
 * We deliberately set the budget lower than the theoretical max so a
 * small ratio mis-estimate (CJK, code-heavy docs, long names) doesn't
 * push us over.
 */
const WIRE_CHAR_BUDGET = 11000;

/**
 * Estimate total character count of a wire-shape message list. Used
 * to keep us under the model's context window. We don't tokenize
 * here — char-counting is good enough and 100× cheaper than spinning
 * up a tokenizer at the head of every turn.
 *
 * @param {Array<object>} messages
 */
function estimateMessagesChars(messages) {
  let total = 0;
  for (const m of messages) {
    const c = /** @type {any} */ (m).content;
    if (typeof c === 'string') total += c.length;
    const tc = /** @type {any} */ (m).tool_calls;
    if (Array.isArray(tc)) {
      for (const call of tc) {
        const args = call?.function?.arguments;
        if (typeof args === 'string') total += args.length;
      }
    }
  }
  return total;
}

/**
 * If the wire-version of the message list would exceed the model's
 * context window, shrink it in place by:
 *
 *   1) trimming the most recent user message's content (which is what
 *      usually carries the attachment block), and
 *   2) if that's not enough, dropping the oldest non-system messages.
 *
 * Returns a NEW array; the original history is untouched, so the
 * displayed conversation isn't visually corrupted.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
function fitMessagesToContextWindow(messages) {
  const total = estimateMessagesChars(messages);
  if (total <= WIRE_CHAR_BUDGET) return messages;

  console.warn(
    `[chat:turn] wire content ${total} chars > budget ${WIRE_CHAR_BUDGET} — truncating to fit context window`
  );

  let out = messages.slice();

  // 1) Truncate the last user message's content to ~half the budget.
  //    Keep the end of the text (where the user's actual question
  //    usually lives) since we put attachments first.
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const m = /** @type {any} */ (out[i]);
    if (m.role !== 'user' || typeof m.content !== 'string') continue;
    const keep = Math.max(2000, WIRE_CHAR_BUDGET - (total - m.content.length));
    if (m.content.length > keep) {
      const head = m.content.slice(0, Math.floor(keep * 0.85));
      const tail = m.content.slice(-Math.floor(keep * 0.15));
      out[i] = {
        ...m,
        content: `${head}\n\n[…document truncated to fit the model's context window…]\n\n${tail}`
      };
    }
    break;
  }

  // 2) Drop oldest non-system messages until we fit.
  while (estimateMessagesChars(out) > WIRE_CHAR_BUDGET) {
    const dropIdx = out.findIndex((m) => /** @type {any} */ (m).role !== 'system');
    if (dropIdx === -1) break;
    out = out.slice(0, dropIdx).concat(out.slice(dropIdx + 1));
  }

  return out;
}

function stripUiOnlyFields(history) {
  // Keep only the OpenAI-documented fields. Same shape WebLLM expects.
  // Also expands any user-message attachments into a textual block
  // PREPENDED to the user content so the model can see them without
  // us having to invent a non-standard message field.
  return history.map((m) => {
    /** @type {Record<string, any>} */
    const out = { role: m.role };
    if (m.role === 'user' && Array.isArray(/** @type {any} */ (m).attachments)) {
      const blocks = /** @type {Array<any>} */ (m.attachments)
        .map((a) => formatAttachmentForModel(a))
        .filter(Boolean);
      const userText = typeof m.content === 'string' ? m.content : '';
      // Doc(s) first, then the user's question. The model has been
      // shown to follow the question more reliably when it's the LAST
      // thing in the message rather than the first.
      out.content = blocks.length ? `${blocks.join('\n\n')}\n\n${userText}`.trim() : userText;
    } else if (m.content !== undefined) {
      out.content = m.content;
    }
    // Defensive: WebLLM + Hermes-3 throws "assistant's message should
    // have string content" if we send `content: null` (even with
    // tool_calls). Coerce any null/undefined assistant/system/tool
    // content to an empty string. Stale messages from old localStorage
    // or buggy rescue paths can otherwise land us in this trap.
    if (out.content === null || out.content === undefined) {
      out.content = '';
    }
    if (m.name) out.name = m.name;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    return out;
  });
}

/**
 * Append a one-shot tool-call directive to the wire-version of the last
 * user message. Returns a NEW array with the last user message cloned;
 * the original history is untouched, so the persisted/displayed
 * conversation never shows the directive.
 *
 * Why: with Hermes-3 on WebLLM, `tool_choice: 'required'` is not a hard
 * grammar constraint — the model still sometimes role-plays as a
 * helpful assistant who "already did" the action (e.g. "Sure, I've
 * opened Paint for you.") instead of emitting a structured tool call.
 * Putting the reminder inside the user turn, right next to the request,
 * makes the model commit to the tool format much more reliably.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
function withActionDirective(messages) {
  const DIRECTIVE = [
    '',
    '[System reminder: the message above is an action request. Respond ONLY by',
    'calling the appropriate function via the structured tool_calls channel — do',
    'NOT respond in text. Do NOT write sentences like "I have opened X" or',
    '"Launching X"; instead, emit the real tool call and the system will confirm',
    'when it finishes. Pick the tool whose description matches the request and',
    "fill its arguments using values from the apps catalog or the user's text.]"
  ].join('\n');

  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const m = /** @type {any} */ (out[i]);
    if (m && m.role === 'user' && typeof m.content === 'string') {
      out[i] = { ...m, content: `${m.content}\n${DIRECTIVE}` };
      break;
    }
  }
  return out;
}

function previewResult(jsonString) {
  if (typeof jsonString !== 'string') return '';
  return jsonString.length > 160 ? `${jsonString.slice(0, 160)}…` : jsonString;
}

/**
 * Recognize "the model TRIED to call a tool but botched it" — used to
 * gate the retry-with-system-reminder path in the main loop.
 *
 * A partial attempt looks like one of:
 *   - `tool_calls\nCreateFile(...)` — explicit tool_calls marker.
 *   - `<tool_call>...</tool_call>` — Hermes's native fence with bad JSON
 *     inside.
 *   - `toolName(...)` — bare function-call literal mentioning a known
 *     tool name.
 *   - YAML-like `- call: toolName` / `name: toolName` headers.
 *
 * Returns `{ name, missing }` where `missing` is the list of required
 * params we can prove are absent (best-effort — when in doubt we leave
 * it empty so the reminder is still useful but vaguer). Returns null
 * when the text shows no sign of a tool-call attempt.
 *
 * @param {string} text
 * @param {Array<object>} tools  OpenAI-shaped tool defs.
 * @returns {{ name: string, missing: string[] } | null}
 */
function detectPartialToolCallAttempt(text, tools) {
  if (!text || typeof text !== 'string') return null;
  if (!Array.isArray(tools) || tools.length === 0) return null;
  const knownNames = tools.map((t) => /** @type {any} */ (t).function?.name).filter(Boolean);
  if (knownNames.length === 0) return null;

  // 1) Find which known tool the text was trying to invoke and (when
  // it used the call-literal form `toolName(...)`) figure out how many
  // positional args were inside the parens. That count tells us how
  // many of the tool's required params we should treat as supplied —
  // a model that wrote `createFile("/x.sh", "echo hi")` shouldn't be
  // told it "forgot the content field". False negatives (claiming a
  // param is present when it isn't) lead to wasteful retries; false
  // positives (claiming missing when present) make the reminder text
  // misleading. We lean toward false negatives.
  let toolName = null;
  /** @type {Set<string>} */
  const argsPresent = new Set();
  for (const name of knownNames) {
    const callRe = new RegExp(`\\b${escapeRegex(name)}\\s*\\(`);
    if (callRe.test(text)) {
      toolName = name;
      // Run the full call-args parser so we know EXACTLY which
      // required params are present — positionally, as kwargs, or
      // as a kwargs-object. Anything we can extract is "present";
      // anything missing goes into the retry reminder.
      const def = tools.find((t) => /** @type {any} */ (t).function?.name === name);
      const params = /** @type {any} */ (def)?.function?.parameters?.properties
        ? Object.keys(/** @type {any} */ (def).function.parameters.properties)
        : [];
      const callIdx = findCallStart(text, name);
      if (callIdx !== -1) {
        const argText = extractParenBalanced(text, callIdx);
        if (argText !== null) {
          const obj = parseCallArgs(argText, params);
          if (obj) {
            for (const k of Object.keys(obj)) {
              if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
                argsPresent.add(k);
              }
            }
          }
        }
      }
      break;
    }
    // section/yaml form: a line that's `- toolName`, `toolName:`,
    // `call: toolName`, `tool: toolName`, `function: toolName`, etc.
    const sectionRe = new RegExp(
      `(?:^|\\n)\\s*(?:-\\s*)?(?:call|tool|tool_name|function|name)?\\s*:?\\s*["\\']?${escapeRegex(
        name
      )}["\\']?\\s*(?:\\(|:|$)`,
      'm'
    );
    if (sectionRe.test(text)) {
      toolName = name;
      break;
    }
  }

  // Also flag the bare `tool_calls` / `<tool_call>` markers even when
  // no specific tool was mentioned — that's a clear "I tried" signal
  // and the reminder still helps.
  const looksLikeAttempt =
    toolName ||
    /\btool_calls?\b/i.test(text) ||
    /<tool_call/i.test(text) ||
    /\{\s*"?(?:name|tool|tool_name|function)"?\s*:/i.test(text);
  if (!looksLikeAttempt) return null;

  if (!toolName) {
    // Generic attempt without a known tool name — still worth retrying
    // but we can't say which params are missing.
    return { name: 'tool', missing: [] };
  }

  // 2) Figure out which required params look missing. We look for
  // `param:` / `param=` headers; if we used the call-literal form
  // with N positional args, treat the first N required params as
  // positionally supplied. False negatives ("present" when actually
  // missing) are fine — we'll just call the tool and let validate()
  // reject. False positives ("missing" when actually present) make
  // the retry reminder text misleading, so we lean conservative.
  const def = tools.find((t) => /** @type {any} */ (t).function?.name === toolName);
  const required = /** @type {any} */ (def)?.function?.parameters?.required;
  if (!Array.isArray(required) || required.length === 0) {
    return { name: toolName, missing: [] };
  }
  const missing = [];
  for (const p of required) {
    if (argsPresent.has(p)) continue;
    const re = new RegExp(`(^|[\\s\\(\\{,])${escapeRegex(p)}\\s*[:=]`, 'm');
    if (!re.test(text)) missing.push(p);
  }
  return { name: toolName, missing };
}

/**
 * Best-effort: pull a `{ name, arguments }` tool call out of a free-text
 * assistant reply. Returns null when nothing recognizable is found.
 *
 * Hermes-3 + WebLLM emits "I want to call this tool" in a few different
 * textual flavors when the structured channel doesn't fire:
 *   1) `<tool_call>{"name":"launchApp","arguments":{"appId":"paint"}}</tool_call>`
 *      (Hermes's native training format).
 *   2) Pure JSON: `{"name":"launchApp","arguments":{"appId":"paint"}}`.
 *   3) Function-call literal: `launchApp({"appId":"paint"})` /
 *      `launchApp(appId="paint")` / `launchApp("paint")`.
 *   4) Bulleted listing (we saw this one in the wild):
 *        ```
 *        Action → tool:
 *        - "open Paint" → launchApp
 *        - appId: "paint"
 *        ```
 *
 * Patterns are tried in order from most-structured to least; the first
 * that yields a known tool name + non-empty arguments wins.
 *
 * @param {string} text
 * @param {Array<object>} tools  OpenAI-shaped tool definition objects.
 * @returns {{ name: string, arguments: string } | null}
 */
function extractToolCallFromText(text, tools) {
  if (!text || !Array.isArray(tools) || tools.length === 0) return null;
  const knownTools = tools.map((t) => /** @type {any} */ (t).function?.name).filter(Boolean);
  if (knownTools.length === 0) return null;
  const knownSet = new Set(knownTools);
  // Schemas indexed by tool name — the recovery patterns below need
  // to know each tool's params + which are required so we can validate
  // candidates and reject obvious garbage.
  const paramsByTool = new Map();
  const requiredByTool = new Map();
  for (const t of tools) {
    const fn = /** @type {any} */ (t).function;
    const props = fn?.parameters?.properties;
    if (fn?.name && props && typeof props === 'object') {
      paramsByTool.set(fn.name, Object.keys(props));
    }
    if (fn?.name && Array.isArray(fn?.parameters?.required)) {
      requiredByTool.set(fn.name, fn.parameters.required.slice());
    }
  }

  /**
   * Reject (returns null) any candidate whose parsed args don't carry
   * every required parameter for the named tool. Without this, a half-
   * extracted pattern (e.g. `{tool_calls: "...", args: "...", content: "|"}`
   * for createFile) would be dispatched and immediately fail with
   * `path is required.`, ending the turn.
   */
  function validate(candidate) {
    if (!candidate) return null;
    const required = requiredByTool.get(candidate.name) || [];
    if (required.length === 0) return candidate;
    let parsed;
    try {
      parsed =
        typeof candidate.arguments === 'string'
          ? JSON.parse(candidate.arguments)
          : candidate.arguments || {};
    } catch {
      return null;
    }
    for (const r of required) {
      const v = parsed?.[r];
      if (v == null || v === '') return null;
    }
    return candidate;
  }

  // 1) <tool_call>{...}</tool_call> (Hermes-3 native).
  const xml = text.match(/<tool_call>\s*([\s\S]+?)\s*<\/tool_call>/i);
  if (xml) {
    const fromObj = toolFromJsonString(xml[1], knownSet);
    const v = validate(fromObj);
    if (v) return v;
  }

  // 2) Whole reply is JSON.
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const fromObj = toolFromJsonString(trimmed, knownSet);
    const v = validate(fromObj);
    if (v) return v;
  }

  // 3) Function-call literal: `toolName(...)`. Bracket-aware scan +
  //    smart call-args parser. parseCallArgs handles every shape
  //    we've seen in the wild (pure positional, pure kwargs object,
  //    Python-style key=value pairs, and mixed positional+kwargs).
  for (const name of knownTools) {
    const callIdx = findCallStart(text, name);
    if (callIdx === -1) continue;
    const argText = extractParenBalanced(text, callIdx);
    if (argText == null) continue;
    if (argText.trim() === '') {
      const v = validate({ name, arguments: '{}' });
      if (v) return v;
      continue;
    }
    const params = paramsByTool.get(name) || [];
    let candidate = null;
    const parsed = parseCallArgs(argText, params);
    if (parsed && Object.keys(parsed).length > 0) {
      candidate = { name, arguments: JSON.stringify(parsed) };
    }
    const v = validate(candidate);
    if (v) return v;
  }

  // 4) Section-style / YAML-ish: a tool name (or a tool-name-shaped
  //    line) somewhere in the body, followed by `param: value` /
  //    `param:` block-scalar / bare `param` headers. This is the
  //    Hermes failure mode that produced both
  //
  //      tool_calls
  //      createFile
  //      path
  //      main.cpp
  //      content
  //      #include …
  //
  //    AND the YAML variant
  //
  //      tool_calls:
  //      - call: createFile
  //        args:
  //          path: /hello.py
  //          content: |
  //            print("hi")
  //
  //    The parser is schema-aware so it knows which lines are
  //    headers vs. multi-line value content.
  for (const name of knownTools) {
    const params = paramsByTool.get(name);
    if (!params || params.length === 0) continue;
    const args = extractSectionStyleArgs(text, name, params);
    if (args && Object.keys(args).length > 0) {
      const v = validate({ name, arguments: JSON.stringify(args) });
      if (v) return v;
    }
  }

  // 5) Shape-based dispatch: the model invented a tool name (e.g.
  //    `activeFileEdit` instead of `applyEdit`) but the params it
  //    carried — `path`, `edits` — are an unmistakable shape match
  //    for one of our known tools. Look at every `key:` mentioned
  //    anywhere in the text, score each tool by how many of its
  //    required params are present, and pick the winner.
  const shapeMatch = matchToolByShape(text, tools, paramsByTool, requiredByTool);
  if (shapeMatch) {
    const args = extractSectionStyleArgs(
      text,
      /* anchorOptional */ null,
      paramsByTool.get(shapeMatch) || []
    );
    if (args && Object.keys(args).length > 0) {
      const v = validate({ name: shapeMatch, arguments: JSON.stringify(args) });
      if (v) return v;
    }
  }

  // 6) Last-resort loose key:value bag, but ONLY when the tool's
  //    schema is simple (1–2 string params, no arrays/objects). This
  //    keeps the bullet-listing case for launchApp / readFile / notify
  //    working without false-positive matches for createFile/applyEdit
  //    (whose multi-line `content` and nested `edits` arrays the loose
  //    collector mangles).
  for (const name of knownTools) {
    const params = paramsByTool.get(name) || [];
    const t = tools.find((x) => /** @type {any} */ (x).function?.name === name);
    const props = /** @type {any} */ (t)?.function?.parameters?.properties || {};
    const isSimple =
      params.length > 0 && params.length <= 2 && params.every((p) => props[p]?.type === 'string');
    if (!isSimple) continue;
    if (!new RegExp(`\\b${escapeRegex(name)}\\b`).test(text)) continue;
    const args = collectLooseKeyValuePairs(text, name);
    if (args && Object.keys(args).length > 0) {
      const v = validate({ name, arguments: JSON.stringify(args) });
      if (v) return v;
    }
  }

  return null;
}

/**
 * Score every tool by how many of its required params appear as
 * top-level `key:` mentions in the text. Returns the winning tool
 * name, or null if no tool has at least one required-param match.
 *
 * Used to recover when the model invents a tool name (e.g.
 * `activeFileEdit`) but the param shape clearly identifies the real
 * tool (e.g. `path` + `edits` → applyEdit).
 *
 * @param {string} text
 * @param {Array<object>} tools
 * @param {Map<string, string[]>} paramsByTool
 * @param {Map<string, string[]>} requiredByTool
 * @returns {string | null}
 */
function matchToolByShape(text, tools, paramsByTool, requiredByTool) {
  const mentioned = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*-?\s*([a-zA-Z_][\w]*)\s*:/);
    if (m) mentioned.add(m[1]);
  }
  if (mentioned.size === 0) return null;

  /** @type {Array<{ name: string, requiredHits: number, totalHits: number }>} */
  const scored = [];
  for (const t of tools) {
    const name = /** @type {any} */ (t).function?.name;
    if (!name) continue;
    const required = requiredByTool.get(name) || [];
    const all = paramsByTool.get(name) || [];
    if (required.length === 0) continue;
    const requiredHits = required.filter((r) => mentioned.has(r)).length;
    const totalHits = all.filter((p) => mentioned.has(p)).length;
    if (requiredHits >= required.length) {
      scored.push({ name, requiredHits, totalHits });
    }
  }
  if (scored.length === 0) return null;
  // Prefer the tool with the most required-param hits, breaking ties
  // by total-param hits.
  scored.sort((a, b) => b.requiredHits - a.requiredHits || b.totalHits - a.totalHits);
  return scored[0].name;
}

/**
 * Walk a chunk of text looking for parameter-name headers and
 * accumulate their values. Handles three header shapes:
 *
 *   - bare:           `path`            (next non-empty lines are value)
 *   - inline:         `path: /foo.sh`   (value on same line)
 *   - block scalar:   `content: |`      (next indented lines are value)
 *
 * The schema's `paramNames` defines which keys count as headers — so
 * a content body that mentions the literal word `path` mid-sentence
 * doesn't trigger a false split.
 *
 * If `anchor` is a non-null string, scanning starts after the first
 * line whose trimmed contents equal `anchor` (the tool name in
 * patterns 4/5) — anything before that anchor is treated as preamble
 * and skipped. If `anchor` is null, scanning starts at line 0; this
 * is the shape-match path where the model invented a tool name we
 * didn't anchor on.
 *
 * Returns null when fewer than two parameter headers were found.
 *
 * @param {string} text
 * @param {string|null} anchor
 * @param {string[]} paramNames
 * @returns {Record<string, any> | null}
 */
function extractSectionStyleArgs(text, anchor, paramNames) {
  const lines = text.split('\n');
  let startIdx = 0;
  if (anchor) {
    let found = -1;
    // Match the anchor as: standalone (`createFile`), with a trailing
    // colon (`createFile:`), as a list item (`- createFile`), or in
    // YAML wrapper shapes the model emits when it dresses up the call
    // (`- call: createFile`, `name: createFile`, `tool: createFile`,
    // `function: createFile`). The wrapper key may carry trailing
    // punctuation (e.g. quotes); we only require it to END with the
    // anchor.
    const wrapperKeys = ['call', 'name', 'tool', 'function', 'tool_name'];
    for (let i = 0; i < lines.length; i += 1) {
      const t = lines[i].trim();
      if (t === anchor || t === `${anchor}:` || t === `- ${anchor}`) {
        found = i;
        break;
      }
      const wrapMatch = t.match(/^-?\s*([a-zA-Z_][\w]*)\s*:\s*["']?([\w-]+)["']?$/);
      if (wrapMatch && wrapperKeys.includes(wrapMatch[1]) && wrapMatch[2] === anchor) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    startIdx = found + 1;
  }

  const params = new Set(paramNames);
  /** @type {Record<string, string>} */
  const raw = {};
  let currentParam = null;
  /** @type {string[]} */
  let currentValue = [];
  let blockIndent = -1; // Established from first non-empty value line.
  let headerCount = 0;

  function flush() {
    if (!currentParam) return;
    let v = currentValue.join('\n');
    // Strip the uniform leading indent we measured from the first
    // non-empty line — required for YAML block scalars (`content: |`
    // followed by indented body).
    if (blockIndent > 0) {
      v = v
        .split('\n')
        .map((l) => (l.length >= blockIndent ? l.slice(blockIndent) : l))
        .join('\n');
    }
    raw[currentParam] = v.replace(/\s+$/, '');
  }

  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // `param:` (header alone, value follows on next lines) or
    // `param: value` (inline) or `param: |` (block scalar).
    const inline = trimmed.match(/^([a-zA-Z_][\w]*)\s*:\s*(.*)$/);
    if (inline && params.has(inline[1])) {
      flush();
      currentParam = inline[1];
      currentValue = [];
      blockIndent = -1;
      headerCount += 1;
      const rhs = inline[2];
      // Strip a single optional `|` / `>` block-scalar marker — we
      // treat all multi-line values as literal block scalars.
      const stripped = rhs.replace(/^[|>][-+]?\s*$/, '');
      if (rhs !== '' && stripped === rhs) {
        // Inline value, complete.
        currentValue = [rhs];
        flush();
        currentParam = null;
        currentValue = [];
      }
      continue;
    }

    // Bare `param` on its own line, value on next line(s).
    if (params.has(trimmed)) {
      flush();
      currentParam = trimmed;
      currentValue = [];
      blockIndent = -1;
      headerCount += 1;
      continue;
    }

    if (currentParam) {
      // Track first non-empty line's leading indent; subsequent lines
      // get the same prefix stripped (block-scalar semantics).
      if (blockIndent === -1 && line.trim() !== '') {
        const m = line.match(/^(\s*)/);
        blockIndent = m ? m[1].length : 0;
      }
      currentValue.push(line);
    }
  }
  flush();

  if (headerCount < 2) return null;

  // Coerce simple typed values (booleans, numbers, JSON literals).
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (v === 'true') out[k] = true;
    else if (v === 'false') out[k] = false;
    else if (v === 'null') out[k] = null;
    else if (/^-?\d+(?:\.\d+)?$/.test(v) && k !== 'path' && k !== 'content') {
      out[k] = Number(v);
    } else if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Try to parse `s` as JSON and pull out a known tool name + args.
 * Accepts a few common shapes: `{name, arguments}`, `{tool, args}`,
 * `{function: {name, arguments}}`.
 *
 * @param {string} s
 * @param {Set<string>} knownSet
 * @returns {{ name: string, arguments: string } | null}
 */
function toolFromJsonString(s, knownSet) {
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;

  // Unwrap the common nested shapes the model might emit.
  let candidate = obj;
  if (obj.function && typeof obj.function === 'object') candidate = obj.function;
  else if (obj.tool_call && typeof obj.tool_call === 'object') candidate = obj.tool_call;

  const name = candidate.name || candidate.tool_name || candidate.tool;
  const args =
    candidate.arguments ?? candidate.args ?? candidate.parameters ?? candidate.params ?? {};
  if (!name || !knownSet.has(name)) return null;
  const argsString = typeof args === 'string' ? args : JSON.stringify(args);
  return { name, arguments: argsString };
}

/**
 * Split `argText` (the contents inside `toolName(...)`) into raw
 * top-level comma-separated segments. Respects quoted strings (",
 * ', `), nested brackets ((), {}, []), and backslash escapes inside
 * strings. Returns trimmed segment strings — the caller decides how
 * to interpret each one (positional value, kwarg, object literal,
 * etc.).
 *
 * @param {string} argText
 * @returns {string[]}
 */
function splitTopLevelArgs(argText) {
  if (typeof argText !== 'string') return [];
  const text = argText.trim();
  if (text === '') return [];

  /** @type {string[]} */
  const segments = [];
  let depth = 0;
  let inStr = null;
  let escape = false;
  let cur = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      cur += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      depth += 1;
      cur += ch;
      continue;
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      segments.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') segments.push(cur.trim());
  return segments;
}

/**
 * Parse `argText` (the contents inside `toolName(...)`) into positional
 * values. Each segment is parsed via parseArgValue (quoted strings,
 * JSON literals, or raw text). Returns null when ANY segment looks
 * like a keyword arg (`key: value` / `key=value`) — those cases
 * belong to parseCallArgs / parseLooseArgs instead.
 *
 * Kept for back-compat and unit tests; the production path uses
 * parseCallArgs.
 *
 * @param {string} argText
 * @returns {any[] | null}
 */
function parsePositionalArgs(argText) {
  const segments = splitTopLevelArgs(argText);
  if (segments.length === 0) {
    return typeof argText === 'string' && argText.trim() === '' ? [] : null;
  }
  const looksKeyword = segments.some((s) => /^[a-zA-Z_][\w]*\s*[:=]/.test(s));
  if (looksKeyword) return null;
  return segments.map((s) => parseArgValue(s));
}

/**
 * Parse `argText` into a finished arguments object using the tool's
 * declared parameter list to resolve positional → named mapping.
 * Handles every call shape we've seen Hermes-3 produce:
 *
 *   createFile("/x.cpp", "int main(){}")           // pure positional
 *   createFile({path: "/x.cpp", content: "..."})   // pure kwargs object
 *   createFile(path="/x.cpp", content="...")       // pure kwargs (Python)
 *   createFile("/x.cpp", {content: "..."})         // mixed: path positional,
 *                                                  // remaining keys in object
 *   createFile("/x.cpp", content="...")            // mixed: path positional,
 *                                                  // remaining keys as kwargs
 *
 * Each segment is classified:
 *   - Object literal `{...}` → unbox via parseRelaxedObjectLiteral
 *     (recognizes unquoted keys) and merge into the kwargs bucket.
 *   - `key: value` / `key=value` → single-pair kwarg.
 *   - Anything else → positional, assigned to the next unused param.
 *
 * Positional slots are filled BEFORE kwargs override them — that
 * matches Python's TypeError-on-duplicate semantics in spirit
 * (kwargs win, which is what the model usually means when it
 * double-specifies).
 *
 * Returns null when argText is empty / unparseable AND no params
 * could be inferred. Empty object `{}` is a valid return for a
 * zero-arg tool call.
 *
 * @param {string} argText
 * @param {string[]} params  ordered list of parameter names for the tool
 * @returns {Record<string, any> | null}
 */
function parseCallArgs(argText, params) {
  const segments = splitTopLevelArgs(argText);
  if (segments.length === 0) return {};

  /** @type {Record<string, any>} */
  const positional = {};
  /** @type {Record<string, any>} */
  const kwargs = {};
  const usedParams = new Set();
  let posIdx = 0;

  for (const raw of segments) {
    const seg = raw.trim();
    if (seg === '') continue;

    // 1) Object literal { ... } — unbox as kwargs.
    if (seg.startsWith('{')) {
      let obj = null;
      try {
        obj = JSON.parse(seg);
      } catch {
        obj = parseRelaxedObjectLiteral(seg);
      }
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) kwargs[k] = v;
        continue;
      }
      // Fall through and treat as opaque positional value.
    }

    // 2) Single kwarg `key: value` / `key=value`. Only treat as a
    //    kwarg if the key is one of the tool's params — otherwise
    //    `{content: "..."}` segments that LOOK like `content: ...`
    //    after stripping leading `{` could get misclassified. We're
    //    strict on purpose; positional + bare key=value still works
    //    when the model uses Python-style syntax because the key
    //    name matches the schema.
    const kwMatch = seg.match(/^([a-zA-Z_][\w]*)\s*[:=]\s*([\s\S]*)$/);
    if (kwMatch && params.includes(kwMatch[1])) {
      kwargs[kwMatch[1]] = parseArgValue(kwMatch[2]);
      continue;
    }

    // 3) Positional value.
    if (posIdx < params.length) {
      const p = params[posIdx];
      positional[p] = parseArgValue(seg);
      usedParams.add(p);
      posIdx += 1;
    }
  }

  /** @type {Record<string, any>} */
  const merged = { ...positional, ...kwargs };
  if (Object.keys(merged).length === 0) return null;
  return merged;
}

/**
 * Parse a single arg value from the contents of a function-call arg
 * slot. Tries (in order): quoted string with JS escapes, JSON literal,
 * raw trimmed text.
 *
 * @param {string} raw
 */
function parseArgValue(raw) {
  const s = raw.trim();
  if (s === '') return '';

  // Quoted string: respect ", ', and ` and interpret JS escapes.
  const q = s[0];
  if ((q === '"' || q === "'" || q === '`') && s[s.length - 1] === q && s.length >= 2) {
    const body = s.slice(1, -1);
    return unescapeJsString(body);
  }

  // JSON literal: number, boolean, null, array, object.
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }

  return s;
}

/**
 * Interpret JS-style backslash escapes inside an already-unquoted
 * string body. Handles \n, \r, \t, \\, \', \", \xNN, \uNNNN.
 * Unknown escapes pass through as the next char (matching JS's
 * `eval('"' + body + '"')` behavior on the common cases).
 *
 * @param {string} body
 */
function unescapeJsString(body) {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c !== '\\' || i === body.length - 1) {
      out += c;
      continue;
    }
    const next = body[i + 1];
    i += 1;
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case '0':
        out += '\0';
        break;
      case '\\':
        out += '\\';
        break;
      case "'":
        out += "'";
        break;
      case '"':
        out += '"';
        break;
      case '`':
        out += '`';
        break;
      case 'x': {
        const hex = body.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
        } else {
          out += next;
        }
        break;
      }
      case 'u': {
        if (body[i + 1] === '{') {
          const end = body.indexOf('}', i + 2);
          if (end > -1) {
            const hex = body.slice(i + 2, end);
            if (/^[0-9a-fA-F]+$/.test(hex)) {
              out += String.fromCodePoint(parseInt(hex, 16));
              i = end;
              break;
            }
          }
        }
        const hex = body.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += next;
        }
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}

/**
 * Pull simple `key=value` or `key: value` pairs out of a fragment of
 * text. Strips wrapping quotes. Returns null if no pairs found.
 *
 * @param {string} text
 */
function parseLooseArgs(text) {
  /** @type {Record<string, string>} */
  const out = {};
  if (typeof text !== 'string' || text === '') return null;

  // Find each `key:` / `key=` header, then slurp its value either as
  // a quoted string (respecting JS escapes) or as a bare run up to
  // the next top-level `,` / end. This is the kwarg path; the bare-
  // value branch deliberately stops at `,` and `)` but ONLY when not
  // inside a string or nested bracket, so `content="print(1)"`
  // captures the full `print(1)`.
  const headerRe = /([a-zA-Z][\w]*)\s*[:=]\s*/g;
  let m;
  while ((m = headerRe.exec(text)) !== null) {
    const key = m[1];
    let i = m.index + m[0].length;
    let value = '';
    if (i >= text.length) {
      out[key] = '';
      continue;
    }
    const first = text[i];
    if (first === '"' || first === "'" || first === '`') {
      // Quoted value — slurp to the matching closing quote,
      // honoring backslash escapes.
      const quote = first;
      let j = i + 1;
      let raw = '';
      let escape = false;
      while (j < text.length) {
        const ch = text[j];
        if (escape) {
          raw += ch;
          escape = false;
        } else if (ch === '\\') {
          raw += ch;
          escape = true;
        } else if (ch === quote) {
          break;
        } else {
          raw += ch;
        }
        j += 1;
      }
      value = unescapeJsString(raw);
      i = j + 1;
    } else {
      // Bare value — run to the next top-level comma or end. We
      // still bail on `\n` so YAML-ish blocks don't slurp the next
      // header.
      let depth = 0;
      let j = i;
      while (j < text.length) {
        const ch = text[j];
        if (ch === '(' || ch === '{' || ch === '[') depth += 1;
        else if (ch === ')' || ch === '}' || ch === ']') {
          if (depth === 0) break;
          depth -= 1;
        } else if ((ch === ',' || ch === '\n') && depth === 0) {
          break;
        }
        value += ch;
        j += 1;
      }
      value = value.trim();
      i = j;
    }
    out[key] = value;
    headerRe.lastIndex = i;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Collect `key: value` pairs from anywhere in the text, skipping keys
 * that obviously aren't args (the tool's own name, "tool", "name",
 * "function", etc.).
 *
 * @param {string} text
 * @param {string} toolName
 */
function collectLooseKeyValuePairs(text, toolName) {
  /** @type {Record<string, string>} */
  const out = {};
  const skip = new Set(['tool', 'name', 'tool_name', 'function', 'action', toolName]);
  const re = /(?:^|\n)\s*-?\s*([a-zA-Z][\w]*)\s*[:=]\s*["']?([^"'\n,]+?)["']?\s*(?=$|\n|,)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const value = m[2].trim();
    if (skip.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the index of the `(` that starts a call to `toolName` in
 * `text`, or -1 if there is no such call. Skips occurrences inside
 * string literals and skips `toolName` substrings that aren't
 * followed by `(` (e.g. mentions in prose).
 *
 * @param {string} text
 * @param {string} toolName
 */
function findCallStart(text, toolName) {
  if (!text || !toolName) return -1;
  const re = new RegExp(`\\b${escapeRegex(toolName)}\\b\\s*\\(`);
  const m = re.exec(text);
  if (!m) return -1;
  // Index of the `(`.
  return m.index + m[0].lastIndexOf('(');
}

/**
 * Given `text` and the index of an opening `(`, return the substring
 * inside the matching `)`. Tracks paren depth and ignores brackets
 * that occur inside JS string literals (single, double, or backtick).
 * Returns null if no matching close is found.
 *
 * @param {string} text
 * @param {number} openIdx  Index of the `(` to start from.
 */
function extractParenBalanced(text, openIdx) {
  if (text[openIdx] !== '(') return null;
  let depth = 0;
  let inStr = null;
  let escape = false;
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null;
}

/**
 * Parse a JS-ish object literal that JSON.parse rejected. Handles:
 *   - single-quoted strings → double-quoted
 *   - backtick-quoted strings (no interpolation) → double-quoted
 *   - unquoted object keys → quoted
 *   - trailing commas in objects/arrays
 *
 * Returns the parsed object on success, null on failure.
 *
 * Implementation: walk the input character-by-character, emitting
 * a JSON-safe string, then JSON.parse it. We deliberately do NOT
 * use Function() / eval here — we'd be running model-controlled
 * code, and the JSON-rewriter is enough for Hermes's emissions.
 *
 * @param {string} expr
 * @returns {any | null}
 */
function parseRelaxedObjectLiteral(expr) {
  if (typeof expr !== 'string') return null;
  const trimmed = expr.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  let out = '';
  let i = 0;
  const n = trimmed.length;

  while (i < n) {
    const ch = trimmed[i];

    // String literals: rewrite single-quoted and backtick strings to
    // valid JSON double-quoted strings. Preserve the contents,
    // re-escaping `"` and any literal newlines that would otherwise
    // break JSON.
    if (ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      let body = '';
      while (i < n) {
        const c = trimmed[i];
        if (c === '\\' && i + 1 < n) {
          // Pass JS escapes (including \n, \t, \', \", \\, \xNN, \uNNNN)
          // straight through — JSON understands the same set except
          // `\'` (which we convert to `'`) and `\` followed by an
          // unsupported char.
          const next = trimmed[i + 1];
          if (next === "'") {
            body += "'";
          } else {
            body += '\\' + next;
          }
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        // Unescaped chars that JSON disallows in strings: real
        // newlines, real tabs, real CRs, and unescaped `"`.
        if (c === '"') {
          body += '\\"';
        } else if (c === '\n') {
          body += '\\n';
        } else if (c === '\r') {
          body += '\\r';
        } else if (c === '\t') {
          body += '\\t';
        } else {
          body += c;
        }
        i += 1;
      }
      out += `"${body}"`;
      continue;
    }

    // Standard double-quoted string — pass through unchanged but skip
    // contents so we don't accidentally rewrite stuff inside.
    if (ch === '"') {
      out += ch;
      i += 1;
      while (i < n) {
        const c = trimmed[i];
        out += c;
        i += 1;
        if (c === '\\' && i < n) {
          out += trimmed[i];
          i += 1;
          continue;
        }
        if (c === '"') break;
      }
      continue;
    }

    // Trailing comma: peek ahead past whitespace; if next non-ws is
    // `}` or `]`, drop the comma.
    if (ch === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(trimmed[j])) j += 1;
      if (j < n && (trimmed[j] === '}' || trimmed[j] === ']')) {
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // Unquoted object key: a bare identifier followed (after optional
    // whitespace) by `:`. Quote it.
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(trimmed[j])) j += 1;
      const word = trimmed.slice(i, j);
      let k = j;
      while (k < n && /\s/.test(trimmed[k])) k += 1;
      if (k < n && trimmed[k] === ':') {
        out += `"${word}"`;
        i = j;
        continue;
      }
      // Bare literals (true / false / null) — pass through.
      out += word;
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }

  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Last-ditch app inference for the case where the model emitted prose
 * like "Sure, I opened Paint for you" instead of a real `launchApp`
 * tool call.
 *
 * Strategy: tokenize the user's text, then score each app by how many
 * of those tokens appear in the app's id (split on `-`), shortName, or
 * tags. We deliberately ignore the long-form `name` field because it
 * contains prose English ("Everything is Awesome", "Sad Trombone",
 * "Bad Apple") — matching those leaks generic words like "is",
 * "everything", "bad" into the token set and causes false launches
 * (e.g. "show me everything" → tries to open Awesome).
 *
 * We REQUIRE at least one matched token to come from the id itself,
 * not just from tags. Many apps share tags like "music" or "fun", and
 * matching only on tags is too loose — "list ~/Music" would otherwise
 * pick a random music-tagged app.
 *
 * Returns null when:
 *   - No app gets any id-token match (the user probably wasn't naming
 *     an app at all).
 *   - Multiple apps tie at the top even after the specificity
 *     tiebreaker. (Safer to let the model retry than to launch the
 *     wrong app.)
 *
 * @param {string} userText
 * @param {Array<object>} apps
 * @returns {{ id: string } | null}
 */
function inferLaunchAppFromText(userText, apps) {
  if (typeof userText !== 'string' || !userText.trim()) return null;
  if (!Array.isArray(apps) || apps.length === 0) return null;

  const userTokens = new Set(
    userText
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
  if (userTokens.size === 0) return null;

  /** @type {Array<{ app: any, score: number, specificity: number, matchedIdTokens: number }>} */
  const scored = [];
  for (const app of apps) {
    const id = String(/** @type {any} */ (app).id || '');
    if (!id) continue;
    const idTokens = id
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (idTokens.length === 0) continue;

    /** @type {Set<string>} */
    const appTokens = new Set(idTokens);
    const a = /** @type {any} */ (app);
    if (typeof a.shortName === 'string') {
      a.shortName
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .forEach((t) => appTokens.add(t));
    }
    if (Array.isArray(a.tags)) {
      for (const tag of a.tags) {
        if (typeof tag === 'string') appTokens.add(tag.toLowerCase());
      }
    }

    let score = 0;
    for (const t of userTokens) {
      if (appTokens.has(t)) score += 1;
    }
    if (score === 0) continue;
    const matchedIdTokens = idTokens.filter((t) => userTokens.has(t)).length;
    // Hard guard: every match must include at least one id-token, not
    // just tags. Without this, "list ~/Music" would tag-match every
    // music-tagged app and we'd flip a coin (or worse, pick one).
    if (matchedIdTokens === 0) continue;
    // Specificity = how many of the id-tokens were actually matched.
    // For "doom" against `doom` (1/1=1.0) vs `doom-mods` (1/2=0.5),
    // the simpler id wins. For "doom mods" against `doom-mods` (2/2=1.0)
    // vs `doom` (1/1=1.0), they tie on specificity but `doom-mods`
    // wins on absolute score (2 vs 1).
    const specificity = matchedIdTokens / idTokens.length;
    scored.push({ app, score, specificity, matchedIdTokens });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.specificity - a.specificity;
  });

  // Ambiguous tie at the top — don't guess.
  if (
    scored.length > 1 &&
    scored[0].score === scored[1].score &&
    scored[0].specificity === scored[1].specificity
  ) {
    console.warn('[chat:turn] launchApp inference tied — not synthesizing', {
      candidates: scored.slice(0, 3).map((s) => /** @type {any} */ (s.app).id)
    });
    return null;
  }

  return { id: /** @type {any} */ (scored[0].app).id };
}

/**
 * Test-only re-exports. These internal helpers are part of the
 * recovery contract for partial / pseudo tool calls; we pin their
 * behavior with unit tests so changes don't silently regress the
 * model-output parsing in production. Not intended for runtime
 * consumption by the app.
 */
export const __internals = {
  detectActionIntent,
  detectPartialToolCallAttempt,
  extractToolCallFromText,
  parseCallArgs,
  parsePositionalArgs,
  splitTopLevelArgs,
  parseLooseArgs,
  parseRelaxedObjectLiteral,
  extractParenBalanced,
  findCallStart,
  unescapeJsString
};
