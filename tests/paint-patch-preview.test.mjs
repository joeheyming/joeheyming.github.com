import test from 'node:test';
import assert from 'node:assert/strict';

import { healCoarse, patchHeal, patchPreview, seamlessClone } from '../paint/retouch.js';
import { TOOLS, defaultToolOptions } from '../paint/tools.js';

const W = 32,
  H = 24;

// A grey-blue gradient canvas with a 6x6 noisy blemish at (sx, sy).
function canvas(sx, sy) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set([80 + x * 3, 100 + y * 2, 140, 255], (y * W + x) * 4);
  }
  for (let y = sy; y < sy + 6; y++) {
    for (let x = sx; x < sx + 6; x++) {
      const v = (x * 7 + y * 13) % 2 ? 240 : 10;
      data.set([v, 255 - v, v, 255], (y * W + x) * 4);
    }
  }
  return data;
}

function square(x0, y0, s = 6) {
  const m = new Uint8Array(W * H);
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) m[y * W + x] = 1;
  return m;
}

test('healCoarse at step 1 is seamlessClone', () => {
  const w = 12,
    h = 10,
    ch = 2;
  const src = Float32Array.from({ length: w * h * ch }, (_, i) => ((i * 37) % 11) / 11);
  const dst = Float32Array.from({ length: w * h * ch }, (_, i) => ((i * 13) % 7) / 7);
  const mask = new Uint8Array(w * h);
  for (let y = 2; y < 8; y++) for (let x = 3; x < 9; x++) mask[y * w + x] = 1;
  assert.deepEqual(
    healCoarse(w, h, ch, src, dst, mask, 1),
    seamlessClone(w, h, ch, src, dst, mask)
  );
});

test('a step-4 heal of a linear ramp with a flat source stays on the ramp', () => {
  const w = 64,
    h = 48;
  const ramp = (x, y) => 0.1 + (0.8 * (x + 0.5)) / w + (0.05 * (y + 0.5)) / h;
  const dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[y * w + x] = ramp(x, y);
  const src = new Float32Array(w * h).fill(0.5);
  const mask = new Uint8Array(w * h);
  for (let y = 8; y < 40; y++) for (let x = 8; x < 56; x++) mask[y * w + x] = 1;
  const out = healCoarse(w, h, 1, src, dst, mask, 4);
  let worst = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) worst = Math.max(worst, Math.abs(out[y * w + x] - ramp(x, y)));
  }
  assert.ok(worst < 0.02, `worst error ${worst}`);
});

for (const mode of ['source', 'destination']) {
  test(`patchPreview with room for the full grid equals the committed ${mode} patch`, () => {
    const src = canvas(4, 4);
    const before = new Uint8ClampedArray(src);
    const mask = square(4, 4);
    const pv = patchPreview(src, W, H, mask, 14, 9, mode, 1 << 20);
    assert.ok(pv);
    assert.deepEqual(src, before, 'src is not written');
    const dst = new Uint8ClampedArray(src);
    const box = patchHeal(dst, src, W, H, mask, 14, 9, mode);
    assert.deepEqual(pv.box, box);
    const [x0, y0, x1, y1] = box;
    assert.equal(pv.data.length, (x1 - x0) * (y1 - y0) * 4);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4,
          r = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
        assert.deepEqual([...pv.data.subarray(r, r + 4)], [...dst.subarray(i, i + 4)]);
      }
    }
  });
}

test('patchPreview returns null at a zero offset and never writes src', () => {
  const src = canvas(4, 4);
  const before = new Uint8ClampedArray(src);
  assert.equal(patchPreview(src, W, H, square(4, 4), 0, 0, 'source'), null);
  assert.ok(patchPreview(src, W, H, square(4, 4), 10, 0, 'source', 4));
  assert.deepEqual(src, before);
});

test('dragging the patch draws the preview under the outline; release commits patchHeal', () => {
  const data = canvas(4, 4);
  const before = new Uint8ClampedArray(data);
  const img = { data, width: W, height: H };
  const writes = [];
  const ctx = {
    canvas: { width: W, height: H },
    getImageData: () => img,
    putImageData: () => writes.push('layer')
  };
  const calls = [];
  const ov = {
    canvas: { width: W, height: H },
    clearRect: () => calls.push('clear'),
    beginPath() {},
    rect() {},
    fill: () => calls.push('outline'),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: (im, x, y) => calls.push(['preview', x, y, im.width, im.height])
  };
  const undo = [];
  const mask = square(4, 4);
  const sel = { mode: 'active', x: 4, y: 4, w: 6, h: 6, mask };
  const state = { sel, toolOptions: defaultToolOptions(), pushUndo: (l) => undo.push(l) };
  TOOLS.patch.onDown(ctx, ov, state, 6, 6);
  calls.length = 0;
  TOOLS.patch.onMove(ctx, ov, state, 6.2, 6.1);
  assert.deepEqual(calls, [], 'an unchanged offset redraws nothing');
  TOOLS.patch.onMove(ctx, ov, state, 20, 15);
  const expected = patchPreview(before, W, H, mask, 14, 9, 'source');
  const [x0, y0, x1, y1] = expected.box;
  assert.deepEqual(calls, ['clear', ['preview', x0, y0, x1 - x0, y1 - y0], 'outline', 'outline']);
  assert.deepEqual(state.patchDrag.preview, expected);
  assert.deepEqual(data, before, 'the layer is untouched while dragging');
  assert.deepEqual(undo, []);

  calls.length = 0;
  TOOLS.patch.onMove(ctx, ov, state, 6, 6);
  assert.deepEqual(calls, ['clear', 'outline', 'outline'], 'a zero offset shows only the outline');

  TOOLS.patch.onMove(ctx, ov, state, 20, 15);
  TOOLS.patch.onUp(ctx, ov, state, 20, 15);
  assert.deepEqual(undo, ['Patch']);
  const exact = new Uint8ClampedArray(before);
  patchHeal(exact, before, W, H, mask, 14, 9, 'source');
  assert.deepEqual(data, exact);
});
