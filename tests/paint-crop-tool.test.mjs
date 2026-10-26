import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_HANDLE_PX,
  CROP_TURN_CURSOR,
  cropClamp,
  cropDraw,
  cropDrag,
  cropHit
} from '../paint/crop-frame.js';
import { TOOLS, TOOL_OPTION_SCHEMA } from '../paint/tools.js';
import { ICONS } from '../paint/icons.js';

const R = [10, 10, 110, 60];

test('crop tool follows the marquee, lasso, and wand tools with the crop icon', () => {
  const ids = Object.keys(TOOLS);
  assert.equal(TOOLS.crop.label, 'Crop');
  assert.equal(TOOLS.crop.icon, 'crop');
  assert.ok(Object.hasOwn(ICONS, 'crop'));
  for (const id of ['rectSelect', 'ellipseSelect', 'lasso', 'polyLasso', 'magicWand']) {
    assert.ok(ids.indexOf(id) < ids.indexOf('crop'), `${id} comes before crop`);
  }
});

test('crop options end with Commit (check) and Cancel (x) icon actions, no hint', () => {
  const schema = TOOL_OPTION_SCHEMA.crop;
  assert.ok(!schema.some((o) => o.type === 'hint'));
  // The ratio swap (US-145) and Straighten (US-152) are the other iconActions.
  const others = ['_cropSwap', '_cropStraighten'];
  const actions = schema.filter((o) => o.type === 'iconAction' && !others.includes(o.key));
  assert.deepEqual(
    actions.map((o) => o.icon),
    ['check', 'x']
  );
  // Both also disarm Straighten so the re-rendered bar shows it off.
  assert.deepEqual(actions[0].patch({}), { _cropAction: 'commit', cropStraighten: false });
  assert.deepEqual(actions[1].patch({}), { _cropAction: 'cancel', cropStraighten: false });
  for (const a of actions) assert.ok(Object.hasOwn(ICONS, a.icon));
});

test('cropHit finds corners, edges, inside, and outside (crop_ui.rs cases)', () => {
  assert.equal(CROP_HANDLE_PX, 8);
  assert.equal(cropHit(R, 10, 10, 4), 'nw');
  assert.equal(cropHit(R, 112, 61, 4), 'se');
  assert.equal(cropHit(R, 110, 10, 4), 'ne');
  assert.equal(cropHit(R, 10, 60, 4), 'sw');
  assert.equal(cropHit(R, 60, 8, 4), 'n');
  assert.equal(cropHit(R, 60, 62, 4), 's');
  assert.equal(cropHit(R, 108, 30, 4), 'e');
  assert.equal(cropHit(R, 7, 30, 4), 'w');
  assert.equal(cropHit(R, 60, 30, 4), 'inside');
  assert.equal(cropHit(R, 150, 30, 4), 'outside');
  assert.equal(cropHit(R, 60, 100, 4), 'outside');
  // A tiny frame keeps a movable middle.
  assert.equal(cropHit([0, 0, 4, 4], 2, 2, 8), 'inside');
});

test('cropDrag inside moves the frame', () => {
  assert.deepEqual(cropDrag(R, 'inside', 20, -5), [30, 5, 130, 55]);
});

test('cropDrag on an edge resizes only that side', () => {
  assert.deepEqual(cropDrag(R, 'e', 15, 99), [10, 10, 125, 60]);
  assert.deepEqual(cropDrag(R, 'n', 99, -10), [10, 0, 110, 60]);
  assert.deepEqual(cropDrag(R, 'w', 20, 0), [30, 10, 110, 60]);
  assert.deepEqual(cropDrag(R, 's', 0, 10), [10, 10, 110, 70]);
});

test('cropDrag on a corner resizes both sides from the opposite corner', () => {
  assert.deepEqual(cropDrag(R, 'se', 10, 20), [10, 10, 120, 80]);
  assert.deepEqual(cropDrag(R, 'nw', -10, 5), [0, 15, 110, 60]);
});

test('cropDrag dragged past the opposite edge flips the frame', () => {
  assert.deepEqual(cropDrag(R, 'e', -120, 0), [-10, 10, 10, 60]);
});

test('cropDrag with Shift keeps the frame aspect', () => {
  // 100 x 50, ratio 2. A corner: the larger relative extent wins.
  assert.deepEqual(cropDrag(R, 'se', 100, 10, { shift: true }), [10, 10, 210, 110]);
  assert.deepEqual(cropDrag(R, 'se', 0, 50, { shift: true }), [10, 10, 210, 110]);
  // An edge: the other axis follows about its centre.
  assert.deepEqual(cropDrag(R, 'e', 100, 0, { shift: true }), [10, -15, 210, 85]);
});

test('cropDrag with Alt resizes about the centre', () => {
  assert.deepEqual(cropDrag(R, 'e', 10, 0, { alt: true }), [0, 10, 120, 60]);
  assert.deepEqual(cropDrag(R, 'se', 10, 5, { alt: true }), [0, 5, 120, 65]);
  // Shift + Alt: aspect kept, about the centre.
  assert.deepEqual(cropDrag(R, 'se', 50, 0, { shift: true, alt: true }), [-40, -15, 160, 85]);
});

test('cropDrag keeps a 1 px minimum side', () => {
  assert.deepEqual(cropDrag(R, 'e', -100, 0), [10, 10, 11, 60]);
  assert.deepEqual(cropDrag(R, 'n', 0, 50), [10, 59, 110, 60]);
  const centred = cropDrag(R, 'e', -50, 0, { alt: true });
  assert.deepEqual(centred, [59.5, 10, 60.5, 60]);
  const corner = cropDrag(R, 'se', -100, -50);
  assert.deepEqual(corner, [10, 10, 11, 11]);
});

test('cropDrag outside leaves the frame (turning is a later story)', () => {
  assert.deepEqual(cropDrag(R, 'outside', 30, 30), R);
});

test('cropDraw normalizes, Shift squares, and Alt draws from the centre', () => {
  assert.deepEqual(cropDraw(50, 40, 10, 20), [10, 20, 50, 40]);
  assert.deepEqual(cropDraw(10, 10, 40, 20, { shift: true }), [10, 10, 40, 40]);
  assert.deepEqual(cropDraw(40, 40, 30, 10, { shift: true }), [10, 10, 40, 40]);
  assert.deepEqual(cropDraw(50, 50, 60, 70, { alt: true }), [40, 30, 60, 70]);
  assert.deepEqual(cropDraw(50, 50, 60, 55, { shift: true, alt: true }), [40, 40, 60, 60]);
});

test('cropClamp rounds to whole pixels and clamps to the canvas', () => {
  assert.deepEqual(cropClamp([10.4, 9.6, 50.5, 40.2], 100, 80), { x: 10, y: 10, w: 41, h: 30 });
  assert.deepEqual(cropClamp([-20, -5, 60, 200], 100, 80), { x: 0, y: 0, w: 60, h: 80 });
  assert.deepEqual(cropClamp([90, 70, 150, 120], 100, 80), { x: 90, y: 70, w: 10, h: 10 });
  assert.equal(cropClamp([120, 10, 150, 40], 100, 80), null);
  assert.equal(cropClamp([10, 10, 10.2, 40], 100, 80), null);
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

test('crop tool drag draws, moves, and a click keeps the frame', () => {
  const { ov, calls } = fakeOverlay();
  const state = { zoom: 1, toolOptions: {} };
  const t = TOOLS.crop;
  t.onDown(null, ov, state, 20, 20);
  t.onMove(null, ov, state, 60, 50);
  t.onUp(null, ov, state, 80, 60);
  assert.deepEqual(state.cropFrame, [20, 20, 80, 60]);
  assert.equal(state.drawing, false);
  assert.ok(
    calls.some(([k, rule]) => k === 'fill' && rule === 'evenodd'),
    'shades outside'
  );
  // Inside: moved, not redrawn.
  t.onDown(null, ov, state, 50, 40);
  t.onUp(null, ov, state, 70, 50);
  assert.deepEqual(state.cropFrame, [40, 30, 100, 70]);
  // A click outside keeps the frame.
  t.onDown(null, ov, state, 150, 90);
  t.onUp(null, ov, state, 150, 90);
  assert.deepEqual(state.cropFrame, [40, 30, 100, 70]);
  // A drag outside turns it (paint-crop-turn.test.mjs); the frame itself stays.
  t.onDown(null, ov, state, 150, 90);
  t.onUp(null, ov, state, 120, 80);
  assert.deepEqual(state.cropFrame, [40, 30, 100, 70]);
  assert.notEqual(state.cropAngle, 0);
  t.cancel(ov, state);
  assert.equal(state.cropFrame, null);
  assert.equal(state.cropAngle, 0);
});

test('crop tool handle reach scales with the zoom', () => {
  const state = { zoom: 4, cropFrame: [10, 10, 110, 60] };
  assert.equal(TOOLS.crop.cursorAt(state, 112, 30), 'e-resize');
  assert.equal(TOOLS.crop.cursorAt(state, 113, 30), CROP_TURN_CURSOR);
  assert.equal(TOOLS.crop.cursorAt(state, 60, 30), 'move');
  assert.equal(TOOLS.crop.cursorAt({ zoom: 1 }, 60, 30), 'crosshair');
});
