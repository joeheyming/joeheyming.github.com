import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_TURN_CURSOR,
  cropCorners,
  cropCursor,
  cropHitTurned,
  cropNormalizedAngle,
  cropResizedTurned,
  cropTurnedAngle,
  drawCropOverlay
} from '../paint/crop-frame.js';
import { turnedCropImageData } from '../paint/transform.js';
import { TOOLS } from '../paint/tools.js';

const R = [10, 10, 110, 60]; // centre (60, 35), 100 x 50
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearPt = (p, q, eps = 1e-9) => near(p[0], q[0], eps) && near(p[1], q[1], eps);

test('cropNormalizedAngle wraps into (-180, 180] and zeroes non-finite angles', () => {
  assert.equal(cropNormalizedAngle(0), 0);
  assert.equal(cropNormalizedAngle(180), 180);
  assert.equal(cropNormalizedAngle(-180), 180);
  assert.equal(cropNormalizedAngle(190), -170);
  assert.equal(cropNormalizedAngle(-190), 170);
  assert.equal(cropNormalizedAngle(725), 5);
  assert.equal(cropNormalizedAngle(-360), 0);
  assert.equal(cropNormalizedAngle(NaN), 0);
  assert.equal(cropNormalizedAngle(Infinity), 0);
});

test('cropTurnedAngle follows the sweep about the centre; snap rounds to 15°', () => {
  // Grabbed due east of (0, 0), now due south (y down): a quarter turn clockwise.
  assert.ok(near(cropTurnedAngle(0, 0, 0, 0, 0, 10, false), 90));
  // From 10° plus a sweep of atan(1/10) ≈ 5.71°.
  const swept = (Math.atan2(1, 10) * 180) / Math.PI;
  assert.ok(near(cropTurnedAngle(0, 0, 0, 10, 10, 1, false), 10 + swept));
  assert.equal(cropTurnedAngle(0, 0, 0, 10, 10, 1, true), 15);
  // 170° plus a quarter turn wraps to -100°.
  assert.ok(near(cropTurnedAngle(0, 0, 0, 170, 0, 10, false), -100));
  assert.equal(cropTurnedAngle(0, 0, 0, 3, 10, 0.5, true), 0);
});

test('cropCorners turns the four corners about the centre', () => {
  const c = cropCorners(R, 90);
  // Top-left (10, 10) is (-50, -25) from the centre; a quarter turn clockwise puts it at (25, -50).
  assert.ok(nearPt(c[0], [85, -15]));
  assert.ok(nearPt(c[1], [85, 85]));
  assert.ok(nearPt(c[2], [35, 85]));
  assert.ok(nearPt(c[3], [35, -15]));
  assert.deepEqual(cropCorners(R, 0), [
    [10, 10],
    [110, 10],
    [110, 60],
    [10, 60]
  ]);
});

test('cropHitTurned hits in the frame’s own axes: a turned corner, an edge, inside, outside', () => {
  const [tl, tr, br] = cropCorners(R, 30);
  assert.equal(cropHitTurned(R, 30, tl[0], tl[1], 4), 'nw');
  assert.equal(cropHitTurned(R, 30, tr[0], tr[1], 4), 'ne');
  assert.equal(cropHitTurned(R, 30, br[0], br[1], 4), 'se');
  // The midpoint of the turned top edge.
  assert.equal(cropHitTurned(R, 30, (tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2, 4), 'n');
  assert.equal(cropHitTurned(R, 30, 60, 35, 4), 'inside');
  // The upright top-left corner is outside the turned frame.
  assert.equal(cropHitTurned(R, 30, 10, 10, 4), 'outside');
  assert.equal(cropHitTurned(R, 0, 10, 10, 4), 'nw');
});

test('cropResizedTurned moves the handle along the frame’s axes; the opposite corner stays', () => {
  const deg = 30;
  const before = cropCorners(R, deg);
  // Drag the se handle 20 px along the frame's own x axis (turned on screen).
  const r = (deg * Math.PI) / 180;
  const n = cropResizedTurned(R, deg, 'se', 20 * Math.cos(r), 20 * Math.sin(r));
  assert.ok(near(n[2] - n[0], 120, 1e-9), 'width grew by 20');
  assert.ok(near(n[3] - n[1], 50, 1e-9), 'height unchanged');
  const after = cropCorners(n, deg);
  assert.ok(nearPt(after[0], before[0], 1e-9), 'nw corner fixed on screen');
  // The se corner followed the pointer.
  assert.ok(nearPt(after[2], [before[2][0] + 20 * Math.cos(r), before[2][1] + 20 * Math.sin(r)]));
  // A side handle: n moved 10 px outward along the frame's -y axis keeps the s edge's corners.
  const m = cropResizedTurned(R, deg, 'n', 10 * Math.sin(r), -10 * Math.cos(r));
  assert.ok(near(m[3] - m[1], 60));
  const mc = cropCorners(m, deg);
  assert.ok(nearPt(mc[2], before[2], 1e-9) && nearPt(mc[3], before[3], 1e-9));
  // Inside moves; deg 0 is the upright drag.
  assert.deepEqual(cropResizedTurned(R, deg, 'inside', 5, 6), [15, 16, 115, 66]);
  assert.deepEqual(cropResizedTurned(R, 0, 'se', 5, 6), [10, 10, 115, 66]);
});

test('cropCursor reads as a turn outside a pending frame and turns resize arrows', () => {
  assert.equal(cropCursor('outside', true), CROP_TURN_CURSOR);
  assert.equal(cropCursor('outside', false), 'crosshair');
  assert.ok(CROP_TURN_CURSOR.startsWith('url("data:image/svg+xml,'));
  assert.equal(cropCursor('e', true, 90), 's-resize');
  assert.equal(cropCursor('n', true, 45), 'ne-resize');
  assert.equal(cropCursor('se', true, 0), 'se-resize');
});

function fakeOverlay() {
  const calls = [];
  const ov = new Proxy(
    { canvas: { width: 200, height: 100 } },
    {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => calls.push([key, ...args]);
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      }
    }
  );
  return { ov, calls };
}

test('a drag outside the frame turns it about its centre; Shift snaps; a new frame is upright', () => {
  const { ov } = fakeOverlay();
  const state = { zoom: 1, toolOptions: {}, cropFrame: [...R], cropAngle: 0 };
  const t = TOOLS.crop;
  // Grab due east of the centre (60, 35), release due south: +90°.
  t.onDown(null, ov, state, 160, 35);
  t.onMove(null, ov, state, 130, 105);
  t.onUp(null, ov, state, 60, 135);
  assert.deepEqual(state.cropFrame, R);
  assert.ok(near(state.cropAngle, 90));
  assert.equal(state.drawing, false);
  // Inside the turned frame moves it, keeping the angle.
  t.onDown(null, ov, state, 60, 35);
  t.onUp(null, ov, state, 65, 35);
  assert.deepEqual(state.cropFrame, [15, 10, 115, 60]);
  assert.ok(near(state.cropAngle, 90));
  // Shift snaps the turn to 15° steps.
  state.shiftKey = true;
  t.onDown(null, ov, state, 165, 35);
  t.onUp(null, ov, state, 165, 45);
  assert.equal(state.cropAngle, 90);
  state.shiftKey = false;
  // Cancel resets; a new frame starts at 0°.
  t.cancel(ov, state);
  assert.equal(state.cropAngle, 0);
  state.cropAngle = 40;
  t.onDown(null, ov, state, 20, 20);
  t.onUp(null, ov, state, 60, 50);
  assert.deepEqual(state.cropFrame, [20, 20, 60, 50]);
  assert.equal(state.cropAngle, 0);
});

test('the overlay shades outside the turned frame and draws handles in its axes', () => {
  const { ov, calls } = fakeOverlay();
  drawCropOverlay(ov, R, 1, 90);
  const corners = cropCorners(R, 90);
  const moveTo = calls.find(([k]) => k === 'moveTo');
  assert.ok(nearPt(moveTo.slice(1), corners[0]));
  const lines = calls.filter(([k]) => k === 'lineTo').map((c) => c.slice(1));
  assert.equal(lines.length, 3);
  lines.forEach((p, i) => assert.ok(nearPt(p, corners[i + 1])));
  assert.ok(calls.some(([k, rule]) => k === 'fill' && rule === 'evenodd'));
  const rot = calls.find(([k]) => k === 'rotate');
  assert.ok(rot && near(rot[1], Math.PI / 2), 'handles drawn in the turned axes');
  // Upright: no rotation.
  const up = fakeOverlay();
  drawCropOverlay(up.ov, R, 1, 0);
  assert.ok(!up.calls.some(([k]) => k === 'rotate'));
});

/** A W x H RGBA image where pixel (x, y) is [x * 10, y * 10, 7, 255]. */
function ramp(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set([x * 10, y * 10, 7, 255], (y * W + x) * 4);
  }
  return { width: W, height: H, data };
}

const px = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test('a turned crop is the frame’s size and samples the turned frame', () => {
  const img = ramp(10, 8);
  // A 4 x 2 frame centred at (5, 4), turned 90° clockwise.
  const out = turnedCropImageData(img, [3, 3, 7, 5], 90);
  assert.equal(out.width, 4);
  assert.equal(out.height, 2);
  // Output (0, 0) is (-1.5, -0.5) from the centre; turned 90° that is (+0.5, -1.5), the centre
  // of source pixel (5, 2).
  assert.deepEqual(px(out, 0, 0), [50, 20, 7, 255]);
  // Output (3, 1): (1.5, 0.5) → (-0.5, 1.5), source pixel (4, 5).
  assert.deepEqual(px(out, 3, 1), [40, 50, 7, 255]);
  // Bilinear at 45°: the output centre sits on the frame centre, between four source pixels.
  const mid = turnedCropImageData(img, [4, 3, 6, 5], 45);
  assert.equal(mid.width, 2);
  assert.equal(mid.height, 2);
  for (const v of mid.data.filter((_, i) => i % 4 === 3)) assert.equal(v, 255);
});

test('a turned crop is transparent where the image does not reach; fill goes under', () => {
  const img = ramp(4, 4);
  // A frame larger than the image, turned 45°: its corners lie off the image.
  const out = turnedCropImageData(img, [-4, -4, 8, 8], 45);
  assert.equal(out.width, 12);
  assert.deepEqual(px(out, 0, 0), [0, 0, 0, 0]);
  assert.equal(px(out, 6, 6)[3], 255);
  const filled = turnedCropImageData(img, [-4, -4, 8, 8], 45, [255, 255, 255, 255]);
  assert.deepEqual(px(filled, 0, 0), [255, 255, 255, 255]);
});
