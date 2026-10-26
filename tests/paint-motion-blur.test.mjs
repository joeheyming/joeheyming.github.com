import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMotionBlur, ADJUSTMENTS } from '../paint/adjustments.js';

import { makeImage as image, px } from './paint-helpers.mjs';

function dot(W, H, x, y) {
  const img = image(W, H, [0, 0, 0, 255]);
  img.data.set([255, 255, 255, 255], (y * W + x) * 4);
  return img;
}

test('motionBlur is registered with angle and distance fields', () => {
  const def = ADJUSTMENTS.motionBlur;
  assert.equal(def.label, 'Motion Blur');
  assert.deepEqual(def.fields, [
    { key: 'angle', label: 'Angle', min: -180, max: 180, default: 0 },
    { key: 'distance', label: 'Distance', min: 1, max: 200, default: 10 }
  ]);
});

test('a flat image is unchanged', () => {
  const img = image(16, 12, [40, 120, 200, 255]);
  const before = img.data.slice();
  applyMotionBlur(img, 30, 7);
  assert.deepEqual(img.data, before);
});

test('a distance under 0.5 is a no-op', () => {
  const img = dot(9, 9, 4, 4);
  const before = img.data.slice();
  applyMotionBlur(img, 0, 0.4);
  assert.deepEqual(img.data, before);
});

test('angle 0 spreads a bright pixel only along its row', () => {
  const img = dot(21, 7, 10, 3);
  applyMotionBlur(img, 0, 6);
  for (let x = 0; x < 21; x++) {
    assert.equal(px(img, x, 2)[0], 0, `row above, x ${x}`);
    assert.equal(px(img, x, 4)[0], 0, `row below, x ${x}`);
  }
  assert.ok(px(img, 7, 3)[0] > 0 && px(img, 13, 3)[0] > 0, 'spreads left and right');
  assert.equal(px(img, 7, 3)[0], px(img, 13, 3)[0], 'symmetric');
  assert.equal(px(img, 5, 3)[0], 0, 'beyond the reach stays black');
});

test('angle 90 spreads a bright pixel only along its column', () => {
  const img = dot(7, 21, 3, 10);
  applyMotionBlur(img, 90, 6);
  for (let y = 0; y < 21; y++) {
    assert.equal(px(img, 2, y)[0], 0, `column left, y ${y}`);
    assert.equal(px(img, 4, y)[0], 0, `column right, y ${y}`);
  }
  assert.ok(px(img, 3, 7)[0] > 0 && px(img, 3, 13)[0] > 0, 'spreads up and down');
});

test('the row sum of a channel is preserved away from the edges', () => {
  const W = 40;
  const img = image(W, 3, [0, 0, 0, 255]);
  const values = [255, 90, 0, 180, 30];
  values.forEach((v, i) => img.data.set([v, v, v, 255], (1 * W + 15 + i) * 4));
  const before = values.reduce((a, b) => a + b, 0);
  applyMotionBlur(img, 0, 5);
  let after = 0;
  for (let x = 0; x < W; x++) after += px(img, x, 1)[0];
  assert.ok(Math.abs(after - before) <= 4, `sum ${after} vs ${before}`);
});

test('a transparent neighbor does not darken an opaque pixel', () => {
  const img = image(9, 1, [0, 0, 0, 0]);
  img.data.set([200, 50, 10, 255], 4 * 4);
  applyMotionBlur(img, 0, 4);
  const [r, g, b, a] = px(img, 4, 0);
  assert.deepEqual([r, g, b], [200, 50, 10]);
  assert.ok(a < 255 && a > 0, 'alpha spreads');
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 0], 'out of reach stays transparent');
});

test('a mask limits writes, but masked-out pixels are still read', () => {
  const W = 21;
  const img = dot(W, 3, 10, 1);
  const mask = new Uint8Array(W * 3);
  mask[1 * W + 11] = 1;
  applyMotionBlur(img, 0, 6, mask);
  assert.deepEqual(px(img, 10, 1), [255, 255, 255, 255], 'masked-out source untouched');
  assert.ok(px(img, 11, 1)[0] > 0, 'masked-in neighbor reads the masked-out pixel');
  assert.equal(px(img, 9, 1)[0], 0, 'masked-out neighbor untouched');
});
