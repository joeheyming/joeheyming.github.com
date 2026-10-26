import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySpherize, ADJUSTMENTS } from '../paint/adjustments.js';

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

const noise = (x, y) => [(x * 37 + y * 11) % 256, (x * 5 + y * 71) % 256, (x * y * 13) % 256, 255];

// A white disc of radius 4 centred on a black 32x32 image.
const dot = (x, y) => {
  const dx = x + 0.5 - 16,
    dy = y + 0.5 - 16;
  return dx * dx + dy * dy <= 16 ? [255, 255, 255, 255] : [0, 0, 0, 255];
};

function bright(img) {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] >= 128) n++;
  return n;
}

test('spherize is registered with amount and mode fields', () => {
  const def = ADJUSTMENTS.spherize;
  assert.equal(def.label, 'Spherize');
  assert.deepEqual(def.fields, [
    { key: 'amount', label: 'Amount', min: -100, max: 100, default: 100 },
    { key: 'mode', label: 'Mode', min: 0, max: 2, default: 0 }
  ]);
});

test('amount 0 leaves the image unchanged', () => {
  const img = image(9, 7, noise);
  const before = img.data.slice();
  applySpherize(img, 0);
  assert.deepEqual(img.data, before);
});

test('a flat image is unchanged at any amount', () => {
  for (const amount of [50, -100, 100]) {
    const img = image(10, 8, () => [30, 140, 220, 180]);
    const before = img.data.slice();
    applySpherize(img, amount);
    assert.deepEqual(img.data, before);
  }
});

test('corner pixels outside the inscribed ellipse are unchanged', () => {
  const W = 12,
    H = 8;
  const img = image(W, H, noise);
  const before = image(W, H, noise);
  applySpherize(img, 100);
  for (const [x, y] of [
    [0, 0],
    [W - 1, 0],
    [0, H - 1],
    [W - 1, H - 1]
  ]) {
    assert.deepEqual(px(img, x, y), px(before, x, y));
  }
});

test('the centre pixel of an odd-sized image keeps its value', () => {
  for (const amount of [100, -100]) {
    const img = image(9, 7, noise);
    const want = px(img, 4, 3);
    applySpherize(img, amount);
    assert.deepEqual(px(img, 4, 3), want);
  }
});

// For r in (0, 1), asin(r) * 2 / PI < r, so k < 1 at a positive amount: it samples
// nearer the centre and magnifies a centred dot. sin(r * PI / 2) > r shrinks it.
test('a positive amount enlarges a centred dot and a negative amount shrinks it', () => {
  const base = bright(image(32, 32, dot));
  const bulged = image(32, 32, dot);
  applySpherize(bulged, 100);
  const sucked = image(32, 32, dot);
  applySpherize(sucked, -100);
  assert.ok(bright(bulged) > base, `${bright(bulged)} > ${base}`);
  assert.ok(bright(sucked) < base, `${bright(sucked)} < ${base}`);
});

test('a mask limits writes but masked-out pixels are still sampled', () => {
  const W = 32,
    H = 32;
  const img = image(W, H, dot);
  const mask = new Uint8Array(W * H);
  // Find a pixel on row 16 that amount 100 changes, then mask only that one.
  const full = image(W, H, dot);
  applySpherize(full, 100);
  const changed = [];
  for (let x = 0; x < W; x++) {
    if (px(full, x, 16).join() !== px(image(W, H, dot), x, 16).join()) changed.push(x);
  }
  assert.ok(changed.length > 0);
  const x0 = changed[0];
  mask[16 * W + x0] = 1;
  applySpherize(img, 100, 0, mask);
  assert.deepEqual(px(img, x0, 16), px(full, x0, 16));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x === x0 && y === 16) continue;
      assert.deepEqual(px(img, x, y), dot(x, y));
    }
  }
});
