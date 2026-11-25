// iPad Safari greys out a file when <input accept> names a type the system
// does not know. .swf and application/x-shockwave-flash are both unknown, so
// the Flash picker used to refuse every file, including a .zip of the game.

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appWindow, loadClassic } from './load-app-script.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PAGE = `<!doctype html>
  <header class="app-header" id="emu-header"><nav id="emu-breadcrumbs"></nav></header>
  <input type="file" id="romFileInput" accept=".swf,application/x-shockwave-flash" />
  <div id="boot">
    <div class="brand" id="brand"></div>
    <div id="boot-card"></div>
  </div>
  <div id="game-container"><div id="game"></div></div>`;

function le(n, width) {
  const out = new Uint8Array(width);
  for (let i = 0; i < width; i++) out[i] = (n >>> (8 * i)) & 0xff;
  return out;
}

function concat(parts) {
  const len = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** @param {{ name: string, data: Uint8Array, method?: number, flags?: number }[]} entries */
function zipOf(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = ascii(entry.name);
    const method = entry.method || 0;
    const flags = entry.flags || 0;
    const stored = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const compressed = stored instanceof Uint8Array ? stored : new Uint8Array(stored);
    const local = concat([
      le(0x04034b50, 4),
      le(20, 2),
      le(flags, 2),
      le(method, 2),
      le(0, 4),
      le(0, 4),
      le(compressed.length, 4),
      le(entry.data.length, 4),
      le(name.length, 2),
      le(0, 2),
      name,
      compressed
    ]);
    const central = concat([
      le(0x02014b50, 4),
      le(20, 2),
      le(20, 2),
      le(flags, 2),
      le(method, 2),
      le(0, 4),
      le(0, 4),
      le(compressed.length, 4),
      le(entry.data.length, 4),
      le(name.length, 2),
      le(0, 2),
      le(0, 2),
      le(0, 2),
      le(0, 2),
      le(0, 4),
      le(offset, 4),
      name
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = concat(centrals);
  const eocd = concat([
    le(0x06054b50, 4),
    le(0, 4),
    le(entries.length, 2),
    le(entries.length, 2),
    le(cd.length, 4),
    le(offset, 4),
    le(0, 2)
  ]);
  return concat([...locals, cd, eocd]);
}

function swf(size, sig) {
  const bytes = new Uint8Array(size);
  const mark = sig || 'FWS';
  bytes[0] = mark.charCodeAt(0);
  bytes[1] = mark.charCodeAt(1);
  bytes[2] = mark.charCodeAt(2);
  bytes[3] = 9;
  return bytes;
}

function bootFlash(window) {
  window.crossOriginIsolated = true;
  loadClassic(
    window,
    'emulator/consoles.js',
    'emulator/rom-acquire.js',
    'shared/breadcrumbs.js',
    'emulator/launch.js'
  );
  if (window.document.readyState === 'loading') {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
}

/** jsdom treats a Node Uint8Array as a plain object and stringifies it. */
function fileIn(window, bytes, name) {
  return new window.File([new window.Uint8Array(bytes)], name);
}

function setNavigator(window, ua, touch) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    get: () => ua
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: touch
  });
}

/**
 * jsdom's Blob stream and Node's DecompressionStream live in different
 * realms, so the page's inflate path gets a same-realm stand-in.
 * @param {import('jsdom').DOMWindow} window
 */
function installInflate(window) {
  window.ReadableStream = globalThis.ReadableStream;
  window.TransformStream = globalThis.TransformStream;
  const TS = globalThis.TransformStream;
  window.DecompressionStream = class {
    constructor(format) {
      if (format !== 'deflate-raw') throw new Error(format);
      const chunks = [];
      return new TS({
        transform(chunk) {
          chunks.push(Buffer.from(chunk));
        },
        flush(controller) {
          controller.enqueue(new Uint8Array(inflateRawSync(Buffer.concat(chunks))));
        }
      });
    }
  };
}

function bytesOf(window, blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

it('keeps the Flash picker on extensions and tells iPad Safari to show every file', () => {
  const html = readFileSync(path.join(ROOT, 'emulator/flash/index.html'), 'utf8');
  const consoles = readFileSync(path.join(ROOT, 'emulator/consoles.js'), 'utf8');
  assert.match(html, /accept="\.swf,\.zip"/);
  assert.doesNotMatch(html, /application\/x-shockwave-flash/);
  assert.match(consoles, /fileAccept:\s*'\.swf,\.zip'/);

  const desktop = appWindow(PAGE, { url: 'https://joeheyming.github.io/emulator/flash/' });
  setNavigator(desktop, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0);
  bootFlash(desktop);
  const input = desktop.document.getElementById('romFileInput');
  assert.equal(input.getAttribute('accept'), '.swf,.zip');
  assert.match(desktop.document.getElementById('loadRomBtn').textContent, /Load \.swf \/ \.zip/);

  const ipad = appWindow(PAGE, { url: 'https://joeheyming.github.io/emulator/flash/' });
  setNavigator(
    ipad,
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
    5
  );
  bootFlash(ipad);
  const ipadInput = ipad.document.getElementById('romFileInput');
  assert.equal(ipadInput.getAttribute('accept'), null);
  ipadInput.setAttribute('accept', '.swf,application/x-shockwave-flash');
  ipad.openEmulatorRomPicker();
  assert.equal(ipadInput.getAttribute('accept'), null);

  const desktopSite = appWindow(PAGE, { url: 'https://joeheyming.github.io/emulator/flash/' });
  setNavigator(
    desktopSite,
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
    5
  );
  bootFlash(desktopSite);
  assert.equal(desktopSite.document.getElementById('romFileInput').getAttribute('accept'), null);

  desktop.close();
  ipad.close();
  desktopSite.close();
});

it('plays a .swf iPad saved with no extension, and the largest .swf in a zip', async () => {
  const window = appWindow('<div id="game"></div>');
  installInflate(window);
  loadClassic(window, 'emulator/flash-file.js');
  const prepare = window.emulatorFlashFile.prepare;

  const loose = swf(16);
  const named = await prepare(fileIn(window, loose, 'download'), 'download');
  assert.equal(named.name, 'download.swf');
  assert.equal(String.fromCharCode(...(await bytesOf(window, named.file)).slice(0, 3)), 'FWS');

  const small = swf(8);
  const big = swf(32, 'CWS');
  const packed = zipOf([
    { name: 'loader.swf', data: small },
    { name: '__MACOSX/._loader.swf', data: swf(64) },
    { name: 'levels/Game.swf', data: big }
  ]);
  const fromZip = await prepare(fileIn(window, packed, 'pack.zip'), 'pack.zip');
  assert.equal(fromZip.name, 'Game.swf');
  assert.equal(String.fromCharCode(...(await bytesOf(window, fromZip.file)).slice(0, 3)), 'CWS');

  const deflated = zipOf([{ name: 'Offline.swf', data: swf(24), method: 8 }]);
  const fromDeflate = await prepare(fileIn(window, deflated, 'offline.zip'), 'offline.zip');
  assert.equal(fromDeflate.name, 'Offline.swf');
  assert.equal((await bytesOf(window, fromDeflate.file)).length, 24);

  await assert.rejects(
    () =>
      prepare(fileIn(window, zipOf([{ name: 'readme.txt', data: ascii('hi') }]), 'x.zip'), 'x.zip'),
    (err) => err.userMessage === 'That zip has no .swf in it.'
  );
  await assert.rejects(
    () => prepare(fileIn(window, ascii('hello'), 'notes.txt'), 'notes.txt'),
    (err) => err.userMessage === 'Load a .swf, or a .zip that contains one.'
  );
  await assert.rejects(
    () =>
      prepare(
        fileIn(window, zipOf([{ name: 'secret.swf', data: swf(12), flags: 1 }]), 'secret.zip'),
        'secret.zip'
      ),
    (err) => err.userMessage === 'That zip is password-protected. Load the .swf itself.'
  );

  const namedSwf = new window.Blob(['swf']);
  const passthrough = await prepare(namedSwf, 'Game.swf');
  assert.equal(passthrough.file, namedSwf);
  assert.equal(passthrough.name, 'Game.swf');
  window.close();
});

it('loads a zipped Flash game and leaves a file that is not Flash on the boot card', async () => {
  const window = appWindow(PAGE, { url: 'https://joeheyming.github.io/emulator/flash/' });
  window.crossOriginIsolated = true;
  installInflate(window);
  /** @type {Blob[]} */
  const blobs = [];
  window.URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return 'blob:rom';
  };
  window.URL.revokeObjectURL = () => {};
  window.RufflePlayer = {
    newest: () => ({
      createPlayer() {
        const el = window.document.createElement('div');
        el.ruffle = () => ({ load: async () => {} });
        return el;
      }
    })
  };
  bootFlash(window);

  const movie = swf(20);
  const packed = zipOf([{ name: 'levels/Big Game.swf', data: movie }]);
  await window.launchEmulator(fileIn(window, packed, 'saved.zip'), 'saved.zip', {
    tracked: true
  });
  assert.deepEqual(window.__loadedScripts, ['/emulator/flash-file.js', '/emulator/play.js']);
  assert.equal(blobs.length, 1);
  assert.equal(String.fromCharCode(...(await bytesOf(window, blobs[0])).slice(0, 3)), 'FWS');
  const current = window.document.querySelector('#emu-breadcrumbs .app-crumb--current');
  assert.equal(current.value || current.textContent, 'Big Game');

  const refused = appWindow(PAGE, { url: 'https://joeheyming.github.io/emulator/flash/' });
  refused.crossOriginIsolated = true;
  bootFlash(refused);
  await refused.launchEmulator(fileIn(refused, ascii('nope'), 'notes.txt'), 'notes.txt', {
    tracked: true
  });
  assert.match(refused.document.querySelector('.deeplink-error').textContent, /Load a \.swf/);
  assert.equal(
    refused.document.getElementById('game-container').classList.contains('visible'),
    false
  );
  assert.deepEqual(refused.__loadedScripts, ['/emulator/flash-file.js']);

  window.close();
  refused.close();
});
