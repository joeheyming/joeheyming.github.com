import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGaussianBlur, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

test('gaussianBlur is registered with a 1..32 radius field', () => {
  const def = ADJUSTMENTS.gaussianBlur;
  assert.equal(def.label, 'Gaussian Blur');
  assert.deepEqual(def.fields, [{ key: 'radius', label: 'Radius', min: 1, max: 32, default: 4 }]);
});

test('a flat image is unchanged', () => {
  const img = image(16, 12, [40, 120, 200, 255]);
  const before = img.data.slice();
  applyGaussianBlur(img, 4);
  assert.deepEqual(img.data, before);
});

test('a single white pixel on black spreads to its neighbors', () => {
  const img = image(21, 21, [0, 0, 0, 255]);
  img.data.set([255, 255, 255, 255], (10 * 21 + 10) * 4);
  applyGaussianBlur(img, 2);
  const center = px(img, 10, 10)[0];
  const right = px(img, 11, 10)[0];
  const below = px(img, 10, 11)[0];
  assert.ok(center < 255, 'center dims');
  assert.ok(right > 0 && below > 0, 'neighbors brighten');
  assert.ok(right < center, 'falloff from center');
  assert.equal(right, below, 'symmetric');
  assert.equal(px(img, 10, 10)[3], 255, 'opaque stays opaque');
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 255], 'far corner untouched');
});

test('pixels outside the mask are unchanged', () => {
  const W = 21,
    H = 21;
  const img = image(W, H, [0, 0, 0, 255]);
  img.data.set([255, 255, 255, 255], (10 * W + 10) * 4);
  const mask = new Uint8Array(W * H);
  mask[10 * W + 11] = 1;
  applyGaussianBlur(img, 2, mask);
  assert.deepEqual(px(img, 10, 10), [255, 255, 255, 255], 'masked-out source kept');
  assert.deepEqual(px(img, 10, 11), [0, 0, 0, 255], 'masked-out neighbor kept');
  assert.ok(px(img, 11, 10)[0] > 0, 'masked-in neighbor blurred');
});

test('radius is clamped and a radius-32 blur of 256x256 is fast', () => {
  const img = image(256, 256, [0, 0, 0, 255]);
  for (let i = 0; i < img.data.length; i += 4 * 7) img.data[i] = 255;
  const t0 = performance.now();
  applyGaussianBlur(img, 500);
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `took ${ms.toFixed(0)}ms`);
});
