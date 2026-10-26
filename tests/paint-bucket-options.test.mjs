import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOOLS,
  TOOL_OPTION_SCHEMA,
  defaultToolOptions,
  bucketFillImage,
  floodSelectImage
} from '../paint/tools.js';

function strip(reds) {
  const data = new Uint8ClampedArray(reds.length * 4);
  reds.forEach((r, i) => data.set([r, 0, 0, 255], i * 4));
  return { width: reds.length, height: 1, data };
}

function ctxFor(img) {
  return {
    canvas: { width: img.width, height: img.height },
    getImageData: () => ({ width: img.width, height: img.height, data: img.data.slice() }),
    putImageData(next) {
      img.data.set(next.data);
    }
  };
}

const px = (img, i) => Array.from(img.data.slice(i * 4, i * 4 + 4));

test('fill schema follows PhotoCraft Paint Bucket order and defaults', () => {
  const schema = TOOL_OPTION_SCHEMA.fill;
  assert.deepEqual(
    schema.map((o) => o.key),
    ['fillSource', 'opacity', 'tolerance', 'antiAlias', 'contiguous', 'sampleAllLayers']
  );
  const [, opacity, tolerance, antiAlias, , all] = schema;
  assert.equal(opacity.type, 'number');
  assert.equal(opacity.label, 'Opacity');
  assert.equal(opacity.min, 1);
  assert.equal(opacity.max, 100);
  assert.equal(opacity.default, 100);
  assert.equal(tolerance.type, 'number');
  assert.equal(tolerance.min, 0);
  assert.equal(tolerance.max, 255);
  assert.equal(tolerance.default, 32);
  assert.equal(antiAlias.type, 'checkbox');
  assert.equal(antiAlias.label, 'Anti-alias');
  assert.ok(!antiAlias.disabled);
  assert.equal(all.type, 'checkbox');
  assert.equal(all.label, 'All Layers');
  assert.equal(all.default, false);
  assert.ok(!schema.some((o) => o.key === 'grow'));
  const d = defaultToolOptions().fill;
  assert.equal(d.opacity, 100);
  assert.equal(d.tolerance, 32);
  assert.equal(d.sampleAllLayers, false);
  assert.equal(d.grow, undefined);
});

test('tolerance 32 fills red 0..32 and leaves 33 and 60', () => {
  const img = strip([0, 20, 31, 32, 33, 60]);
  const state = {
    activeColor: '#0000ff',
    toolOptions: { fill: { ...defaultToolOptions().fill, antiAlias: false } }
  };
  TOOLS.fill.onDown(ctxFor(img), null, state, 0, 0);
  for (let i = 0; i < 4; i++) assert.deepEqual(px(img, i), [0, 0, 255, 255]);
  assert.deepEqual(px(img, 4), [33, 0, 0, 255]);
  assert.deepEqual(px(img, 5), [60, 0, 0, 255]);
});

test('bucketFillImage source-overs at opacity / 100', () => {
  const img = strip([255]);
  bucketFillImage(img, new Uint8Array([1]), '#0000ff', 50);
  const [r, g, b, a] = px(img, 0);
  assert.ok(Math.abs(r - 128) <= 1, `r ${r}`);
  assert.equal(g, 0);
  assert.ok(Math.abs(b - 127) <= 1, `b ${b}`);
  assert.equal(a, 255);
});

test('bucketFillImage skips pixels outside the region', () => {
  const img = strip([10, 10]);
  bucketFillImage(img, new Uint8Array([0, 1]), '#00ff00', 100);
  assert.deepEqual(px(img, 0), [10, 0, 0, 255]);
  assert.deepEqual(px(img, 1), [0, 255, 0, 255]);
});

test('All Layers takes the region from the visible composite, pixels from the layer', () => {
  // Active layer is uniform; the composite has a wall at x = 2 that should stop the fill.
  const layer = strip([0, 0, 0, 0, 0]);
  const visible = strip([0, 0, 200, 0, 0]);
  assert.equal(floodSelectImage(visible, 0, 0, 32, true).w, 2);
  const state = {
    activeColor: '#0000ff',
    toolOptions: {
      fill: { ...defaultToolOptions().fill, antiAlias: false, sampleAllLayers: true }
    },
    sampleVisible: () => visible
  };
  TOOLS.fill.onDown(ctxFor(layer), null, state, 0, 0);
  assert.deepEqual(px(layer, 1), [0, 0, 255, 255]);
  assert.deepEqual(px(layer, 2), [0, 0, 0, 255]);
  assert.deepEqual(px(layer, 4), [0, 0, 0, 255]);
  // Off: the layer alone is uniform, so every pixel fills.
  const flat = strip([0, 0, 0, 0, 0]);
  state.toolOptions.fill.sampleAllLayers = false;
  TOOLS.fill.onDown(ctxFor(flat), null, state, 0, 0);
  assert.deepEqual(px(flat, 4), [0, 0, 255, 255]);
});
