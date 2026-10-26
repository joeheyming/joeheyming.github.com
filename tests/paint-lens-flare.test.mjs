import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLensFlare, smoothstep, ADJUSTMENTS } from '../paint/adjustments.js';

const W = 40;
const H = 30;

function image(w = W, h = H, fill = null) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const v = (p * 73 + 41) % 251;
    data.set(fill || [v, (v * 3) % 256, (v * 7) % 256, 55 + (p % 200)], p * 4);
  }
  return { width: w, height: h, data };
}

function flare(brightness, cx, cy, lens, opts = {}) {
  const img = image(opts.w, opts.h, opts.fill);
  applyLensFlare(img, brightness, cx, cy, lens, opts.mask || null);
  return img;
}

const px = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

test('lens flare is registered and dispatches its params', () => {
  const adj = ADJUSTMENTS.lensFlare;
  assert.equal(adj.label, 'Lens Flare');
  const field = (k) => adj.fields.find((f) => f.key === k);
  assert.deepEqual(
    ['brightness', 'centerX', 'centerY', 'lens'].map((k) => [
      field(k).min,
      field(k).max,
      field(k).default
    ]),
    [
      [10, 300, 100],
      [-50, 150, 50],
      [-50, 150, 50],
      [0, 3, 0]
    ]
  );
  const a = image();
  adj.apply(a, { brightness: 140, centerX: 30, centerY: 60, lens: 2 }, null);
  assert.deepEqual(a.data, flare(140, 30, 60, 2).data);
});

test('smoothstep matches fxutil, including the reversed-edge step', () => {
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(smoothstep(1, 0.85, 0.9), 1);
  assert.equal(smoothstep(1, 0.85, 0.8), 0);
});

test('hand-checked Zoom pixels at and away from the flare centre', () => {
  // 40x30, centre (25%, 50%) -> (10, 15); s = 0.05. Ghosts sit at x >= 17.
  // Independent double-precision reference:
  //   (9, 14):  f = [0.66062, 0.62764, 0.56168] -> [182.03, 189.84, 195.83]
  //   (13, 16): f = [0.15017, 0.14266, 0.12764] -> [72.29, 104.96, 137.23]
  const fill = [40, 80, 120, 200];
  const img = flare(100, 25, 50, 0, { fill });
  assert.deepEqual(px(img, 9, 14), [182, 190, 196, 200]);
  assert.deepEqual(px(img, 13, 16), [72, 105, 137, 200]);
});

test('alpha is kept, white stays white, and no channel ever darkens', () => {
  const src = image();
  for (let lens = 0; lens < 4; lens++) {
    const img = flare(300, 40, 70, lens);
    for (let i = 0; i < img.data.length; i += 4) {
      assert.equal(img.data[i + 3], src.data[i + 3]);
      for (let k = 0; k < 3; k++) assert.ok(img.data[i + k] >= src.data[i + k]);
    }
    const white = flare(300, 40, 70, lens, { fill: [255, 255, 255, 128] });
    for (let i = 0; i < white.data.length; i += 4) {
      assert.deepEqual(Array.from(white.data.slice(i, i + 4)), [255, 255, 255, 128]);
    }
  }
});

test('brightness 300 brightens more than 10', () => {
  const fill = [0, 0, 0, 255];
  const lo = flare(10, 50, 50, 0, { fill });
  const hi = flare(300, 50, 50, 0, { fill });
  assert.ok(px(hi, 25, 12)[0] > px(lo, 25, 12)[0]);
});

test('each lens gives a different image', () => {
  const imgs = [0, 1, 2, 3].map((lens) => flare(100, 35, 45, lens).data.join());
  assert.equal(new Set(imgs).size, 4);
});

test('parameters clamp and lens rounds', () => {
  assert.deepEqual(flare(1, 50, 50, 0).data, flare(10, 50, 50, 0).data);
  assert.deepEqual(flare(999, 50, 50, 0).data, flare(300, 50, 50, 0).data);
  assert.deepEqual(flare(100, -200, 400, 0).data, flare(100, -50, 150, 0).data);
  assert.deepEqual(flare(100, 50, 50, 1.4).data, flare(100, 50, 50, 1).data);
  assert.deepEqual(flare(100, 50, 50, 1.6).data, flare(100, 50, 50, 2).data);
  assert.deepEqual(flare(100, 50, 50, 9).data, flare(100, 50, 50, 3).data);
  assert.deepEqual(flare(100, 50, 50, -2).data, flare(100, 50, 50, 0).data);
  assert.deepEqual(flare('x', 'y', 'z', 'w').data, flare(100, 50, 50, 0).data);
});

test('35mm Prime halo ring is brighter than just inside it', () => {
  // 200x150 -> s = 0.25, ring_r * s = 22.5, centre (100, 75).
  const opts = { w: 200, h: 150, fill: [0, 0, 0, 255] };
  const img = flare(100, 50, 50, 1, opts);
  const ring = px(img, 122, 74); // d ~ 22.51
  const inside = px(img, 119, 74); // d ~ 19.51
  for (let k = 0; k < 3; k++) assert.ok(ring[k] > inside[k], `channel ${k}`);
});

test('mask limits writes', () => {
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p += 3) mask[p] = 1;
  const src = image();
  const full = flare(150, 50, 50, 3);
  const masked = flare(150, 50, 50, 3, { mask });
  for (let p = 0; p < W * H; p++) {
    const from = mask[p] ? full : src;
    assert.deepEqual(px(masked, p % W, (p / W) | 0), px(from, p % W, (p / W) | 0));
  }
});
