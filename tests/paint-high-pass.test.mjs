import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHighPass, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

// Left half black, right half white.
function edge(W, H) {
  const img = image(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = W / 2; x < W; x++) img.data.set([255, 255, 255, 255], (y * W + x) * 4);
  }
  return img;
}

test('high pass is registered with a 1..32 radius field after sharpen', () => {
  const def = ADJUSTMENTS.highPass;
  assert.equal(def.label, 'High Pass');
  assert.deepEqual(def.fields, [{ key: 'radius', label: 'Radius', min: 1, max: 32, default: 10 }]);
  const img = image(4, 4, [10, 20, 30, 255]);
  def.apply(img, { radius: 2 }, null);
  assert.deepEqual(px(img, 1, 1), [128, 128, 128, 255]);
});

test('high pass of a flat image is mid gray (PhotoCraft high_pass_of_flat_is_mid_gray)', () => {
  const img = image(12, 10, [230, 26, 102, 255]);
  applyHighPass(img, 4);
  for (let i = 0; i < img.data.length; i += 4) {
    assert.deepEqual(Array.from(img.data.slice(i, i + 4)), [128, 128, 128, 255]);
  }
});

test('a vertical edge goes dark on the dark side and bright on the bright side', () => {
  const W = 40;
  const img = edge(W, 8);
  applyHighPass(img, 2);
  const y = 4;
  assert.ok(px(img, W / 2 - 1, y)[0] < 128);
  assert.ok(px(img, W / 2, y)[0] > 128);
  assert.deepEqual(px(img, 0, y), [128, 128, 128, 255]);
  assert.deepEqual(px(img, W - 1, y), [128, 128, 128, 255]);
});

test('alpha is preserved and alpha-0 pixels are left alone', () => {
  const img = edge(20, 6);
  img.data.set([200, 50, 25, 0], (3 * 20 + 10) * 4);
  for (let x = 0; x < 20; x++) img.data[(1 * 20 + x) * 4 + 3] = 180;
  applyHighPass(img, 2);
  assert.deepEqual(px(img, 10, 3), [200, 50, 25, 0]);
  for (let x = 0; x < 20; x++) assert.equal(px(img, x, 1)[3], 180);
});

test('a mask limits writes while masked-out pixels still feed the blur', () => {
  const W = 20;
  const H = 6;
  const img = edge(W, H);
  const before = img.data.slice();
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) mask[y * W + W / 2 - 1] = 1;
  applyHighPass(img, 2, mask);
  for (let p = 0; p < W * H; p++) {
    const got = Array.from(img.data.slice(p * 4, p * 4 + 4));
    if (mask[p]) assert.ok(got[0] < 128, `masked pixel ${p} should be dark of mid gray`);
    else assert.deepEqual(got, Array.from(before.slice(p * 4, p * 4 + 4)));
  }
  const full = edge(W, H);
  applyHighPass(full, 2);
  assert.deepEqual(px(img, W / 2 - 1, 3), px(full, W / 2 - 1, 3));
});
