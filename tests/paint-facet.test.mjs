import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFacet, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square: 7 wide, 6 tall. Quadrants for (x, y), in order: Q0 top-left
// (x-2..x, y-2..y), Q1 top-right (x..x+2, y-2..y), Q2 bottom-left, Q3 bottom-right.
const W = 7;
const H = 6;

function image(fill = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(fill, p * 4);
  return { width: W, height: H, data };
}

const set = (img, x, y, px) => img.data.set(px, (y * W + x) * 4);
const pxAt = (img, x, y) => Array.from(img.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

const A = [100, 150, 200];
const B = [20, 40, 60];

// Columns 0..2 white. Columns 3..6: rows 0..2 colour A, rows 3..5 colour B.
// Around (4, 2), Q1 (x 4..6, y 0..2) is all colour A; Q0 and Q2 straddle the
// white edge and Q3 straddles the A/B edge. Alpha does not enter luma.
function edges() {
  const img = image([255, 255, 255, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = 3; x < W; x++) set(img, x, y, [...(y <= 2 ? A : B), 255]);
  }
  set(img, 6, 0, [...A, 120]);
  set(img, 5, 1, [...A, 0]);
  set(img, 4, 2, [...A, 30]);
  return img;
}

// Deterministic luma noise so no quadrant is flat by accident.
function noisy() {
  const img = image();
  for (let p = 0; p < W * H; p++) {
    const v = (p * 73 + 41) % 251;
    img.data.set([v, (v * 3) % 256, (v * 7) % 256, 255], p * 4);
  }
  return img;
}

test('facet is registered with no fields and apply dispatches', () => {
  const def = ADJUSTMENTS.facet;
  assert.equal(def.label, 'Facet');
  assert.deepEqual(def.fields, []);
  const a = noisy();
  const b = noisy();
  def.apply(a, {}, null);
  applyFacet(b);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.notDeepEqual(Array.from(a.data), Array.from(noisy().data));
});

test('a flat image is unchanged', () => {
  const img = image([30, 60, 90, 200]);
  applyFacet(img);
  assert.deepEqual(Array.from(img.data), Array.from(image([30, 60, 90, 200]).data));
});

test('the flat quadrant wins over quadrants that straddle an edge', () => {
  const img = edges();
  applyFacet(img);
  // Q1 alphas: six 255s, 120, 0, 30 -> 1680 / 9 = 186.67.
  assert.deepEqual(pxAt(img, 4, 2), [...A, 187]);
});

test('the lowest-variance quadrant is averaged plainly, alpha included', () => {
  const img = edges();
  set(img, 5, 1, [0, 0, 0, 0]);
  applyFacet(img);
  // Q1 luma: eight 140.75 and one 0, variance ~1956. Q3 (three A, six B) ~2424,
  // Q0 (three white, six A) ~2900, Q2 higher. Plain means: 800/9, 1200/9, 1600/9,
  // and alpha 1680/9 (premultiplying would weight the transparent black out).
  assert.deepEqual(pxAt(img, 4, 2), [89, 133, 178, 187]);
});

test('ties keep the earliest quadrant', () => {
  // Same RGB everywhere, so every quadrant has zero luma variance.
  const img = image([50, 50, 50, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = 4; x < W; x++) set(img, x, y, [50, 50, 50, 100]);
  }
  applyFacet(img);
  // (3, 3): Q0 is x 1..3, all alpha 255 (Q1 would give 152).
  assert.deepEqual(pxAt(img, 3, 3), [50, 50, 50, 255]);
  // (4, 3): Q0 is x 2..4 -> (6 * 255 + 3 * 100) / 9 = 203.3 (Q1 would give 100).
  assert.deepEqual(pxAt(img, 4, 3), [50, 50, 50, 203]);
});

test('edge pixels repeat edge samples', () => {
  const img = noisy();
  const before = pxAt(img, 0, 0);
  set(img, 0, 0, [80, 90, 100, 255]);
  set(img, 0, 1, [80, 90, 100, 255]);
  set(img, 0, 2, [80, 90, 100, 30]);
  set(img, 6, 5, before);
  applyFacet(img);
  // (0, 0): Q0 is nine copies of itself, so the corner keeps its colour.
  assert.deepEqual(pxAt(img, 0, 0), [80, 90, 100, 255]);
  // (6, 5): Q3 is nine copies of itself; earlier quadrants are noisy.
  assert.deepEqual(pxAt(img, 6, 5), before);
  // (0, 2): Q0 is column 0, rows 0..2, each three times -> (6 * 255 + 3 * 30) / 9.
  assert.deepEqual(pxAt(img, 0, 2), [80, 90, 100, 180]);
});

test('the mask limits writes but covered pixels read uncovered neighbours', () => {
  const img = edges();
  const orig = edges();
  const mask = new Uint8Array(W * H);
  mask[2 * W + 4] = 1;
  applyFacet(img, mask);
  assert.deepEqual(pxAt(img, 4, 2), [...A, 187]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x === 4 && y === 2) continue;
      assert.deepEqual(pxAt(img, x, y), pxAt(orig, x, y), `(${x}, ${y})`);
    }
  }
});
