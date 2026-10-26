import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTwirl, ADJUSTMENTS } from '../paint/adjustments.js';

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

const noise = (x, y) => [(x * 37 + y * 11) % 256, (x * 5 + y * 71) % 256, (x * y * 13) % 256, 255];
const halves = (W) => (x) => x < W / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255];

test('twirl is registered with an angle field', () => {
  const def = ADJUSTMENTS.twirl;
  assert.equal(def.label, 'Twirl');
  assert.deepEqual(def.fields, [
    { key: 'angle', label: 'Angle', min: -999, max: 999, default: 50 }
  ]);
});

test('angle 0 leaves the image unchanged', () => {
  const img = image(9, 7, noise);
  const before = img.data.slice();
  applyTwirl(img, 0);
  assert.deepEqual(img.data, before);
});

test('a flat image is unchanged at any angle', () => {
  for (const angle of [50, -300, 999]) {
    const img = image(10, 8, () => [30, 140, 220, 180]);
    const before = img.data.slice();
    applyTwirl(img, angle);
    assert.deepEqual(img.data, before);
  }
});

test('corner pixels outside the inscribed ellipse are unchanged', () => {
  const W = 12,
    H = 8;
  const img = image(W, H, noise);
  const before = image(W, H, noise);
  applyTwirl(img, 270);
  for (const [x, y] of [
    [0, 0],
    [W - 1, 0],
    [0, H - 1],
    [W - 1, H - 1]
  ]) {
    assert.deepEqual(px(img, x, y), px(before, x, y));
  }
});

test('the centre pixel of an odd-sized image keeps its value', () => {
  const img = image(9, 7, noise);
  const want = px(img, 4, 3);
  applyTwirl(img, 180);
  assert.deepEqual(px(img, 4, 3), want);
});

test('a 180 degree twirl swaps colour near the centre but leaves corners alone', () => {
  const W = 20,
    H = 20;
  const img = image(W, H, halves(W));
  applyTwirl(img, 180);
  // Just left of centre is red; the spin pulls it from the blue side.
  assert.deepEqual(px(img, 9, 9), [0, 0, 255, 255]);
  assert.deepEqual(px(img, 10, 10), [255, 0, 0, 255]);
  assert.deepEqual(px(img, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(img, W - 1, H - 1), [0, 0, 255, 255]);
});

test('a mask limits writes but masked-out pixels are still sampled', () => {
  const W = 20,
    H = 20;
  const img = image(W, H, halves(W));
  const mask = new Uint8Array(W * H);
  mask[9 * W + 9] = 1;
  applyTwirl(img, 180, mask);
  assert.deepEqual(px(img, 9, 9), [0, 0, 255, 255]);
  assert.deepEqual(px(img, 10, 10), [0, 0, 255, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x === 9 && y === 9) continue;
      assert.deepEqual(px(img, x, y), halves(W)(x));
    }
  }
});
