import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJUSTMENTS, applyChannelMixer } from '../paint/adjustments.js';
import {
  ADJUSTMENT_LAYER_IDS,
  applyAdjustmentLayer,
  defaultAdjustmentParams
} from '../paint/adjustment-layers.js';

function img(pixels) {
  return { width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) };
}

const defaults = () => defaultAdjustmentParams('channelMixer');

test('Channel Mixer is registered with PhotoCraft identity defaults', () => {
  assert.equal(ADJUSTMENTS.channelMixer.label, 'Channel Mixer');
  assert.deepEqual(defaults(), {
    redRed: 100,
    redGreen: 0,
    redBlue: 0,
    redConstant: 0,
    greenRed: 0,
    greenGreen: 100,
    greenBlue: 0,
    greenConstant: 0,
    blueRed: 0,
    blueGreen: 0,
    blueBlue: 100,
    blueConstant: 0,
    grayRed: 40,
    grayGreen: 40,
    grayBlue: 20,
    grayConstant: 0,
    monochrome: false
  });
  for (const f of ADJUSTMENTS.channelMixer.fields) {
    if (f.type === 'checkbox' || f.local) continue;
    assert.deepEqual([f.min, f.max], [-200, 200], f.key);
  }
  assert.equal(
    ADJUSTMENT_LAYER_IDS.indexOf('channelMixer'),
    ADJUSTMENT_LAYER_IDS.indexOf('photoFilter') + 1
  );
});

test('default params are identity', () => {
  const pixels = [];
  for (let v = 0; v < 256; v += 5) pixels.push([v, (v * 7) % 256, 255 - v, 255]);
  const a = img(pixels);
  applyChannelMixer(a, defaults(), null);
  assert.deepEqual([...a.data], pixels.flat());
});

test('swapping the red and blue rows swaps those channels', () => {
  const a = img([
    [200, 50, 10, 255],
    [0, 128, 255, 255]
  ]);
  applyChannelMixer(a, { ...defaults(), redRed: 0, redBlue: 100, blueRed: 100, blueBlue: 0 }, null);
  assert.deepEqual([...a.data], [10, 50, 200, 255, 255, 128, 0, 255]);
});

test('a Constant of 50 adds half the level range and clamps at 255', () => {
  const a = img([
    [0, 0, 0, 255],
    [200, 0, 0, 255]
  ]);
  applyChannelMixer(a, { ...defaults(), redConstant: 50 }, null);
  assert.deepEqual([...a.data], [128, 0, 0, 255, 255, 0, 0, 255]);
});

test('Monochrome writes the gray row, not the red row, to all three channels', () => {
  const a = img([[200, 40, 30, 255]]);
  applyChannelMixer(a, { ...defaults(), monochrome: true, redRed: 0, redConstant: 100 }, null);
  const g = Math.round(0.4 * 200 + 0.4 * 40 + 0.2 * 30);
  assert.deepEqual([...a.data], [g, g, g, 255]);

  const b = img([[255, 0, 0, 255]]);
  applyChannelMixer(b, { ...defaults(), monochrome: true, grayRed: 150, grayConstant: 10 }, null);
  assert.deepEqual([...b.data], [255, 255, 255, 255]);
});

test('Monochrome without gray keys uses 40 / 40 / 20 / 0; gray keys are ignored when off', () => {
  const legacy = { ...defaults(), monochrome: true, redRed: 0 };
  for (const k of ['grayRed', 'grayGreen', 'grayBlue', 'grayConstant']) delete legacy[k];
  const a = img([[200, 40, 30, 255]]);
  applyChannelMixer(a, legacy, null);
  assert.deepEqual([...a.data], [102, 102, 102, 255]);

  const b = img([[200, 40, 30, 255]]);
  applyChannelMixer(b, { ...defaults(), grayRed: -200, grayConstant: 200 }, null);
  assert.deepEqual([...b.data], [200, 40, 30, 255]);
});

test('alpha is untouched, alpha-0 pixels and unselected pixels are skipped', () => {
  const a = img([
    [255, 0, 0, 77],
    [255, 0, 0, 0],
    [255, 0, 0, 255]
  ]);
  applyChannelMixer(a, { ...defaults(), redRed: 0, blueRed: 100 }, Uint8Array.from([1, 1, 0]));
  assert.deepEqual([...a.data], [0, 0, 255, 77, 255, 0, 0, 0, 255, 0, 0, 255]);
});

test('a Channel Mixer adjustment layer at opacity 0.5 mixes halfway', () => {
  const params = { ...defaults(), redRed: 0, redBlue: 100, blueRed: 100, blueBlue: 0 };
  const data = new Uint8ClampedArray([200, 50, 10, 255]);
  const layer = {
    kind: 'adjustment',
    adjustmentId: 'channelMixer',
    params,
    opacity: 0.5,
    visible: true,
    mask: null
  };
  applyAdjustmentLayer(data, layer, 1, 1);
  const want = [105, 50, 105];
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(data[c] - want[c]) <= 1, `ch${c}: ${data[c]} vs ${want[c]}`);
  }
  assert.equal(data[3], 255);
});
