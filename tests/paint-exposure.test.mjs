import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJUSTMENTS, applyExposure } from '../paint/adjustments.js';
import {
  ADJUSTMENT_LAYER_IDS,
  applyAdjustmentLayer,
  defaultAdjustmentParams
} from '../paint/adjustment-layers.js';

function img(pixels) {
  return { width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) };
}

test('identity exposure params leave pixels unchanged', () => {
  const src = [
    [0, 0, 0, 255],
    [1, 76, 128, 255],
    [200, 254, 255, 128]
  ];
  const a = img(src);
  applyExposure(a, { exposure: 0, offset: 0, gamma: 1 });
  assert.deepEqual([...a.data], src.flat());
  const b = img(src);
  ADJUSTMENTS.exposure.apply(b, defaultAdjustmentParams('exposure'), null);
  assert.deepEqual([...b.data], src.flat());
});

test('+1 stop doubles the 2.2-linear value and clamps at 255', () => {
  const a = img([
    [128, 128, 128, 255],
    [200, 0, 255, 77]
  ]);
  applyExposure(a, { exposure: 1, offset: 0, gamma: 1 });
  const lin = Math.pow(128 / 255, 2.2) * 2;
  const mid = Math.round(Math.pow(lin, 1 / 2.2) * 255);
  assert.equal(mid, 175);
  assert.deepEqual([...a.data], [mid, mid, mid, 255, 255, 0, 255, 77]);
});

test('offset and gamma match the PhotoCraft values', () => {
  // psd-tools adjustment_nested_composition_4, cited in adjust.rs: offset 0.1738 lifts 76 to 134.
  const a = img([[76, 76, 76, 255]]);
  applyExposure(a, { exposure: 0, offset: 0.1738, gamma: 1 });
  assert.deepEqual([...a.data], [134, 134, 134, 255]);
  // Gamma 2: ((128 / 255)^2.2)^(1 / 2) re-encoded through 1 / 2.2 is 128 / 255 to the 1/2.
  const b = img([[128, 64, 0, 255]]);
  applyExposure(b, { exposure: 0, offset: 0, gamma: 2 });
  assert.deepEqual([...b.data], [181, 128, 0, 255]);
  // A negative offset clamps linear light at 0.
  const c = img([[10, 76, 255, 255]]);
  applyExposure(c, { exposure: 0, offset: -0.5, gamma: 1 });
  assert.deepEqual([...c.data], [0, 0, 186, 255]);
});

test('a mask skips unselected pixels and transparent pixels are untouched', () => {
  const a = img([
    [128, 128, 128, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 0]
  ]);
  applyExposure(a, { exposure: 1, offset: 0, gamma: 1 }, new Uint8Array([0, 1, 1]));
  assert.deepEqual([...a.data], [128, 128, 128, 255, 175, 175, 175, 255, 128, 128, 128, 0]);
});

test('exposure and vibrance are adjustment layer kinds with identity defaults', () => {
  assert.ok(ADJUSTMENT_LAYER_IDS.includes('exposure'));
  assert.ok(ADJUSTMENT_LAYER_IDS.includes('vibrance'));
  assert.deepEqual(defaultAdjustmentParams('exposure'), { exposure: 0, offset: 0, gamma: 1 });
  assert.deepEqual(defaultAdjustmentParams('vibrance'), { amount: 0 });
  const src = [
    [200, 40, 90, 255],
    [10, 220, 140, 255]
  ];
  for (const id of ['exposure', 'vibrance']) {
    const data = img(src).data;
    const layer = { kind: 'adjustment', adjustmentId: id, params: defaultAdjustmentParams(id) };
    applyAdjustmentLayer(data, { ...layer, visible: true, opacity: 1, mask: null }, 2, 1);
    assert.deepEqual([...data], src.flat(), id);
  }
});

test('an exposure adjustment layer at opacity 0.5 mixes halfway', () => {
  const data = new Uint8ClampedArray([128, 64, 0, 255]);
  const layer = {
    kind: 'adjustment',
    adjustmentId: 'exposure',
    params: { exposure: 1, offset: 0, gamma: 1 },
    visible: true,
    opacity: 0.5,
    mask: null
  };
  const full = img([[128, 64, 0, 255]]);
  applyExposure(full, layer.params);
  applyAdjustmentLayer(data, layer, 1, 1);
  const half = (a, b) => Math.round(a + (b - a) * 0.5);
  assert.deepEqual([...data], [half(128, full.data[0]), half(64, full.data[1]), 0, 255]);
  assert.deepEqual([...data], [152, 76, 0, 255]);
});

test('the Layer menu lists the Exposure and Vibrance adjustment layers', async () => {
  const { COMMANDS } = await import('../paint/commands.js');
  const ids = COMMANDS.map((c) => c.attrs['data-layer']);
  assert.ok(ids.includes('adjust-exposure'));
  assert.ok(ids.includes('adjust-vibrance'));
});
