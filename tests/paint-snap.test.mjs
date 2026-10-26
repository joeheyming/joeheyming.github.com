// View › Extras, Show (Layer Edges, Selection Edges, Grid, Smart Guides, Pixel Grid, Brush
// Preview, All), Snap, Snap To (Guides, Grid, Layers, Document Bounds, All), and Pixel Art
// Preview (PhotoCraft view_cmds.rs, snap_ui.rs, engine snap.rs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SHOW,
  SHOW_KEYS,
  beginSnapDrag,
  defaultExtras,
  gridStep,
  normalizeGrid,
  pixelGridVisible,
  showAll,
  shows,
  smartTargets,
  snapDragPoint,
  snapOptions,
  snapPoint,
  snapRect,
  snapTargets,
  snapThreshold,
  snapToAll,
  toggleExtras,
  toggleShow,
  toggleSnapTo,
  visibleExtras
} from '../paint/snap.js';
import { brushPreviewSize } from '../paint/extras-ui.js';
import { drawSelectionOverlay } from '../paint/selection.js';
import { COMMANDS_BY_ID, commandForKey } from '../paint/commands.js';

const viewState = (over = {}) => ({
  ...defaultExtras(),
  showGuides: true,
  zoom: 1,
  guides: { vertical: [], horizontal: [] },
  ...over
});

const targetsOf = (state, layerRects = [], W = 200, H = 100) =>
  snapTargets({
    W,
    H,
    opts: snapOptions(state),
    guides: state.guides,
    layerRects,
    step: gridStep(state.grid)
  });

test('snapPoint pulls each axis onto the nearest target within the threshold', () => {
  const t = targetsOf(viewState({ guides: { vertical: [50], horizontal: [30] } }));
  // x 47 → guide 50, y 33 → guide 30.
  assert.deepEqual(snapPoint([47, 33], t, 8).point, [50, 30]);
  // Out of reach on x (61 is 11 from 50 and 39 from the centre 100); y 2 → top edge 0.
  assert.deepEqual(snapPoint([61, 2], t, 8).point, [61, 0]);
  // Nothing in reach: unchanged, no lines.
  const far = snapPoint([75, 70], t, 3);
  assert.deepEqual(far.point, [75, 70]);
  assert.deepEqual(far.lines, []);
  // The document centre and the far edge are targets too.
  assert.deepEqual(snapPoint([103, 97], t, 8).point, [100, 100]);
});

test('guides win ties with other targets; the line covers the target and the point', () => {
  const t = targetsOf(viewState({ guides: { vertical: [100], horizontal: [] } }));
  const r = snapPoint([98, 40], t, 8);
  assert.deepEqual(r.point, [100, 40]);
  assert.equal(r.lines[0].kind, 'guide');
  assert.equal(r.lines[0].vertical, true);
  assert.deepEqual([r.lines[0].from, r.lines[0].to], [0, 100]);
});

test('the threshold is 8 screen pixels: 2 document pixels at 400%', () => {
  assert.equal(snapThreshold(1), 8);
  assert.equal(snapThreshold(4), 2);
  const t = targetsOf(viewState({ guides: { vertical: [50], horizontal: [] } }));
  assert.equal(snapPoint([47, 40], t, snapThreshold(4)).point[0], 47);
  assert.equal(snapPoint([48.5, 40], t, snapThreshold(4)).point[0], 50);
});

test('Snap To families: off ones give no targets, View › Snap off gives none', () => {
  const s = viewState({ guides: { vertical: [50], horizontal: [] } });
  toggleSnapTo(s, 'guides');
  assert.equal(snapPoint([47, 40], targetsOf(s), 8).point[0], 47, 'guides off');
  toggleSnapTo(s, 'documentBounds');
  assert.equal(snapPoint([3, 40], targetsOf(s), 8).point[0], 3, 'document bounds off');
  // Layers: another layer's right edge at 120 and centre at 90.
  const rects = [[60, 10, 120, 40]];
  assert.equal(snapPoint([117, 40], targetsOf(s, rects), 8).point[0], 120);
  toggleSnapTo(s, 'layers');
  assert.equal(snapPoint([117, 40], targetsOf(s, rects), 8).point[0], 117, 'layers off');
  snapToAll(s);
  assert.deepEqual(s.snapTo, { guides: true, grid: true, layers: true, documentBounds: true });
  assert.equal(snapPoint([47, 40], targetsOf(s), 8).point[0], 50);
  s.snap = false;
  assert.equal(snapOptions(s), null);
  assert.equal(snapPoint([47, 3], targetsOf(s), 8).point.join(), '47,3');
});

test('the grid snaps only while shown; its step is gridline spacing over subdivisions', () => {
  const s = viewState();
  assert.equal(gridStep(s.grid), 18, 'a line every 72 px, 4 subdivisions');
  assert.equal(snapPoint([37, 55], targetsOf(s), 3).point.join(), '37,55', 'grid hidden');
  toggleShow(s, 'grid');
  assert.deepEqual(snapPoint([37, 55], targetsOf(s), 3).point, [36, 54]);
  s.grid = normalizeGrid({ every: 50, subdivisions: 2 });
  assert.deepEqual(snapPoint([27, 51], targetsOf(s), 3).point, [25, 50]);
  assert.deepEqual(normalizeGrid({ every: -3, subdivisions: 500 }), { every: 72, subdivisions: 100 });
});

test('hidden guides do not snap: Show › Guides off or Extras off', () => {
  const s = viewState({ guides: { vertical: [50], horizontal: [] } });
  toggleExtras(s);
  assert.equal(snapPoint([47, 40], targetsOf(s), 8).point[0], 47);
  toggleExtras(s);
  s.showGuides = false;
  assert.equal(snapPoint([47, 40], targetsOf(s), 8).point[0], 47);
});

test('snapRect: the moving box edge or centre closest to a target sets the correction', () => {
  const t = snapTargets({ W: 200, H: 100, opts: { layers: true }, layerRects: [[100, 0, 140, 30]] });
  // Left edge 96 is 4 from the layer's left edge 100; top 3 is 3 from its top 0.
  const r = snapRect([96, 3, 116, 9], t, 8);
  assert.deepEqual(r.delta, [4, -3]);
  // Centre alignment: a 20 wide box centred on 118 → the layer centre 120.
  assert.deepEqual(snapRect([108, 50, 128, 60], t, 3).delta, [2, 0]);
});

test('a Move drag snaps the layer box and reports smart guides; Ctrl turns snapping off', () => {
  const s = viewState();
  const others = [[100, 0, 140, 30]];
  const t = targetsOf(s, others);
  const smart = smartTargets(
    snapTargets({ W: 200, H: 100, opts: { layers: true, document: true }, layerRects: others })
  );
  // The moving layer covers 10..30 × 50..70; press at (20, 60).
  const drag = beginSnapDrag('rect', [20, 60], t, 8, [10, 50, 30, 70], smart);
  // Dragging right by 86 puts the left edge at 96: it snaps to 100, the pointer to 110.
  const r = snapDragPoint(drag, 106, 60);
  assert.equal(r.x, 110);
  assert.equal(r.y, 60);
  // Its left edge lines up at 100 and its right edge with the other layer's centre at 120.
  assert.ok(r.smart.some((l) => l.vertical && l.pos === 100));
  assert.ok(r.smart.some((l) => l.vertical && l.pos === 120 && l.kind === 'layerCenter'));
  // Ctrl held during the drag: the raw pointer.
  const off = snapDragPoint(drag, 106, 60, true);
  assert.deepEqual([off.x, off.y], [106, 60]);
  // A point drag (marquee corner) snaps the pointer itself.
  const p = snapDragPoint(beginSnapDrag('point', [0, 0], t, 8), 137, 4);
  assert.deepEqual([p.x, p.y], [140, 0]);
});

test('Extras off hides every Show overlay; showing an item turns Extras back on', () => {
  const s = viewState();
  showAll(s);
  assert.ok(Object.values(visibleExtras(s)).every(Boolean), 'Show › All shows everything');
  toggleExtras(s);
  const v = visibleExtras(s);
  assert.deepEqual(Object.keys(v).sort(), [...SHOW_KEYS, 'guides'].sort());
  assert.ok(Object.values(v).every((on) => on === false), 'Extras off hides every flag');
  assert.equal(pixelGridVisible({ ...s, zoom: 10 }), false);
  // The flags themselves are kept: Extras on brings them all back.
  toggleExtras(s);
  assert.ok(Object.values(visibleExtras(s)).every(Boolean));
  // Turning an item on while Extras is off turns Extras on (view_cmds.rs run).
  toggleExtras(s);
  toggleShow(s, 'layerEdges');
  toggleShow(s, 'layerEdges');
  assert.equal(s.extras, true);
  assert.equal(shows(s, 'layerEdges'), true);
});

test('Show defaults follow Photoshop; the pixel grid shows above 500%', () => {
  const s = viewState();
  assert.deepEqual(visibleExtras(s), {
    guides: true,
    layerEdges: false,
    selectionEdges: true,
    grid: false,
    smartGuides: true,
    pixelGrid: true,
    brushPreview: true
  });
  assert.equal(pixelGridVisible({ ...s, zoom: 5 }), false);
  assert.equal(pixelGridVisible({ ...s, zoom: 6 }), true);
  toggleShow(s, 'pixelGrid');
  assert.equal(pixelGridVisible({ ...s, zoom: 8 }), false);
  assert.equal(DEFAULT_SHOW.layerEdges, false);
});

test('Brush Preview outlines the tip size of painting tools only', () => {
  const s = { tool: 'brush', toolOptions: { brush: { size: 24 }, select: {} } };
  assert.equal(brushPreviewSize(s), 24);
  assert.equal(brushPreviewSize({ ...s, tool: 'select' }), null);
});

test('Selection Edges off keeps the selection but draws no marching ants', () => {
  const W = 4,
    H = 4;
  const mask = new Uint8Array(W * H);
  mask[5] = mask[6] = mask[9] = mask[10] = 1;
  let fills = 0;
  const ov = {
    canvas: { width: W, height: H },
    clearRect() {},
    beginPath() {},
    rect() {},
    fill: () => fills++,
    save() {},
    restore() {},
    stroke() {},
    setLineDash() {},
    strokeRect() {}
  };
  const state = viewState({ sel: { mode: 'active', mask, x: 1, y: 1, w: 2, h: 2 }, drawing: false });
  drawSelectionOverlay(state, ov);
  assert.ok(fills > 0, 'ants drawn');
  fills = 0;
  toggleShow(state, 'selectionEdges');
  drawSelectionOverlay(state, ov);
  assert.equal(fills, 0);
  assert.equal(state.sel.mode, 'active', 'the selection stays');
  toggleShow(state, 'selectionEdges');
  toggleExtras(state);
  drawSelectionOverlay(state, ov);
  assert.equal(fills, 0, 'Extras off hides the edges too');
});

test('View menu: Extras, Show, Snap, Snap To, and Pixel Art Preview are commands', () => {
  const ids = {
    'view.extras': ['View', 'Extras', 'Cmd+H'],
    'view.snap': ['View', 'Snap', 'Cmd+Shift+;'],
    'view.pixelArtPreview': ['View', 'Pixel Art Preview', null],
    'view.show.layerEdges': ['View > Show', 'Layer Edges', null],
    'view.show.selectionEdges': ['View > Show', 'Selection Edges', null],
    'view.show.grid': ['View > Show', 'Grid', "Cmd+'"],
    'view.show.smartGuides': ['View > Show', 'Smart Guides', null],
    'view.show.pixelGrid': ['View > Show', 'Pixel Grid', null],
    'view.show.brushPreview': ['View > Show', 'Brush Preview', null],
    'view.show.all': ['View > Show', 'All', null],
    'view.snapTo.guides': ['View > Snap To', 'Guides', null],
    'view.snapTo.grid': ['View > Snap To', 'Grid', null],
    'view.snapTo.layers': ['View > Snap To', 'Layers', null],
    'view.snapTo.documentBounds': ['View > Snap To', 'Document Bounds', null],
    'view.snapTo.all': ['View > Snap To', 'All', null]
  };
  for (const [id, [menu, label, shortcut]] of Object.entries(ids)) {
    const cmd = COMMANDS_BY_ID.get(id);
    assert.ok(cmd, id);
    assert.equal(cmd.menu.join(' > '), menu, id);
    assert.equal(cmd.label, label, id);
    assert.equal(cmd.shortcut, shortcut, id);
  }
  const key = (code, mods = {}) => commandForKey({ code, key: '', ctrlKey: true, ...mods });
  assert.equal(key('KeyH').id, 'view.extras');
  assert.equal(key('Quote').id, 'view.show.grid');
  assert.equal(key('Semicolon', { shiftKey: true }).id, 'view.snap');
  assert.ok(COMMANDS_BY_ID.get('edit.preferences.guidesGridAndSlices'), 'grid spacing dialog');
});

test('running the View commands changes what shows and what snaps', () => {
  const state = viewState({ guides: { vertical: [50], horizontal: [] } });
  const ctx = { updateExtras: (change) => change(state) };
  const run = (id) => COMMANDS_BY_ID.get(id).run(ctx);
  const checked = (id) => COMMANDS_BY_ID.get(id).checked(state);

  run('view.show.grid');
  assert.equal(checked('view.show.grid'), true);
  assert.equal(visibleExtras(state).grid, true);
  run('view.extras');
  assert.equal(checked('view.extras'), false);
  assert.ok(Object.values(visibleExtras(state)).every((on) => !on));
  run('view.show.all');
  assert.equal(checked('view.extras'), true);
  for (const k of SHOW_KEYS) assert.equal(checked(`view.show.${k}`), true, k);

  assert.equal(snapPoint([47, 40], targetsOf(state), 8).point[0], 50);
  run('view.snap');
  assert.equal(checked('view.snap'), false);
  assert.equal(snapPoint([47, 40], targetsOf(state), 8).point[0], 47);
  run('view.snap');
  for (const k of ['guides', 'grid', 'layers', 'documentBounds']) {
    run(`view.snapTo.${k}`);
    assert.equal(checked(`view.snapTo.${k}`), false, k);
  }
  assert.equal(snapPoint([47, 3], targetsOf(state), 8).point.join(), '47,3');
  run('view.snapTo.all');
  assert.deepEqual(snapPoint([47, 3], targetsOf(state), 8).point, [50, 0]);

  run('view.pixelArtPreview');
  assert.equal(state.pixelArtPreview, true);
  assert.equal(checked('view.pixelArtPreview'), true);
});
