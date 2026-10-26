import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_STRAIGHTEN_MIN_PX,
  cropCorners,
  cropStraightenAngle,
  cropStraightenFitted
} from '../paint/crop-frame.js';
import { ICONS } from '../paint/icons.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const deg = (r) => (r * 180) / Math.PI;

// Every corner of frame r turned d degrees lies inside the w x h canvas.
function inside(r, d, w, h) {
  return cropCorners(r, d).every(
    ([x, y]) => x >= -1e-6 && y >= -1e-6 && x <= w + 1e-6 && y <= h + 1e-6
  );
}

function overlay(width = 200, height = 100) {
  const target = { canvas: { width, height } };
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

test('cropStraightenAngle levels a horizon (crop_straighten.rs frame_angle)', () => {
  const d = (10 * Math.PI) / 180;
  // Falling 10° to the right: the frame turns 10° clockwise.
  assert.ok(near(cropStraightenAngle([0, 0], [100 * Math.cos(d), 100 * Math.sin(d)], 1), 10));
  // Rising to the right: counter-clockwise; drawn right to left it is the same line.
  const want = -deg(Math.atan(10 / 100));
  assert.ok(near(cropStraightenAngle([0, 50], [100, 40], 1), want));
  assert.ok(near(cropStraightenAngle([100, 40], [0, 50], 1), want));
  // Level and plumb lines need no turn (and never -0).
  assert.ok(Object.is(cropStraightenAngle([0, 0], [40, 0], 1), 0));
  assert.ok(Object.is(cropStraightenAngle([0, 0], [0, 40], 1), 0));
});

test('cropStraightenAngle makes a nearly vertical line plumb', () => {
  const tan5 = Math.tan((5 * Math.PI) / 180);
  assert.ok(near(cropStraightenAngle([50, 0], [50 + 100 * tan5, 100], 1), -5));
  // Falling 60° is nearer vertical: turned 30° counter-clockwise to plumb, not 60° to level.
  const t60 = Math.tan((60 * Math.PI) / 180);
  assert.ok(near(cropStraightenAngle([0, 0], [10, 10 * t60], 1), -30));
});

test('cropStraightenAngle is null for short, zero-length, or non-finite lines', () => {
  assert.equal(CROP_STRAIGHTEN_MIN_PX, 3);
  assert.equal(cropStraightenAngle([5, 5], [5, 5], 0), null);
  assert.equal(cropStraightenAngle([5, 5], [6, 6], 3), null);
  assert.equal(cropStraightenAngle([NaN, 0], [10, 0], 1), null);
  assert.equal(cropStraightenAngle([0, 0], [Infinity, 1], 1), null);
});

test('cropStraightenFitted: upright, the canvas proportions fill the canvas', () => {
  assert.deepEqual(cropStraightenFitted(200, 100, 200, 100, 0), [0, 0, 200, 100]);
});

test('cropStraightenFitted: the largest frame of its proportions inside the canvas', () => {
  for (const d of [-45, -10, 3, 10, 30, 45, 90]) {
    const r = cropStraightenFitted(200, 100, 200, 100, d);
    assert.ok(inside(r, d, 200, 100), `${d}: ${r}`);
    assert.ok(near((r[2] - r[0]) / (r[3] - r[1]), 2), `keeps 2:1 at ${d}`);
    assert.ok(near((r[0] + r[2]) / 2, 100) && near((r[1] + r[3]) / 2, 50), `centred at ${d}`);
    // 1 % larger would leave the canvas.
    const [cx, cy] = [100, 50];
    const g = [
      cx - (cx - r[0]) * 1.01,
      cy - (cy - r[1]) * 1.01,
      cx + (r[2] - cx) * 1.01,
      cy + (r[3] - cy) * 1.01
    ];
    assert.ok(!inside(g, d, 200, 100), `${d}: not the largest`);
  }
  // 90°: the 2:1 frame stands on its side, so its long side is the canvas height.
  const r90 = cropStraightenFitted(200, 100, 200, 100, 90);
  assert.ok(near(r90[2] - r90[0], 100, 1e-6) && near(r90[3] - r90[1], 50, 1e-6));
  // 45°: k = min(200 / (150√2), 100 / (150√2)).
  const r45 = cropStraightenFitted(200, 100, 200, 100, 45);
  assert.ok(near(r45[2] - r45[0], (200 * 100) / (150 * Math.SQRT2), 1e-9));
});

test('cropStraightenFitted is null for invalid sizes', () => {
  for (const bad of [
    [0, 1, 1, 1, 0],
    [1, -1, 1, 1, 0],
    [1, 1, 0, 1, 0],
    [1, 1, 1, -2, 0],
    [1, 1, 1, 1, NaN],
    [Infinity, 1, 1, 1, 0]
  ]) {
    assert.equal(cropStraightenFitted(...bad), null, String(bad));
  }
});

test('the Crop options bar has a Straighten ruler iconAction that toggles cropStraighten', () => {
  const field = TOOL_OPTION_SCHEMA.crop.find((o) => o.key === '_cropStraighten');
  assert.ok(field);
  assert.equal(field.type, 'iconAction');
  assert.equal(field.icon, 'ruler');
  assert.ok(Object.hasOwn(ICONS, 'ruler'));
  assert.equal(field.pressedKey, 'cropStraighten');
  assert.deepEqual(field.patch({ cropStraighten: false }), { cropStraighten: true });
  assert.deepEqual(field.patch({ cropStraighten: true }), { cropStraighten: false });
  assert.ok(!('_cropStraighten' in defaultToolOptions().crop));
});

test('setStraighten arms and disarms; cancel (Escape) drops it', () => {
  const ov = overlay();
  const state = cropState();
  TOOLS.crop.setStraighten(ov, state, true);
  assert.equal(state.cropStraighten, true);
  assert.equal(TOOLS.crop.cursorAt(state, 100, 50), 'crosshair');
  TOOLS.crop.setStraighten(ov, state, false);
  assert.equal(state.cropStraighten, false);
  TOOLS.crop.setStraighten(ov, state, true);
  TOOLS.crop.cancel(ov, state);
  assert.equal(state.cropStraighten, false);
});

test('an armed drag through TOOLS.crop turns and fits the frame, then disarms', () => {
  const ov = overlay();
  const state = cropState();
  let refreshed = 0;
  state.onCropStraighten = () => refreshed++;
  assert.ok(state.cropDefault);
  TOOLS.crop.setStraighten(ov, state, true);
  TOOLS.crop.onDown(null, ov, state, 20, 40);
  TOOLS.crop.onMove(null, ov, state, 100, 50);
  assert.deepEqual(state.cropStraightenLine, [
    [20, 40],
    [100, 50]
  ]);
  // Drawing the line never edits the frame.
  assert.deepEqual(state.cropFrame, [0, 0, 200, 100]);
  assert.equal(state.cropDrag ?? null, null);
  TOOLS.crop.onUp(null, ov, state, 180, 60);
  const want = deg(Math.atan(20 / 160));
  assert.ok(near(state.cropAngle, want), String(state.cropAngle));
  const r = state.cropFrame;
  assert.deepEqual(r, cropStraightenFitted(200, 100, 200, 100, want));
  assert.ok(inside(r, want, 200, 100));
  assert.equal(state.cropDefault, false, 'a pending edit Enter commits');
  assert.equal(state.cropStraighten, false, 'one-shot');
  assert.equal(state.cropStraightenLine, null);
  assert.equal(state.drawing, false);
  assert.equal(refreshed, 1);
  // The next drag inside the frame moves it again, at the same angle.
  const before = state.cropFrame.slice();
  drag(ov, state, [
    [100, 50],
    [105, 50]
  ]);
  assert.ok(near(state.cropFrame[0] - before[0], 5) && near(state.cropAngle, want));
});

test('an armed line shorter than 3 screen px only disarms', () => {
  const ov = overlay();
  const state = cropState();
  state.zoom = 2;
  TOOLS.crop.setStraighten(ov, state, true);
  // 2.24 screen px at zoom 2.
  drag(ov, state, [
    [50, 50],
    [51, 50.5]
  ]);
  assert.equal(state.cropStraighten, false);
  assert.equal(state.cropAngle, 0);
  assert.deepEqual(state.cropFrame, [0, 0, 200, 100]);
  assert.equal(state.cropDefault, true, 'the untouched frame stays the default');
  // A level line leaves the default frame as it is.
  TOOLS.crop.setStraighten(ov, state, true);
  drag(ov, state, [
    [10, 50],
    [190, 50]
  ]);
  assert.deepEqual(state.cropFrame, [0, 0, 200, 100]);
  assert.equal(state.cropDefault, true);
});
