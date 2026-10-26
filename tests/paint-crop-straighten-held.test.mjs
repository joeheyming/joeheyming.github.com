import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cropAngleReadout } from '../paint/crop-frame.js';
import { TOOLS, defaultToolOptions } from '../paint/tools.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const deg = (r) => (r * 180) / Math.PI;

// A stub overlay context that records fillText calls.
function overlay(width = 200, height = 100) {
  const target = { canvas: { width, height }, texts: [] };
  target.fillText = (text, x, y) => target.texts.push({ text, x, y });
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => {}),
    set: (t, key, value) => ((t[key] = value), true)
  });
}

function cropState() {
  const state = { toolOptions: defaultToolOptions(), zoom: 1 };
  TOOLS.crop.ensureFrame(overlay(), state, 200, 100, null);
  return state;
}

function drag(ov, state, pts) {
  const [first, last] = [pts[0], pts[pts.length - 1]];
  TOOLS.crop.onDown(null, ov, state, ...first);
  for (const p of pts.slice(1)) TOOLS.crop.onMove(null, ov, state, ...p);
  TOOLS.crop.onUp(null, ov, state, ...last);
}

test('cropAngleReadout: one decimal, never -0.0° or -180.0° (canvas::angle_readout)', () => {
  assert.equal(cropAngleReadout(-0.03), '0.0°');
  assert.equal(cropAngleReadout(-179.97), '180.0°');
  assert.equal(cropAngleReadout(12.34), '12.3°');
  assert.equal(cropAngleReadout(-12.36), '-12.4°');
});

test('a Ctrl/Cmd-drag outside the frame draws a straighten line, not a turn', () => {
  const ov = overlay();
  const state = cropState();
  state.ctrlKey = true;
  drag(ov, state, [
    [250, 60],
    [100, 30],
    [0, 0]
  ]);
  assert.ok(near(state.cropAngle, deg(Math.atan(60 / 250))), String(state.cropAngle));
  assert.equal(state.cropStraighten, false);
  assert.equal(state.cropStraightenLine, null);
  assert.ok(!state.cropDrag);
  assert.equal(state.drawing, false);
  assert.equal(state.cropDefault, false);
  // The frame is fitted inside the image, centred.
  const f = state.cropFrame;
  assert.ok(near((f[0] + f[2]) / 2, 100) && near((f[1] + f[3]) / 2, 50));
  assert.ok(f[2] - f[0] < 200);
});

test('the same drag without Ctrl/Cmd turns the frame instead', () => {
  const ov = overlay();
  const state = cropState();
  state.ctrlKey = false;
  TOOLS.crop.onDown(null, ov, state, 250, 60);
  assert.equal(state.cropStraightenLine, null);
  assert.equal(state.cropDrag.hit, 'turn');
  TOOLS.crop.onMove(null, ov, state, 0, 0);
  TOOLS.crop.onUp(null, ov, state, 0, 0);
  // Swept about the centre (100, 50) from (250, 60) to (0, 0).
  const swept = deg(Math.atan2(-50, -100) - Math.atan2(10, 150));
  assert.ok(near(state.cropAngle, swept > 180 ? swept - 360 : swept), String(state.cropAngle));
  assert.deepEqual(state.cropFrame, [0, 0, 200, 100]);
});

test('Ctrl/Cmd down during an existing crop drag does not start a line', () => {
  const ov = overlay();
  const state = cropState();
  TOOLS.crop.onDown(null, ov, state, 100, 50);
  const dragging = state.cropDrag;
  assert.equal(dragging.hit, 'inside');
  state.ctrlKey = true;
  TOOLS.crop.onDown(null, ov, state, 120, 50);
  assert.equal(state.cropStraightenLine, null);
  assert.ok(state.cropDrag);
});

test('a held-modifier line shows the Angle readout beside its end', () => {
  const ov = overlay();
  const state = cropState();
  state.ctrlKey = true;
  TOOLS.crop.onDown(null, ov, state, 250, 60);
  // Zero length: no readout.
  assert.deepEqual(ov.texts, []);
  TOOLS.crop.onMove(null, ov, state, 0, 0);
  const last = ov.texts[ov.texts.length - 1];
  assert.equal(last.text, `Angle: ${cropAngleReadout(deg(Math.atan2(60, -250)))}`);
  assert.equal(last.text, 'Angle: 166.5°');
  assert.ok(Math.hypot(last.x, last.y) < 40, 'beside the end at (0, 0)');
});

test('cursorAt is a crosshair while Ctrl/Cmd is held', () => {
  const state = cropState();
  state.ctrlKey = false;
  assert.notEqual(TOOLS.crop.cursorAt(state, 250, 60), 'crosshair');
  state.ctrlKey = true;
  assert.equal(TOOLS.crop.cursorAt(state, 250, 60), 'crosshair');
});
