import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRipple, ADJUSTMENTS } from '../paint/adjustments.js';

const W = 24;
const H = 40;

function image(fn, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

// Horizontal ramp: R depends on x only, so the vertical displacement is invisible
// and bilinear sampling at fx gives exactly 10 * fx + 5 inside the image.
const ramp = (x) => [10 * x + 5, 7, 9, 255];

test('ripple is registered and apply dispatches', () => {
  const def = ADJUSTMENTS.ripple;
  assert.equal(def.label, 'Ripple');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.label, f.min, f.max, f.default]),
    [
      ['amount', 'Amount', -999, 999, 100],
      ['size', 'Size', 0, 2, 1]
    ]
  );
  const a = image(ramp);
  const b = image(ramp);
  def.apply(a, { amount: 150, size: 0 }, null);
  applyRipple(b, 150, 0);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, image(ramp).data);
});

test('amount 0 is a no-op and a flat image is unchanged', () => {
  const img = image(ramp);
  applyRipple(img, 0, 1);
  assert.deepEqual(img.data, image(ramp).data);
  const flat = () => [30, 140, 220, 180];
  const f = image(flat);
  applyRipple(f, 400, 2);
  assert.deepEqual(f.data, image(flat).data);
});

test('hand-computed pixel on a horizontal ramp for each size', () => {
  const x = 12;
  const y = 2;
  for (const [size, len] of [
    [0, 8],
    [1, 16],
    [2, 32]
  ]) {
    const img = image(ramp);
    applyRipple(img, 100, size);
    const amp = len / 8;
    const fx = x + amp * Math.sin((2 * Math.PI * (y + 0.5)) / len);
    assert.deepEqual(px(img, x, y), [Math.round(10 * fx + 5), 7, 9, 255], `size ${size}`);
  }
  // Out-of-range sizes round and clamp.
  const ref = image(ramp);
  applyRipple(ref, 100, 2);
  const big = image(ramp);
  applyRipple(big, 100, 7);
  assert.deepEqual(big.data, ref.data);
  const ref0 = image(ramp);
  applyRipple(ref0, 100, 0);
  const neg = image(ramp);
  applyRipple(neg, 100, -3);
  assert.deepEqual(neg.data, ref0.data);
  const half = image(ramp);
  applyRipple(half, 100, 1.6);
  assert.deepEqual(half.data, ref.data);
});

test('negative amount mirrors the displacement direction', () => {
  const pos = image(ramp);
  const neg = image(ramp);
  applyRipple(pos, 100, 0);
  applyRipple(neg, -100, 0);
  // y = 2: sin(5 PI / 8) ~ 0.924, so +amount reads ~9 levels right, -amount ~9 left.
  const base = ramp(10)[0];
  assert.equal(px(pos, 10, 2)[0] - base, 9);
  assert.equal(base - px(neg, 10, 2)[0], 9);
  for (let y = 0; y < H; y++) {
    const dp = px(pos, 10, y)[0] - base;
    const dn = px(neg, 10, y)[0] - base;
    assert.ok(Math.abs(dp + dn) <= 1, `row ${y}: ${dp} vs ${dn}`);
  }
});

test('the edge clamps instead of going transparent', () => {
  const img = image(ramp);
  applyRipple(img, -100, 0);
  // Column 0 at y = 2 samples fx ~ -0.92: both neighbours clamp to column 0.
  assert.deepEqual(px(img, 0, 2), ramp(0));
  const r = image(ramp);
  applyRipple(r, 100, 0);
  assert.deepEqual(px(r, W - 1, 2), ramp(W - 1));
  for (let i = 3; i < r.data.length; i += 4) assert.equal(r.data[i], 255);
});

test('alpha-0 neighbours do not darken RGB', () => {
  // Columns < 12 are transparent black, the rest opaque red.
  const fn = (x) => (x < 12 ? [0, 0, 0, 0] : [200, 40, 10, 255]);
  const img = image(fn);
  applyRipple(img, -100, 0);
  const p = px(img, 12, 2);
  assert.deepEqual(p.slice(0, 3), [200, 40, 10]);
  assert.ok(p[3] > 0 && p[3] < 255, `alpha ${p[3]}`);
  // A pixel whose samples are all transparent stays transparent black.
  assert.deepEqual(px(img, 3, 2), [0, 0, 0, 0]);
});

test('a mask limits writes but masked-in pixels sample masked-out source', () => {
  const mask = new Uint8Array(W * H);
  mask[2 * W + 10] = 1;
  const img = image(ramp);
  applyRipple(img, 100, 0, mask);
  const full = image(ramp);
  applyRipple(full, 100, 0);
  assert.deepEqual(px(img, 10, 2), px(full, 10, 2));
  assert.notDeepEqual(px(img, 10, 2), ramp(10));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x === 10 && y === 2) continue;
      assert.deepEqual(px(img, x, y), ramp(x), `(${x}, ${y})`);
    }
  }
});
