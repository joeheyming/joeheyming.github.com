import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cropAngleReadout, cropFrameSize } from '../paint/crop-frame.js';
import { TOOLS, defaultToolOptions } from '../paint/tools.js';

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

// Press at the first point and move through the rest; returns the texts the last move drew.
function dragTo(state, pts) {
  const ov = overlay();
  TOOLS.crop.onDown(null, ov, state, ...pts[0]);
  for (const p of pts.slice(1)) {
    ov.texts.length = 0;
    TOOLS.crop.onMove(null, ov, state, ...p);
  }
  return ov.texts.map((t) => t.text);
}

test('cropFrameSize: rounded sides, at least 1 px, null when not finite (crop_ui.rs frame_size)', () => {
  assert.deepEqual(cropFrameSize([0, 0, 59.5, 40.6]), [60, 41]);
  assert.deepEqual(cropFrameSize([10, 5, 130.4, 45]), [120, 40]);
  assert.deepEqual(cropFrameSize([0, 0, 0.2, 0.4]), [1, 1]);
  assert.equal(cropFrameSize([NaN, 0, 1, 1]), null);
  assert.equal(cropFrameSize([-Number.MAX_VALUE, 0, Number.MAX_VALUE, 1]), null);
});

test('drawing a frame shows its W and H beside the pointer', () => {
  const state = cropState();
  state.cropFrame = null;
  const ov = overlay();
  TOOLS.crop.onDown(null, ov, state, 10, 10);
  TOOLS.crop.onMove(null, ov, state, 130, 50);
  assert.deepEqual(
    ov.texts.map((t) => t.text),
    ['W: 120 px', 'H: 40 px']
  );
  // Beside the pointer, the H row under the W row.
  assert.ok(ov.texts[0].x > 130 && ov.texts[0].y > 50);
  assert.ok(ov.texts[1].y > ov.texts[0].y);
  // After release the frame redraws without a readout.
  TOOLS.crop.onUp(null, ov, state, 130, 50);
  ov.texts.length = 0;
  TOOLS.crop.redraw(ov, state);
  assert.deepEqual(ov.texts, []);
});

test('the readout keeps a constant screen size at any zoom', () => {
  const state = cropState();
  state.zoom = 2;
  state.cropFrame = null;
  const ov = overlay();
  TOOLS.crop.onDown(null, ov, state, 10, 10);
  TOOLS.crop.onMove(null, ov, state, 130, 50);
  assert.equal(ov.font, '5.75px sans-serif');
  assert.equal(ov.texts[0].x, 137);
});

test('a draw that has not left its anchor shows no readout', () => {
  const state = cropState();
  assert.deepEqual(
    dragTo(state, [
      [40, 40],
      [40, 40]
    ]),
    []
  );
});

test('resizing shows the new size', () => {
  const state = cropState();
  const texts = dragTo(state, [
    [200, 50],
    [190, 50],
    [180, 50]
  ]);
  assert.deepEqual(texts, ['W: 180 px', 'H: 100 px']);
});

test('turning shows the Angle row', () => {
  const state = cropState();
  // Outside the frame, a sweep from the right of centre to straight below it.
  const texts = dragTo(state, [
    [250, 50],
    [100, 200]
  ]);
  assert.deepEqual(texts, [`Angle: ${cropAngleReadout(state.cropAngle)}`]);
  assert.match(texts[0], /^Angle: -?\d+\.\d°$/);
});

test('moving the frame shows no readout', () => {
  const state = cropState();
  state.cropFrame = [50, 25, 150, 75];
  assert.deepEqual(
    dragTo(state, [
      [100, 50],
      [110, 55]
    ]),
    []
  );
});
