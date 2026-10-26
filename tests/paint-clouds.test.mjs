import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyClouds, cloudHash, cloudsValue, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square: 13 wide, 9 tall, so base clamps to 16.
const W = 13;
const H = 9;

function image(fill = [0, 0, 0, 255], w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set(fill, p * 4);
  return { width: w, height: h, data };
}

// Every pixel distinct, with varied alpha.
function noisy() {
  const img = image();
  for (let p = 0; p < W * H; p++) {
    const v = (p * 73 + 41) % 251;
    img.data.set([v, (v * 3) % 256, (v * 7) % 256, 55 + (p % 200)], p * 4);
  }
  return img;
}

const F = Math.fround;

test('clouds and difference clouds are registered and dispatch the seed', () => {
  for (const [id, label, difference] of [
    ['clouds', 'Clouds', false],
    ['differenceClouds', 'Difference Clouds', true]
  ]) {
    const adj = ADJUSTMENTS[id];
    assert.equal(adj.label, label);
    const seed = adj.fields.find((f) => f.key === 'seed');
    assert.deepEqual([seed.min, seed.max, seed.default], [0, 9999, 0]);
    const a = noisy();
    const b = noisy();
    adj.apply(a, { seed: 17 }, null);
    applyClouds(b, 17, difference);
    assert.deepEqual(a.data, b.data);
  }
});

test('cloudHash matches hand-computed u32 mixes', () => {
  // (1, 0, 0): h = 0x8da6b343, then the 13 / 0x5bd1e995 / 15 mix gives 0x3c9a999b.
  assert.equal(cloudHash(0, 0, 0), 0);
  assert.equal(cloudHash(1, 0, 0), F(0x9a999b / 0xffffff));
  assert.equal(cloudHash(0, 1, 0), F(0x62d376 / 0xffffff));
  assert.equal(cloudHash(0, 0, 1), F(0x5ba626 / 0xffffff));
  // -1 wraps to 0xffffffff as u32.
  assert.equal(cloudHash(-1, 2, 3), F(0xde0f1b / 0xffffff));
  assert.equal(cloudHash(5, 7, 42), F(0xbf3156 / 0xffffff));
});

test('cloudsValue at the origin sums the corner hash of each octave', () => {
  // At (0, 0) every octave reads h(0, 0, seed + o * 7919) with no interpolation.
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < 8; o++) {
    sum = F(sum + F(cloudHash(0, 0, 2 + o * 7919) * amp));
    norm = F(norm + amp);
    amp = F(amp * 0.5);
  }
  assert.equal(norm, 1.9921875);
  const expected = F(F(F(F(F(sum / norm) - 0.5) * F(2.2))) + 0.5);
  assert.ok(Math.abs(expected - 0.6182490587) < 1e-7);
  assert.equal(cloudsValue(0, 0, 16, 2), expected);
  // Seed 0 is below zero before the clamp.
  assert.equal(cloudsValue(0, 0, 16, 0), 0);
  // Interpolated pixels, from an independent f32 reference.
  assert.ok(Math.abs(cloudsValue(5, 3, 16, 2) - 0.8681500554) < 1e-7);
  assert.ok(Math.abs(cloudsValue(9, 4, 16, 0) - 0.4032399952) < 1e-7);
});

test('clouds is grey, opaque, and matches cloudsValue', () => {
  const img = noisy();
  applyClouds(img, 4);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      assert.equal(d[i], d[i + 1]);
      assert.equal(d[i], d[i + 2]);
      assert.equal(d[i + 3], 255);
      assert.equal(d[i], Math.round(F(cloudsValue(x, y, 16, 4) * 255)));
    }
  }
  assert.equal(d[(7 * W + 12) * 4], 100);
  // Independent f32 reference: seed 0 at (9, 4) is 0.40324 -> 103.
  assert.equal(applyAt(0, 9, 4), 103);
});

function applyAt(seed, x, y) {
  const img = image();
  applyClouds(img, seed);
  return img.data[(y * W + x) * 4];
}

test('base clamps to 16 for a 20x10 image and follows max(W, H) / 4 above it', () => {
  const small = image([0, 0, 0, 255], 20, 10);
  applyClouds(small, 3);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 20; x++) {
      assert.equal(small.data[(y * 20 + x) * 4], Math.round(F(cloudsValue(x, y, 16, 3) * 255)));
    }
  }
  const wide = image([0, 0, 0, 255], 100, 4);
  applyClouds(wide, 3);
  for (let x = 0; x < 100; x++) {
    assert.equal(wide.data[(2 * 100 + x) * 4], Math.round(F(cloudsValue(x, 2, 25, 3) * 255)));
  }
});

test('seeds are deterministic and different seeds differ', () => {
  const a = image();
  const b = image();
  const c = image();
  applyClouds(a, 7);
  applyClouds(b, 7);
  applyClouds(c, 8);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, c.data);
  // Seed rounds and clamps.
  const r = image();
  applyClouds(r, 7.4);
  assert.deepEqual(r.data, a.data);
  const hi = image();
  const top = image();
  applyClouds(hi, 123456);
  applyClouds(top, 9999);
  assert.deepEqual(hi.data, top.data);
  const lo = image();
  const zero = image();
  applyClouds(lo, -5);
  applyClouds(zero, 0);
  assert.deepEqual(lo.data, zero.data);
});

test('difference clouds on black equals clouds with alpha kept, and on white its inverse', () => {
  const clouds = image();
  applyClouds(clouds, 5);
  const black = image([0, 0, 0, 90]);
  applyClouds(black, 5, true);
  const white = image([255, 255, 255, 130]);
  applyClouds(white, 5, true);
  for (let i = 0; i < clouds.data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      assert.equal(black.data[i + k], clouds.data[i + k]);
      assert.equal(white.data[i + k], 255 - clouds.data[i + k]);
    }
    assert.equal(black.data[i + 3], 90);
    assert.equal(white.data[i + 3], 130);
  }
  // A mid value differences per channel.
  const src = noisy();
  const img = noisy();
  applyClouds(img, 5, true);
  for (let p = 0; p < W * H; p++) {
    const t = cloudsValue(p % W, Math.floor(p / W), 16, 5);
    for (let k = 0; k < 3; k++) {
      const v = src.data[p * 4 + k];
      assert.equal(img.data[p * 4 + k], Math.round(F(Math.abs(F(F(v / 255) - t)) * 255)));
    }
    assert.equal(img.data[p * 4 + 3], src.data[p * 4 + 3]);
  }
});

test('the mask limits writes', () => {
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) mask[p] = (p * 5) % 3 === 0 ? 1 : 0;
  for (const difference of [false, true]) {
    const src = noisy();
    const full = noisy();
    const img = noisy();
    applyClouds(full, 6, difference);
    applyClouds(img, 6, difference, mask);
    for (let p = 0; p < W * H; p++) {
      const want = mask[p] ? full : src;
      assert.deepEqual(img.data.slice(p * 4, p * 4 + 4), want.data.slice(p * 4, p * 4 + 4));
    }
  }
});
