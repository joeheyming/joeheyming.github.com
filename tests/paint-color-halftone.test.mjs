import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyColorHalftone, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(fill, p * 4);
  return { width: W, height: H, data };
}

const pxAt = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

// Every pixel distinct, with varied alpha.
function noisy(W = 13, H = 9) {
  const img = image(W, H);
  for (let p = 0; p < W * H; p++) {
    const v = (p * 73 + 41) % 251;
    img.data.set([v, (v * 3) % 256, (v * 7) % 256, 55 + (p % 200)], p * 4);
  }
  return img;
}

test('color halftone is registered and dispatches its fields', () => {
  const adj = ADJUSTMENTS.colorHalftone;
  assert.equal(adj.label, 'Color Halftone');
  const f = Object.fromEntries(adj.fields.map((x) => [x.key, [x.min, x.max, x.default]]));
  assert.deepEqual(f, {
    maxRadius: [4, 127, 8],
    channel1: [-360, 360, 108],
    channel2: [-360, 360, 162],
    channel3: [-360, 360, 90]
  });
  const a = noisy();
  const b = noisy();
  adj.apply(a, { maxRadius: 5, channel1: 10, channel2: 20, channel3: 30 }, null);
  applyColorHalftone(b, 5, 10, 20, 30);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, noisy().data);
});

test('white stays white and alpha is kept', () => {
  const img = noisy();
  for (let p = 0; p < 13 * 9; p++) img.data.set([255, 255, 255], p * 4);
  const before = new Uint8ClampedArray(img.data);
  applyColorHalftone(img, 8, 108, 162, 90);
  assert.deepEqual(img.data, before);
});

test('black is fully covered away from the gaps between dots', () => {
  // Angle 0, maxRadius 8: cell 11.3137, full dots of radius 8 at (k + 0.5) * cell.
  const img = image(24, 24, [0, 0, 0, 128]);
  applyColorHalftone(img, 8, 0, 0, 0);
  const cell = 8 * Math.SQRT2;
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const [cx, cy] = [x + 0.5, y + 0.5].map((v) => (((v % cell) + cell) % cell) - cell / 2);
      if (Math.hypot(cx, cy) <= 7) assert.deepEqual(pxAt(img, x, y), [0, 0, 0, 128]);
    }
  }
  // The cell corner (11.31, 11.31) sits about 8 from four dot centres: only partly covered.
  const corner = pxAt(img, 11, 11)[0];
  assert.ok(corner > 0 && corner < 255, `corner ${corner}`);
});

test('a hand-checked dot radius and edge pixel', () => {
  // Flat 191 grey, angle 0, maxRadius 8: raw = 191 / 255 = 0.74902, ink = 0.25098
  // (below PI / 4), r = 11.3137 * sqrt(0.25098 / PI) = 3.19776.
  // Pixel (8, 5) has centre (8.5, 5.5); cell (0, 0) has centre (5.65685, 5.65685).
  // d = 2.84748, coverage = 3.19776 - 2.84748 + 0.5 = 0.85028, out = round(0.14972 * 255) = 38.
  const img = image(20, 12, [191, 191, 191, 200]);
  applyColorHalftone(img, 8, 0, 0, 0);
  assert.deepEqual(pxAt(img, 8, 5), [38, 38, 38, 200]);
  // The pixel at the dot centre is fully covered; a pixel beyond the radius is white.
  assert.deepEqual(pxAt(img, 5, 5), [0, 0, 0, 200]);
  assert.deepEqual(pxAt(img, 11, 5), [255, 255, 255, 200]);
});

test('angle 0 gives axis-aligned cells that repeat every cell along x', () => {
  const W = 40;
  const H = 30;
  const img = image(W, H, [120, 120, 120, 255]);
  applyColorHalftone(img, 6, 0, 0, 0);
  const cell = 6 * Math.SQRT2;
  const ink = 1 - 120 / 255;
  const r = ink <= Math.PI / 4 ? cell * Math.sqrt(ink / Math.PI) : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Distance to the nearest axis-aligned cell centre.
      const [cx, cy] = [x + 0.5, y + 0.5].map((v) => (v % cell) - cell / 2);
      const cov = Math.min(Math.max(r - Math.hypot(cx, cy) + 0.5, 0), 1);
      const want = Math.round((1 - cov) * 255);
      assert.ok(Math.abs(pxAt(img, x, y)[0] - want) <= 1, `(${x}, ${y})`);
    }
  }
  // Axis-aligned square cells are symmetric under transposition.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < H; x++) {
      assert.deepEqual(pxAt(img, x, y), pxAt(img, y, x), `(${x}, ${y})`);
    }
  }
});

test('five taps clamp to the canvas at the border', () => {
  // Angle 0, maxRadius 4: cell 5.65685. Column 0 is black, the rest white.
  // Cell (-1, 0) has centre (-2.83, 2.83): all five taps clamp to x = 0 and read black,
  // so its full radius-4 dot reaches into the canvas. Cell (0, 0) reads white.
  const img = image(12, 12, [255, 255, 255, 255]);
  for (let y = 0; y < 12; y++) img.data.set([0, 0, 0], y * 12 * 4);
  applyColorHalftone(img, 4, 0, 0, 0);
  // (0, 2): d = 3.351 from (-2.83, 2.83), coverage 1.
  assert.deepEqual(pxAt(img, 0, 2), [0, 0, 0, 255]);
  // (1, 2): centre (1.5, 2.5), d = 4.3410, coverage 0.1590, out = round(0.8410 * 255) = 214.
  assert.deepEqual(pxAt(img, 1, 2), [214, 214, 214, 255]);
  // (2, 2) is too far from cell -1 and cell 0 is white.
  assert.deepEqual(pxAt(img, 2, 2), [255, 255, 255, 255]);
});

test('maxRadius clamps to 4..127', () => {
  const run = (radius) => {
    const img = noisy();
    applyColorHalftone(img, radius, 108, 162, 90);
    return img.data;
  };
  assert.deepEqual(run(1), run(4));
  assert.deepEqual(run(-50), run(4));
  assert.deepEqual(run(500), run(127));
  assert.notDeepEqual(run(4), run(8));
  const def = noisy();
  applyColorHalftone(def, undefined, 108, 162, 90);
  assert.deepEqual(def.data, run(8));
  const ang = noisy();
  applyColorHalftone(ang, 8, 1000, -1000, 90);
  const clamped = noisy();
  applyColorHalftone(clamped, 8, 360, -360, 90);
  assert.deepEqual(ang.data, clamped.data);
});

test('the mask limits writes but reads stay unmasked', () => {
  const W = 13;
  const H = 9;
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) mask[p] = p % 3 === 0 ? 1 : 0;
  const full = noisy();
  applyColorHalftone(full, 4, 108, 162, 90);
  const masked = noisy();
  applyColorHalftone(masked, 4, 108, 162, 90, mask);
  const orig = noisy();
  for (let p = 0; p < W * H; p++) {
    const want = mask[p] ? full : orig;
    assert.deepEqual(
      Array.from(masked.data.slice(p * 4, p * 4 + 4)),
      Array.from(want.data.slice(p * 4, p * 4 + 4))
    );
  }
});
