import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_RATIOS,
  cropDrag,
  cropDraw,
  cropFittedRatio,
  cropRatio,
  cropSwapped,
  cropSwappedRatio
} from '../paint/crop-frame.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearFrame = (f, g, eps = 1e-9) => f.length === 4 && f.every((v, i) => near(v, g[i], eps));
const area = (f) => (f[2] - f[0]) * (f[3] - f[1]);
const centre = (f) => [(f[0] + f[2]) / 2, (f[1] + f[3]) / 2];

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

test('CROP_RATIOS carries PhotoCraft keys and labels; the empty key is no ratio', () => {
  assert.deepEqual(
    CROP_RATIOS.map((r) => r.value),
    ['', 'wxh', 'original', '1:1', '4:5', '5:7', '2:3', '16:9']
  );
  assert.equal(CROP_RATIOS[0].label, 'Ratio');
  assert.equal(CROP_RATIOS[1].label, 'W x H');
  assert.equal(CROP_RATIOS[2].label, 'Original Ratio');
  assert.equal(CROP_RATIOS[3].label, '1 : 1 (Square)');
  assert.equal(CROP_RATIOS[4].label, '4 : 5 (8 : 10)');
  assert.equal(CROP_RATIOS[6].label, '2 : 3 (4 : 6)');
});

test('cropRatio: original is the document, a:b is a / b, anything else is null', () => {
  assert.equal(cropRatio('original', 1200, 800), 1.5);
  assert.equal(cropRatio('16:9', 1200, 800), 16 / 9);
  assert.equal(cropRatio('4:5', 0, 0), 0.8);
  assert.equal(cropRatio('1.414:1', 0, 0), 1.414);
  assert.equal(cropRatio('', 1200, 800), null);
  assert.equal(cropRatio('0:1', 1200, 800), null);
  assert.equal(cropRatio('a:b', 1200, 800), null);
  assert.equal(cropRatio('3', 1200, 800), null);
  assert.equal(cropRatio('original', 0, 800), null);
});

test('cropFittedRatio: largest centred frame of the ratio, area never grows', () => {
  // A wide 200 x 50 frame to 1:1 keeps the height.
  const wide = [0, 0, 200, 50];
  const sq = cropFittedRatio(wide, 1);
  assert.ok(nearFrame(sq, [75, 0, 125, 50]));
  assert.deepEqual(centre(sq), centre(wide));
  assert.ok(area(sq) <= area(wide));
  // A tall 40 x 100 frame to 16:9 keeps the width.
  const tall = [10, 20, 50, 120];
  const k = 16 / 9;
  const f = cropFittedRatio(tall, k);
  assert.ok(near(f[2] - f[0], 40));
  assert.ok(near((f[2] - f[0]) / (f[3] - f[1]), k));
  assert.ok(nearFrame(centre(f).concat(0, 0), centre(tall).concat(0, 0)));
  assert.ok(area(f) <= area(tall));
  // Already that ratio: the same frame.
  assert.deepEqual(cropFittedRatio([0, 0, 160, 90], k), [0, 0, 160, 90]);
  assert.equal(cropFittedRatio([0, 0, 0, 10], 1), null);
  assert.equal(cropFittedRatio([0, 0, 10, 10], 0), null);
});

test('cropSwapped swaps width and height about the centre', () => {
  assert.deepEqual(cropSwapped([10, 10, 110, 60]), [35, -15, 85, 85]);
  assert.deepEqual(cropSwapped(cropSwapped([10, 10, 110, 60])), [10, 10, 110, 60]);
});

test('cropSwappedRatio turns a:b into b:a and original into the document on its side', () => {
  assert.equal(cropSwappedRatio('4:5', 1200, 800), '5:4');
  assert.equal(cropSwappedRatio('16:9', 1200, 800), '9:16');
  assert.equal(cropSwappedRatio('1:1', 1200, 800), '1:1');
  assert.equal(cropSwappedRatio('original', 1200, 800), '800:1200');
  assert.equal(cropSwappedRatio('1.4142:1', 0, 0), '1:1.414');
  assert.equal(cropSwappedRatio('', 1200, 800), null);
});

test('cropDraw holds a ratio in place of Shift; the larger relative extent wins', () => {
  // 2:1 dragged 100 x 10: width wins, height follows.
  assert.deepEqual(cropDraw(0, 0, 100, 10, { ratio: 2 }), [0, 0, 100, 50]);
  // Dragged 10 x 100 up-left: height wins.
  assert.deepEqual(cropDraw(300, 300, 290, 200, { ratio: 2, shift: true }), [100, 200, 300, 300]);
  // Alt from the centre.
  assert.deepEqual(cropDraw(50, 50, 70, 50, { ratio: 1, alt: true }), [30, 30, 70, 70]);
  // Without one the US-143 behaviour is unchanged.
  assert.deepEqual(cropDraw(0, 0, 100, 10), [0, 0, 100, 10]);
  assert.deepEqual(cropDraw(0, 0, 100, 10, { shift: true }), [0, 0, 100, 100]);
});

test('cropDrag holds a ratio on sides and corners; without one Shift keeps the frame', () => {
  const f = [0, 0, 100, 100];
  // East side by +100 at 4:1: 200 wide, height follows about the vertical centre.
  assert.deepEqual(cropDrag(f, 'e', 100, 0, { ratio: 4 }), [0, 25, 200, 75]);
  // Corner: the larger relative extent wins.
  assert.deepEqual(cropDrag(f, 'se', 0, 50, { ratio: 2 }), [0, 0, 300, 150]);
  // No ratio: free, or Shift keeps the frame's 1:1.
  assert.deepEqual(cropDrag(f, 'e', 100, 0), [0, 0, 200, 100]);
  assert.deepEqual(cropDrag(f, 'e', 100, 0, { shift: true }), [0, -50, 200, 150]);
});

test('TOOL_OPTION_SCHEMA.crop has a ratio select and a swap icon action', () => {
  const schema = TOOL_OPTION_SCHEMA.crop;
  const ratio = schema.find((o) => o.key === 'ratio');
  assert.equal(ratio.type, 'select');
  assert.equal(ratio.default, '');
  assert.deepEqual(ratio.options.slice(0, CROP_RATIOS.length), CROP_RATIOS);
  assert.deepEqual(ratio.extraOption('5:4'), { value: '5:4', label: '5 : 4' });
  assert.equal(ratio.extraOption(''), null);
  assert.equal(defaultToolOptions().crop.ratio, '');
  const swap = schema.find((o) => o.key === '_cropSwap');
  assert.equal(swap.type, 'iconAction');
  assert.equal(swap.icon, 'arrow-left-right');
  assert.deepEqual(swap.patch({ ratio: '4:5', docSize: [200, 100] }), {
    _cropAction: 'swap',
    ratio: '5:4'
  });
  assert.deepEqual(swap.patch({ ratio: 'original', docSize: [200, 100] }), {
    _cropAction: 'swap',
    ratio: '100:200'
  });
  assert.deepEqual(swap.patch({ ratio: '', docSize: [200, 100] }), { _cropAction: 'swap' });
});

test('a ratio-held draw through TOOLS.crop', () => {
  const ov = fakeOverlay();
  const state = { zoom: 1, toolOptions: { crop: { ratio: '16:9' } }, cropFrame: null };
  const t = TOOLS.crop;
  t.onDown(null, ov, state, 0, 0);
  t.onMove(null, ov, state, 160, 10);
  t.onUp(null, ov, state, 160, 10);
  assert.ok(nearFrame(state.cropFrame, [0, 0, 160, 90]));
  // original on a 200 x 100 overlay is 2:1, and Shift does not square it.
  state.toolOptions.crop.ratio = 'original';
  state.shiftKey = true;
  t.cancel(ov, state);
  t.onDown(null, ov, state, 0, 0);
  t.onUp(null, ov, state, 40, 5);
  assert.deepEqual(state.cropFrame, [0, 0, 40, 20]);
});

test('a turned-handle resize through TOOLS.crop holds the ratio', () => {
  const ov = fakeOverlay();
  const state = {
    zoom: 1,
    toolOptions: { crop: { ratio: '2:1' } },
    cropFrame: [0, 0, 100, 50],
    cropAngle: 90
  };
  const t = TOOLS.crop;
  // Turned 90° about (50, 25), the frame's east handle (100, 25) sits at (50, 75) on screen.
  // Dragging it 50 px further along its own axis (down on screen) makes the frame 150 wide.
  t.onDown(null, ov, state, 50, 75);
  t.onUp(null, ov, state, 50, 125);
  const f = state.cropFrame;
  assert.ok(near(f[2] - f[0], 150));
  assert.ok(near((f[2] - f[0]) / (f[3] - f[1]), 2));
  assert.equal(state.cropAngle, 90);
  // The west edge stays put on screen: the turned centre moved 25 px down.
  assert.ok(nearFrame(centre(f).concat(0, 0), [50, 50, 0, 0]));
});

test('picking a ratio fits the pending frame about its centre, keeping its angle', () => {
  const ov = fakeOverlay();
  const state = {
    zoom: 1,
    toolOptions: { crop: { ratio: '1:1' } },
    cropFrame: [0, 0, 200, 50],
    cropAngle: 30
  };
  TOOLS.crop.fitRatio(ov, state);
  assert.ok(nearFrame(state.cropFrame, [75, 0, 125, 50]));
  assert.equal(state.cropAngle, 30);
  // No ratio leaves it.
  state.toolOptions.crop.ratio = '';
  TOOLS.crop.fitRatio(ov, state);
  assert.ok(nearFrame(state.cropFrame, [75, 0, 125, 50]));
});

test('swap swaps the ratio key and fits the frame; without a ratio it swaps the frame', () => {
  const ov = fakeOverlay();
  const state = {
    zoom: 1,
    toolOptions: { crop: { ratio: '2:1' } },
    cropFrame: [0, 0, 100, 50],
    cropAngle: 15
  };
  TOOLS.crop.swap(ov, state);
  assert.equal(state.toolOptions.crop.ratio, '1:2');
  // 1:2 inside 100 x 50: 25 x 50 about (50, 25).
  assert.ok(nearFrame(state.cropFrame, [37.5, 0, 62.5, 50]));
  assert.equal(state.cropAngle, 15);
  state.toolOptions.crop.ratio = '';
  state.cropFrame = [10, 10, 110, 60];
  TOOLS.crop.swap(ov, state);
  assert.equal(state.toolOptions.crop.ratio, '');
  assert.deepEqual(state.cropFrame, [35, -15, 85, 85]);
  assert.equal(state.cropAngle, 15);
});
