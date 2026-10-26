import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  BUILTIN_SHAPE_GROUPS,
  RASTERIZE_SHAPE_MESSAGE,
  defineCustomShape,
  editShape,
  fillet,
  fitPath,
  linePath,
  nextShapeLayerName,
  normalizeShape,
  parseShapeSource,
  pathBounds,
  polygonPoints,
  rectPath,
  renderShapesPanel,
  shapeFromDrag,
  shapeFromJSON,
  shapeLayerBase,
  shapeMask,
  shapeNeedsRasterize,
  shapeToJSON,
  translateShape
} from '../paint/shapes.js';
import { TOOLS, TOOL_OPTION_SCHEMA, syncCustomShapeOptions } from '../paint/tools.js';
import { TOOL_GROUPS, toolKey } from '../paint/tool-groups.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';
import { DOCK_PANELS } from '../paint/window-panels.js';
import { emptyPaths, withTargetPath } from '../paint/paths.js';
import { restoreStack, snapshotStack, isStackUndoLabel } from '../paint/stack-history.js';

// Shape layers (PhotoCraft doc ShapeLayer / LiveShape, vector shapes.rs): the Shape tools make a
// layer that keeps a path, fill, and stroke; its pixels are drawn from them until rasterized.

// layers.js / project.js need document.createElement('canvas'): a byte-backed stub whose context
// records the path calls, so the tests can see what a shape layer draws.
function fakeCanvas() {
  const canvas = { width: 0, height: 0, className: '', dataset: {}, style: {}, pixels: null };
  const ensure = () => {
    if (!canvas.pixels || canvas.pixels.length !== canvas.width * canvas.height * 4) {
      canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    }
  };
  const ctx = {
    canvas,
    ops: [],
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData(x, y, w, h) {
      ensure();
      return { width: w, height: h, data: canvas.pixels.slice() };
    },
    putImageData(img) {
      ensure();
      canvas.pixels.set(img.data);
    },
    clearRect() {
      ctx.ops = [];
    },
    save() {},
    restore() {},
    beginPath() {
      ctx.ops.push(['beginPath']);
    },
    moveTo(x, y) {
      ctx.ops.push(['moveTo', x, y]);
    },
    bezierCurveTo(...a) {
      ctx.ops.push(['bezierCurveTo', ...a]);
    },
    closePath() {
      ctx.ops.push(['closePath']);
    },
    rect() {},
    clip(rule) {
      ctx.ops.push(['clip', rule]);
    },
    fill(rule) {
      ctx.ops.push(['fill', ctx.fillStyle, rule]);
    },
    stroke() {
      ctx.ops.push(['stroke', ctx.strokeStyle, ctx.lineWidth]);
    },
    drawImage() {}
  };
  canvas.getContext = () => ctx;
  canvas.toDataURL = () => '';
  return canvas;
}
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    return fakeCanvas();
  }
};
const { createLayer, createShapeLayer, copyLayerContents, canMergeDown, renderShapeLayer } =
  await import('../paint/layers.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');

const W = 120,
  H = 100;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const anchors = (s) => s.path.subpaths[0].anchors;

test('polygonPoints: a regular polygon inscribed in the box, first vertex at the top', () => {
  const pts = polygonPoints(0, 0, 100, 100, 5);
  assert.equal(pts.length, 5);
  assert.ok(close(pts[0][0], 50) && close(pts[0][1], 0), `first ${pts[0]}`);
  for (const [i, [x, y]] of pts.entries()) {
    assert.ok(close(Math.hypot(x - 50, y - 50), 50), `vertex ${i} radius`);
    const deg = (Math.atan2(y - 50, x - 50) * 180) / Math.PI;
    const want = ((-90 + 72 * i + 540) % 360) - 180;
    assert.ok(close(deg, want, 1e-6), `vertex ${i} at ${deg}°, want ${want}°`);
  }
  // Clockwise on screen (y down): the second vertex is to the right of the first.
  assert.ok(pts[1][0] > pts[0][0]);
  // A wide box gives the ellipse's radii; sides clamp to 3…100.
  const wide = polygonPoints(10, 20, 200, 100, 4);
  assert.deepEqual(
    wide.map(([x, y]) => [Math.round(x), Math.round(y)]),
    [
      [110, 20],
      [210, 70],
      [110, 120],
      [10, 70]
    ]
  );
  assert.equal(polygonPoints(0, 0, 10, 10, 1).length, 3);
  assert.equal(polygonPoints(0, 0, 10, 10, 500).length, 100);
});

test('star: twice the vertices, the odd ones at starRatio of the outer radius', () => {
  const pts = polygonPoints(0, 0, 100, 100, 5, 0.4);
  assert.equal(pts.length, 10);
  pts.forEach(([x, y], i) => {
    const r = Math.hypot(x - 50, y - 50);
    assert.ok(close(r, i % 2 ? 20 : 50), `vertex ${i} radius ${r}`);
  });
  // The first inner vertex sits halfway (36°) between the first two points.
  const a = Math.atan2(pts[1][1] - 50, pts[1][0] - 50);
  assert.ok(close(a, -Math.PI / 2 + Math.PI / 5));
  // A ratio of 1 (or out of range) is a plain polygon.
  assert.equal(polygonPoints(0, 0, 100, 100, 5, 1).length, 5);
  assert.equal(polygonPoints(0, 0, 100, 100, 5, 0).length, 5);

  // The Polygon tool's Star % option makes the star; its layer keeps the ratio.
  const opts = { fill: true, fillColor: '#ff0000', sides: 6, starRatio: 50 };
  const s = shapeFromDrag('polygon', opts, 0, 0, 80, 80);
  assert.deepEqual(s.live, {
    kind: 'polygon',
    rect: [0, 0, 80, 80],
    sides: 6,
    starRatio: 0.5,
    cornerRadius: 0
  });
  assert.equal(anchors(s).length, 12);
  assert.ok(close(Math.hypot(anchors(s)[1].x - 40, anchors(s)[1].y - 40), 20));
  // Sides and Star edit the layer live: the path is built again from the new values.
  const fewer = editShape(s, 'sides', 4);
  assert.equal(anchors(fewer).length, 8);
  const plain = editShape(fewer, 'starRatio', 100);
  assert.equal(anchors(plain).length, 4);
  assert.equal(plain.live.starRatio, 1);
  assert.equal(s.live.sides, 6, 'records are not mutated');
});

test('Triangle: a 3-sided polygon whose Radius rounds every corner on a true circle', () => {
  const sharp = shapeFromDrag('triangle', { fill: true }, 0, 0, 300, 300);
  assert.equal(sharp.live.sides, 3);
  assert.equal(anchors(sharp).length, 3);
  const round = shapeFromDrag('triangle', { fill: true, radius: 20 }, 0, 0, 300, 300);
  const k = anchors(round);
  assert.equal(k.length, 6, 'two anchors per rounded vertex');
  const verts = polygonPoints(0, 0, 300, 300, 3);
  for (let i = 0; i < 3; i++) {
    const f = fillet(verts[(i + 2) % 3], verts[i], verts[(i + 1) % 3], 20);
    assert.ok(close(f.radius, 20));
    assert.deepEqual([k[2 * i].x, k[2 * i].y], f.from);
    // The cubic between the tangent points stays 20 px from the arc's centre.
    const [a, b] = [k[2 * i], k[2 * i + 1]];
    for (const t of [0.25, 0.5, 0.75]) {
      const u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      const xs = [a.x, a.out[0], b.in[0], b.x],
        ys = [a.y, a.out[1], b.in[1], b.y];
      const q = [0, 1, 2, 3].reduce((acc, j) => [acc[0] + xs[j] * w[j], acc[1] + ys[j] * w[j]], [0, 0]);
      const d = Math.hypot(q[0] - f.centre[0], q[1] - f.centre[1]);
      assert.ok(Math.abs(d - 20) < 0.1, `vertex ${i} t ${t}: ${d}`);
    }
  }
  // Radius edits the triangle live; Sides does not turn it into another polygon.
  assert.equal(anchors(editShape(sharp, 'radius', 20)).length, 6);
  assert.equal(editShape(sharp, 'sides', 7), sharp);
});

test('Rectangle, Ellipse, and Line make live shapes; ⇧ keeps a square box', () => {
  const r = shapeFromDrag('rect', { fill: true, fillColor: '#00ff00' }, 50, 40, 10, 10);
  assert.deepEqual(r.live, { kind: 'rect', rect: [10, 10, 40, 30], radii: [0, 0, 0, 0] });
  assert.equal(r.fill, '#00ff00');
  assert.deepEqual(
    anchors(r).map((a) => [a.x, a.y]),
    [
      [10, 10],
      [50, 10],
      [50, 40],
      [10, 40]
    ]
  );
  const sq = shapeFromDrag('ellipse', {}, 0, 0, 30, 10, { square: true });
  assert.deepEqual(sq.live.rect, [0, 0, 30, 30]);
  assert.equal(anchors(sq).length, 4);
  // Rounded corners: two anchors per corner, clamped like CSS border-radius.
  assert.equal(rectPath(0, 0, 40, 30, [5, 5, 5, 5]).subpaths[0].anchors.length, 8);
  const rounded = editShape(r, 'radius', 100);
  // Radii past half a side scale down until the short sides' straight edges vanish.
  assert.equal(anchors(rounded).length, 6);
  assert.deepEqual(rounded.live.radii, [100, 100, 100, 100]);
  // The Line tool: a bar Weight px thick from the press to the release.
  const line = shapeFromDrag('line', { weight: 4 }, 0, 10, 20, 10);
  assert.deepEqual(line.live, { kind: 'line', from: [0, 10], to: [20, 10], weight: 4 });
  assert.deepEqual(pathBounds(line.path), [0, 8, 20, 12]);
  assert.deepEqual(pathBounds(linePath([0, 0], [0, 10], 2)), [-1, 0, 1, 10]);
  assert.equal(editShape(line, 'weight', 10).live.weight, 10);
  // Too small a drag makes nothing.
  assert.equal(shapeFromDrag('rect', {}, 5, 5, 5.5, 9), null);
  assert.equal(shapeFromDrag('line', {}, 5, 5, 5.2, 5.2), null);
});

test('the options bar edits fill and stroke live', () => {
  const s = shapeFromDrag('ellipse', { fill: true, fillColor: '#112233' }, 0, 0, 40, 40);
  assert.equal(s.stroke, null, 'no stroke until it has a width');
  const stroked = editShape(s, 'strokeWidth', 3, { strokeColor: '#ABCDEF', strokeAlign: 'inside' });
  assert.deepEqual(stroked.stroke, { color: '#abcdef', width: 3, align: 'inside' });
  assert.deepEqual(editShape(stroked, 'strokeAlign', 'outside').stroke.align, 'outside');
  assert.equal(editShape(stroked, 'strokeColor', '#ff0000').stroke.color, '#ff0000');
  assert.equal(editShape(stroked, 'strokeWidth', 0).stroke, null);
  const noFill = editShape(stroked, 'fill', false);
  assert.equal(noFill.fill, null);
  assert.equal(editShape(noFill, 'fill', true, { fillColor: '#445566' }).fill, '#445566');
  assert.equal(editShape(noFill, 'fillColor', '#778899').fill, '#778899');
  // Geometry keys that do not fit the shape leave it as it is.
  assert.equal(editShape(s, 'weight', 8), s);

  // The options bar: Fill, its well, the stroke's well, width, and alignment on every tool.
  for (const id of ['rect', 'ellipse', 'triangle', 'polygon', 'line', 'customShape']) {
    const keys = TOOL_OPTION_SCHEMA[id].map((f) => f.key);
    assert.deepEqual(keys.slice(0, 5), ['fill', 'fillColor', 'strokeColor', 'strokeWidth', 'strokeAlign']);
  }
  assert.ok(TOOL_OPTION_SCHEMA.rect.some((f) => f.key === 'radius'));
  assert.ok(TOOL_OPTION_SCHEMA.triangle.some((f) => f.key === 'radius'));
  assert.deepEqual(
    TOOL_OPTION_SCHEMA.polygon.slice(5).map((f) => [f.key, f.default]),
    [
      ['sides', 5],
      ['starRatio', 100]
    ]
  );
});

test('a shape draws its path: even-odd fill, then an Inside stroke clipped to the path', () => {
  const s = normalizeShape({
    fill: '#ff0000',
    stroke: { color: '#0000ff', width: 4, align: 'inside' },
    live: { kind: 'rect', rect: [10, 10, 20, 20] }
  });
  const layer = createShapeLayer('Rectangle 1', s, W, H);
  assert.equal(layer.kind, 'shape');
  const ops = layer.ctx.ops;
  assert.deepEqual(ops.slice(0, 2), [['beginPath'], ['moveTo', 10, 10]]);
  assert.equal(ops.filter((o) => o[0] === 'bezierCurveTo').length, 3 * 4);
  assert.deepEqual(
    ops.filter((o) => ['fill', 'clip', 'stroke'].includes(o[0])),
    [
      ['fill', '#ff0000', 'evenodd'],
      ['clip', 'evenodd'],
      ['stroke', '#0000ff', 8]
    ]
  );
  // The fill area as a mask (sampled like scanlineFill): inside the box, not outside it.
  const mask = shapeMask(s, W, H);
  assert.equal(mask[15 * W + 15], 1);
  assert.equal(mask[29 * W + 29], 1);
  assert.equal(mask[5 * W + 5], 0);
  assert.equal(mask[15 * W + 35], 0);
  assert.equal(mask[35 * W + 15], 0);
  // Moving the layer moves its path and live box.
  const moved = translateShape(s, 5, -3);
  assert.deepEqual(moved.live.rect, [15, 7, 20, 20]);
  assert.deepEqual(pathBounds(moved.path), [15, 7, 35, 27]);
  // A shape layer is a sibling a layer cannot merge down into, and it copies with its record.
  const base = createLayer('Layer 1', W, H);
  assert.equal(canMergeDown([layer, base], 1), false);
  const copy = copyLayerContents(layer, createLayer('copy', W, H));
  assert.deepEqual(copy.shape, layer.shape);
  assert.notEqual(copy.shape, layer.shape);
});

test('shape layer round trip: .paintproj saves the record, not pixels, and draws it on load', async () => {
  const bg = createLayer('Background', W, H);
  const star = shapeFromDrag(
    'polygon',
    { fill: true, fillColor: '#123456', sides: 5, starRatio: 40, strokeWidth: 2, strokeColor: '#ffffff' },
    10,
    10,
    90,
    90
  );
  const layer = createShapeLayer('Polygon 1', star, W, H);
  layer.opacity = 0.5;
  const state = { bgColor: '#ffffff', color: '#000000', activeLayerIdx: 1, layers: [bg, layer] };
  state.objects = [];
  const data = JSON.parse(JSON.stringify(serializeProject(state, W, H)));
  assert.equal(data.layers[1].kind, 'shape');
  assert.equal(data.layers[1].dataUrl, undefined);
  assert.deepEqual(data.layers[1].shape, shapeToJSON(layer.shape));

  let restored = null;
  await deserializeProject(data, (out) => (restored = out));
  const loaded = restored.layers[1];
  assert.equal(loaded.kind, 'shape');
  assert.equal(loaded.name, 'Polygon 1');
  assert.equal(loaded.opacity, 0.5);
  assert.deepEqual(loaded.shape, layer.shape);
  assert.equal(anchors(loaded.shape).length, 10);
  assert.ok(close(Math.hypot(anchors(loaded.shape)[1].x - 50, anchors(loaded.shape)[1].y - 50), 16));
  assert.deepEqual(
    loaded.ctx.ops.filter((o) => o[0] === 'fill' || o[0] === 'stroke'),
    [
      ['fill', '#123456', 'evenodd'],
      ['stroke', '#ffffff', 2]
    ]
  );
  // A custom shape (no live geometry) keeps its path through JSON.
  const heart = shapeFromDrag('customShape', { shape: 'Heart' }, 0, 0, 50, 46);
  assert.equal(heart.live, null);
  assert.deepEqual(shapeFromJSON(JSON.parse(JSON.stringify(shapeToJSON(heart)))), heart);
  // Older files have no shape layers; a 'shape' entry without a path opens as a pixel layer.
  assert.equal(shapeFromJSON(null), null);
  assert.equal(shapeFromJSON({ fill: '#000000' }), null);
  data.layers[1].shape = null;
  await deserializeProject(data, (out) => (restored = out));
  assert.equal(restored.layers[1].kind, 'pixel');

  // Whole-stack undo keeps the record too (New Shape Layer / Rasterize Shape).
  assert.ok(isStackUndoLabel('New Shape Layer'));
  assert.ok(isStackUndoLabel('Rasterize Shape'));
  const back = restoreStack(snapshotStack([bg, layer], 1)).layers[1];
  assert.equal(back.kind, 'shape');
  assert.deepEqual(back.shape, layer.shape);
});

test('Custom Shape tool: the picked shape fitted to the drag; ⇧ keeps its proportions', () => {
  assert.deepEqual(
    BUILTIN_SHAPE_GROUPS.map((g) => g.name),
    ['Symbols', 'Arrows', 'Nature']
  );
  assert.ok(BUILTIN_SHAPE_GROUPS.every((g) => g.items.every((s) => s.path)));
  const free = shapeFromDrag('customShape', { shape: 'Diamond' }, 0, 0, 100, 50);
  assert.deepEqual(pathBounds(free.path), [0, 0, 100, 50]);
  const kept = shapeFromDrag('customShape', { shape: 'Diamond' }, 0, 0, 100, 50, { square: true });
  // The Diamond is 80 × 100: in a 100 × 100 box it is 80 wide, centred.
  assert.deepEqual(pathBounds(kept.path), [10, 0, 90, 100]);
  assert.equal(shapeFromDrag('customShape', { shape: 'Nope' }, 0, 0, 10, 10), null);
  // Ring is two circles; the even-odd fill leaves its hole.
  const ring = shapeFromDrag('customShape', { shape: 'Ring', fill: true }, 0, 0, 100, 100);
  const mask = shapeMask(ring, 100, 100);
  assert.equal(mask[50 * 100 + 50], 0);
  assert.equal(mask[50 * 100 + 9], 1);
  assert.equal(parseShapeSource('M 0 0 X 3'), null);
});

test('Edit › Define Custom Shape… saves the active path as one', () => {
  const path = {
    name: 'Work Path',
    subpaths: [
      {
        closed: true,
        anchors: [
          { x: 10, y: 10, in: [10, 10], out: [10, 10] },
          { x: 30, y: 10, in: [30, 10], out: [30, 10] },
          { x: 20, y: 40, in: [20, 40], out: [20, 40] }
        ]
      }
    ]
  };
  const first = defineCustomShape([], path, '');
  assert.equal(first.name, 'Shape 1');
  assert.equal(first.list.length, 1);
  const named = defineCustomShape(first.list, path, '  Wedge ');
  assert.equal(named.name, 'Wedge');
  // The same name again replaces it.
  const again = defineCustomShape(named.list, fitPath(path, [0, 0, 5, 5]), 'Wedge');
  assert.equal(again.list.length, 2);
  assert.deepEqual(pathBounds(again.list[1].path), [0, 0, 5, 5]);
  assert.equal(defineCustomShape([], { subpaths: [] }, 'x'), null);
  // The new shape is a Custom Shape tool choice and draws where the tool drags.
  syncCustomShapeOptions(named.list);
  const field = TOOL_OPTION_SCHEMA.customShape.find((f) => f.key === 'shape');
  assert.equal(field.options.at(-1).value, 'Wedge');
  const placed = shapeFromDrag('customShape', { shape: 'Wedge' }, 0, 0, 40, 60, {
    custom: named.list
  });
  assert.deepEqual(pathBounds(placed.path), [0, 0, 40, 60]);
  syncCustomShapeOptions([]);

  // The command needs a path with anchors, or a shape layer, and runs the dialog hook.
  const cmd = COMMANDS_BY_ID.get('edit.defineCustomShape');
  assert.deepEqual(cmd.menu, ['Edit']);
  assert.equal(cmd.label, 'Define Custom Shape…');
  const state = { layers: [createLayer('Layer 1', W, H)], activeLayerIdx: 0, paths: emptyPaths() };
  assert.equal(cmd.enabled(state), false);
  state.paths = withTargetPath(state.paths, path);
  assert.equal(cmd.enabled(state), true);
  state.paths = emptyPaths();
  state.layers.push(createShapeLayer('Shape 1', placed, W, H));
  state.activeLayerIdx = 1;
  assert.equal(cmd.enabled(state), true);
  let ran = 0;
  cmd.run({ defineCustomShape: () => ran++ });
  assert.equal(ran, 1);
});

test('Layer › Rasterize › Shape, and painting a shape layer asks to rasterize it first', () => {
  const cmd = COMMANDS_BY_ID.get('layer.rasterize.shape');
  assert.deepEqual(cmd.menu, ['Layer', 'Rasterize']);
  assert.equal(cmd.label, 'Shape');
  const shape = createShapeLayer('Ellipse 1', shapeFromDrag('ellipse', {}, 0, 0, 20, 20), W, H);
  const pixel = createLayer('Layer 1', W, H);
  assert.equal(cmd.enabled({ layers: [pixel], activeLayerIdx: 0 }), false);
  assert.equal(cmd.enabled({ layers: [pixel, shape], activeLayerIdx: 1 }), true);
  let ran = 0;
  cmd.run({ rasterizeShapeLayer: () => ran++ });
  assert.equal(ran, 1);
  // Pixel commands skip a shape layer (Layer › Matting needs pixels).
  const matte = COMMANDS_BY_ID.get('layer.matting.removeBlackMatte');
  assert.equal(matte.enabled({ layers: [shape], activeLayerIdx: 0 }), false);
  assert.equal(matte.enabled({ layers: [pixel], activeLayerIdx: 0 }), true);
  assert.equal(shapeNeedsRasterize(shape, 'brush'), true);
  assert.equal(shapeNeedsRasterize(shape, 'eraser'), true);
  for (const t of ['rect', 'polygon', 'customShape', 'select', 'rectSelect', 'eyedropper']) {
    assert.equal(shapeNeedsRasterize(shape, t), false, t);
  }
  assert.equal(shapeNeedsRasterize(pixel, 'brush'), false);
  assert.match(RASTERIZE_SHAPE_MESSAGE, /Rasterize the shape\?$/);
  // Rasterizing keeps the pixels the record drew (renderShapeLayer then kind 'pixel').
  renderShapeLayer(shape);
  assert.ok(shape.ctx.ops.some((o) => o[0] === 'fill'));
});

test('the Shape tools: one U group in toolbox order; a drag adds a shape layer', () => {
  const group = TOOL_GROUPS.find((g) => g.includes('rect'));
  assert.deepEqual(group, ['rect', 'ellipse', 'triangle', 'polygon', 'line', 'customShape']);
  for (const id of group) assert.equal(toolKey(id), 'U', id);
  assert.deepEqual(
    group.map((id) => [TOOLS[id].label, TOOLS[id].icon]),
    [
      ['Rectangle', 'rectangle-horizontal'],
      ['Ellipse', 'circle'],
      ['Triangle', 'triangle'],
      ['Polygon', 'pentagon'],
      ['Line', 'slash'],
      ['Custom Shape', 'cloud']
    ]
  );
  const ovCanvas = fakeCanvas();
  ovCanvas.width = W;
  ovCanvas.height = H;
  const ov = ovCanvas.getContext('2d');
  const added = [];
  const state = {
    color: '#ff8800',
    bgColor: '#000000',
    toolOptions: { polygon: { fill: true, sides: 6, starRatio: 100, strokeWidth: 0 } },
    addShapeLayer: (tool, shape) => added.push([tool, shape])
  };
  TOOLS.polygon.onDown(null, ov, state, 10, 10);
  TOOLS.polygon.onMove(null, ov, state, 50, 40);
  // The drag previews the shape on the overlay.
  assert.ok(ov.ops.some((o) => o[0] === 'fill' && o[1] === '#ff8800'));
  TOOLS.polygon.onUp(null, ov, state, 70, 50);
  assert.equal(state.drawing, false);
  assert.equal(added.length, 1);
  const [tool, shape] = added[0];
  assert.equal(tool, 'polygon');
  assert.equal(shape.fill, '#ff8800', 'Fill is the foreground');
  assert.deepEqual(shape.live.rect, [10, 10, 60, 40]);
  assert.equal(anchors(shape).length, 6);
  // ⇧ on the Line tool takes the 45° step the app gives it.
  state.toolOptions.line = { weight: 2 };
  state.shiftKey = true;
  state.constrainLine = () => ({ x: 40, y: 10 });
  TOOLS.line.onDown(null, ov, state, 10, 10);
  TOOLS.line.onUp(null, ov, state, 40, 13);
  assert.deepEqual(added[1][1].live.to, [40, 10]);
  // PhotoCraft's layer names.
  assert.equal(shapeLayerBase('rect'), 'Rectangle');
  assert.equal(shapeLayerBase('triangle'), 'Polygon');
  assert.equal(shapeLayerBase('customShape'), 'Shape');
  assert.equal(nextShapeLayerName('Rectangle', [{ name: 'Rectangle 1' }]), 'Rectangle 2');
});

test('Window › Shapes: the Shapes tab lists every shape and picking one sets the tool', () => {
  assert.ok(DOCK_PANELS.includes('shapes'));
  const cmd = COMMANDS_BY_ID.get('window.panel.shapes');
  assert.deepEqual(cmd.menu, ['Window']);
  let toggled = null;
  cmd.run({ togglePanel: (name) => (toggled = name) });
  assert.equal(toggled, 'shapes');

  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { window } = new JSDOM(html);
  const doc = window.document;
  const tab = doc.getElementById('tab-shapes');
  assert.equal(tab.getAttribute('aria-controls'), 'panel-shapes');
  assert.equal(tab.closest('.dock-group').getAttribute('aria-label'), 'Color panels');
  const panel = doc.getElementById('panel-shapes');
  const custom = [{ name: 'Wedge', path: parseShapeSource('M 0 0 L 10 0 L 5 10 Z') }];
  const picked = [];
  renderShapesPanel(panel, custom, 'Star', { onPick: (n) => picked.push(n) });
  const swatches = [...panel.querySelectorAll('.shape-swatch')];
  const builtins = BUILTIN_SHAPE_GROUPS.reduce((n, g) => n + g.items.length, 0);
  assert.equal(swatches.length, builtins + 1);
  assert.deepEqual(
    [...panel.querySelectorAll('.preset-group-name')].map((e) => e.textContent),
    ['Symbols', 'Arrows', 'Nature', 'Custom']
  );
  const star = panel.querySelector('[data-shape="Star"]');
  assert.equal(star.getAttribute('aria-pressed'), 'true');
  assert.match(star.querySelector('path').getAttribute('d'), /^M[\d.]+ [\d.]+C/);
  panel.querySelector('[data-shape="Wedge"]').click();
  assert.deepEqual(picked, ['Wedge']);
  // The Define Custom Shape name dialog is in the page.
  assert.ok(doc.getElementById('custom-shape-modal'));
  assert.ok(doc.getElementById('custom-shape-name'));
});
