import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { createOSEmbed } from '../os-embed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOL = readFileSync(path.join(ROOT, 'shared/os-protocol.js'), 'utf8');

function protocol() {
  const sandbox = {};
  new Function('window', 'globalThis', PROTOCOL)(sandbox, sandbox);
  return sandbox.HeymingOsProtocol;
}

function iframeWindow() {
  const dom = new JSDOM('<!doctype html><iframe id="app"></iframe>', {
    url: 'http://localhost/os/',
    runScripts: 'outside-only'
  });
  const child = dom.window.document.getElementById('app').contentWindow;
  const posted = [];
  child.parent.addEventListener('message', (event) => posted.push(event.data));
  return { dom, child, posted };
}

function postedMessages() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('an embedded app asks for its pending file with a wrapped request', async () => {
  const { dom, child, posted } = iframeWindow();
  child.parent.HeymingOS = {};
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = child;
  globalThis.document = child.document;
  try {
    const opened = [];
    createOSEmbed({
      app: 'paint',
      onOpenFile(file) {
        opened.push(file);
      }
    });
    await postedMessages();
    assert.equal(posted.length, 1);
    assert.deepEqual(posted[0], {
      type: 'iframe-message',
      message: { type: 'requestPendingFile', app: 'paint' }
    });

    const api = protocol();
    let replied = null;
    const source = {
      postMessage(data) {
        replied = data;
      }
    };
    const result = api.routeRequest(
      posted[0],
      {
        requestPendingFile(payload, replyTo) {
          replyTo.postMessage({
            type: 'openFile',
            content: 'pixels',
            fileName: 'dot.png'
          });
          assert.equal(payload.app, 'paint');
        }
      },
      source
    );
    assert.equal(result, 'handled');
    assert.deepEqual(replied, { type: 'openFile', content: 'pixels', fileName: 'dot.png' });

    child.dispatchEvent(new child.MessageEvent('message', { data: replied }));
    assert.deepEqual(opened, [{ content: 'pixels', fileName: 'dot.png', mimeType: undefined }]);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test('a standalone app does not ask the host for a pending file', () => {
  const dom = new JSDOM('<!doctype html>', {
    url: 'http://localhost/paint/',
    runScripts: 'outside-only'
  });
  const posted = [];
  dom.window.addEventListener('message', (event) => posted.push(event.data));
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    const embed = createOSEmbed({ app: 'paint' });
    assert.equal(embed.isEmbedded, false);
    assert.deepEqual(posted, []);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test("File Manager's change notice refreshes the desktop", async () => {
  const { dom, child, posted } = iframeWindow();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = child;
  globalThis.document = child.document;
  try {
    const { applyFileManagerOps } = await import('../filemanager/filemanager-ops.js');
    class FileManager {}
    applyFileManagerOps(FileManager);
    const manager = new FileManager();
    manager.notifyOSFileChange();
    await postedMessages();
    assert.deepEqual(posted, [{ type: 'iframe-message', message: { type: 'filesystemChanged' } }]);

    let refreshed = 0;
    const result = protocol().routeRequest(posted[0], {
      filesystemChanged() {
        refreshed += 1;
      }
    });
    assert.equal(result, 'handled');
    assert.equal(refreshed, 1);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    dom.window.close();
  }
});
