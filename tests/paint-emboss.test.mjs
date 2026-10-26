import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEmboss, ADJUSTMENTS } from '../paint/adjustments.js';

function image(W, H, fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set(fn(x, y), (y * W + x) * 4);
  }
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

// Black field with a white stripe at x = 3..4: a rising edge then a falling one.
const stripe = () =>
  image(8, 3, (x) => (x === 3 || x === 4 ? [255, 255, 255, 200] : [0, 0, 0, 90]));

test('emboss is registered with angle, height, and amount fields', () => {
  const def = ADJUSTMENTS.emboss;
  assert.equal(def.label, 'Emboss');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.min, f.max, f.default]),
    [
      ['angle', -180, 180, 135],
      ['height', 1, 10, 3],
      ['amount', 1, 500, 100]
    ]
  );
});

test('a flat image becomes uniform 128 gray with alpha kept', () => {
  const img = image(5, 4, () => [40, 200, 90, 77]);
  applyEmboss(img, 135, 3, 100);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 5; x++) assert.deepEqual(px(img, x, y), [128, 128, 128, 77]);
  }
});

test('a vertical edge lit at angle 0 is brighter on one side and darker on the other', () => {
  const img = stripe();
  // angle 0, h 1: dx = 1, dy = 0, so gray = 128 + 0.4 * (luma(x + 1) - luma(x - 1)).
  applyEmboss(img, 0, 1, 40);
  const g = (x) => px(img, x, 1)[0];
  assert.equal(g(2), 128 + 102); // white ahead, black behind
  assert.equal(g(5), 128 - 102); // black ahead, white behind
  assert.equal(g(3), 128 + 102);
  assert.equal(g(4), 128 - 102);
  assert.equal(g(0), 128);
  assert.equal(g(7), 128);
  assert.ok(g(2) > 128 && g(5) < 128);
  for (let x = 0; x < 8; x++) {
    const [r, gg, b] = px(img, x, 1);
    assert.equal(r, gg);
    assert.equal(gg, b);
  }
});

test('alpha is preserved and samples clamp at the image edge', () => {
  const img = stripe();
  applyEmboss(img, 0, 10, 100);
  for (let x = 0; x < 8; x++) assert.equal(px(img, x, 0)[3], x === 3 || x === 4 ? 200 : 90);
  // h 10 clamps both samples to columns 7 and 0, both black.
  assert.equal(px(img, 3, 0)[0], 128);
});

test('a mask limits the change but masked-out pixels are still read', () => {
  const img = stripe();
  const mask = new Uint8Array(8 * 3);
  mask[1 * 8 + 2] = 1;
  applyEmboss(img, 0, 1, 40, mask);
  assert.deepEqual(px(img, 2, 1), [230, 230, 230, 90]);
  for (let p = 0; p < 24; p++) {
    if (mask[p]) continue;
    const x = p % 8;
    assert.deepEqual(
      px(img, x, (p / 8) | 0),
      x === 3 || x === 4 ? [255, 255, 255, 200] : [0, 0, 0, 90]
    );
  }
});
