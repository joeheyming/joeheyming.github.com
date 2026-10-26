import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJUSTMENTS, applyPhotoFilter } from '../paint/adjustments.js';
import {
  ADJUSTMENT_LAYER_IDS,
  applyAdjustmentLayer,
  defaultAdjustmentParams
} from '../paint/adjustment-layers.js';

function img(pixels) {
  return { width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) };
}

const defaults = () => defaultAdjustmentParams('photoFilter');

test('Photo Filter is registered with PhotoCraft defaults', () => {
  assert.equal(ADJUSTMENTS.photoFilter.label, 'Photo Filter');
  assert.deepEqual(defaults(), { color: '#ec8a00', density: 25, preserveLuminosity: true });
  const density = ADJUSTMENTS.photoFilter.fields.find((f) => f.key === 'density');
  assert.deepEqual([density.min, density.max], [0, 100]);
  assert.equal(
    ADJUSTMENT_LAYER_IDS.indexOf('photoFilter'),
    ADJUSTMENT_LAYER_IDS.indexOf('blackWhite') + 1
  );
});

test('density 0 is identity', () => {
  const pixels = [];
  for (let v = 0; v < 256; v += 5) pixels.push([v, (v * 7) % 256, 255 - v, 255]);
  for (const preserveLuminosity of [true, false]) {
    const a = img(pixels);
    applyPhotoFilter(a, { ...defaults(), density: 0, preserveLuminosity }, null);
    assert.deepEqual([...a.data], pixels.flat());
  }
});

test('Warming Filter (85) at 40 % matches PhotoCraft photo_filter_matches_photoshop', () => {
  const measured = [
    [
      [255, 0, 0],
      [239, 7, 7]
    ],
    [
      [0, 255, 0],
      [69, 220, 0]
    ],
    [
      [0, 0, 255],
      [46, 0, 130]
    ],
    [
      [255, 255, 0],
      [255, 240, 80]
    ],
    [
      [128, 128, 128],
      [140, 124, 116]
    ],
    [
      [242, 242, 242],
      [255, 238, 229]
    ],
    [
      [255, 255, 255],
      [255, 255, 255]
    ],
    [
      [0, 0, 0],
      [0, 0, 0]
    ]
  ];
  const params = { color: '#ec8a00', density: 40, preserveLuminosity: true };
  for (const [src, want] of measured) {
    const a = img([[...src, 255]]);
    applyPhotoFilter(a, params, null);
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(a.data[c] - want[c]) <= 1.5, `${src} ch${c}: ${a.data[c]} vs ${want[c]}`);
    }
  }
});

test('Preserve Luminosity keeps the W3C luminosity of a mid grey within a level', () => {
  const lum = (d) => 0.3 * d[0] + 0.59 * d[1] + 0.11 * d[2];
  const on = img([[128, 128, 128, 255]]);
  applyPhotoFilter(on, { ...defaults(), density: 100 }, null);
  assert.ok(Math.abs(lum(on.data) - 128) <= 1, `lum ${lum(on.data)}`);
  assert.ok(on.data[0] > on.data[2], 'warming tints the grey');
  const off = img([[128, 128, 128, 255]]);
  applyPhotoFilter(off, { ...defaults(), density: 100, preserveLuminosity: false }, null);
  assert.ok(lum(off.data) < 127, `unpreserved lum ${lum(off.data)}`);
});

test('alpha is untouched, alpha-0 pixels and unselected pixels are skipped', () => {
  const a = img([
    [0, 0, 255, 77],
    [0, 0, 255, 0],
    [0, 0, 255, 255]
  ]);
  applyPhotoFilter(a, { ...defaults(), density: 40 }, Uint8Array.from([1, 1, 0]));
  assert.equal(a.data[3], 77);
  assert.ok(a.data[0] > 30, 'selected pixel gains red');
  assert.deepEqual([...a.data.slice(4)], [0, 0, 255, 0, 0, 0, 255, 255]);
});

test('a Photo Filter adjustment layer at opacity 0.5 mixes halfway', () => {
  const params = { ...defaults(), density: 40 };
  const full = img([[0, 0, 255, 255]]);
  applyPhotoFilter(full, params, null);
  const data = new Uint8ClampedArray([0, 0, 255, 255]);
  const layer = {
    kind: 'adjustment',
    adjustmentId: 'photoFilter',
    params,
    opacity: 0.5,
    visible: true,
    mask: null
  };
  applyAdjustmentLayer(data, layer, 1, 1);
  for (let c = 0; c < 3; c++) {
    const want = (full.data[c] + [0, 0, 255][c]) / 2;
    assert.ok(Math.abs(data[c] - want) <= 1, `ch${c}: ${data[c]} vs ${want}`);
  }
  assert.equal(data[3], 255);
});
