import test from 'node:test';
import assert from 'node:assert/strict';

import { ICONS } from '../paint/icons.js';
import { patchHeal } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions, patchOffset } from '../paint/tools.js';

const W = 24,
  H = 16;

// A flat grey canvas with a 4x4 noisy square at (sx, sy).
function canvas(sx, sy) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set([120, 120, 120, 255], p * 4);
  for (let y = sy; y < sy + 4; y++) {
    for (let x = sx; x < sx + 4; x++) {
      const v = (x * 7 + y * 13) % 2 ? 230 : 10;
      data.set([v, 255 - v, v, 255], (y * W + x) * 4);
    }
  }
  return data;
}

function square(x0, y0, s = 4) {
  const m = new Uint8Array(W * H);
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) m[y * W + x] = 1;
  return m;
}

function spread(data, mask) {
  let lo = 255,
    hi = 0;
  for (let p = 0; p < W * H; p++) {
    if (!mask[p]) continue;
    for (let c = 0; c < 3; c++) {
      lo = Math.min(lo, data[p * 4 + c]);
      hi = Math.max(hi, data[p * 4 + c]);
    }
  }
  return hi - lo;
}

function changed(a, b) {
  const out = [];
  for (let p = 0; p < W * H; p++) {
    for (let c = 0; c < 4; c++) {
      if (a[p * 4 + c] !== b[p * 4 + c]) {
        out.push(p);
        break;
      }
    }
  }
  return out;
}

test('TOOLS.patch follows the Healing Brush with the lasso-select icon', () => {
  const keys = Object.keys(TOOLS);
  assert.equal(keys[keys.indexOf('healingBrush') + 1], 'patch');
  assert.equal(TOOLS.patch.label, 'Patch');
  assert.equal(TOOLS.patch.icon, 'lasso-select');
  assert.ok(ICONS['lasso-select']);
});

test('the Patch options bar offers Source (default) and Destination only', () => {
  const row = TOOL_OPTION_SCHEMA.patch.find((f) => f.key === 'patchMode');
  assert.equal(row.type, 'iconButtons');
  assert.deepEqual(
    row.options.map((o) => o.value),
    ['source', 'destination']
  );
  for (const o of row.options) assert.ok(ICONS[o.icon], o.icon);
  assert.equal(defaultToolOptions().patch.patchMode, 'source');
});

test('patchOffset rounds the drag to whole pixels', () => {
  const bbox = { x: 8, y: 6, w: 4, h: 4 };
  assert.deepEqual(patchOffset([10, 8], [12.6, 6.4], bbox, W, H), [3, -2]);
  assert.deepEqual(patchOffset([10, 8], [10.2, 7.8], bbox, W, H), [0, 0]);
  assert.ok(!Object.is(patchOffset([10, 8], [9.8, 8], bbox, W, H)[0], -0));
  assert.deepEqual(patchOffset([0, 0], [5.5, 2], null, W, H), [6, 2]);
});

test('patchOffset keeps the selection bbox on the canvas at each edge', () => {
  const bbox = { x: 8, y: 6, w: 4, h: 4 };
  assert.deepEqual(patchOffset([10, 8], [-50, 8], bbox, W, H), [-8, 0]);
  assert.deepEqual(patchOffset([10, 8], [90, 8], bbox, W, H), [12, 0]);
  assert.deepEqual(patchOffset([10, 8], [10, -50], bbox, W, H), [0, -6]);
  assert.deepEqual(patchOffset([10, 8], [10, 90], bbox, W, H), [0, 6]);
  const wide = { x: 0, y: 0, w: W, h: 4 };
  assert.deepEqual(patchOffset([0, 0], [5, 3], wide, W, H), [0, 3]);
});

test('a Source patch dragged onto a flat area flattens the selected square only', () => {
  const src = canvas(4, 4);
  const dst = new Uint8ClampedArray(src);
  const sel = square(4, 4);
  const before = spread(src, sel);
  patchHeal(dst, src, W, H, sel, 12, 6, 'source');
  assert.ok(spread(dst, sel) < before / 4, `spread ${spread(dst, sel)} vs ${before}`);
  for (const p of changed(src, dst)) assert.equal(sel[p], 1, `pixel ${p} outside changed`);
});

test('a Destination patch writes only inside the offset square', () => {
  const src = canvas(4, 4);
  const dst = new Uint8ClampedArray(src);
  const sel = square(4, 4);
  patchHeal(dst, src, W, H, sel, 12, 6, 'destination');
  const target = square(16, 10);
  const diff = changed(src, dst);
  assert.ok(diff.length > 0);
  for (const p of diff) assert.equal(target[p], 1, `pixel ${p} outside the target changed`);
  assert.ok(spread(dst, target) > 50, 'the selected texture lands at the target');
});

test('a zero-offset patch release changes no pixels and pushes no undo', () => {
  const data = canvas(4, 4);
  const before = new Uint8ClampedArray(data);
  assert.equal(patchHeal(data, before, W, H, square(4, 4), 0, 0, 'source'), null);
  assert.deepEqual(data, before);

  const img = { data, width: W, height: H };
  const ctx = {
    canvas: { width: W, height: H },
    getImageData: () => img,
    putImageData() {
      throw new Error('no pixels should be written');
    }
  };
  const ov = {
    canvas: { width: W, height: H },
    clearRect() {},
    beginPath() {},
    rect() {},
    fill() {},
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {}
  };
  const undo = [];
  const sel = { mode: 'active', x: 4, y: 4, w: 4, h: 4, mask: square(4, 4) };
  const state = { sel, toolOptions: defaultToolOptions(), pushUndo: (l) => undo.push(l) };
  TOOLS.patch.onDown(ctx, ov, state, 5.5, 5.5);
  assert.ok(state.patchDrag, 'a press inside the selection drags the patch');
  TOOLS.patch.onMove(ctx, ov, state, 5.7, 5.4);
  TOOLS.patch.onUp(ctx, ov, state, 5.7, 5.4);
  assert.deepEqual(undo, []);
  assert.deepEqual(data, before);
  assert.equal(state.sel, sel);
});

test('a patch drag pushes Patch undo and heals; Shift starts a lasso instead', () => {
  const data = canvas(4, 4);
  const before = new Uint8ClampedArray(data);
  const img = { data, width: W, height: H };
  const ctx = {
    canvas: { width: W, height: H },
    getImageData: () => img,
    putImageData() {}
  };
  const ov = {
    canvas: { width: W, height: H },
    clearRect() {},
    beginPath() {},
    rect() {},
    fill() {},
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {}
  };
  const undo = [];
  const sel = { mode: 'active', x: 4, y: 4, w: 4, h: 4, mask: square(4, 4) };
  const state = { sel, toolOptions: defaultToolOptions(), pushUndo: (l) => undo.push(l) };
  TOOLS.patch.onDown(ctx, ov, state, 5, 5);
  TOOLS.patch.onMove(ctx, ov, state, 17, 11);
  TOOLS.patch.onUp(ctx, ov, state, 17, 11);
  assert.deepEqual(undo, ['Patch']);
  assert.ok(changed(before, data).length > 0);
  assert.equal(state.sel, sel);

  state.shiftKey = true;
  TOOLS.patch.onDown(ctx, ov, state, 5, 5);
  assert.equal(state.patchDrag, null);
  assert.equal(state.sel.mode, 'lasso-drawing');
});
