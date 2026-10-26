import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { paintDab } from '../paint/retouch.js';

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

const stateFor = (brush) => ({
  drawing: false,
  brushSize: 4,
  activeColor: '#000000',
  toolOptions: { brush: { ...defaultToolOptions().brush, ...brush } }
});

const px = (d, x, y) => [...d.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

// One dab straight on a pixel centre with the given options; returns [dst, src, cov].
function dab(opts, dst = white(), cov = new Float32Array(W * H)) {
  const src = new Uint8ClampedArray(dst);
  const o = { radius: 5, hardness: 1, flow: 1, opacity: 1, rgb: [0, 0, 0], lock: false, ...opts };
  paintDab(
    dst,
    src,
    W,
    H,
    20.5,
    20.5,
    o.radius,
    o.hardness,
    o.flow,
    o.opacity,
    o.rgb,
    o.lock,
    null,
    cov
  );
  return [dst, src, cov];
}

test('brush schema follows PhotoCraft Size, Hardness, Opacity, Flow, Smoothing', () => {
  const schema = TOOL_OPTION_SCHEMA.brush;
  assert.deepEqual(
    schema.slice(0, 5).map((o) => o.key),
    ['size', 'hardness', 'opacity', 'flow', 'smoothing']
  );
  const [size, hardness, opacity, flow, smoothing] = schema;
  assert.deepEqual([size.type, size.min, size.max, size.default], ['range', 1, 100, 20]);
  assert.deepEqual(
    [hardness.type, hardness.min, hardness.max, hardness.default],
    ['number', 0, 100, 100]
  );
  assert.deepEqual(
    [opacity.type, opacity.min, opacity.max, opacity.default],
    ['number', 0, 100, 100]
  );
  assert.deepEqual([flow.type, flow.min, flow.max, flow.default], ['number', 1, 100, 100]);
  assert.deepEqual(
    [smoothing.type, smoothing.label, smoothing.min, smoothing.max, smoothing.default],
    ['range', 'Smoothing', 0, 100, 0]
  );
  assert.ok(schema.slice(5).every((o) => o.key === 'lockAlpha'));
  assert.equal(
    schema.some((o) => o.key === 'stabilize'),
    false
  );
});

test('paintDab at opacity 50 gives 128 gray and a second pass in the stroke leaves it', () => {
  const [dst, , cov] = dab({ opacity: 0.5 });
  assert.deepEqual(px(dst, 20, 20), [128, 128, 128, 255]);
  // Same stroke: the pre-stroke src stays white, coverage is shared.
  const src = white();
  paintDab(dst, src, W, H, 20.5, 20.5, 5, 1, 1, 0.5, [0, 0, 0], false, null, cov);
  assert.deepEqual(px(dst, 20, 20), [128, 128, 128, 255]);
});

test('flow 50 builds toward the opacity cap without passing it', () => {
  const dst = white();
  const src = new Uint8ClampedArray(dst);
  const cov = new Float32Array(W * H);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    paintDab(dst, src, W, H, 20.5, 20.5, 5, 1, 0.5, 1, [0, 0, 0], false, null, cov);
    seen.push(px(dst, 20, 20)[0]);
  }
  assert.equal(seen[0], 128);
  assert.equal(seen[1], 64);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1]);
  assert.ok(seen.at(-1) <= 1);
});

test('hardness 0 leaves a partial rim, hardness 100 a solid disc', () => {
  const [soft] = dab({ hardness: 0 });
  const [hard] = dab({ hardness: 1 });
  const rim = px(soft, 24, 20)[0];
  assert.ok(rim > 0 && rim < 255, `rim ${rim}`);
  assert.equal(px(hard, 23, 20)[0], 0);
  assert.ok(px(soft, 23, 20)[0] > px(hard, 23, 20)[0]);
});

test('paintDab composites over transparency and lockAlpha keeps the alpha', () => {
  const [over] = dab({ opacity: 0.5, rgb: [255, 0, 0] }, white(0));
  assert.deepEqual(px(over, 20, 20), [255, 0, 0, 128]);
  const half = white(100);
  const [locked] = dab({ rgb: [0, 0, 0], lock: true }, half);
  assert.deepEqual(px(locked, 20, 20), [0, 0, 0, 100]);
  const [clear] = dab({ lock: true }, white(0));
  assert.equal(px(clear, 20, 20)[3], 0);
});

test('a brush stroke never darkens past Opacity where it crosses itself', () => {
  const ctx = pixelCtx();
  const state = stateFor({ size: 10, opacity: 50 });
  TOOLS.brush.onDown(ctx, null, state, 10.5, 20.5);
  TOOLS.brush.onMove(ctx, null, state, 30.5, 20.5);
  TOOLS.brush.onMove(ctx, null, state, 10.5, 20.5);
  TOOLS.brush.onMove(ctx, null, state, 30.5, 20.5);
  TOOLS.brush.onUp(ctx, null, state);
  assert.deepEqual(px(ctx.buf, 20, 20), [128, 128, 128, 255]);
  assert.deepEqual(px(ctx.buf, 20, 5), [255, 255, 255, 255]);
  assert.equal(state.paintStroke, null);
  // A new stroke starts from the new pixels, so it can build further.
  TOOLS.brush.onDown(ctx, null, state, 20.5, 20.5);
  TOOLS.brush.onUp(ctx, null, state);
  assert.deepEqual(px(ctx.buf, 20, 20), [64, 64, 64, 255]);
});

test('Smoothing lags the stroke toward the pointer through stabilizePoint', () => {
  const ctx = pixelCtx();
  const state = stateFor({ size: 4, smoothing: 100 });
  TOOLS.brush.onDown(ctx, null, state, 5.5, 20.5);
  TOOLS.brush.onMove(ctx, null, state, 35.5, 20.5);
  assert.ok(state.lastX < 35.5 && state.lastX > 5.5, `lastX ${state.lastX}`);
  assert.deepEqual(px(ctx.buf, 34, 20), [255, 255, 255, 255]);
  const plain = stateFor({ size: 4 });
  TOOLS.brush.onDown(pixelCtx(), null, plain, 5.5, 20.5);
  TOOLS.brush.onMove(pixelCtx(), null, plain, 35.5, 20.5);
  assert.equal(plain.lastX, 35.5);
});

test('Lock alpha brush strokes keep transparent pixels transparent', () => {
  const ctx = pixelCtx(0);
  const state = stateFor({ size: 10, lockAlpha: true });
  TOOLS.brush.onDown(ctx, null, state, 20.5, 20.5);
  TOOLS.brush.onUp(ctx, null, state);
  assert.equal(px(ctx.buf, 20, 20)[3], 0);
});
