import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySpherize, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square so a W / H swap in the one-axis modes can't pass.
const W = 20;
const H = 12;

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

// R ramps with x and G with y, so a horizontal shift only moves R and a vertical
// one only moves G. Bilinear sampling at s gives exactly 10 * (sx - 0.5) + 5 in R
// and 20 * (sy - 0.5) + 7 in G while the sample stays inside the image.
const chart = (x, y) => [10 * x + 5, 20 * y + 7, 9, 255];
const hramp = (x) => [10 * x + 5, 7, 9, 255];
const vramp = (x, y) => [5, 20 * y + 7, 9, 255];

function sphere1d(rn, a) {
  const target = a >= 0 ? (Math.asin(rn) * 2) / Math.PI : Math.sin((rn * Math.PI) / 2);
  return rn + Math.abs(a) * (target - rn);
}

test('spherize registers a mode field and apply passes it through', () => {
  const def = ADJUSTMENTS.spherize;
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.label, f.min, f.max, f.default]),
    [
      ['amount', 'Amount', -100, 100, 100],
      ['mode', 'Mode', 0, 2, 0]
    ]
  );
  for (const mode of [0, 1, 2]) {
    const a = image(chart);
    const b = image(chart);
    def.apply(a, { amount: 70, mode }, null);
    applySpherize(b, 70, mode);
    assert.deepEqual(a.data, b.data);
    assert.notDeepEqual(a.data, image(chart).data);
  }
  const h = image(chart);
  const v = image(chart);
  def.apply(h, { amount: 70, mode: 1 }, null);
  def.apply(v, { amount: 70, mode: 2 }, null);
  assert.notDeepEqual(h.data, v.data);
});

test('mode 0 is the old default call', () => {
  const old = image(chart);
  applySpherize(old, 60);
  const zero = image(chart);
  applySpherize(zero, 60, 0);
  const viaApply = image(chart);
  ADJUSTMENTS.spherize.apply(viaApply, { amount: 60 }, null);
  assert.deepEqual(zero.data, old.data);
  assert.deepEqual(viaApply.data, old.data);
});

test('amount 0 and a flat image are no-ops in every mode', () => {
  const flat = () => [40, 80, 120, 200];
  for (const mode of [0, 1, 2]) {
    const a = image(chart);
    applySpherize(a, 0, mode);
    assert.deepEqual(a.data, image(chart).data);
    for (const amount of [100, -100, 35]) {
      const f = image(flat);
      applySpherize(f, amount, mode);
      assert.deepEqual(f.data, image(flat).data);
    }
  }
});

test('Horizontal Only remaps x on a horizontal ramp and leaves a vertical ramp alone', () => {
  const hx = W / 2;
  // Pixel 14: centre 14.5, dx = 4.5, rn = 0.45.
  for (const amount of [100, -100, 50]) {
    const a = amount / 100;
    const img = image(hramp);
    applySpherize(img, amount, 1);
    const sx = hx + hx * sphere1d(4.5 / hx, a);
    for (let y = 0; y < H; y++) {
      assert.deepEqual(px(img, 14, y), [Math.round(10 * (sx - 0.5) + 5), 7, 9, 255]);
    }
    // Left of centre mirrors: pixel 5 has dx = -4.5.
    const sxl = hx - hx * sphere1d(4.5 / hx, a);
    assert.deepEqual(px(img, 5, 3), [Math.round(10 * (sxl - 0.5) + 5), 7, 9, 255]);
  }
  // Hand values for amount +-100 at pixel 14.
  const pos = image(hramp);
  applySpherize(pos, 100, 1);
  assert.equal(px(pos, 14, 0)[0], 130); // 10 + 10 * asin(0.45) * 2 / PI = 12.977
  const neg = image(hramp);
  applySpherize(neg, -100, 1);
  assert.equal(px(neg, 14, 0)[0], 165); // 10 + 10 * sin(0.45 * PI / 2) = 16.494

  const v = image(vramp);
  applySpherize(v, 100, 1);
  assert.deepEqual(v.data, image(vramp).data);
});

test('Vertical Only remaps y on a vertical ramp and leaves a horizontal ramp alone', () => {
  const hy = H / 2;
  // Pixel row 8: centre 8.5, dy = 2.5, rn = 2.5 / 6.
  for (const amount of [100, -100, 50]) {
    const a = amount / 100;
    const img = image(vramp);
    applySpherize(img, amount, 2);
    const sy = hy + hy * sphere1d(2.5 / hy, a);
    for (let x = 0; x < W; x++) {
      assert.deepEqual(px(img, x, 8), [5, Math.round(20 * (sy - 0.5) + 7), 9, 255]);
    }
    const syt = hy - hy * sphere1d(2.5 / hy, a);
    assert.deepEqual(px(img, 7, 3), [5, Math.round(20 * (syt - 0.5) + 7), 9, 255]);
  }
  const pos = image(vramp);
  applySpherize(pos, 100, 2);
  assert.equal(px(pos, 0, 8)[1], 150); // 6 + 6 * asin(5 / 12) * 2 / PI = 7.642
  const neg = image(vramp);
  applySpherize(neg, -100, 2);
  assert.equal(px(neg, 0, 8)[1], 190); // 6 + 6 * sin(5 / 12 * PI / 2) = 9.653

  const h = image(hramp);
  applySpherize(h, 100, 2);
  assert.deepEqual(h.data, image(hramp).data);
});

test('a corner outside the inscribed ellipse moves in one-axis modes but not in Normal', () => {
  const normal = image(chart);
  applySpherize(normal, 100, 0);
  assert.deepEqual(px(normal, 0, 0), chart(0, 0));

  // Pixel (0, 0): dx = -9.5, rn = 0.95; dy = -5.5, rn = 5.5 / 6.
  const horiz = image(chart);
  applySpherize(horiz, 100, 1);
  const sx = 10 - 10 * sphere1d(0.95, 1);
  assert.deepEqual(px(horiz, 0, 0), [Math.round(10 * (sx - 0.5) + 5), 7, 9, 255]);

  const vert = image(chart);
  applySpherize(vert, 100, 2);
  const sy = 6 - 6 * sphere1d(5.5 / 6, 1);
  assert.deepEqual(px(vert, 0, 0), [5, Math.round(20 * (sy - 0.5) + 7), 9, 255]);
});

test('mode rounds and clamps to 0..2', () => {
  const run = (mode) => {
    const img = image(chart);
    applySpherize(img, 80, mode);
    return img.data;
  };
  const [m0, m1, m2] = [run(0), run(1), run(2)];
  assert.deepEqual(run(1.4), m1);
  assert.deepEqual(run(0.6), m1);
  assert.deepEqual(run(1.6), m2);
  assert.deepEqual(run(9), m2);
  assert.deepEqual(run(-3), m0);
  assert.deepEqual(run(0.4), m0);
  assert.deepEqual(run(undefined), m0);
  assert.deepEqual(run('nope'), m0);
});

test('mask limits writes; masked-in pixels still sample masked-out sources', () => {
  for (const mode of [1, 2]) {
    const full = image(chart);
    applySpherize(full, 100, mode);
    const mask = new Uint8Array(W * H);
    const [mx, my] = [14, 8];
    mask[my * W + mx] = 1;
    const img = image(chart);
    applySpherize(img, 100, mode, mask);
    assert.deepEqual(px(img, mx, my), px(full, mx, my));
    assert.notDeepEqual(px(img, mx, my), chart(mx, my));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x === mx && y === my) continue;
        assert.deepEqual(px(img, x, y), chart(x, y));
      }
    }
  }
});
