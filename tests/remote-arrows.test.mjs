import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HREF = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'remote.js')).href;

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

test('arrows move focus and a select only opens from space', async () => {
  const dom = new JSDOM(
    `<!doctype html><body>
      <button id="a">A</button>
      <select id="s"><option>one</option><option>two</option></select>
      <button id="b">B</button>
      <input id="n" type="number" value="3">
      <div id="board" tabindex="0"></div>
      <a id="start" data-initial-focus href="/stepmania/songs/">Xepher</a>
    </body>`,
    { url: 'https://joeheyming.github.io/' }
  );
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  await import(HREF + '?remote-arrows=1');

  const start = window.document.getElementById('start');
  assert.equal(window.document.activeElement, start);
  start.remove();

  const a = window.document.getElementById('a');
  const s = window.document.getElementById('s');
  const b = window.document.getElementById('b');
  const n = window.document.getElementById('n');
  const board = window.document.getElementById('board');
  box(a, 10, 10, 40, 40);
  box(s, 10, 60, 80, 40);
  box(b, 10, 120, 40, 40);
  box(n, 10, 180, 80, 40);
  box(board, 200, 10, 100, 100);

  a.focus();
  const fromButton = key(window, a, 'ArrowDown');
  assert.equal(fromButton.defaultPrevented, true);
  assert.equal(window.document.activeElement, s);
  assert.equal(s.selectedIndex, 0);

  const fromSelect = key(window, s, 'ArrowDown');
  assert.equal(fromSelect.defaultPrevented, true);
  assert.equal(s.selectedIndex, 0);
  assert.equal(window.document.activeElement, b);

  s.focus();
  const space = key(window, s, ' ');
  assert.equal(space.defaultPrevented, false);
  assert.equal(window.document.activeElement, s);
  const right = key(window, s, 'ArrowRight');
  assert.equal(right.defaultPrevented, true);
  assert.equal(s.selectedIndex, 1);
  assert.equal(window.document.activeElement, s);
  key(window, s, 'ArrowLeft');
  assert.equal(s.selectedIndex, 0);

  n.focus();
  const left = key(window, n, 'ArrowLeft');
  assert.equal(left.defaultPrevented, false);
  assert.equal(window.document.activeElement, n);
  key(window, n, 'ArrowDown');
  assert.equal(window.document.activeElement, board);

  board.focus();
  const boardArrow = key(window, board, 'ArrowRight');
  assert.equal(boardArrow.defaultPrevented, false);
  assert.equal(window.document.activeElement, board);

  const splash = window.document.createElement('p');
  splash.setAttribute('role', 'button');
  splash.tabIndex = 0;
  splash.textContent = 'Token-powered!';
  window.document.body.appendChild(splash);
  box(splash, 10, 400, 151, 67);
  const launch = window.document.createElement('a');
  launch.href = '/os/';
  launch.textContent = 'Launch Heyming OS';
  window.document.body.appendChild(launch);
  box(launch, 10, 480, 160, 40);
  splash.focus();
  const leaveSplash = key(window, splash, 'ArrowDown');
  assert.equal(leaveSplash.defaultPrevented, true);
  assert.equal(window.document.activeElement, launch);

  class CardHost extends window.HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<button id="one">One</button><button id="two">Two</button>';
    }
  }
  window.customElements.define('card-host', CardHost);
  const cards = window.document.createElement('card-host');
  window.document.body.appendChild(cards);
  const one = cards.shadowRoot.getElementById('one');
  const two = cards.shadowRoot.getElementById('two');
  box(one, 10, 600, 80, 40);
  box(two, 100, 600, 80, 40);
  one.focus();
  const fromHost = key(window, cards, 'ArrowRight');
  assert.equal(fromHost.defaultPrevented, true);
  assert.equal(cards.shadowRoot.activeElement, two);
  let clicks = 0;
  two.addEventListener('click', () => {
    clicks += 1;
  });
  two.focus();
  key(window, cards, 'Enter');
  assert.equal(clicks, 1);
  cards.remove();

  const beforeField = window.document.createElement('button');
  beforeField.textContent = 'Before';
  const field = window.document.createElement('input');
  field.type = 'text';
  field.value = 'zelda';
  const afterField = window.document.createElement('button');
  afterField.textContent = 'After';
  window.document.body.append(beforeField, field, afterField);
  box(beforeField, 10, 700, 40, 40);
  box(field, 60, 700, 80, 40);
  box(afterField, 150, 700, 40, 40);
  field.focus();
  field.setSelectionRange(2, 2);
  const midCaret = key(window, field, 'ArrowLeft');
  assert.equal(midCaret.defaultPrevented, false);
  assert.equal(window.document.activeElement, field);
  field.setSelectionRange(0, 0);
  key(window, field, 'ArrowLeft');
  assert.equal(window.document.activeElement, beforeField);
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  key(window, field, 'ArrowRight');
  assert.equal(window.document.activeElement, afterField);
  field.focus();
  field.setSelectionRange(2, 2);
  key(window, field, 'ArrowUp');
  assert.notEqual(window.document.activeElement, field);

  class FieldHost extends window.HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<input id="q" type="search" value="ocarina">';
    }
  }
  window.customElements.define('field-host', FieldHost);
  const fieldHost = window.document.createElement('field-host');
  fieldHost.tabIndex = 0;
  window.document.body.appendChild(fieldHost);
  const inner = fieldHost.shadowRoot.getElementById('q');
  box(inner, 60, 760, 80, 40);
  box(fieldHost, 60, 760, 80, 40);
  const belowField = window.document.createElement('button');
  belowField.textContent = 'Below';
  window.document.body.appendChild(belowField);
  box(belowField, 60, 820, 40, 40);
  inner.focus();
  inner.setSelectionRange(0, 0);
  key(window, fieldHost, 'ArrowDown');
  assert.equal(window.document.activeElement, belowField);
  inner.focus();
  inner.setSelectionRange(0, 0);
  key(window, fieldHost, 'ArrowLeft');
  assert.equal(window.document.activeElement, beforeField);
  beforeField.remove();
  field.remove();
  afterField.remove();
  fieldHost.remove();
  belowField.remove();

  class MenuWidget extends window.HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<button id="open">Open</button><div hidden><button id="secret">Secret</button></div>';
    }
  }
  window.customElements.define('menu-widget', MenuWidget);
  const menu = window.document.createElement('menu-widget');
  b.after(menu);
  const open = menu.shadowRoot.getElementById('open');
  const secret = menu.shadowRoot.getElementById('secret');
  box(open, 60, 10, 40, 40);
  box(secret, 120, 10, 40, 40);

  a.focus();
  key(window, a, 'ArrowRight');
  assert.equal(menu.shadowRoot.activeElement, open);

  key(window, open, 'ArrowRight');
  assert.equal(window.document.activeElement, board);
  assert.notEqual(menu.shadowRoot.activeElement, secret);

  const ghost = window.document.createElement('button');
  ghost.textContent = 'Hidden';
  ghost.style.opacity = '0';
  ghost.style.pointerEvents = 'none';
  window.document.body.appendChild(ghost);
  box(ghost, 140, 10, 40, 40);
  const prose = window.document.createElement('p');
  const inlineLink = window.document.createElement('a');
  inlineLink.href = '/editor/';
  inlineLink.textContent = 'make a simfile';
  inlineLink.style.display = 'inline';
  prose.appendChild(inlineLink);
  window.document.body.appendChild(prose);
  box(inlineLink, 10, -30, 89, 16);
  const above = window.document.createElement('button');
  above.id = 'above';
  above.textContent = 'Songs';
  window.document.body.appendChild(above);
  box(above, 10, -80, 40, 40);

  open.focus();
  key(window, open, 'ArrowRight');
  assert.equal(window.document.activeElement, board);

  a.focus();
  key(window, a, 'ArrowUp');
  assert.equal(window.document.activeElement, above);

  const song = window.document.createElement('a');
  song.href = '/stepmania/songs/';
  song.textContent = 'Xepher';
  song.style.display = 'inline';
  const item = window.document.createElement('li');
  item.appendChild(song);
  const charts = window.document.createElement('ol');
  charts.appendChild(item);
  window.document.body.appendChild(charts);
  box(song, 400, 10, 52, 18);
  const chartsStart = window.document.createElement('button');
  chartsStart.textContent = 'Charts';
  window.document.body.appendChild(chartsStart);
  box(chartsStart, 300, 10, 40, 40);
  chartsStart.focus();
  key(window, chartsStart, 'ArrowRight');
  assert.equal(window.document.activeElement, song);

  const dialog = window.document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const inside = window.document.createElement('button');
  inside.textContent = 'Search';
  const insideNext = window.document.createElement('button');
  insideNext.textContent = 'Close';
  dialog.append(inside, insideNext);
  const outside = window.document.createElement('button');
  outside.textContent = 'Behind';
  window.document.body.append(dialog, outside);
  box(inside, 10, 10, 80, 40);
  box(insideNext, 10, 60, 80, 40);
  box(outside, 200, 10, 40, 40);

  inside.focus();
  key(window, inside, 'ArrowRight');
  assert.equal(window.document.activeElement, insideNext);
  assert.notEqual(window.document.activeElement, outside);

  dialog.hidden = true;
  class LibraryHost extends window.HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<div role="dialog" aria-modal="true"><button id="search">Search</button><button id="close">Close</button></div>';
    }
  }
  window.customElements.define('library-host', LibraryHost);
  const host = window.document.createElement('library-host');
  host.tabIndex = 0;
  window.document.body.appendChild(host);
  const search = host.shadowRoot.getElementById('search');
  const close = host.shadowRoot.getElementById('close');
  box(host, 200, 80, 80, 40);
  box(search, 200, 80, 80, 40);
  box(close, 300, 80, 80, 40);

  outside.focus();
  const intoHost = key(window, outside, 'ArrowDown');
  assert.equal(intoHost.defaultPrevented, true);
  assert.equal(host.shadowRoot.activeElement, search);
  key(window, search, 'ArrowRight');
  assert.equal(host.shadowRoot.activeElement, close);
  assert.notEqual(window.document.activeElement, outside);

  outside.focus();
  assert.equal(window.heymingRemote.focusIfIdle(search), false);
  assert.equal(window.document.activeElement, outside);

  dom.window.close();
});
