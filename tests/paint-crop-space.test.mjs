import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TOOLS, defaultToolOptions } from '../paint/tools.js';

// A stub overlay context that ignores every draw call.
function overlay(width = 200, height = 100) {
  const target = { canvas: { width, height } };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => {}),
    set: (t, key, value) => ((t[key] = value), true)
  });
}

function cropState(ov) {
  const state = { toolOptions: defaultToolOptions(), zoom: 1 };
  TOOLS.crop.ensureFrame(ov, state, 200, 100, null);
  return state;
}

test('Space repositions the frame being drawn (space_repositions_the_frame_being_drawn)', () => {
  const ov = overlay();
  const state = cropState(ov);
  state.cropFrame = null;
  TOOLS.crop.onDown(null, ov, state, 10, 10);
  TOOLS.crop.onMove(null, ov, state, 50, 40);
  assert.deepEqual(state.cropFrame, [10, 10, 50, 40]);
  TOOLS.crop.setSpace(ov, state, true);
  assert.equal(state.cropSpace, true);
  TOOLS.crop.onMove(null, ov, state, 70, 50);
  assert.deepEqual(state.cropFrame, [30, 20, 70, 50], 'same size, moved');
  TOOLS.crop.setSpace(ov, state, false);
  TOOLS.crop.onMove(null, ov, state, 90, 60);
  TOOLS.crop.onUp(null, ov, state, 90, 60);
  assert.deepEqual(state.cropFrame, [30, 20, 90, 60], 'sizing resumes from the moved anchor');
  assert.ok(!state.cropDrag);
});

test('setSpace leaves the frame alone with no draw in progress', () => {
  const ov = overlay();
  const state = cropState(ov);
  const before = state.cropFrame.slice();
  TOOLS.crop.setSpace(ov, state, true);
  assert.equal(state.cropSpace, true);
  assert.deepEqual(state.cropFrame, before);
});

test('a move drag with Space held moves the frame normally', () => {
  const ov = overlay();
  const state = cropState(ov);
  state.cropFrame = [20, 20, 80, 60];
  state.cropDefault = false;
  TOOLS.crop.onDown(null, ov, state, 50, 40);
  assert.equal(state.cropDrag.hit, 'inside');
  TOOLS.crop.setSpace(ov, state, true);
  TOOLS.crop.onMove(null, ov, state, 60, 45);
  assert.deepEqual(state.cropFrame, [30, 25, 90, 65]);
  TOOLS.crop.onMove(null, ov, state, 70, 50);
  TOOLS.crop.onUp(null, ov, state, 70, 50);
  assert.deepEqual(state.cropFrame, [40, 30, 100, 70]);
  assert.equal(state.cropSpace, false, 'release clears Space');
});

test('paint.js routes Space to TOOLS.crop.setSpace during a crop draw', () => {
  const src = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  const down = src.indexOf("state.cropDrag?.hit === 'draw'");
  assert.ok(down > 0, 'keydown checks for a crop draw');
  const pan = src.indexOf("if (e.code === 'Space' && !state.spaceDown)");
  assert.ok(down < pan, 'the crop draw check runs before the hand-pan');
  assert.match(src.slice(down, pan), /TOOLS\.crop\.setSpace\(ov, state, true\)/);
  assert.match(src, /state\.cropSpace\) \{\s*TOOLS\.crop\.setSpace\(ov, state, false\)/);
});
