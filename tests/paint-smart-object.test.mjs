import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS } from '../paint/commands.js';
import {
  freeTransformHomography,
  renderSmart,
  smartBounds,
  smartFromJSON,
  smartFromLayers,
  smartToJSON,
  smartToolRefusal,
  transformSmart,
  unpackSmart
} from '../paint/smart-objects.js';
import { IDENTITY_TRANSFORM, resampleImageData } from '../paint/transform.js';
import { isStackUndoLabel, restoreStack, snapshotStack } from '../paint/stack-history.js';

// Layer › Smart Objects (PhotoCraft smart_cmds.rs): a smart layer keeps its contents and a
// placement; its pixels always render from the contents, so transforms never wear them down.

// layers.js needs document.createElement('canvas'): a byte-backed stub.
function fakeCanvas() {
  const canvas = { width: 0, height: 0, className: '', dataset: {}, style: {}, pixels: null };
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
const { createSmartLayer, canMergeDown, createLayer, refreshSmartLayers } = await import(
  '../paint/layers.js'
);

const W = 16,
  H = 16;

// A 8 x 8 block of distinct colours at (4, 4): every pixel differs, so any resampling shows.
function blockBytes() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 4; y < 12; y++) {
    for (let x = 4; x < 12; x++) {
      const i = (y * W + x) * 4;
      data.set([x * 20, y * 15, (x * y) % 256, 255], i);
    }
  }
  return data;
}

const record = (name, data, extra = {}) => ({
  name,
  opacity: 1,
  visible: true,
  blendMode: 'source-over',
  clipped: false,
  styles: null,
  data,
  ...extra
});

const px = (data, x, y, w = W) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

test('Convert to Smart Object crops the contents to their bounds and places them there', () => {
  const smart = smartFromLayers([record('Layer 1', blockBytes())], W, H);
  assert.equal(smart.source.width, 8);
  assert.equal(smart.source.height, 8);
  assert.deepEqual(smart.transform, [1, 0, 4, 0, 1, 4, 0, 0, 1]);
  assert.deepEqual(smartBounds(smart), { x: 4, y: 4, w: 8, h: 8 });
  // Rendering puts back exactly what was converted.
  assert.deepEqual(renderSmart(smart, W, H).data, blockBytes());
  // An empty layer has nothing to convert.
  assert.equal(smartFromLayers([record('Empty', new Uint8ClampedArray(W * H * 4))], W, H), null);
});

test('scaling a smart object down 4x and up 4x brings the source pixels back exactly', () => {
  const original = blockBytes();
  const smart0 = smartFromLayers([record('Layer 1', original)], W, H);
  // Free Transform at 25 %, committed: the canvas shows a 2 x 2 resample.
  const quarter = { ...IDENTITY_TRANSFORM, sx: 0.25, sy: 0.25 };
  const small = transformSmart(smart0, freeTransformHomography(smartBounds(smart0), quarter));
  const smallPx = renderSmart(small, W, H).data;
  assert.deepEqual(smartBounds(small), { x: 7, y: 7, w: 2, h: 2 });
  assert.notDeepEqual(smallPx, original);
  assert.equal(smallPx.filter((_, i) => i % 4 === 3 && smallPx[i] > 0).length, 4);
  // The contents were never touched.
  assert.equal(small.source, smart0.source);

  // Free Transform again at 400 %: the placement composes back to the original.
  const fourfold = { ...IDENTITY_TRANSFORM, sx: 4, sy: 4 };
  const back = transformSmart(small, freeTransformHomography(smartBounds(small), fourfold));
  assert.deepEqual(back.transform, smart0.transform);
  assert.deepEqual(renderSmart(back, W, H).data, original);

  // The same round trip on plain pixels loses the detail.
  const crop = { width: 8, height: 8, data: smart0.source.data };
  const lossy = resampleImageData(resampleImageData(crop, 2, 2), 8, 8);
  assert.notDeepEqual(lossy.data, crop.data);
});

test('a skewed or distorted box becomes a homography placement', () => {
  const smart = smartFromLayers([record('Layer 1', blockBytes())], W, H);
  const box = smartBounds(smart);
  // Move the box by (2, 1) as a quad: a whole-pixel placement that copies bytes exactly.
  const quad = [
    [6, 5],
    [14, 5],
    [14, 13],
    [6, 13]
  ];
  const moved = transformSmart(smart, freeTransformHomography(box, IDENTITY_TRANSFORM, quad));
  assert.deepEqual(moved.transform, [1, 0, 6, 0, 1, 5, 0, 0, 1]);
  const out = renderSmart(moved, W, H).data;
  assert.deepEqual(px(out, 6, 5), px(blockBytes(), 4, 4));
  assert.deepEqual(px(out, 13, 12), px(blockBytes(), 11, 11));
  assert.deepEqual(px(out, 5, 5), [0, 0, 0, 0]);
});

test('Convert to Layers unpacks every content layer at the placement', () => {
  const left = new Uint8ClampedArray(W * H * 4);
  const right = new Uint8ClampedArray(W * H * 4);
  for (let y = 2; y < 4; y++) {
    left.set([255, 0, 0, 255], (y * W + 2) * 4);
    right.set([0, 0, 255, 255], (y * W + 5) * 4);
  }
  const smart = smartFromLayers(
    [record('Red', left), record('Blue', right, { opacity: 0.5, blendMode: 'multiply' })],
    W,
    H
  );
  assert.deepEqual(smartBounds(smart), { x: 2, y: 2, w: 4, h: 2 });
  // Moved right by 3 px, then unpacked.
  const moved = transformSmart(smart, [1, 0, 3, 0, 1, 0, 0, 0, 1]);
  const layers = unpackSmart(moved, W, H);
  assert.deepEqual(
    layers.map((l) => [l.name, l.opacity, l.blendMode]),
    [
      ['Red', 1, 'source-over'],
      ['Blue', 0.5, 'multiply']
    ]
  );
  assert.deepEqual(px(layers[0].data, 5, 2), [255, 0, 0, 255]);
  assert.deepEqual(px(layers[0].data, 2, 2), [0, 0, 0, 0]);
  assert.deepEqual(px(layers[1].data, 8, 3), [0, 0, 255, 255]);
});

test('a smart layer renders from its contents, refuses paint, and takes no merge', () => {
  const smart = smartFromLayers([record('Layer 1', blockBytes())], W, H);
  const layer = createSmartLayer('Layer 1', smart, W, H);
  assert.equal(layer.kind, 'smart');
  assert.deepEqual(layer.canvas.pixels, blockBytes());
  const above = createLayer('Layer 2', W, H);
  assert.equal(canMergeDown([layer, above], 1), false);
  assert.match(smartToolRefusal(layer, 'brush', 'Brush Tool'), /smart object/);
  assert.equal(smartToolRefusal(layer, 'rectSelect', 'Rectangular Marquee'), null);
  // A canvas-size change renders it again at the new size.
  layer.canvas.width = 20;
  layer.canvas.height = 20;
  layer.canvas.pixels = null;
  refreshSmartLayers([layer]);
  assert.deepEqual(px(layer.canvas.pixels, 4, 4, 20), px(blockBytes(), 4, 4));
  // Rasterize: what stays is the rendered canvas as a pixel layer (paint.js
  // rasterizeSmartObject drops kind and contents; the stack undo row brings them back).
  assert.ok(isStackUndoLabel('Rasterize Smart Object'));
  const snap = snapshotStack([layer], 0);
  layer.kind = 'pixel';
  delete layer.smart;
  const [restored] = restoreStack(snap).layers;
  assert.equal(restored.kind, 'smart');
  assert.deepEqual(restored.smart.transform, smart.transform);
  assert.deepEqual(px(restored.pixels.data, 11, 11, 20), px(blockBytes(), 11, 11));
});

test('.paintproj saves the contents and placement and loads them back', async () => {
  const smart = transformSmart(
    smartFromLayers([record('Layer 1', blockBytes())], W, H),
    [0.5, 0, 1, 0, 0.5, 2, 0, 0, 1]
  );
  const store = new Map();
  const encode = (img) => {
    const key = `img:${store.size}`;
    store.set(key, { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
    return key;
  };
  const json = JSON.parse(JSON.stringify(smartToJSON(smart, encode)));
  assert.deepEqual(json.transform, [0.5, 0, 3, 0, 0.5, 4, 0, 0, 1]);
  assert.equal(typeof json.source, 'string');
  const loaded = await smartFromJSON(json, async (key) => store.get(key));
  assert.deepEqual(loaded.source.data, smart.source.data);
  assert.deepEqual(loaded.layers[0].data, smart.layers[0].data);
  assert.deepEqual(renderSmart(loaded, W, H).data, renderSmart(smart, W, H).data);
  // A broken entry loads as nothing (the caller opens a pixel layer).
  assert.equal(await smartFromJSON({ source: 'x', transform: [1] }, async () => null), null);
});

test('Layer › Smart Objects lists the four commands and runs them', () => {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { document } = new JSDOM(html).window;
  const prevDoc = globalThis.document;
  globalThis.document = document;
  buildMenuBar(document.getElementById('menu-bar'), COMMANDS, {
    mac: false,
    state: { layers: [], sel: { ids: [] } }
  });
  globalThis.document = prevDoc;
  const menu = document.getElementById('layer-menu-list');
  const group = menu.querySelector('.has-submenu[data-menu-path="Layer > Smart Objects"]');
  assert.ok(group, 'Smart Objects submenu missing');
  const labels = ['convert-to-smart', 'smart-via-copy', 'smart-to-layers', 'rasterize-smart'].map(
    (id) => group.querySelector(`[data-layer="${id}"] .menu-label`)?.textContent
  );
  assert.deepEqual(labels, [
    'Convert to Smart Object',
    'New Smart Object via Copy',
    'Convert to Layers',
    'Rasterize'
  ]);
  const calls = [];
  const ctx = new Proxy({}, { get: (_, name) => () => calls.push(name) });
  for (const id of [
    'convertToSmartObject',
    'newSmartObjectViaCopy',
    'convertToLayers',
    'rasterize'
  ]) {
    COMMANDS.find((c) => c.id === `layer.smartObjects.${id}`).run(ctx);
  }
  assert.deepEqual(calls, [
    'convertToSmartObject',
    'newSmartObjectViaCopy',
    'convertSmartToLayers',
    'rasterizeSmartObject'
  ]);
  // Only a smart layer enables the last three; a group cannot be converted here.
  const enabled = (id, layer) =>
    COMMANDS.find((c) => c.id === `layer.smartObjects.${id}`).enabled({
      layers: [layer],
      activeLayerIdx: 0,
      layerSelection: { ids: [layer.id], active: layer.id, anchor: layer.id }
    });
  const pixel = { id: 1, kind: 'pixel', name: 'Layer 1' };
  const smart = { id: 2, kind: 'smart', name: 'Layer 1', smart: {} };
  assert.equal(enabled('convertToSmartObject', pixel), true);
  assert.equal(enabled('rasterize', pixel), false);
  assert.equal(enabled('rasterize', smart), true);
  assert.equal(enabled('convertToLayers', smart), true);
  assert.equal(enabled('convertToSmartObject', { id: 3, kind: 'group', name: 'Group 1' }), false);
});
