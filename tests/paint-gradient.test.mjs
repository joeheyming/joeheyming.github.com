import test from 'node:test';
import assert from 'node:assert/strict';

import { fillLinearGradient, TOOLS, TOOL_OPTION_SCHEMA } from '../paint/tools.js';

import { makeImage, px } from './paint-helpers.mjs';

const SEED = [10, 20, 30, 40];

test('fillLinearGradient is hex0 before the start and hex1 past the end', () => {
  const img = makeImage(20, 4);
  // Segment from x=5 to x=15 along pixel centers.
  assert.equal(fillLinearGradient(img, 5.5, 0, 15.5, 0, '#ff0000', '#0000ff', null), true);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x <= 5; x++) assert.deepEqual(px(img, x, y), [255, 0, 0, 255], `start ${x}`);
    for (let x = 15; x < 20; x++) assert.deepEqual(px(img, x, y), [0, 0, 255, 255], `end ${x}`);
  }
  // Monotonic in between.
  for (let x = 6; x <= 15; x++) assert.ok(px(img, x, 0)[0] < px(img, x - 1, 0)[0]);
});

test('fillLinearGradient midpoint is the 50 percent mix', () => {
  const img = makeImage(21, 3);
  fillLinearGradient(img, 0.5, 1.5, 20.5, 1.5, '#000000', '#c86432', null);
  assert.deepEqual(px(img, 10, 1), [100, 50, 25, 255]);
  // The gradient is constant across the perpendicular axis.
  assert.deepEqual(px(img, 10, 0), px(img, 10, 2));
});

test('fillLinearGradient projects diagonal drags onto the segment', () => {
  const img = makeImage(11, 11);
  fillLinearGradient(img, 0.5, 0.5, 10.5, 10.5, '#000000', '#ffffff', null);
  assert.deepEqual(px(img, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(img, 10, 10), [255, 255, 255, 255]);
  // Pixels on the same anti-diagonal share a value; the center is the mix.
  assert.deepEqual(px(img, 2, 8), px(img, 8, 2));
  assert.deepEqual(px(img, 5, 5), [128, 128, 128, 255]);
});

test('fillLinearGradient skips pixels outside the mask', () => {
  const W = 10,
    H = 10;
  const img = makeImage(W, H, SEED);
  const mask = new Uint8Array(W * H);
  for (let y = 2; y < 6; y++) for (let x = 3; x < 7; x++) mask[y * W + x] = 1;
  fillLinearGradient(img, 0, 0, 10, 0, '#ffffff', '#000000', mask);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) assert.equal(px(img, x, y)[3], 255, `inside ${x},${y}`);
      else assert.deepEqual(px(img, x, y), SEED, `outside ${x},${y}`);
    }
  }
});

test('fillLinearGradient ignores a zero-length segment', () => {
  const img = makeImage(4, 4, SEED);
  assert.equal(fillLinearGradient(img, 2, 2, 2, 2, '#ffffff', '#000000', null), false);
  assert.deepEqual(px(img, 0, 0), SEED);
});

test('gradient tool is registered with an options hint', () => {
  assert.equal(TOOLS.gradient.label, 'Gradient');
  assert.ok(Array.isArray(TOOL_OPTION_SCHEMA.gradient));
});

// Fake 2D context over a plain ImageData-like buffer.
function fakeCtx(W, H) {
  const img = makeImage(W, H, [0, 0, 0, 0]);
  const calls = [];
  return {
    img,
    calls,
    canvas: { width: W, height: H },
    getImageData() {
      return { width: W, height: H, data: img.data.slice() };
    },
    putImageData(next) {
      calls.push('put');
      img.data.set(next.data);
    }
  };
}

function fakeOverlay(W, H) {
  const ops = [];
  const ov = { canvas: { width: W, height: H }, ops };
  for (const name of ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'setLineDash']) {
    ov[name] = (...args) => ops.push([name, ...args]);
  }
  return ov;
}

function dragGradient(state, ctx, ov, from, to) {
  const tool = TOOLS.gradient;
  tool.onDown(ctx, ov, state, ...from);
  tool.onMove(ctx, ov, state, ...to);
  tool.onUp(ctx, ov, state, ...to);
}

test('gradient tool previews on move, pushes undo, then writes the layer and clears the overlay', () => {
  const W = 8,
    H = 2;
  const ctx = fakeCtx(W, H);
  const ov = fakeOverlay(W, H);
  const order = [];
  ctx.putImageData = ((put) => (next) => {
    order.push('put');
    put.call(ctx, next);
  })(ctx.putImageData);
  const state = {
    color: '#ffffff',
    bgColor: '#000000',
    sel: { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
  const tool = TOOLS.gradient;
  tool.onDown(ctx, ov, state, 0.5, 1);
  assert.equal(state.drawing, true);
  tool.onMove(ctx, ov, state, 7.5, 1);
  assert.ok(
    ov.ops.some(([n]) => n === 'lineTo'),
    'preview line drawn'
  );
  assert.equal(order.length, 0, 'layer untouched during preview');
  ov.ops.length = 0;
  tool.onUp(ctx, ov, state, 7.5, 1);
  assert.equal(state.drawing, false);
  assert.deepEqual(order, ['undo:Gradient', 'put']);
  assert.deepEqual(ov.ops[0], ['clearRect', 0, 0, W, H]);
  assert.deepEqual(px(ctx.img, 0, 0), [255, 255, 255, 255]);
  assert.deepEqual(px(ctx.img, 7, 1), [0, 0, 0, 255]);
});

test('gradient tool limits the fill to an active selection', () => {
  const W = 6,
    H = 6;
  const ctx = fakeCtx(W, H);
  const ov = fakeOverlay(W, H);
  const state = {
    color: '#ff0000',
    bgColor: '#00ff00',
    sel: { mode: 'active', x: 1, y: 1, w: 2, h: 3, mask: null, data: null, baseData: null },
    pushUndo() {}
  };
  dragGradient(state, ctx, ov, [0, 0], [6, 0]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= 1 && x < 3 && y >= 1 && y < 4;
      assert.equal(px(ctx.img, x, y)[3], inside ? 255 : 0, `${x},${y}`);
    }
  }
  assert.equal(state.sel.mode, 'active', 'selection survives the fill');
});

test('gradient tool does nothing on a click without a drag', () => {
  const ctx = fakeCtx(4, 4);
  const ov = fakeOverlay(4, 4);
  let undos = 0;
  const state = { color: '#fff', bgColor: '#000', sel: { mode: 'none' }, pushUndo: () => undos++ };
  dragGradient(state, ctx, ov, [2, 2], [2, 2]);
  assert.equal(undos, 0);
  assert.equal(ctx.calls.length, 0);
});
