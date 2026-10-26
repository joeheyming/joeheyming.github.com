import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWave, hash01, ADJUSTMENTS } from '../paint/adjustments.js';

const W = 40;
const H = 30;
const TAU = 2 * Math.PI;

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
// and bilinear sampling at fx gives exactly 5 * fx + 5 inside the image.
const ramp = (x) => [5 * x + 5, 7, 9, 255];
const chart = (x, y) => [x * 6 + 1, y * 8 + 2, (x * y) % 251, 255 - x];

// The test's own copy of PhotoCraft distort.rs `shape`.
function shape(type, phase) {
  const p = (((phase % TAU) + TAU) % TAU) / TAU;
  if (type === 0) return Math.sin(phase);
  if (type === 1) return 1 - 4 * Math.abs(p - 0.5);
  return p < 0.5 ? 1 : -1;
}

// Generator 0 for a seed, from hash01(0, k, 7, seed).
function gen0(wl0, wl1, am0, am1, seed) {
  const r = (k) => hash01(0, k, 7, seed);
  return {
    len: Math.max(1, wl0 + Math.max(0, wl1 - wl0) * r(1)),
    amp: am0 + Math.max(0, am1 - am0) * r(2),
    p1: r(3) * TAU,
    p2: r(4) * TAU
  };
}

test('wave is registered and apply dispatches', () => {
  const def = ADJUSTMENTS.wave;
  assert.equal(def.label, 'Wave');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.label, f.min, f.max, f.default]),
    [
      ['generators', 'Generators', 1, 64, 5],
      ['wavelengthMin', 'Wavelength Min', 1, 998, 10],
      ['wavelengthMax', 'Wavelength Max', 2, 999, 120],
      ['amplitudeMin', 'Amplitude Min', 1, 998, 5],
      ['amplitudeMax', 'Amplitude Max', 1, 999, 35],
      ['waveType', 'Type', 0, 2, 0],
      ['undefinedAreas', 'Undefined Areas', 0, 2, 0],
      ['seed', 'Seed', 0, 9999, 0]
    ]
  );
  const params = {
    generators: 3,
    wavelengthMin: 8,
    wavelengthMax: 30,
    amplitudeMin: 2,
    amplitudeMax: 6,
    waveType: 1,
    undefinedAreas: 1,
    seed: 42
  };
  const a = image(chart);
  const b = image(chart);
  def.apply(a, params, null);
  applyWave(b, 3, 8, 30, 2, 6, 1, 1, 42);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, image(chart).data);
});

test('a flat image is unchanged with Wrap and Repeat', () => {
  const flat = () => [90, 120, 30, 200];
  for (const edge of [0, 1]) {
    const img = image(flat);
    applyWave(img, 5, 10, 120, 5, 35, 0, edge, 0);
    assert.deepEqual(img.data, image(flat).data, `edge ${edge}`);
  }
});

test('the same seed reproduces and a different seed changes the result', () => {
  const run = (seed) => {
    const img = image(chart);
    applyWave(img, 5, 10, 120, 5, 35, 0, 0, seed);
    return img.data;
  };
  assert.deepEqual(run(7), run(7));
  assert.notDeepEqual(run(7), run(8));
});

test('one generator matches a hand-computed pixel for each wave type', () => {
  const seed = 3;
  const g = gen0(10, 40, 2, 6, seed);
  const X = 20.5;
  for (const type of [0, 1, 2]) {
    for (const y of [3, 11, 17]) {
      const img = image(ramp);
      applyWave(img, 1, 10, 40, 2, 6, type, 1, seed);
      const Y = y + 0.5;
      const sx = X + g.amp * shape(type, (TAU * Y) / g.len + g.p1);
      assert.deepEqual(px(img, 20, y), [Math.round(5 * (sx - 0.5) + 5), 7, 9, 255], `${type} ${y}`);
    }
  }
});

test('Wrap, Repeat, and Transparent at an edge pixel displaced outside', () => {
  // A square wave with a fixed amplitude moves x by exactly +-A. Find a row of
  // the right column where generator 0 pushes it to the right.
  const seed = 5;
  const run = (A, edge) => {
    const img = image(ramp, W, 60);
    applyWave(img, 1, 20, 20, A, A, 2, edge, seed);
    return img;
  };
  const g = gen0(20, 20, 1, 1, seed);
  let y = 20;
  while (shape(2, (TAU * (y + 0.5)) / g.len + g.p1) !== 1) y++;
  assert.ok(y < 40);

  // A = 2.5: sx = W + 2, so fx = W + 1.5 sits between columns W + 1 and W + 2.
  assert.deepEqual(px(run(2.5, 0), W - 1, y), [Math.round((5 * 1 + 5 + 5 * 2 + 5) / 2), 7, 9, 255]);
  assert.deepEqual(px(run(2.5, 1), W - 1, y), [5 * (W - 1) + 5, 7, 9, 255]);
  assert.deepEqual(px(run(2.5, 2), W - 1, y), [0, 0, 0, 0]);
  // A = 0.5: fx = W - 0.5, half the last column and half outside.
  assert.deepEqual(px(run(0.5, 2), W - 1, y), [5 * (W - 1) + 5, 7, 9, 128]);
  assert.deepEqual(px(run(0.5, 1), W - 1, y), [5 * (W - 1) + 5, 7, 9, 255]);
  assert.deepEqual(px(run(0.5, 0), W - 1, y), [Math.round((5 * (W - 1) + 5 + 5) / 2), 7, 9, 255]);
});

test('params round and clamp', () => {
  const run = (...args) => {
    const img = image(chart);
    applyWave(img, ...args);
    return img.data;
  };
  assert.deepEqual(run(0, 10, 40, 2, 6, 0, 0, 1), run(1, 10, 40, 2, 6, 0, 0, 1));
  assert.deepEqual(run(100, 10, 40, 2, 6, 0, 0, 1), run(64, 10, 40, 2, 6, 0, 0, 1));
  assert.deepEqual(run(2.6, 10, 40, 2, 6, 0, 0, 1), run(3, 10, 40, 2, 6, 0, 0, 1));
  assert.deepEqual(run(2, 10, 40, 2, 6, 2.4, 0, 1), run(2, 10, 40, 2, 6, 2, 0, 1));
  assert.deepEqual(run(2, 10, 40, 2, 6, 9, 0, 1), run(2, 10, 40, 2, 6, 2, 0, 1));
  assert.deepEqual(run(2, 10, 40, 2, 6, -3, 0, 1), run(2, 10, 40, 2, 6, 0, 0, 1));
  assert.deepEqual(run(2, 10, 40, 9, 12, 1, 7, 1), run(2, 10, 40, 9, 12, 1, 2, 1));
  assert.deepEqual(run(2, 10, 40, 9, 12, 1, -1, 1), run(2, 10, 40, 9, 12, 1, 0, 1));
  assert.deepEqual(run(2, 10, 40, 2, 6, 0, 0, 1.4), run(2, 10, 40, 2, 6, 0, 0, 1));
  // A max below the min falls back to the min.
  assert.deepEqual(run(2, 30, 10, 6, 2, 0, 0, 1), run(2, 30, 30, 6, 6, 0, 0, 1));
});

test('a mask limits writes but masked-in pixels still read masked-out sources', () => {
  const full = image(chart);
  applyWave(full, 4, 10, 60, 4, 12, 0, 0, 9);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) mask[y * W + x] = 1;
  const img = image(chart);
  applyWave(img, 4, 10, 60, 4, 12, 0, 0, 9, mask);
  const orig = image(chart);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      assert.deepEqual(px(img, x, y), px(mask[y * W + x] ? full : orig, x, y), `${x},${y}`);
    }
  }
});
