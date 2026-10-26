import test from 'node:test';
import assert from 'node:assert/strict';

import { ICONS } from '../paint/icons.js';
import { historyIconName } from '../paint/history.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions, magicEraseImage } from '../paint/tools.js';

const RED = [200, 30, 30, 255];
const BLUE = [20, 40, 220, 255];

function image(W, H, f) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(f(x, y), (y * W + x) * 4);
  return { width: W, height: H, data };
}

function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

// Red with a blue bar at x 4..5 splitting it into a left and a right half.
const split = () => image(10, 6, (x) => (x === 4 || x === 5 ? BLUE : RED));

test('magicEraser is a tool with the eraser-magic icon and PhotoCraft options', () => {
  assert.equal(TOOLS.magicEraser.label, 'Magic Eraser');
  assert.equal(TOOLS.magicEraser.icon, 'eraser-magic');
  assert.match(ICONS['eraser-magic'], /M5 1v5/);
  assert.equal(historyIconName('Magic Eraser'), 'eraser-magic');
  const fields = TOOL_OPTION_SCHEMA.magicEraser.filter((f) => f.type !== 'hint');
  assert.deepEqual(
    fields.map((f) => [f.key, f.type, f.label, f.min, f.max, f.default]),
    [
      ['tolerance', 'number', 'Tolerance', 0, 255, 32],
      ['antiAlias', 'checkbox', 'Anti-alias', undefined, undefined, true],
      ['contiguous', 'checkbox', 'Contiguous', undefined, undefined, true],
      ['sampleAllLayers', 'checkbox', 'Sample All Layers', undefined, undefined, false],
      ['opacity', 'number', 'Opacity', 1, 100, 100]
    ]
  );
  assert.deepEqual(defaultToolOptions().magicEraser, {
    tolerance: 32,
    antiAlias: true,
    contiguous: true,
    sampleAllLayers: false,
    opacity: 100
  });
});

test('contiguous erases only the clicked half; non-contiguous erases every match', () => {
  const opts = { antiAlias: false };
  const a = split();
  assert.equal(magicEraseImage(a, a, 1, 1, opts), 4 * 6);
  assert.deepEqual(px(a, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(a, 3, 5), [0, 0, 0, 0]);
  assert.deepEqual(px(a, 4, 0), BLUE);
  assert.deepEqual(px(a, 7, 2), RED);

  const b = split();
  assert.equal(magicEraseImage(b, b, 1, 1, { ...opts, contiguous: false }), 8 * 6);
  assert.deepEqual(px(b, 7, 2), [0, 0, 0, 0]);
  assert.deepEqual(px(b, 5, 2), BLUE);
});

test('Tolerance is a per-channel distance from the clicked colour', () => {
  const near = [RED[0] + 20, RED[1], RED[2], 255];
  const make = () => image(4, 1, (x) => (x < 2 ? RED : near));
  const tight = make();
  magicEraseImage(tight, tight, 0, 0, { antiAlias: false, tolerance: 19 });
  assert.deepEqual(px(tight, 2, 0), near);
  const loose = make();
  magicEraseImage(loose, loose, 0, 0, { antiAlias: false, tolerance: 20 });
  assert.deepEqual(px(loose, 2, 0), [0, 0, 0, 0]);
});

test('Opacity multiplies alpha by 1 − opacity and keeps the colour', () => {
  const img = split();
  magicEraseImage(img, img, 1, 1, { antiAlias: false, opacity: 25 });
  assert.deepEqual(px(img, 1, 1), [RED[0], RED[1], RED[2], Math.round(255 * 0.75)]);
  magicEraseImage(img, img, 1, 1, { antiAlias: false, opacity: 50 });
  assert.equal(px(img, 1, 1)[3], Math.round(191 * 0.5));
});

test('Anti-alias softens the edge on both sides with the wand fringe', () => {
  const img = split();
  magicEraseImage(img, img, 1, 2, { antiAlias: true });
  // Inside the region away from the edge: fully erased.
  assert.deepEqual(px(img, 1, 2), [0, 0, 0, 0]);
  // Last region column (3 of 9 neighbours outside): 0.5 + 0.5 × 6 / 9 coverage.
  const kIn = Math.round((0.5 + (0.5 * 6) / 9) * 255) / 255;
  assert.deepEqual(px(img, 3, 2), [RED[0], RED[1], RED[2], Math.round(255 * (1 - kIn))]);
  // First blue column (3 of 9 neighbours inside): 0.5 × 3 / 9 coverage.
  const kOut = Math.round(((0.5 * 3) / 9) * 255) / 255;
  assert.deepEqual(px(img, 4, 2), [BLUE[0], BLUE[1], BLUE[2], Math.round(255 * (1 - kOut))]);
  assert.deepEqual(px(img, 5, 2), BLUE);
});

test('Sample All Layers matches the sample image but erases the target', () => {
  const target = image(4, 1, () => RED);
  const sample = image(4, 1, (x) => (x < 2 ? RED : BLUE));
  magicEraseImage(target, sample, 0, 0, { antiAlias: false });
  assert.deepEqual(px(target, 1, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(target, 2, 0), RED);
});

test('a selection mask limits the erase; off-canvas erases nothing', () => {
  const img = split();
  const mask = new Uint8Array(10 * 6);
  for (let x = 0; x < 10; x++) mask[x] = 1;
  magicEraseImage(img, img, 1, 1, { antiAlias: false }, mask);
  assert.deepEqual(px(img, 1, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(img, 1, 1), RED);
  assert.equal(magicEraseImage(img, img, -1, 0, {}), 0);
});

function fakeCtx(img, order) {
  return {
    canvas: { width: img.width, height: img.height },
    getImageData() {
      return { width: img.width, height: img.height, data: img.data.slice() };
    },
    putImageData(next) {
      order.push('put');
      img.data.set(next.data);
    }
  };
}

test('the tool pushes one undo before the put and clips to the active selection', () => {
  const img = split();
  const order = [];
  const sel = { mode: 'active', x: 0, y: 0, w: 2, h: 6, data: {}, baseData: {} };
  const state = {
    toolOptions: { magicEraser: { ...defaultToolOptions().magicEraser, antiAlias: false } },
    sel,
    pushUndo: (label) => order.push('undo:' + label)
  };
  TOOLS.magicEraser.onDown(fakeCtx(img, order), null, state, 0, 0);
  assert.deepEqual(order, ['undo:Magic Eraser', 'put']);
  assert.deepEqual(px(img, 1, 3), [0, 0, 0, 0]);
  assert.deepEqual(px(img, 2, 3), RED);
  assert.equal(sel.data, null);

  const miss = [];
  TOOLS.magicEraser.onDown(
    fakeCtx(img, miss),
    null,
    { ...state, pushUndo: () => miss.push('undo') },
    20,
    0
  );
  assert.deepEqual(miss, []);
});

test('Sample All Layers reads state.sampleVisible', () => {
  const img = image(4, 1, () => RED);
  const order = [];
  const state = {
    toolOptions: {
      magicEraser: { ...defaultToolOptions().magicEraser, antiAlias: false, sampleAllLayers: true }
    },
    sel: { mode: 'none' },
    sampleVisible: () => image(4, 1, (x) => (x < 1 ? RED : BLUE)),
    pushUndo: () => {}
  };
  TOOLS.magicEraser.onDown(fakeCtx(img, order), null, state, 0, 0);
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(img, 1, 0), RED);
});
