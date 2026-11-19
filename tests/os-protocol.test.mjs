import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, 'shared/os-protocol.js'), 'utf8');

function loadApi() {
  const sandbox = { self: {}, top: {}, parent: null };
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  new Function('window', 'globalThis', SOURCE)(sandbox, sandbox);
  return sandbox;
}

test('request wraps a known action and rejects an unknown one', () => {
  const api = loadApi().HeymingOsProtocol;
  const message = api.request('save', { path: '/home/user/note.txt', content: 'hi' });
  assert.deepEqual(message, {
    type: 'iframe-message',
    message: { path: '/home/user/note.txt', content: 'hi', type: 'save' }
  });
  assert.throws(() => api.request('saveFile'), /Unknown Heyming OS action: saveFile/);
});

test('a payload cannot rename the action', () => {
  const api = loadApi().HeymingOsProtocol;
  const message = api.request('launch', { type: 'save', app: 'paint' });
  assert.equal(message.message.type, 'launch');
  assert.equal(message.message.app, 'paint');
});

test('every catalog action is sendable, including the wrapped requests', () => {
  const api = loadApi().HeymingOsProtocol;
  const actions = [
    ...Object.values(api.IframeActions),
    api.MessageTypes.REQUEST_PENDING_FILE,
    api.MessageTypes.OPEN_FILE_DIALOG
  ];
  for (const action of actions) {
    assert.equal(api.request(action).message.type, action);
  }
});

test('routeRequest distinguishes handled, ignored, and unknown', () => {
  const api = loadApi().HeymingOsProtocol;
  const seen = [];
  const handlers = {
    save(payload, source) {
      seen.push([payload.path, source]);
    }
  };
  const source = { name: 'iframe' };

  assert.equal(api.routeRequest(api.request('save', { path: '/a' }), handlers, source), 'handled');
  assert.deepEqual(seen, [['/a', source]]);

  assert.equal(
    api.routeRequest({ type: 'requestPendingFile', app: 'paint' }, handlers, source),
    'ignored'
  );
  assert.equal(api.routeRequest(null, handlers), 'ignored');
  assert.equal(
    api.routeRequest({ type: 'iframe-message', message: { type: 'saveFile' } }, handlers),
    'unknown'
  );
  assert.equal(api.routeRequest(api.request('launch', { app: 'paint' }), handlers), 'unknown');
});

test('sendToOs posts only from an embedded OS window', () => {
  const standalone = loadApi();
  assert.equal(standalone.HeymingOsProtocol.sendToOs('launch', { app: 'paint' }), false);

  const embedded = loadApi();
  embedded.self = {};
  embedded.top = {};
  const posted = [];
  embedded.parent = {
    HeymingOS: {},
    postMessage(data) {
      posted.push(data);
    }
  };
  assert.equal(embedded.HeymingOsProtocol.sendToOs('launch', { app: 'paint' }), true);
  assert.equal(posted[0].message.type, 'launch');

  embedded.parent = {
    get HeymingOS() {
      throw new Error('cross-origin');
    }
  };
  assert.equal(embedded.HeymingOsProtocol.sendToOs('launch', { app: 'paint' }), false);
  assert.throws(() => embedded.HeymingOsProtocol.sendToOs('saveFile'), /Unknown Heyming OS action/);
});

test('the OS page loads the protocol before the module, and constants.js no longer owns the names', () => {
  const html = readFileSync(path.join(ROOT, 'os/index.html'), 'utf8');
  const protocolAt = html.indexOf('/shared/os-protocol.js');
  const moduleAt = html.indexOf('os/index.js');
  assert.ok(protocolAt !== -1 && protocolAt < moduleAt);
  const constants = readFileSync(path.join(ROOT, 'os/constants.js'), 'utf8');
  assert.equal(constants.includes('requestPendingFile'), false);
  assert.equal(constants.includes('iframe-message'), false);
});

test('the bridge routes a wrapped save and warns on a drifted action', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost/os/',
    runScripts: 'outside-only'
  });
  const previous = globalThis.window;
  globalThis.window = dom.window;
  new Function('window', 'globalThis', SOURCE)(dom.window, dom.window);

  try {
    const { bindIframeMessageListener } = await import('../os/IframeMessageBridge.js');
    const saved = [];
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    const unsubscribe = bindIframeMessageListener({
      saveFileToFilesystem(filePath, content, fileName) {
        saved.push([filePath, content, fileName]);
      }
    });
    try {
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          data: dom.window.HeymingOsProtocol.request('save', {
            path: '/home/user/note.txt',
            content: 'hello',
            fileName: 'note.txt'
          })
        })
      );
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          data: { type: 'iframe-message', message: { type: 'saveFile' } }
        })
      );
    } finally {
      console.warn = originalWarn;
      unsubscribe();
    }

    assert.deepEqual(saved, [['/home/user/note.txt', 'hello', 'note.txt']]);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][1]), /saveFile/);
  } finally {
    globalThis.window = previous;
    dom.window.close();
  }
});
