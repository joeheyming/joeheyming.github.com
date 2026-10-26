import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPointillize,
  pointillizeDot,
  crystallizeCellPoint,
  hash01,
  ADJUSTMENTS
} from '../paint/adjustments.js';

// Non-square: 13 wide, 9 tall, cell size 4.
const W = 13;
const H = 9;
const CELL = 4;
const WHITE = [255, 255, 255, 255];

function image(fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(fill, p * 4);
  return { width: W, height: H, data };
}

const pxAt = (img, x, y) => Array.from(img.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

// Every pixel distinct, with varied alpha.
function noisy() {
  const img = image();
  for (let p = 0; p < W * H; p++) {
    const v = (p * 73 + 41) % 251;
    img.data.set([v, (v * 3) % 256, (v * 7) % 256, 55 + (p % 200)], p * 4);
  }
  return img;
}

// The expected output pixel, from the story's formula in doubles.
function expected(src, x, y, seed, bg = WHITE) {
  const i = (y * W + x) * 4;
  const canvas = [bg[0], bg[1], bg[2], Math.max(src.data[i + 3], bg[3])];
  const best = pointillizeDot(x, y, CELL, seed);
  if (best) {
    const [depth, gx, gy, px, py] = best;
    const sx = Math.max(0, Math.min(W - 1, Math.floor(px)));
    const sy = Math.max(0, Math.min(H - 1, Math.floor(py)));
    const dot = pxAt(src, sx, sy);
    const j = (hash01(gx, gy, 17, seed) - 0.5) * 0.08 * 255;
    for (let c = 0; c < 3; c++) dot[c] = Math.max(0, Math.min(255, dot[c] + j));
    const k = Math.max(0, Math.min(1, depth + 0.5));
    for (let c = 0; c < 4; c++) canvas[c] += (dot[c] - canvas[c]) * k;
  }
  return canvas.map(Math.round);
}

test('pointillize is registered with cellSize and seed and apply dispatches', () => {
  const def = ADJUSTMENTS.pointillize;
  assert.equal(def.label, 'Pointillize');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.min, f.max, f.default]),
    [
      ['cellSize', 3, 300, 5],
      ['seed', 0, 9999, 0]
    ]
  );
  const a = noisy();
  const b = noisy();
  def.apply(a, { cellSize: CELL, seed: 3 }, null);
  applyPointillize(b, CELL, 3, WHITE);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.notDeepEqual(Array.from(a.data), Array.from(noisy().data));
});

test('hand-checked winning dot, radius, depth and output at (5, 6), seed 0', () => {
  // Centre (5.5, 6.5) is in grid cell (1, 1), whose point is about (4.5447, 6.0936).
  const [px, py] = crystallizeCellPoint(1, 1, CELL, 0);
  assert.ok(Math.abs(px - 4.5447) < 1e-3 && Math.abs(py - 6.0936) < 1e-3);
  // Radius = 4 * (0.45 + 0.35 * hash01(1, 1, 13, 0)) = 4 * (0.45 + 0.35 * 0.81427) = 2.93998.
  const rad = CELL * (0.45 + 0.35 * hash01(1, 1, 13, 0));
  assert.ok(Math.abs(rad - 2.93998) < 1e-4);
  // Distance = sqrt(0.9553^2 + 0.4064^2) = 1.03817, so depth = 1.90181.
  const best = pointillizeDot(5, 6, CELL, 0);
  assert.deepEqual(best.slice(1, 3), [1, 1]);
  assert.ok(Math.abs(best[0] - 1.90181) < 1e-4);
  // Depth + 0.5 > 1, so the pixel is the dot: source (4, 6) brightened by
  // (hash01(1, 1, 17, 0) - 0.5) * 0.08 * 255 = (0.84162 - 0.5) * 20.4 = 6.969.
  const src = noisy();
  const img = noisy();
  applyPointillize(img, CELL, 0, WHITE);
  const s = pxAt(src, 4, 6);
  assert.deepEqual(s, [3, 9, 21, 137]);
  assert.deepEqual(pxAt(img, 5, 6), [10, 16, 28, 137]);
});

test('a pixel on a dot edge blends the dot over the background', () => {
  // (6, 4) is inside dot (1, 1) by about 0.4175, so k = 0.9175.
  const best = pointillizeDot(6, 4, CELL, 0);
  assert.deepEqual(best.slice(1, 3), [1, 1]);
  assert.ok(Math.abs(best[0] - 0.4175) < 1e-3);
  const src = noisy();
  const img = noisy();
  applyPointillize(img, CELL, 0, WHITE);
  // Dot [9.969, 15.969, 27.969, 137] over white at k 0.91751.
  assert.deepEqual(pxAt(img, 6, 4), [30, 36, 47, 147]);
  assert.deepEqual(pxAt(img, 6, 4), expected(src, 6, 4, 0));
});

test('every pixel matches the formula', () => {
  for (const seed of [0, 1, 7]) {
    const src = noisy();
    const img = noisy();
    applyPointillize(img, CELL, seed, WHITE);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        assert.deepEqual(pxAt(img, x, y), expected(src, x, y, seed), `${seed}: ${x},${y}`);
      }
    }
  }
});

test('a pixel far from every dot takes the background', () => {
  // With seed 1, no dot reaches (8, 2).
  assert.equal(pointillizeDot(8, 2, CELL, 1), null);
  const img = noisy();
  const alpha = pxAt(img, 8, 2)[3];
  applyPointillize(img, CELL, 1, WHITE);
  assert.deepEqual(pxAt(img, 8, 2), WHITE);
  // Alpha is max(source alpha, background alpha).
  const img2 = noisy();
  applyPointillize(img2, CELL, 1, [10, 20, 30, 0]);
  assert.deepEqual(pxAt(img2, 8, 2), [10, 20, 30, alpha]);
});

test('a fixed seed is deterministic and another seed differs', () => {
  const a = noisy();
  const b = noisy();
  const c = noisy();
  applyPointillize(a, CELL, 42, WHITE);
  applyPointillize(b, CELL, 42, WHITE);
  applyPointillize(c, CELL, 43, WHITE);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.notDeepEqual(Array.from(a.data), Array.from(c.data));
});

test('cell size clamps to 3..300', () => {
  const a = noisy();
  const b = noisy();
  applyPointillize(a, 1, 0, WHITE);
  applyPointillize(b, 3, 0, WHITE);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
});

test('the mask limits writes; covered pixels still read uncovered sources', () => {
  const src = noisy();
  const img = noisy();
  const mask = new Uint8Array(W * H);
  // Cover (5, 6) only; its dot reads (4, 6), which stays uncovered.
  mask[6 * W + 5] = 1;
  applyPointillize(img, CELL, 0, WHITE, mask);
  for (let p = 0; p < W * H; p++) {
    const x = p % W;
    const y = Math.floor(p / W);
    if (mask[p]) assert.deepEqual(pxAt(img, x, y), [10, 16, 28, 137]);
    else assert.deepEqual(pxAt(img, x, y), pxAt(src, x, y));
  }
});
