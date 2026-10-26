import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAverage, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square: 3 wide, 2 tall.
const W = 3;
const H = 2;

function image(pixels, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  pixels.forEach((p, i) => data.set(p, i * 4));
  return { width: w, height: h, data };
}

const pxAt = (img, p) => Array.from(img.data.slice(p * 4, p * 4 + 4));

const RAMP = [
  [10, 20, 30, 255],
  [40, 50, 60, 255],
  [70, 80, 90, 255],
  [100, 110, 120, 255],
  [130, 140, 150, 255],
  [160, 170, 180, 255]
];

test('average is registered with no fields and apply dispatches', () => {
  const def = ADJUSTMENTS.average;
  assert.equal(def.label, 'Average');
  assert.deepEqual(def.fields, []);
  const a = image(RAMP);
  const b = image(RAMP);
  def.apply(a, {}, null);
  applyAverage(b);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
});

test('a flat image is unchanged', () => {
  const flat = Array(W * H).fill([90, 120, 200, 180]);
  const img = image(flat);
  applyAverage(img);
  assert.deepEqual(Array.from(img.data), Array.from(image(flat).data));
});

test('every pixel becomes the hand-computed mean', () => {
  const img = image(RAMP);
  applyAverage(img);
  for (let p = 0; p < W * H; p++) assert.deepEqual(pxAt(img, p), [85, 95, 105, 255]);
});

test('colour is alpha-weighted and alpha is the plain mean', () => {
  const img = image(
    [
      [200, 0, 0, 255],
      [0, 100, 0, 128],
      [50, 50, 50, 0]
    ],
    3,
    1
  );
  applyAverage(img);
  // Weights 255 + 128 + 0 = 383: R 200 * 255 / 383 = 133.2, G 100 * 128 / 383 = 33.4.
  // The alpha-0 grey adds nothing to the colour but counts toward alpha: 383 / 3 = 127.7.
  for (let p = 0; p < 3; p++) assert.deepEqual(pxAt(img, p), [133, 33, 0, 128]);
});

test('an all-transparent image is unchanged', () => {
  const clear = [
    [10, 20, 30, 0],
    [200, 0, 0, 0],
    [0, 0, 0, 0],
    [255, 255, 255, 0],
    [1, 2, 3, 0],
    [9, 9, 9, 0]
  ];
  const img = image(clear);
  applyAverage(img);
  assert.deepEqual(Array.from(img.data), Array.from(image(clear).data));
});

test('the mask limits both the pixels averaged and the pixels written', () => {
  const pixels = RAMP.slice();
  pixels[1] = [255, 255, 255, 0];
  pixels[3] = [0, 0, 0, 255];
  const img = image(pixels);
  const mask = new Uint8Array([1, 0, 1, 0, 1, 0]);
  applyAverage(img, mask);
  // Covered: 0, 2, 4 -> mean of [10, 20, 30], [70, 80, 90], [130, 140, 150].
  for (const p of [0, 2, 4]) assert.deepEqual(pxAt(img, p), [70, 80, 90, 255]);
  for (const p of [1, 3, 5]) assert.deepEqual(pxAt(img, p), pixels[p]);
});

test('a mask over only transparent pixels changes nothing', () => {
  const pixels = RAMP.slice();
  pixels[0] = [10, 20, 30, 0];
  const img = image(pixels);
  applyAverage(img, new Uint8Array([1, 0, 0, 0, 0, 0]));
  assert.deepEqual(Array.from(img.data), Array.from(image(pixels).data));
});
