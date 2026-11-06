import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QWEN = 'Qwen3-4B-q4f16_1-MLC';

describe('chat model catalog', () => {
  it('uses Qwen3 4B with thinking disabled and no model picker', async () => {
    const {
      CHAT_MODELS,
      WEBLLM_DEFAULT_MODEL,
      WEBLLM_MODULE_URL,
      getChatModel,
      buildCompletionBody
    } = await import('../chat/webllm-adapter.js');
    assert.equal(WEBLLM_DEFAULT_MODEL, QWEN);
    assert.match(WEBLLM_MODULE_URL, /web-llm@0\.2\.84/);
    assert.deepEqual(Object.keys(CHAT_MODELS), [QWEN]);
    assert.equal(getChatModel(WEBLLM_DEFAULT_MODEL).lowResource, true);
    assert.equal(getChatModel(WEBLLM_DEFAULT_MODEL).disableThinking, true);
    assert.equal(getChatModel('missing-id').id, WEBLLM_DEFAULT_MODEL);
    assert.deepEqual(
      buildCompletionBody(QWEN, { messages: [{ role: 'user', content: 'hi' }] }).extra_body,
      { enable_thinking: false }
    );

    const html = readFileSync(path.join(ROOT, 'chat/index.html'), 'utf8');
    assert.doesNotMatch(html, /id="chat-model"/);
    assert.doesNotMatch(html, /Llama-3\.2-3B/);
    assert.doesNotMatch(html, /Hermes-3-Llama/);
    assert.match(html, /Qwen3 4B/);
    assert.match(html, /name="robots" content="index, follow"/);
    assert.doesNotMatch(html, /can launch apps/);
  });

  it('strips think blocks, including a tag split across chunks', async () => {
    const { createThinkFilter } = await import('../chat/webllm-adapter.js');
    const filter = createThinkFilter();
    assert.equal(filter.push('Hello '), 'Hello ');
    assert.equal(filter.push('<thi'), '');
    assert.equal(filter.push('nk>secret</thi'), '');
    assert.equal(filter.push('nk> there'), ' there');
    assert.equal(filter.flush(), '');

    const whole = createThinkFilter();
    assert.equal(whole.push('<think>\n\n</think>\n\nAnswer.'), 'Answer.');
    assert.equal(whole.flush(), '');
  });
});

describe('chat storage model flags', () => {
  beforeEach(() => {
    const { window } = new JSDOM('', { url: 'https://joeheyming.github.io/chat/' });
    Object.defineProperty(globalThis, 'localStorage', {
      value: window.localStorage,
      configurable: true
    });
    globalThis.localStorage.clear();
  });

  it('does not treat a legacy Hermes install as Qwen3', async () => {
    const { hasInstalledModel, markModelInstalled } = await import('../chat/storage.js');
    globalThis.localStorage.setItem('heyming.chat.modelInstalled.v2.hermes3-8b', '1');
    assert.equal(hasInstalledModel('Hermes-3-Llama-3.1-8B-q4f16_1-MLC'), true);
    assert.equal(hasInstalledModel(QWEN), false);

    markModelInstalled(QWEN);
    assert.equal(hasInstalledModel(QWEN), true);
  });
});
