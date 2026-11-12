// The play path (emulator/play.js) loads only once a game is chosen, and
// launchEmulator hands it the ROM. Flash is the case jsdom can run end to
// end: it needs play.js alone, with Ruffle supplied by the page.

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { appWindow, loadClassic } from './load-app-script.mjs';

const PAGE = `<!doctype html>
  <div id="emu-header"></div>
  <div id="boot"><div id="boot-card"></div></div>
  <div id="game-container"><div id="game"></div></div>`;

it('starts a Flash game through the lazily loaded play path', async () => {
  const window = appWindow(PAGE, { url: 'https://joeheyming.github.io/emulator/flash/' });
  window.crossOriginIsolated = true;
  /** @type {string[]} */
  const loadedUrls = [];
  window.RufflePlayer = {
    newest: () => ({
      createPlayer() {
        const el = window.document.createElement('div');
        el.ruffle = () => ({ load: async (url) => loadedUrls.push(url) });
        return el;
      }
    })
  };
  window.URL.createObjectURL = () => 'blob:rom';
  loadClassic(window, 'emulator/consoles.js', 'emulator/rom-acquire.js', 'emulator/launch.js');
  assert.equal(window.emulatorPlay, undefined, 'play.js is not on the first screen');

  await window.launchEmulator(new window.Blob(['swf']), 'Game.swf', { tracked: true });

  assert.deepEqual(window.__loadedScripts, ['/emulator/play.js']);
  assert.equal(typeof window.emulatorPlay.play, 'function');
  assert.ok(window.document.getElementById('boot').classList.contains('hidden'));
  assert.ok(window.document.getElementById('game-container').classList.contains('visible'));
  assert.ok(window.document.getElementById('emu-game-list-btn'), 'play chrome mounted');
  assert.deepEqual(loadedUrls, ['blob:rom']);
  window.close();
});
