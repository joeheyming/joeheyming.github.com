import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADJUSTMENTS,
  BLACK_WHITE_DEFAULTS,
  applyBlackWhite,
  blackWhiteGray
} from '../paint/adjustments.js';
import {
  ADJUSTMENT_LAYER_IDS,
  applyAdjustmentLayer,
  defaultAdjustmentParams
} from '../paint/adjustment-layers.js';

function img(pixels) {
  return { width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) };
}

const defaults = () => defaultAdjustmentParams('blackWhite');

test('Black & White is registered with PhotoCraft defaults and no tint', () => {
  const def = ADJUSTMENTS.blackWhite;
  assert.equal(def.label, 'Black & White');
  const params = defaults();
  assert.deepEqual(
    [params.reds, params.yellows, params.greens, params.cyans, params.blues, params.magentas],
    [40, 60, 40, 60, 20, 80]
  );
  assert.equal(params.tint, false);
  assert.equal(params.tintColor, '#e1d3b3');
  assert.equal(
    ADJUSTMENT_LAYER_IDS.indexOf('blackWhite'),
    ADJUSTMENT_LAYER_IDS.indexOf('colorBalance') + 1
  );
});

test('blackWhiteGray matches PhotoCraft black_white_weights', () => {
  const d = BLACK_WHITE_DEFAULTS;
  assert.ok(Math.abs(blackWhiteGray([0.5, 0.5, 0.5], d) - 0.5) < 1e-6);
  assert.ok(Math.abs(blackWhiteGray([1, 0, 0], d) - 0.4) < 1e-6);
  assert.ok(Math.abs(blackWhiteGray([1, 1, 0], d) - 0.6) < 1e-6);
  const w = [100, ...d.slice(1)];
  assert.ok(blackWhiteGray([1, 0, 0], w) > blackWhiteGray([1, 0, 0], d));
});

test('greys stay grey and pure colours take their default weights', () => {
  const a = img([
    [0, 0, 0, 255],
    [128, 128, 128, 255],
    [255, 255, 255, 255],
    [255, 0, 0, 255],
    [255, 255, 0, 255],
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [0, 255, 255, 255],
    [255, 0, 255, 255]
  ]);
  applyBlackWhite(a, defaults(), null);
  // Red 40 %, yellow 60 %, blue 20 %, green 40 %, cyan 60 %, magenta 80 %.
  const grays = [0, 128, 255, 102, 153, 51, 102, 153, 204];
  assert.deepEqual(
    [...a.data],
    grays.flatMap((g) => [g, g, g, 255])
  );
});

test('raising Reds brightens a red pixel and leaves a blue one', () => {
  const a = img([
    [255, 0, 0, 255],
    [0, 0, 255, 255]
  ]);
  applyBlackWhite(a, { ...defaults(), reds: 100 }, null);
  assert.deepEqual([...a.data], [255, 255, 255, 255, 51, 51, 51, 255]);
});

test('the tint matches PhotoCraft black_white_tint_matches_photoshop and keeps luminosity', () => {
  const measured = [
    ['#ff0000', 24, [81, 1, 1]],
    ['#ff0000', 120, [255, 64, 64]],
    ['#ff0000', 240, [255, 235, 235]],
    ['#e1d3b3', 120, [133, 119, 87]],
    ['#e1d3b3', 24, [33, 24, 1]],
    ['#402010', 120, [144, 112, 96]]
  ];
  for (const [tintColor, grey, want] of measured) {
    const a = img([[grey, grey, grey, 255]]);
    applyBlackWhite(a, { ...defaults(), tint: true, tintColor }, null);
    for (let c = 0; c < 3; c++) {
      assert.ok(
        Math.abs(a.data[c] - want[c]) <= 2.5,
        `${tintColor} ${grey} ch${c}: ${a.data[c]} vs ${want[c]}`
      );
    }
    const lum = 0.3 * a.data[0] + 0.59 * a.data[1] + 0.11 * a.data[2];
    assert.ok(Math.abs(lum - grey) <= 1, `${tintColor} ${grey} lum ${lum}`);
  }
});

test('alpha is untouched, alpha-0 pixels and unselected pixels are skipped', () => {
  const a = img([
    [255, 0, 0, 77],
    [255, 0, 0, 0],
    [255, 0, 0, 255]
  ]);
  applyBlackWhite(a, defaults(), Uint8Array.from([1, 1, 0]));
  assert.deepEqual([...a.data], [102, 102, 102, 77, 255, 0, 0, 0, 255, 0, 0, 255]);
});

test('a Black & White adjustment layer at opacity 0.5 mixes halfway', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255]);
  const layer = {
    kind: 'adjustment',
    adjustmentId: 'blackWhite',
    params: defaults(),
    opacity: 0.5,
    visible: true,
    mask: null
  };
  applyAdjustmentLayer(data, layer, 1, 1);
  // Full strength is (102, 102, 102).
  assert.deepEqual([...data], [Math.round((255 + 102) / 2), 51, 51, 255]);
});
