import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { eraseCoverage, eraseDab } from '../paint/retouch.js';

const W = 40,
  H = 40;

function opaque(a = 255) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    d[p * 4] = 200;
    d[p * 4 + 3] = a;
  }
  return d;
}

// A layer-like ctx backed by one RGBA buffer (getImageData / dirty-rect putImageData).
function pixelCtx() {
  const buf = opaque();
  const calls = [];
  const ctx = {
    buf,
    calls,
    canvas: { width: W, height: H },
    getImageData: () => ({ width: W, height: H, data: new Uint8ClampedArray(buf) }),
    putImageData(img, ox, oy, dx, dy, dw, dh) {
      calls.push('putImageData');
      for (let y = dy; y < dy + dh; y++) {
        const i = (y * W + dx) * 4;
        buf.set(img.data.subarray(i, i + dw * 4), i);
      }
    }
  };
  for (const k of ['beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke', 'fillRect']) {
    ctx[k] = () => calls.push(k);
  }
  return ctx;
}

const stateFor = (eraser) => ({
  drawing: false,
  brushSize: 20,
  toolOptions: { eraser: { ...defaultToolOptions().eraser, ...eraser } }
});

const alphaAt = (d, x, y) => d[(y * W + x) * 4 + 3];

test('eraser schema adds PhotoCraft Flow and Hardness after Opacity', () => {
  const schema = TOOL_OPTION_SCHEMA.eraser;
  assert.deepEqual(
    schema.map((o) => o.key),
    ['size', 'eraserMode', 'opacity', 'flow', 'hardness']
  );
  const [, , , flow, hardness] = schema;
  assert.equal(flow.type, 'number');
  assert.equal(flow.label, 'Flow');
  assert.equal(flow.min, 1);
  assert.equal(flow.max, 100);
  assert.equal(flow.default, 100);
  assert.equal(hardness.type, 'range');
  assert.equal(hardness.label, 'Hardness');
  assert.equal(hardness.min, 0);
  assert.equal(hardness.max, 100);
  assert.equal(hardness.default, 100);
  for (const o of [flow, hardness]) {
    assert.equal(o.disabledWhen.key, 'eraserMode');
    assert.deepEqual([...o.disabledWhen.values].sort(), ['block', 'pencil']);
  }
  const defaults = defaultToolOptions().eraser;
  assert.equal(defaults.flow, 100);
  assert.equal(defaults.hardness, 100);
});

test('eraseCoverage at opacity 50 halves alpha and a second pass leaves it unchanged', () => {
  const src = opaque(200);
  const dst = new Uint8ClampedArray(src);
  const cov = new Float32Array(W * H).fill(1);
  eraseCoverage(src, dst, cov, 0.5);
  assert.equal(alphaAt(dst, 3, 3), 100);
  eraseCoverage(src, dst, cov, 0.5);
  assert.equal(alphaAt(dst, 3, 3), 100);
  assert.equal(dst[0], 200, 'color is left alone');
});

test('eraseCoverage skips pixels outside the mask and with no coverage', () => {
  const src = opaque();
  const dst = new Uint8ClampedArray(src);
  const cov = new Float32Array(W * H).fill(1);
  cov[1] = 0;
  const mask = new Uint8Array(W * H).fill(1);
  mask[2] = 0;
  eraseCoverage(src, dst, cov, 1, mask);
  assert.equal(alphaAt(dst, 0, 0), 0);
  assert.equal(alphaAt(dst, 1, 0), 255);
  assert.equal(alphaAt(dst, 2, 0), 255);
});

test('overlapping dabs in one stroke never erase past the opacity cap', () => {
  const src = opaque();
  const dst = new Uint8ClampedArray(src);
  const cov = new Float32Array(W * H);
  for (let i = 0; i < 10; i++) eraseDab(dst, src, W, H, 20, 20, 8, 1, 1, 0.5, null, cov);
  assert.equal(alphaAt(dst, 20, 20), 128);
});

test('flow 50 builds toward the opacity cap over repeated dabs', () => {
  const src = opaque();
  const dst = new Uint8ClampedArray(src);
  const cov = new Float32Array(W * H);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    eraseDab(dst, src, W, H, 20, 20, 8, 1, 0.5, 1, null, cov);
    seen.push(alphaAt(dst, 20, 20));
  }
  assert.equal(seen[0], 128);
  assert.equal(seen[1], 64);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1]);
  assert.equal(seen.at(-1), 0);

  const capped = new Uint8ClampedArray(src);
  const cov2 = new Float32Array(W * H);
  for (let i = 0; i < 20; i++) eraseDab(capped, src, W, H, 20, 20, 8, 1, 0.5, 0.5, null, cov2);
  assert.ok(alphaAt(capped, 20, 20) >= 127, 'stops at src · (1 − opacity)');
});

test('hardness 0 leaves a partially erased rim; hardness 100 erases it fully', () => {
  const src = opaque();
  const soft = new Uint8ClampedArray(src);
  eraseDab(soft, src, W, H, 20.5, 20.5, 10, 0, 1, 1, null, new Float32Array(W * H));
  assert.equal(alphaAt(soft, 20, 20), 0);
  const rim = alphaAt(soft, 27, 20);
  assert.ok(rim > 0 && rim < 255, `rim alpha ${rim}`);

  const hard = new Uint8ClampedArray(src);
  eraseDab(hard, src, W, H, 20, 20, 10, 1, 1, 1, null, new Float32Array(W * H));
  assert.equal(alphaAt(hard, 27, 20), 0);
});

test('Brush mode erases through round-tip dabs, not a canvas stroke', () => {
  const ctx = pixelCtx();
  const state = stateFor({ opacity: 50, size: 10 });
  TOOLS.eraser.onDown(ctx, null, state, 10.5, 20.5);
  TOOLS.eraser.onMove(ctx, null, state, 30.5, 20.5);
  // Back over the same pixels in the same stroke.
  TOOLS.eraser.onMove(ctx, null, state, 10.5, 20.5);
  TOOLS.eraser.onUp(ctx, null, state);
  assert.ok(ctx.calls.includes('putImageData'));
  assert.ok(!ctx.calls.includes('stroke') && !ctx.calls.includes('arc'));
  assert.equal(alphaAt(ctx.buf, 20, 20), 128);
  assert.equal(alphaAt(ctx.buf, 20, 5), 255);
  assert.equal(state.eraseStroke, null);
  // No canvas compositing state is touched: every mode writes bytes through putImageData.
  assert.equal(ctx.globalCompositeOperation, undefined);
  assert.equal(ctx.globalAlpha, undefined);
});

test('Brush mode Flow and Hardness come from the eraser options', () => {
  const ctx = pixelCtx();
  const state = stateFor({ flow: 50, hardness: 0, size: 20 });
  TOOLS.eraser.onDown(ctx, null, state, 20, 20);
  assert.equal(state.eraseStroke.flow, 0.5);
  assert.equal(state.eraseStroke.hardness, 0);
  TOOLS.eraser.onUp(ctx, null, state);
  const centre = alphaAt(ctx.buf, 20, 20);
  assert.ok(centre > 0 && centre < 255, `centre alpha ${centre}`);
});
