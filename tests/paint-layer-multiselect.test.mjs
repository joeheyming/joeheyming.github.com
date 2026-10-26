import { test } from 'node:test';
import assert from 'node:assert/strict';

// createLayer needs document.createElement('canvas'); an ImageData-backed stub keeps this
// test browser-free.
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

globalThis.document = { createElement: () => fakeCanvas() };

const {
  allLayerIds,
  applyMergePlan,
  clickLayerSelection,
  hiddenLayersPlan,
  mergeLayersPlan,
  mergeVisiblePlan,
  removeLayersAt,
  stateLayerSelection,
  syncLayerSelection
} = await import('../paint/layer-multi.js');
const { createLayer } = await import('../paint/layers.js');
const { COMMANDS, commandForKey } = await import('../paint/commands.js');
const { isStackUndoLabel } = await import('../paint/stack-history.js');

const W = 2,
  H = 1;

function layer(name, rgba, opts = {}) {
  const l = createLayer(name, W, H);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(rgba[p] ?? [0, 0, 0, 0], p * 4);
  l.ctx.putImageData({ width: W, height: H, data }, 0, 0);
  return Object.assign(l, opts);
}

const pixels = (l) => Array.from(l.ctx.getImageData(0, 0, W, H).data);

// Normal "over" with layer opacity, standing in for flattenToCanvas(…, { transparentBg: true }).
function flatten(layers) {
  const out = fakeCanvas();
  out.width = W;
  out.height = H;
  const dst = new Float64Array(W * H * 4);
  for (const l of layers) {
    const src = l.ctx.getImageData(0, 0, W, H).data;
    for (let p = 0; p < W * H; p++) {
      const sa = (src[p * 4 + 3] / 255) * l.opacity;
      const da = dst[p * 4 + 3];
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst[p * 4 + c] = oa ? (src[p * 4 + c] * sa + dst[p * 4 + c] * da * (1 - sa)) / oa : 0;
      }
      dst[p * 4 + 3] = oa;
    }
  }
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.round(dst[p * 4 + c]);
    data[p * 4 + 3] = Math.round(dst[p * 4 + 3] * 255);
  }
  out.getContext('2d').putImageData({ data }, 0, 0);
  return out;
}

const RED = [255, 0, 0, 255],
  BLUE = [0, 0, 255, 255],
  GREEN = [0, 255, 0, 255],
  CLEAR = [0, 0, 0, 0];

test('a plain click selects one layer; Ctrl/Cmd-click toggles; Shift-click takes the range', () => {
  const order = [1, 2, 3, 4, 5];
  let sel = clickLayerSelection({ ids: [1], active: 1, anchor: 1 }, 2, 'replace', order);
  assert.deepEqual(sel, { ids: [2], active: 2, anchor: 2 });

  sel = clickLayerSelection(sel, 4, 'toggle', order);
  assert.deepEqual(sel, { ids: [2, 4], active: 4, anchor: 4 });
  // Toggling the active layer off hands the active role to the last remaining one.
  sel = clickLayerSelection(sel, 4, 'toggle', order);
  assert.deepEqual(sel, { ids: [2], active: 2, anchor: 2 });
  // The last selected layer stays selected.
  sel = clickLayerSelection(sel, 2, 'toggle', order);
  assert.deepEqual(sel.ids, [2]);

  // Shift-click from the anchor, in either direction; the anchor stays put.
  sel = clickLayerSelection(sel, 5, 'range', order);
  assert.deepEqual(sel, { ids: [2, 3, 4, 5], active: 5, anchor: 2 });
  sel = clickLayerSelection(sel, 1, 'range', order);
  assert.deepEqual(sel, { ids: [1, 2], active: 1, anchor: 2 });
});

test('the selection follows the active layer and drops layers that left the stack', () => {
  const a = { id: 10 },
    b = { id: 11 },
    c = { id: 12 };
  // Made for layer 11 (index 1): kept, minus the deleted 13.
  const sel = { ids: [10, 11, 13], active: 11, anchor: 10 };
  assert.deepEqual(syncLayerSelection([a, b, c], 1, sel), {
    ids: [10, 11],
    active: 11,
    anchor: 10
  });
  // Something else made layer 12 active (a new layer, an undo): just that layer.
  assert.deepEqual(syncLayerSelection([a, b, c], 2, sel), { ids: [12], active: 12, anchor: 12 });
  // Deselect Layers is an empty list for the active layer.
  const none = { ids: [], active: 11, anchor: null };
  assert.deepEqual(syncLayerSelection([a, b, c], 1, none).ids, []);
  const state = {
    layers: [a, b, c],
    activeLayerIdx: 1,
    selectedLayers: new Set([10, 11]),
    layerSelectionFor: 11
  };
  assert.deepEqual(stateLayerSelection(state).ids, [10, 11]);
});

test('Select › All Layers takes every layer but the Background', () => {
  const bg = layer('Background', [RED, RED], { background: true });
  const a = layer('Layer 1', []);
  const b = layer('Layer 2', []);
  assert.deepEqual(allLayerIds([bg, a, b]), [a.id, b.id]);
  assert.deepEqual(allLayerIds([bg]), []);
});

test('Merge Layers composites the visible selected layers at the top one and drops the rest', () => {
  const bg = layer('Background', [RED, RED], { background: true });
  const a = layer('Layer 1', [BLUE, CLEAR]);
  const hidden = layer('Layer 2', [GREEN, GREEN], { visible: false });
  const b = layer('Layer 3', [CLEAR, [0, 255, 0, 255]], { opacity: 0.5 });
  const top = layer('Layer 4', [GREEN, GREEN]);
  const layers = [bg, a, hidden, b, top];

  const plan = mergeLayersPlan(layers, [a.id, hidden.id, b.id]);
  assert.deepEqual(plan, { keep: 3, remove: [1, 2], sources: [1, 3], name: 'Layer 3' });
  const { merged, removed } = applyMergePlan(layers, plan, flatten);
  assert.deepEqual(
    layers.map((l) => l.name),
    ['Background', 'Layer 3', 'Layer 4']
  );
  assert.equal(merged, b);
  assert.deepEqual(removed, [a, hidden]);
  // Blue, and the half-opacity green baked in (alpha 128) at a 100 % layer.
  assert.deepEqual(pixels(merged), [0, 0, 255, 255, 0, 255, 0, 128]);
  assert.equal(merged.opacity, 1);
  assert.equal(merged.blendMode, 'source-over');

  // With the Background in the selection, the result stays the Background.
  const layers2 = [layer('Background', [RED, RED], { background: true }), layer('L', [BLUE])];
  const bgPlan = mergeLayersPlan(
    layers2,
    layers2.map((l) => l.id)
  );
  assert.equal(bgPlan.keep, 0);
  const res = applyMergePlan(layers2, bgPlan, flatten);
  assert.equal(layers2.length, 1);
  assert.equal(res.merged.background, true);
  assert.equal(res.merged.name, 'Background');
  assert.deepEqual(pixels(res.merged), [...BLUE, ...RED]);

  assert.ok(mergeLayersPlan(layers, [top.id]).error);
  const allHidden = [layer('x', [], { visible: false }), layer('y', [], { visible: false })];
  assert.match(
    mergeLayersPlan(
      allHidden,
      allHidden.map((l) => l.id)
    ).error,
    /hidden/
  );
});

test('Merge Visible merges into the lowest visible layer and leaves hidden layers in place', () => {
  const bg = layer('Background', [RED, RED], { background: true });
  const hidden = layer('Layer 1', [GREEN, GREEN], { visible: false });
  const a = layer('Layer 2', [BLUE, CLEAR]);
  const hidden2 = layer('Layer 3', [GREEN, GREEN], { visible: false });
  const layers = [bg, hidden, a, hidden2];
  const plan = mergeVisiblePlan(layers);
  assert.deepEqual(plan, { keep: 0, remove: [2], sources: [0, 2], name: 'Background' });
  const { merged } = applyMergePlan(layers, plan, flatten);
  assert.deepEqual(layers, [bg, hidden, hidden2]);
  assert.equal(merged, bg);
  assert.equal(bg.background, true);
  assert.deepEqual(pixels(bg), [...BLUE, ...RED]);
  // Hidden pixels did not leak in.
  assert.deepEqual(pixels(hidden), [...GREEN, ...GREEN]);

  assert.match(mergeVisiblePlan([bg, hidden]).error, /not enough visible/);
});

test('Delete › Hidden Layers removes every hidden layer but never the last one', () => {
  const a = layer('a', []);
  const b = layer('b', [], { visible: false });
  const c = layer('c', []);
  const d = layer('d', [], { visible: false });
  const layers = [a, b, c, d];
  const plan = hiddenLayersPlan(layers);
  assert.deepEqual(plan.remove, [1, 3]);
  assert.deepEqual(removeLayersAt(layers, plan.remove), [b, d]);
  assert.deepEqual(layers, [a, c]);
  assert.deepEqual(hiddenLayersPlan(layers).remove, []);
  assert.ok(hiddenLayersPlan([b, d]).error);
});

test('the commands sit where PhotoCraft puts them, with its shortcuts and undo rows', () => {
  const by = new Map(COMMANDS.map((c) => [c.id, c]));
  assert.deepEqual(by.get('select.allLayers').menu, ['Select']);
  assert.equal(by.get('select.allLayers').shortcut, 'Cmd+Alt+A');
  assert.deepEqual(by.get('select.deselectLayers').menu, ['Select']);
  assert.deepEqual(by.get('layer.mergeLayers').menu, ['Layer']);
  assert.equal(by.get('layer.mergeLayers').shortcut, 'Cmd+E');
  assert.deepEqual(by.get('layer.mergeVisible').menu, ['Layer']);
  assert.equal(by.get('layer.mergeVisible').shortcut, 'Cmd+Shift+E');
  assert.deepEqual(by.get('layer.delete.hiddenLayers').menu, ['Layer', 'Delete']);

  const key = (code, mods) => ({ code, key: code.slice(3).toLowerCase(), ...mods });
  assert.equal(commandForKey(key('KeyA', { metaKey: true, altKey: true })).id, 'select.allLayers');
  assert.equal(
    commandForKey(key('KeyE', { ctrlKey: true, shiftKey: true })).id,
    'layer.mergeVisible'
  );
  assert.equal(commandForKey(key('KeyE', { metaKey: true })).id, 'layer.mergeLayers');

  // Merge Layers is enabled for two selected layers even when Merge Down could not run.
  const bg = { id: 1, background: true, visible: true };
  const a = { id: 2, visible: true };
  const b = { id: 3, visible: false };
  const state = {
    layers: [bg, a, b],
    activeLayerIdx: 0,
    selectedLayers: new Set([1, 2]),
    layerSelectionFor: 1
  };
  assert.equal(by.get('layer.mergeLayers').enabled(state), true);
  assert.equal(
    by.get('layer.mergeLayers').enabled({ ...state, selectedLayers: new Set([1]) }),
    false
  );
  assert.equal(by.get('layer.mergeVisible').enabled(state), true);
  assert.equal(by.get('layer.delete.hiddenLayers').enabled(state), true);
  assert.equal(by.get('layer.delete.hiddenLayers').enabled({ layers: [bg, a] }), false);

  const ran = [];
  const ctx = new Proxy({}, { get: (_, name) => () => ran.push(name) });
  for (const id of [
    'select.allLayers',
    'select.deselectLayers',
    'layer.mergeLayers',
    'layer.mergeVisible',
    'layer.delete.hiddenLayers'
  ])
    by.get(id).run(ctx);
  assert.deepEqual(ran, [
    'selectAllLayers',
    'deselectLayers',
    'mergeLayers',
    'mergeVisible',
    'deleteHiddenLayers'
  ]);
  for (const label of ['Merge Layers', 'Merge Visible', 'Delete Hidden Layers'])
    assert.equal(isStackUndoLabel(label), true, label);
});
