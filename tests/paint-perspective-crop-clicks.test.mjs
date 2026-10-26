// Perspective Crop corner clicks (PhotoCraft perspective_crop_ui.rs pointer Up CLICK_PX, ordered).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, defaultToolOptions, perspectiveOrdered } from '../paint/tools.js';

// A stub overlay context that records arc calls and ignores every other draw call.
function overlay(width = 200, height = 150) {
  const target = { canvas: { width, height }, arcs: [] };
  target.arc = (x, y) => target.arcs.push([x, y]);
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => {}),
    set: (t, key, value) => ((t[key] = value), true)
  });
}

function pcropState() {
  return { toolOptions: defaultToolOptions(), zoom: 1, perspectiveQuad: null };
}

const tool = TOOLS.perspectiveCrop;

function click(ov, state, x, y) {
  tool.onDown(null, ov, state, x, y);
  tool.onUp(null, ov, state, x + 1, y - 1);
}

test('a click on an empty tool records its press point and makes no quad', () => {
  const ov = overlay();
  const state = pcropState();
  click(ov, state, 30, 30);
  assert.deepEqual(state.perspectiveClicks, [[30, 30]]);
  assert.equal(state.perspectiveQuad, null);
  assert.deepEqual(ov.arcs, [[30, 30]], 'the click is drawn as a dot');
});

test('a release beyond CROP_HANDLE_PX * 3 / 8 / zoom is not a click', () => {
  const ov = overlay();
  const state = { ...pcropState(), zoom: 2 };
  tool.onDown(null, ov, state, 30, 30);
  tool.onUp(null, ov, state, 31.6, 30);
  assert.deepEqual(state.perspectiveClicks, []);
});

test('four clicks in any order give the quad TL, TR, BR, BL', () => {
  const ov = overlay();
  const state = pcropState();
  for (const [x, y] of [
    [10, 90],
    [100, 5],
    [0, 0]
  ]) {
    click(ov, state, x, y);
  }
  assert.equal(state.perspectiveClicks.length, 3);
  assert.equal(state.perspectiveQuad, null);
  click(ov, state, 90, 100);
  assert.deepEqual(state.perspectiveQuad, [
    [0, 0],
    [100, 5],
    [90, 100],
    [10, 90]
  ]);
  assert.deepEqual(state.perspectiveClicks, []);
});

test('perspectiveOrdered matches perspective_crop_ui.rs ordered', () => {
  assert.deepEqual(
    perspectiveOrdered([
      [10, 90],
      [100, 5],
      [0, 0],
      [90, 100]
    ]),
    [
      [0, 0],
      [100, 5],
      [90, 100],
      [10, 90]
    ]
  );
});

test('a box drag after one click clears the clicks and makes the box', () => {
  const ov = overlay();
  const state = pcropState();
  click(ov, state, 30, 30);
  tool.onDown(null, ov, state, 20, 10);
  tool.onMove(null, ov, state, 120, 90);
  tool.onUp(null, ov, state, 120, 90);
  assert.deepEqual(state.perspectiveClicks, []);
  assert.deepEqual(state.perspectiveQuad, [
    [20, 10],
    [120, 10],
    [120, 90],
    [20, 90]
  ]);
});

test('cancel clears pending clicks', () => {
  const ov = overlay();
  const state = pcropState();
  click(ov, state, 30, 30);
  click(ov, state, 60, 30);
  tool.cancel(ov, state);
  assert.deepEqual(state.perspectiveClicks, []);
});
