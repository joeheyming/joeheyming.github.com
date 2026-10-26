import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combinePaths,
  combineShapesPlan,
  combineSpans,
  hasPathOps,
  mergeShapeComponents,
  multiplyMasks,
  newVectorMask,
  normalizeVectorMask,
  pathArea,
  pathCoverage,
  pathOpsMask,
  rasterizeVectorMask,
  setComponentOps,
  vectorMaskValues
} from '../paint/combine-shapes.js';
import { compositeMask } from '../paint/layer-mask.js';
import { normalizeShape, rectPath, renderShape, shapeMask } from '../paint/shapes.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';
import { emptyPaths, withTargetPath } from '../paint/paths.js';
import { isStackUndoLabel, snapshotStack } from '../paint/stack-history.js';

// Layer › Combine Shapes and Layer › Vector Mask (PhotoCraft vector_cmds.rs combine_shapes,
// merge_components, vector_mask_*; vector raster.rs inside).

const W = 20,
  H = 20;
const A = rectPath(0, 0, 10, 10);
const B = rectPath(5, 5, 10, 10);
const count = (m) => m.reduce((s, v) => s + (v ? 1 : 0), 0);

test('two overlapping squares: unite, subtract, intersect, exclude areas', () => {
  const areas = { combine: 175, subtract: 75, intersect: 25, exclude: 150 };
  for (const [op, area] of Object.entries(areas)) {
    const path = combinePaths([A, B], op);
    assert.equal(path.subpaths[1].op, op);
    assert.ok(hasPathOps(path));
    assert.equal(count(pathOpsMask(path, W, H)), area, op);
  }
  // Subtract keeps A's pixels outside B; intersect only the overlap.
  const sub = pathOpsMask(combinePaths([A, B], 'subtract'), W, H);
  assert.equal(sub[2 * W + 2], 1);
  assert.equal(sub[7 * W + 7], 0);
  const inter = pathOpsMask(combinePaths([A, B], 'intersect'), W, H);
  assert.equal(inter[7 * W + 7], 1);
  assert.equal(inter[2 * W + 2], 0);
});

test('Merge Shape Components bakes the ops into a new plain path', () => {
  const areas = { combine: 175, subtract: 75, intersect: 25, exclude: 150 };
  for (const [op, area] of Object.entries(areas)) {
    const merged = mergeShapeComponents(combinePaths([A, B], op));
    assert.ok(!hasPathOps(merged), op);
    assert.ok(merged.subpaths.every((sp) => sp.closed && !sp.op));
    assert.equal(pathArea(merged), area, op);
    assert.equal(count(pathOpsMask(merged, W, H)), area, op);
  }
  // Unite is one outline of 8 corners; intersect the 5×5 overlap square.
  const unite = mergeShapeComponents(combinePaths([A, B], 'combine'));
  assert.equal(unite.subpaths.length, 1);
  assert.equal(unite.subpaths[0].anchors.length, 8);
  const inter = mergeShapeComponents(combinePaths([A, B], 'intersect'));
  const xs = inter.subpaths[0].anchors.map((a) => [a.x, a.y]);
  assert.deepEqual(
    xs.map(([x]) => x).sort((p, q) => p - q),
    [5, 5, 10, 10]
  );
  assert.deepEqual(
    xs.map(([, y]) => y).sort((p, q) => p - q),
    [5, 5, 10, 10]
  );
});

test('span booleans and the op rules', () => {
  assert.deepEqual(combineSpans([[0, 10]], [[5, 15]], 'combine'), [[0, 15]]);
  assert.deepEqual(combineSpans([[0, 10]], [[5, 15]], 'subtract'), [[0, 5]]);
  assert.deepEqual(combineSpans([[0, 10]], [[5, 15]], 'intersect'), [[5, 10]]);
  assert.deepEqual(combineSpans([[0, 10]], [[5, 15]], 'exclude'), [
    [0, 5],
    [10, 15]
  ]);
  // A path with no ops keeps its even-odd fill (a ring keeps its hole).
  const ring = { subpaths: [...rectPath(0, 0, 10, 10).subpaths, ...rectPath(3, 3, 4, 4).subpaths] };
  assert.ok(!hasPathOps(ring));
  assert.equal(count(pathOpsMask(ring, W, H)), 100 - 16);
  // One layer's Unite: the inner component combines and fills the hole.
  const united = setComponentOps(ring, 'combine');
  assert.equal(united.subpaths[0].op, undefined);
  assert.equal(united.subpaths[1].op, 'combine');
  assert.equal(count(pathOpsMask(united, W, H)), 100);
  assert.equal(count(pathOpsMask(setComponentOps(ring, 'intersect'), W, H)), 16);
});

test('a shape layer with ops masks and fills by the combined area', () => {
  const s = normalizeShape({ path: combinePaths([A, B], 'subtract'), fill: '#ff0000' });
  assert.equal(s.path.subpaths[1].op, 'subtract');
  assert.equal(count(shapeMask(s, W, H)), 75);
  const canvas = { width: W, height: H, pixels: null };
  const ctx = {
    canvas,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(img) {
      canvas.pixels = img.data;
    }
  };
  renderShape(ctx, s);
  const at = (x, y) => Array.from(canvas.pixels.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
  assert.deepEqual(at(2, 2), [255, 0, 0, 255]);
  assert.equal(at(7, 7)[3], 0);
  assert.equal(at(12, 12)[3], 0);
});

test('Combine Shapes with two shape layers selected merges into the top-most', () => {
  const layer = (id, path) => ({ id, kind: 'shape', shape: normalizeShape({ path, fill: '#000000' }) });
  const bg = { id: 1, kind: 'pixel' };
  const a = layer(2, A),
    b = layer(3, B);
  const layers = [bg, a, b];
  const plan = combineShapesPlan(layers, new Set([2, 3]), 2, 'subtract');
  assert.equal(plan.keep, b);
  assert.deepEqual(plan.remove, [a]);
  assert.equal(count(pathOpsMask(plan.path, W, H)), 75);
  const merged = combineShapesPlan(layers, new Set([2, 3]), 2, null);
  assert.ok(!hasPathOps(merged.path));
  assert.equal(pathArea(merged.path), 175);
  // One shape layer: its own components take the op.
  const one = combineShapesPlan(layers, new Set([3]), 2, 'exclude');
  assert.equal(one.keep, b);
  assert.deepEqual(one.remove, []);
  assert.equal(combineShapesPlan(layers, new Set([1]), 0, 'combine'), null);
});

test('path coverage is anti-aliased on a half-pixel edge', () => {
  const cov = pathCoverage(rectPath(2.5, 2, 5, 4), 10, 10);
  assert.equal(cov[3 * 10 + 4], 255);
  assert.equal(cov[3 * 10 + 2], 128);
  assert.equal(cov[3 * 10 + 7], 128);
  assert.equal(cov[3 * 10 + 8], 0);
  assert.equal(cov[1 * 10 + 4], 0);
  const inv = pathCoverage(rectPath(2.5, 2, 5, 4), 10, 10, true);
  assert.equal(inv[3 * 10 + 4], 0);
  assert.equal(inv[0], 255);
});

test('vector masks: Reveal All, Hide All, Current Path, Enable, composite, Rasterize', () => {
  const mk = (vectorMask, mask = null) => ({
    canvas: { width: W, height: H },
    mask,
    maskEnabled: true,
    vectorMask
  });
  assert.ok(vectorMaskValues(mk(newVectorMask('revealAll')), W, H).every((v) => v === 255));
  assert.ok(vectorMaskValues(mk(newVectorMask('hideAll')), W, H).every((v) => v === 0));
  const shaped = mk(newVectorMask('path', A));
  const vals = vectorMaskValues(shaped, W, H);
  assert.equal(vals[5 * W + 5], 255);
  assert.equal(vals[15 * W + 15], 0);
  assert.equal(vals.filter((v) => v === 255).length, 100);
  // The composite mask is the vector mask alone, or its product with the pixel mask.
  assert.equal(compositeMask(shaped, W), vals);
  const half = new Uint8Array(W * H).fill(128);
  const both = compositeMask(mk(shaped.vectorMask, half), W);
  assert.equal(both[5 * W + 5], 128);
  assert.equal(both[15 * W + 15], 0);
  assert.deepEqual(multiplyMasks(null, half), half);
  // Disabled: kept, but hides nothing.
  const off = mk({ ...shaped.vectorMask, enabled: false }, half);
  assert.equal(vectorMaskValues(off, W, H), null);
  assert.equal(compositeMask(off, W), half);
  // Rasterize › Vector Mask multiplies into the pixel mask (Reveal All when there is none).
  const baked = rasterizeVectorMask(shaped, W, H);
  assert.equal(baked[5 * W + 5], 255);
  assert.equal(baked[15 * W + 15], 0);
  const bakedHalf = rasterizeVectorMask(mk(shaped.vectorMask, half), W, H);
  assert.equal(bakedHalf[5 * W + 5], 128);
  assert.equal(bakedHalf[15 * W + 15], 0);
  // Saved files: older layers have none; a saved one comes back the same.
  assert.equal(normalizeVectorMask(undefined), null);
  assert.deepEqual(normalizeVectorMask(JSON.parse(JSON.stringify(shaped.vectorMask))), shaped.vectorMask);
});

test('menu commands sit in Layer › Combine Shapes, Vector Mask, and Rasterize', () => {
  const rows = {
    'layer.combineShapes.unite': ['Layer', 'Combine Shapes'],
    'layer.combineShapes.subtractFrontShape': ['Layer', 'Combine Shapes'],
    'layer.combineShapes.intersectShapeAreas': ['Layer', 'Combine Shapes'],
    'layer.combineShapes.excludeOverlappingShapes': ['Layer', 'Combine Shapes'],
    'layer.combineShapes.mergeShapeComponents': ['Layer', 'Combine Shapes'],
    'layer.vectorMask.revealAll': ['Layer', 'Vector Mask'],
    'layer.vectorMask.hideAll': ['Layer', 'Vector Mask'],
    'layer.vectorMask.currentPath': ['Layer', 'Vector Mask'],
    'layer.vectorMask.delete': ['Layer', 'Vector Mask'],
    'layer.vectorMask.enabled': ['Layer', 'Vector Mask'],
    'layer.rasterize.vectorMask': ['Layer', 'Rasterize']
  };
  for (const [id, menu] of Object.entries(rows)) {
    assert.deepEqual(COMMANDS_BY_ID.get(id)?.menu, menu, id);
  }
  const shapeA = { id: 2, kind: 'shape', shape: normalizeShape({ path: A, fill: '#000000' }) };
  const shapeB = { id: 3, kind: 'shape', shape: normalizeShape({ path: B, fill: '#000000' }) };
  const pixel = { id: 1, kind: 'pixel', vectorMask: null };
  const state = (layers, idx, ids, paths = emptyPaths()) => ({
    layers,
    activeLayerIdx: idx,
    selectedLayers: new Set(ids),
    layerSelectionFor: layers[idx].id,
    layerAnchor: layers[idx].id,
    paths
  });
  const on = (id, s) => COMMANDS_BY_ID.get(id).enabled(s);
  assert.ok(on('layer.combineShapes.unite', state([pixel, shapeA, shapeB], 2, [2, 3])));
  // One single-component shape has nothing to combine, but Merge Components still applies.
  assert.ok(!on('layer.combineShapes.unite', state([pixel, shapeA, shapeB], 2, [3])));
  assert.ok(on('layer.combineShapes.mergeShapeComponents', state([pixel, shapeB], 1, [3])));
  assert.ok(!on('layer.combineShapes.unite', state([pixel], 0, [1])));
  // A shape layer's path is already its vector mask.
  assert.ok(!on('layer.vectorMask.revealAll', state([pixel, shapeB], 1, [3])));
  assert.ok(on('layer.vectorMask.revealAll', state([pixel], 0, [1])));
  assert.ok(!on('layer.vectorMask.currentPath', state([pixel], 0, [1])));
  const withPath = withTargetPath(emptyPaths(), A);
  assert.ok(on('layer.vectorMask.currentPath', state([pixel], 0, [1], withPath)));
  assert.ok(!on('layer.vectorMask.delete', state([pixel], 0, [1])));
  const masked = { ...pixel, vectorMask: newVectorMask('hideAll') };
  assert.ok(on('layer.vectorMask.delete', state([masked], 0, [1])));
  assert.ok(on('layer.rasterize.vectorMask', state([masked], 0, [1])));
  assert.ok(COMMANDS_BY_ID.get('layer.vectorMask.enabled').checked(state([masked], 0, [1])));
  assert.ok(!on('layer.vectorMask.hideAll', state([masked], 0, [1])));
});

test('undo snapshots keep the vector mask and combine steps are stack entries', () => {
  for (const label of [
    'Unite Shapes',
    'Subtract Front Shape',
    'Intersect Shape Areas',
    'Exclude Overlapping Shapes',
    'Merge Shape Components',
    'Add Vector Mask',
    'Delete Vector Mask',
    'Enable Vector Mask',
    'Disable Vector Mask',
    'Rasterize Vector Mask'
  ]) {
    assert.ok(isStackUndoLabel(label), label);
  }
  const vm = newVectorMask('path', A);
  const snap = snapshotStack(
    [{ id: 1, kind: 'pixel', data: { width: 2, height: 2, data: new Uint8ClampedArray(16) }, locks: {}, vectorMask: vm }],
    0
  );
  assert.equal(snap.layers[0].vectorMask, vm);
});
