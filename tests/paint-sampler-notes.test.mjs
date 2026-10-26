// Color Sampler and Note tools (PhotoCraft analysis_ui.rs Tool::ColorSampler / Tool::Note,
// engine sampler_cmds.rs, sample_cmds.rs average, notes_cmds.rs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_GROUPS, TOOL_OPTION_SCHEMA, toolForKey } from '../paint/tools.js';
import {
  MAX_SAMPLERS,
  addSampler,
  moveSampler,
  nearestSampler,
  normalizeSamplers,
  removeSampler,
  sampleAverage,
  samplerReadouts
} from '../paint/samplers.js';
import { NOTE_COLOR, addNote, noteAt, normalizeNotes, setNote } from '../paint/notes.js';
import { ICONS } from '../paint/icons.js';
import { deserializeProject, serializeProject } from '../paint/project.js';

function fakeOverlay(W = 20, H = 20) {
  const noop = () => {};
  return {
    canvas: { width: W, height: H },
    save: noop,
    restore: noop,
    clearRect: noop,
    beginPath: noop,
    arc: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop
  };
}

// A W × H opaque image whose pixel (x, y) is f(x, y) → [r, g, b] (alpha 255 unless f gives 4).
function image(W, H, f) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b, a = 255] = f(x, y);
      data.set([r, g, b, a], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}

test('Color Sampler holds at most 10 points, on whole pixels inside the canvas', () => {
  let pts = [];
  for (let i = 0; i < 12; i++) pts = addSampler(pts, i + 0.7, 2.2, 20, 20);
  assert.equal(MAX_SAMPLERS, 10);
  assert.equal(pts.length, 10);
  assert.deepEqual(pts[0], [0, 2]);
  assert.deepEqual(pts[9], [9, 2]);
  // An 11th point is refused; so is a point off the canvas.
  assert.equal(addSampler(pts, 15, 15, 20, 20), pts);
  assert.deepEqual(addSampler([], -1, 3, 20, 20), []);
  assert.deepEqual(addSampler([], 20, 3, 20, 20), []);
  // Removing renumbers; moving off-canvas removes that point.
  assert.deepEqual(removeSampler(pts, 0)[0], [1, 2]);
  assert.deepEqual(moveSampler(pts, 1, 5.5, 6.5, 20, 20)[1], [5, 6]);
  assert.equal(moveSampler(pts, 1, 30, 6, 20, 20).length, 9);
  assert.equal(nearestSampler(pts, 3.5, 2.5, 2), 3);
  assert.equal(nearestSampler(pts, 3.5, 12, 2), -1);
  // Older files have none; a file with too many keeps the first ten.
  assert.deepEqual(normalizeSamplers(undefined), []);
  const many = Array.from({ length: 14 }, (_, i) => [i, 0]);
  assert.equal(normalizeSamplers([[1, NaN], ...many]).length, 10);
});

test('Sample Size: Point, 3 by 3 and 5 by 5 averages, clipped and alpha weighted', () => {
  // Red is x * 10, green y * 10, blue a constant.
  const img = image(10, 10, (x, y) => [x * 10, y * 10, 77]);
  assert.deepEqual(sampleAverage(img, 4, 6, 1), [40, 60, 77]);
  assert.deepEqual(sampleAverage(img, 4, 6, 3), [40, 60, 77]);
  // A pixel whose neighbourhood is not symmetric: the 3×3 and 5×5 means differ from the point.
  const spot = image(10, 10, (x, y) => (x === 5 && y === 5 ? [255, 0, 0] : [0, 0, 0]));
  assert.deepEqual(sampleAverage(spot, 5, 5, 1), [255, 0, 0]);
  assert.deepEqual(sampleAverage(spot, 5, 5, 3), [Math.round(255 / 9), 0, 0]);
  assert.deepEqual(sampleAverage(spot, 5, 5, 5), [Math.round(255 / 25), 0, 0]);
  assert.deepEqual(sampleAverage(spot, 4, 4, 3), [Math.round(255 / 9), 0, 0]);
  // At the corner the square is clipped to the canvas: 2×2 for 3×3, 3×3 for 5×5.
  const corner = image(10, 10, (x, y) => (x === 0 && y === 0 ? [200, 0, 0] : [0, 0, 0]));
  assert.deepEqual(sampleAverage(corner, 0, 0, 3), [50, 0, 0]);
  assert.deepEqual(sampleAverage(corner, 0, 0, 5), [Math.round(200 / 9), 0, 0]);
  // Transparent pixels do not darken the mean; an all-transparent square reads black.
  const half = image(4, 4, (x) => (x < 2 ? [0, 0, 0, 0] : [100, 150, 200]));
  assert.deepEqual(sampleAverage(half, 1, 1, 3), [100, 150, 200]);
  assert.deepEqual(sampleAverage(image(3, 3, () => [9, 9, 9, 0]), 1, 1, 3), [0, 0, 0]);
  // The Info panel rows are numbered from 1.
  assert.deepEqual(
    samplerReadouts(img, [
      [1, 2],
      [3, 4]
    ]),
    [
      { number: 1, rgb: [10, 20, 77] },
      { number: 2, rgb: [30, 40, 77] }
    ]
  );
});

test('Color Sampler tool: click places, ⌥-click removes, drag moves or drops off-canvas', () => {
  const ov = fakeOverlay(200, 20);
  const ctx = { canvas: { width: 200, height: 20 } };
  let changes = 0;
  const state = { samplers: [], zoom: 1, onSamplersChange: () => changes++ };
  const click = (x, y, alt = false, up = [x, y]) => {
    state.altKey = alt;
    TOOLS.colorSampler.onDown(ctx, ov, state, x, y);
    TOOLS.colorSampler.onUp(ctx, ov, state, ...up);
  };
  // Points 15 px apart, beyond the 7 px hit radius; the 11th is refused.
  for (let i = 0; i < 11; i++) click(i * 15 + 0.5, 1.5);
  assert.equal(state.samplers.length, 10);
  click(45.5, 1.5, true);
  assert.equal(state.samplers.length, 9);
  assert.deepEqual(state.samplers[3], [60, 1]);
  click(0.5, 1.5, false, [8.2, 9.9]);
  assert.deepEqual(state.samplers[0], [8, 9]);
  click(8.5, 9.5, false, [250, 9]);
  assert.equal(state.samplers.length, 8);
  assert.ok(changes > 0);
  TOOLS.colorSampler.clear(ov, state);
  assert.deepEqual(state.samplers, []);

  const bar = Object.fromEntries(TOOL_OPTION_SCHEMA.colorSampler.map((o) => [o.key, o]));
  assert.equal(bar.samplerCount.text({ samplers: [[1, 1]] }), '1 of 10 sample points');
  assert.deepEqual(
    bar.sampleSize.options.map((o) => o.value),
    ['1', '3', '5']
  );
  assert.equal(bar._samplerClear.patch()._samplerAction, 'clear');
});

test('Note tool: click adds a note with author and colour, a click on one selects and drags it', () => {
  const ov = fakeOverlay(200, 200);
  let changes = 0;
  const state = {
    notes: [],
    noteSelected: -1,
    zoom: 1,
    toolOptions: { note: { noteAuthor: 'QA', noteColor: '#ff0000' } },
    onNotesChange: () => changes++
  };
  const drag = (x, y, to = [x, y]) => {
    TOOLS.note.onDown(null, ov, state, x, y);
    TOOLS.note.onMove(null, ov, state, ...to);
    TOOLS.note.onUp(null, ov, state, ...to);
  };
  drag(10.4, 12.6);
  assert.deepEqual(state.notes, [{ x: 10, y: 13, author: 'QA', color: '#ff0000', text: '' }]);
  assert.equal(state.noteSelected, 0);
  state.toolOptions.note = {};
  drag(100, 100);
  assert.deepEqual(state.notes[1], { x: 100, y: 100, author: '', color: NOTE_COLOR, text: '' });
  assert.equal(state.noteSelected, 1);
  // A click on the first note's icon selects it; dragging carries it by the grab offset.
  drag(14, 16, [54, 26]);
  assert.equal(state.noteSelected, 0);
  assert.deepEqual([state.notes[0].x, state.notes[0].y], [50, 23]);
  assert.equal(state.notes.length, 2);
  assert.ok(changes >= 3);

  assert.equal(noteAt(state.notes, 101, 119), 1);
  assert.equal(noteAt(state.notes, 120, 100), -1);
  const edited = setNote(state.notes, 0, { text: 'fix this' });
  assert.equal(edited[0].text, 'fix this');
  assert.equal(state.notes[0].text, '');

  // The options bar: Author, Color, the Notes list, the selected note's Text, Delete, Clear All.
  const bar = Object.fromEntries(TOOL_OPTION_SCHEMA.note.map((o) => [o.key, o]));
  assert.deepEqual(Object.keys(bar), [
    'noteAuthor',
    'noteColor',
    'noteSelected',
    'noteText',
    '_noteDelete',
    '_noteClear'
  ]);
  const list = bar.noteSelected.optionsFrom({ notes: edited });
  assert.deepEqual(
    list.map((o) => o.value),
    ['-1', '0', '1']
  );
  assert.equal(list[1].label, '1 · QA · fix this');
  assert.equal(bar._noteClear.patch()._noteAction, 'clear');
});

test('Color Sampler and Note sit in the Eyedropper group on I and save in .paintproj', async () => {
  assert.deepEqual(TOOL_GROUPS[5], ['eyedropper', 'colorSampler', 'ruler', 'note', 'count']);
  assert.equal(toolForKey('I', true, 'eyedropper'), 'colorSampler');
  assert.equal(toolForKey('I', true, 'ruler'), 'note');
  assert.equal(TOOLS.colorSampler.icon, 'sampler');
  assert.equal(TOOLS.note.icon, 'message-square');
  assert.ok(ICONS.sampler && ICONS['message-square']);

  const samplers = [
    [1, 2],
    [3, 4]
  ];
  const notes = addNote([], 5, 6, 'Me', '#00ff00', 'hello').notes;
  const data = serializeProject(
    { layers: [], activeLayerIdx: 0, objects: [], samplers, notes, measurementScale: null },
    8,
    8
  );
  let got;
  await deserializeProject(JSON.parse(JSON.stringify(data)), (p) => (got = p));
  assert.deepEqual(got.samplers, samplers);
  assert.deepEqual(got.notes, notes);
  // Older files without them load with none.
  const { samplers: _s, notes: _n, ...old } = data;
  await deserializeProject(old, (p) => (got = p));
  assert.deepEqual(got.samplers, []);
  assert.deepEqual(got.notes, []);
  assert.deepEqual(normalizeNotes([{ x: 1, y: 2, color: 'red' }, { x: NaN, y: 0 }]), [
    { x: 1, y: 2, author: '', color: NOTE_COLOR, text: '' }
  ]);
});
