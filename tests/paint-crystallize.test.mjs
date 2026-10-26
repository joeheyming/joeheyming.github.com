import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCrystallize,
  crystallizeCellPoint,
  crystallizeOwner,
  hash01,
  ADJUSTMENTS
} from '../paint/adjustments.js';

// Non-square: 13 wide, 9 tall, cell size 4.
const W = 13;
const H = 9;
const CELL = 4;

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

// The Rust formula in u32 arithmetic, written with BigInt.
function hashRef(x, y, c, seed) {
  const M = (1n << 32n) - 1n;
  const u = (v) => BigInt.asUintN(32, BigInt(v));
  const mul = (a, b) => (a * b) & M;
  let h = mul(u(x), 0x8da6b343n) ^ mul(u(y), 0xd8163841n) ^ mul(u(c), 0xcb1ab31fn);
  h ^= mul(u(seed), 0x9e3779b9n);
  h ^= h >> 16n;
  h = mul(h, 0x7feb352dn);
  h ^= h >> 15n;
  h = mul(h, 0x846ca68bn);
  h ^= h >> 16n;
  return Number(h >> 8n) / 16777216;
}

test('crystallize is registered with cellSize and seed and apply dispatches', () => {
  const def = ADJUSTMENTS.crystallize;
  assert.equal(def.label, 'Crystallize');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.min, f.max, f.default]),
    [
      ['cellSize', 3, 300, 10],
      ['seed', 0, 9999, 0]
    ]
  );
  const a = noisy();
  const b = noisy();
  def.apply(a, { cellSize: CELL, seed: 3 }, null);
  applyCrystallize(b, CELL, 3);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.notDeepEqual(Array.from(a.data), Array.from(noisy().data));
});

test('hash01 matches the Rust u32 formula, including negative coordinates', () => {
  for (const [x, y, c, s] of [
    [0, 0, 11, 0],
    [-1, 2, 12, 7],
    [3, -5, 11, 9999],
    [-2147483648, 2147483647, 12, 4294967295]
  ]) {
    assert.equal(hash01(x, y, c, s), hashRef(x, y, c, s));
  }
  // Computed by hand from the Rust formula.
  assert.equal(hash01(0, 0, 11, 0), 15974133 / 16777216);
  assert.equal(hash01(-1, 2, 12, 7), hashRef(4294967295, 2, 12, 7));
});

test('a flat image is unchanged', () => {
  const img = image([30, 60, 90, 200]);
  applyCrystallize(img, CELL, 5);
  assert.deepEqual(Array.from(img.data), Array.from(image([30, 60, 90, 200]).data));
});

test('pixels whose owner point is on-canvas copy the source pixel under it', () => {
  const src = noisy();
  const img = noisy();
  applyCrystallize(img, CELL, 0);
  let checked = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [cx, cy] = crystallizeOwner(x, y, CELL, 0);
      const [px, py] = crystallizeCellPoint(cx, cy, CELL, 0);
      const sx = Math.floor(px);
      const sy = Math.floor(py);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      assert.deepEqual(pxAt(img, x, y), pxAt(src, sx, sy), `pixel ${x},${y}`);
      checked++;
    }
  }
  assert.ok(checked > (W * H) / 2);
});

test('a fixed seed is deterministic and another seed differs', () => {
  const a = noisy();
  const b = noisy();
  const c = noisy();
  applyCrystallize(a, CELL, 42);
  applyCrystallize(b, CELL, 42);
  applyCrystallize(c, CELL, 43);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.notDeepEqual(Array.from(a.data), Array.from(c.data));
});

test('hand-checked owner and output on 13x9, cell 4, seed 0', () => {
  // Pixel (5, 6) has centre (5.5, 6.5) in grid cell (1, 1). Cell (1, 1)'s point is
  // ((1.1 + 0.8 * hash01(1, 1, 11, 0)) * 4, (1.1 + 0.8 * hash01(1, 1, 12, 0)) * 4).
  const px = (1.1 + 0.8 * hashRef(1, 1, 11, 0)) * 4;
  const py = (1.1 + 0.8 * hashRef(1, 1, 12, 0)) * 4;
  const [fx, fy] = crystallizeCellPoint(1, 1, CELL, 0);
  assert.ok(Math.abs(fx - px) < 1e-5 && Math.abs(fy - py) < 1e-5);
  assert.ok(Math.abs(fx - 4.5447) < 1e-3 && Math.abs(fy - 6.0936) < 1e-3);
  // Its squared distance is about 1.08; the nearest rival, cell (1, 2) at (4.55, 8.84), is
  // about 6.4.
  assert.deepEqual(crystallizeOwner(5, 6, CELL, 0), [1, 1]);
  const src = noisy();
  const img = noisy();
  applyCrystallize(img, CELL, 0);
  assert.deepEqual(pxAt(img, 5, 6), pxAt(src, 4, 6));
});

test('a cell whose point is off-canvas takes its alpha-weighted average', () => {
  const src = noisy();
  const img = noisy();
  applyCrystallize(img, CELL, 0);
  // Cell (0, -1)'s point lies above the canvas.
  assert.ok(crystallizeCellPoint(0, -1, CELL, 0)[1] < 0);
  const owned = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [cx, cy] = crystallizeOwner(x, y, CELL, 0);
      if (cx === 0 && cy === -1) owned.push([x, y]);
    }
  }
  assert.ok(owned.length > 0);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const [x, y] of owned) {
    const [pr, pg, pb, pa] = pxAt(src, x, y);
    r += pr * pa;
    g += pg * pa;
    b += pb * pa;
    a += pa;
  }
  const want = [r / a, g / a, b / a, a / owned.length].map(Math.round);
  for (const [x, y] of owned) assert.deepEqual(pxAt(img, x, y), want);
});

test('the mask limits writes but covered pixels still read uncovered sources', () => {
  const src = noisy();
  const img = noisy();
  const full = noisy();
  applyCrystallize(full, CELL, 0);
  // Cover only pixel (5, 6); its source (4, 6) is uncovered.
  const mask = new Uint8Array(W * H);
  mask[6 * W + 5] = 1;
  applyCrystallize(img, CELL, 0, mask);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const want = mask[y * W + x] ? pxAt(full, x, y) : pxAt(src, x, y);
      assert.deepEqual(pxAt(img, x, y), want, `pixel ${x},${y}`);
    }
  }
  assert.deepEqual(pxAt(img, 5, 6), pxAt(src, 4, 6));
});
