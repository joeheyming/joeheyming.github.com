import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySharpen, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

// Left half dark gray, right half light gray, so both sides have headroom.
function edge(W, H) {
  const img = image(W, H, [64, 64, 64, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = W / 2; x < W; x++) img.data.set([192, 192, 192, 255], (y * W + x) * 4);
  }
  return img;
}

test('sharpen is registered with a 0..100 amount field', () => {
  const def = ADJUSTMENTS.sharpen;
  assert.equal(def.label, 'Sharpen');
  assert.deepEqual(def.fields, [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 50 }]);
});

test('amount 0 is a no-op', () => {
  const img = edge(16, 8);
  const before = img.data.slice();
  applySharpen(img, 0);
  assert.deepEqual(img.data, before);
});

test('a flat image stays flat', () => {
  const img = image(16, 12, [40, 120, 200, 255]);
  const before = img.data.slice();
  applySharpen(img, 100);
  assert.deepEqual(img.data, before);
});

test('a hard edge gains local contrast', () => {
  const img = edge(16, 8);
  applySharpen(img, 100);
  const dark = px(img, 7, 4)[0];
  const light = px(img, 8, 4)[0];
  assert.ok(dark < 64, `dark side darkens (${dark})`);
  assert.ok(light > 192, `light side brightens (${light})`);
  assert.equal(px(img, 0, 4)[0], 64, 'far from the edge stays put');
  assert.equal(px(img, 7, 4)[3], 255, 'alpha untouched');
});

test('pixels outside the mask are unchanged', () => {
  const W = 16,
    H = 8;
  const img = edge(W, H);
  const before = img.data.slice();
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x++) mask[y * W + x] = 1;
  applySharpen(img, 100, mask);
  assert.ok(px(img, 7, 1)[0] < 64, 'masked-in edge sharpens');
  for (let y = H / 2; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      assert.deepEqual(img.data.slice(i, i + 4), before.slice(i, i + 4), `pixel ${x},${y}`);
    }
  }
});
