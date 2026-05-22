// Integration test for the retry-on-tool-error behavior in runChatTurn.
//
// Setup: stub `engine` (the WebLLM adapter) with a scripted sequence
// of responses + a stub `toolCtx` with an in-memory fs. Verify that
// when iteration 1's createFile returns {ok:false}, the loop:
//   (a) injects a system reminder that includes the error text,
//   (b) calls the engine with tool_choice='required' on iteration 2,
//   (c) accepts the model's corrected createFile call and dispatches it.
//
// Without the retry-on-error fix, iteration 2 would go to
// tool_choice='auto' and the model could end the turn with prose
// ("Apologies for the confusion…") leaving the user with nothing.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runChatTurn } from '../chat/chat-client.js';

/**
 * Build a minimal toolCtx for a Code-IDE-style standalone session.
 */
function makeToolCtx() {
  const store = new Map();
  return {
    host: 'code-ide',
    toolNames: ['createFile', 'readFile', 'listFiles', 'applyEdit'],
    workspaceRoot: () => '/',
    embed: { isEmbedded: false },
    notify() {},
    async fs() {
      return {
        async getItem(p) {
          return store.get(p) || null;
        },
        async createFile(p, c) {
          if (store.has(p)) throw new Error('exists');
          store.set(p, { type: 'file', path: p, content: c });
        },
        async listFiles() {
          return Array.from(store.values());
        },
        async getItems() {
          return Array.from(store.values());
        }
      };
    },
    activeFile() {
      return null;
    },
    async projectTree() {
      return '/\n';
    },
    appsRegistry() {
      return [];
    },
    _store: store
  };
}

/**
 * Build a scripted engine that returns each `responses[i]` in order
 * for successive calls. Each response is `{content, toolCalls, finishReason}`.
 * Also records every call's `toolChoice` so the test can assert on it.
 */
function makeScriptedEngine(responses) {
  const calls = [];
  let idx = 0;
  return {
    engine: async ({ messages, toolChoice }) => {
      const i = idx;
      idx += 1;
      calls.push({ index: i, toolChoice, messageCount: messages.length });
      if (i >= responses.length) {
        throw new Error(`scripted engine exhausted at call ${i}; only ${responses.length} scripted`);
      }
      return responses[i];
    },
    calls
  };
}

describe('runChatTurn — retry-on-tool-error', () => {
  it('forces tool_choice=required and injects an error-reminder system message after a placeholder rejection', async () => {
    const { engine, calls } = makeScriptedEngine([
      // Iteration 1: emit a real tool call with a placeholder path —
      // createFile.execute() will reject this with the placeholder
      // error message, returning {ok:false, error: "Path /path/to/x..."}
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'createFile',
            arguments: JSON.stringify({
              path: '/path/to/hello.sh',
              content: '#!/bin/bash\necho hi\n'
            })
          }
        ],
        finishReason: 'tool_calls'
      },
      // Iteration 2 (forced retry): emit a CORRECTED call with a real
      // path. This should succeed and end the turn.
      {
        content: '',
        toolCalls: [
          {
            id: 'call_2',
            name: 'createFile',
            arguments: JSON.stringify({
              path: '/hello.sh',
              content: '#!/bin/bash\necho hi\n'
            })
          }
        ],
        finishReason: 'tool_calls'
      },
      // Iteration 3: summarize without tool calls — turn ends.
      { content: 'Created /hello.sh.', toolCalls: [], finishReason: 'stop' }
    ]);

    const history = [];
    const controller = new AbortController();
    const toolEvents = [];

    const result = await runChatTurn({
      history,
      userText: "let's make a shell script that prints hello world",
      toolCtx: makeToolCtx(),
      signal: controller.signal,
      engine,
      onToolEvent: (e) => toolEvents.push(e)
    });

    assert.equal(result.aborted, false);
    assert.equal(calls.length, 3, 'engine should be called 3 times (initial + retry + summary)');

    // Iteration 1: action intent detected → forced.
    assert.equal(calls[0].toolChoice, 'required', 'iteration 1 should force tool_choice');
    // Iteration 2: WAS the bug — used to drop to 'auto'. Now must be 'required'.
    assert.equal(
      calls[1].toolChoice,
      'required',
      'iteration 2 should ALSO force tool_choice because iteration 1 errored'
    );
    // Iteration 3: tool succeeded → back to 'auto' so model can summarize.
    assert.equal(
      calls[2].toolChoice,
      'auto',
      'iteration 3 should drop to auto so the model can summarize the successful tool result'
    );

    // The system reminder injected between iterations must reach the
    // model: messageCount for iteration 2 should be higher than for
    // iteration 1, and history should contain a system message that
    // mentions the literal placeholder error text from tools.js.
    const errorReminders = history.filter(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes('FAILED') &&
        m.content.includes('createFile')
    );
    assert.equal(
      errorReminders.length,
      1,
      'exactly one error-retry reminder should be in history'
    );
    assert.match(errorReminders[0].content, /placeholder/, 'reminder must include the tool error');
    assert.match(
      errorReminders[0].content,
      /Do not apologize/,
      'reminder must tell the model not to apologize'
    );

    // The successful retry call's result should also be in history.
    const successToolMsgs = history.filter(
      (m) =>
        m.role === 'tool' &&
        m.name === 'createFile' &&
        typeof m.content === 'string' &&
        m.content.includes('"ok":true')
    );
    assert.equal(successToolMsgs.length, 1, 'the corrected createFile must succeed');

    // Tool events should reflect 1 failed + 1 completed createFile.
    const dispatchedNames = toolEvents
      .filter((e) => e.name === 'createFile')
      .map((e) => e.phase);
    assert.deepEqual(dispatchedNames, ['started', 'completed', 'started', 'completed']);
  });

  it('caps retries: after MAX_TOOL_ERROR_RETRIES failures, lets the turn end gracefully', async () => {
    // Three consecutive placeholder failures, then a prose summary.
    // Use distinct paths that ALL trip the placeholder regex (the
    // basename must not be a real filename — `/path/to/...` pattern
    // qualifies regardless of what follows).
    const badArgs = (p) => JSON.stringify({ path: p, content: 'x' });
    const { engine, calls } = makeScriptedEngine([
      { content: '', toolCalls: [{ id: '1', name: 'createFile', arguments: badArgs('/path/to/a.sh') }], finishReason: 'tool_calls' },
      { content: '', toolCalls: [{ id: '2', name: 'createFile', arguments: badArgs('/path/to/b.sh') }], finishReason: 'tool_calls' },
      { content: '', toolCalls: [{ id: '3', name: 'createFile', arguments: badArgs('/path/to/c.sh') }], finishReason: 'tool_calls' },
      { content: "I'm having trouble.", toolCalls: [], finishReason: 'stop' }
    ]);

    const history = [];
    await runChatTurn({
      history,
      userText: 'make a file',
      toolCtx: makeToolCtx(),
      signal: new AbortController().signal,
      engine,
      onToolEvent: () => {}
    });

    // After 2 retries the loop drops back to 'auto' so we don't hammer
    // the model in a forced-retry loop.
    assert.equal(calls[0].toolChoice, 'required', 'iter 1 forced');
    assert.equal(calls[1].toolChoice, 'required', 'iter 2 (1st retry) forced');
    assert.equal(calls[2].toolChoice, 'required', 'iter 3 (2nd retry) forced');
    assert.equal(calls[3].toolChoice, 'auto', 'iter 4 falls back to auto after retry cap');
  });

  it('does NOT force-retry when the tool succeeded', async () => {
    const { engine, calls } = makeScriptedEngine([
      {
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'createFile',
            arguments: JSON.stringify({ path: '/ok.txt', content: 'hi\n' })
          }
        ],
        finishReason: 'tool_calls'
      },
      { content: 'Done.', toolCalls: [], finishReason: 'stop' }
    ]);

    await runChatTurn({
      history: [],
      userText: 'make ok.txt',
      toolCtx: makeToolCtx(),
      signal: new AbortController().signal,
      engine,
      onToolEvent: () => {}
    });

    assert.equal(calls[0].toolChoice, 'required');
    assert.equal(calls[1].toolChoice, 'auto', 'iter 2 must be auto because iter 1 succeeded');
  });
});
