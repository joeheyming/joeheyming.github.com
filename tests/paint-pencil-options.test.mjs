import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { autoEraseColor, pencilDab, pencilSnap } from '../paint/retouch.js';

const W = 40,
  H = 40;

function white(a = 255) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    d.fill(255, p * 4, p * 4 + 3);
    d[p * 4 + 3] = a;
  }
  return d;
}

// A layer-like ctx backed by one RGBA buffer (getImageData / dirty-rect putImageData).
function pixelCtx(a = 255) {
  const buf = white(a);
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

const stateFor = (pencil) => ({
  drawing: false,
  brushSize: 4,
  activeColor: '#000000',
  bgColor: '#ffffff',
  toolOptions: { pencil: { ...defaultToolOptions().pencil, ...pencil } }
});

const px = (d, x, y) => [...d.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

function stroke(ctx, state, pts) {
  const [x0, y0] = pts[0];
  TOOLS.pencil.onDown(ctx, null, state, x0, y0);
  for (const [x, y] of pts.slice(1)) TOOLS.pencil.onMove(ctx, null, state, x, y);
  TOOLS.pencil.onUp(ctx, null, state, ...pts.at(-1));
}

test('pencil schema follows PhotoCraft Size, Opacity, Smoothing, Auto Erase', () => {
  const schema = TOOL_OPTION_SCHEMA.pencil;
  assert.deepEqual(
    schema.slice(0, 4).map((o) => o.key),
    ['size', 'opacity', 'smoothing', 'autoErase']
  );
  const [size, opacity, smoothing, autoErase] = schema;
  assert.deepEqual([size.type, size.min, size.max, size.default], ['range', 1, 100, 1]);
  assert.deepEqual(
    [opacity.type, opacity.min, opacity.max, opacity.default],
    ['number', 0, 100, 100]
  );
  assert.deepEqual(
    [smoothing.type, smoothing.label, smoothing.min, smoothing.max, smoothing.default],
    ['range', 'Smoothing', 0, 100, 0]
  );
  assert.deepEqual(
    [autoErase.type, autoErase.label, autoErase.default],
    ['checkbox', 'Auto Erase', false]
  );
  assert.ok(schema.slice(4).every((o) => o.key === 'lockAlpha'));
  assert.equal(
    schema.some((o) => o.key === 'stabilize'),
    false
  );
});

test('pencilSnap puts odd sizes on pixel centres and even sizes on pixel corners', () => {
  assert.equal(pencilSnap(10.2, 1), 10.5);
  assert.equal(pencilSnap(10.9, 3), 10.5);
  assert.equal(pencilSnap(10.4, 2), 10);
  assert.equal(pencilSnap(10.6, 2), 11);
});

test('a size 1 pencil dab paints exactly the pixel under the pointer', () => {
  const dst = white();
  const src = new Uint8ClampedArray(dst);
  const cov = new Float32Array(W * H);
  pencilDab(dst, src, W, H, 7.9, 3.1, 1, 1, [0, 0, 0], false, null, cov);
  let painted = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (px(dst, x, y)[0] !== 255) painted++;
  }
  assert.equal(painted, 1);
  assert.deepEqual(px(dst, 7, 3), [0, 0, 0, 255]);
});

test('pencil strokes are aliased: coverage is exactly 0 or 1, alpha is 0 or 255', () => {
  const ctx = pixelCtx(0);
  const state = stateFor({ size: 7 });
  stroke(ctx, state, [
    [5.3, 5.7],
    [20.1, 13.4],
    [33.8, 30.2]
  ]);
  let painted = 0;
  for (let p = 0; p < W * H; p++) {
    const a = ctx.buf[p * 4 + 3];
    assert.ok(a === 0 || a === 255, `partial alpha ${a} at ${p}`);
    painted += a === 255;
  }
  assert.ok(painted > 100, `${painted}`);
  assert.deepEqual(px(ctx.buf, 20, 13), [0, 0, 0, 255]);
});

test('a stroke crossing itself at opacity 50 over white leaves 128 gray', () => {
  const ctx = pixelCtx();
  const state = stateFor({ size: 3, opacity: 50 });
  stroke(ctx, state, [
    [5.5, 20.5],
    [35.5, 20.5],
    [20.5, 5.5],
    [20.5, 35.5]
  ]);
  assert.deepEqual(px(ctx.buf, 20, 20), [128, 128, 128, 255]);
  assert.deepEqual(px(ctx.buf, 10, 20), [128, 128, 128, 255]);
  assert.deepEqual(px(ctx.buf, 2, 2), [255, 255, 255, 255]);
});

test('Auto Erase paints the background from a foreground pixel, the foreground otherwise', () => {
  const ctx = pixelCtx();
  const state = stateFor({ size: 1 });
  stroke(ctx, state, [
    [2.5, 20.5],
    [38.5, 20.5]
  ]);
  assert.deepEqual(px(ctx.buf, 15, 20), [0, 0, 0, 255]);
  state.toolOptions.pencil.autoErase = true;
  state.activeColor = '#000000';
  state.bgColor = '#ff0000';
  // Starting on the black line: background red.
  stroke(ctx, state, [
    [15.5, 20.5],
    [15.5, 30.5]
  ]);
  assert.deepEqual(px(ctx.buf, 15, 25), [255, 0, 0, 255]);
  assert.deepEqual(px(ctx.buf, 15, 20), [255, 0, 0, 255]);
  // Starting off it: foreground black.
  stroke(ctx, state, [
    [30.5, 5.5],
    [30.5, 15.5]
  ]);
  assert.deepEqual(px(ctx.buf, 30, 10), [0, 0, 0, 255]);
});

test('autoEraseColor needs a visible pixel within 1.5 / 255 of the foreground', () => {
  const d = new Uint8ClampedArray([1, 1, 1, 255, 3, 0, 0, 255, 0, 0, 0, 0]);
  const fg = [0, 0, 0],
    bg = [9, 9, 9];
  assert.equal(autoEraseColor(d, 3, 1, 0.5, 0.5, fg, bg), bg);
  assert.equal(autoEraseColor(d, 3, 1, 1.5, 0.5, fg, bg), fg);
  assert.equal(autoEraseColor(d, 3, 1, 2.5, 0.5, fg, bg), fg);
  assert.equal(autoEraseColor(d, 3, 1, -1, 0.5, fg, bg), fg);
});

test('Smoothing lags the stroke through stabilizePoint', () => {
  const ctx = pixelCtx(0);
  const state = stateFor({ size: 1, smoothing: 100 });
  stroke(ctx, state, [
    [2.5, 2.5],
    [30.5, 2.5]
  ]);
  // One move at 100 smoothing only steps 8% of the way toward the pointer.
  assert.equal(px(ctx.buf, 4, 2)[3], 255);
  assert.equal(px(ctx.buf, 20, 2)[3], 0);
});

test('Lock alpha keeps destination alpha', () => {
  const ctx = pixelCtx(0);
  ctx.buf.set([255, 255, 255, 255], (20 * W + 20) * 4);
  const state = stateFor({ size: 5, lockAlpha: true });
  stroke(ctx, state, [[20.5, 20.5]]);
  assert.deepEqual(px(ctx.buf, 20, 20), [0, 0, 0, 255]);
  assert.equal(px(ctx.buf, 21, 20)[3], 0);
});
