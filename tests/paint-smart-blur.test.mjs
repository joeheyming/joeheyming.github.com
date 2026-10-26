import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS } from '../paint/commands.js';
import { applySmartBlur, smartBlurOffsets, ADJUSTMENTS } from '../paint/adjustments.js';

function flat(w, h, fill = [100, 150, 200, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set(fill, p * 4);
  return { width: w, height: h, data };
}

const px = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

// The 5x5 image the Python reference uses: R = 20x, G = 10y + 100, B = 50,
// with (2, 1) at alpha 128 and (3, 2) an outlier at R = 200.
function gradient() {
  const img = flat(5, 5);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) img.data.set([20 * x, 10 * y + 100, 50, 255], (y * 5 + x) * 4);
  }
  img.data[(1 * 5 + 2) * 4 + 3] = 128;
  img.data[(2 * 5 + 3) * 4] = 200;
  return img;
}

// Left half black, right half white.
function twoTone(w = 8, h = 4) {
  const img = flat(w, h, [0, 0, 0, 255]);
  for (let y = 0; y < h; y++) {
    for (let x = w / 2; x < w; x++) img.data.set([255, 255, 255, 200], (y * w + x) * 4);
  }
  return img;
}

test('Smart Blur is registered, dispatches, and sits after Shape Blur in Filter › Blur', () => {
  const def = ADJUSTMENTS.smartBlur;
  assert.equal(def.label, 'Smart Blur');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.min, f.max, f.default]),
    [
      ['radius', 0.1, 100, 3],
      ['threshold', 0.1, 100, 25],
      ['quality', 0, 2, 2],
      ['mode', 0, 2, 0]
    ]
  );
  const a = gradient();
  const b = gradient();
  def.apply(a, { radius: 1, threshold: 25, quality: 2, mode: 0 }, null);
  applySmartBlur(b, { radius: 1, threshold: 25, quality: 2, mode: 0 });
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, gradient().data);
  // Filter › Blur follows PhotoCraft's catalog: Shape Blur, Smart Blur, Surface Blur.
  const blur = COMMANDS.filter((c) => c.menu.join(' > ') === 'Filter > Blur').map((c) => c.id);
  assert.equal(blur[blur.indexOf('filter.blur.shapeBlur') + 1], 'filter.blur.smartBlur');
});

test('a flat image is unchanged in Normal mode', () => {
  const img = flat(12, 9, [100, 150, 200, 128]);
  applySmartBlur(img, { radius: 5 });
  assert.deepEqual(img.data, flat(12, 9, [100, 150, 200, 128]).data);
});

test('edges above the threshold survive while noise below it is smoothed', () => {
  const img = flat(20, 10, [40, 40, 40, 255]);
  for (let y = 0; y < 10; y++) {
    for (let x = 10; x < 20; x++) img.data.set([220, 220, 220, 255], (y * 20 + x) * 4);
  }
  // Low-contrast noise on the dark side.
  img.data.set([60, 60, 60, 255], (5 * 20 + 4) * 4);
  applySmartBlur(img, { radius: 3, threshold: 25 });
  assert.deepEqual(px(img, 9, 5), [40, 40, 40, 255]);
  assert.deepEqual(px(img, 10, 5), [220, 220, 220, 255]);
  // (60 + 28 * 40) / 29 = 40.69.
  assert.deepEqual(px(img, 4, 5), [41, 41, 41, 255]);
});

test('Normal pixels match an independent double-precision reference', () => {
  const img = gradient();
  applySmartBlur(img, { radius: 1, threshold: 25, quality: 2, mode: 0 });
  // Centre: the outlier is rejected; colour is alpha-weighted, alpha averaged.
  assert.deepEqual(px(img, 2, 2), [34, 121, 50, 223]);
  // Corners repeat the edge: (0, 0) and (4, 4) count themselves three times.
  assert.deepEqual(px(img, 0, 0), [4, 102, 50, 255]);
  assert.deepEqual(px(img, 4, 4), [76, 138, 50, 255]);
});

test('stride and offset count for each quality at radius 100', () => {
  const expected = [
    [25, 49],
    [15, 138],
    [9, 385]
  ];
  expected.forEach(([stride, count], quality) => {
    const o = smartBlurOffsets(100, quality);
    assert.equal(o.ri, 100);
    assert.equal(o.stride, stride);
    assert.equal(o.offsets.length, count);
  });
  const small = smartBlurOffsets(3, 2);
  assert.equal(small.stride, 1);
  assert.equal(small.offsets.length, 29);
  assert.deepEqual(smartBlurOffsets(0.4, 2).offsets, [[0, 0]]);
  assert.equal(smartBlurOffsets(1, 2).offsets.length, 5);
});

test('Edge Only and Overlay Edge on a two-tone image', () => {
  const edges = twoTone();
  applySmartBlur(edges, { mode: 1 });
  for (let y = 0; y < 4; y++) {
    assert.deepEqual(px(edges, 2, y), [0, 0, 0, 255]);
    assert.deepEqual(px(edges, 3, y), [255, 255, 255, 255]);
    assert.deepEqual(px(edges, 4, y), [255, 255, 255, 200]);
    assert.deepEqual(px(edges, 6, y), [0, 0, 0, 200]);
  }
  const over = twoTone();
  over.data.set([30, 60, 90, 255], 0);
  applySmartBlur(over, { mode: 2, threshold: 100 });
  assert.deepEqual(px(over, 0, 0), [30, 60, 90, 255]);
  // 90 levels is under the threshold, so (1, 0) is not an edge.
  assert.deepEqual(px(over, 1, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(over, 2, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(over, 3, 1), [255, 255, 255, 255]);
  assert.deepEqual(px(over, 6, 1), [255, 255, 255, 200]);
});

test('alpha weights colour, alpha is averaged, and transparent pixels hold no colour', () => {
  const img = flat(3, 1, [100, 100, 100, 255]);
  img.data.set([110, 110, 110, 0], 4);
  applySmartBlur(img, { radius: 1 });
  // The transparent middle averages to alpha 102 with colour from opaque neighbours only.
  assert.deepEqual(px(img, 1, 0), [100, 100, 100, 102]);
  // (0, 0) sees itself four times and the clear pixel once: alpha 204.
  assert.deepEqual(px(img, 0, 0), [100, 100, 100, 204]);
  const clear = flat(4, 4, [10, 20, 30, 0]);
  applySmartBlur(clear, { radius: 2 });
  assert.deepEqual(px(clear, 1, 1), [0, 0, 0, 0]);
});

test('parameters clamp and round as the engine does', () => {
  const same = (a, b) => {
    const x = gradient();
    const y = gradient();
    applySmartBlur(x, a);
    applySmartBlur(y, b);
    assert.deepEqual(x.data, y.data, JSON.stringify([a, b]));
  };
  same({ radius: 500, quality: 0 }, { radius: 100, quality: 0 });
  same({ radius: -4 }, { radius: 0.1 });
  same({ threshold: 0 }, { threshold: 0.1 });
  same({ threshold: 1e6 }, { threshold: 100 });
  same({ quality: 9 }, { quality: 2 });
  same({ quality: 0.6 }, { quality: 1 });
  same({ mode: 7 }, { mode: 2 });
  same({ mode: 'x', radius: 'y' }, {});
  same({}, { radius: 3, threshold: 25, quality: 2, mode: 0 });
  assert.equal(smartBlurOffsets(1e9, 2).ri, 100);
});

test('the mask limits writes and reads still see unmasked pixels', () => {
  const img = gradient();
  const mask = new Uint8Array(25);
  mask[2 * 5 + 2] = 1;
  applySmartBlur(img, { radius: 1 }, mask);
  const before = gradient();
  for (let p = 0; p < 25; p++) {
    const x = p % 5;
    const y = Math.floor(p / 5);
    if (p === 12) assert.deepEqual(px(img, x, y), [34, 121, 50, 223]);
    else assert.deepEqual(px(img, x, y), px(before, x, y));
  }
});
