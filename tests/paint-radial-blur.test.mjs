import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRadialBlur, radialIntervals, ADJUSTMENTS } from '../paint/adjustments.js';

const W = 9;
const H = 7;

function flat(fill = [100, 150, 200, 255], w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set(fill, p * 4);
  return { width: w, height: h, data };
}

// The pattern the Python reference in the progress log uses.
function pattern() {
  const img = flat();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      img.data.set([x * 30, y * 35, 100, (x + y) % 3 ? 255 : 128], (y * W + x) * 4);
    }
  }
  return img;
}

function field(w, h, f) {
  const img = flat([0, 0, 0, 255], w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(f(x + 0.5 - w / 2, y + 0.5 - h / 2));
      img.data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return img;
}

function blur(params, img = pattern(), mask = null) {
  applyRadialBlur(img, params, mask);
  return img;
}

const px = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

// Mean absolute grey change over pixels with lo <= r < hi from the centre.
function meanDiff(a, b, lo, hi) {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const r = Math.hypot(x + 0.5 - a.width / 2, y + 0.5 - a.height / 2);
      if (r < lo || r >= hi) continue;
      sum += Math.abs(a.data[(y * a.width + x) * 4] - b.data[(y * a.width + x) * 4]);
      count++;
    }
  }
  return sum / count;
}

test('radial blur is registered and dispatches its params', () => {
  const def = ADJUSTMENTS.radialBlur;
  assert.equal(def.label, 'Radial Blur');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.min, f.max, f.default]),
    [
      ['amount', 1, 100, 10],
      ['method', 0, 1, 0],
      ['quality', 0, 2, 1],
      ['centerX', 0, 100, 50],
      ['centerY', 0, 100, 50]
    ]
  );
  const params = { amount: 30, method: 0, quality: 1, centerX: 50, centerY: 50 };
  const viaRegistry = pattern();
  def.apply(viaRegistry, params, null);
  assert.deepEqual(viaRegistry.data, blur(params).data);
  assert.notDeepEqual(viaRegistry.data, pattern().data);
});

test('radialIntervals caps by quality and never drops below 1', () => {
  assert.equal(radialIntervals(Infinity, 0), 64);
  assert.equal(radialIntervals(Infinity, 1), 256);
  assert.equal(radialIntervals(Infinity, 2), 4096);
  assert.equal(radialIntervals(100, 0), 64);
  assert.equal(radialIntervals(100, 1), 100);
  assert.equal(radialIntervals(300.2, 1), 256);
  assert.equal(radialIntervals(300.2, 2), 301);
  assert.equal(radialIntervals(2.01, 1), 3);
  assert.equal(radialIntervals(0, 1), 1);
  assert.equal(radialIntervals(0.3, 2), 1);
  assert.equal(radialIntervals(NaN, 2), 1);
});

test('the centre pixel and a flat image are unchanged', () => {
  for (const method of [0, 1]) {
    const img = blur({ amount: 100, method });
    assert.deepEqual(px(img, 4, 3), px(pattern(), 4, 3));
  }
  // Zoom stays on the canvas, so a flat image is untouched everywhere.
  const zoomed = blur({ amount: 100, method: 1 }, flat());
  assert.deepEqual(zoomed.data, flat().data);
  // Spin carries corner samples off the canvas: alpha falls there, but colour stays.
  const spun = blur({ amount: 100, method: 0 }, flat());
  for (let p = 0; p < W * H; p++) {
    assert.deepEqual(Array.from(spun.data.slice(p * 4, p * 4 + 3)), [100, 150, 200]);
  }
  assert.equal(px(spun, 4, 3)[3], 255);
  assert.ok(px(spun, 0, 0)[3] < 255);
});

test('hand-checked Spin and Zoom pixels match an independent reference', () => {
  // Python double-precision reference of blur.rs `radial` (see progress.txt).
  assert.deepEqual(px(blur({ amount: 30, method: 0 }), 7, 1), [210, 37, 100, 213]);
  assert.deepEqual(px(blur({ amount: 100, method: 0 }), 0, 0), [4, 33, 100, 36]);
  assert.deepEqual(px(blur({ amount: 40, method: 1 }), 8, 6), [230, 203, 100, 225]);
  assert.deepEqual(
    px(blur({ amount: 60, method: 1, centerX: 25, centerY: 75 }), 1, 5),
    [36, 173, 100, 145]
  );
});

test('Spin keeps rings and Zoom keeps rays', () => {
  const S = 41;
  const rings = () => field(S, S, (dx, dy) => 128 + 100 * Math.cos(Math.hypot(dx, dy) / 2));
  const rays = () => field(S, S, (dx, dy) => 128 + 100 * Math.cos(4 * Math.atan2(dy, dx)));
  const spin = { amount: 40, method: 0 };
  const zoom = { amount: 40, method: 1 };
  const ringsSpin = meanDiff(blur(spin, rings()), rings(), 0, 19);
  const ringsZoom = meanDiff(blur(zoom, rings()), rings(), 0, 19);
  const raysSpin = meanDiff(blur(spin, rays()), rays(), 8, 19);
  const raysZoom = meanDiff(blur(zoom, rays()), rays(), 8, 19);
  assert.ok(ringsSpin < 3, `rings under Spin moved ${ringsSpin}`);
  assert.ok(raysZoom < 3, `rays under Zoom moved ${raysZoom}`);
  assert.ok(ringsZoom > 4 * ringsSpin, `rings under Zoom moved only ${ringsZoom}`);
  assert.ok(raysSpin > 4 * raysZoom, `rays under Spin moved only ${raysSpin}`);
});

test('averaging is premultiplied: transparent neighbours do not darken colour', () => {
  const img = flat([0, 0, 0, 0]);
  for (let x = 0; x < W; x += 2) img.data.set([255, 40, 0, 255], (6 * W + x) * 4);
  blur({ amount: 100, method: 1 }, img);
  let partial = 0;
  for (let p = 0; p < W * H; p++) {
    const [r, g, b, a] = img.data.slice(p * 4, p * 4 + 4);
    if (a === 0) {
      assert.deepEqual([r, g, b], [0, 0, 0]);
      continue;
    }
    assert.deepEqual([r, g, b], [255, 40, 0]);
    if (a < 255) partial++;
  }
  assert.ok(partial > 0);
});

test('parameters clamp, round, and fall back to defaults', () => {
  const eq = (a, b) => assert.deepEqual(blur(a).data, blur(b).data);
  eq({}, { amount: 10, method: 0, quality: 1, centerX: 50, centerY: 50 });
  eq({ amount: 0 }, { amount: 1 });
  eq({ amount: 500 }, { amount: 100 });
  eq({ amount: 'x', method: NaN }, { amount: 10, method: 0 });
  eq({ amount: 50, method: 7 }, { amount: 50, method: 1 });
  eq({ amount: 50, method: 0.6 }, { amount: 50, method: 1 });
  eq({ amount: 100, quality: -3 }, { amount: 100, quality: 0 });
  eq({ amount: 100, quality: 9 }, { amount: 100, quality: 2 });
  eq({ amount: 50, centerX: 200, centerY: -20 }, { amount: 50, centerX: 100, centerY: 0 });
  // Draft caps the arc at 64 intervals, so a large canvas differs from Good.
  const big = () => field(120, 120, (dx, dy) => (Math.floor((dx + dy) / 3) % 2 ? 230 : 20));
  assert.notDeepEqual(
    blur({ amount: 100, quality: 0 }, big()).data,
    blur({ amount: 100, quality: 1 }, big()).data
  );
});

test('the mask limits writes', () => {
  const mask = new Uint8Array(W * H);
  mask[1 * W + 7] = 1;
  mask[6 * W + 8] = 1;
  const img = blur({ amount: 30, method: 0 }, pattern(), mask);
  const full = blur({ amount: 30, method: 0 });
  const orig = pattern();
  for (let p = 0; p < W * H; p++) {
    const want = mask[p] ? full : orig;
    assert.deepEqual(img.data.slice(p * 4, p * 4 + 4), want.data.slice(p * 4, p * 4 + 4));
  }
  assert.notDeepEqual(px(img, 7, 1), px(orig, 7, 1));
});
