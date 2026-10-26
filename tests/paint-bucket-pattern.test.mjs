import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

function strip(n, rgba = [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) data.set(rgba, i * 4);
  return { width: n, height: 1, data };
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
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

test('fill schema starts with PhotoCraft Fill source, default Foreground', () => {
  const schema = TOOL_OPTION_SCHEMA.fill;
  assert.deepEqual(
    schema.map((o) => o.key),
    ['fillSource', 'opacity', 'tolerance', 'antiAlias', 'contiguous', 'sampleAllLayers']
  );
  const [src] = schema;
  assert.equal(src.type, 'select');
  assert.equal(src.label, 'Fill');
  assert.deepEqual(src.options, [
    { value: 'foreground', label: 'Foreground' },
    { value: 'pattern', label: 'Pattern' }
  ]);
  assert.equal(src.default, 'foreground');
  assert.equal(defaultToolOptions().fill.fillSource, 'foreground');
});

test('Pattern tiles state.pattern from the document origin', () => {
  const img = strip(4);
  const pattern = { width: 2, height: 1, data: new Uint8ClampedArray([...RED, ...BLUE]) };
  const state = {
    activeColor: '#00ff00',
    pattern,
    toolOptions: { fill: { ...defaultToolOptions().fill, fillSource: 'pattern' } }
  };
  TOOLS.fill.onDown(ctxFor(img), null, state, 2, 0);
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => px(img, i)),
    [RED, BLUE, RED, BLUE]
  );
});

test('Pattern falls back to the fg / bg checker before Define Pattern', () => {
  const img = strip(1);
  const state = {
    color: '#ff0000',
    bgColor: '#0000ff',
    toolOptions: { fill: { ...defaultToolOptions().fill, fillSource: 'pattern' } }
  };
  TOOLS.fill.onDown(ctxFor(img), null, state, 0, 0);
  assert.deepEqual(px(img, 0), RED);
});

test('an active selection clips the fill', () => {
  const img = strip(4);
  const state = {
    activeColor: '#0000ff',
    sel: { mode: 'active', x: 0, y: 0, w: 2, h: 1 },
    toolOptions: { fill: { ...defaultToolOptions().fill, antiAlias: false } }
  };
  TOOLS.fill.onDown(ctxFor(img), null, state, 0, 0);
  assert.deepEqual(px(img, 0), BLUE);
  assert.deepEqual(px(img, 1), BLUE);
  assert.deepEqual(px(img, 2), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 3), [0, 0, 0, 255]);
});
