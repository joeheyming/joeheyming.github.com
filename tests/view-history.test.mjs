import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function withPage(url, run) {
  const dom = new JSDOM('<!doctype html><body></body>', { url });
  const previous = { window: globalThis.window, history: globalThis.history };
  globalThis.window = dom.window;
  globalThis.history = dom.window.history;
  globalThis.History = dom.window.History;
  try {
    const mod = await import(pathToFileURL(join(root, 'shared/view-history.js')).href);
    await run(mod, dom.window);
  } finally {
    globalThis.window = previous.window;
    globalThis.history = previous.history;
    delete globalThis.History;
  }
}

test('pushView adds an entry that Back can leave', async () => {
  await withPage('http://localhost/read/', async ({ pushView, hasListBelow }, win) => {
    assert.equal(hasListBelow(), false);
    pushView({ book: '45-anne' });
    assert.equal(win.location.search, '?book=45-anne');
    assert.equal(hasListBelow(), true);
    assert.equal(win.history.length, 2);
  });
});

test('closeView goes Back when the list is below, else rewrites in place', async () => {
  await withPage('http://localhost/read/?book=45', async ({ closeView }, win) => {
    let shown = 0;
    closeView({ book: null }, () => shown++);
    assert.equal(shown, 1);
    assert.equal(win.location.search, '');
    assert.equal(win.history.length, 1);
  });

  await withPage('http://localhost/read/', async ({ closeView, pushView }, win) => {
    pushView({ book: '45' });
    let shown = 0;
    let backCalls = 0;
    win.history.back = () => backCalls++;
    closeView({ book: null }, () => shown++);
    assert.equal(backCalls, 1);
    assert.equal(shown, 0);
  });
});

test('replaceView keeps the list-below marker only when asked', async () => {
  await withPage('http://localhost/read/', async ({ pushView, replaceView, hasListBelow }) => {
    pushView({ book: '1' });
    replaceView({ book: '2' }, { open: true });
    assert.equal(hasListBelow(), true);
    replaceView({ book: '3' });
    assert.equal(hasListBelow(), false);
  });
});

test('prefers the analytics silent helpers so gtag sees no page_view', async () => {
  await withPage('http://localhost/listen/', async ({ pushView, replaceView }, win) => {
    const calls = [];
    win.pushHistorySilent = (state, url) => calls.push(['push', url]);
    win.replaceHistorySilent = (state, url) => calls.push(['replace', url]);
    pushView({ book: 'a' });
    replaceView({ book: 'b' });
    assert.deepEqual(calls, [
      ['push', '/listen/?book=a'],
      ['replace', '/listen/?book=b']
    ]);
  });
});
