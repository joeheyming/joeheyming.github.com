import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS } from '../paint/commands.js';
import {
  applyShapeBlur,
  shapeBlurSpans,
  SHAPE_BLUR_INSIDE,
  ADJUSTMENTS
} from '../paint/adjustments.js';

function flat(w, h, fill = [100, 150, 200, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set(fill, p * 4);
  return { width: w, height: h, data };
}

const px = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

// The 9x7 image the Python reference uses: R = 25x, G = 30y, B = 100, and
// A = 128 where (x + y) % 3 == 0, else 255.
function pattern() {
  const img = flat(9, 7);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 9; x++) {
      img.data.set([25 * x, 30 * y, 100, (x + y) % 3 === 0 ? 128 : 255], (y * 9 + x) * 4);
    }
  }
  return img;
}

test('Shape Blur is registered, dispatches, and sits after Radial Blur in Filter › Blur', () => {
  const def = ADJUSTMENTS.shapeBlur;
  assert.equal(def.label, 'Shape Blur');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.min, f.max, f.default]),
    [
      ['radius', 5, 1000, 10],
      ['shape', 0, 8, 0]
    ]
  );
  const a = pattern();
  const b = pattern();
  def.apply(a, { radius: 5, shape: 6 }, null);
  applyShapeBlur(b, { radius: 5, shape: 6 });
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, pattern().data);
  // Filter › Blur follows PhotoCraft's catalog: Radial Blur, Shape Blur, Smart Blur.
  const blur = COMMANDS.filter((c) => c.menu.join(' > ') === 'Filter > Blur').map((c) => c.id);
  assert.equal(blur[blur.indexOf('filter.blur.radialBlur') + 1], 'filter.blur.shapeBlur');
});

test('span rows and pixel counts per shape at radius 8 match an independent reference', () => {
  // [pixels, runs] from a Python double-precision point count. Hexagon is one
  // more than the double reference: at (-8, 0), f32 atan2(0, -1) rounds up to
  // pi, which wraps into the next hexagon segment, so the tie lands inside.
  const expected = [
    [197, 17],
    [128, 26],
    [289, 17],
    [145, 17],
    [123, 15],
    [161, 13],
    [81, 17],
    [167, 17],
    [145, 17]
  ];
  SHAPE_BLUR_INSIDE.forEach((inside, shape) => {
    const { rows, count } = shapeBlurSpans(8, inside);
    assert.deepEqual([count, rows.length], expected[shape], `shape ${shape}`);
    assert.equal(
      rows.reduce((n, [, a, b]) => n + b - a + 1, 0),
      count
    );
  });
  const hex = shapeBlurSpans(8, SHAPE_BLUR_INSIDE[5]).rows;
  assert.deepEqual(
    hex.find(([dy]) => dy === 0),
    [0, -8, 8]
  );
  // PhotoCraft's own table at radius 3 (shape_blur_tests.rs).
  assert.deepEqual(
    [0, 1, 2, 3, 4, 8].map((s) => shapeBlurSpans(3, SHAPE_BLUR_INSIDE[s]).count),
    [29, 20, 49, 25, 18, 13]
  );
  assert.equal(shapeBlurSpans(2.5, SHAPE_BLUR_INSIDE[2]).count, 49);
});

test('a tiny radius or an empty kernel falls back to the centre pixel', () => {
  assert.deepEqual(shapeBlurSpans(0.49, SHAPE_BLUR_INSIDE[0]), { rows: [[0, 0, 0]], count: 1 });
  assert.deepEqual(
    shapeBlurSpans(5, () => false),
    { rows: [[0, 0, 0]], count: 1 }
  );
  // The ring has a hole: no centre pixel at radius 5.
  assert.ok(!SHAPE_BLUR_INSIDE[1](0, 0));
});

test('a flat image is unchanged for every shape', () => {
  for (let shape = 0; shape <= 8; shape++) {
    const img = flat(12, 9, [100, 150, 200, 128]);
    applyShapeBlur(img, { radius: 7, shape });
    assert.deepEqual(img.data, flat(12, 9, [100, 150, 200, 128]).data, `shape ${shape}`);
  }
});

test('hand-checked pixels match an independent reference with edge repeat', () => {
  // Python double reference: premultiplied mean over the kernel's points with
  // clamped reads, divided by the point count, then unpremultiplied.
  const cases = [
    [0, 4, 3, [101, 90, 100, 214]],
    [0, 0, 0, [30, 36, 100, 191]],
    [6, 4, 3, [99, 89, 100, 214]],
    [6, 8, 6, [186, 159, 100, 222]],
    [7, 2, 1, [59, 36, 100, 202]]
  ];
  for (const [shape, x, y, want] of cases) {
    const img = pattern();
    applyShapeBlur(img, { radius: 5, shape });
    assert.deepEqual(px(img, x, y), want, `shape ${shape} at (${x}, ${y})`);
  }
});

test('averaging is premultiplied next to transparency', () => {
  // Left half transparent red, right half opaque blue, one row.
  const img = flat(30, 1, [255, 0, 0, 0]);
  for (let x = 15; x < 30; x++) img.data.set([0, 0, 255, 255], x * 4);
  applyShapeBlur(img, { radius: 5, shape: 0 });
  // At x = 15 the 46 circle points with dx >= 0 are blue, of 81: the red never bleeds in.
  assert.deepEqual(px(img, 15, 0), [0, 0, 255, Math.round((46 / 81) * 255)]);
  assert.deepEqual(px(img, 14, 0), [0, 0, 255, Math.round((35 / 81) * 255)]);
  // Fully transparent neighbourhood: alpha 0 and colour 0 (alpha > 1e-7 guard).
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 0]);
});

test('parameters clamp and round', () => {
  const run = (params) => {
    const img = pattern();
    applyShapeBlur(img, params);
    return img.data;
  };
  assert.deepEqual(run({ radius: 2, shape: 0 }), run({ radius: 5, shape: 0 }));
  assert.deepEqual(run({ radius: 0, shape: 0 }), run({ radius: 5, shape: 0 }));
  assert.deepEqual(run({ radius: 'x' }), run({ radius: 10, shape: 0 }));
  assert.deepEqual(run({ radius: 5, shape: 6.4 }), run({ radius: 5, shape: 6 }));
  assert.deepEqual(run({ radius: 5, shape: 6.6 }), run({ radius: 5, shape: 7 }));
  assert.deepEqual(run({ radius: 5, shape: -3 }), run({ radius: 5, shape: 0 }));
  assert.deepEqual(run({ radius: 5, shape: 99 }), run({ radius: 5, shape: 8 }));
  assert.notDeepEqual(run({ radius: 5, shape: 6 }), run({ radius: 5, shape: 7 }));
  // Radius 1000 on a small canvas stays fast, and 5000 clamps to it.
  const t = Date.now();
  assert.deepEqual(run({ radius: 5000, shape: 6 }), run({ radius: 1000, shape: 6 }));
  assert.ok(Date.now() - t < 5000);
});

test('the mask limits writes and reads still see unmasked pixels', () => {
  const img = pattern();
  const mask = new Uint8Array(63);
  mask[3 * 9 + 4] = 1;
  applyShapeBlur(img, { radius: 5, shape: 0 }, mask);
  const before = pattern();
  for (let p = 0; p < 63; p++) {
    const x = p % 9;
    const y = Math.floor(p / 9);
    if (p === 3 * 9 + 4) assert.deepEqual(px(img, x, y), [101, 90, 100, 214]);
    else assert.deepEqual(px(img, x, y), px(before, x, y));
  }
});
