// The play path (emulator/play.js) loads only once a game is chosen, and
// launchEmulator hands it the ROM. Flash is the case jsdom can run end to
// end: it needs play.js alone, with Ruffle supplied by the page.

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { appWindow, loadClassic } from './load-app-script.mjs';

const PAGE = `<!doctype html>
  <header id="emu-header"><nav id="emu-breadcrumbs"></nav></header>
  <div id="boot"><div id="boot-card"></div></div>
  <div id="game-container"><div id="game"></div></div>`;

/**
 * @param {import('jsdom').DOMWindow} window
 */
function stubRuffle(window) {
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
  return loadedUrls;
}

it('starts a Flash game through the lazily loaded play path', async () => {
  const window = appWindow(PAGE, { url: 'https://joeheyming.github.io/emulator/flash/' });
  window.crossOriginIsolated = true;
  const loadedUrls = stubRuffle(window);
  loadClassic(
    window,
    'emulator/consoles.js',
    'emulator/rom-acquire.js',
    'shared/breadcrumbs.js',
    'emulator/launch.js'
  );
  assert.equal(window.emulatorPlay, undefined, 'play.js is not on the first screen');

  await window.launchEmulator(new window.Blob(['swf']), 'Game.swf', { tracked: true });

  assert.deepEqual(window.__loadedScripts, ['/emulator/play.js']);
  assert.equal(typeof window.emulatorPlay.play, 'function');
  assert.ok(window.document.getElementById('boot').classList.contains('hidden'));
  assert.ok(window.document.getElementById('game-container').classList.contains('visible'));
  assert.equal(window.document.getElementById('emu-game-list-btn'), null);
  const nav = window.document.getElementById('emu-breadcrumbs');
  const current = nav.querySelector('.app-crumb--current');
  assert.equal(current.value || current.textContent, 'Game');
  const links = [...nav.querySelectorAll('a.app-crumb')];
  assert.deepEqual(
    links.map((link) => link.textContent),
    ['🎮 Emulator', '⚡ Flash']
  );
  assert.equal(links[1].getAttribute('href'), '/emulator/flash/');
  assert.equal(nav.querySelector('.app-crumb-back').getAttribute('href'), '/emulator/flash/');
  assert.equal(window.document.getElementById('emu-header').hidden, false);
  assert.deepEqual(loadedUrls, ['blob:rom']);
  window.close();
});

it('the playing title opens the rest of that console’s games', async () => {
  const window = appWindow(PAGE, { url: 'https://joeheyming.github.io/emulator/flash/' });
  window.crossOriginIsolated = true;
  stubRuffle(window);
  window.InternetArchiveRoms = function StubIa() {
    this.fetchRomList = async () => [
      { name: 'Game', title: 'Game' },
      {
        name: 'Sonic 3 Complete',
        title: 'Sonic 3 Complete',
        thumbnailUrl: 'https://example.test/sonic.png'
      },
      {
        name: 'Another',
        title: 'Another World',
        thumbnailUrl: 'data:image/png;base64,aaaa'
      }
    ];
  };
  loadClassic(
    window,
    'emulator/consoles.js',
    'emulator/rom-acquire.js',
    'shared/breadcrumbs.js',
    'emulator/launch.js'
  );

  await window.launchEmulator(new window.Blob(['swf']), 'Game.swf', { tracked: true });
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  const input = window.document.querySelector('#emu-breadcrumbs .emu-game-switch-input');
  assert.ok(input);
  assert.equal(
    window.document.querySelector('#emu-breadcrumbs .app-crumb--current').tagName,
    'INPUT'
  );
  assert.equal(input.value, 'Game');
  input.focus();
  input.dispatchEvent(new window.Event('click'));
  let options = [...window.document.querySelectorAll('#emu-game-listbox [role="option"]')];
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(
    options.map((option) => option.textContent),
    ['Game', 'Sonic 3 Complete']
  );
  input.value = 'an';
  input.dispatchEvent(new window.Event('input'));
  options = [...window.document.querySelectorAll('#emu-game-listbox [role="option"]')];
  assert.deepEqual(
    options.map((option) => option.textContent),
    ['Another World']
  );
  assert.equal(options[0].querySelector('img').getAttribute('src'), 'data:image/png;base64,aaaa');
  window.close();
});

it('loads another page of games when the menu is scrolled to the bottom', async () => {
  const window = appWindow(PAGE, { url: 'https://joeheyming.github.io/emulator/flash/' });
  window.crossOriginIsolated = true;
  stubRuffle(window);
  window.InternetArchiveRoms = function StubIa() {
    this.fetchRomList = async () =>
      Array.from({ length: 15 }, (_, i) => ({
        name: `Game ${String(i + 1).padStart(2, '0')}`,
        title: `Game ${String(i + 1).padStart(2, '0')}`
      }));
  };
  loadClassic(
    window,
    'emulator/consoles.js',
    'emulator/rom-acquire.js',
    'shared/breadcrumbs.js',
    'emulator/launch.js'
  );

  await window.launchEmulator(new window.Blob(['swf']), 'Game 01.swf', { tracked: true });
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  const input = window.document.querySelector('.emu-game-switch-input');
  const list = window.document.getElementById('emu-game-listbox');
  input.focus();
  assert.equal(list.querySelectorAll('[role="option"]').length, 12);
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 400 });
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 100 });
  list.scrollTop = 380;
  list.dispatchEvent(new window.Event('scroll'));
  assert.equal(list.querySelectorAll('[role="option"]').length, 15);
  window.close();
});

it('keeps a game-list button on TV, where the breadcrumb bar is hidden', async () => {
  const window = appWindow(PAGE, {
    url: 'https://joeheyming.github.io/emulator/flash/?rom=Game.swf'
  });
  window.crossOriginIsolated = true;
  stubRuffle(window);
  loadClassic(
    window,
    'emulator/consoles.js',
    'emulator/rom-acquire.js',
    'shared/breadcrumbs.js',
    'emulator/launch.js'
  );
  window.emulatorLeanback = { isTv: true };

  await window.launchEmulator(new window.Blob(['swf']), 'Game.swf', { tracked: true });

  assert.ok(window.document.getElementById('emu-game-list-btn'));
  assert.equal(window.document.getElementById('emu-header').hidden, true);
  assert.equal(window.document.querySelector('#emu-breadcrumbs .app-crumb'), null);
  window.close();
});
