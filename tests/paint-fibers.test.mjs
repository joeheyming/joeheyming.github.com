import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFibers, valueNoise, hash01, ADJUSTMENTS } from '../paint/adjustments.js';

const W = 24;
const H = 40;
const F = Math.fround;

function image(w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const v = (p * 73 + 41) % 251;
    data.set([v, (v * 3) % 256, (v * 7) % 256, 55 + (p % 200)], p * 4);
  }
  return { width: w, height: h, data };
}

function fibers(variance, strength, seed, mask = null, w = W, h = H) {
  const img = image(w, h);
  applyFibers(img, variance, strength, seed, mask);
  return img;
}

test('fibers is registered and dispatches its params', () => {
  const adj = ADJUSTMENTS.fibers;
  assert.equal(adj.label, 'Fibers');
  const field = (k) => adj.fields.find((f) => f.key === k);
  assert.deepEqual(
    ['variance', 'strength', 'seed'].map((k) => [field(k).min, field(k).max, field(k).default]),
    [
      [1, 64, 16],
      [1, 64, 4],
      [0, 9999, 0]
    ]
  );
  const a = image();
  adj.apply(a, { variance: 30, strength: 9, seed: 5 }, null);
  assert.deepEqual(a.data, fibers(30, 9, 5).data);
});

test('valueNoise hits the lattice hash and smoothsteps between points', () => {
  for (const [x, y, seed] of [
    [0, 0, 0],
    [3, 7, 11],
    [-2, 5, 977]
  ]) {
    assert.equal(valueNoise(x, y, seed), hash01(x, y, 0, seed));
  }
  // At (0.5, 0.5) smoothstep gives 0.5 on both axes.
  const h = (a, b) => hash01(a, b, 0, 4);
  const top = F(h(0, 0) + F(F(h(1, 0) - h(0, 0)) * 0.5));
  const bot = F(h(0, 1) + F(F(h(1, 1) - h(0, 1)) * 0.5));
  assert.equal(valueNoise(0.5, 0.5, 4), F(top + F(F(bot - top) * 0.5)));
});

test('the origin pixel matches a hand computation', () => {
  // At (0, 0) every octave and the grain read the (0, 0) lattice hash.
  const seed = 7;
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum = F(sum + F(hash01(0, 0, 0, seed + o * 977) * amp));
    norm = F(norm + amp);
    amp = F(amp * F(0.55));
  }
  const grain = F(hash01(0, 0, 0, seed ^ 0x5bd1) - 0.5);
  const stretch = F(F(1.6) + F(16 / 40));
  const t = F(F(F(F(F(sum / norm) - 0.5) * stretch) + 0.5) + F(grain * 0.25));
  const expected = Math.round(F(Math.max(0, Math.min(1, t)) * 255));
  const img = fibers(16, 4, seed);
  assert.deepEqual([...img.data.slice(0, 4)], [expected, expected, expected, 255]);
});

test('output is grey with alpha 255 and ignores the source', () => {
  const img = fibers(16, 4, 0);
  const flat = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  applyFibers(flat, 16, 4, 0);
  assert.deepEqual(flat.data, img.data);
  const values = new Set();
  for (let i = 0; i < img.data.length; i += 4) {
    assert.equal(img.data[i], img.data[i + 1]);
    assert.equal(img.data[i], img.data[i + 2]);
    assert.equal(img.data[i + 3], 255);
    values.add(img.data[i]);
  }
  assert.ok(values.size > 20);
});

test('variance, strength, and seed clamp', () => {
  assert.deepEqual(fibers(0, 0, 0).data, fibers(1, 1, 0).data);
  assert.deepEqual(fibers(-5, 200, 0).data, fibers(1, 64, 0).data);
  assert.deepEqual(fibers(500, 4, 0).data, fibers(64, 4, 0).data);
  assert.deepEqual(fibers(16, 4, undefined).data, fibers(16, 4, 0).data);
  assert.deepEqual(fibers(16, 4, -3).data, fibers(16, 4, 0).data);
  assert.deepEqual(fibers(16, 4, 12345).data, fibers(16, 4, 9999).data);
  assert.deepEqual(fibers(16, 4, 2.4).data, fibers(16, 4, 2).data);
});

test('seeds are deterministic and differ', () => {
  assert.deepEqual(fibers(16, 4, 42).data, fibers(16, 4, 42).data);
  assert.notDeepEqual(fibers(16, 4, 42).data, fibers(16, 4, 43).data);
});

test('strength stretches fibres vertically', () => {
  const rowDiff = (img) => {
    let total = 0;
    for (let y = 1; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        total += Math.abs(img.data[i] - img.data[i - img.width * 4]);
      }
    }
    return total / ((img.height - 1) * img.width);
  };
  const w = 64;
  const h = 64;
  assert.ok(rowDiff(fibers(16, 64, 3, null, w, h)) < rowDiff(fibers(16, 1, 3, null, w, h)));
});

test('the mask limits writes', () => {
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p += 3) mask[p] = 1;
  const src = image();
  const full = fibers(16, 4, 9);
  const masked = fibers(16, 4, 9, mask);
  for (let p = 0; p < W * H; p++) {
    const want = mask[p] ? full : src;
    assert.deepEqual(
      [...masked.data.slice(p * 4, p * 4 + 4)],
      [...want.data.slice(p * 4, p * 4 + 4)]
    );
  }
});
