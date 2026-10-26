import test from 'node:test';
import assert from 'node:assert/strict';

import { ICONS } from '../paint/icons.js';
import { historyDab } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

function solid(W, H, rgba) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) d.set(rgba, p * 4);
  return d;
}

function px(data, W, x, y) {
  const i = (y * W + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

// Fake 2D context over a plain ImageData-like buffer.
function fakeCtx(W, H, data, order) {
  const img = { width: W, height: H, data };
  return {
    img,
    canvas: { width: W, height: H },
    getImageData() {
      return { width: W, height: H, data: img.data.slice() };
    },
    putImageData(next) {
      order.push('put');
      img.data.set(next.data);
    }
  };
}

function fakeOverlay(W, H, texts = []) {
  const ov = { canvas: { width: W, height: H } };
  for (const name of ['clearRect', 'save', 'restore']) ov[name] = () => {};
  ov.fillText = (text) => texts.push(text);
  return ov;
}

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

function brushState(order, { size = 10, hardness = 100, opacity = 100, source, sel } = {}) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions.historyBrush, { size, hardness, opacity });
  return {
    toolOptions,
    brushSize: size,
    layers: [{ id: 7 }],
    activeLayerIdx: 0,
    historySource: new Map(source ? [[7, source]] : []),
    sel: sel ?? { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
}

test('historyBrush is a tool with the clock icon and Size, Hardness, Opacity options', () => {
  assert.equal(TOOLS.historyBrush.label, 'History Brush');
  assert.equal(TOOLS.historyBrush.icon, 'clock');
  assert.ok(ICONS.clock);
  const keys = TOOL_OPTION_SCHEMA.historyBrush.filter((f) => f.type !== 'hint').map((f) => f.key);
  assert.deepEqual(keys, ['size', 'hardness', 'opacity']);
});

test('a stroke restores the source pixels at full opacity', () => {
  const W = 30,
    H = 30;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, BLUE), order);
  const source = { width: W, height: H, data: solid(W, H, RED) };
  const state = brushState(order, { source });
  const tool = TOOLS.historyBrush;
  tool.onDown(ctx, fakeOverlay(W, H), state, 10, 15);
  tool.onMove(ctx, fakeOverlay(W, H), state, 20, 15);
  tool.onUp(ctx, fakeOverlay(W, H), state);
  for (let x = 10; x <= 20; x++) assert.deepEqual(px(ctx.img.data, W, x, 15), RED, `x=${x}`);
  assert.deepEqual(px(ctx.img.data, W, 15, 2), BLUE);
  assert.equal(state.historyStroke, null);
  assert.equal(state.drawing, false);
});

test('half opacity mixes halfway, and overlapping dabs do not compound past it', () => {
  const W = 30,
    H = 30;
  const base = solid(W, H, BLUE);
  const source = solid(W, H, RED);
  const dst = base.slice();
  const cov = new Float32Array(W * H);
  for (let i = 0; i < 12; i++) {
    historyDab(dst, base, source, W, H, 15 + i * 0.25, 15, 6, 1, 0.5, null, cov);
  }
  const [r, g, b, a] = px(dst, W, 15, 15);
  assert.ok(Math.abs(r - 127.5) <= 1, `r=${r}`);
  assert.ok(Math.abs(b - 127.5) <= 1, `b=${b}`);
  assert.equal(g, 0);
  assert.equal(a, 255);
});

test('without per-stroke coverage a single dab still mixes at the opacity', () => {
  const W = 10,
    H = 10;
  const base = solid(W, H, BLUE);
  const dst = base.slice();
  const box = historyDab(dst, base, solid(W, H, RED), W, H, 5, 5, 3, 1, 0.25, null, null);
  assert.ok(box);
  const [r, , b] = px(dst, W, 5, 5);
  assert.ok(Math.abs(r - 63.75) <= 1, `r=${r}`);
  assert.ok(Math.abs(b - 191.25) <= 1, `b=${b}`);
});

test('the active selection limits writes', () => {
  const W = 30,
    H = 30;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, BLUE), order);
  const source = { width: W, height: H, data: solid(W, H, RED) };
  const sel = { mode: 'active', x: 0, y: 0, w: 15, h: 30, mask: null };
  const state = brushState(order, { source, sel });
  const tool = TOOLS.historyBrush;
  tool.onDown(ctx, fakeOverlay(W, H), state, 10, 15);
  tool.onMove(ctx, fakeOverlay(W, H), state, 20, 15);
  tool.onUp(ctx, fakeOverlay(W, H), state);
  assert.deepEqual(px(ctx.img.data, W, 12, 15), RED);
  assert.deepEqual(px(ctx.img.data, W, 14, 15), RED);
  assert.deepEqual(px(ctx.img.data, W, 15, 15), BLUE);
  assert.deepEqual(px(ctx.img.data, W, 18, 15), BLUE);

  const mask = new Uint8Array(W * H);
  mask[15 * W + 15] = 1;
  const base = solid(W, H, BLUE);
  const dst = base.slice();
  historyDab(dst, base, solid(W, H, RED), W, H, 15, 15, 5, 1, 1, mask, null);
  assert.deepEqual(px(dst, W, 15, 15), RED);
  assert.deepEqual(px(dst, W, 14, 15), BLUE);
});

test('no source for the active layer means no writes, no undo, and a hint', () => {
  const W = 20,
    H = 20;
  const order = [];
  const orig = solid(W, H, BLUE);
  const ctx = fakeCtx(W, H, orig.slice(), order);
  const texts = [];
  const ov = fakeOverlay(W, H, texts);
  const tool = TOOLS.historyBrush;

  // A snapshot of another layer does not count.
  const state = brushState(order);
  state.historySource.set(99, { width: W, height: H, data: solid(W, H, RED) });
  tool.onDown(ctx, ov, state, 10, 10);
  tool.onMove(ctx, ov, state, 12, 10);
  tool.onUp(ctx, ov, state);
  assert.deepEqual(order, []);
  assert.deepEqual(ctx.img.data, orig);
  assert.ok(texts.length > 0 && /History Brush source/.test(texts[0]), texts[0]);

  // Neither does a snapshot from before a canvas resize.
  const stale = brushState(order, { source: { width: 10, height: 10, data: solid(10, 10, RED) } });
  tool.onDown(ctx, ov, stale, 10, 10);
  tool.onUp(ctx, ov, stale);
  assert.deepEqual(order, []);
  assert.deepEqual(ctx.img.data, orig);
});

test('undo is pushed before the first put', () => {
  const W = 20,
    H = 20;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, BLUE), order);
  const source = { width: W, height: H, data: solid(W, H, RED) };
  const state = brushState(order, { source });
  TOOLS.historyBrush.onDown(ctx, fakeOverlay(W, H), state, 10, 10);
  assert.deepEqual(order, ['undo:History Brush', 'put']);
});
