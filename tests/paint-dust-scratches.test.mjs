import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDustScratches, applyMedian, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: W, height: H, data };
}

function clone(img) {
  return { width: img.width, height: img.height, data: img.data.slice() };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

function setPx(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

// Seeded LCG noise so the comparison is deterministic.
function noisy(W, H) {
  const img = image(W, H, [0, 0, 0, 0]);
  let s = 12345;
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    img.data[i] = s >>> 24;
  }
  return img;
}

const GRAY = [51, 51, 51, 255];
const WHITE = [255, 255, 255, 255];

test('dustScratches is registered with radius and threshold fields', () => {
  const adj = ADJUSTMENTS.dustScratches;
  assert.equal(adj.label, 'Dust & Scratches');
  assert.deepEqual(
    adj.fields.map((f) => [f.key, f.min, f.max, f.default]),
    [
      ['radius', 1, 100, 1],
      ['threshold', 0, 255, 0]
    ]
  );
  const img = image(21, 21, GRAY);
  setPx(img, 10, 10, WHITE);
  adj.apply(img, { radius: 1, threshold: 50 }, null);
  assert.deepEqual(px(img, 10, 10), GRAY);
});

test('radius 0 leaves the image unchanged', () => {
  const img = noisy(16, 16);
  const before = Array.from(img.data);
  applyDustScratches(img, 0, 0, null);
  assert.deepEqual(Array.from(img.data), before);
});

test('threshold 0 matches applyMedian exactly', () => {
  for (const r of [1, 2, 3]) {
    const a = noisy(24, 20);
    const b = clone(a);
    applyDustScratches(a, r, 0, null);
    applyMedian(b, r, null);
    assert.deepEqual(Array.from(a.data), Array.from(b.data), `radius ${r}`);
  }
});

test('threshold 255 leaves the image unchanged', () => {
  const img = noisy(16, 16);
  const before = Array.from(img.data);
  applyDustScratches(img, 3, 255, null);
  assert.deepEqual(Array.from(img.data), before);
});

test('a white speck on gray is removed at radius 1 / threshold 50', () => {
  const img = image(21, 21, GRAY);
  setPx(img, 10, 10, WHITE);
  applyDustScratches(img, 1, 50, null);
  assert.deepEqual(px(img, 10, 10), GRAY);
});

test('a pixel 10 levels off its median is kept at threshold 10, replaced at 9', () => {
  const base = image(9, 9, [100, 100, 100, 255]);
  setPx(base, 4, 4, [110, 110, 110, 255]);
  const keep = clone(base);
  applyDustScratches(keep, 1, 10, null);
  assert.deepEqual(px(keep, 4, 4), [110, 110, 110, 255]);
  const replace = clone(base);
  applyDustScratches(replace, 1, 9, null);
  assert.deepEqual(px(replace, 4, 4), [100, 100, 100, 255]);
});

test('a mask limits writes but masked-out pixels are still sampled', () => {
  const W = 9,
    H = 9;
  const img = image(W, H, GRAY);
  setPx(img, 4, 4, WHITE);
  setPx(img, 2, 2, WHITE);
  const mask = new Uint8Array(W * H);
  mask[4 * W + 4] = 1;
  mask[4 * W + 5] = 1;
  applyDustScratches(img, 1, 0, mask);
  assert.deepEqual(px(img, 4, 4), GRAY);
  assert.deepEqual(px(img, 2, 2), WHITE);
  // A masked-out white neighbour is sampled: (3, 3) under the mask would see it.
  const img2 = image(W, H, GRAY);
  for (const [x, y] of [
    [3, 3],
    [4, 3],
    [5, 3],
    [3, 4],
    [3, 5]
  ])
    setPx(img2, x, y, WHITE);
  const mask2 = new Uint8Array(W * H);
  mask2[4 * W + 4] = 1;
  applyDustScratches(img2, 1, 0, mask2);
  assert.deepEqual(px(img2, 4, 4), WHITE);
  assert.deepEqual(px(img2, 3, 3), WHITE);
});
