import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFragment, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square: 11 wide, 9 tall. (5, 4) is at least 4 px from every edge.
const W = 11;
const H = 9;

function image(fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(fill, p * 4);
  return { width: W, height: H, data };
}

const set = (img, x, y, px) => img.data.set(px, (y * W + x) * 4);
const pxAt = (img, x, y) => Array.from(img.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

function neighbours() {
  const img = image();
  set(img, 1, 4, [40, 0, 0, 255]);
  set(img, 9, 4, [0, 80, 0, 255]);
  set(img, 5, 0, [0, 0, 120, 255]);
  set(img, 5, 8, [200, 100, 20, 255]);
  return img;
}

test('fragment is registered with no fields and apply dispatches', () => {
  const def = ADJUSTMENTS.fragment;
  assert.equal(def.label, 'Fragment');
  assert.deepEqual(def.fields, []);
  const a = neighbours();
  const b = neighbours();
  def.apply(a, {}, null);
  applyFragment(b);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
});

test('a flat opaque interior pixel is unchanged', () => {
  const img = image([90, 120, 200, 255]);
  applyFragment(img);
  assert.deepEqual(pxAt(img, 5, 4), [90, 120, 200, 255]);
});

test('an interior pixel is the mean of the four 4-px offsets', () => {
  const img = neighbours();
  applyFragment(img);
  // r (40 + 200) / 4, g (80 + 100) / 4, b (120 + 20) / 4.
  assert.deepEqual(pxAt(img, 5, 4), [60, 45, 35, 255]);
});

test('colour is weighted by alpha and alpha is the plain mean', () => {
  const img = image();
  set(img, 1, 4, [200, 0, 0, 130]);
  set(img, 9, 4, [0, 0, 255, 0]);
  set(img, 5, 0, [0, 200, 0, 255]);
  set(img, 5, 8, [0, 200, 0, 255]);
  applyFragment(img);
  // Alpha sum 640: r 200 * 130 / 640, g 200 * 510 / 640, hidden blue ignored.
  assert.deepEqual(pxAt(img, 5, 4), [41, 159, 0, 160]);
});

test('four alpha-0 neighbours give transparent black', () => {
  const img = image();
  for (const [x, y] of [
    [1, 4],
    [9, 4],
    [5, 0],
    [5, 8]
  ]) {
    set(img, x, y, [50, 60, 70, 0]);
  }
  applyFragment(img);
  assert.deepEqual(pxAt(img, 5, 4), [0, 0, 0, 0]);
});

test('samples past the edge repeat the edge pixel, as PhotoCraft reads a layer', () => {
  const img = image();
  set(img, 0, 0, [100, 0, 0, 255]);
  set(img, 4, 0, [0, 100, 0, 255]);
  set(img, 0, 4, [0, 0, 100, 255]);
  applyFragment(img);
  // (-4, 0) and (0, -4) both clamp to (0, 0), so it counts twice and stays opaque.
  assert.deepEqual(pxAt(img, 0, 0), [50, 25, 25, 255]);
  const flat = image([90, 120, 200, 255]);
  applyFragment(flat);
  assert.deepEqual(pxAt(flat, W - 1, H - 1), [90, 120, 200, 255]);
});

test('the mask limits writes but covered pixels read uncovered neighbours', () => {
  const img = neighbours();
  const before = neighbours();
  const mask = new Uint8Array(W * H);
  mask[4 * W + 5] = 1;
  applyFragment(img, mask);
  assert.deepEqual(pxAt(img, 5, 4), [60, 45, 35, 255]);
  for (let p = 0; p < W * H; p++) {
    if (mask[p]) continue;
    const x = p % W;
    const y = (p - x) / W;
    assert.deepEqual(pxAt(img, x, y), pxAt(before, x, y));
  }
});
