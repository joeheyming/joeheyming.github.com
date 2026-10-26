import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS_BY_ID, commandForKey } from '../paint/commands.js';
import {
  borderMask,
  deselectSelection,
  growSelection,
  growSelectionMask,
  modifySelection,
  reselectSelection,
  selectionToFullMask,
  smoothMask
} from '../paint/selection.js';

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

function block(W, H, x0, y0, x1, y1) {
  const mask = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  }
  return mask;
}

function activeSel(mask, W, H) {
  return { mode: 'active', x: 0, y: 0, w: W, h: H, mask, data: null, baseData: null };
}

const row = (mask, W, y) => [...mask.subarray(y * W, (y + 1) * W)].join('');

// Left half red, right half blue, one stray red pixel at (10, 10) and a darker red at (2, 2).
function twoTone(W, H) {
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const red = x < 6 || (x === 10 && y === 10);
      img.data.set(red ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
    }
  }
  img.data.set([235, 0, 0, 255], (2 * W + 2) * 4);
  return img;
}

test('Border replaces the selection with a band Width px wide straddling its edge', () => {
  const W = 12,
    H = 12;
  const out = borderMask(block(W, H, 2, 2, 10, 10), W, H, 2);
  assert.equal(row(out, W, 6), '011000000110');
  assert.equal(row(out, W, 1), '011111111110');
  assert.equal(row(out, W, 2), '011111111110');
  assert.equal(row(out, W, 3), '011000000110');
  assert.equal(row(out, W, 0), '000000000000');

  const wide = borderMask(block(W, H, 2, 2, 10, 10), W, H, 4);
  assert.equal(row(wide, W, 6), '111100001111');
});

test('Border on Select All follows the canvas edge', () => {
  const W = 6,
    H = 6;
  const out = borderMask(new Uint8Array(W * H).fill(1), W, H, 2);
  assert.equal(row(out, W, 0), '111111');
  assert.equal(row(out, W, 3), '100001');
});

test('Smooth is a majority filter of Sample Radius: corners round, specks drop, edges stay', () => {
  const W = 12,
    H = 12;
  const square = block(W, H, 3, 3, 9, 9);
  square[0] = 1; // a one-pixel speck
  const out = smoothMask(square, W, H, 1);
  assert.equal(out[0], 0, 'speck removed');
  assert.equal(out[3 * W + 3], 0, 'corner cut');
  assert.equal(out[3 * W + 4], 1, 'edge kept');
  assert.equal(row(out, W, 6), '000111111000');
  const all = smoothMask(new Uint8Array(W * H).fill(1), W, H, 3);
  assert.ok(all.every((v) => v === 1), 'canvas edge repeats, Select All stays');
});

test('modifySelection runs Border and Smooth and refuses a radius below 1', () => {
  const W = 12,
    H = 12;
  const mask = block(W, H, 2, 2, 10, 10);
  const state = { sel: activeSel(mask.slice(), W, H), drawing: false };
  assert.equal(modifySelection(state, fakeOverlay(W, H), null, W, H, 'border', '2'), true);
  assert.deepEqual(selectionToFullMask(state.sel, W, H), borderMask(mask, W, H, 2));

  const s2 = { sel: activeSel(mask.slice(), W, H), drawing: false };
  assert.equal(modifySelection(s2, fakeOverlay(W, H), null, W, H, 'smooth', 3), true);
  assert.deepEqual(selectionToFullMask(s2.sel, W, H), smoothMask(mask, W, H, 3));

  const s3 = { sel: activeSel(mask.slice(), W, H), drawing: false };
  assert.equal(modifySelection(s3, fakeOverlay(W, H), null, W, H, 'border', 0), false);
  assert.deepEqual(s3.sel.mask, mask);
});

test('Grow adds contiguous pixels within tolerance; Similar adds them anywhere', () => {
  const W = 12,
    H = 12;
  const img = twoTone(W, H);
  const seed = block(W, H, 1, 1, 2, 2);

  const grown = growSelectionMask(seed, img.data, W, H, 32, true);
  assert.equal(row(grown, W, 5), '111111000000');
  assert.equal(grown[2 * W + 2], 1, 'darker red within tolerance');
  assert.equal(grown[10 * W + 10], 0, 'stray red is not contiguous');

  const similar = growSelectionMask(seed, img.data, W, H, 32, false);
  assert.equal(similar[10 * W + 10], 1, 'Similar finds the stray red');
  assert.equal(similar[10 * W + 9], 0);

  const tight = growSelectionMask(seed, img.data, W, H, 5, true);
  assert.equal(tight[2 * W + 2], 0, 'darker red is outside a tolerance of 5');
  assert.equal(tight[5 * W + 5], 1);

  assert.equal(growSelectionMask(new Uint8Array(W * H), img.data, W, H, 32, true), null);
});

test('growSelection replaces the active selection and no-ops without one', () => {
  const W = 12,
    H = 12;
  const img = twoTone(W, H);
  const state = { sel: activeSel(block(W, H, 8, 8, 9, 9), W, H), drawing: false };
  assert.equal(growSelection(state, fakeOverlay(W, H), null, W, H, 32, true, img), true);
  const mask = selectionToFullMask(state.sel, W, H);
  assert.equal(row(mask, W, 0), '000000111111');
  assert.equal(mask[10 * W + 10], 0);
  assert.equal(state.sel.x, 6);

  const none = { sel: { mode: 'none', mask: null, data: null, baseData: null } };
  assert.equal(growSelection(none, fakeOverlay(W, H), null, W, H, 32, true, img), false);
});

test('Reselect restores the mask the last Deselect dropped', () => {
  const W = 10,
    H = 10;
  const mask = block(W, H, 2, 3, 6, 7);
  const state = { sel: activeSel(mask.slice(), W, H), drawing: false };
  const ov = fakeOverlay(W, H);
  assert.equal(reselectSelection(state, ov, null, W, H), false, 'nothing to reselect yet');
  deselectSelection(state, ov, null, W, H);
  assert.equal(state.sel.mode, 'none');
  assert.equal(reselectSelection(state, ov, null, W, H), true);
  assert.equal(state.sel.mode, 'active');
  assert.deepEqual(selectionToFullMask(state.sel, W, H), mask);
  assert.deepEqual([state.sel.x, state.sel.y, state.sel.w, state.sel.h], [2, 3, 4, 4]);
  assert.equal(reselectSelection(state, ov, null, 5, 5), false, 'canvas size changed');
});

test('Select menu commands: Reselect is Shift+Cmd+D and enables after a Deselect', () => {
  const reselect = COMMANDS_BY_ID.get('select.reselect');
  assert.equal(reselect.label, 'Reselect');
  const key = { code: 'KeyD', key: 'D', metaKey: true, shiftKey: true };
  assert.equal(commandForKey(key).id, 'select.reselect');
  assert.equal(reselect.enabled({ lastSelMask: null }), false);
  assert.equal(reselect.enabled({ lastSelMask: new Uint8Array(4) }), true);

  const calls = [];
  const ctx = {
    reselect: () => calls.push('reselect'),
    growSelection: (contiguous) => calls.push(contiguous ? 'grow' : 'similar'),
    modifySelection: (op) => calls.push(op)
  };
  const active = { sel: { mode: 'active', w: 4, h: 4 } };
  for (const id of [
    'select.reselect',
    'select.grow',
    'select.similar',
    'select.modify.border',
    'select.modify.smooth'
  ]) {
    const cmd = COMMANDS_BY_ID.get(id);
    if (id !== 'select.reselect') {
      assert.equal(cmd.enabled(active), true, id);
      assert.equal(cmd.enabled({ sel: { mode: 'none' } }), false, id);
    }
    cmd.run(ctx);
  }
  assert.deepEqual(calls, ['reselect', 'grow', 'similar', 'border', 'smooth']);
  assert.deepEqual(COMMANDS_BY_ID.get('select.grow').menu, ['Select']);
  assert.deepEqual(COMMANDS_BY_ID.get('select.modify.border').menu, ['Select', 'Modify']);
});
