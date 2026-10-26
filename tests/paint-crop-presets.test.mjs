import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_CLEAR,
  CROP_FRONT,
  CROP_RATIOS,
  CROP_SIZE_PRESETS,
  CROP_WXH,
  cropChosen
} from '../paint/crop-frame.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const aspect = (f) => (f[2] - f[0]) / (f[3] - f[1]);

function fakeOverlay(width = 2000, height = 1000) {
  return new Proxy(
    { canvas: { width, height } },
    {
      get(target, key) {
        if (key in target) return target[key];
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      }
    }
  );
}

function cropState(frame = [0, 0, 2000, 1000]) {
  return { toolOptions: defaultToolOptions(), zoom: 1, cropFrame: frame, cropAngle: 0 };
}

test('CROP_SIZE_PRESETS are the px presets in PhotoCraft order', () => {
  assert.deepEqual(CROP_SIZE_PRESETS, [
    { value: 'preset:1024x768px', label: '1024 x 768 px', w: '1024', h: '768' },
    { value: 'preset:1280x800px', label: '1280 x 800 px', w: '1280', h: '800' },
    { value: 'preset:1366x768px', label: '1366 x 768 px', w: '1366', h: '768' }
  ]);
  assert.equal(CROP_FRONT, 'front');
  assert.equal(CROP_CLEAR, 'clear');
});

test('cropChosen: a size preset sets W x H mode and its fields', () => {
  assert.deepEqual(cropChosen('preset:1280x800px', { ratio: '1:1' }, 640, 480), {
    ratio: CROP_WXH,
    cropW: '1280',
    cropH: '800'
  });
});

test('cropChosen: Front Image fills the fields from the document size as strings', () => {
  assert.deepEqual(cropChosen('front', {}, 640, 480), {
    ratio: 'wxh',
    cropW: '640',
    cropH: '480'
  });
});

test('cropChosen: Clear empties the fields and keeps W x H', () => {
  assert.deepEqual(cropChosen('clear', { ratio: 'wxh', cropW: '9', cropH: '3' }, 640, 480), {
    ratio: 'wxh',
    cropW: '',
    cropH: ''
  });
});

test('cropChosen: any other key is just the ratio', () => {
  assert.deepEqual(cropChosen('16:9', { cropW: '5', cropH: '5' }, 640, 480), { ratio: '16:9' });
  assert.deepEqual(cropChosen('', {}, 640, 480), { ratio: '' });
  assert.deepEqual(cropChosen('wxh', {}, 640, 480), { ratio: 'wxh' });
});

test('Ratio select: ratio presets, then size presets, then Front Image, then Clear', () => {
  const ratio = TOOL_OPTION_SCHEMA.crop.find((o) => o.key === 'ratio');
  const values = ratio.options.map((o) => o.value);
  assert.deepEqual(values, [
    ...CROP_RATIOS.map((o) => o.value),
    'preset:1024x768px',
    'preset:1280x800px',
    'preset:1366x768px',
    'front',
    'clear'
  ]);
  const labels = ratio.options.map((o) => o.label);
  assert.deepEqual(labels.slice(-5), [
    '1024 x 768 px',
    '1280 x 800 px',
    '1366 x 768 px',
    'Front Image',
    'Clear'
  ]);
});

test('Ratio onSelect: W x H choices patch the action first and never keep the key', () => {
  const ratio = TOOL_OPTION_SCHEMA.crop.find((o) => o.key === 'ratio');
  const values = { ratio: '', docSize: [640, 480] };
  const preset = ratio.onSelect('preset:1366x768px', values);
  assert.deepEqual(Object.keys(preset), ['_cropAction', 'ratio', 'cropW', 'cropH']);
  assert.deepEqual(preset, {
    _cropAction: 'choose:preset:1366x768px',
    ratio: 'wxh',
    cropW: '1366',
    cropH: '768'
  });
  assert.deepEqual(ratio.onSelect('front', values), {
    _cropAction: 'choose:front',
    ratio: 'wxh',
    cropW: '640',
    cropH: '480'
  });
  assert.equal(ratio.onSelect('clear', values).ratio, 'wxh');
  // A plain ratio key goes through unchanged.
  assert.equal(ratio.onSelect('4:5', values), null);
  assert.equal(ratio.onSelect('wxh', values), null);
});

test('TOOLS.crop.choose: a size preset refits the frame to its aspect about the centre', () => {
  const ov = fakeOverlay();
  const state = cropState();
  TOOLS.crop.choose(ov, state, 'preset:1024x768px');
  const opts = state.toolOptions.crop;
  assert.equal(opts.ratio, 'wxh');
  assert.equal(opts.cropW, '1024');
  assert.equal(opts.cropH, '768');
  const f = state.cropFrame;
  assert.ok(near(aspect(f), 1024 / 768));
  assert.ok(near(f[3] - f[1], 1000));
  assert.ok(near((f[0] + f[2]) / 2, 1000));
});

test('TOOLS.crop.choose: Front Image fits the document aspect; Clear leaves the frame', () => {
  const ov = fakeOverlay(400, 300);
  const state = cropState([0, 0, 300, 300]);
  TOOLS.crop.choose(ov, state, 'front');
  assert.equal(state.toolOptions.crop.cropW, '400');
  assert.equal(state.toolOptions.crop.cropH, '300');
  assert.deepEqual(state.cropFrame, [0, 37.5, 300, 262.5]);
  TOOLS.crop.choose(ov, state, 'clear');
  assert.equal(state.toolOptions.crop.ratio, 'wxh');
  assert.equal(state.toolOptions.crop.cropW, '');
  assert.equal(state.toolOptions.crop.cropH, '');
  assert.deepEqual(state.cropFrame, [0, 37.5, 300, 262.5]);
});

test('TOOLS.crop.choose: no-op mid-drag', () => {
  const ov = fakeOverlay();
  const state = cropState();
  state.cropDrag = { hit: 'inside' };
  TOOLS.crop.choose(ov, state, 'front');
  assert.equal(state.toolOptions.crop.ratio, '');
  assert.deepEqual(state.cropFrame, [0, 0, 2000, 1000]);
});

test('X in W x H mode: TOOLS.crop.swap swaps the fields and refits', () => {
  const ov = fakeOverlay();
  const state = cropState();
  TOOLS.crop.choose(ov, state, 'preset:1280x800px');
  TOOLS.crop.swap(ov, state);
  assert.equal(state.toolOptions.crop.cropW, '800');
  assert.equal(state.toolOptions.crop.cropH, '1280');
  assert.ok(near(aspect(state.cropFrame), 800 / 1280));
});
