import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLevels, ADJUSTMENTS } from '../paint/adjustments.js';

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

test('levels is registered with black, gamma, and white fields', () => {
  const def = ADJUSTMENTS.levels;
  assert.equal(def.label, 'Levels');
  const byKey = Object.fromEntries(def.fields.map((f) => [f.key, f]));
  assert.equal(byKey.black.default, 0);
  assert.equal(byKey.gamma.default, 1);
  assert.equal(byKey.gamma.step, 0.01);
  assert.equal(byKey.white.default, 255);
});

test('defaults are a no-op', () => {
  const img = ramp([0, 1, 64, 128, 200, 255]);
  const before = img.data.slice();
  applyLevels(img, 0, 1, 255);
  assert.deepEqual(img.data, before);
});

test('black maps to 0, white maps to 255, and the range outside clips', () => {
  const img = ramp([0, 20, 50, 125, 200, 230, 255]);
  applyLevels(img, 50, 1, 200);
  assert.deepEqual(reds(img), [0, 0, 0, 128, 255, 255, 255]);
  assert.equal(img.data[3], 255, 'alpha untouched');
});

test('gamma 1 is linear between black and white', () => {
  const img = ramp([50, 80, 110, 140, 170, 200]);
  applyLevels(img, 50, 1, 200);
  assert.deepEqual(reds(img), [0, 51, 102, 153, 204, 255]);
});

test('gamma above 1 brightens the midpoint, below 1 darkens it', () => {
  const light = ramp([128]);
  applyLevels(light, 0, 2, 255);
  assert.ok(light.data[0] > 128, `gamma 2 brightens (${light.data[0]})`);
  const dark = ramp([128]);
  applyLevels(dark, 0, 0.5, 255);
  assert.ok(dark.data[0] < 128, `gamma 0.5 darkens (${dark.data[0]})`);
  const ends = ramp([0, 255]);
  applyLevels(ends, 0, 2, 255);
  assert.deepEqual(reds(ends), [0, 255], 'endpoints stay fixed');
});

test('pixels outside the mask are unchanged', () => {
  const img = ramp([100, 100, 100, 100]);
  const mask = new Uint8Array([1, 0, 1, 0]);
  applyLevels(img, 100, 1, 200, mask);
  assert.deepEqual(reds(img), [0, 100, 0, 100]);
});
