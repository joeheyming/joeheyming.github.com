import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADJUSTMENTS,
  LUT_LOOKS,
  LUT_LOOK_SIZE,
  applyColorLookup,
  bayer4,
  lut3dSample,
  lutLattice,
  lutLookTable
} from '../paint/adjustments.js';
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

const defaults = () => defaultAdjustmentParams('colorLookup');

test('Color Lookup is registered with flat select and checkbox params', () => {
  const def = ADJUSTMENTS.colorLookup;
  assert.equal(def.label, 'Color Lookup');
  assert.deepEqual(defaults(), { lut: 'none', tetrahedral: false, dither: false });
  const lut = def.fields.find((f) => f.key === 'lut');
  assert.equal(lut.type, 'select');
  assert.deepEqual(
    lut.options.map((o) => o.value),
    [
      'none',
      'warm',
      'cool',
      'tealOrange',
      'bleachBypass',
      'fadedFilm',
      'dayForNight',
      'monoContrast',
      'crossProcess'
    ]
  );
  assert.equal(lut.options[1].label, 'Warm Filter');
  assert.equal(LUT_LOOK_SIZE, 33);
  assert.equal(lutLookTable('warm').length, 33 * 33 * 33 * 3);
  assert.equal(lutLookTable('none'), null);
  assert.equal(
    ADJUSTMENT_LAYER_IDS.indexOf('colorLookup'),
    ADJUSTMENT_LAYER_IDS.indexOf('channelMixer') + 1
  );
});

test("lut 'none' is identity", () => {
  const px = [
    [10, 200, 30, 255],
    [255, 128, 0, 128]
  ];
  const a = img(px);
  applyColorLookup(a, { ...defaults(), dither: true }, null);
  assert.deepEqual([...a.data], px.flat());
});

test('an identity lattice samples back its input, trilinear and tetrahedral', () => {
  const table = lutLattice(5, (c) => c);
  const samples = [
    [0, 0, 0],
    [1, 1, 1],
    [0.13, 0.77, 0.5],
    [0.9, 0.2, 0.41],
    [0.33, 0.33, 0.8],
    [0.6, 0.95, 0.05]
  ];
  for (const tetra of [false, true]) {
    for (const c of samples) {
      const o = lut3dSample(table, 5, c, tetra);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(o[k] - c[k]) < 1e-6, `${c} ${tetra}`);
    }
  }
});

test('tetrahedral and trilinear agree on the lattice and stay close between', () => {
  const look = LUT_LOOKS.find((l) => l.id === 'tealOrange');
  const table = lutLookTable('tealOrange');
  const c = [4 / 32, 20 / 32, 9 / 32];
  const want = look.f(c);
  for (const tetra of [false, true]) {
    const o = lut3dSample(table, LUT_LOOK_SIZE, c, tetra);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(o[k] - want[k]) < 1e-6);
  }
  const mid = [0.31, 0.52, 0.77];
  const t = lut3dSample(table, LUT_LOOK_SIZE, mid, false);
  const h = lut3dSample(table, LUT_LOOK_SIZE, mid, true);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(t[k] - h[k]) < 0.01);
});

test("the 'warm' look on mid grey matches the builtin formula within 1 level", () => {
  for (const tetrahedral of [false, true]) {
    const a = img([[128, 128, 128, 255]]);
    applyColorLookup(a, { ...defaults(), lut: 'warm', tetrahedral }, null);
    const g = 128 / 255;
    const want = [g * 0.92 + 0.08, g * 0.97 + 0.02, g * 0.85].map((v) => v * 255);
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(a.data[c] - want[c]) <= 1, `ch${c}: ${a.data[c]} vs ${want[c]}`);
    }
    assert.equal(a.data[3], 255);
  }
});

test('alpha-0 pixels are skipped and alpha is untouched', () => {
  const a = img([
    [128, 128, 128, 0],
    [128, 128, 128, 77]
  ]);
  applyColorLookup(a, { ...defaults(), lut: 'cool' }, null);
  assert.deepEqual([...a.data.slice(0, 4)], [128, 128, 128, 0]);
  assert.equal(a.data[7], 77);
  assert.notDeepEqual([...a.data.slice(4, 7)], [128, 128, 128]);
});

test('bayer4 is PhotoCraft’s 4×4 ordered offset', () => {
  assert.equal(bayer4(0, 0), 0.5 / 16 - 0.5);
  assert.equal(bayer4(1, 0), 8.5 / 16 - 0.5);
  assert.equal(bayer4(3, 3), 5.5 / 16 - 0.5);
  assert.equal(bayer4(4, 5), bayer4(0, 1));
  const all = new Set();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) all.add(bayer4(x, y));
  assert.equal(all.size, 16);
});

test('dither changes a flat area by at most 1 level following bayer4', () => {
  const W = 8;
  const px = Array.from({ length: W * 8 }, () => [100, 140, 180, 255]);
  const plain = img(px, W);
  const dith = img(px, W);
  applyColorLookup(plain, { ...defaults(), lut: 'fadedFilm' }, null);
  applyColorLookup(dith, { ...defaults(), lut: 'fadedFilm', dither: true }, null);
  let changed = 0;
  for (let p = 0; p < W * 8; p++) {
    const d = bayer4(p % W, Math.floor(p / W));
    for (let c = 0; c < 3; c++) {
      const diff = dith.data[p * 4 + c] - plain.data[p * 4 + c];
      assert.ok(Math.abs(diff) <= 1);
      if (diff !== 0) {
        changed++;
        assert.equal(Math.sign(diff), Math.sign(d));
      }
    }
  }
  assert.ok(changed > 0, 'dither moved no pixel');
});

test('a mask skips unselected pixels', () => {
  const a = img([
    [128, 128, 128, 255],
    [128, 128, 128, 255]
  ]);
  applyColorLookup(a, { ...defaults(), lut: 'dayForNight' }, Uint8Array.from([0, 1]));
  assert.deepEqual([...a.data.slice(0, 4)], [128, 128, 128, 255]);
  assert.notDeepEqual([...a.data.slice(4, 7)], [128, 128, 128]);
});

test('a Color Lookup adjustment layer at opacity 0.5 mixes halfway', () => {
  const params = { ...defaults(), lut: 'warm' };
  const full = img([[128, 128, 128, 255]]);
  applyColorLookup(full, params, null);
  const data = new Uint8ClampedArray([128, 128, 128, 255]);
  const layer = {
    kind: 'adjustment',
    adjustmentId: 'colorLookup',
    params,
    opacity: 0.5,
    visible: true,
    mask: null
  };
  applyAdjustmentLayer(data, layer, 1, 1);
  for (let c = 0; c < 3; c++) {
    const want = (128 + full.data[c]) / 2;
    assert.ok(Math.abs(data[c] - want) <= 1, `ch${c}: ${data[c]} vs ${want}`);
  }
  assert.equal(data[3], 255);
});
