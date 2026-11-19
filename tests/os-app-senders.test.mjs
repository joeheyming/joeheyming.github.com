import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOL = readFileSync(path.join(ROOT, 'shared/os-protocol.js'), 'utf8');

const PAGES = [
  {
    html: 'media-player/index.html',
    entry: 'media-player.js',
    sources: ['media-player/media-player.js']
  },
  { html: 'surf/index.html', entry: 'surf.js', sources: ['surf/surf.js'] },
  {
    html: 'image-viewer/index.html',
    entry: 'image-viewer.js',
    sources: ['image-viewer/image-viewer.js']
  },
  {
    html: 'model-viewer/index.html',
    entry: 'model-viewer.js',
    sources: ['model-viewer/model-viewer.js']
  },
  {
    html: 'code-ide/index.html',
    entry: 'app.js',
    sources: ['code-ide/app.js', 'code-ide/fs-os.js']
  },
  { html: 'settings/index.html', entry: 'index.js', sources: ['settings/index.js'] },
  {
    html: 'terminal/index.html',
    entry: 'main.js',
    sources: ['terminal/commands/system/launch.js']
  }
];

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start !== -1, name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

test('app pages load the protocol and stop typing the wrapper name', () => {
  for (const page of PAGES) {
    const html = read(page.html);
    const protocolAt = html.indexOf('src="/shared/os-protocol.js"');
    const entryAt = html.indexOf(`src="${page.entry}"`);
    assert.ok(protocolAt !== -1, page.html);
    assert.ok(entryAt !== -1, page.entry);
    assert.ok(protocolAt < entryAt, page.html);
    for (const source of page.sources) {
      const text = read(source);
      assert.equal(text.includes('iframe-message'), false, source);
      assert.match(
        text,
        /HeymingOsProtocol\.sendToOs|api\.sendToOs|osProtocol\(\)\.sendToOs/,
        source
      );
    }
  }
});

test('the app send helpers post a wrapped catalog action', () => {
  const dom = new JSDOM('<!doctype html><iframe id="app"></iframe>', {
    url: 'http://localhost/os/',
    runScripts: 'outside-only'
  });
  const child = dom.window.document.getElementById('app').contentWindow;
  new Function('window', 'globalThis', PROTOCOL)(child, child);
  child.parent.HeymingOS = {};
  const posted = [];
  child.parent.addEventListener('message', (event) => posted.push(event.data));
  const previousWindow = globalThis.window;
  globalThis.window = child;
  try {
    const send = new Function(
      'window',
      `${extractFunction(
        read('media-player/media-player.js'),
        'postOsIframeMessage'
      )}\nreturn postOsIframeMessage;`
    )(child);
    send({ type: 'requestPendingFile', app: 'media-player' });

    const settings = read('settings/index.js');
    const post = new Function(
      'window',
      `${extractFunction(settings, 'osProtocol')}\n${extractFunction(
        settings,
        'post'
      )}\nreturn post;`
    )(child);
    post(child.HeymingOsProtocol.IframeActions.SET_OS_PREFS, { patch: { theme: 'dark' } });
  } finally {
    globalThis.window = previousWindow;
  }

  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    assert.deepEqual(posted, [
      {
        type: 'iframe-message',
        message: { type: 'requestPendingFile', app: 'media-player' }
      },
      {
        type: 'iframe-message',
        message: { type: 'setOsPrefs', patch: { theme: 'dark' } }
      }
    ]);
    dom.window.close();
  });
});
