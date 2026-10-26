import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLevels, levelsGamma, ADJUSTMENTS } from '../paint/adjustments.js';
import { defaultAdjustmentParams } from '../paint/adjustment-layers.js';

// One pixel per gray value in `values`, fully opaque.
function ramp(values) {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((v, p) => data.set([v, v, v, 255], p * 4));
  return { width: values.length, height: 1, data };
}

function reds(img) {
  const out = [];
  for (let i = 0; i < img.data.length; i += 4) out.push(img.data[i]);
  return out;
}

test('levels fields are input black, gamma, input white, output black, output white', () => {
  const fields = ADJUSTMENTS.levels.fields.filter((f) => f.group?.value === 'rgb');
  assert.deepEqual(
    fields.map((f) => f.key),
    ['black', 'gamma', 'white', 'outBlack', 'outWhite']
  );
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  assert.deepEqual([byKey.black.min, byKey.black.max, byKey.black.default], [0, 254, 0]);
  assert.deepEqual(
    [byKey.gamma.min, byKey.gamma.max, byKey.gamma.step, byKey.gamma.default],
    [0.01, 9.99, 0.01, 1]
  );
  assert.deepEqual([byKey.white.min, byKey.white.max, byKey.white.default], [1, 255, 255]);
  assert.deepEqual([byKey.outBlack.min, byKey.outBlack.max, byKey.outBlack.default], [0, 255, 0]);
  assert.deepEqual([byKey.outWhite.min, byKey.outWhite.max, byKey.outWhite.default], [0, 255, 255]);
  assert.equal(byKey.outBlack.label, 'Output black');
  assert.equal(byKey.outWhite.label, 'Output white');
});

test('default levels params include the output range', () => {
  const { black, gamma, white, outBlack, outWhite } = defaultAdjustmentParams('levels');
  assert.deepEqual(
    { black, gamma, white, outBlack, outWhite },
    {
      black: 0,
      gamma: 1,
      white: 255,
      outBlack: 0,
      outWhite: 255
    }
  );
});

test('levelsGamma is u^(1/g) at or below 1 and pins the toe ends above 1', () => {
  for (const u of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
    assert.ok(Math.abs(levelsGamma(u, 0.5) - u * u) < 1e-12, `u=${u}`);
    assert.ok(Math.abs(levelsGamma(u, 1) - u) < 1e-12, `identity u=${u}`);
  }
  assert.equal(levelsGamma(0, 2.5), 0);
  assert.ok(Math.abs(levelsGamma(1, 2.5) - 1) < 5e-4);
  // The toe starts at slope 2^g, below the infinitely steep power curve.
  const h = 1e-6;
  assert.ok(Math.abs(levelsGamma(h, 2) / h - 4) < 1e-3);
});

test('levels matches Photoshop at gamma 2.0 within 4 and gamma 0.5 exactly', () => {
  const xs = [1, 8, 16, 32, 64, 128, 192, 224];
  const want = [4, 30, 55, 90, 128, 181, 221, 239];
  const img = ramp(xs);
  applyLevels(img, 0, 2, 255);
  reds(img).forEach((got, i) => assert.ok(Math.abs(got - want[i]) <= 4, `x=${xs[i]}: ${got}`));
  const half = [0, 32, 64, 128, 192, 255];
  const dark = ramp(half);
  applyLevels(dark, 0, 0.5, 255);
  assert.deepEqual(
    reds(dark),
    half.map((x) => Math.round((x / 255) ** 2 * 255))
  );
});

test('levels works on whole levels: 44..214 at gamma 1.78 matches Photoshop within 1', () => {
  const xs = [44, 45, 46, 47, 48, 52, 69, 100, 214];
  const want = [0, 7, 10, 17, 20, 37, 88, 137, 255];
  const img = ramp(xs);
  applyLevels(img, 44, 1.78, 214);
  reds(img).forEach((got, i) => assert.ok(Math.abs(got - want[i]) <= 1, `x=${xs[i]}: ${got}`));
});

test('output black and white set the output range', () => {
  const img = ramp([0, 51, 102, 255]);
  applyLevels(img, 0, 1, 255, null, 50, 200);
  assert.deepEqual(reds(img), [50, 80, 110, 200]);
  const inverted = ramp([0, 255]);
  applyLevels(inverted, 0, 1, 255, null, 255, 0);
  assert.deepEqual(reds(inverted), [255, 0]);
  const viaRegistry = ramp([0, 255]);
  ADJUSTMENTS.levels.apply(
    viaRegistry,
    { black: 0, gamma: 1, white: 255, outBlack: 48, outWhite: 213 },
    null
  );
  assert.deepEqual(reds(viaRegistry), [48, 213]);
});

test('old params without an output range behave as 0..255', () => {
  const a = ramp([0, 30, 128, 255]);
  const b = ramp([0, 30, 128, 255]);
  ADJUSTMENTS.levels.apply(a, { black: 10, gamma: 1.5, white: 240 }, null);
  applyLevels(b, 10, 1.5, 240, null, 0, 255);
  assert.deepEqual(a.data, b.data);
});

test('alpha, transparent pixels, and masked-out pixels are untouched', () => {
  const img = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([100, 100, 100, 128, 100, 100, 100, 0, 100, 100, 100, 255])
  };
  applyLevels(img, 0, 1, 255, new Uint8Array([1, 1, 0]), 0, 0);
  assert.deepEqual(Array.from(img.data), [0, 0, 0, 128, 100, 100, 100, 0, 100, 100, 100, 255]);
});
