import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiffuse, hash01, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square on purpose.
const W = 9;
const H = 6;

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

const luma = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

// Every pixel distinct, opaque, with varied luma.
const noisy = (x, y) => [
  (x * 37 + y * 11) % 256,
  (x * 13 + y * 53) % 256,
  (x * 71 + y * 29) % 256,
  255
];

function offset(x, y, seed) {
  return [Math.floor(hash01(x, y, 1, seed) * 3) - 1, Math.floor(hash01(x, y, 2, seed) * 3) - 1];
}

test('diffuse: registry fields and apply dispatch', () => {
  const adj = ADJUSTMENTS.diffuse;
  assert.equal(adj.label, 'Diffuse');
  assert.deepEqual(adj.fields, [
    { key: 'mode', label: 'Mode', min: 0, max: 3, default: 0 },
    { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
  ]);
  for (const mode of [0, 1, 2, 3]) {
    const a = image(noisy);
    const b = image(noisy);
    adj.apply(a, { mode, seed: 7 }, null);
    applyDiffuse(b, mode, 7);
    assert.deepEqual(a.data, b.data);
  }
});

test('diffuse: a flat opaque interior is unchanged in Normal', () => {
  const img = image(() => [90, 120, 150, 255]);
  applyDiffuse(img, 0, 3);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) assert.deepEqual(px(img, x, y), [90, 120, 150, 255]);
  }
});

test('diffuse: Normal copies the hashed neighbour', () => {
  const src = image(noisy);
  const img = image(noisy);
  const seed = 42;
  applyDiffuse(img, 0, seed);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const [dx, dy] = offset(x, y, seed);
      assert.deepEqual(px(img, x, y), px(src, x + dx, y + dy), `(${x}, ${y})`);
    }
  }
});

test('diffuse: the same seed reproduces, a different seed changes the result', () => {
  const a = image(noisy);
  const b = image(noisy);
  const c = image(noisy);
  applyDiffuse(a, 0, 5);
  applyDiffuse(b, 0, 5);
  applyDiffuse(c, 0, 6);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, c.data);
});

test('diffuse: Darken Only never brightens, Lighten Only never darkens', () => {
  const src = image(noisy);
  const dark = image(noisy);
  const light = image(noisy);
  applyDiffuse(dark, 1, 11);
  applyDiffuse(light, 2, 11);
  let darkMoved = 0;
  let lightMoved = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l0 = luma(px(src, x, y));
      assert.ok(luma(px(dark, x, y)) <= l0, `dark (${x}, ${y})`);
      assert.ok(luma(px(light, x, y)) >= l0, `light (${x}, ${y})`);
      if (luma(px(dark, x, y)) < l0) darkMoved++;
      if (luma(px(light, x, y)) > l0) lightMoved++;
    }
  }
  assert.ok(darkMoved > 0);
  assert.ok(lightMoved > 0);
});

test('diffuse: Darken / Lighten skip a transparent neighbour of an opaque pixel', () => {
  const seed = 1;
  // Pick an interior pixel whose hashed neighbour is not itself.
  let target = null;
  for (let y = 1; y < H - 1 && !target; y++) {
    for (let x = 1; x < W - 1 && !target; x++) {
      const [dx, dy] = offset(x, y, seed);
      if (dx || dy) target = [x, y, x + dx, y + dy];
    }
  }
  const [x, y, nx, ny] = target;
  // The neighbour is transparent black, so it is darker; Darken Only would take it
  // without the guard. Make the neighbour bright for Lighten Only.
  const make = (nb) => image((ix, iy) => (ix === nx && iy === ny ? nb : [128, 128, 128, 255]));
  const dark = make([0, 0, 0, 0]);
  applyDiffuse(dark, 1, seed);
  assert.deepEqual(px(dark, x, y), [128, 128, 128, 255]);
  const light = make([255, 255, 255, 0]);
  applyDiffuse(light, 2, seed);
  assert.deepEqual(px(light, x, y), [128, 128, 128, 255]);
  // Normal has no guard.
  const normal = make([0, 0, 0, 0]);
  applyDiffuse(normal, 0, seed);
  assert.deepEqual(px(normal, x, y), [0, 0, 0, 0]);
  // An opaque bright neighbour is taken by Lighten Only.
  const opaque = make([255, 255, 255, 255]);
  applyDiffuse(opaque, 2, seed);
  assert.deepEqual(px(opaque, x, y), [255, 255, 255, 255]);
});

test('diffuse: Anisotropic averages with the single matching neighbour', () => {
  // Pixel (4, 2) is 100; its neighbour (5, 3) is 110; every other pixel is far away.
  const img = image((x, y) => {
    if (x === 4 && y === 2) return [100, 100, 100, 255];
    if (x === 5 && y === 3) return [111, 111, 111, 201];
    return [250, 250, 250, 255];
  });
  applyDiffuse(img, 3, 9);
  assert.deepEqual(px(img, 4, 2), [106, 106, 106, 228]);
});

test('diffuse: a border neighbour outside the image reads transparent black in Normal', () => {
  let found = null;
  for (let s = 0; s < 200 && !found; s++) {
    const [dx, dy] = offset(0, 0, s);
    if (dx < 0 || dy < 0) found = s;
  }
  assert.notEqual(found, null);
  const img = image(() => [90, 120, 150, 255]);
  applyDiffuse(img, 0, found);
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 0]);
});

test('diffuse: mode and seed round and clamp', () => {
  const run = (mode, seed) => {
    const img = image(noisy);
    applyDiffuse(img, mode, seed);
    return img.data;
  };
  assert.deepEqual(run(1.4, 3), run(1, 3));
  assert.deepEqual(run(1.6, 3), run(2, 3));
  assert.deepEqual(run(-5, 3), run(0, 3));
  assert.deepEqual(run(9, 3), run(3, 3));
  assert.deepEqual(run(0, 2.4), run(0, 2));
  assert.deepEqual(run(0, -8), run(0, 0));
  assert.deepEqual(run(0, 50000), run(0, 9999));
});

test('diffuse: a mask limits writes but masked-out neighbours are still read', () => {
  const seed = 42;
  const src = image(noisy);
  const full = image(noisy);
  applyDiffuse(full, 0, seed);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 4; x++) mask[y * W + x] = 1;
  const img = image(noisy);
  applyDiffuse(img, 0, seed, mask);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const want = mask[y * W + x] ? px(full, x, y) : px(src, x, y);
      assert.deepEqual(px(img, x, y), want, `(${x}, ${y})`);
    }
  }
  // Column 3 reaches into column 4 (masked out) for at least one pixel.
  let crossed = false;
  for (let y = 0; y < H; y++) if (offset(3, y, seed)[0] === 1) crossed = true;
  assert.ok(crossed);
});
