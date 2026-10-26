import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySurfaceBlur, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: W, height: H, data };
}

function clone(img) {
  return { width: img.width, height: img.height, data: img.data.slice() };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

function setPx(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

// Seeded LCG noise so the comparison is deterministic.
function noisy(W, H) {
  const img = image(W, H, [0, 0, 0, 0]);
  let s = 12345;
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    img.data[i] = s >>> 24;
  }
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] < 40 ? 0 : 255;
  return img;
}

// PhotoCraft surface_direct on bytes. Weights are 1 - |v - v0| / t scaled by 2t
// (2t - 2|v - v0|), which leaves the mean unchanged but keeps whole-threshold
// sums exact, so a true .5 tie rounds up instead of drifting to .49999.
function direct(img, r, threshold) {
  const { width: W, height: H, data: s } = img;
  const t = threshold * 2.5;
  const out = s.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v0 = s[o + c];
        let acc = 0,
          wsum = 0;
        for (let yy = y - r; yy <= y + r; yy++) {
          for (let xx = x - r; xx <= x + r; xx++) {
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const q = (yy * W + xx) * 4;
            if (s[q + 3] === 0) continue;
            const w = Math.max(0, 2 * t - 2 * Math.abs(s[q + c] - v0));
            acc += s[q + c] * w;
            wsum += w;
          }
        }
        out[o + c] = wsum > 0 ? Math.round(acc / wsum) : v0;
      }
    }
  }
  return out;
}

test('surfaceBlur and despeckle are registered and dispatch', () => {
  const sb = ADJUSTMENTS.surfaceBlur;
  assert.equal(sb.label, 'Surface Blur');
  assert.deepEqual(
    sb.fields.map((f) => [f.key, f.label, f.min, f.max, f.default]),
    [
      ['radius', 'Radius', 1, 100, 5],
      ['threshold', 'Threshold', 2, 255, 15]
    ]
  );
  const a = noisy(11, 7);
  const b = clone(a);
  sb.apply(a, { radius: 3, threshold: 40 }, null);
  applySurfaceBlur(b, 3, 40);
  assert.deepEqual(a.data, b.data);

  const ds = ADJUSTMENTS.despeckle;
  assert.equal(ds.label, 'Despeckle');
  assert.deepEqual(ds.fields, []);
  const c = noisy(11, 7);
  const e = clone(c);
  ds.apply(c, {}, null);
  applySurfaceBlur(e, 2, 12);
  assert.deepEqual(c.data, e.data);
});

test('a flat image is unchanged', () => {
  const img = image(9, 5, [80, 120, 200, 255]);
  const before = img.data.slice();
  applySurfaceBlur(img, 4, 30);
  assert.deepEqual(img.data, before);
});

test('a hard step stays sharp while low-amplitude noise is smoothed', () => {
  const W = 20,
    H = 9;
  const img = image(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const base = x < 10 ? 40 : 200;
      const n = (x * 3 + y * 5) % 5; // 0..4
      setPx(img, x, y, [base + n, base + n, base + n, 255]);
    }
  }
  const before = clone(img);
  applySurfaceBlur(img, 3, 10); // t = 25, step 160
  let spreadBefore = 0,
    spreadAfter = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [v] = px(img, x, y);
      if (x < 10) assert.ok(v >= 40 && v <= 44, `left ${x},${y} = ${v}`);
      else assert.ok(v >= 200 && v <= 204, `right ${x},${y} = ${v}`);
      const mid = x < 10 ? 42 : 202;
      spreadBefore += Math.abs(px(before, x, y)[0] - mid);
      spreadAfter += Math.abs(v - mid);
    }
  }
  assert.ok(spreadAfter < spreadBefore / 2, `${spreadAfter} vs ${spreadBefore}`);
});

test('a hand-computed pixel matches the weighted formula at the border', () => {
  // 5x3, radius 1, threshold 4 (t = 10). Pixel (0, 1): window x -1..1, y 0..2,
  // the x = -1 column is outside, and (1, 0) has alpha 0.
  const img = image(5, 3, [100, 100, 100, 255]);
  setPx(img, 0, 0, [104, 100, 100, 255]);
  setPx(img, 1, 0, [100, 100, 100, 0]);
  setPx(img, 0, 1, [100, 100, 100, 255]);
  setPx(img, 1, 1, [108, 100, 100, 255]);
  setPx(img, 0, 2, [130, 100, 100, 255]);
  setPx(img, 1, 2, [95, 100, 100, 255]);
  const before = clone(img);
  applySurfaceBlur(img, 1, 4);
  // v0 = 100: 104 w .6, 100 w 1, 108 w .2, 130 w 0, 95 w .5.
  const acc = 104 * 0.6 + 100 + 108 * 0.2 + 95 * 0.5;
  const wsum = 0.6 + 1 + 0.2 + 0.5;
  assert.equal(px(img, 0, 1)[0], Math.round(acc / wsum));
  assert.equal(px(img, 0, 1)[0], 101);
  assert.deepEqual(img.data, direct(before, 1, 4));
});

test('matches the direct window sum on noisy data with transparent pixels', () => {
  for (const [r, th] of [
    [1, 2],
    [2, 15],
    [4, 60],
    [3, 255]
  ]) {
    const img = noisy(13, 8);
    const want = direct(img, r, th);
    applySurfaceBlur(img, r, th);
    assert.deepEqual(img.data, want, `r ${r} threshold ${th}`);
  }
});

test('alpha is unchanged', () => {
  const img = noisy(10, 6);
  const alpha = img.data.filter((_, i) => i % 4 === 3);
  applySurfaceBlur(img, 3, 100);
  assert.deepEqual(
    img.data.filter((_, i) => i % 4 === 3),
    alpha
  );
});

test('radius and threshold round and clamp', () => {
  const run = (r, th) => {
    const img = noisy(12, 7);
    applySurfaceBlur(img, r, th);
    return img.data;
  };
  assert.deepEqual(run(2.4, 20), run(2, 20));
  assert.deepEqual(run(2.6, 20), run(3, 20));
  assert.deepEqual(run(0, 20), run(1, 20));
  assert.deepEqual(run(-5, 20), run(1, 20));
  assert.deepEqual(run(500, 20), run(100, 20));
  assert.deepEqual(run(2, 0), run(2, 2));
  assert.deepEqual(run(2, 1000), run(2, 255));
  assert.deepEqual(run(2, 0), direct(noisy(12, 7), 2, 2));
});

test('despeckle equals radius 2 threshold 12', () => {
  const a = noisy(14, 9);
  const b = clone(a);
  ADJUSTMENTS.despeckle.apply(a, {}, null);
  applySurfaceBlur(b, 2, 12);
  assert.deepEqual(a.data, b.data);
  assert.deepEqual(b.data, direct(noisy(14, 9), 2, 12));
});

test('radius 100 on 64x48 finishes in under 2 seconds', () => {
  const img = noisy(64, 48);
  const start = performance.now();
  applySurfaceBlur(img, 100, 255);
  assert.ok(performance.now() - start < 2000);
});

test('the mask limits writes but masked-out pixels are still read', () => {
  const W = 9,
    H = 5;
  const img = noisy(W, H);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 4; x++) mask[y * W + x] = 1;
  const full = clone(img);
  applySurfaceBlur(full, 2, 80);
  const before = img.data.slice();
  applySurfaceBlur(img, 2, 80, mask);
  for (let p = 0; p < W * H; p++) {
    const got = Array.from(img.data.slice(p * 4, p * 4 + 4));
    const want = mask[p] ? full.data.slice(p * 4, p * 4 + 4) : before.slice(p * 4, p * 4 + 4);
    assert.deepEqual(got, Array.from(want), `p ${p}`);
  }
});
