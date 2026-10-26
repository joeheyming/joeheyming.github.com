import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMedian, ADJUSTMENTS } from '../paint/adjustments.js';

import { makeImage as image, px } from './paint-helpers.mjs';

const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

function setPx(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

// Direct reference: sort the whole disc per channel, outside reads 0.
function referenceMedian(img, r) {
  const { width: W, height: H, data } = img;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 4; c++) {
        const vals = [];
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r + r) continue;
            const sx = x + dx,
              sy = y + dy;
            vals.push(sx < 0 || sx >= W || sy < 0 || sy >= H ? 0 : data[(sy * W + sx) * 4 + c]);
          }
        }
        vals.sort((a, b) => a - b);
        out[(y * W + x) * 4 + c] = vals[vals.length >> 1];
      }
    }
  }
  return out;
}

function noise(W, H, seed) {
  const img = image(W, H, [0, 0, 0, 0]);
  let s = seed;
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    img.data[i] = s >>> 24;
  }
  return img;
}

test('median is registered with a radius field', () => {
  const def = ADJUSTMENTS.median;
  assert.equal(def.label, 'Median');
  assert.deepEqual(def.fields, [{ key: 'radius', label: 'Radius', min: 1, max: 100, default: 1 }]);
});

test('radius 0 leaves the image unchanged', () => {
  const img = noise(9, 7, 3);
  const before = img.data.slice();
  applyMedian(img, 0);
  assert.deepEqual(img.data, before);
});

test('a single white pixel on black disappears at radius 1', () => {
  const img = image(9, 9, BLACK);
  setPx(img, 4, 4, WHITE);
  applyMedian(img, 1);
  assert.deepEqual(px(img, 4, 4), BLACK);
});

test('an interior pixel of a flat image keeps its value', () => {
  const img = image(12, 12, [40, 120, 200, 255]);
  applyMedian(img, 3);
  assert.deepEqual(px(img, 6, 6), [40, 120, 200, 255]);
});

test('a vertical edge stays sharp at radius 2', () => {
  const W = 16,
    H = 16;
  const img = image(W, H, BLACK);
  for (let y = 0; y < H; y++) for (let x = 8; x < W; x++) setPx(img, x, y, WHITE);
  const before = image(W, H, BLACK);
  before.data.set(img.data);
  applyMedian(img, 2);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++)
      assert.deepEqual(px(img, x, y), px(before, x, y), `(${x},${y})`);
  }
});

test('the radius 1 window is the full 3x3 square', () => {
  const five = image(7, 7, BLACK);
  for (const [x, y] of [
    [2, 2],
    [4, 2],
    [2, 4],
    [4, 4],
    [3, 3]
  ])
    setPx(five, x, y, WHITE);
  applyMedian(five, 1);
  assert.deepEqual(px(five, 3, 3), WHITE);

  const four = image(7, 7, BLACK);
  for (const [x, y] of [
    [2, 2],
    [4, 2],
    [2, 4],
    [4, 4]
  ])
    setPx(four, x, y, WHITE);
  applyMedian(four, 1);
  assert.deepEqual(px(four, 3, 3), BLACK);
});

test('matches a direct sort of the disc, borders included', () => {
  for (const r of [1, 2, 3, 5]) {
    const img = noise(13, 11, 7 + r);
    const expected = referenceMedian(img, r);
    applyMedian(img, r);
    assert.deepEqual(img.data, expected, `radius ${r}`);
  }
});

test('radius 10 on 256x256 finishes in under 2 seconds', () => {
  const img = noise(256, 256, 1);
  const t0 = performance.now();
  applyMedian(img, 10);
  assert.ok(performance.now() - t0 < 2000);
});

test('a mask limits the change but masked-out pixels are still sampled', () => {
  const W = 9,
    H = 9;
  const img = image(W, H, BLACK);
  // A 3x3 white block plus a lone white pixel; only (4,4) and (4,1) are selected.
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) setPx(img, x, y, WHITE);
  setPx(img, 4, 1, WHITE);
  const mask = new Uint8Array(W * H);
  mask[4 * W + 4] = 1;
  mask[1 * W + 4] = 1;
  applyMedian(img, 1, mask);
  // Inside the mask: the lone white pixel goes black; the block centre stays white
  // because its masked-out neighbours were sampled.
  assert.deepEqual(px(img, 4, 1), BLACK);
  assert.deepEqual(px(img, 4, 4), WHITE);
  // Outside the mask: the block corner would turn black but keeps its value.
  assert.deepEqual(px(img, 3, 3), WHITE);
});
