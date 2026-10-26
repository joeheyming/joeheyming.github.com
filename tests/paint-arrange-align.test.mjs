import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  alignMoves,
  alignTarget,
  alphaBounds,
  applyArrangePlan,
  arrangePlan,
  distributeMoves,
  reversePlan,
  unionBounds
} from '../paint/layer-arrange.js';
import { COMMANDS_BY_ID, commandForKey } from '../paint/commands.js';
import { TOOL_OPTION_SCHEMA, defaultToolOptions, offsetLayerPixels } from '../paint/tools.js';
import { renderToolOptions } from '../paint/ui.js';

const isBg = (l) => l.background === true;
const L = (id, parentId = null, kind = 'pixel') => ({
  id,
  name: id,
  kind,
  parentId,
  ...(id === 'bg' ? { background: true } : {})
});
const ids = (layers) => layers.map((l) => l.id);

function stack() {
  return [L('bg'), L('a'), L('b'), L('c')];
}

function arranged(layers, id, delta) {
  const plan = arrangePlan(
    layers,
    layers.findIndex((l) => l.id === id),
    delta,
    isBg
  );
  return plan && ids(applyArrangePlan(plan));
}

test('Bring Forward, Send Backward, Bring to Front and Send to Back reorder the stack', () => {
  assert.deepEqual(arranged(stack(), 'a', 1), ['bg', 'b', 'a', 'c']);
  assert.deepEqual(arranged(stack(), 'c', -1), ['bg', 'a', 'c', 'b']);
  assert.deepEqual(arranged(stack(), 'a', Infinity), ['bg', 'b', 'c', 'a']);
  assert.deepEqual(arranged(stack(), 'c', -Infinity), ['bg', 'c', 'a', 'b']);
});

test('the Background never moves and nothing goes below it', () => {
  for (const d of [1, -1, Infinity, -Infinity]) assert.equal(arranged(stack(), 'bg', d), null);
  assert.equal(arranged(stack(), 'a', -1), null);
  assert.equal(arranged(stack(), 'a', -Infinity), null);
  assert.equal(arranged(stack(), 'c', 1), null);
  // Without a Background the bottom slot is free.
  assert.deepEqual(arranged([L('a'), L('b')], 'b', -1), ['b', 'a']);
});

test('Arrange moves among siblings: inside a group, or a group with its contents', () => {
  const tree = () => [L('bg'), L('x', 'g'), L('y', 'g'), L('g', null, 'group'), L('z')];
  assert.deepEqual(arranged(tree(), 'x', 1), ['bg', 'y', 'x', 'g', 'z']);
  // Bring to Front stays inside the group.
  assert.deepEqual(arranged(tree(), 'x', Infinity), ['bg', 'y', 'x', 'g', 'z']);
  assert.deepEqual(arranged(tree(), 'g', 1), ['bg', 'z', 'x', 'y', 'g']);
  assert.deepEqual(arranged(tree(), 'z', -Infinity), ['bg', 'z', 'x', 'y', 'g']);
  const layers = tree();
  const out = applyArrangePlan(arrangePlan(layers, 3, 1, isBg));
  assert.deepEqual(
    out.map((l) => l.parentId),
    [null, null, 'g', 'g', null]
  );
});

test('Reverse swaps the selected layers top for bottom', () => {
  const layers = stack();
  assert.deepEqual(ids(applyArrangePlan(reversePlan(layers, ['a', 'b', 'c'], isBg))), [
    'bg',
    'c',
    'b',
    'a'
  ]);
  assert.deepEqual(ids(applyArrangePlan(reversePlan(stack(), ['a', 'c'], isBg))), [
    'bg',
    'c',
    'b',
    'a'
  ]);
  assert.ok(reversePlan(stack(), ['a'], isBg).error, 'needs two or more');
  assert.ok(reversePlan(stack(), ['bg', 'c'], isBg).error, 'the Background stays');
});

test('Reverse across groups trades slots and parents, and writes nothing until applied', () => {
  const tree = () => [L('bg'), L('x', 'g'), L('y', 'g'), L('g', null, 'group'), L('z')];
  const layers = tree();
  const plan = reversePlan(layers, ['x', 'z'], isBg);
  assert.equal(layers[1].parentId, 'g', 'the plan has not touched parentIds');
  const out = applyArrangePlan(plan);
  assert.deepEqual(ids(out), ['bg', 'z', 'y', 'g', 'x']);
  assert.equal(out.find((l) => l.id === 'z').parentId, 'g');
  assert.equal(out.find((l) => l.id === 'x').parentId, null);
  // A selected group carries its children; a child inside it is not reversed on its own.
  const g = applyArrangePlan(reversePlan(tree(), ['g', 'x', 'z'], isBg));
  assert.deepEqual(ids(g), ['bg', 'z', 'x', 'y', 'g']);
});

test('the Layer › Arrange commands carry PhotoCraft shortcuts and enable rules', () => {
  const ev = (key, code, shiftKey) => ({ key, code, metaKey: true, shiftKey });
  assert.equal(commandForKey(ev('}', 'BracketRight', true)).id, 'layer.arrange.bringToFront');
  assert.equal(commandForKey(ev(']', 'BracketRight', false)).id, 'layer.arrange.bringForward');
  assert.equal(commandForKey(ev('[', 'BracketLeft', false)).id, 'layer.arrange.sendBackward');
  assert.equal(commandForKey(ev('{', 'BracketLeft', true)).id, 'layer.arrange.sendToBack');

  const at = (activeId, selected) => {
    const layers = stack();
    return {
      layers,
      activeLayerIdx: layers.findIndex((l) => l.id === activeId),
      selectedLayers: new Set(selected),
      layerSelectionFor: activeId,
      layerAnchor: activeId
    };
  };
  const on = (id, state) => COMMANDS_BY_ID.get(id).enabled(state);
  assert.equal(on('layer.arrange.bringForward', at('bg', ['bg'])), false);
  assert.equal(on('layer.arrange.bringForward', at('a', ['a'])), true);
  assert.equal(on('layer.arrange.reverse', at('a', ['a'])), false);
  assert.equal(on('layer.arrange.reverse', at('a', ['a', 'b'])), true);
  assert.equal(on('layer.align.topEdges', at('a', ['a'])), true);
  assert.equal(on('layer.distribute.topEdges', at('a', ['a', 'b'])), false);
  assert.equal(on('layer.distribute.topEdges', at('a', ['a', 'b', 'c'])), true);

  const calls = [];
  const ctx = {
    arrangeLayer: (d) => calls.push(['arrange', d]),
    reverseLayers: () => calls.push(['reverse']),
    alignLayers: (k) => calls.push(['align', k]),
    distributeLayers: (k) => calls.push(['distribute', k])
  };
  COMMANDS_BY_ID.get('layer.arrange.bringToFront').run(ctx);
  COMMANDS_BY_ID.get('layer.arrange.sendBackward').run(ctx);
  COMMANDS_BY_ID.get('layer.arrange.reverse').run(ctx);
  COMMANDS_BY_ID.get('layer.align.rightEdges').run(ctx);
  COMMANDS_BY_ID.get('layer.distribute.vertically').run(ctx);
  assert.deepEqual(calls, [
    ['arrange', Infinity],
    ['arrange', -1],
    ['reverse'],
    ['align', 'rightEdges'],
    ['distribute', 'vertically']
  ]);
});

test('alphaBounds is the opaque box of a layer', () => {
  const W = 5,
    H = 4;
  const data = new Uint8ClampedArray(W * H * 4);
  assert.equal(alphaBounds(data, W, H), null);
  data[(1 * W + 2) * 4 + 3] = 255;
  data[(2 * W + 3) * 4 + 3] = 1;
  assert.deepEqual(alphaBounds(data, W, H), { x0: 2, y0: 1, x1: 4, y1: 3 });
  assert.deepEqual(
    unionBounds([{ x0: 2, y0: 1, x1: 4, y1: 3 }, null, { x0: 0, y0: 2, x1: 1, y1: 4 }]),
    { x0: 0, y0: 1, x1: 4, y1: 4 }
  );
});

const A = { id: 'A', rect: { x0: 0, y0: 0, x1: 10, y1: 10 } };
const B = { id: 'B', rect: { x0: 20, y0: 5, x1: 30, y1: 25 } };

test('Align offsets meet each edge of the target', () => {
  const target = alignTarget([A, B], null, { x0: 0, y0: 0, x1: 100, y1: 100 }, 2);
  assert.deepEqual(target, { x0: 0, y0: 0, x1: 30, y1: 25 }, 'two layers align to each other');
  const d = (kind) => alignMoves([A, B], target, kind).map((m) => [m.id, m.dx, m.dy]);
  assert.deepEqual(d('leftEdges'), [
    ['A', 0, 0],
    ['B', -20, 0]
  ]);
  assert.deepEqual(d('rightEdges'), [
    ['A', 20, 0],
    ['B', 0, 0]
  ]);
  assert.deepEqual(d('horizontalCenters'), [
    ['A', 10, 0],
    ['B', -10, 0]
  ]);
  assert.deepEqual(d('topEdges'), [
    ['A', 0, 0],
    ['B', 0, -5]
  ]);
  assert.deepEqual(d('bottomEdges'), [
    ['A', 0, 15],
    ['B', 0, 0]
  ]);
  // Doubled centres: (25 - 10) / 2 floors to 7, (25 - 30) / 2 to -3 (div_euclid).
  assert.deepEqual(d('verticalCenters'), [
    ['A', 0, 7],
    ['B', 0, -3]
  ]);
});

test('Align targets the selection, else the canvas for a single layer', () => {
  const canvas = { x0: 0, y0: 0, x1: 100, y1: 80 };
  const sel = { x0: 40, y0: 30, x1: 60, y1: 50 };
  assert.deepEqual(alignTarget([A, B], sel, canvas, 2), sel);
  assert.deepEqual(alignTarget([A], null, canvas, 1), canvas);
  assert.deepEqual(alignMoves([A], canvas, 'rightEdges'), [{ id: 'A', dx: 90, dy: 0 }]);
  assert.deepEqual(alignMoves([A], sel, 'verticalCenters'), [{ id: 'A', dx: 0, dy: 35 }]);
});

const row = (id, x0, x1) => ({ id, rect: { x0, y0: 0, x1, y1: 10 } });
const col = (id, y0, y1) => ({ id, rect: { x0: 0, y0, x1: 10, y1 } });
const byId = (moves) => Object.fromEntries(moves.map((m) => [m.id, [m.dx, m.dy]]));

test('Distribute spaces edges and centres evenly, the outermost staying put', () => {
  const items = [row('C', 40, 50), row('A', 0, 10), row('B', 12, 32)];
  assert.deepEqual(byId(distributeMoves(items, 'leftEdges')), {
    A: [0, 0],
    B: [8, 0],
    C: [0, 0]
  });
  // Doubled right edges 20, 64, 100: B wants 60.
  assert.deepEqual(byId(distributeMoves(items, 'rightEdges')), {
    A: [0, 0],
    B: [-2, 0],
    C: [0, 0]
  });
  assert.deepEqual(byId(distributeMoves(items, 'horizontalCenters')), {
    A: [0, 0],
    B: [3, 0],
    C: [0, 0]
  });
  const v = [col('A', 0, 10), col('B', 12, 32), col('C', 40, 50)];
  assert.deepEqual(byId(distributeMoves(v, 'topEdges')), { A: [0, 0], B: [0, 8], C: [0, 0] });
  assert.deepEqual(byId(distributeMoves(v, 'bottomEdges')), { A: [0, 0], B: [0, -2], C: [0, 0] });
  assert.deepEqual(byId(distributeMoves(v, 'verticalCenters')), {
    A: [0, 0],
    B: [0, 3],
    C: [0, 0]
  });
  assert.equal(distributeMoves(items.slice(0, 2), 'leftEdges'), null);
});

test('Distribute rounds halves away from zero like PhotoCraft', () => {
  // Doubled left edges 0, 52, 82: B wants 41, so it moves (41 - 52) / 2 = -5.5 → -6.
  const items = [row('A', 0, 4), row('B', 26, 30), row('C', 41, 45)];
  assert.deepEqual(byId(distributeMoves(items, 'leftEdges')).B, [-6, 0]);
});

test('Distribute Horizontally / Vertically equalize the gaps', () => {
  const items = [row('A', 0, 10), row('B', 12, 32), row('C', 40, 50)];
  // Span 50, widths 40: two gaps of 5, so B starts at 15.
  assert.deepEqual(byId(distributeMoves(items, 'horizontally')), {
    A: [0, 0],
    B: [3, 0],
    C: [0, 0]
  });
  const v = [col('A', 0, 10), col('B', 30, 34), col('C', 40, 50)];
  // Span 50, heights 24: gaps of 13, so B starts at 23.
  assert.deepEqual(byId(distributeMoves(v, 'vertically')), { A: [0, 0], B: [0, -7], C: [0, 0] });
});

function withDocument(fn) {
  const dom = new JSDOM('<!doctype html><div id="opts"></div>');
  const saved = { document: globalThis.document };
  globalThis.document = dom.window.document;
  try {
    fn(dom.window.document.getElementById('opts'));
  } finally {
    globalThis.document = saved.document;
  }
}

test('the Move options bar runs the align and distribute commands (align_bar.rs)', () => {
  withDocument((container) => {
    const changes = [];
    const values = { ...defaultToolOptions().select, canAlign: true, canDistribute: false };
    renderToolOptions(TOOL_OPTION_SCHEMA.select, values, container, (k, v) => changes.push([k, v]));
    const icons = [...container.querySelectorAll('button.tool-opt-icon')];
    assert.deepEqual(
      icons.map((b) => b.title),
      [
        'Align: Left Edges',
        'Align: Horizontal Centers',
        'Align: Right Edges',
        'Align: Top Edges',
        'Align: Vertical Centers',
        'Align: Bottom Edges',
        'Align and distribute'
      ]
    );
    icons[2].click();
    assert.deepEqual(changes.pop(), ['_layerCommand', 'layer.align.rightEdges']);
    const items = [...container.querySelectorAll('.action-menu-item')];
    assert.equal(items.length, 14);
    const distH = items.find((b) => b.dataset.command === 'layer.distribute.horizontally');
    assert.equal(distH.disabled, true, 'distribute needs three layers');
    const alignTop = items.find((b) => b.dataset.command === 'layer.align.topEdges');
    assert.equal(alignTop.disabled, false);
    alignTop.click();
    assert.deepEqual(changes.pop(), ['_layerCommand', 'layer.align.topEdges']);
    for (const id of items.map((b) => b.dataset.command)) assert.ok(COMMANDS_BY_ID.has(id), id);
  });
  withDocument((container) => {
    const values = { ...defaultToolOptions().select, canAlign: false, canDistribute: false };
    renderToolOptions(TOOL_OPTION_SCHEMA.select, values, container, () => {});
    assert.equal(container.querySelector('#opt-align-leftEdges').disabled, true);
  });
});

test('Align Right Edges moves the layer pixels so their opaque boxes share a right edge', () => {
  const W = 8,
    H = 4;
  const layer = (x, y) => {
    const d = new Uint8ClampedArray(W * H * 4);
    d[(y * W + x) * 4 + 3] = 255;
    return d;
  };
  const layers = { A: layer(1, 1), B: layer(5, 2) };
  const items = Object.entries(layers).map(([id, d]) => ({ id, rect: alphaBounds(d, W, H) }));
  const target = alignTarget(items, null, { x0: 0, y0: 0, x1: W, y1: H }, 2);
  for (const { id, dx, dy } of alignMoves(items, target, 'rightEdges')) {
    layers[id] = offsetLayerPixels(layers[id], W, H, dx, dy);
  }
  assert.deepEqual(alphaBounds(layers.A, W, H), { x0: 5, y0: 1, x1: 6, y1: 2 });
  assert.deepEqual(alphaBounds(layers.B, W, H), { x0: 5, y0: 2, x1: 6, y1: 3 });
  assert.equal(layers.A[(1 * W + 5) * 4 + 3], 255);
  assert.equal(layers.A[(1 * W + 1) * 4 + 3], 0, 'the old pixel is cleared');
});
