import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions, eraserBlockSize } from '../paint/tools.js';

// A 100 x 100 opaque white layer ctx (getImageData / dirty-rect putImageData).
function pixelCtx() {
  const W = 100,
    H = 100;
  const buf = new Uint8ClampedArray(W * H * 4).fill(255);
  return {
    buf,
    canvas: { width: W, height: H },
    getImageData: () => ({ width: W, height: H, data: new Uint8ClampedArray(buf) }),
    putImageData(img, ox, oy, dx, dy, dw, dh) {
      for (let y = dy; y < dy + dh; y++) {
        const i = (y * W + dx) * 4;
        buf.set(img.data.subarray(i, i + dw * 4), i);
      }
    }
  };
}

// The [x0, y0, x1, y1] box of pixels whose alpha changed, and the set of alphas inside it.
function erased(buf) {
  let box = null;
  const alphas = new Set();
  for (let p = 0; p < buf.length / 4; p++) {
    if (buf[p * 4 + 3] === 255) continue;
    const x = p % 100,
      y = Math.floor(p / 100);
    alphas.add(buf[p * 4 + 3]);
    box = box
      ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)]
      : [x, y, x + 1, y + 1];
  }
  return { box, alphas: [...alphas] };
}

const stateFor = (eraser, extra = {}) => ({
  drawing: false,
  brushSize: 20,
  toolOptions: { eraser: { ...defaultToolOptions().eraser, ...eraser } },
  ...extra
});

test('eraser schema follows PhotoCraft Size, Mode, Opacity', () => {
  const schema = TOOL_OPTION_SCHEMA.eraser;
  assert.deepEqual(schema.map((o) => o.key).slice(0, 3), ['size', 'eraserMode', 'opacity']);
  const [, mode, opacity] = schema;
  assert.equal(mode.type, 'select');
  assert.equal(mode.label, 'Mode');
  assert.deepEqual(
    mode.options.map((o) => [o.value, o.label]),
    [
      ['brush', 'Brush'],
      ['pencil', 'Pencil'],
      ['block', 'Block']
    ]
  );
  assert.equal(mode.default, 'brush');
  assert.equal(opacity.type, 'number');
  assert.equal(opacity.label, 'Opacity');
  assert.equal(opacity.min, 0);
  assert.equal(opacity.max, 100);
  assert.equal(opacity.default, 100);
  const defaults = defaultToolOptions().eraser;
  assert.equal(defaults.eraserMode, 'brush');
  assert.equal(defaults.opacity, 100);
});

test('Size and Opacity are disabled in Block mode', () => {
  const [size, mode, opacity] = TOOL_OPTION_SCHEMA.eraser;
  assert.deepEqual(size.disabledWhen, { key: 'eraserMode', value: 'block' });
  assert.deepEqual(opacity.disabledWhen, { key: 'eraserMode', value: 'block' });
  assert.equal(mode.disabledWhen, undefined);
});

test('Pencil mode is aliased: a whole-pixel Size square at Opacity', () => {
  const ctx = pixelCtx();
  const state = stateFor({ eraserMode: 'pencil', opacity: 50, size: 4 });
  TOOLS.eraser.onDown(ctx, null, state, 10.3, 10.3);
  TOOLS.eraser.onUp(ctx, null, state);
  assert.deepEqual(erased(ctx.buf), { box: [8, 8, 12, 12], alphas: [128] });
});

test('Pencil mode does not build up past Opacity within one stroke', () => {
  const ctx = pixelCtx();
  const state = stateFor({ eraserMode: 'pencil', opacity: 50, size: 4 });
  TOOLS.eraser.onDown(ctx, null, state, 10.3, 10.3);
  TOOLS.eraser.onMove(ctx, null, state, 30.3, 10.3);
  TOOLS.eraser.onMove(ctx, null, state, 10.3, 10.3);
  TOOLS.eraser.onUp(ctx, null, state);
  assert.deepEqual(erased(ctx.buf), { box: [8, 8, 32, 12], alphas: [128] });
});

test('Block mode erases a hard 16 / zoom square at full opacity', () => {
  assert.equal(eraserBlockSize(undefined), 16);
  assert.equal(eraserBlockSize(2), 8);
  assert.equal(eraserBlockSize(64), 1);
  const ctx = pixelCtx();
  const state = stateFor({ eraserMode: 'block', opacity: 50, size: 40 }, { zoom: 2 });
  TOOLS.eraser.onDown(ctx, null, state, 20, 20);
  assert.deepEqual(erased(ctx.buf), { box: [16, 16, 24, 24], alphas: [0] });
  TOOLS.eraser.onMove(ctx, null, state, 28, 20);
  TOOLS.eraser.onUp(ctx, null, state);
  assert.deepEqual(erased(ctx.buf), { box: [16, 16, 32, 24], alphas: [0] });
});
