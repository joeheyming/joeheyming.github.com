// Ruler protractor (PhotoCraft analysis_cmds.rs ruler_info Some(protractor), analysis_ui.rs pointer
// Tool::Ruler mods.alt / RulerHandle(2), draw_overlay, ruler_drag_protractor_and_clear).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, rulerInfo } from '../paint/tools.js';
import { CROP_HANDLE_PX } from '../paint/crop-frame.js';

// A stub overlay context that records path points and ignores every other draw call.
function overlay(width = 200, height = 150) {
  const target = { canvas: { width, height }, moves: [], lines: [] };
  target.moveTo = (x, y) => target.moves.push([x, y]);
  target.lineTo = (x, y) => target.lines.push([x, y]);
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

const tool = TOOLS.ruler;

function rulerState(ruler) {
  return {
    zoom: 1,
    ruler,
    pushUndo: () => assert.fail('the ruler pushed undo'),
    onRulerChange: () => {}
  };
}

function drag(state, [x0, y0], [x1, y1], { alt = false, shift = false } = {}) {
  const ov = overlay();
  state.altKey = alt;
  state.shiftKey = shift;
  tool.onDown(ctx, ov, state, x0, y0);
  tool.onMove(ctx, ov, state, x1, y1);
  tool.onUp(ctx, ov, state, x1, y1);
  return ov;
}

test('rulerInfo with a protractor gives the angle between the arms and L2', () => {
  // A right angle: the main arm points right, the protractor arm straight up.
  assert.deepEqual(rulerInfo({ start: [10, 10], end: [40, 10], protractor: [10, -10] }), {
    x: 10,
    y: 10,
    w: 30,
    h: 0,
    angle: 90,
    l1: 30,
    l2: 20
  });
  // a1 = 135°, a2 = −135°: |a1 − a2| = 270 folds back to 90.
  const folded = rulerInfo({ start: [0, 0], end: [-10, -10], protractor: [-10, 10] });
  assert.equal(folded.angle, 90);
  assert.equal(folded.l2, 14.1421);
  // a1 = 170°, a2 = −150°: 320 folds to 40.
  const rad = (d) => (d * Math.PI) / 180;
  const at = (d) => [10 * Math.cos(rad(d)), -10 * Math.sin(rad(d))];
  assert.equal(rulerInfo({ start: [0, 0], end: at(170), protractor: at(-150) }).angle, 40);
  // An obtuse angle under 180 stays as is.
  assert.equal(rulerInfo({ start: [0, 0], end: [10, 0], protractor: [-10, -10] }).angle, 135);
  // No protractor: L2 is null and the angle is the line's direction.
  const plain = rulerInfo({ start: [0, 100], end: [30, 60] });
  assert.equal(plain.l2, null);
  assert.equal(plain.angle, 53.1301);
  assert.equal(plain.l1, 50);
});

test('the options bar adds an L2 readout after L1, blank without a protractor', () => {
  const readouts = TOOL_OPTION_SCHEMA.ruler.filter((o) => o.type === 'readout');
  assert.deepEqual(
    readouts.map((o) => o.label),
    ['X:', 'Y:', 'W:', 'H:', 'A:', 'L1:', 'L2:']
  );
  const l2 = readouts.at(-1);
  assert.equal(l2.text({ ruler: { start: [0, 0], end: [30, 0] } }), '');
  assert.equal(l2.text({ ruler: null }), '');
  assert.equal(l2.text({ ruler: { start: [0, 0], end: [30, 0], protractor: [0, 25] } }), '25.00');
});

test('Alt-drag from the start starts the protractor arm at the start', () => {
  const state = rulerState({ start: [10, 10], end: [60, 10] });
  drag(state, [11, 10], [10, 40], { alt: true });
  assert.deepEqual(state.ruler, { start: [10, 10], end: [60, 10], protractor: [10, 40] });
  assert.equal(state.drawing, false);
  assert.equal(rulerInfo(state.ruler).angle, 90);
});

test('Alt-drag from the end swaps start and end so the vertex is the start', () => {
  const state = rulerState({ start: [10, 10], end: [60, 10] });
  const reach = CROP_HANDLE_PX;
  drag(state, [60, 10 + reach - 0.5], [60, 50], { alt: true });
  assert.deepEqual(state.ruler, { start: [60, 10], end: [10, 10], protractor: [60, 50] });
  // Alt away from both ends draws a new ruler with no protractor.
  drag(state, [150, 100], [170, 100], { alt: true });
  assert.deepEqual(state.ruler, { start: [150, 100], end: [170, 100] });
});

test('a press near the protractor end drags it, checked before the end and start', () => {
  // The protractor end sits on the main end: the press drags the protractor.
  const state = rulerState({ start: [10, 10], end: [60, 10], protractor: [60, 10] });
  drag(state, [60, 10], [10, 60]);
  assert.deepEqual(state.ruler, { start: [10, 10], end: [60, 10], protractor: [10, 60] });
  // Dragging the main end keeps the protractor.
  drag(state, [60, 10], [70, 10]);
  assert.deepEqual(state.ruler, { start: [10, 10], end: [70, 10], protractor: [10, 60] });
  // Dragging the start (the vertex) keeps the protractor too.
  drag(state, [10, 10], [12, 12]);
  assert.deepEqual(state.ruler, { start: [12, 12], end: [70, 10], protractor: [10, 60] });
});

test('Shift snaps the protractor arm to 45° around the vertex', () => {
  const state = rulerState({ start: [0, 0], end: [50, 0] });
  drag(state, [0, 0], [30, 28], { alt: true, shift: true });
  const [px, py] = state.ruler.protractor;
  const l = Math.hypot(30, 28);
  assert.ok(Math.abs(px - l / Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(py - l / Math.SQRT2) < 1e-9);
  assert.equal(rulerInfo(state.ruler).angle, 45);
});

test('a new ruler drops the protractor', () => {
  const state = rulerState({ start: [10, 10], end: [60, 10], protractor: [10, 60] });
  drag(state, [120, 120], [150, 120]);
  assert.deepEqual(state.ruler, { start: [120, 120], end: [150, 120] });
  assert.equal(rulerInfo(state.ruler).l2, null);
});

test('the overlay draws the protractor arm like the main line, with an end cross', () => {
  const state = rulerState({ start: [10, 10], end: [60, 10], protractor: [10, 60] });
  const ov = overlay();
  tool.overlay(ov, state);
  // Two passes (dark, then white): two arms from the start, then three end crosses.
  const pass = (list) => list.slice(0, list.length / 2);
  assert.deepEqual(pass(ov.moves), ov.moves.slice(ov.moves.length / 2));
  assert.deepEqual(pass(ov.lines), ov.lines.slice(ov.lines.length / 2));
  assert.deepEqual(pass(ov.lines).slice(0, 2), [
    [60, 10],
    [10, 60]
  ]);
  assert.deepEqual(pass(ov.moves).slice(0, 2), [
    [10, 10],
    [10, 10]
  ]);
  // Crosses: start, end, protractor end (two strokes each).
  assert.equal(pass(ov.lines).length, 2 + 3 * 2);
  assert.deepEqual(pass(ov.lines).slice(-2), [
    [15, 60],
    [10, 65]
  ]);
});
