import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySmartSharpen, applyGaussianBlur, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

// Left half gray `lo`, right half gray `hi`.
function edge(W, H, lo, hi) {
  const img = image(W, H, [lo, lo, lo, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = W / 2; x < W; x++) img.data.set([hi, hi, hi, 255], (y * W + x) * 4);
  }
  return img;
}

test('smart sharpen is registered with PhotoCraft defaults', () => {
  const def = ADJUSTMENTS.smartSharpen;
  assert.equal(def.label, 'Smart Sharpen');
  assert.deepEqual(def.fields, [
    { key: 'amount', label: 'Amount', min: 1, max: 500, default: 100 },
    { key: 'radius', label: 'Radius', min: 1, max: 64, default: 1 },
    { key: 'reduceNoise', label: 'Reduce Noise', min: 0, max: 100, default: 10 }
  ]);
  const a = edge(20, 6, 60, 190);
  const b = edge(20, 6, 60, 190);
  def.apply(a, { amount: 150, radius: 2, reduceNoise: 20 }, null);
  applySmartSharpen(b, 150, 2, 20);
  assert.deepEqual(a.data, b.data);
});

test('a flat image is unchanged', () => {
  const img = image(12, 10, [230, 26, 102, 255]);
  const before = img.data.slice();
  applySmartSharpen(img, 300, 4, 10);
  assert.deepEqual(img.data, before);
});

test('a dark/light edge gains contrast and far pixels are unchanged', () => {
  const W = 40;
  const img = edge(W, 8, 80, 170);
  applySmartSharpen(img, 100, 2, 10);
  const y = 4;
  assert.ok(px(img, W / 2 - 1, y)[0] < 80);
  assert.ok(px(img, W / 2, y)[0] > 170);
  assert.deepEqual(px(img, 0, y), [80, 80, 80, 255]);
  assert.deepEqual(px(img, W - 1, y), [170, 170, 170, 255]);
});

test('reduceNoise 0 matches the unsharp formula', () => {
  const W = 24;
  const H = 6;
  const src = edge(W, H, 70, 160);
  for (let x = 0; x < W; x++) src.data[(2 * W + x) * 4 + 1] = (x * 37) % 256;
  const blurred = { width: W, height: H, data: src.data.slice() };
  applyGaussianBlur(blurred, 3);
  const img = { width: W, height: H, data: src.data.slice() };
  applySmartSharpen(img, 250, 3, 0);
  for (let i = 0; i < src.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const o = src.data[i + c];
      const want = Math.min(255, Math.max(0, Math.round(o + 2.5 * (o - blurred.data[i + c]))));
      assert.equal(img.data[i + c], want, `byte ${i + c}`);
    }
    assert.equal(img.data[i + 3], 255);
  }
});

test('reduceNoise 100 leaves a 1-level difference almost untouched but sharpens a big edge', () => {
  // A one-level speck: the u8 blur rounds back to 100, so d = 1 at the speck.
  const speck = (reduceNoise) => {
    const img = image(9, 9, [100, 100, 100, 255]);
    img.data.set([101, 101, 101, 255], (4 * 9 + 4) * 4);
    applySmartSharpen(img, 100, 1, reduceNoise);
    return px(img, 4, 4)[0];
  };
  assert.equal(speck(0), 102);
  assert.equal(speck(100), 101);

  const W = 30;
  const big = edge(W, 6, 60, 190);
  applySmartSharpen(big, 100, 2, 100);
  assert.ok(px(big, W / 2 - 1, 3)[0] < 60);
  assert.ok(px(big, W / 2, 3)[0] > 190);
});

test('alpha is preserved and alpha-0 pixels are left alone', () => {
  const img = edge(20, 6, 40, 210);
  img.data.set([200, 50, 25, 0], (3 * 20 + 10) * 4);
  for (let x = 0; x < 20; x++) img.data[(1 * 20 + x) * 4 + 3] = 180;
  applySmartSharpen(img, 200, 2, 10);
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
  applySmartSharpen(img, 100, 2, 10, mask);
  for (let p = 0; p < W * H; p++) {
    const got = Array.from(img.data.slice(p * 4, p * 4 + 4));
    if (mask[p]) assert.ok(got[0] < 80, `masked pixel ${p} should darken`);
    else assert.deepEqual(got, Array.from(before.slice(p * 4, p * 4 + 4)));
  }
  const full = edge(W, H, 80, 170);
  applySmartSharpen(full, 100, 2, 10);
  assert.deepEqual(px(img, W / 2 - 1, 3), px(full, W / 2 - 1, 3));
});
