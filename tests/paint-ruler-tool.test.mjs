// Ruler tool (PhotoCraft analysis_cmds.rs ruler_info, analysis_ui.rs pointer / draw_overlay /
// options_bar Tool::Ruler, ruler_drag_protractor_and_clear without the protractor).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions, rulerInfo } from '../paint/tools.js';
import { CROP_HANDLE_PX } from '../paint/crop-frame.js';

// A stub overlay context that records path points and ignores every other draw call.
function overlay(width = 200, height = 150) {
  const target = { canvas: { width, height }, lines: [], clears: 0 };
  target.lineTo = (x, y) => target.lines.push([x, y]);
  target.clearRect = () => target.clears++;
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => {}),
    set: (t, key, value) => ((t[key] = value), true)
  });
}

// A layer context that must never be read or written by the Ruler.
const ctx = new Proxy(
  {},
  {
    get: () => () => assert.fail('the ruler touched the layer context')
  }
);

function rulerState(extra = {}) {
  let changes = 0;
  const state = {
    toolOptions: defaultToolOptions(),
    zoom: 1,
    ruler: null,
    pushUndo: () => assert.fail('the ruler pushed undo'),
    onRulerChange: () => changes++,
    ...extra
  };
  return { state, changes: () => changes };
}

const tool = TOOLS.ruler;

function drag(ov, state, [x0, y0], [x1, y1], shift = false) {
  state.shiftKey = shift;
  tool.onDown(ctx, ov, state, x0, y0);
  tool.onMove(ctx, ov, state, x1, y1);
  tool.onUp(ctx, ov, state, x1, y1);
}

test('rulerInfo gives start, delta, counter-clockwise angle with y down, and length', () => {
  assert.deepEqual(rulerInfo({ start: [10, 10], end: [60, 10] }), {
    x: 10,
    y: 10,
    w: 50,
    h: 0,
    angle: 0,
    l1: 50,
    l2: null
  });
  // Up the screen (y decreasing) is a positive angle.
  assert.deepEqual(rulerInfo({ start: [0, 100], end: [30, 60] }), {
    x: 0,
    y: 100,
    w: 30,
    h: -40,
    angle: 53.1301,
    l1: 50,
    l2: null
  });
  // Down the screen is negative.
  assert.equal(rulerInfo({ start: [0, 0], end: [10, 10] }).angle, -45);
  // h = 0 makes −h = −0, so a leftward line reads −180, as atan2 does in PhotoCraft.
  assert.equal(rulerInfo({ start: [0, 0], end: [-10, 0] }).angle, -180);
  assert.equal(rulerInfo({ start: [0, 0], end: [-10, -1] }).angle, 174.2894);
  assert.equal(rulerInfo({ start: [0, 0], end: [-10, 1] }).angle, -174.2894);
  assert.equal(rulerInfo({ start: [0, 0], end: [1, 2] }).l1, 2.2361);
  assert.ok(Object.is(rulerInfo({ start: [5, 5], end: [5, 5] }).angle, 0), 'no −0');
});

test('TOOLS.ruler is labelled Ruler with the ruler icon, right after the eyedropper', () => {
  assert.equal(tool.label, 'Ruler');
  assert.equal(tool.icon, 'ruler');
  const ids = Object.keys(TOOLS);
  assert.equal(ids.indexOf('ruler'), ids.indexOf('eyedropper') + 1);
});

test('a drag draws a new ruler line and the overlay shows it with end crosses', () => {
  const ov = overlay();
  const { state, changes } = rulerState();
  drag(ov, state, [10, 20], [60, 20]);
  assert.deepEqual(state.ruler, { start: [10, 20], end: [60, 20] });
  assert.equal(state.drawing, false);
  assert.ok(changes() >= 3, 'readouts refresh on down, move and up');
  // The last draw: two passes (dark, then white), each the line plus two arms per end cross.
  const last = ov.lines.slice(-10);
  assert.deepEqual(last.slice(5), last.slice(0, 5));
  assert.deepEqual(last.slice(0, 5), [
    [60, 20],
    [15, 20],
    [10, 25],
    [65, 20],
    [60, 25]
  ]);
});

test('a press near the end or start drags only that end; elsewhere starts a new ruler', () => {
  const ov = overlay();
  const { state } = rulerState({ zoom: 2 });
  state.ruler = { start: [10, 10], end: [60, 10] };
  const reach = CROP_HANDLE_PX / 2;
  drag(ov, state, [60 + reach - 0.5, 10], [70, 40]);
  assert.deepEqual(state.ruler, { start: [10, 10], end: [70, 40] });
  drag(ov, state, [10, 10 + reach - 0.5], [0, 0]);
  assert.deepEqual(state.ruler, { start: [0, 0], end: [70, 40] });
  drag(ov, state, [100, 100], [120, 100]);
  assert.deepEqual(state.ruler, { start: [100, 100], end: [120, 100] });
});

test('Shift constrains the dragged end to 45° steps around the other end', () => {
  const ov = overlay();
  const { state } = rulerState();
  drag(ov, state, [0, 0], [100, 10], true);
  assert.deepEqual(state.ruler.start, [0, 0]);
  assert.ok(Math.abs(state.ruler.end[0] - Math.hypot(100, 10)) < 1e-9);
  assert.ok(Math.abs(state.ruler.end[1]) < 1e-9);
  // Dragging the start with Shift snaps it around the end.
  state.ruler = { start: [0, 0], end: [50, 50] };
  drag(ov, state, [0, 0], [10, 48], true);
  const [sx, sy] = state.ruler.start;
  assert.ok(Math.abs(sx - (50 - Math.hypot(40, 2))) < 1e-9);
  assert.ok(Math.abs(sy - 50) < 1e-9, 'level with the end');
  assert.deepEqual(state.ruler.end, [50, 50]);
});

test('a new ruler released shorter than 0.5 px clears the line', () => {
  const ov = overlay();
  const { state } = rulerState();
  state.ruler = { start: [10, 10], end: [60, 10] };
  drag(ov, state, [100, 100], [100.3, 100.2]);
  assert.equal(state.ruler, null);
  // Dragging an existing end onto the other one keeps the (zero-length) line.
  state.ruler = { start: [10, 10], end: [60, 10] };
  drag(ov, state, [60, 10], [10, 10]);
  assert.deepEqual(state.ruler, { start: [10, 10], end: [10, 10] });
});

test('the options bar reads X, Y, W, H, A, L1 and Clear is disabled without a ruler', () => {
  const schema = TOOL_OPTION_SCHEMA.ruler;
  const readouts = schema.filter((o) => o.type === 'readout');
  assert.deepEqual(
    readouts.map((o) => o.label),
    ['X:', 'Y:', 'W:', 'H:', 'A:', 'L1:', 'L2:']
  );
  const ruler = { start: [0, 100], end: [30, 60] };
  assert.deepEqual(
    readouts.map((o) => o.text({ ruler })),
    ['0.00', '100.00', '30.00', '-40.00', '53.13', '50.00', '']
  );
  assert.deepEqual(
    readouts.map((o) => o.text({ ruler: null })),
    ['', '', '', '', '', '', '']
  );
  assert.deepEqual(
    defaultToolOptions().ruler,
    { rulerUseScale: false },
    'readouts hold no option values; Use Measurement Scale is the one checkbox'
  );
  const clear = schema.find((o) => o.key === '_rulerClear');
  assert.equal(clear.label, 'Clear');
  assert.equal(clear.disabledWhen.key, 'ruler');
  assert.ok(clear.disabledWhen.values.includes(null));
});

test('Clear sets state.ruler to null and clears the overlay', () => {
  const ov = overlay();
  const { state } = rulerState();
  drag(ov, state, [10, 10], [60, 10]);
  const clear = TOOL_OPTION_SCHEMA.ruler.find((o) => o.key === '_rulerClear');
  const patch = clear.patch({ ruler: state.ruler });
  assert.equal(patch._rulerAction, 'clear');
  assert.equal(patch.ruler, null);
  // What paint.js refreshToolOptions does with '_rulerAction'.
  const before = ov.clears;
  tool.clear(ov, state);
  assert.equal(state.ruler, null);
  assert.equal(ov.clears, before + 1);
});
