import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBoxBlur, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

function dot(W, H, x, y) {
  const img = image(W, H, [0, 0, 0, 255]);
  img.data.set([255, 255, 255, 255], (y * W + x) * 4);
  return img;
}

test('boxBlur is registered with a radius field', () => {
  const def = ADJUSTMENTS.boxBlur;
  assert.equal(def.label, 'Box Blur');
  assert.deepEqual(def.fields, [{ key: 'radius', label: 'Radius', min: 1, max: 100, default: 5 }]);
});

test('a flat image is unchanged', () => {
  const img = image(16, 12, [40, 120, 200, 255]);
  const before = img.data.slice();
  applyBoxBlur(img, 4);
  assert.deepEqual(img.data, before);
});

test('radius 0 leaves the image unchanged', () => {
  const img = dot(9, 9, 4, 4);
  const before = img.data.slice();
  applyBoxBlur(img, 0);
  assert.deepEqual(img.data, before);
});

test('a white dot at radius 1 spreads evenly over its 3x3 block', () => {
  const img = dot(9, 9, 4, 4);
  applyBoxBlur(img, 1);
  const v = Math.round(255 / 9);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const inside = Math.abs(x - 4) <= 1 && Math.abs(y - 4) <= 1;
      const c = inside ? v : 0;
      assert.deepEqual(px(img, x, y), [c, c, c, 255], `pixel ${x},${y}`);
    }
  }
});

test('a fully transparent neighbor does not darken an opaque pixel', () => {
  const img = image(5, 5, [0, 0, 0, 0]);
  img.data.set([200, 50, 10, 255], (2 * 5 + 2) * 4);
  applyBoxBlur(img, 1);
  const [r, g, b, a] = px(img, 2, 2);
  assert.deepEqual([r, g, b], [200, 50, 10]);
  assert.equal(a, Math.round(255 / 9));
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 0]);
});

test('large radius stays fast', () => {
  const img = dot(256, 256, 128, 128);
  const t0 = performance.now();
  applyBoxBlur(img, 100);
  assert.ok(performance.now() - t0 < 1000);
});

test('the mask limits writes but masked-out pixels are still read', () => {
  const W = 9,
    H = 9;
  const img = dot(W, H, 4, 4);
  const mask = new Uint8Array(W * H);
  mask[4 * W + 5] = 1;
  applyBoxBlur(img, 1, mask);
  const v = Math.round(255 / 9);
  assert.deepEqual(px(img, 5, 4), [v, v, v, 255]);
  assert.deepEqual(px(img, 4, 4), [255, 255, 255, 255]);
  assert.deepEqual(px(img, 3, 4), [0, 0, 0, 255]);
});
