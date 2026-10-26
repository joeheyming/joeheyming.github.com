import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySolarize, ADJUSTMENTS } from '../paint/adjustments.js';

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

const expected = (v) => (v >= 128 ? 255 - v : v);

// One pixel per value 0..255, gray, with a distinct alpha each.
const ramp = () => image(256, 1, (x) => [x, x, x, 255 - x]);

test('solarize is registered with no fields and apply dispatches', () => {
  assert.equal(ADJUSTMENTS.solarize.label, 'Solarize');
  assert.deepEqual(ADJUSTMENTS.solarize.fields, []);
  const img = ramp();
  ADJUSTMENTS.solarize.apply(img, {}, null);
  assert.deepEqual(px(img, 200, 0), [55, 55, 55, 55]);
});

test('every channel value 0..255 maps v >= 128 to 255 - v', () => {
  const img = ramp();
  applySolarize(img);
  for (let v = 0; v < 256; v++) {
    const e = expected(v);
    assert.deepEqual(px(img, v, 0), [e, e, e, 255 - v], `value ${v}`);
  }
  assert.equal(px(img, 127, 0)[0], 127);
  assert.equal(px(img, 128, 0)[0], 127);
  assert.equal(px(img, 255, 0)[0], 0);
  assert.equal(px(img, 0, 0)[0], 0);
});

test('channels are handled independently on a mixed pixel', () => {
  const img = image(1, 1, () => [200, 127, 128, 90]);
  applySolarize(img);
  assert.deepEqual(px(img, 0, 0), [55, 127, 127, 90]);
});

test('alpha is preserved, including alpha 0', () => {
  const img = image(2, 1, (x) => (x === 0 ? [250, 10, 140, 0] : [250, 10, 140, 255]));
  applySolarize(img);
  assert.deepEqual(px(img, 0, 0), [5, 10, 115, 0]);
  assert.deepEqual(px(img, 1, 0), [5, 10, 115, 255]);
});

test('applying twice equals applying once and output never exceeds 127', () => {
  const once = ramp();
  applySolarize(once);
  for (let i = 0; i < once.data.length; i += 4) {
    for (let c = 0; c < 3; c++) assert.ok(once.data[i + c] <= 127);
  }
  const twice = ramp();
  applySolarize(twice);
  applySolarize(twice);
  assert.deepEqual(Array.from(twice.data), Array.from(once.data));
});

test('a mask limits the change', () => {
  const img = image(3, 2, () => [220, 30, 180, 128]);
  const mask = new Uint8Array([1, 0, 1, 0, 1, 0]);
  applySolarize(img, mask);
  for (let p = 0; p < 6; p++) {
    const want = mask[p] ? [35, 30, 75, 128] : [220, 30, 180, 128];
    assert.deepEqual(px(img, p % 3, Math.floor(p / 3)), want);
  }
});
