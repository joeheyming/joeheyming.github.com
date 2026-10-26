import test from 'node:test';
import assert from 'node:assert/strict';

import {
  snapshotStack,
  restoreStack,
  isStackUndoLabel,
  STACK_UNDO_LABELS
} from '../paint/stack-history.js';
import { historyIconName, FALLBACK_HISTORY_ICON } from '../paint/history.js';

// layers.js needs document.createElement('canvas'). A byte-backed stub keeps this browser-free.
function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    className: '',
    dataset: {},
    style: {},
    pixels: null,
    getContext() {
      return ctx;
    },
    toDataURL() {
      return '';
    }
  };
  const ensure = () => {
    if (!canvas.pixels || canvas.pixels.length !== canvas.width * canvas.height * 4) {
      canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    }
  };
  const ctx = {
    canvas,
    createImageData(w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    getImageData(x, y, w, h) {
      ensure();
      return { width: w, height: h, data: canvas.pixels.slice() };
    },
    putImageData(img) {
      ensure();
      canvas.pixels.set(img.data);
    },
    drawImage() {}
  };
  return canvas;
}

globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    return fakeCanvas();
  }
};

const { createLayer, createAdjustmentLayer } = await import('../paint/layers.js');
const { newLayerMask } = await import('../paint/layer-mask.js');

const W = 2,
  H = 1;

function paintedLayer(name, rgba) {
  const layer = createLayer(name, W, H);
  const img = layer.ctx.createImageData(W, H);
  for (let p = 0; p < W * H; p++) img.data.set(rgba, p * 4);
  layer.ctx.putImageData(img, 0, 0);
  return layer;
}

function threeLayers() {
  const a = paintedLayer('Background', [255, 255, 255, 255]);
  const b = paintedLayer('Red', [255, 0, 0, 255]);
  b.mask = Uint8Array.from([255, 0]);
  b.opacity = 0.5;
  b.blendMode = 'multiply';
  const c = paintedLayer('Blue', [0, 0, 255, 128]);
  c.visible = false;
  return [a, b, c];
}

test('restore after deleting a layer gives back ids, order, names, pixels, and masks', () => {
  const layers = threeLayers();
  const snap = snapshotStack(layers, 1);
  const before = layers.map((l) => ({ id: l.id, name: l.name }));
  layers.splice(1, 1);
  const out = restoreStack(snap);
  assert.equal(out.layers.length, 3);
  assert.deepEqual(
    out.layers.map((r) => ({ id: r.id, name: r.name })),
    before
  );
  assert.equal(out.activeIdx, 1);
  assert.deepEqual([...out.layers[1].pixels.data], [255, 0, 0, 255, 255, 0, 0, 255]);
  assert.deepEqual([...out.layers[1].mask], [255, 0]);
  assert.equal(out.layers[1].opacity, 0.5);
  assert.equal(out.layers[1].blendMode, 'multiply');
  assert.equal(out.layers[2].visible, false);
  assert.deepEqual([...out.layers[2].pixels.data], [0, 0, 255, 128, 0, 0, 255, 128]);
  assert.equal(out.layers[0].mask, null);
  assert.equal(out.layers[0].maskEnabled, true);
});

test('restore after a merge gives two layers back', () => {
  const layers = threeLayers().slice(0, 2);
  const snap = snapshotStack(layers, 1);
  // Merge down: the top layer goes away and the survivor's pixels change.
  const survivor = layers[0];
  survivor.ctx.putImageData(
    { width: W, height: H, data: new Uint8ClampedArray([255, 128, 128, 255, 255, 255, 255, 255]) },
    0,
    0
  );
  layers.splice(1, 1);
  const out = restoreStack(snap);
  assert.equal(out.layers.length, 2);
  assert.deepEqual([...out.layers[0].pixels.data], [255, 255, 255, 255, 255, 255, 255, 255]);
  assert.equal(out.layers[1].name, 'Red');
});

test("an adjustment layer's id, params, and mask survive", () => {
  const base = paintedLayer('Background', [10, 20, 30, 255]);
  const adj = createAdjustmentLayer(
    'Levels',
    'levels',
    { black: 10, white: 240, gamma: 1.2 },
    W,
    H
  );
  adj.mask = newLayerMask('hideAll', W, H);
  const snap = snapshotStack([base, adj], 1);
  adj.params.black = 99;
  const out = restoreStack(snap);
  const r = out.layers[1];
  assert.equal(r.kind, 'adjustment');
  assert.equal(r.adjustmentId, 'levels');
  assert.deepEqual(r.params, { black: 10, white: 240, gamma: 1.2 });
  assert.deepEqual([...r.mask], [0, 0]);
  assert.equal(out.layers[0].kind, 'pixel');
  assert.equal('params' in out.layers[0], false);
});

test('a canvas-size change restores the old width and height', () => {
  const layers = threeLayers();
  const snap = snapshotStack(layers, 0);
  for (const l of layers) {
    l.canvas.width = 5;
    l.canvas.height = 4;
  }
  const out = restoreStack(snap);
  assert.equal(out.width, W);
  assert.equal(out.height, H);
  for (const r of out.layers) {
    assert.equal(r.pixels.width, W);
    assert.equal(r.pixels.height, H);
    assert.equal(r.pixels.data.length, W * H * 4);
  }
});

test('the snapshot is a deep copy of the live layers', () => {
  const layers = threeLayers();
  const snap = snapshotStack(layers, 2);
  layers[1].ctx.putImageData({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }, 0, 0);
  layers[1].mask[0] = 7;
  layers[1].name = 'Renamed';
  layers.reverse();
  const out = restoreStack(snap);
  assert.equal(out.layers[1].name, 'Red');
  assert.deepEqual([...out.layers[1].pixels.data], [255, 0, 0, 255, 255, 0, 0, 255]);
  assert.deepEqual([...out.layers[1].mask], [255, 0]);
  // Each restore hands out fresh copies, so a remount cannot reach back into the snapshot.
  out.layers[1].pixels.data[0] = 1;
  out.layers[1].mask[0] = 1;
  const again = restoreStack(snap);
  assert.equal(again.layers[1].pixels.data[0], 255);
  assert.equal(again.layers[1].mask[0], 255);
});

test('structure labels take a stack snapshot; strokes do not', () => {
  for (const label of [
    'New Layer',
    'Delete Layer',
    'Duplicate layer',
    'Merge down',
    'Flatten',
    'Move Layer Up',
    'Move Layer Down',
    'New Adjustment Layer',
    'Resize',
    'Crop',
    'Rotate Canvas'
  ]) {
    assert.ok(isStackUndoLabel(label), label);
  }
  assert.equal(isStackUndoLabel('Draw'), false);
  assert.equal(isStackUndoLabel('Brush'), false);
});

test('every stack label has a history icon', () => {
  for (const label of STACK_UNDO_LABELS) {
    assert.notEqual(historyIconName(label), FALLBACK_HISTORY_ICON, label);
  }
  assert.equal(historyIconName('New Layer'), 'layers');
  assert.equal(historyIconName('Delete Layer'), 'trash');
});
