import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_OPTION_SCHEMA, defaultToolOptions, floodSelectImage } from '../paint/tools.js';
import { compositeTreeBytes } from '../paint/layer-groups.js';

function strip(reds) {
  const data = new Uint8ClampedArray(reds.length * 4);
  reds.forEach((r, i) => {
    data[i * 4] = r;
    data[i * 4 + 3] = 255;
  });
  return { width: reds.length, height: 1, data };
}

test('Magic Wand options end with Sample All Layers', () => {
  const schema = TOOL_OPTION_SCHEMA.magicWand;
  assert.deepEqual(
    schema.map((o) => o.key),
    ['selectionMode', 'tolerance', 'antiAlias', 'contiguous', 'sampleAllLayers']
  );
  const sample = schema[4];
  assert.equal(sample.type, 'checkbox');
  assert.equal(sample.label, 'Sample All Layers');
  assert.equal(sample.default, false);
  assert.equal(defaultToolOptions().magicWand.sampleAllLayers, false);
});

test('contiguous wand selects only matching pixels, with no edge ring', () => {
  const result = floodSelectImage(strip([0, 20, 31, 32, 33, 60]), 0, 0, 32, true);
  assert.deepEqual([...result.mask], [1, 1, 1, 1, 0, 0]);
  assert.deepEqual([result.x, result.y, result.w, result.h], [0, 0, 4, 1]);
});

test('contiguous wand on a 2D island leaves the surrounding pixels unselected', () => {
  const W = 4,
    H = 4;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const i of [5, 6, 9, 10]) {
    data[i * 4] = 0;
  }
  const result = floodSelectImage({ width: W, height: H, data }, 1, 1, 10, true);
  const expected = new Array(W * H).fill(0);
  for (const i of [5, 6, 9, 10]) expected[i] = 1;
  assert.deepEqual([...result.mask], expected);
});

test('floodSelectImage on a two-layer composite differs from the active layer', () => {
  const W = 4,
    H = 1;
  // Bottom layer: red, red, green, red. Active top layer: transparent except blue at x = 3.
  const bottom = new Uint8ClampedArray(W * H * 4);
  [0, 1, 3].forEach((i) => (bottom[i * 4] = 255));
  bottom[2 * 4 + 1] = 255;
  for (let i = 0; i < W; i++) bottom[i * 4 + 3] = 255;
  const top = new Uint8ClampedArray(W * H * 4);
  top[3 * 4 + 2] = 255;
  top[3 * 4 + 3] = 255;
  const layers = [
    { id: 1, kind: 'pixel', visible: true, opacity: 1, data: bottom },
    { id: 2, kind: 'pixel', visible: true, opacity: 1, data: top }
  ];
  const composite = { width: W, height: H, data: compositeTreeBytes(layers, W, H) };
  const active = { width: W, height: H, data: top };

  // The active layer is transparent through x = 2; the composite stops at the green pixel.
  const fromActive = floodSelectImage(active, 0, 0, 32, true);
  const fromComposite = floodSelectImage(composite, 0, 0, 32, true);
  assert.deepEqual([...fromActive.mask], [1, 1, 1, 0]);
  assert.deepEqual([...fromComposite.mask], [1, 1, 0, 0]);
  assert.notDeepEqual([...fromActive.mask], [...fromComposite.mask]);
});
