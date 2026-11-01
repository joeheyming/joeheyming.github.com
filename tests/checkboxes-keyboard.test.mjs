import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cursorKey, holdStep, isCursorKey, nextCell } from '../checkboxes/navigate.js';

const root = new URL('..', import.meta.url);

function read(rel) {
  return readFileSync(new URL(rel, root), 'utf8');
}

test('a fresh arrow steps one cell and leaves only from the edge', () => {
  assert.equal(nextCell(0, 10, 100, 'ArrowRight'), 1);
  assert.equal(nextCell(0, 10, 100, 'ArrowLeft'), null);
  assert.equal(nextCell(0, 10, 100, 'ArrowUp'), null);
  assert.equal(nextCell(5, 10, 100, 'ArrowDown'), 15);
  assert.equal(nextCell(95, 10, 100, 'ArrowDown'), null);
  assert.equal(nextCell(9, 10, 100, 'ArrowRight'), null);
});

test('a held arrow speeds up and clamps at the edge instead of leaving', () => {
  assert.equal(holdStep(0, 24), 1);
  assert.equal(holdStep(5, 24), 1);
  assert.equal(holdStep(6, 24), 4);
  assert.equal(holdStep(14, 24), 24);
  assert.equal(holdStep(28, 24), 192);

  assert.equal(nextCell(0, 24, 240, 'ArrowRight', { repeats: 6 }), 4);
  assert.equal(nextCell(9, 10, 100, 'ArrowRight', { repeats: 8 }), 9);
  assert.equal(nextCell(0, 10, 100, 'ArrowUp', { repeats: 4 }), 0);
  assert.equal(nextCell(90, 10, 100, 'ArrowDown', { repeats: 14, page: 5 }), 90);
});

test('vertical moves keep the column and clamp a short last row', () => {
  // 95 cells, 10 columns: last row has cells 90..94.
  assert.equal(nextCell(85, 10, 95, 'ArrowDown'), 94);
  assert.equal(nextCell(80, 10, 95, 'ArrowDown'), 90);
  assert.equal(nextCell(94, 10, 95, 'ArrowRight'), null);
  assert.equal(nextCell(94, 10, 95, 'End'), 94);
  assert.equal(nextCell(92, 10, 95, 'Home'), 90);
});

test('page keys jump a screen and a fresh press on the edge leaves', () => {
  assert.equal(nextCell(15, 10, 200, 'PageDown', { page: 4 }), 55);
  assert.equal(nextCell(45, 10, 200, 'PageUp', { page: 4 }), 5);
  assert.equal(nextCell(5, 10, 200, 'PageUp', { page: 4 }), null);
  assert.equal(nextCell(190, 10, 200, 'PageDown', { page: 4, repeats: 3 }), 190);
  assert.equal(cursorKey('n'), 'PageDown');
  assert.equal(cursorKey('P'), 'PageUp');
  assert.equal(isCursorKey('ArrowLeft'), true);
  assert.equal(isCursorKey('i'), false);
});

test('home and end stay on the row unless asked to jump to the ends', () => {
  assert.equal(nextCell(25, 10, 100, 'Home'), 20);
  assert.equal(nextCell(25, 10, 100, 'End'), 29);
  assert.equal(nextCell(25, 10, 100, 'Home', { ends: true }), 0);
  assert.equal(nextCell(25, 10, 100, 'End', { ends: true }), 99);
});

test('the grid, image view, and dialogs are remote controls', () => {
  const html = read('checkboxes/index.html');
  const css = read('checkboxes/index.css');
  const js = read('checkboxes/index.js');

  assert.match(html, /id="cb-grid"[\s\S]*tabindex="0"/);
  assert.match(html, /id="cb-grid"[\s\S]*data-initial-focus/);
  assert.match(html, /id="cb-image-open"/);
  assert.match(html, /id="cb-image-canvas"[\s\S]*tabindex="0"/);
  assert.match(html, /id="cb-image-cycle"/);
  assert.match(html, /id="cb-image-close"/);
  assert.match(html, /id="cb-image-overlay"[\s\S]*aria-modal="true"/);
  assert.match(html, /id="cb-info"[\s\S]*aria-modal="true"/);
  assert.match(html, /id="cb-meme"[\s\S]*aria-modal="true"/);
  assert.match(css, /\.cb-grid:focus-visible\s*\{[^}]*outline:\s*none/);
  assert.match(css, /\.cb-jump input:focus-visible/);
  assert.match(js, /nextCell/);
  assert.match(js, /toggleCell\(cursor\)/);
});
