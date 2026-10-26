import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../paint/style.css', import.meta.url), 'utf8');

const load = () => new JSDOM(html).window.document;
const FOLLOWING = 4;

test('#status-bar is the last row of the canvas column, under #canvas-area', () => {
  const document = load();
  const bar = document.getElementById('status-bar');
  const area = document.getElementById('canvas-area');
  assert.ok(bar);
  assert.equal(bar.parentElement, area.parentElement);
  assert.ok(bar.parentElement.classList.contains('canvas-column'));
  assert.equal(bar.parentElement.lastElementChild, bar);
  assert.equal(area.nextElementSibling, bar);
  assert.ok(area.compareDocumentPosition(bar) & FOLLOWING);
  // The canvas column sits between the tool column and the dock.
  const body = document.querySelector('.paint-body');
  assert.equal(bar.parentElement.parentElement, body);
  assert.ok(document.querySelector('.left-panel').compareDocumentPosition(bar) & FOLLOWING);
  assert.ok(bar.compareDocumentPosition(document.getElementById('dock')) & FOLLOWING);
});

test('#status-coords and #zoom-display are inside #status-bar', () => {
  const document = load();
  const bar = document.getElementById('status-bar');
  assert.ok(bar.contains(document.getElementById('status-coords')));
  assert.ok(bar.contains(document.getElementById('status-size')));
  assert.ok(bar.contains(document.getElementById('zoom-display')));
  assert.equal(document.querySelectorAll('#zoom-display').length, 1);
  assert.equal(document.querySelector('.paint-header .zoom-group'), null);
  assert.equal(document.querySelector('.palette-bar-outer'), null);
});

test('the zoom buttons sit next to the zoom readout', () => {
  const document = load();
  const display = document.getElementById('zoom-display');
  const group = display.parentElement;
  assert.ok(group.classList.contains('zoom-group'));
  assert.equal(group.parentElement, document.getElementById('status-bar'));
  assert.deepEqual(
    [...group.children].map((el) => el.id),
    ['btn-zoom-out', 'zoom-display', 'btn-zoom-in', 'btn-zoom-reset']
  );
});

test('the canvas column stacks the canvas over the status bar', () => {
  const rule = (sel) => css.match(new RegExp(`\\n${sel.replace(/[.#]/g, '\\$&')} \\{[^}]*\\}`))[0];
  assert.match(rule('.canvas-column'), /flex-direction: column/);
  assert.match(rule('#canvas-area'), /flex: 1/);
  assert.match(rule('.status-bar'), /flex-shrink: 0/);
  assert.match(rule('.status-bar'), /border-top/);
});
