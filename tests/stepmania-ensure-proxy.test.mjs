import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

test('ensureProxy injects /proxy.js once and retries after a failed load', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://joeheyming.github.io/stepmania/'
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;

  const { ensureProxy } = await import('../stepmania/js/ensureProxy.js');

  const failed = ensureProxy();
  const first = document.querySelector('script');
  assert.equal(first.getAttribute('src'), '/proxy.js');
  first.onerror();
  await assert.rejects(failed, /did not load/);

  const loaded = ensureProxy();
  const scripts = document.querySelectorAll('script');
  assert.equal(scripts.length, 2);
  window.proxyService = { ready: true };
  scripts[1].onload();
  await loaded;

  await ensureProxy();
  assert.equal(document.querySelectorAll('script').length, 2);

  dom.window.close();
});
