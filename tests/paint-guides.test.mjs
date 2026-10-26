// View › Rulers, Show › Guides, New Guide…, New Guide Layout…, Lock Guides, Clear Guides
// (PhotoCraft rulers.rs, engine guide_layout.rs and edit_cmds.rs guide_cmd).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addGuide,
  emptyGuides,
  finishGuideDrag,
  guideAt,
  guideLayout,
  guidePosition,
  hasGuides,
  niceStep,
  normalizeGuides,
  rulerStep,
  rulerTicks
} from '../paint/guides.js';
import { guideLayoutParams } from '../paint/guides-dialog.js';
import { COMMANDS_BY_ID, commandForKey } from '../paint/commands.js';
import { historyIconName } from '../paint/history.js';
import { deserializeProject, serializeProject } from '../paint/project.js';

const close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

test('New Guide Layout: columns with gutter inside margins (guide_layout.rs guide_layouts)', () => {
  const r = guideLayout(emptyGuides(), 100, 50, { columns: 2, gutter: 10, margin: [5, 10, 5, 10] });
  assert.deepEqual(r.added.vertical, [10, 90, 45, 55]);
  assert.deepEqual(r.guides.vertical, [10, 90, 45, 55]);
  assert.deepEqual(r.guides.horizontal, [5, 45]);
});

test('New Guide Layout: rows, clearing existing guides', () => {
  const start = guideLayout(emptyGuides(), 100, 50, { columns: 2, gutter: 10, margin: 5 }).guides;
  const r = guideLayout(start, 100, 50, { rows: 2, clearExisting: true });
  assert.deepEqual(r.guides.vertical, []);
  assert.deepEqual(r.guides.horizontal, [0, 25, 50]);
});

test('New Guide Layout: fixed-width centred columns', () => {
  const r = guideLayout(emptyGuides(), 100, 50, {
    columns: 2,
    width: 20,
    gutter: 10,
    centerColumns: true
  });
  assert.deepEqual(r.guides.vertical, [25, 45, 55, 75]);
  // Without Center Columns they pack from the left margin.
  const packed = guideLayout(emptyGuides(), 100, 50, { columns: 2, width: 20, gutter: 10 });
  assert.deepEqual(packed.guides.vertical, [0, 20, 30, 50]);
});

test('New Guide Layout keeps existing guides and skips duplicates', () => {
  const g = { vertical: [50, 0.004], horizontal: [] };
  const r = guideLayout(g, 100, 50, { columns: 2 });
  assert.deepEqual(r.added.vertical, [0, 50, 100]);
  assert.deepEqual(r.guides.vertical, [50, 0.004, 100]);
  assert.deepEqual(g.vertical, [50, 0.004], 'the old list is not mutated');
});

test('New Guide Layout refuses layouts that do not fit', () => {
  const g = emptyGuides();
  assert.throws(() => guideLayout(g, 100, 50, {}), /columns, rows or a margin/);
  assert.throws(() => guideLayout(g, 100, 50, { columns: 4, width: 30 }), /fit/);
  assert.throws(() => guideLayout(g, 100, 50, { columns: 2, margin: 60 }), /margins/);
  assert.throws(() => guideLayout(g, 100, 50, { columns: 2, gutter: -1 }), /non-negative/);
  assert.throws(() => guideLayout(g, 100, 50, { columns: 1.5 }), /whole number/);
  assert.throws(() => guideLayout(g, 100, 50, { columns: 1001 }), /1000 or fewer/);
});

test('the layout dialog fields become layout params', () => {
  const f = {
    useColumns: true,
    columns: '3',
    width: '',
    gutter: '6',
    useRows: false,
    rows: '4',
    height: '',
    rowGutter: '2',
    useMargin: true,
    top: '2',
    left: '3',
    bottom: '4',
    right: '5',
    center: false,
    clear: true
  };
  const p = guideLayoutParams(f);
  assert.deepEqual(p, {
    columns: 3,
    width: 0,
    gutter: 6,
    rows: 0,
    height: 0,
    rowGutter: 0,
    margin: [2, 3, 4, 5],
    centerColumns: false,
    clearExisting: true
  });
  const r = guideLayout(emptyGuides(), 109, 40, p);
  // 101 px between the margins: three 29.666… px columns with 6 px gutters.
  const w = (101 - 12) / 3;
  assert.ok(close(r.guides.vertical, [3, 104, 3 + w, 9 + w, 9 + 2 * w, 15 + 2 * w]));
  assert.deepEqual(r.guides.horizontal, [2, 36]);
});

test('ruler tick spacing follows the zoom (labels at least 60 screen px apart)', () => {
  assert.equal(niceStep(60), 100);
  assert.equal(rulerStep(1), 100);
  assert.equal(rulerStep(2), 50);
  assert.equal(rulerStep(0.5), 200);
  assert.equal(rulerStep(4), 20);
  assert.equal(rulerStep(16), 5);
  assert.equal(rulerStep(0.1), 1000);
  for (const z of [0.1, 0.33, 1, 1.5, 3, 7, 16]) {
    const step = rulerStep(z);
    assert.ok(step * z >= 60, `zoom ${z}: ${step}`);
  }
});

test('ruler ticks: labelled majors, nine minors, the middle one longer', () => {
  const ticks = rulerTicks(10, 1, 250);
  const majors = ticks.filter((t) => t.label != null);
  assert.deepEqual(
    majors.map((t) => [t.at, t.label]),
    [
      [10, '0'],
      [110, '100'],
      [210, '200']
    ]
  );
  assert.equal(ticks.find((t) => t.value === 50).len, 6);
  assert.equal(ticks.find((t) => t.value === 10).len, 3);
  assert.equal(ticks.find((t) => t.value === 100).len, 16);
  // Left of the document 0 the labels read the distance, without a minus sign.
  const left = rulerTicks(150, 1, 200).filter((t) => t.label != null);
  assert.deepEqual(
    left.map((t) => [t.at, t.label]),
    [
      [50, '100'],
      [150, '0']
    ]
  );
});

test('ruler ticks track the zoom and a flipped view', () => {
  const z2 = rulerTicks(0, 2, 300).filter((t) => t.label != null);
  assert.deepEqual(
    z2.map((t) => [t.at, t.label]),
    [
      [0, '0'],
      [100, '50'],
      [200, '100'],
      [300, '150']
    ]
  );
  // Flipped: document 0 at the right, x grows leftward.
  const flipped = rulerTicks(300, -2, 300).filter((t) => t.label != null);
  assert.deepEqual(
    flipped.map((t) => [t.at, t.label]).sort((a, b) => a[0] - b[0]),
    [
      [0, '150'],
      [100, '100'],
      [200, '50'],
      [300, '0']
    ]
  );
});

test('dragging out of a ruler makes a guide; off the canvas or onto a ruler it is dropped', () => {
  const g = emptyGuides();
  const fresh = (vertical, pos, overRuler = false) => ({
    vertical,
    index: null,
    pos,
    press: pos,
    overRuler
  });
  const made = finishGuideDrag(g, fresh(false, 20.25), 100, 50);
  assert.equal(made.label, 'New Guide');
  assert.deepEqual(made.guides, { vertical: [], horizontal: [20.25] });
  assert.equal(finishGuideDrag(g, fresh(false, 60), 100, 50), null, 'below the document');
  assert.equal(finishGuideDrag(g, fresh(true, -1), 100, 50), null, 'left of the document');
  assert.equal(finishGuideDrag(g, fresh(true, 40, true), 100, 50), null, 'let go on a ruler');
  assert.deepEqual(g, emptyGuides());
});

test('dragging a guide moves it; off the canvas or onto a ruler deletes it', () => {
  const g = { vertical: [10, 30], horizontal: [5] };
  const drag = (pos, overRuler = false) => ({ vertical: true, index: 1, pos, press: 30, overRuler });
  const moved = finishGuideDrag(g, drag(42), 100, 50);
  assert.equal(moved.label, 'Move Guide');
  assert.deepEqual(moved.guides.vertical, [10, 42]);
  const off = finishGuideDrag(g, drag(130), 100, 50);
  assert.equal(off.label, 'Delete Guide');
  assert.deepEqual(off.guides, { vertical: [10], horizontal: [5] });
  // A horizontal guide dragged sideways onto the left ruler never moves in y, but goes.
  const sideways = finishGuideDrag(
    g,
    { vertical: false, index: 0, pos: 5, press: 5, overRuler: true },
    100,
    50
  );
  assert.deepEqual(sideways.guides.horizontal, []);
  assert.equal(finishGuideDrag(g, drag(30.1), 100, 50, 1), null, 'a click is not a move');
  assert.deepEqual(g.vertical, [10, 30]);
});

test('guide hit testing and the New Guide position field', () => {
  const g = { vertical: [10, 30], horizontal: [12] };
  assert.deepEqual(guideAt(g, 31, 40, 3), { vertical: true, index: 1 });
  assert.deepEqual(guideAt(g, 50, 11, 3), { vertical: false, index: 0 });
  assert.equal(guideAt(g, 50, 40, 3), null);
  assert.equal(guidePosition('25', true, 200, 100), 25);
  assert.equal(guidePosition('12.5 px', false, 200, 100), 12.5);
  assert.equal(guidePosition('50%', true, 200, 100), 100);
  assert.equal(guidePosition('50%', false, 200, 100), 50);
  assert.equal(guidePosition('abc', true, 200, 100), null);
  assert.deepEqual(addGuide(g, true, 5).vertical, [10, 30, 5]);
});

test('guides save in .paintproj and older files load with none', async () => {
  const guides = { vertical: [10, 42.5], horizontal: [3] };
  const data = serializeProject({ layers: [], activeLayerIdx: 0, objects: [], guides }, 8, 8);
  assert.deepEqual(data.guides, guides);
  let got;
  await deserializeProject(JSON.parse(JSON.stringify(data)), (p) => (got = p));
  assert.deepEqual(got.guides, guides);
  const { guides: _drop, ...old } = data;
  await deserializeProject(old, (p) => (got = p));
  assert.deepEqual(got.guides, emptyGuides());
  assert.deepEqual(normalizeGuides({ vertical: [1, 'x', NaN], horizontal: null }), {
    vertical: [1],
    horizontal: []
  });
});

test('View menu commands: Rulers, Show › Guides, Lock, Clear, New Guide, New Guide Layout', () => {
  const ids = {
    'view.rulers': ['View', 'Rulers', 'Cmd+R'],
    'view.show.guides': ['View > Show', 'Guides', 'Cmd+;'],
    'view.lockGuides': ['View', 'Lock Guides', 'Cmd+Alt+;'],
    'view.clearGuides': ['View', 'Clear Guides', null],
    'view.newGuide': ['View', 'New Guide…', null],
    'view.newGuideLayout': ['View', 'New Guide Layout…', null]
  };
  for (const [id, [menu, label, shortcut]] of Object.entries(ids)) {
    const cmd = COMMANDS_BY_ID.get(id);
    assert.ok(cmd, id);
    assert.equal(cmd.menu.join(' > '), menu, id);
    assert.equal(cmd.label, label, id);
    assert.equal(cmd.shortcut, shortcut, id);
  }
  const key = (code, mods = {}) => commandForKey({ code, key: '', ctrlKey: true, ...mods });
  assert.equal(key('KeyR').id, 'view.rulers');
  assert.equal(key('Semicolon').id, 'view.show.guides');
  assert.equal(key('Semicolon', { altKey: true }).id, 'view.lockGuides');
});

test('the View commands change the view state', () => {
  const state = { guides: emptyGuides(), showGuides: true, showRulers: false, guidesLocked: false };
  const calls = [];
  // A stand-in for paint.js commandCtx doing what its actions do.
  const ctx = {
    toggleRulers: () => (state.showRulers = !state.showRulers),
    updateExtras: (change) => change(state),
    toggleLockGuides: () => (state.guidesLocked = !state.guidesLocked),
    clearGuides: () => (state.guides = emptyGuides()),
    newGuide: () => calls.push('newGuide'),
    newGuideLayout: () => calls.push('newGuideLayout')
  };
  const run = (id) => COMMANDS_BY_ID.get(id).run(ctx);
  const checked = (id) => COMMANDS_BY_ID.get(id).checked(state);
  run('view.rulers');
  assert.equal(state.showRulers, true);
  assert.equal(checked('view.rulers'), true);
  assert.equal(checked('view.show.guides'), true);
  run('view.show.guides');
  assert.equal(checked('view.show.guides'), false);
  run('view.lockGuides');
  assert.equal(checked('view.lockGuides'), true);
  const clear = COMMANDS_BY_ID.get('view.clearGuides');
  assert.equal(clear.enabled(state), false, 'nothing to clear');
  state.guides = guideLayout(state.guides, 100, 50, { columns: 2 }).guides;
  assert.ok(hasGuides(state.guides));
  assert.equal(clear.enabled(state), true);
  run('view.clearGuides');
  assert.equal(hasGuides(state.guides), false);
  run('view.newGuide');
  run('view.newGuideLayout');
  assert.deepEqual(calls, ['newGuide', 'newGuideLayout']);
});

test('guide history rows have icons', () => {
  assert.equal(historyIconName('New Guide'), 'ruler');
  assert.equal(historyIconName('Move Guide'), 'ruler');
  assert.equal(historyIconName('Delete Guide'), 'trash');
  assert.equal(historyIconName('Clear Guides'), 'trash');
  assert.equal(historyIconName('New Guide Layout'), 'grid-3x3');
});
