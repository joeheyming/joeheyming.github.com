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

  // Attachments are content for the model to read, not a request for a
  // tool call — "summarize this PDF" should land as plain text. We
  // explicitly suppress action-intent detection when an attachment is
  // present so e.g. "summarize/read/list this" don't force a doomed
  // tool_choice: 'required' against tools that can't analyze the doc.
  const intent = attachments.length > 0 ? false : detectActionIntent(userText);
  console.log('[chat:turn] start', {
    userText,
    actionIntentDetected: intent,
    attachmentCount: attachments.length,
    embedded: !!toolCtx.embed?.isEmbedded
  });

  // Refresh / install the system prompt at the head of history. We
  // rewrite it every turn so "current time" and the app catalog stay
  // accurate without having to re-load the conversation. The catalog
  // fetch is cached by toolCtx.appsRegistry, so this is a near-free
  // await on the second turn onward.
  const apps = await safeFetchApps(toolCtx);
  installSystemPrompt(history, !!toolCtx.embed?.isEmbedded, apps, getHome());

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

  const tools = getToolDefinitions();
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    if (signal.aborted) {
      return { aborted: true, iterations };
    }
    iterations += 1;

    opts.onAssistantMessageStart?.();

    /** @type {{ content: string, toolCalls: Array<{id: string, name: string, arguments: string}>, finishReason: string }} */
    let result;
    // Only force tool calls on the first iteration. Subsequent iterations
    // need to let the model respond in plain text (to summarize a tool
    // result) — otherwise we'd loop until MAX_TOOL_ITERATIONS.
    const forceToolCall = iterations === 1 && intent;
    const toolChoice = forceToolCall ? 'required' : 'auto';
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
      result = await webllmChat({
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
      let extracted = extractToolCallFromText(result.content, knownNames);

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
 * @param {boolean} embedded
 * @param {Array<object>} apps
 */
function installSystemPrompt(history, embedded, apps, home) {
  const fresh = buildSystemPrompt({ now: new Date(), embedded, apps, home });
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
function detectActionIntent(userText) {
  if (typeof userText !== 'string' || !userText) return false;
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
 * @param {string[]} knownTools
 * @returns {{ name: string, arguments: string } | null}
 */
function extractToolCallFromText(text, knownTools) {
  if (!text || !knownTools || knownTools.length === 0) return null;
  const knownSet = new Set(knownTools);

  // 1) <tool_call>{...}</tool_call> (Hermes-3 native).
  const xml = text.match(/<tool_call>\s*([\s\S]+?)\s*<\/tool_call>/i);
  if (xml) {
    const fromObj = toolFromJsonString(xml[1], knownSet);
    if (fromObj) return fromObj;
  }

  // 2) Whole reply is JSON.
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const fromObj = toolFromJsonString(trimmed, knownSet);
    if (fromObj) return fromObj;
  }

  // 3) Function-call literal: `toolName(...)`.
  for (const name of knownTools) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\s*\\(\\s*([\\s\\S]*?)\\s*\\)`);
    const m = text.match(re);
    if (!m) continue;
    const argText = m[1];
    if (!argText) {
      return { name, arguments: '{}' };
    }
    // 3a) JSON-shaped args.
    if (argText.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(argText);
        return { name, arguments: JSON.stringify(parsed) };
      } catch {
        /* fall through to loose parse */
      }
    }
    // 3b) Loose `key=value` / `key: value` / single quoted-value forms.
    const loose = parseLooseArgs(argText);
    if (loose) return { name, arguments: JSON.stringify(loose) };
    const singleQuoted = argText.match(/^["']([^"']+)["']$/);
    if (singleQuoted) {
      // We don't know which param it maps to. Use the most common
      // single-arg name for our tool surface.
      const fallbackKey =
        name === 'launchApp'
          ? 'appId'
          : name === 'listFiles' || name === 'readFile'
          ? 'path'
          : name === 'webFetch'
          ? 'url'
          : name === 'notify'
          ? 'message'
          : 'value';
      return { name, arguments: JSON.stringify({ [fallbackKey]: singleQuoted[1] }) };
    }
  }

  // 4) Mention of a known tool + loose `key: value` lines anywhere in
  //    the body (the bullet-listing case we saw in the logs).
  for (const name of knownTools) {
    if (!new RegExp(`\\b${escapeRegex(name)}\\b`).test(text)) continue;
    const args = collectLooseKeyValuePairs(text, name);
    if (args && Object.keys(args).length > 0) {
      return { name, arguments: JSON.stringify(args) };
    }
  }

  return null;
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
 * Pull simple `key=value` or `key: value` pairs out of a fragment of
 * text. Strips wrapping quotes. Returns null if no pairs found.
 *
 * @param {string} text
 */
function parseLooseArgs(text) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /([a-zA-Z][\w]*)\s*[:=]\s*["']?([^,"'\n)]+?)["']?(?=\s*[,;)\n]|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = m[2].trim();
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
