import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPolarCoordinates, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square so a w / h / rmax mix-up shows: cx = 6, cy = 4, rmax = 4.
const W = 12;
const H = 8;

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

// Every pixel is distinct in every channel, so a wrong source can't pass by coincidence.
const chart = (x, y) => [x * 20 + 3, y * 30 + 4, (x * 8 + y) * 2 + 1, 255 - x * 5 - y * 7];
const src = image(chart);

test('polar coordinates is registered and apply dispatches', () => {
  const def = ADJUSTMENTS.polarCoordinates;
  assert.equal(def.label, 'Polar Coordinates');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.label, f.min, f.max, f.default]),
    [['mode', 'Mode', 0, 1, 0]]
  );
  for (const mode of [0, 1]) {
    const a = image(chart);
    const b = image(chart);
    def.apply(a, { mode }, null);
    applyPolarCoordinates(b, mode);
    assert.deepEqual(a.data, b.data);
    assert.notDeepEqual(a.data, src.data);
  }
});

test('a flat image is unchanged in both modes', () => {
  const flat = () => [30, 140, 220, 180];
  for (const mode of [0, 1]) {
    const f = image(flat);
    applyPolarCoordinates(f, mode);
    assert.deepEqual(f.data, image(flat).data);
  }
});

test('rectangular to polar: hand-computed pixels', () => {
  const img = image(chart);
  applyPolarCoordinates(img, 0);
  // [output x, output y, source x, source y]
  for (const [x, y, sx, sy] of [
    [6, 4, 6, 0], // centre: radius 0 reads the top row at theta = PI
    [4, 4, 3, 4], // 9 o'clock: theta = PI / 2, quarter of the width
    [6, 6, 6, 4], // 6 o'clock: theta = PI, half the width
    [8, 4, 9, 4], // 3 o'clock: theta = 3 PI / 2
    [6, 2, 11, 4] // 12 o'clock seam reads the right edge (theta = 2 PI), not column 0
  ]) {
    assert.deepEqual(px(img, x, y), px(src, sx, sy), `(${x}, ${y})`);
  }
});

test('rectangular to polar: corners outside the circle repeat edge pixels', () => {
  const img = image(chart);
  applyPolarCoordinates(img, 0);
  // (0, 0): theta = atan2(6, 4), radius sqrt(52) / 4 * 8 > H, so the bottom row repeats.
  const theta = Math.atan2(6, 4);
  const fx = (theta / (2 * Math.PI)) * W;
  const x0 = Math.floor(fx);
  const ax = fx - x0;
  const a = px(src, x0, H - 1);
  const b = px(src, x0 + 1, H - 1);
  const alpha = a[3] * (1 - ax) + b[3] * ax;
  const out = px(img, 0, 0);
  assert.equal(out[3], Math.round(alpha));
  for (let c = 0; c < 3; c++) {
    const v = (a[c] * a[3] * (1 - ax) + b[c] * b[3] * ax) / alpha;
    assert.equal(out[c], Math.round(v), `channel ${c}`);
  }
  for (const [x, y] of [
    [W - 1, 0],
    [0, H - 1],
    [W - 1, H - 1]
  ]) {
    assert.ok(px(img, x, y)[3] >= 151, `corner (${x}, ${y}) is not transparent`);
  }
});

test('polar to rectangular: hand-computed pixels', () => {
  const img = image(chart);
  applyPolarCoordinates(img, 1);
  // theta = (x + 1) / 12 * 2 PI, r = y / 2; source (6 - r sin theta, 4 - r cos theta).
  for (const [x, y, sx, sy] of [
    [2, 4, 4, 4], // theta = PI / 2
    [5, 4, 6, 6], // theta = PI
    [8, 4, 8, 4], // theta = 3 PI / 2
    [11, 4, 6, 2], // theta = 2 PI
    [11, 6, 6, 1], // r = 3
    [0, 0, 6, 4], // r = 0 is the centre on every column
    [7, 0, 6, 4]
  ]) {
    assert.deepEqual(px(img, x, y), px(src, sx, sy), `(${x}, ${y})`);
  }
});

test('mode rounds and clamps to 0..1', () => {
  const run = (mode) => {
    const img = image(chart);
    applyPolarCoordinates(img, mode);
    return img.data;
  };
  const m0 = run(0);
  const m1 = run(1);
  assert.notDeepEqual(m0, m1);
  assert.deepEqual(run(0.4), m0);
  assert.deepEqual(run(-3), m0);
  assert.deepEqual(run(NaN), m0);
  assert.deepEqual(run(0.6), m1);
  assert.deepEqual(run(7), m1);
});

test('a mask limits writes but masked-in pixels read masked-out sources', () => {
  const mask = new Uint8Array(W * H);
  mask[2 * W + 6] = 1;
  const img = image(chart);
  applyPolarCoordinates(img, 0, mask);
  assert.deepEqual(px(img, 6, 2), px(src, 11, 4));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x === 6 && y === 2) continue;
      assert.deepEqual(px(img, x, y), px(src, x, y), `(${x}, ${y})`);
    }
  }
});
