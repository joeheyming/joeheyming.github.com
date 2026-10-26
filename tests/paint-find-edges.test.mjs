import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFindEdges, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set(fn(x, y), (y * W + x) * 4);
  }
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

// Left half 100, right half 160: a 60-level vertical step between x = 2 and 3.
const step = () => image(6, 3, (x) => (x < 3 ? [100, 100, 100, 50] : [160, 160, 160, 210]));

test('find edges is registered with no fields', () => {
  assert.equal(ADJUSTMENTS.findEdges.label, 'Find Edges');
  assert.deepEqual(ADJUSTMENTS.findEdges.fields, []);
});

test('a flat image becomes pure white with alpha kept', () => {
  const img = image(5, 4, () => [40, 200, 90, 77]);
  applyFindEdges(img);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 5; x++) assert.deepEqual(px(img, x, y), [255, 255, 255, 77]);
  }
});

test('a 60-level vertical step darkens the pixels beside it by 240', () => {
  const img = step();
  applyFindEdges(img);
  for (let y = 0; y < 3; y++) {
    assert.deepEqual(px(img, 2, y), [15, 15, 15, 50]);
    assert.deepEqual(px(img, 3, y), [15, 15, 15, 210]);
    for (const x of [0, 1, 4, 5]) assert.deepEqual(px(img, x, y).slice(0, 3), [255, 255, 255]);
  }
});

test('channels are processed independently', () => {
  // Only red steps; green and blue are flat, so they stay white.
  const img = image(6, 3, (x) => [x < 3 ? 100 : 160, 30, 220, 255]);
  applyFindEdges(img);
  assert.deepEqual(px(img, 2, 1), [15, 255, 255, 255]);
  assert.deepEqual(px(img, 0, 1), [255, 255, 255, 255]);
});

test('a mask limits writes but masked-out pixels are still read', () => {
  const img = step();
  const before = step();
  const mask = new Uint8Array(6 * 3);
  mask[1 * 6 + 2] = 1;
  applyFindEdges(img, mask);
  assert.deepEqual(px(img, 2, 1), [15, 15, 15, 50]);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 6; x++) {
      if (x === 2 && y === 1) continue;
      assert.deepEqual(px(img, x, y), px(before, x, y));
    }
  }
});
