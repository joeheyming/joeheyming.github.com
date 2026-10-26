import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, defaultToolOptions } from '../paint/tools.js';

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

function stateFor(tool, sel) {
  return {
    drawing: false,
    brushSize: 8,
    activeColor: '#000000',
    bgColor: '#ffffff',
    sel: sel ? { ...sel } : { mode: 'none' },
    toolOptions: { [tool]: { ...defaultToolOptions()[tool], size: 8 } }
  };
}

// A horizontal stroke along y = 20 from x = 2 to x = 37, crossing both vertical selection edges.
function stroke(tool, sel) {
  const ctx = pixelCtx();
  const state = stateFor(tool, sel);
  const before = new Uint8ClampedArray(ctx.buf);
  TOOLS[tool].onDown(ctx, null, state, 2.5, 20.5);
  TOOLS[tool].onMove(ctx, null, state, 37.5, 20.5);
  TOOLS[tool].onUp(ctx, null, state, 37.5, 20.5);
  return { before, after: ctx.buf };
}

function changed(before, after, p) {
  for (let c = 0; c < 4; c++) if (before[p * 4 + c] !== after[p * 4 + c]) return true;
  return false;
}

for (const tool of ['brush', 'pencil', 'eraser']) {
  test(`${tool} stroke across a rectangular selection edge stays inside it`, () => {
    const { before, after } = stroke(tool, SEL);
    let changedInside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (inside(x, y)) {
          if (changed(before, after, p)) changedInside++;
        } else {
          assert.ok(
            !changed(before, after, p),
            `${tool} changed (${x}, ${y}) outside the selection`
          );
        }
      }
    }
    assert.ok(changedInside > 0, `${tool} changed nothing inside the selection`);
    // The pixel on the stroke just inside the left edge is painted / erased.
    assert.ok(changed(before, after, 20 * W + 10));
  });

  test(`${tool} with no active selection paints the whole layer`, () => {
    const { before, after } = stroke(tool, null);
    assert.ok(changed(before, after, 20 * W + 3), `${tool} left the stroke start untouched`);
    assert.ok(changed(before, after, 20 * W + 36), `${tool} left the stroke end untouched`);
    assert.ok(changed(before, after, 20 * W + 20));
  });
}

test('eraser in Brush mode erases alpha only inside the selection', () => {
  const { after } = stroke('eraser', SEL);
  assert.equal(after[(20 * W + 20) * 4 + 3], 0);
  assert.equal(after[(20 * W + 5) * 4 + 3], 255);
  assert.equal(after[(20 * W + 34) * 4 + 3], 255);
});

test('a stroke under a floating selection drops its baseData before painting', () => {
  const ctx = pixelCtx();
  const state = stateFor('brush', { ...SEL, data: {}, baseData: {} });
  TOOLS.brush.onDown(ctx, null, state, 20.5, 20.5);
  TOOLS.brush.onUp(ctx, null, state, 20.5, 20.5);
  assert.equal(state.sel.data, null);
  assert.equal(state.sel.baseData, null);
  assert.equal(state.sel.mode, 'active');
});
