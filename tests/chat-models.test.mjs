import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('chat model catalog', () => {
  it('defaults to Llama 3.2 3B and keeps Hermes 8B as a quality option', async () => {
    const { CHAT_MODELS, WEBLLM_DEFAULT_MODEL, WEBLLM_MODULE_URL, getChatModel } = await import(
      '../chat/webllm-adapter.js'
    );
    assert.equal(WEBLLM_DEFAULT_MODEL, 'Llama-3.2-3B-Instruct-q4f16_1-MLC');
    assert.match(WEBLLM_MODULE_URL, /web-llm@0\.2\.84/);
    assert.ok(CHAT_MODELS['Llama-3.2-3B-Instruct-q4f16_1-MLC']);
    assert.ok(CHAT_MODELS['Hermes-3-Llama-3.1-8B-q4f16_1-MLC']);
    assert.equal(getChatModel(WEBLLM_DEFAULT_MODEL).lowResource, true);
    assert.equal(getChatModel('missing-id').id, WEBLLM_DEFAULT_MODEL);
  });

  it('exposes a picker and does not claim the chat can launch apps', () => {
    const html = readFileSync(path.join(ROOT, 'chat/index.html'), 'utf8');
    assert.match(html, /id="chat-model"/);
    assert.match(html, /Llama-3\.2-3B-Instruct-q4f16_1-MLC/);
    assert.match(html, /Hermes-3-Llama-3\.1-8B-q4f16_1-MLC/);
    assert.doesNotMatch(html, /can launch apps/);
    assert.match(html, /name="robots" content="index, follow"/);
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

  it('keeps the legacy Hermes install flag separate from Llama 3.2 3B', async () => {
    const { hasInstalledModel, markModelInstalled, loadSelectedModel, saveSelectedModel } =
      await import('../chat/storage.js');
    globalThis.localStorage.setItem('heyming.chat.modelInstalled.v2.hermes3-8b', '1');
    assert.equal(hasInstalledModel('Hermes-3-Llama-3.1-8B-q4f16_1-MLC'), true);
    assert.equal(hasInstalledModel('Llama-3.2-3B-Instruct-q4f16_1-MLC'), false);

    markModelInstalled('Llama-3.2-3B-Instruct-q4f16_1-MLC');
    assert.equal(hasInstalledModel('Llama-3.2-3B-Instruct-q4f16_1-MLC'), true);

    assert.equal(loadSelectedModel(), null);
    saveSelectedModel('Hermes-3-Llama-3.1-8B-q4f16_1-MLC');
    assert.equal(loadSelectedModel(), 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC');
  });
});
