import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const remoteHref = pathToFileURL(join(root, 'remote.js')).href;

const score = {
  tapNoteScores: [1, 0, 0, 0, 0],
  totalNotes: 1,
  maxCombo: 1,
  songLabel: 'Clair de Lune'
};

/** @type {JSDOM} */
let dom;
/** @type {HTMLElement} */
let opener;
/** @type {HTMLElement} */
let after;
/** @type {HTMLElement} */
let focusHost;
/** @type {HTMLElement & { show: Function, hide: Function, setHandlers: Function, shadowRoot: ShadowRoot }} */
let modal;
/** @type {HTMLElement & { setState: Function, shadowRoot: ShadowRoot }} */
let overlay;
/** @type {HTMLElement & { open: Function, close: Function, shadowRoot: ShadowRoot }} */
let browser;
const backs = { count: 0 };

function key(el, name, extras = {}) {
  const event = new dom.window.KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...extras
  });
  el.dispatchEvent(event);
  return event;
}

before(async () => {
  dom = new JSDOM(
    `<!doctype html><body>
      <button id="open-song-browser" type="button">Pick a song</button>
      <button id="after" type="button">After</button>
      <focus-host id="focus-host"></focus-host>
    </body>`,
    { url: 'https://joeheyming.github.io/piano-hero/' }
  );
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.customElements = window.customElements;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.ShadowRoot = window.ShadowRoot;
  window.fetch = async () => ({ ok: true, json: async () => [] });
  window.history.back = () => {
    backs.count += 1;
  };

  class FocusHost extends window.HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<button id="inner" type="button">Inner</button>';
    }
  }
  window.customElements.define('focus-host', FocusHost);

  await import(pathToFileURL(join(root, 'piano-hero/game-over-modal.js')).href);
  await import(pathToFileURL(join(root, 'piano-hero/loading-overlay.js')).href);

  const browserSource = readFileSync(join(root, 'piano-hero/ia-browser.js'), 'utf8')
    .replace(/^import .*\n/gm, '')
    .replace(/^export .*\n/gm, '');
  window.midiManager = { loadFromUrl: async () => {} };
  window.eval(browserSource);

  await import(remoteHref + '?piano-hero-overlays=1');

  opener = window.document.getElementById('open-song-browser');
  after = window.document.getElementById('after');
  focusHost = window.document.getElementById('focus-host');
  overlay = window.document.createElement('piano-hero-loading-overlay');
  modal = window.document.createElement('piano-hero-game-over-modal');
  browser = window.document.createElement('piano-hero-song-browser');
  window.document.body.append(overlay, modal, browser);
});

test('game-over modal names itself, focuses Retry, and Escape restores focus', () => {
  backs.count = 0;
  let retried = 0;
  let picked = 0;
  modal.setHandlers({
    onRetry: () => {
      retried += 1;
    },
    onPickAnother: () => {
      picked += 1;
    }
  });
  const inner = focusHost.shadowRoot.getElementById('inner');
  inner.focus();
  modal.show(score);
  modal.show(score);

  const dialog = modal.shadowRoot.querySelector('[role="dialog"]');
  const title = modal.shadowRoot.getElementById(dialog.getAttribute('aria-labelledby'));
  const summary = modal.shadowRoot.getElementById(dialog.getAttribute('aria-describedby'));
  const retry = modal.shadowRoot.getElementById('retry');
  const pick = modal.shadowRoot.getElementById('pick');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(title.textContent, 'Clair de Lune');
  assert.match(summary.textContent, /100\.00%/);
  assert.equal(modal.shadowRoot.activeElement, retry);

  const tab = key(retry, 'Tab');
  assert.equal(tab.defaultPrevented, true);
  assert.equal(modal.shadowRoot.activeElement, pick);
  key(pick, 'Tab', { shiftKey: true });
  assert.equal(modal.shadowRoot.activeElement, retry);

  const escape = key(retry, 'Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(modal.hidden, true);
  assert.equal(retried, 0);
  assert.equal(picked, 0);
  assert.equal(backs.count, 0);
  assert.equal(focusHost.shadowRoot.activeElement, inner);
});

test('loading overlay error focuses Try again and announces the message', () => {
  const inner = focusHost.shadowRoot.getElementById('inner');
  inner.focus();
  overlay.setState('error', { title: 'Could not load MIDI', message: 'Nope' });
  const retry = overlay.shadowRoot.getElementById('retry');
  const status = overlay.shadowRoot.querySelector('[role="status"]');
  const alert = overlay.shadowRoot.querySelector('[role="alert"]');
  assert.equal(retry.hidden, false);
  assert.equal(overlay.shadowRoot.activeElement, retry);
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(alert.getAttribute('role'), 'alert');
  assert.equal(alert.textContent, 'Nope');
  assert.equal(alert.hidden, false);

  overlay.setState('hidden');
  assert.equal(focusHost.shadowRoot.activeElement, inner);
  assert.equal(retry.hidden, true);
});

test('song browser focuses search, keeps arrows inside, and restores the opener', () => {
  backs.count = 0;
  modal.hide();
  opener.focus();
  browser.open();

  const dialog = browser.shadowRoot.querySelector('[role="dialog"]');
  const title = browser.shadowRoot.getElementById(dialog.getAttribute('aria-labelledby'));
  const search = browser.shadowRoot.getElementById('search-input');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(title.textContent, 'Pick a song');
  assert.equal(search.getAttribute('aria-label'), 'Search Internet Archive');
  assert.equal(browser.shadowRoot.activeElement, search);
  assert.equal(search.closest('[hidden]'), null);
  assert.equal(browser.hidden, false);

  opener.focus();
  const into = key(opener, 'ArrowDown');
  assert.equal(into.defaultPrevented, true);
  assert.equal(document.activeElement, browser);
  assert.notEqual(document.activeElement, after);

  const closeBtn = browser.shadowRoot.querySelector('.close');
  closeBtn.focus();
  const up = key(closeBtn, 'ArrowUp');
  assert.equal(up.defaultPrevented, true);
  assert.equal(document.activeElement, browser);

  search.focus();
  search.value = 'bach';
  search.setSelectionRange(1, 1);
  const right = key(search, 'ArrowRight');
  assert.equal(right.heymingHandled, undefined);
  assert.equal(browser.shadowRoot.activeElement, search);

  const down = key(search, 'ArrowDown');
  assert.equal(down.defaultPrevented, true);
  assert.equal(down.heymingHandled, undefined);
  assert.equal(document.activeElement, browser);
  assert.notEqual(document.activeElement, after);
  search.focus();
  const upFromSearch = key(search, 'ArrowUp');
  assert.equal(upFromSearch.defaultPrevented, true);
  assert.equal(document.activeElement, browser);

  search.focus();
  const escape = key(search, 'Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(browser.hidden, true);
  assert.equal(backs.count, 0);
  assert.equal(document.activeElement, opener);
});

test('song browser tabs follow the arrow keys and announce result counts', () => {
  opener.focus();
  browser.open();
  const tabs = [...browser.shadowRoot.querySelectorAll('[role="tab"]')];
  const panels = [...browser.shadowRoot.querySelectorAll('[role="tabpanel"]')];
  assert.equal(
    browser.shadowRoot.querySelector('[role="tablist"]').getAttribute('aria-label'),
    'Song sources'
  );
  tabs.forEach((tab, index) => {
    assert.equal(tab.getAttribute('aria-controls'), panels[index].id);
    assert.equal(panels[index].getAttribute('aria-labelledby'), tab.id);
  });

  tabs[0].focus();
  const right = key(tabs[0], 'ArrowRight');
  assert.equal(right.heymingHandled, true);
  assert.equal(right.defaultPrevented, true);
  assert.equal(browser.shadowRoot.activeElement, tabs[1]);
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[0].tabIndex, -1);
  assert.equal(tabs[1].tabIndex, 0);

  key(tabs[1], 'ArrowLeft');
  assert.equal(browser.shadowRoot.activeElement, tabs[0]);
  key(tabs[0], 'ArrowLeft');
  assert.equal(browser.shadowRoot.activeElement, tabs[2]);
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');

  browser._renderSearchResults([{ identifier: 'a', title: 'Aria', creator: 'Bach' }], 'bach');
  const live = browser.shadowRoot.getElementById('search-count');
  assert.equal(live.getAttribute('role'), 'status');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.equal(live.classList.contains('sr-only'), true);
  assert.equal(live.textContent, '1 match.');

  const gone = document.createElement('button');
  gone.type = 'button';
  document.body.appendChild(gone);
  gone.focus();
  browser.open();
  gone.remove();
  browser.close();
  assert.equal(document.activeElement, opener);
});
