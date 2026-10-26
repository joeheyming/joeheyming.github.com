import { test } from 'node:test';
import assert from 'node:assert/strict';

// Layer › Rasterize › Layer and All Layers (PhotoCraft extra_cmds.rs rasterize / rasterize_all).
// createLayer needs document.createElement('canvas'); an ImageData-backed stub keeps this test
// browser-free.
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
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
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

const { canRasterize, rasterizeRecord, rasterizeTargets } = await import('../paint/rasterize.js');
const { createFillLayer, createLayer, layerSource } = await import('../paint/layers.js');
const { newVectorMask } = await import('../paint/combine-shapes.js');
const { rectPath } = await import('../paint/shapes.js');
const { COMMANDS_BY_ID } = await import('../paint/commands.js');
const { isStackUndoLabel } = await import('../paint/stack-history.js');
const { historyIconName } = await import('../paint/history.js');

const W = 4,
  H = 4;

function paint(l, rgba) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(rgba, p * 4);
  l.ctx.putImageData({ width: W, height: H, data }, 0, 0);
  return l;
}

// One of each live kind, its canvas holding what its renderer drew.
function liveStack() {
  const bg = paint(createLayer('Background', W, H), [255, 255, 255, 255]);
  const type = paint(createLayer('Hello', W, H), [10, 20, 30, 255]);
  Object.assign(type, { kind: 'type', type: { text: 'Hello' }, typeSize: [W, H] });
  const shape = paint(createLayer('Rectangle 1', W, H), [200, 0, 0, 128]);
  Object.assign(shape, { kind: 'shape', shape: { path: rectPath(0, 0, 2, 2) }, shapeSize: [W, H] });
  const half = new Uint8Array(W * H).map((_, p) => (p % W < 2 ? 255 : 0));
  const fill = createFillLayer('Color Fill 1', { type: 'solid', color: '#00ff00' }, W, H, half);
  const smart = paint(createLayer('Smart', W, H), [0, 0, 255, 64]);
  Object.assign(smart, { kind: 'smart', smart: { source: null }, smartSize: [W, H] });
  const vector = paint(createLayer('Masked', W, H), [90, 90, 90, 255]);
  vector.vectorMask = newVectorMask('path', rectPath(0, 0, W, 2));
  return [bg, type, shape, fill, smart, vector];
}

// Normal "over" of every visible layer as the composite draws it (layerSource applies masks).
function composite(layers) {
  const dst = new Float64Array(W * H * 4);
  for (const l of layers) {
    const src = layerSource(l).getContext('2d').getImageData(0, 0, W, H).data;
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
  return Array.from(dst, (v) => Math.round(v * 1000) / 1000);
}

test('every live kind becomes a pixel layer with the same composite', () => {
  const layers = liveStack();
  const before = composite(layers);
  const [bg, type, shape, fill, smart, vector] = layers;
  assert.ok(!canRasterize(bg));
  for (const l of [type, shape, fill, smart, vector]) assert.ok(canRasterize(l), l.name);

  const targets = rasterizeTargets(layers, new Set(), true);
  assert.deepEqual(targets, [type, shape, fill, smart, vector]);
  for (const l of targets) assert.ok(rasterizeRecord(l, W, H));

  for (const l of layers) {
    assert.equal(l.kind, 'pixel', l.name);
    assert.equal(l.vectorMask, null, l.name);
    assert.ok(!canRasterize(l), l.name);
  }
  assert.equal(type.type, undefined);
  assert.equal(shape.shape, undefined);
  assert.equal(fill.fill, undefined);
  assert.equal(fill.fillSize, undefined);
  assert.equal(smart.smart, undefined);
  // The fill's mask stays a pixel mask; the vector mask is baked into one.
  assert.equal(fill.mask[0], 255);
  assert.equal(fill.mask[3], 0);
  assert.equal(vector.mask[0], 255);
  assert.equal(vector.mask[3 * W], 0);
  assert.deepEqual(composite(layers), before);
  assert.ok(!rasterizeRecord(type, W, H));
});

test('Rasterize › Layer converts only the selected live layers', () => {
  const layers = liveStack();
  const [, type, shape, fill] = layers;
  const ids = new Set([layers[0].id, shape.id, fill.id]);
  assert.deepEqual(rasterizeTargets(layers, ids), [shape, fill]);
  assert.equal(type.kind, 'type');
});

test('the commands sit in Layer › Rasterize, run with one undo step, and enable by kind', () => {
  const layers = liveStack();
  const state = (idx, ids) => ({
    layers,
    activeLayerIdx: idx,
    selectedLayers: new Set(ids),
    layerSelectionFor: layers[idx].id,
    layerAnchor: layers[idx].id
  });
  const layer = COMMANDS_BY_ID.get('layer.rasterize.layer');
  const all = COMMANDS_BY_ID.get('layer.rasterize.allLayers');
  assert.deepEqual(layer.menu, ['Layer', 'Rasterize']);
  assert.deepEqual(all.menu, ['Layer', 'Rasterize']);
  assert.ok(layer.enabled(state(1, [layers[1].id])));
  assert.ok(!layer.enabled(state(0, [layers[0].id])));
  assert.ok(all.enabled(state(0, [layers[0].id])));

  const bgOnly = paint(createLayer('Background', W, H), [255, 255, 255, 255]);
  bgOnly.background = true;
  const lone = { layers: [bgOnly], activeLayerIdx: 0, selectedLayers: new Set([bgOnly.id]) };
  lone.layerSelectionFor = lone.layerAnchor = bgOnly.id;
  assert.ok(!all.enabled(lone));

  const calls = [];
  const ctx = { rasterizeLayers: (a) => calls.push(a) };
  layer.run(ctx);
  all.run(ctx);
  assert.deepEqual(calls, [false, true]);
  for (const label of ['Rasterize Layer', 'Rasterize All Layers']) {
    assert.ok(isStackUndoLabel(label), label);
    assert.equal(historyIconName(label), 'layers');
  }
});
