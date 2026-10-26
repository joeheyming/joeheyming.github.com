import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS } from '../paint/commands.js';

import {
  contractMask,
  expandMask,
  featherMask,
  modifySelection,
  selectionToFullMask
} from '../paint/selection.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function fakeOverlay(W, H) {
  const calls = [];
  const noop = () => {};
  return {
    calls,
    canvas: { width: W, height: H },
    clearRect: () => calls.push('clear'),
    beginPath: noop,
    rect: noop,
    fill: noop
  };
}

function blockSelection(W, H, x0, y0, x1, y1) {
  const mask = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  }
  return {
    sel: { mode: 'active', x: x0, y: y0, w: x1 - x0, h: y1 - y0, mask, data: null, baseData: null },
    mask
  };
}

test('paint menu bar has a Select menu with PhotoCraft items and a radius input', () => {
  const { document } = new JSDOM(html).window;
  buildMenuBar(document.getElementById('menu-bar'), COMMANDS, { mac: false });
  const wrap = document.getElementById('select-menu-wrap');
  assert.ok(wrap, 'select menu wrapper');
  assert.ok(wrap.closest('#menu-bar'), 'menu sits in the menu bar');
  const btn = document.getElementById('btn-select');
  assert.equal(btn.getAttribute('aria-haspopup'), 'true');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  const list = document.getElementById('select-menu-list');
  assert.ok(list.classList.contains('hidden'));
  const items = [...list.querySelectorAll('[data-select]')].map((b) => [
    b.dataset.select,
    b.querySelector('.menu-label').textContent
  ]);
  assert.deepEqual(items, [
    ['all', 'All'],
    ['deselect', 'Deselect'],
    ['reselect', 'Reselect'],
    ['inverse', 'Inverse Selection'],
    ['all-layers', 'All Layers'],
    ['deselect-layers', 'Deselect Layers'],
    ['color-range', 'Color Range…'],
    ['border', 'Border…'],
    ['smooth', 'Smooth…'],
    ['expand', 'Expand…'],
    ['contract', 'Contract…'],
    ['feather', 'Feather…'],
    ['grow', 'Grow'],
    ['similar', 'Similar'],
    ['transform-selection', 'Transform Selection'],
    ['quick-mask', 'Edit in Quick Mask Mode'],
    ['load-selection', 'Load Selection…'],
    ['save-selection', 'Save Selection…']
  ]);
  const radius = document.getElementById('select-radius');
  assert.equal(radius.type, 'number');
  assert.equal(radius.min, '0');
  assert.equal(radius.max, '32');
  assert.equal(radius.value, '2');
  assert.ok(list.contains(radius));
});

for (const [op, fn] of [
  ['feather', featherMask],
  ['expand', expandMask],
  ['contract', contractMask]
]) {
  test(`modifySelection ${op} replaces the selection with ${fn.name}`, () => {
    const W = 24,
      H = 20;
    const { sel, mask } = blockSelection(W, H, 6, 5, 16, 14);
    const state = { sel, drawing: false };
    const ov = fakeOverlay(W, H);
    assert.equal(modifySelection(state, ov, null, W, H, op, '3'), true);
    assert.deepEqual(selectionToFullMask(state.sel, W, H), fn(mask, W, H, 3));
    assert.equal(state.sel.mode, 'active');
    assert.ok(ov.calls.includes('clear'), 'overlay redrawn');
  });
}

test('modifySelection no-ops without an active selection', () => {
  const W = 8,
    H = 8;
  const state = { sel: { mode: 'none', mask: null, data: null, baseData: null } };
  const ov = fakeOverlay(W, H);
  assert.equal(modifySelection(state, ov, null, W, H, 'expand', 2), false);
  assert.equal(state.sel.mode, 'none');
  assert.deepEqual(ov.calls, []);
});

test('modifySelection clamps the radius to 0..32', () => {
  const W = 80,
    H = 80;
  const { sel, mask } = blockSelection(W, H, 39, 39, 40, 40);
  const state = { sel, drawing: false };
  modifySelection(state, fakeOverlay(W, H), null, W, H, 'expand', 50);
  assert.deepEqual(state.sel.mask, expandMask(mask, W, H, 32));

  const again = blockSelection(W, H, 10, 10, 20, 20);
  const s2 = { sel: again.sel, drawing: false };
  modifySelection(s2, fakeOverlay(W, H), null, W, H, 'expand', -4);
  assert.deepEqual(s2.sel.mask, again.mask);
});

test('contracting a selection away clears the selection and the overlay', () => {
  const W = 12,
    H = 12;
  const { sel } = blockSelection(W, H, 4, 4, 7, 7);
  const state = { sel, drawing: false };
  const ov = fakeOverlay(W, H);
  assert.equal(modifySelection(state, ov, null, W, H, 'contract', 5), true);
  assert.equal(state.sel.mode, 'none');
  assert.deepEqual(ov.calls, ['clear']);
});
