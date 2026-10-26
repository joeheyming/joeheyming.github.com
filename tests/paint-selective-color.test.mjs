import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADJUSTMENTS,
  SELECTIVE_RANGES,
  applySelectiveColor,
  selectiveColor,
  selectiveColorWeights
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

const defaults = () => defaultAdjustmentParams('selectiveColor');
const zero = () => SELECTIVE_RANGES.map(() => [0, 0, 0, 0]);

test('Selective Color is registered with method and 36 flat percent sliders', () => {
  assert.equal(ADJUSTMENTS.selectiveColor.label, 'Selective Color');
  assert.deepEqual(SELECTIVE_RANGES, [
    'reds',
    'yellows',
    'greens',
    'cyans',
    'blues',
    'magentas',
    'whites',
    'neutrals',
    'blacks'
  ]);
  const p = defaults();
  assert.equal(p.method, 'relative');
  assert.equal(Object.keys(p).length, 37);
  for (const r of SELECTIVE_RANGES) {
    for (const ink of ['Cyan', 'Magenta', 'Yellow', 'Black']) assert.equal(p[r + ink], 0);
  }
  const f = ADJUSTMENTS.selectiveColor.fields.find((x) => x.key === 'redsCyan');
  assert.equal(f.min, -100);
  assert.equal(f.max, 100);
  const i = ADJUSTMENT_LAYER_IDS.indexOf('selectiveColor');
  assert.equal(ADJUSTMENT_LAYER_IDS[i - 1], 'gradientMap');
});

test('all-zero params are identity', () => {
  const px = [];
  for (let k = 0; k < 64; k++) px.push([(k * 37) % 256, (k * 91) % 256, (k * 13) % 256, 255]);
  const im = img(px, 8);
  const before = Array.from(im.data);
  applySelectiveColor(im, defaults(), null);
  assert.deepEqual(Array.from(im.data), before);
  for (const c of [
    [0.9, 0.1, 0.1],
    [0.5, 0.5, 0.5],
    [0.2, 0.4, 0.8]
  ]) {
    assert.deepEqual(selectiveColor(c, true, zero()), c);
  }
});

test('selectiveColorWeights puts pure red in reds and not greens or blues', () => {
  const w = selectiveColorWeights([1, 0, 0]);
  assert.equal(w[0], 1);
  assert.equal(w[2], 0);
  assert.equal(w[4], 0);
  const grey = selectiveColorWeights([0.5, 0.5, 0.5]);
  assert.deepEqual(grey.slice(0, 6), [0, 0, 0, 0, 0, 0]);
  assert.equal(grey[7], 1);
});

test('reds cyan +100 lowers red, and relative differs from absolute', () => {
  const adj = zero();
  adj[0][0] = 100;
  const c = [0.9, 0.1, 0.1];
  const rel = selectiveColor(c, true, adj);
  const abs = selectiveColor(c, false, adj);
  // weight 0.8; relative scales by ink 0.1, absolute by min(1, 2 × 0.9) = 1.
  assert.ok(Math.abs(rel[0] - (0.9 - 0.8 * 0.1)) < 1e-9);
  assert.ok(Math.abs(abs[0] - (0.9 - 0.8)) < 1e-9);
  assert.ok(abs[0] < 0.2);
  assert.notEqual(rel[0], abs[0]);
  assert.deepEqual(selectiveColor([0.1, 0.1, 0.9], false, adj), [0.1, 0.1, 0.9]);

  const red = img([[255, 0, 0, 255]]);
  applySelectiveColor(red, { ...defaults(), method: 'absolute', redsCyan: 100 }, null);
  assert.deepEqual(Array.from(red.data), [0, 0, 0, 255]);
  const redRel = img([[230, 25, 25, 255]]);
  applySelectiveColor(redRel, { ...defaults(), redsCyan: 100 }, null);
  assert.ok(redRel.data[0] < 230);
  assert.equal(redRel.data[2], 25);
});

test('relative cannot tint pure white; absolute can through whites', () => {
  const adj = zero();
  adj[6] = [0, 0, 50, 0];
  assert.deepEqual(selectiveColor([1, 1, 1], true, adj), [1, 1, 1]);
  assert.ok(selectiveColor([1, 1, 1], false, adj)[2] < 0.6);
});

test('neutrals black darkens mid grey', () => {
  const im = img([[128, 128, 128, 255]]);
  applySelectiveColor(im, { ...defaults(), neutralsBlack: 50 }, null);
  const v = im.data[0];
  assert.ok(v < 128, `got ${v}`);
  assert.equal(im.data[1], v);
  assert.equal(im.data[2], v);
  assert.equal(im.data[3], 255);
});

test('a mask skips unselected pixels and alpha-0 pixels are left alone', () => {
  const im = img([
    [128, 128, 128, 255],
    [128, 128, 128, 255],
    [128, 128, 128, 0]
  ]);
  applySelectiveColor(im, { ...defaults(), neutralsBlack: 100 }, new Uint8Array([1, 0, 1]));
  assert.ok(im.data[0] < 128);
  assert.deepEqual(Array.from(im.data.slice(4)), [128, 128, 128, 255, 128, 128, 128, 0]);
});

test('a Selective Color adjustment layer at opacity 0.5 mixes halfway', () => {
  const params = { ...defaults(), method: 'absolute', redsCyan: 100, neutralsBlack: 40 };
  const src = [200, 120, 40, 255];
  const full = img([src]);
  applySelectiveColor(full, params, null);
  assert.notDeepEqual(Array.from(full.data), src);
  const data = new Uint8ClampedArray(src);
  const layer = {
    kind: 'adjustment',
    adjustmentId: 'selectiveColor',
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
