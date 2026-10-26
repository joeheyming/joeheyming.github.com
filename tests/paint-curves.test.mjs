import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADJUSTMENTS,
  IDENTITY_CURVE,
  applyCurves,
  curveLut,
  curvesByteLuts
} from '../paint/adjustments.js';
import {
  dragCurvePoint,
  graphToLevel,
  hitTestCurve,
  insertCurvePoint,
  isOffGraph,
  levelToGraph,
  moveCurvePoint,
  pickOrInsertCurvePoint,
  removeCurvePoint
} from '../paint/curve-editor.js';
import { defaultAdjustmentParams } from '../paint/adjustment-layers.js';
import { compositeTreeBytes } from '../paint/layer-groups.js';

// project.js imports layers.js, which needs document.createElement('canvas').
globalThis.document = {
  createElement() {
    const canvas = {
      width: 0,
      height: 0,
      dataset: {},
      style: {},
      getContext: () => ctx,
      toDataURL: () => ''
    };
    const ctx = {
      canvas,
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4)
      }),
      putImageData() {},
      drawImage() {}
    };
    return canvas;
  }
};
const { createAdjustmentLayer } = await import('../paint/layers.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');

const pt = (input, output) => ({ input, output });

function image(pixels) {
  return { width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) };
}

// Every byte 0..255 once per channel, opaque.
function ramp() {
  return image(Array.from({ length: 256 }, (_, v) => [v, v, v, 255]));
}

test('identity curves leave pixels unchanged', () => {
  const img = ramp();
  const before = Array.from(img.data);
  applyCurves(img, defaultAdjustmentParams('curves'));
  assert.deepEqual(Array.from(img.data), before);
  // Identity points that are not the shared constant still give back every byte.
  const luts = curvesByteLuts({ master: [pt(0, 0), pt(255, 255)] });
  for (const lut of luts) assert.deepEqual(Array.from(lut), [...Array(256).keys()]);
});

test('a master curve through (0,0) (128,192) (255,255) maps 128 to 192 and stays monotone', () => {
  const params = {
    ...defaultAdjustmentParams('curves'),
    master: [pt(0, 0), pt(128, 192), pt(255, 255)]
  };
  const img = ramp();
  applyCurves(img, params);
  const out = Array.from({ length: 256 }, (_, v) => img.data[v * 4]);
  assert.equal(out[128], 192);
  assert.equal(out[0], 0);
  assert.equal(out[255], 255);
  for (let v = 1; v < 256; v++) assert.ok(out[v] >= out[v - 1], `not monotone at ${v}`);
  // All three channels follow the master; alpha is untouched.
  assert.equal(img.data[128 * 4 + 1], 192);
  assert.equal(img.data[128 * 4 + 2], 192);
  assert.equal(img.data[128 * 4 + 3], 255);
});

test('curveLut is PhotoCraft curve_lut: a natural spline, constant outside the end points', () => {
  // Two points are a straight line.
  const line = curveLut([pt(0, 0), pt(255, 127.5)]);
  assert.ok(Math.abs(line[4095] - 0.5) < 1e-6);
  assert.ok(Math.abs(line[2048] - 0.25) < 1e-3);
  // Flat before the first point and after the last; unsorted input is sorted.
  const t = curveLut([pt(191.25, 255), pt(63.75, 0)]);
  assert.equal(t[0], 0);
  assert.equal(t[1000], 0);
  assert.equal(t[4095], 1);
  assert.ok(Math.abs(t[2048] - 0.5) < 1e-3);
  // A natural spline through three points overshoots past the clamp near the middle point.
  const s = curveLut([pt(0, 0), pt(64, 255), pt(255, 0)]);
  assert.ok(
    s.some((v) => v === 1),
    'clamped to 1'
  );
});

test('each channel curve applies before the master', () => {
  // PhotoCraft levels_and_curves_apply_each_channel_before_the_master: channel(x) = 1/2 + x/2,
  // then master(x) = x/2, so 0 maps to 0.25 (64), not 0.5.
  const params = {
    master: [pt(0, 0), pt(255, 127.5)],
    red: [pt(0, 127.5), pt(255, 255)],
    green: [pt(0, 127.5), pt(255, 255)],
    blue: [pt(0, 127.5), pt(255, 255)]
  };
  const img = image([
    [0, 0, 0, 255],
    [255, 255, 255, 255]
  ]);
  applyCurves(img, params);
  assert.deepEqual(Array.from(img.data), [64, 64, 64, 255, 128, 128, 128, 255]);
  // A red-only curve leaves green and blue on the master alone.
  const red = image([[0, 0, 0, 255]]);
  applyCurves(red, { ...defaultAdjustmentParams('curves'), red: [pt(0, 255), pt(255, 255)] });
  assert.deepEqual(Array.from(red.data), [255, 0, 0, 255]);
});

test('a mask skips unselected pixels, and transparent pixels are skipped', () => {
  const params = { ...defaultAdjustmentParams('curves'), master: [pt(0, 255), pt(255, 0)] };
  const img = image([
    [10, 20, 30, 255],
    [10, 20, 30, 255],
    [10, 20, 30, 0]
  ]);
  applyCurves(img, params, Uint8Array.from([1, 0, 1]));
  assert.deepEqual(Array.from(img.data), [245, 235, 225, 255, 10, 20, 30, 255, 10, 20, 30, 0]);
});

test('Curves is registered with four identity curve fields', () => {
  const def = ADJUSTMENTS.curves;
  assert.equal(def.label, 'Curves');
  assert.deepEqual(
    def.fields.map((f) => [f.key, f.label, f.type]),
    [
      ['master', 'RGB', 'curve'],
      ['red', 'Red', 'curve'],
      ['green', 'Green', 'curve'],
      ['blue', 'Blue', 'curve']
    ]
  );
  const params = defaultAdjustmentParams('curves');
  for (const key of ['master', 'red', 'green', 'blue']) assert.equal(params[key], IDENTITY_CURVE);
  assert.ok(Object.isFrozen(IDENTITY_CURVE));
});

test('graph coordinates map to levels with output up', () => {
  assert.deepEqual(graphToLevel(0, 255), { input: 0, output: 0 });
  assert.deepEqual(graphToLevel(255, 0), { input: 255, output: 255 });
  assert.deepEqual(levelToGraph(pt(51, 204)), { x: 51, y: 51 });
  assert.equal(isOffGraph(pt(-5, 100)), false);
  assert.equal(isOffGraph(pt(-20, 100)), true);
  assert.equal(isOffGraph(pt(100, 280)), true);
});

test('point editing: hit test, insert sorted, move between neighbours, remove, keep the ends', () => {
  const base = [pt(0, 0), pt(255, 255)];
  assert.equal(hitTestCurve(base, pt(4, 3)), 0);
  assert.equal(hitTestCurve(base, pt(128, 128)), -1);

  const { points, index } = insertCurvePoint(base, pt(128.4, 191.6));
  assert.deepEqual(points, [pt(0, 0), pt(128, 192), pt(255, 255)]);
  assert.equal(index, 1);
  assert.deepEqual(base, [pt(0, 0), pt(255, 255)], 'insert does not mutate');
  // A point at an existing input replaces that point's output.
  assert.deepEqual(insertCurvePoint(points, pt(128, 50)).points, [
    pt(0, 0),
    pt(128, 50),
    pt(255, 255)
  ]);

  // Moves clamp to 0..255 and stay strictly between neighbours.
  assert.deepEqual(moveCurvePoint(points, 1, pt(300, 300))[1], pt(254, 255));
  assert.deepEqual(moveCurvePoint(points, 1, pt(-40, -9))[1], pt(1, 0));
  assert.deepEqual(moveCurvePoint(points, 0, pt(200, 30))[0], pt(127, 30));

  assert.deepEqual(removeCurvePoint(points, 1), base);
  assert.equal(removeCurvePoint(points, 0), points);
  assert.equal(removeCurvePoint(points, 2), points);
});

test('pointer down picks or adds a point; dragging off the graph removes it, back in restores it', () => {
  const base = [pt(0, 0), pt(255, 255)];
  const down = pickOrInsertCurvePoint(base, pt(100, 60));
  assert.deepEqual(down.points, [pt(0, 0), pt(100, 60), pt(255, 255)]);
  assert.equal(down.index, 1);
  // Picking an existing point does not add one.
  const again = pickOrInsertCurvePoint(down.points, pt(102, 58));
  assert.equal(again.points, down.points);
  assert.equal(again.index, 1);

  assert.deepEqual(dragCurvePoint(down.points, 1, pt(120, 90)), [
    pt(0, 0),
    pt(120, 90),
    pt(255, 255)
  ]);
  assert.deepEqual(dragCurvePoint(down.points, 1, pt(120, -40)), base);
  assert.deepEqual(dragCurvePoint(down.points, 1, pt(110, 70)), [
    pt(0, 0),
    pt(110, 70),
    pt(255, 255)
  ]);
  // End points never leave: dragged off, they clamp to the edge.
  assert.deepEqual(dragCurvePoint(down.points, 2, pt(255, 400)), down.points);
  assert.equal(dragCurvePoint(down.points, 0, pt(-50, -50)).length, 3);
});

test('.paintproj round-trips curve params', async () => {
  const params = {
    ...defaultAdjustmentParams('curves'),
    master: [pt(0, 0), pt(128, 192), pt(255, 255)],
    blue: [pt(0, 20), pt(255, 235)]
  };
  const layer = createAdjustmentLayer('Curves 1', 'curves', params, 2, 1);
  const state = {
    bgColor: '#ffffff',
    color: '#000000',
    activeLayerIdx: 0,
    layers: [layer],
    objects: []
  };
  const data = JSON.parse(JSON.stringify(serializeProject(state, 2, 1)));
  let restored = null;
  await deserializeProject(data, (out) => {
    restored = out;
  });
  const [b] = restored.layers;
  assert.equal(b.adjustmentId, 'curves');
  assert.deepEqual(b.params, JSON.parse(JSON.stringify(params)));
});

test('a Curves adjustment layer at opacity 0.5 mixes halfway', () => {
  const pixels = {
    id: 1,
    kind: 'pixel',
    visible: true,
    opacity: 1,
    mask: null,
    data: new Uint8ClampedArray([10, 20, 30, 255, 200, 100, 0, 255])
  };
  const adj = {
    id: 2,
    kind: 'adjustment',
    adjustmentId: 'curves',
    params: { ...defaultAdjustmentParams('curves'), master: [pt(0, 255), pt(255, 0)] },
    visible: true,
    opacity: 0.5,
    mask: null
  };
  const full = compositeTreeBytes([pixels, { ...adj, opacity: 1 }], 2, 1, null);
  assert.deepEqual(Array.from(full), [245, 235, 225, 255, 55, 155, 255, 255]);
  const half = compositeTreeBytes([pixels, adj], 2, 1, null);
  assert.deepEqual(Array.from(half), [128, 128, 128, 255, 128, 128, 128, 255]);
});
