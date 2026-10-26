import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNtscColors, ADJUSTMENTS } from '../paint/adjustments.js';

// Non-square: 3 wide, 2 tall.
const W = 3;
const H = 2;

function image(pixels, w = W, h = H) {
  const data = new Uint8ClampedArray(w * h * 4);
  pixels.forEach((p, i) => data.set(p, i * 4));
  return { width: w, height: h, data };
}

const pxAt = (img, p) => Array.from(img.data.slice(p * 4, p * 4 + 4));

const yiq = ([r, g, b]) => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  return {
    y: 0.299 * R + 0.587 * G + 0.114 * B,
    i: 0.595716 * R - 0.274453 * G - 0.321263 * B,
    q: 0.211456 * R - 0.522591 * G + 0.311135 * B
  };
};

const SATURATED = [
  [255, 255, 0, 255],
  [0, 0, 255, 128],
  [255, 0, 0, 0],
  [0, 255, 255, 255],
  [255, 255, 64, 200],
  [0, 255, 200, 255]
];

test('ntscColors is registered with no fields and apply dispatches', () => {
  const def = ADJUSTMENTS.ntscColors;
  assert.equal(def.label, 'NTSC Colors');
  assert.deepEqual(def.fields, []);
  const a = image(SATURATED);
  const b = image(SATURATED);
  def.apply(a, {}, null);
  applyNtscColors(b, null);
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, image(SATURATED).data);
});

test('grays and muted colours are unchanged', () => {
  const safe = [
    [0, 0, 0, 255],
    [128, 128, 128, 255],
    [255, 255, 255, 64],
    [200, 100, 90, 255],
    [255, 0, 255, 255],
    [10, 200, 30, 0]
  ];
  const img = image(safe);
  applyNtscColors(img);
  assert.deepEqual(img.data, image(safe).data);
});

test('hand-computed yellow and blue are pulled inside the limits', () => {
  // Yellow: Y 0.886, chroma 0.447230, Y + chroma > 112.5 / 92.5, k = 0.73836.
  // Blue: Y 0.114, chroma 0.447230, Y - chroma < -27.5 / 92.5, k = 0.919654.
  const img = image(
    [
      [255, 255, 0, 255],
      [0, 0, 255, 255]
    ],
    2,
    1
  );
  applyNtscColors(img);
  assert.deepEqual(pxAt(img, 0), [247, 247, 59, 255]);
  assert.deepEqual(pxAt(img, 1), [2, 2, 237, 255]);
});

test('saturated colours keep luma and hue, lose chroma, and keep alpha', () => {
  const img = image(SATURATED);
  applyNtscColors(img);
  const hi = (120 - 7.5) / 92.5;
  const lo = (-20 - 7.5) / 92.5;
  SATURATED.forEach((before, p) => {
    const after = pxAt(img, p);
    const a = yiq(before);
    const b = yiq(after);
    const c0 = Math.hypot(a.i, a.q);
    const c1 = Math.hypot(b.i, b.q);
    assert.ok(a.y + c0 > hi || a.y - c0 < lo, `fixture ${p} must need correction`);
    assert.ok(c1 < c0, `chroma reduced at ${p}`);
    // One 8-bit rounding step on each channel moves Y by at most 0.5 / 255.
    assert.ok(Math.abs(b.y - a.y) <= 0.6 / 255 + 0.0003, `luma kept at ${p}`);
    assert.ok(Math.abs(Math.atan2(b.q, b.i) - Math.atan2(a.q, a.i)) < 0.02, `hue kept at ${p}`);
    assert.ok(b.y + c1 <= hi + 0.01 && b.y - c1 >= lo - 0.01, `in gamut at ${p}`);
    assert.equal(after[3], before[3], `alpha kept at ${p}`);
  });
});

test('alpha-0 pixels are processed like any other', () => {
  const img = image([[255, 255, 0, 0]], 1, 1);
  applyNtscColors(img);
  assert.deepEqual(pxAt(img, 0), [247, 247, 59, 0]);
});

test('mask limits writes', () => {
  const img = image(SATURATED);
  const full = image(SATURATED);
  applyNtscColors(full);
  const mask = new Uint8Array([1, 0, 1, 0, 0, 1]);
  applyNtscColors(img, mask);
  for (let p = 0; p < W * H; p++) {
    assert.deepEqual(pxAt(img, p), mask[p] ? pxAt(full, p) : SATURATED[p], `pixel ${p}`);
  }
});
