import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS_BY_ID } from '../paint/commands.js';
import { CATALOG } from '../paint/menu-catalog.js';
import {
  colorRangeCoverage,
  colorRangeMask,
  pickSample,
  softToSelection,
  toneRangeMask
} from '../paint/color-range.js';
import { IDENTITY_TRANSFORM, transformSelectionMask } from '../paint/transform.js';
import { maskBBox } from '../paint/selection.js';

function pixels(colors) {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((c, i) => data.set(c.length === 4 ? c : [...c, 255], i * 4));
  return { width: colors.length, height: 1, data };
}

const gray = (v) => [v, v, v];

test('Color Range coverage falls off linearly with the largest channel distance', () => {
  // Red, a darker red 25 levels off, a red 41 levels off, blue, and a transparent red.
  const img = pixels([[255, 0, 0], [230, 0, 0], [214, 0, 0], [0, 0, 255], [255, 0, 0, 0]]);
  const m = colorRangeMask(img, [{ color: [255, 0, 0] }], 40);
  assert.ok(m instanceof Uint8Array);
  assert.equal(m[0], 255);
  // 1 − 25 / 41 of full coverage.
  assert.equal(m[1], Math.round((1 - 25 / 41) * 255));
  assert.equal(m[2], 0);
  assert.equal(m[3], 0);
  assert.equal(m[4], 0, 'transparent pixels are never selected');
  // More fuzziness reaches further out; zero fuzziness keeps only the exact color.
  const wide = colorRangeMask(img, [{ color: [255, 0, 0] }], 200);
  assert.ok(wide[1] > m[1] && wide[2] > 0);
  const tight = colorRangeMask(img, [{ color: [255, 0, 0] }], 0);
  assert.deepEqual([...tight], [255, 0, 0, 0, 0]);
});

test('Add to Sample keeps the best match; Subtract from Sample caps it in click order', () => {
  const img = pixels([[255, 0, 0], [0, 0, 255], [0, 255, 0]]);
  let samples = pickSample([], [255, 0, 0], 'sample');
  samples = pickSample(samples, [0, 0, 255], 'add');
  assert.deepEqual([...colorRangeMask(img, samples, 10)], [255, 255, 0]);
  samples = pickSample(samples, [0, 0, 255], 'subtract');
  assert.deepEqual([...colorRangeMask(img, samples, 10)], [255, 0, 0]);
  // The plain eyedropper starts over.
  assert.deepEqual(pickSample(samples, [0, 255, 0], 'sample'), [{ color: [0, 255, 0] }]);
});

test('Highlights / Midtones / Shadows select by luminance with a Fuzziness ramp', () => {
  const img = pixels([0, 60, 75, 128, 200, 255].map(gray));
  // Shadows up to 65 fading over 20 levels (PhotoCraft tonal_ranges).
  assert.deepEqual([...toneRangeMask(img, 0, 65, 20)], [255, 255, 128, 0, 0, 0]);
  // Through the command: Tone Fuzziness is a percent of 255.
  const hi = colorRangeCoverage(img, { select: 'highlights', toneFuzziness: (20 / 255) * 100 });
  assert.deepEqual([...hi], [0, 0, 0, 0, 255, 255]);
  const mid = colorRangeCoverage(img, { select: 'midtones', toneFuzziness: (20 / 255) * 100 });
  assert.deepEqual([...mid], [0, 0, 0, 255, 0, 0]);
  const inv = colorRangeCoverage(img, {
    select: 'midtones',
    toneFuzziness: (20 / 255) * 100,
    invert: true
  });
  assert.deepEqual([...inv], [255, 255, 255, 0, 255, 255]);
});

test('The soft coverage becomes a 0/1 selection at half coverage', () => {
  assert.deepEqual([...softToSelection(Uint8Array.from([0, 127, 128, 255]))], [0, 0, 1, 1]);
});

function block(W, H, x0, y0, x1, y1) {
  const mask = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  return mask;
}

test('Transform Selection scales the mask bbox 2x about its centre', () => {
  const W = 16,
    H = 16;
  const mask = block(W, H, 4, 4, 8, 8);
  const box = maskBBox(mask, W, H);
  const out = transformSelectionMask(mask, W, H, {
    box,
    t: { ...IDENTITY_TRANSFORM, sx: 2, sy: 2 }
  });
  assert.deepEqual(maskBBox(out, W, H), { x: 2, y: 2, w: 8, h: 8 });
  assert.equal(out.reduce((a, v) => a + v, 0), 64);
});

test('Transform Selection moves and rotates the mask, not pixels', () => {
  const W = 16,
    H = 16;
  const mask = block(W, H, 2, 4, 10, 6);
  const box = maskBBox(mask, W, H);
  const moved = transformSelectionMask(mask, W, H, {
    box,
    t: { ...IDENTITY_TRANSFORM, tx: 3, ty: 5 }
  });
  assert.deepEqual(maskBBox(moved, W, H), { x: 5, y: 9, w: 8, h: 2 });
  const turned = transformSelectionMask(mask, W, H, {
    box,
    t: { ...IDENTITY_TRANSFORM, angle: Math.PI / 2 }
  });
  assert.deepEqual(maskBBox(turned, W, H), { x: 5, y: 1, w: 2, h: 8 });
  // A quad box (Distort / Perspective) lands the mask on the quad.
  const quad = transformSelectionMask(mask, W, H, {
    box,
    t: IDENTITY_TRANSFORM,
    quad: [
      [0, 0],
      [16, 0],
      [16, 4],
      [0, 4]
    ]
  });
  assert.deepEqual(maskBBox(quad, W, H), { x: 0, y: 0, w: 16, h: 4 });
});

test('Color Range… and Transform Selection are Select menu commands', () => {
  const range = COMMANDS_BY_ID.get('select.colorRange');
  const ts = COMMANDS_BY_ID.get('select.transformSelection');
  assert.equal(range.label, 'Color Range…');
  assert.deepEqual(range.menu, ['Select']);
  assert.equal(ts.label, 'Transform Selection');
  assert.ok(CATALOG.some((r) => r[3] === 'select.transformSelection'));
  const layers = [{ kind: 'pixel' }];
  const none = { layers, activeLayerIdx: 0, sel: { mode: 'none' } };
  const sel = { layers, activeLayerIdx: 0, sel: { mode: 'active', x: 0, y: 0, w: 2, h: 2 } };
  assert.equal(ts.enabled(none), false);
  assert.equal(ts.enabled(sel), true);
  assert.equal(ts.enabled({ ...sel, freeTransform: {} }), false);
  assert.equal(range.enabled(none), true);
  const calls = [];
  const ctx = { colorRange: () => calls.push('range'), transformSelection: () => calls.push('ts') };
  range.run(ctx);
  ts.run(ctx);
  assert.deepEqual(calls, ['range', 'ts']);
});
