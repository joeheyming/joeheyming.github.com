import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLevelsChannels,
  levelsTable,
  LEVELS_CHANNELS,
  ADJUSTMENTS
} from '../paint/adjustments.js';
import { defaultAdjustmentParams } from '../paint/adjustment-layers.js';

const FIELD_NAMES = ['Black', 'Gamma', 'White', 'OutBlack', 'OutWhite'];
const MASTER_KEYS = ['black', 'gamma', 'white', 'outBlack', 'outWhite'];
const DEFAULTS = [0, 1, 255, 0, 255];

// One pixel per value in `values`, each [r, g, b, a].
function image(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((px, p) => data.set(px, p * 4));
  return { width: pixels.length, height: 1, data };
}

function grays(values) {
  return image(values.map((v) => [v, v, v, 255]));
}

function channel(img, c) {
  const out = [];
  for (let i = c; i < img.data.length; i += 4) out.push(img.data[i]);
  return out;
}

test('Channel is a dialog-local select of RGB, Red, Green, Blue', () => {
  const sel = ADJUSTMENTS.levels.fields[0];
  assert.equal(sel.key, 'channel');
  assert.equal(sel.type, 'select');
  assert.equal(sel.local, true);
  assert.equal(sel.default, 'rgb');
  assert.deepEqual(
    sel.options.map((o) => [o.value, o.label]),
    [
      ['rgb', 'RGB'],
      ['red', 'Red'],
      ['green', 'Green'],
      ['blue', 'Blue']
    ]
  );
});

test('the master fields show for RGB and each channel has its own grouped five', () => {
  const fields = ADJUSTMENTS.levels.fields.slice(1);
  const byGroup = (value) =>
    fields.filter((f) => f.group?.key === 'channel' && f.group.value === value);
  assert.deepEqual(
    byGroup('rgb').map((f) => f.key),
    MASTER_KEYS
  );
  for (const ch of LEVELS_CHANNELS) {
    const own = byGroup(ch);
    assert.deepEqual(
      own.map((f) => f.key),
      FIELD_NAMES.map((n) => ch + n)
    );
    const master = byGroup('rgb');
    own.forEach((f, i) => {
      assert.deepEqual(
        [f.label, f.min, f.max, f.step, f.default],
        [master[i].label, master[i].min, master[i].max, master[i].step, master[i].default]
      );
    });
  }
  assert.equal(fields.length, 20);
});

test('default levels params hold all twenty keys and no channel selector', () => {
  const params = defaultAdjustmentParams('levels');
  const expected = {};
  MASTER_KEYS.forEach((k, i) => (expected[k] = DEFAULTS[i]));
  for (const ch of LEVELS_CHANNELS) {
    FIELD_NAMES.forEach((n, i) => (expected[ch + n] = DEFAULTS[i]));
  }
  assert.deepEqual(params, expected);
  assert.equal('channel' in params, false);
});

test('defaults and old five-key params are identity channels', () => {
  const values = [0, 1, 30, 128, 200, 254, 255];
  const a = grays(values);
  applyLevelsChannels(a, defaultAdjustmentParams('levels'), null);
  for (let c = 0; c < 3; c++) assert.deepEqual(channel(a, c), values);
  const b = grays(values);
  const c2 = grays(values);
  ADJUSTMENTS.levels.apply(b, { black: 10, gamma: 1.5, white: 240 }, null);
  const lut = levelsTable(10, 1.5, 240);
  for (let i = 0; i < c2.data.length; i += 4) {
    for (let k = 0; k < 3; k++) c2.data[i + k] = lut[c2.data[i + k]];
  }
  assert.deepEqual(b.data, c2.data);
});

test('levels_work_on_whole_levels holds on all three channels under an identity master', () => {
  const params = defaultAdjustmentParams('levels');
  for (const ch of LEVELS_CHANNELS) {
    params[ch + 'Black'] = 44;
    params[ch + 'White'] = 214;
    params[ch + 'Gamma'] = 1.78;
  }
  const input = [44, 45, 46, 47, 48, 52, 69, 100, 214];
  const want = [0, 7, 10, 17, 20, 37, 88, 137, 255];
  const img = grays(input);
  applyLevelsChannels(img, params, null);
  for (let c = 0; c < 3; c++) {
    channel(img, c).forEach((got, i) => {
      assert.ok(Math.abs(got - want[i]) <= 1, `c${c} ${input[i]} → ${got}, want ${want[i]}`);
    });
  }
});

test('a Red-only change leaves green and blue bytes unchanged', () => {
  const px = [
    [10, 20, 30, 255],
    [100, 150, 200, 255],
    [250, 5, 128, 255]
  ];
  const img = image(px);
  applyLevelsChannels(img, { redBlack: 50, redGamma: 0.6, redOutWhite: 200 }, null);
  assert.deepEqual(
    channel(img, 1),
    px.map((p) => p[1])
  );
  assert.deepEqual(
    channel(img, 2),
    px.map((p) => p[2])
  );
  const red = levelsTable(50, 0.6, 255, 0, 200);
  assert.deepEqual(
    channel(img, 0),
    px.map((p) => red[p[0]])
  );
  assert.notDeepEqual(
    channel(img, 0),
    px.map((p) => p[0])
  );
});

test('the channel runs first, then the RGB master: master(channel(v))', () => {
  const params = { ...defaultAdjustmentParams('levels'), redOutWhite: 194, white: 213 };
  const values = Array.from({ length: 256 }, (_, v) => v);
  const img = grays(values);
  applyLevelsChannels(img, params, null);
  const red = levelsTable(0, 1, 255, 0, 194);
  const master = levelsTable(0, 1, 213, 0, 255);
  assert.deepEqual(
    channel(img, 0),
    values.map((v) => master[red[v]])
  );
  assert.deepEqual(
    channel(img, 1),
    values.map((v) => master[v])
  );
  // The other order would differ: red(master(v)) clips at 194, master(red(v)) reaches 232.
  assert.equal(master[red[255]], 232);
  assert.notDeepEqual(
    channel(img, 0),
    values.map((v) => red[master[v]])
  );
});

test('alpha, transparent pixels, and masked-out pixels are untouched', () => {
  const params = { redBlack: 40, greenGamma: 2, blueOutBlack: 60, gamma: 0.7 };
  const img = image([
    [100, 100, 100, 128],
    [100, 100, 100, 0],
    [100, 100, 100, 255]
  ]);
  applyLevelsChannels(img, params, new Uint8Array([1, 1, 0]));
  assert.equal(img.data[3], 128);
  assert.notDeepEqual(Array.from(img.data.slice(0, 3)), [100, 100, 100]);
  assert.deepEqual(Array.from(img.data.slice(4, 8)), [100, 100, 100, 0]);
  assert.deepEqual(Array.from(img.data.slice(8, 12)), [100, 100, 100, 255]);
});
