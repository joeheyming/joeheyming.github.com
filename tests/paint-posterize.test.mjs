import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPosterize, ADJUSTMENTS } from '../paint/adjustments.js';

function image(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((rgba, p) => data.set(rgba, p * 4));
  return { width: pixels.length, height: 1, data };
}

function px(img, p) {
  return Array.from(img.data.slice(p * 4, p * 4 + 4));
}

function ramp() {
  const pixels = [];
  for (let v = 0; v < 256; v++) pixels.push([v, 255 - v, (v * 7) % 256, v]);
  return image(pixels);
}

test('posterize is registered with a 2..255 levels field', () => {
  const def = ADJUSTMENTS.posterize;
  assert.equal(def.label, 'Posterize');
  assert.deepEqual(def.fields, [
    { key: 'levels', label: 'Levels', min: 2, max: 255, step: 1, default: 4 }
  ]);
});

test('levels 2 maps every channel to 0 or 255', () => {
  const img = ramp();
  applyPosterize(img, 2);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) assert.ok(img.data[i + c] === 0 || img.data[i + c] === 255);
  }
  assert.deepEqual(px(img, 127).slice(0, 3), [0, 255, 0]);
  assert.deepEqual(px(img, 128).slice(0, 3), [255, 0, 255]);
});

test('levels 255 leaves pixels unchanged', () => {
  const img = ramp();
  const before = Array.from(img.data);
  applyPosterize(img, 255);
  assert.deepEqual(Array.from(img.data), before);
});

test('levels 4 follows the round-trip formula and alpha is preserved', () => {
  const img = ramp();
  applyPosterize(img, 4);
  for (let v = 0; v < 256; v++) {
    const want = Math.round((Math.round((v * 3) / 255) * 255) / 3);
    assert.equal(img.data[v * 4], want);
    assert.equal(img.data[v * 4 + 3], v);
  }
  assert.deepEqual(
    px(img, 100),
    [85, 170, 255, 100].map((x, i) => (i === 2 ? 170 : x))
  );
});

test('levels are clamped to 2..255', () => {
  const a = ramp();
  const b = ramp();
  applyPosterize(a, 0);
  applyPosterize(b, 2);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  const c = ramp();
  const before = Array.from(c.data);
  applyPosterize(c, 1000);
  assert.deepEqual(Array.from(c.data), before);
});

test('a mask limits the change', () => {
  const img = image([
    [100, 150, 200, 255],
    [100, 150, 200, 255]
  ]);
  applyPosterize(img, 2, new Uint8Array([0, 1]));
  assert.deepEqual(px(img, 0), [100, 150, 200, 255]);
  assert.deepEqual(px(img, 1), [0, 255, 255, 255]);
});
