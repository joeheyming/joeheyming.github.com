import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJUSTMENTS, applyColorBalance, colorBalanceCurve } from '../paint/adjustments.js';
import {
  ADJUSTMENT_LAYER_IDS,
  applyAdjustmentLayer,
  defaultAdjustmentParams
} from '../paint/adjustment-layers.js';

function img(pixels) {
  return { width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) };
}

const luma = (d, i = 0) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

test('Color Balance is registered with nine range fields and Preserve Luminosity on', () => {
  const def = ADJUSTMENTS.colorBalance;
  assert.equal(def.label, 'Color Balance');
  assert.equal(def.fields.filter((f) => f.min === -100 && f.max === 100).length, 9);
  const params = defaultAdjustmentParams('colorBalance');
  assert.equal(params.preserveLuminosity, true);
  assert.equal(params.midtonesR, 0);
  assert.ok(ADJUSTMENT_LAYER_IDS.includes('colorBalance'));
});

test('identity params leave pixels unchanged', () => {
  const src = [
    [0, 0, 0, 255],
    [1, 76, 128, 255],
    [200, 254, 255, 128]
  ];
  for (const preserveLuminosity of [true, false]) {
    const a = img(src);
    ADJUSTMENTS.colorBalance.apply(
      a,
      { ...defaultAdjustmentParams('colorBalance'), preserveLuminosity },
      null
    );
    assert.deepEqual([...a.data], src.flat());
  }
});

test('midtone +100 Cyan-Red moves mid-gray to the PhotoCraft values', () => {
  // Preserve Luminosity off: red gamma 2 (128 → 255 · (128/255)^0.5), green and blue untouched.
  const off = img([[128, 128, 128, 255]]);
  applyColorBalance(off, { midtonesR: 100, preserveLuminosity: false });
  assert.deepEqual([...off.data], [181, 128, 128, 255]);
  // On: m = own − (max + min) / 2, so red gets +50 and green and blue −50.
  const on = img([[128, 128, 128, 255]]);
  applyColorBalance(on, { midtonesR: 100 });
  const up = Math.round(Math.pow(128 / 255, 1 / Math.SQRT2) * 255);
  const down = Math.round(Math.pow(128 / 255, Math.SQRT2) * 255);
  assert.deepEqual([up, down], [157, 96]);
  assert.deepEqual([...on.data], [up, down, down, 255]);
});

test('a shadows-only shift leaves white unchanged and moves the black point', () => {
  for (const preserveLuminosity of [true, false]) {
    const a = img([
      [255, 255, 255, 255],
      [10, 10, 10, 255]
    ]);
    applyColorBalance(a, { shadowsR: -40, shadowsB: 30, preserveLuminosity });
    assert.deepEqual([...a.data.slice(0, 4)], [255, 255, 255, 255]);
    // Red's black point is 40 (off) or max − own = 70 (on): level 10 goes to 0.
    assert.equal(a.data[4], 0);
  }
});

test('Preserve Luminosity cancels an equal shift on every channel', () => {
  const src = [
    [128, 64, 200, 255],
    [30, 30, 30, 255],
    [240, 220, 10, 255]
  ];
  const on = img(src);
  applyColorBalance(on, {
    shadowsR: 30,
    shadowsG: 30,
    shadowsB: 30,
    midtonesR: 60,
    midtonesG: 60,
    midtonesB: 60,
    highlightsR: -20,
    highlightsG: -20,
    highlightsB: -20
  });
  assert.deepEqual([...on.data], src.flat());
  const off = img(src);
  applyColorBalance(off, {
    midtonesR: 60,
    midtonesG: 60,
    midtonesB: 60,
    preserveLuminosity: false
  });
  assert.ok(luma(off.data) > luma(on.data) + 10);
});

test('a gamma > 1 curve starts at slope 2^gamma and stays monotone', () => {
  const curve = colorBalanceCurve(
    [
      [0, 0, 0],
      [100, 0, 0],
      [0, 0, 0]
    ],
    false,
    0
  );
  // gamma 2: s0 = 4, the Hermite join ends at u0 = 2 · 4^-2 = 0.125.
  assert.ok(Math.abs(curve(0.001) / 0.001 - 4) < 0.05);
  assert.ok(Math.abs(curve(0.125) - Math.sqrt(0.125)) < 1e-6);
  let prev = 0;
  for (let v = 0; v <= 255; v++) {
    const out = curve(v / 255);
    assert.ok(out >= prev - 1e-7, `not monotone at ${v}`);
    prev = out;
  }
  assert.equal(curve(1), 1);
});

test('alpha is untouched, transparent pixels and unselected pixels are skipped', () => {
  const a = img([
    [128, 128, 128, 77],
    [128, 128, 128, 0],
    [128, 128, 128, 255]
  ]);
  applyColorBalance(a, { midtonesR: 100, preserveLuminosity: false }, Uint8Array.from([1, 1, 0]));
  assert.deepEqual([...a.data], [181, 128, 128, 77, 128, 128, 128, 0, 128, 128, 128, 255]);
});

test('a Color Balance adjustment layer at opacity 0.5 mixes halfway', () => {
  const data = new Uint8ClampedArray([128, 128, 128, 255]);
  const layer = {
    kind: 'adjustment',
    adjustmentId: 'colorBalance',
    params: { ...defaultAdjustmentParams('colorBalance'), midtonesR: 100 },
    opacity: 0.5,
    visible: true,
    mask: null
  };
  applyAdjustmentLayer(data, layer, 1, 1);
  // Full strength is (157, 96, 96).
  assert.deepEqual([...data], [Math.round(128 + 29 / 2), 112, 112, 255]);
});
