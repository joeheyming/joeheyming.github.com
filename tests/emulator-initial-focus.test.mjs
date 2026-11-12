// A keyboard, remote, and controller only move once a control is focused.
// The emulator hub and a console's game list have to take that focus
// themselves. TV mode already did; these cover the ordinary page.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { appWindow, loadClassic } from './load-app-script.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function installFocus(window) {
  window.eval(`window.heymingRemote = { focusIfIdle(el, force) {
    const active = document.activeElement;
    const idle = !active || active === document.body || active === document.documentElement ||
      (active.classList && active.classList.contains('heyming-nav-toggle'));
    if (!force && !idle) return false;
    el.focus();
    return true;
  } };`);
}

test('the emulator hub focuses the first console', async () => {
  const window = appWindow(
    '<!doctype html><div id="brand"></div><div id="boot-card"></div><button class="heyming-nav-toggle">Menu</button>',
    { url: 'https://joeheyming.github.io/emulator/' }
  );
  installFocus(window);
  window.EMULATOR_CONSOLES = {
    nes: { id: 'nes', emoji: '🎮', title: 'NES', subtitle: 'Nintendo' },
    snes: { id: 'snes', emoji: '🎮', title: 'SNES', subtitle: 'Super' }
  };
  window.document.querySelector('.heyming-nav-toggle').focus();
  loadClassic(window, 'emulator/launch.js');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(window.__loadedScripts, [], 'the hub loads no game-list scripts');

  const tile = window.document.querySelector('.picker-tile');
  assert.equal(window.document.activeElement, tile);
  assert.equal(tile.getAttribute('data-console'), 'nes');
  assert.equal(tile.hasAttribute('data-initial-focus'), true);
  window.close();
});

test('a console list focuses the first game and leaves a chosen control alone', () => {
  const dom = new JSDOM('<!doctype html><button id="loadRomBtn">Load ROM</button>', {
    runScripts: 'outside-only',
    url: 'https://joeheyming.github.io/emulator/nes/'
  });
  const { window } = dom;
  installFocus(window);
  window.EMULATOR_CONSOLES = {
    nes: { id: 'nes', title: 'NES', iaBaseUrl: 'https://example.test' }
  };
  window.eval(readFileSync(path.join(ROOT, 'emulator/rom-browser.js'), 'utf8'));

  const browser = window.document.createElement('rom-browser');
  browser.setAttribute('console', 'nes');
  window.document.body.appendChild(browser);

  window.document.getElementById('loadRomBtn').focus();
  browser.renderRoms([
    { title: 'Super Mario Bros.', description: '', size: '1 KB', name: 'mario' }
  ]);
  assert.equal(browser.shadowRoot.activeElement.classList.contains('rom-card'), true);
  assert.equal(browser.shadowRoot.activeElement.dataset.fullTitle, 'Super Mario Bros.');

  const other = window.document.createElement('button');
  other.id = 'elsewhere';
  window.document.body.appendChild(other);
  other.focus();
  browser.renderRoms([
    { title: 'Super Mario Bros.', description: '', size: '1 KB', name: 'mario' },
    { title: 'Zelda', description: '', size: '1 KB', name: 'zelda' }
  ]);
  assert.equal(window.document.activeElement, other);
  window.close();
});
