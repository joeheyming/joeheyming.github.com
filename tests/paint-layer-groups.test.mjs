import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Layer groups (PhotoCraft layer.new.group, layer.new.groupFromLayers, layer.groupLayers,
// layer.ungroupLayers). createLayer needs document.createElement('canvas'); a tiny
// ImageData-backed stub keeps the tree, compositing, and project tests browser-free.
function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    className: '',
    dataset: {},
    style: {},
    pixels: null,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,'
  };
  const ensure = () => {
    if (!canvas.pixels || canvas.pixels.length !== canvas.width * canvas.height * 4) {
      canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    }
  };
  const ctx = {
    canvas,
    getImageData(x, y, w, h) {
      ensure();
      return { width: w, height: h, data: canvas.pixels.slice() };
    },
    putImageData(img) {
      ensure();
      canvas.pixels.set(img.data);
    }
  };
  return canvas;
}

const fakeDocument = { createElement: () => fakeCanvas() };
globalThis.document = fakeDocument;

const {
  PASS_THROUGH,
  applyMovePlan,
  blockIndices,
  compositeTreeBytes,
  displayRows,
  groupLayersPlan,
  groupToolRefusal,
  insertGroupAbove,
  isEffectivelyVisible,
  isGroupLayer,
  layerDepth,
  layerTree,
  moveLayerPlan,
  normalizeTree,
  topLevelIds,
  ungroupPlan
} = await import('../paint/layer-groups.js');
const { createLayer, createGroupLayer, canMergeDown, GROUP_BLEND_MODES } = await import(
  '../paint/layers.js'
);
const { isBackgroundLayer } = await import('../paint/layer-new.js');
const { mergeLayersPlan, mergeVisiblePlan, hiddenLayersPlan, applyMergePlan } = await import(
  '../paint/layer-multi.js'
);
const { snapshotStack, restoreStack, isStackUndoLabel } = await import('../paint/stack-history.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');
const { COMMANDS_BY_ID, commandForKey } = await import('../paint/commands.js');
const { newLayerSettings } = await import('../paint/new-layer-dialog.js');

const names = (layers) => layers.map((l) => l.name);
const parents = (layers) =>
  layers.map((l) => (l.parentId == null ? null : layers.find((g) => g.id === l.parentId).name));

// A 1 x 1 stack: Background, A, B, C (bottom first).
function stack() {
  const bg = createLayer('Background', 1, 1);
  bg.background = true;
  return [bg, createLayer('A', 1, 1), createLayer('B', 1, 1), createLayer('C', 1, 1)];
}

const byName = (layers, n) => layers.find((l) => l.name === n);
const idsOf = (layers, ...ns) => ns.map((n) => byName(layers, n).id);

test('a group record: kind group, Pass Through, open, no parent', () => {
  const g = createGroupLayer('Group 1', 2, 2);
  assert.equal(g.kind, 'group');
  assert.equal(isGroupLayer(g), true);
  assert.equal(g.blendMode, PASS_THROUGH);
  assert.equal(g.collapsed, false);
  assert.equal(g.parentId, null);
  assert.equal(g.visible, true);
  assert.equal(g.opacity, 1);
  assert.equal(g.canvas.style.display, 'none', 'a group draws nothing of its own');
  assert.equal(GROUP_BLEND_MODES[0].value, PASS_THROUGH);
  assert.equal(GROUP_BLEND_MODES[0].label, 'Pass Through');
});

test('Group…: an empty group goes directly above the active layer, as its sibling', () => {
  let layers = stack();
  const g = createGroupLayer('Group 1', 1, 1);
  layers = insertGroupAbove(layers, 1, g);
  assert.deepEqual(names(layers), ['Background', 'A', 'Group 1', 'B', 'C']);
  assert.equal(g.parentId, null);

  // Inside a group, the new group stays inside it.
  const inner = createGroupLayer('Group 2', 1, 1);
  const a = byName(layers, 'A');
  a.parentId = g.id;
  layers = normalizeTree(layers);
  layers = insertGroupAbove(layers, layers.indexOf(a), inner);
  assert.deepEqual(names(layers), ['Background', 'A', 'Group 2', 'Group 1', 'B', 'C']);
  assert.deepEqual(parents(layers), [null, 'Group 1', 'Group 1', null, null, null]);
});

test('Group Layers: the selected layers move into a collapsed group at the top one’s place', () => {
  let layers = stack();
  const g = createGroupLayer('Group 1', 1, 1);
  const plan = groupLayersPlan(layers, idsOf(layers, 'A', 'B'), g);
  layers = plan.layers;
  assert.deepEqual(names(layers), ['Background', 'A', 'B', 'Group 1', 'C']);
  assert.deepEqual(parents(layers), [null, 'Group 1', 'Group 1', null, null]);
  assert.equal(g.collapsed, true, 'Photoshop creates the group collapsed');

  // The tree: Background, Group 1 [A, B], C.
  const tree = layerTree(layers);
  assert.deepEqual(
    tree.map((n) => [n.layer.name, n.children?.map((c) => c.layer.name) ?? null]),
    [
      ['Background', null],
      ['Group 1', ['A', 'B']],
      ['C', null]
    ]
  );

  // Non-adjacent layers gather under the topmost one: C and the group nest into Group 2.
  const outer = createGroupLayer('Group 2', 1, 1);
  layers = groupLayersPlan(
    layers,
    [g.id, byName(layers, 'A').id, byName(layers, 'C').id],
    outer
  ).layers;
  assert.deepEqual(names(layers), ['Background', 'A', 'B', 'Group 1', 'C', 'Group 2']);
  assert.deepEqual(parents(layers), [null, 'Group 1', 'Group 1', 'Group 2', 'Group 2', null]);
  assert.deepEqual(
    topLevelIds(layers, [g.id, byName(layers, 'A').id]),
    [g.id],
    'A inside a listed group is not top level'
  );
  assert.equal(layerDepth(layers, 1), 2);
  assert.deepEqual(blockIndices(layers, 5), [1, 2, 3, 4, 5]);

  assert.ok(groupLayersPlan(layers, [], createGroupLayer('X', 1, 1)).error);
});

test('Ungroup Layers: the children take the group’s place; the top child becomes active', () => {
  let layers = stack();
  const g = createGroupLayer('Group 1', 1, 1);
  layers = groupLayersPlan(layers, idsOf(layers, 'A', 'B'), g).layers;
  const { layers: out, activeId } = ungroupPlan(layers, layers.indexOf(g));
  assert.deepEqual(names(out), ['Background', 'A', 'B', 'C']);
  assert.deepEqual(parents(out), [null, null, null, null]);
  assert.equal(activeId, byName(out, 'B').id);
  assert.ok(ungroupPlan(out, 1).error, 'a plain layer is not a group');

  // A nested group ungroups into its parent.
  layers = stack();
  const outer = createGroupLayer('Outer', 1, 1);
  layers = groupLayersPlan(layers, idsOf(layers, 'A', 'B', 'C'), outer).layers;
  const inner = createGroupLayer('Inner', 1, 1);
  layers = groupLayersPlan(layers, idsOf(layers, 'B', 'C'), inner).layers;
  assert.deepEqual(names(layers), ['Background', 'A', 'B', 'C', 'Inner', 'Outer']);
  const r = ungroupPlan(layers, layers.indexOf(inner));
  assert.deepEqual(names(r.layers), ['Background', 'A', 'B', 'C', 'Outer']);
  assert.deepEqual(parents(r.layers), [null, 'Outer', 'Outer', 'Outer', null]);

  // An empty group just goes.
  layers = insertGroupAbove(stack(), 3, createGroupLayer('Empty', 1, 1));
  const e = ungroupPlan(layers, 4);
  assert.deepEqual(names(e.layers), ['Background', 'A', 'B', 'C']);
  assert.equal(e.activeId, null);
});

test('the panel lists a group above its indented children and hides them when collapsed', () => {
  let layers = stack();
  const g = createGroupLayer('Group 1', 1, 1);
  layers = groupLayersPlan(layers, idsOf(layers, 'A', 'B'), g).layers;
  g.collapsed = false;
  const rows = (ls) => displayRows(ls).map(({ idx, depth }) => [ls[idx].name, depth]);
  assert.deepEqual(rows(layers), [
    ['C', 0],
    ['Group 1', 0],
    ['B', 1],
    ['A', 1],
    ['Background', 0]
  ]);
  g.collapsed = true;
  assert.deepEqual(rows(layers), [
    ['C', 0],
    ['Group 1', 0],
    ['Background', 0]
  ]);
});

test('drag-reorder moves a layer into a group, out of it, and refuses a group into itself', () => {
  let layers = stack();
  const g = createGroupLayer('Group 1', 1, 1);
  layers = groupLayersPlan(layers, idsOf(layers, 'A'), g).layers;
  assert.deepEqual(names(layers), ['Background', 'A', 'Group 1', 'B', 'C']);

  // C dropped on the group's row goes in at the top.
  let plan = moveLayerPlan(layers, 4, 2, isBackgroundLayer);
  assert.equal(byName(layers, 'C').parentId, null, 'nothing changes before the plan is applied');
  layers = applyMovePlan(plan);
  assert.deepEqual(names(layers), ['Background', 'A', 'C', 'Group 1', 'B']);
  assert.deepEqual(parents(layers), [null, 'Group 1', 'Group 1', null, null]);

  // A child dropped on its own group's row comes out above the group.
  layers = applyMovePlan(moveLayerPlan(layers, 1, 3, isBackgroundLayer));
  assert.deepEqual(names(layers), ['Background', 'C', 'Group 1', 'A', 'B']);
  assert.deepEqual(parents(layers), [null, 'Group 1', null, null, null]);

  // Dropped on a layer inside a group, a layer joins that group in that layer's place.
  layers = applyMovePlan(moveLayerPlan(layers, 4, 1, isBackgroundLayer));
  assert.deepEqual(names(layers), ['Background', 'B', 'C', 'Group 1', 'A']);
  assert.deepEqual(parents(layers), [null, 'Group 1', 'Group 1', null, null]);

  // A group moves with its contents.
  layers = applyMovePlan(moveLayerPlan(layers, 3, 4, isBackgroundLayer));
  assert.deepEqual(names(layers), ['Background', 'A', 'B', 'C', 'Group 1']);
  assert.deepEqual(parents(layers), [null, null, 'Group 1', 'Group 1', null]);

  // Refused: a group into its own child's place, and anything below the Background.
  assert.equal(moveLayerPlan(layers, 4, 2, isBackgroundLayer), null);
  assert.equal(moveLayerPlan(layers, 1, 0, isBackgroundLayer), null);
  assert.equal(moveLayerPlan(layers, 0, 1, isBackgroundLayer), null);
});

// ── Compositing ──────────────────────────────────────────────────────────────

// One pixel: an opaque 50 % gray Background and a 50 % gray Multiply layer in a group.
function multiplyInGroup(groupMode, groupOpacity = 1) {
  const bg = { id: 1, name: 'Background', kind: 'pixel', parentId: null, visible: true };
  bg.opacity = 1;
  bg.blendMode = 'source-over';
  bg.data = new Uint8ClampedArray([128, 128, 128, 255]);
  const m = { id: 2, name: 'm', kind: 'pixel', parentId: 3, visible: true, opacity: 1 };
  m.blendMode = 'multiply';
  m.data = new Uint8ClampedArray([128, 128, 128, 255]);
  const g = { id: 3, name: 'g', kind: 'group', parentId: null, visible: true };
  g.opacity = groupOpacity;
  g.blendMode = groupMode;
  return [bg, m, g];
}

const near = (actual, expected, msg) =>
  assert.ok(
    actual.every((v, i) => Math.abs(v - expected[i]) <= 1),
    `${msg}: ${[...actual]} vs ${expected}`
  );

test('a pass-through group composites its children into the backdrop', () => {
  // Multiply reaches the gray beneath: 0.5 × 0.5 = 0.25 (compose tests.rs pass_through).
  near(compositeTreeBytes(multiplyInGroup(PASS_THROUGH), 1, 1), [64, 64, 64, 255], 'pass');
});

test('a Normal group renders its children alone, then blends the result', () => {
  // Multiply onto the group's empty buffer is the gray itself; Normal puts that over the gray.
  near(compositeTreeBytes(multiplyInGroup('source-over'), 1, 1), [128, 128, 128, 255], 'normal');
  // A Multiply group multiplies its isolated result onto the backdrop: 0.25 again.
  near(compositeTreeBytes(multiplyInGroup('multiply'), 1, 1), [64, 64, 64, 255], 'multiply');
});

test('group opacity, visibility, and nesting', () => {
  // Pass through at 50 %: halfway between the backdrop (128) and the pass-through result (64).
  near(compositeTreeBytes(multiplyInGroup(PASS_THROUGH, 0.5), 1, 1), [96, 96, 96, 255], 'mix');
  // Normal at 50 %: the isolated gray over gray is still gray.
  near(compositeTreeBytes(multiplyInGroup('source-over', 0.5), 1, 1), [128, 128, 128, 255], 'n50');

  const hidden = multiplyInGroup(PASS_THROUGH);
  hidden[2].visible = false;
  near(compositeTreeBytes(hidden, 1, 1), [128, 128, 128, 255], 'a hidden group hides its layers');
  assert.equal(isEffectivelyVisible(hidden, hidden[1]), false);

  // A Normal group inside a pass-through group still isolates its Multiply child.
  const nested = multiplyInGroup('source-over');
  nested[1].parentId = 3;
  nested.push({ id: 4, name: 'outer', kind: 'group', parentId: null, visible: true, opacity: 1 });
  nested[3].blendMode = PASS_THROUGH;
  nested[2].parentId = 4;
  near(compositeTreeBytes(nested, 1, 1), [128, 128, 128, 255], 'nested');

  // Without the group the same stack multiplies.
  const flat = multiplyInGroup(PASS_THROUGH).slice(0, 2);
  flat[1].parentId = null;
  near(compositeTreeBytes(flat, 1, 1), [64, 64, 64, 255], 'no group');
});

// ── Commands, history, and files ─────────────────────────────────────────────

test('Layer menu commands sit where PhotoCraft puts them, with Cmd+G and Shift+Cmd+G', () => {
  const g = COMMANDS_BY_ID.get('layer.new.group');
  assert.equal(g.label, 'Group…');
  assert.deepEqual(g.menu, ['Layer', 'New']);
  const gl = COMMANDS_BY_ID.get('layer.new.groupFromLayers');
  assert.equal(gl.label, 'Group from Layers…');
  assert.deepEqual(gl.menu, ['Layer', 'New']);
  const group = COMMANDS_BY_ID.get('layer.groupLayers');
  assert.deepEqual([group.label, group.menu], ['Group Layers', ['Layer']]);
  const ungroup = COMMANDS_BY_ID.get('layer.ungroupLayers');
  assert.deepEqual([ungroup.label, ungroup.menu], ['Ungroup Layers', ['Layer']]);

  assert.equal(commandForKey({ code: 'KeyG', key: 'g', metaKey: true })?.id, 'layer.groupLayers');
  assert.equal(
    commandForKey({ code: 'KeyG', key: 'G', ctrlKey: true, shiftKey: true })?.id,
    'layer.ungroupLayers'
  );

  // Each runs its app action.
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => () => calls.push(k) });
  for (const id of [
    'layer.new.group',
    'layer.new.groupFromLayers',
    'layer.groupLayers',
    'layer.ungroupLayers'
  ])
    COMMANDS_BY_ID.get(id).run(ctx);
  assert.deepEqual(calls, ['newGroup', 'groupFromLayers', 'groupLayers', 'ungroupLayers']);

  // Ungroup needs an active group.
  const layers = stack();
  const gr = createGroupLayer('Group 1', 1, 1);
  layers.push(gr);
  const state = { layers, activeLayerIdx: 1 };
  assert.equal(ungroup.enabled(state), false);
  assert.equal(ungroup.enabled({ ...state, activeLayerIdx: 4 }), true);
  assert.equal(group.enabled(state), true);
  // Pixel commands skip a group.
  assert.equal(COMMANDS_BY_ID.get('layer.layerMask.revealAll').enabled(state), true);
  assert.equal(
    COMMANDS_BY_ID.get('layer.layerMask.revealAll').enabled({ ...state, activeLayerIdx: 4 }),
    false
  );
  assert.equal(
    COMMANDS_BY_ID.get('edit.transform.flipHorizontal').enabled({ ...state, activeLayerIdx: 4 }),
    false
  );
});

test('the New Group dialog defaults to Pass Through and accepts it', () => {
  assert.equal(
    newLayerSettings({ name: ' G ', mode: PASS_THROUGH, group: true }).blendMode,
    PASS_THROUGH
  );
  assert.equal(newLayerSettings({ name: 'G', mode: 'bogus', group: true }).blendMode, PASS_THROUGH);
  assert.equal(newLayerSettings({ name: 'L', mode: PASS_THROUGH }).blendMode, 'source-over');
});

test('painting tools refuse a group; selections and the eyedropper still work', () => {
  const g = createGroupLayer('Group 1', 1, 1);
  assert.match(groupToolRefusal(g, 'brush', 'Brush'), /Could not use the Brush: .*group/);
  assert.ok(groupToolRefusal(g, 'eraser'));
  assert.ok(groupToolRefusal(g, 'select'), 'the Move tool cannot move a group here');
  assert.equal(groupToolRefusal(g, 'rectSelect'), null);
  assert.equal(groupToolRefusal(g, 'eyedropper'), null);
  assert.equal(groupToolRefusal(createLayer('A', 1, 1), 'brush'), null);
});

test('Merge Down stops at a group boundary; merging a group flattens it with its children', () => {
  let layers = stack();
  const g = createGroupLayer('Group 1', 1, 1);
  layers = groupLayersPlan(layers, idsOf(layers, 'B', 'C'), g).layers;
  // Background, A, B, C, Group 1
  assert.equal(canMergeDown(layers, 3), true, 'C onto B inside the group');
  assert.equal(canMergeDown(layers, 2), false, 'B is the group’s bottom layer');
  assert.equal(canMergeDown(layers, 4), false, 'a group does not merge down');

  const plan = mergeLayersPlan(layers, [g.id, byName(layers, 'A').id]);
  assert.equal(layers[plan.keep].name, 'C', 'the top selected content layer is kept');
  assert.deepEqual(
    plan.remove.map((i) => layers[i].name),
    ['A', 'B', 'Group 1']
  );
  const flat = { getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) }) };
  const { merged } = applyMergePlan(layers, plan, () => flat);
  assert.deepEqual(names(layers), ['Background', 'C']);
  assert.equal(merged.parentId, null, 'the kept layer leaves the merged group');

  layers = stack();
  const h = createGroupLayer('Group 1', 1, 1);
  layers = groupLayersPlan(layers, idsOf(layers, 'B', 'C'), h).layers;
  h.visible = false;
  const vis = mergeVisiblePlan(layers);
  assert.deepEqual(
    vis.sources.map((i) => layers[i].name),
    ['Background', 'A'],
    'layers in a hidden group are not visible'
  );
  assert.deepEqual(
    hiddenLayersPlan(layers).remove.map((i) => layers[i].name),
    ['B', 'C', 'Group 1'],
    'a hidden group is deleted with its contents'
  );
});

test('undo snapshots and the stack labels carry the tree', () => {
  let layers = stack();
  const g = createGroupLayer('Group 1', 1, 1);
  layers = groupLayersPlan(layers, idsOf(layers, 'A', 'B'), g).layers;
  const snap = restoreStack(snapshotStack(layers, 3));
  const rec = snap.layers.find((r) => r.id === g.id);
  assert.equal(rec.kind, 'group');
  assert.equal(rec.collapsed, true);
  assert.equal(rec.blendMode, PASS_THROUGH);
  assert.equal(snap.layers.find((r) => r.name === 'A').parentId, g.id);
  assert.equal(snap.layers.find((r) => r.name === 'C').parentId, null);
  for (const label of ['New Group', 'Group Layers', 'Ungroup Layers', 'Delete Group'])
    assert.equal(isStackUndoLabel(label), true, label);
});

test('.paintproj saves the tree and opens it; older flat projects still load', async () => {
  let layers = stack();
  const inner = createGroupLayer('Inner', 1, 1);
  layers = groupLayersPlan(layers, idsOf(layers, 'B'), inner).layers;
  const outer = createGroupLayer('Outer', 1, 1);
  layers = groupLayersPlan(layers, [byName(layers, 'A').id, inner.id], outer).layers;
  outer.blendMode = 'multiply';
  outer.opacity = 0.5;
  outer.collapsed = false;
  // Background, A, B, Inner, Outer, C
  assert.deepEqual(names(layers), ['Background', 'A', 'B', 'Inner', 'Outer', 'C']);

  const saved = serializeProject(
    { layers, activeLayerIdx: 4, bgColor: '#fff', color: '#000' },
    1,
    1
  );
  assert.deepEqual(
    saved.layers.map((l) => l.name),
    ['Background', 'Outer', 'C'],
    'the top level'
  );
  const o = saved.layers[1];
  assert.equal(o.kind, 'group');
  assert.equal(o.blendMode, 'multiply');
  assert.equal(o.opacity, 0.5);
  assert.equal(o.collapsed, false);
  assert.deepEqual(
    o.children.map((l) => l.name),
    ['A', 'Inner']
  );
  assert.equal(o.children[1].kind, 'group');
  assert.equal(o.children[1].collapsed, true);
  assert.deepEqual(
    o.children[1].children.map((l) => l.name),
    ['B']
  );
  assert.equal('dataUrl' in o, false, 'a group has no pixels');

  const strip = (nodes) =>
    nodes.forEach((n) => {
      delete n.dataUrl;
      if (n.children) strip(n.children);
    });
  const copy = JSON.parse(JSON.stringify(saved));
  strip(copy.layers);
  let loaded = null;
  await deserializeProject(copy, (d) => (loaded = d));
  const ls = loaded.layers;
  assert.deepEqual(names(ls), ['Background', 'A', 'B', 'Inner', 'Outer', 'C']);
  assert.deepEqual(parents(ls), [null, 'Outer', 'Inner', 'Outer', null, null]);
  const lo = byName(ls, 'Outer');
  assert.deepEqual(
    [lo.kind, lo.blendMode, lo.opacity, lo.collapsed],
    ['group', 'multiply', 0.5, false]
  );
  assert.equal(byName(ls, 'Inner').blendMode, PASS_THROUGH);
  assert.equal(ls[0].background, true);
  assert.equal(loaded.activeLayerIdx, 4);

  // An older file: a flat list with no kind 'group' and no parents.
  const old = { ...copy, layers: [{ name: 'Background', background: true }, { name: 'L1' }] };
  await deserializeProject(old, (d) => (loaded = d));
  assert.deepEqual(names(loaded.layers), ['Background', 'L1']);
  assert.deepEqual(parents(loaded.layers), [null, null]);
  assert.equal(loaded.layers.some(isGroupLayer), false);
});

// ── The Layers panel ─────────────────────────────────────────────────────────

test('Layers panel: indented children, a disclosure triangle, and an enabled group button', async () => {
  const { window } = new JSDOM('<!doctype html><body><div id="layers"></div></body>');
  globalThis.document = window.document;
  try {
    const noop = new Proxy({}, { get: () => () => {} });
    window.HTMLCanvasElement.prototype.getContext = () => noop;
    const { renderLayerPanel } = await import('../paint/layers.js');
    const canvas = window.document.createElement('canvas');
    const base = { visible: true, opacity: 1, blendMode: 'source-over', canvas };
    const layers = [
      { ...base, id: 1, name: 'A', kind: 'pixel', parentId: 3 },
      { ...base, id: 2, name: 'B', kind: 'pixel', parentId: 3 },
      { ...base, id: 3, name: 'Group 1', kind: 'group', parentId: null, blendMode: PASS_THROUGH },
      { ...base, id: 4, name: 'C', kind: 'pixel', parentId: null }
    ];
    const calls = [];
    const callbacks = new Proxy(
      {},
      { get: (_, key) => (key === 'maskTarget' ? false : (...a) => calls.push([key, ...a])) }
    );
    const container = window.document.getElementById('layers');
    renderLayerPanel(layers, 2, container, callbacks);
    const rows = [...container.querySelectorAll('.layer-row')];
    assert.deepEqual(
      rows.map((r) => [r.querySelector('.layer-name').textContent, r.dataset.depth ?? '0']),
      [
        ['C', '0'],
        ['Group 1', '0'],
        ['B', '1'],
        ['A', '1']
      ]
    );
    const groupRow = rows[1];
    assert.ok(groupRow.classList.contains('layer-group-row'));
    assert.equal(groupRow.getAttribute('aria-expanded'), 'true');
    assert.ok(groupRow.querySelector('.layer-group-icon svg'), 'a folder, not a thumbnail');
    const blend = container.querySelector('.layer-blend');
    assert.equal(blend.value, PASS_THROUGH, 'the active group shows Pass Through');
    assert.equal(blend.options[0].textContent, 'Pass Through');

    groupRow.querySelector('.layer-disclosure').click();
    assert.deepEqual(calls.at(-1), ['onToggleCollapsed', 2]);

    layers[2].collapsed = true;
    renderLayerPanel(layers, 2, container, callbacks);
    assert.deepEqual(
      [...container.querySelectorAll('.layer-name')].map((n) => n.textContent),
      ['C', 'Group 1'],
      'a collapsed group hides its layers'
    );
    assert.equal(
      container.querySelector('.layer-group-row').getAttribute('aria-expanded'),
      'false'
    );

    const btn = container.querySelector('.layer-footer-btn[data-action="group"]');
    assert.equal(btn.disabled, false);
    btn.click();
    assert.deepEqual(calls.at(-1), ['onNewGroup', false]);
    assert.equal(
      container.querySelector('.layer-footer-btn[data-action="mask"]').disabled,
      true,
      'no mask on a group'
    );
  } finally {
    globalThis.document = fakeDocument;
  }
});
