import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJUSTMENTS, applyGradientMap, bayer4, gradientMapColor } from '../paint/adjustments.js';
import {
  ADJUSTMENT_LAYER_IDS,
  applyAdjustmentLayer,
  defaultAdjustmentParams
} from '../paint/adjustment-layers.js';

function img(pixels, width = pixels.length) {
  return {
    width,
    height: pixels.length / width,
    data: new Uint8ClampedArray(pixels.flat())
  };
}

const defaults = () => defaultAdjustmentParams('gradientMap');
const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;

test('Gradient Map is registered with a stops array and checkbox params', () => {
  assert.equal(ADJUSTMENTS.gradientMap.label, 'Gradient Map');
  assert.deepEqual(defaults(), {
    stops: [
      [0, '#000000'],
      [1, '#ffffff']
    ],
    reverse: false,
    dither: false
  });
  const i = ADJUSTMENT_LAYER_IDS.indexOf('gradientMap');
  assert.equal(ADJUSTMENT_LAYER_IDS[i - 1], 'colorLookup');
});

test('gradientMapColor ports PhotoCraft gradient()', () => {
  assert.deepEqual(gradientMapColor([], 0.25), [0.25, 0.25, 0.25]);
  assert.deepEqual(gradientMapColor([[0.5, [1, 0, 0]]], 0.9), [1, 0, 0]);
  const stops = [
    [0.2, [0, 0, 0]],
    [0.6, [1, 0.5, 0]],
    [1, [1, 1, 1]]
  ];
  assert.deepEqual(gradientMapColor(stops, 0.1), [0, 0, 0]);
  const near = (a, b) => b.forEach((v, i) => assert.ok(Math.abs(a[i] - v) < 1e-9, `${a} vs ${b}`));
  near(gradientMapColor(stops, 0.4), [0.5, 0.25, 0]);
  near(gradientMapColor(stops, 0.8), [1, 0.75, 0.5]);
  assert.deepEqual(
    gradientMapColor(
      [
        [0.5, [0, 0, 0]],
        [0.5, [1, 1, 1]]
      ],
      0.5
    ),
    [0, 0, 0]
  );
});

test('default black-to-white maps a color to its W3C luminosity grey', () => {
  const colors = [
    [0, 255, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [51, 153, 230, 255],
    [200, 120, 40, 255]
  ];
  const im = img(colors);
  applyGradientMap(im, defaults(), null);
  colors.forEach((c, p) => {
    const want = lum(c);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(im.data[p * 4 + k] - want) <= 1, `${c}: ${im.data[p * 4 + k]} vs ${want}`);
    }
    assert.equal(im.data[p * 4 + 3], 255);
  });
});

test('reverse inverts the map', () => {
  const c = [200, 120, 40, 255];
  const im = img([c]);
  applyGradientMap(im, { ...defaults(), reverse: true }, null);
  const want = 255 - lum(c);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(im.data[k] - want) <= 1);
});

test('a red-to-blue map on mid grey gives the halfway color', () => {
  const im = img([[128, 128, 128, 255]]);
  applyGradientMap(
    im,
    {
      ...defaults(),
      stops: [
        [0, '#ff0000'],
        [1, '#0000ff']
      ]
    },
    null
  );
  const t = 128 / 255;
  assert.deepEqual(Array.from(im.data), [Math.round(255 * (1 - t)), 0, Math.round(255 * t), 255]);
});

test('dither changes a flat area by at most 1 level following bayer4', () => {
  const W = 8;
  const H = 8;
  // W3C lum 100.59 sits between levels, so the ±0.5-level Bayer offset rounds both ways.
  const px = Array.from({ length: W * H }, () => [100, 101, 100, 255]);
  const plain = img(px, W);
  const dith = img(px, W);
  applyGradientMap(plain, defaults(), null);
  applyGradientMap(dith, { ...defaults(), dither: true }, null);
  const t = lum([100, 101, 100]) / 255;
  let changed = 0;
  for (let p = 0; p < W * H; p++) {
    const x = p % W;
    const y = Math.floor(p / W);
    const want = Math.round(Math.min(1, Math.max(0, t + bayer4(x, y) / 255)) * 255);
    for (let k = 0; k < 3; k++) {
      const v = dith.data[p * 4 + k];
      assert.equal(v, want);
      assert.ok(Math.abs(v - plain.data[p * 4 + k]) <= 1);
      if (v !== plain.data[p * 4 + k]) changed++;
    }
  }
  assert.ok(changed > 0);
});

test('a mask skips unselected pixels and alpha-0 pixels are left alone', () => {
  const im = img([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
    [255, 0, 0, 0]
  ]);
  applyGradientMap(im, defaults(), new Uint8Array([1, 0, 1]));
  assert.deepEqual(Array.from(im.data.slice(0, 4)), [77, 77, 77, 255]);
  assert.deepEqual(Array.from(im.data.slice(4)), [255, 0, 0, 255, 255, 0, 0, 0]);
});

test('a Gradient Map adjustment layer at opacity 0.5 mixes halfway', () => {
  const params = { startColor: '#ff0000', endColor: '#0000ff', reverse: false, dither: false };
  const src = [200, 120, 40, 255];
  const full = img([src]);
  applyGradientMap(full, params, null);
  const data = new Uint8ClampedArray(src);
  const layer = {
    kind: 'adjustment',
    adjustmentId: 'gradientMap',
    params,
    opacity: 0.5,
    visible: true,
    mask: null
  };
  applyAdjustmentLayer(data, layer, 1, 1);
  for (let c = 0; c < 3; c++) {
    const want = (src[c] + full.data[c]) / 2;
    assert.ok(Math.abs(data[c] - want) <= 1, `ch${c}: ${data[c]} vs ${want}`);
  }
  assert.equal(data[3], 255);
});
