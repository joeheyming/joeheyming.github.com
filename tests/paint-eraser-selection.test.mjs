import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, defaultToolOptions } from '../paint/tools.js';
import { eraseSquareDab } from '../paint/retouch.js';

const W = 40,
  H = 40;

// A layer-like ctx backed by one opaque white RGBA buffer (getImageData / dirty-rect putImageData).
function pixelCtx() {
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

// The rectangular selection x 10..29, y 10..29.
const SEL = { mode: 'active', x: 10, y: 10, w: 20, h: 20 };
const inside = (x, y) => x >= SEL.x && x < SEL.x + SEL.w && y >= SEL.y && y < SEL.y + SEL.h;

// A horizontal eraser stroke along y = 20 from x = 2 to x = 37, crossing both vertical edges.
function stroke(eraser, sel, extra = {}) {
  const ctx = pixelCtx();
  const state = {
    drawing: false,
    brushSize: 8,
    zoom: 2,
    sel: sel ? { ...sel } : { mode: 'none' },
    toolOptions: { eraser: { ...defaultToolOptions().eraser, size: 6, ...eraser } },
    ...extra
  };
  const before = new Uint8ClampedArray(ctx.buf);
  TOOLS.eraser.onDown(ctx, null, state, 2.5, 20.5);
  TOOLS.eraser.onMove(ctx, null, state, 37.5, 20.5);
  TOOLS.eraser.onUp(ctx, null, state, 37.5, 20.5);
  return { before, after: ctx.buf, state };
}

const alphaAt = (buf, x, y) => buf[(y * W + x) * 4 + 3];

const MODES = [
  // Pencil: Size 6 at 50% Opacity; Block: 16 / zoom = 8 px at full opacity.
  { mode: 'pencil', opts: { opacity: 50 }, alpha: 128, rows: [18, 24] },
  { mode: 'block', opts: { opacity: 50 }, alpha: 0, rows: [17, 25] }
];

for (const { mode, opts, alpha, rows } of MODES) {
  test(`${mode}-mode eraser across a rectangular selection edge stays inside it`, () => {
    const { before, after } = stroke({ eraserMode: mode, ...opts }, SEL);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const onStroke = y >= rows[0] && y < rows[1] && x >= 0 && x < W;
        if (inside(x, y)) {
          const want = onStroke ? alpha : 255;
          assert.equal(after[i + 3], want, `${mode} alpha at (${x}, ${y})`);
          for (let c = 0; c < 3; c++) assert.equal(after[i + c], before[i + c]);
        } else {
          for (let c = 0; c < 4; c++) {
            assert.equal(after[i + c], before[i + c], `${mode} changed (${x}, ${y}) outside`);
          }
        }
      }
    }
  });

  test(`${mode}-mode eraser with no active selection erases the whole stroke`, () => {
    const { after } = stroke({ eraserMode: mode, ...opts }, null);
    for (let y = 0; y < H; y++) {
      const want = y >= rows[0] && y < rows[1] ? alpha : 255;
      assert.equal(alphaAt(after, 3, y), want, `${mode} alpha at (3, ${y})`);
      assert.equal(alphaAt(after, 36, y), want, `${mode} alpha at (36, ${y})`);
    }
  });
}

test('a floating paste is dropped, not erased through, when the stroke starts', () => {
  const sel = { ...SEL, data: {}, baseData: {} };
  const { state } = stroke({ eraserMode: 'block' }, sel);
  assert.equal(state.sel.data, null);
  assert.equal(state.sel.baseData, null);
});

test('eraseSquareDab skips masked pixels and erases each pixel once per stroke', () => {
  const src = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  const dst = new Uint8ClampedArray(src);
  const cov = new Uint8Array(16);
  const mask = new Uint8Array(16).fill(1);
  mask[0] = 0;
  assert.deepEqual(eraseSquareDab(dst, src, 4, 4, 1, 1, 2, 0.5, mask, cov), [0, 0, 2, 2]);
  assert.deepEqual(eraseSquareDab(dst, src, 4, 4, 1, 1, 2, 0.5, mask, cov), [0, 0, 2, 2]);
  assert.deepEqual(
    [0, 1, 4, 5].map((p) => dst[p * 4 + 3]),
    [255, 128, 128, 128]
  );
  assert.equal(eraseSquareDab(dst, src, 4, 4, 1, 1, 2, 0, null, cov), null);
  assert.equal(eraseSquareDab(dst, src, 4, 4, -9, -9, 2, 1, null, cov), null);
});
