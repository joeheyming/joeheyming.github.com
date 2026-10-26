import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUnsharpMask, applyGaussianBlur, ADJUSTMENTS } from '../paint/adjustments.js';

import { makeImage as image, px } from './paint-helpers.mjs';

// Left half gray `lo`, right half gray `hi`.
function edge(W, H, lo, hi) {
  const img = image(W, H, [lo, lo, lo, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = W / 2; x < W; x++) img.data.set([hi, hi, hi, 255], (y * W + x) * 4);
  }
  return img;
}

// Deterministic noise from a small LCG.
function noisy(W, H, seed) {
  const img = image(W, H, [0, 0, 0, 255]);
  let s = seed;
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      s = (s * 1103515245 + 12345) >>> 0;
      img.data[i + c] = (s >>> 16) & 255;
    }
  }
  return img;
}

function blurOf(img, radius) {
  const b = { width: img.width, height: img.height, data: img.data.slice() };
  applyGaussianBlur(b, radius);
  return b.data;
}

const copy = (img) => ({ width: img.width, height: img.height, data: img.data.slice() });

test('unsharp mask is registered with PhotoCraft defaults', () => {
  const def = ADJUSTMENTS.unsharpMask;
  assert.equal(def.label, 'Unsharp Mask');
  assert.deepEqual(def.fields, [
    { key: 'amount', label: 'Amount', min: 1, max: 500, default: 50 },
    { key: 'radius', label: 'Radius', min: 1, max: 32, default: 1 },
    { key: 'threshold', label: 'Threshold', min: 0, max: 255, default: 0 }
  ]);
  const a = edge(20, 6, 60, 190);
  const b = edge(20, 6, 60, 190);
  def.apply(a, { amount: 150, radius: 2, threshold: 5 }, null);
  applyUnsharpMask(b, 150, 2, 5);
  assert.deepEqual(a.data, b.data);
});

test('a flat image is unchanged', () => {
  const img = image(12, 10, [230, 26, 102, 255]);
  const before = img.data.slice();
  applyUnsharpMask(img, 300, 4, 0);
  assert.deepEqual(img.data, before);
});

test('threshold 0 matches orig + k * (orig - blurred)', () => {
  const src = noisy(24, 18, 7);
  const b = blurOf(src, 3);
  const img = copy(src);
  applyUnsharpMask(img, 175, 3, 0);
  for (let i = 0; i < src.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const o = src.data[i + c];
      const want = Math.min(255, Math.max(0, Math.round(o + 1.75 * (o - b[i + c]))));
      assert.equal(img.data[i + c], want, `byte ${i + c}`);
    }
    assert.equal(img.data[i + 3], 255);
  }
});

test('a threshold above every |d| is a no-op', () => {
  const src = noisy(16, 12, 3);
  const b = blurOf(src, 2);
  let maxD = 0;
  for (let i = 0; i < src.data.length; i += 4) {
    for (let c = 0; c < 3; c++) maxD = Math.max(maxD, Math.abs(src.data[i + c] - b[i + c]));
  }
  assert.ok(maxD < 255);
  const img = copy(src);
  applyUnsharpMask(img, 300, 2, maxD + 1);
  assert.deepEqual(img.data, src.data);
});

test('the threshold boundary is inclusive', () => {
  const src = noisy(16, 12, 11);
  const b = blurOf(src, 2);
  const i = (6 * 16 + 8) * 4;
  const d = src.data[i] - b[i];
  assert.ok(Math.abs(d) >= 2, `pick a pixel with a usable difference, got ${d}`);
  const o = src.data[i];
  const sharpened = Math.min(255, Math.max(0, Math.round(o + 2 * d)));
  assert.notEqual(sharpened, o);

  const at = copy(src);
  applyUnsharpMask(at, 200, 2, Math.abs(d));
  assert.equal(at.data[i], sharpened);

  const above = copy(src);
  applyUnsharpMask(above, 200, 2, Math.abs(d) + 1);
  assert.equal(above.data[i], o);
});

test('a dark/light edge gains contrast and far pixels are unchanged', () => {
  const W = 40;
  const img = edge(W, 8, 80, 170);
  applyUnsharpMask(img, 100, 2, 0);
  const y = 4;
  assert.ok(px(img, W / 2 - 1, y)[0] < 80);
  assert.ok(px(img, W / 2, y)[0] > 170);
  assert.deepEqual(px(img, 0, y), [80, 80, 80, 255]);
  assert.deepEqual(px(img, W - 1, y), [170, 170, 170, 255]);
});

test('alpha is preserved and alpha-0 pixels are left alone', () => {
  const img = edge(20, 6, 40, 210);
  img.data.set([200, 50, 25, 0], (3 * 20 + 10) * 4);
  for (let x = 0; x < 20; x++) img.data[(1 * 20 + x) * 4 + 3] = 180;
  applyUnsharpMask(img, 200, 2, 0);
  assert.deepEqual(px(img, 10, 3), [200, 50, 25, 0]);
  for (let x = 0; x < 20; x++) assert.equal(px(img, x, 1)[3], 180);
});

test('a mask limits writes while masked-out pixels still feed the blur', () => {
  const W = 20;
  const H = 6;
  const img = edge(W, H, 80, 170);
  const before = img.data.slice();
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) mask[y * W + W / 2 - 1] = 1;
  applyUnsharpMask(img, 100, 2, 0, mask);
  for (let p = 0; p < W * H; p++) {
    const got = Array.from(img.data.slice(p * 4, p * 4 + 4));
    if (mask[p]) assert.ok(got[0] < 80, `masked pixel ${p} should darken`);
    else assert.deepEqual(got, Array.from(before.slice(p * 4, p * 4 + 4)));
  }
  const full = edge(W, H, 80, 170);
  applyUnsharpMask(full, 100, 2, 0);
  assert.deepEqual(px(img, W / 2 - 1, 3), px(full, W / 2 - 1, 3));
});
