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
    cancelable: true
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
    </body>`,
    { url: 'https://joeheyming.github.io/' }
  );
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  await import(HREF + '?remote-arrows=1');

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

  dom.window.close();
});
