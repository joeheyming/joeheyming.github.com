import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const remoteHref = pathToFileURL(join(root, 'remote.js')).href;

function box(el, x, y, w, h) {
  el.getBoundingClientRect = () => ({
    x,
    y,
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    toJSON() {
      return {};
    }
  });
  Object.defineProperty(el, 'offsetTop', { configurable: true, get: () => y });
}

function key(window, el, name) {
  const event = new window.KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    composed: true
  });
  el.dispatchEvent(event);
  return event;
}

test('arrows move between ROM cards inside the shadow host and can leave the grid', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://joeheyming.github.io/emulator/nes/'
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.KeyboardEvent = window.KeyboardEvent;
  window.eval('setTimeout = function () { return 0; };');
  await import(remoteHref + '?emulator-roving=1');
  window.eval(readFileSync(join(root, 'emulator/leanback.js'), 'utf8'));

  class RomList extends window.HTMLElement {
    constructor() {
      super();
      const rootNode = this.attachShadow({ mode: 'open' });
      rootNode.innerHTML =
        '<button id="search" type="button">Search</button>' +
        '<div id="grid"><button class="rom-card" id="a" type="button">Metroid</button>' +
        '<button class="rom-card" id="b" type="button">Zelda</button></div>';
    }
  }
  window.customElements.define('rom-list', RomList);
  const host = window.document.createElement('rom-list');
  window.document.body.appendChild(host);
  const search = host.shadowRoot.getElementById('search');
  const grid = host.shadowRoot.getElementById('grid');
  const first = host.shadowRoot.getElementById('a');
  const second = host.shadowRoot.getElementById('b');
  box(search, 10, 10, 80, 32);
  box(first, 10, 80, 120, 160);
  box(second, 140, 80, 120, 160);

  const roving = window.emulatorLeanback.applyRovingTabindex(grid, { selector: '.rom-card' });
  first.focus();
  assert.equal(window.document.activeElement, host);

  const right = key(window, host, 'ArrowRight');
  assert.equal(right.heymingHandled, true);
  assert.equal(host.shadowRoot.activeElement, second);

  second.focus();
  const up = key(window, host, 'ArrowUp');
  assert.equal(up.heymingHandled, undefined);
  assert.equal(host.shadowRoot.activeElement, search);

  roving.dispose();
});
