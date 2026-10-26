import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CROP_RATIOS, CROP_WXH, cropTargetSize } from '../paint/crop-frame.js';
import {
  TOOLS,
  TOOL_OPTION_SCHEMA,
  cropToolRatio,
  cropToolTarget,
  defaultToolOptions
} from '../paint/tools.js';
import { resampleImageData } from '../paint/transform.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const aspect = (f) => (f[2] - f[0]) / (f[3] - f[1]);

function fakeOverlay(width = 200, height = 100) {
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

function wxhState(cropW, cropH) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions.crop, { ratio: CROP_WXH, cropW, cropH });
  return { toolOptions, zoom: 1 };
}

test('W x H sits right after the empty ratio key', () => {
  assert.equal(CROP_WXH, 'wxh');
  assert.deepEqual(CROP_RATIOS[1], { value: 'wxh', label: 'W x H' });
});

test('cropTargetSize: both fields positive numbers, rounded to whole px, else null', () => {
  assert.deepEqual(cropTargetSize('800', '600'), { w: 800, h: 600 });
  assert.deepEqual(cropTargetSize(' 12 ', 7), { w: 12, h: 7 });
  assert.deepEqual(cropTargetSize('99.6', '10.4'), { w: 100, h: 10 });
  assert.deepEqual(cropTargetSize('0.2', '3'), { w: 1, h: 3 });
  assert.equal(cropTargetSize('', '600'), null);
  assert.equal(cropTargetSize('800', ''), null);
  assert.equal(cropTargetSize(undefined, '600'), null);
  assert.equal(cropTargetSize('0', '600'), null);
  assert.equal(cropTargetSize('800', '-5'), null);
  assert.equal(cropTargetSize('abc', '600'), null);
  assert.equal(cropTargetSize('800', '6px'), null);
});

test('crop schema: W and H text fields, empty by default, shown only in W x H mode', () => {
  const schema = TOOL_OPTION_SCHEMA.crop;
  const keys = schema.map((o) => o.key);
  for (const key of ['cropW', 'cropH']) {
    const f = schema.find((o) => o.key === key);
    assert.equal(f.type, 'text');
    assert.equal(f.default, '');
    assert.deepEqual(f.shownWhen, { key: 'ratio', value: 'wxh' });
  }
  assert.ok(keys.indexOf('ratio') < keys.indexOf('cropW'));
  assert.ok(keys.indexOf('cropW') < keys.indexOf('_cropSwap'));
  assert.ok(keys.indexOf('_cropSwap') < keys.indexOf('cropH'));
  assert.equal(defaultToolOptions().crop.cropW, '');
  assert.equal(defaultToolOptions().crop.cropH, '');
});

test('cropToolRatio holds w / h in W x H mode, null (free) with an empty field', () => {
  const ov = fakeOverlay(200, 100);
  assert.equal(cropToolRatio(ov, wxhState('800', '600')), 800 / 600);
  assert.equal(cropToolRatio(ov, wxhState('', '600')), null);
  assert.deepEqual(cropToolTarget(wxhState('800', '600')), { w: 800, h: 600 });
  assert.equal(cropToolTarget(wxhState('800', '')), null);
  // The fields are ignored outside W x H mode.
  const s = wxhState('800', '600');
  s.toolOptions.crop.ratio = '';
  assert.equal(cropToolRatio(ov, s), null);
  assert.equal(cropToolTarget(s), null);
});

test('ensureFrame fits the default frame to w / h; empty fields leave the whole canvas', () => {
  const ov = fakeOverlay(200, 100);
  const s = wxhState('50', '100');
  TOOLS.crop.ensureFrame(ov, s, 200, 100, null);
  assert.ok(near(aspect(s.cropFrame), 0.5));
  assert.deepEqual(s.cropFrame, [75, 0, 125, 100]);
  assert.equal(s.cropDefault, true);
  const free = wxhState('', '');
  TOOLS.crop.ensureFrame(ov, free, 200, 100, null);
  assert.deepEqual(free.cropFrame, [0, 0, 200, 100]);
});

test('drawing and resizing hold the W x H aspect', () => {
  const ov = fakeOverlay(200, 100);
  const s = wxhState('300', '100');
  s.cropFrame = null;
  TOOLS.crop.onDown(null, ov, s, 10, 10, {});
  TOOLS.crop.onMove(null, ov, s, 40, 60, {});
  assert.ok(near(aspect(s.cropFrame), 3));
  TOOLS.crop.onUp(null, ov, s, 40, 60, {});
  const f = s.cropFrame;
  TOOLS.crop.onDown(null, ov, s, f[2], f[3], {});
  TOOLS.crop.onMove(null, ov, s, f[2] + 15, f[3] + 2, {});
  assert.ok(near(aspect(s.cropFrame), 3));
  TOOLS.crop.onUp(null, ov, s, f[2] + 15, f[3] + 2, {});
});

test('fitRatio refits the frame after a field edit', () => {
  const ov = fakeOverlay(200, 100);
  const s = wxhState('', '');
  TOOLS.crop.ensureFrame(ov, s, 200, 100, null);
  Object.assign(s.toolOptions.crop, { cropW: '1', cropH: '1' });
  TOOLS.crop.fitRatio(ov, s);
  assert.deepEqual(s.cropFrame, [50, 0, 150, 100]);
});

test('swap in W x H mode exchanges cropW and cropH and refits the frame', () => {
  const ov = fakeOverlay(200, 100);
  const s = wxhState('40', '80');
  TOOLS.crop.ensureFrame(ov, s, 200, 100, null);
  assert.ok(near(aspect(s.cropFrame), 0.5));
  TOOLS.crop.swap(ov, s);
  assert.equal(s.toolOptions.crop.cropW, '80');
  assert.equal(s.toolOptions.crop.cropH, '40');
  assert.equal(s.toolOptions.crop.ratio, 'wxh');
  assert.ok(near(aspect(s.cropFrame), 2));
  assert.equal(s.cropDefault, false);
  // The options-bar patch carries the swapped fields so the bar re-renders with them.
  const swap = TOOL_OPTION_SCHEMA.crop.find((o) => o.key === '_cropSwap');
  assert.deepEqual(swap.patch({ ratio: 'wxh', cropW: '40', cropH: '80', docSize: [200, 100] }), {
    _cropAction: 'swap',
    cropW: '80',
    cropH: '40'
  });
});

test('swap in W x H mode with one field empty still swaps the fields and the frame sides', () => {
  const ov = fakeOverlay(200, 100);
  const s = wxhState('40', '');
  s.cropFrame = [0, 0, 100, 50];
  s.cropAngle = 0;
  TOOLS.crop.swap(ov, s);
  assert.equal(s.toolOptions.crop.cropW, '');
  assert.equal(s.toolOptions.crop.cropH, '40');
  assert.deepEqual(s.cropFrame, [25, -25, 75, 75]);
});

test('resampleImageData gives exactly w x h and keeps flat colour', () => {
  const W = 3;
  const H = 2;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set([10, 200, 30, 255], p * 4);
  const up = resampleImageData({ width: W, height: H, data }, 7, 5);
  assert.equal(up.width, 7);
  assert.equal(up.height, 5);
  assert.equal(up.data.length, 7 * 5 * 4);
  for (let p = 0; p < 35; p++)
    assert.deepEqual([...up.data.slice(p * 4, p * 4 + 4)], [10, 200, 30, 255]);
  const down = resampleImageData({ width: W, height: H, data }, 1, 1);
  assert.equal(down.width, 1);
  assert.equal(down.height, 1);
  assert.deepEqual([...down.data], [10, 200, 30, 255]);
});

test('resampleImageData: a 2x upscale of two columns keeps the end columns and blends the middle', () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255]);
  const out = resampleImageData({ width: 2, height: 1, data }, 4, 1);
  const reds = [0, 1, 2, 3].map((x) => out.data[x * 4]);
  assert.deepEqual(reds, [0, 50, 150, 200]);
  assert.ok([0, 1, 2, 3].every((x) => out.data[x * 4 + 3] === 255));
});

test('resampleImageData: a transparent neighbour does not darken the colour', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
  const out = resampleImageData({ width: 2, height: 1, data }, 4, 1);
  assert.equal(out.data[1 * 4], 255);
  assert.ok(out.data[1 * 4 + 3] > 0 && out.data[1 * 4 + 3] < 255);
});
