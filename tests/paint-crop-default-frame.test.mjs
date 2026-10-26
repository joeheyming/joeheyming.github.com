import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cropDefaultFrame } from '../paint/crop-frame.js';
import { TOOLS } from '../paint/tools.js';

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

const freshState = (ratio = '') => ({ zoom: 1, toolOptions: { crop: { ratio } } });

test('cropDefaultFrame: the whole canvas without a selection box', () => {
  assert.deepEqual(cropDefaultFrame(200, 100), [0, 0, 200, 100]);
  assert.deepEqual(cropDefaultFrame(200, 100, null), [0, 0, 200, 100]);
});

test('cropDefaultFrame: the selection bounds when given', () => {
  assert.deepEqual(cropDefaultFrame(200, 100, { x: 10, y: 20, w: 50, h: 30 }), [10, 20, 60, 50]);
});

test('cropDefaultFrame: a box partly off the canvas is clamped to it', () => {
  assert.deepEqual(cropDefaultFrame(200, 100, { x: -20, y: 80, w: 70, h: 50 }), [0, 80, 50, 100]);
  assert.deepEqual(
    cropDefaultFrame(200, 100, { x: 150, y: -5, w: 100, h: 200 }),
    [150, 0, 200, 100]
  );
});

test('cropDefaultFrame: an empty or off-canvas box falls back to the canvas', () => {
  assert.deepEqual(cropDefaultFrame(200, 100, { x: 10, y: 10, w: 0, h: 30 }), [0, 0, 200, 100]);
  assert.deepEqual(cropDefaultFrame(200, 100, { x: 300, y: 10, w: 20, h: 30 }), [0, 0, 200, 100]);
});

test('ensureFrame sets an upright default frame and keeps a pending one', () => {
  const ov = fakeOverlay();
  const state = freshState();
  state.cropAngle = 30;
  TOOLS.crop.ensureFrame(ov, state, 200, 100, null);
  assert.deepEqual(state.cropFrame, [0, 0, 200, 100]);
  assert.equal(state.cropAngle, 0);
  assert.equal(state.cropDefault, true);

  state.cropFrame = [5, 5, 50, 50];
  state.cropDefault = false;
  TOOLS.crop.ensureFrame(ov, state, 200, 100, null);
  assert.deepEqual(state.cropFrame, [5, 5, 50, 50]);
  assert.equal(state.cropDefault, false);
});

test('ensureFrame frames the selection box', () => {
  const state = freshState();
  TOOLS.crop.ensureFrame(fakeOverlay(), state, 200, 100, { x: 10, y: 20, w: 50, h: 30 });
  assert.deepEqual(state.cropFrame, [10, 20, 60, 50]);
  assert.equal(state.cropDefault, true);
});

test('ensureFrame fits the default frame to the ratio and keeps cropDefault', () => {
  const state = freshState('1:1');
  TOOLS.crop.ensureFrame(fakeOverlay(), state, 200, 100, null);
  assert.deepEqual(state.cropFrame, [50, 0, 150, 100]);
  assert.equal(state.cropDefault, true);
  TOOLS.crop.fitRatio(fakeOverlay(), state);
  assert.equal(state.cropDefault, true);
});

test('a drag through TOOLS.crop clears cropDefault; a click that changes nothing keeps it', () => {
  const ov = fakeOverlay();
  const state = freshState();
  TOOLS.crop.ensureFrame(ov, state, 200, 100, null);

  // A click inside: no move.
  TOOLS.crop.onDown(null, ov, state, 100, 50);
  TOOLS.crop.onUp(null, ov, state, 100, 50);
  assert.equal(state.cropDefault, true);
  assert.deepEqual(state.cropFrame, [0, 0, 200, 100]);

  // Drag the east handle in.
  TOOLS.crop.onDown(null, ov, state, 200, 50);
  TOOLS.crop.onMove(null, ov, state, 180, 50);
  TOOLS.crop.onUp(null, ov, state, 160, 50);
  assert.deepEqual(state.cropFrame, [0, 0, 160, 100]);
  assert.equal(state.cropDefault, false);
});

test('swap and cancel clear cropDefault', () => {
  const ov = fakeOverlay();
  const state = freshState();
  TOOLS.crop.ensureFrame(ov, state, 200, 100, { x: 10, y: 10, w: 40, h: 20 });
  TOOLS.crop.swap(ov, state);
  assert.equal(state.cropDefault, false);

  TOOLS.crop.cancel(ov, state);
  TOOLS.crop.ensureFrame(ov, state, 200, 100, null);
  assert.equal(state.cropDefault, true);
  TOOLS.crop.cancel(ov, state);
  assert.equal(state.cropDefault, false);
  assert.equal(state.cropFrame, null);
});
