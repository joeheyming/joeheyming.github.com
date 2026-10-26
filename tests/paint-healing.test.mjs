import test from 'node:test';
import assert from 'node:assert/strict';

import { healStroke, seamlessClone, solveMembrane } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

function disc(w, h, cx, cy, r) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = Math.hypot((i % w) - cx, Math.floor(i / w) - cy) < r;
  return m;
}

function px(data, W, x, y) {
  const i = (y * W + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

test('solveMembrane reproduces a linear ramp between fixed boundaries', () => {
  const w = 80,
    h = 60;
  const unknown = disc(w, h, 40, 30, 20);
  const truth = (i) => 0.2 + 0.005 * (i % w) + 0.003 * Math.floor(i / w);
  const v = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) v[i] = unknown[i] ? 0 : truth(i);
  solveMembrane(w, h, unknown, v);
  let err = 0;
  for (let i = 0; i < w * h; i++) err = Math.max(err, Math.abs(v[i] - truth(i)));
  assert.ok(err < 2e-3, `max error ${err}`);
});

test('solveMembrane leaves known pixels alone and fills a 1-D gap linearly', () => {
  const w = 12,
    h = 1;
  const unknown = new Uint8Array(w).fill(1);
  unknown[0] = 0;
  unknown[w - 1] = 0;
  const v = new Float32Array(w);
  v[0] = 0;
  v[w - 1] = 1.1;
  solveMembrane(w, h, unknown, v);
  assert.equal(v[0], 0);
  assert.ok(Math.abs(v[w - 1] - 1.1) < 1e-6);
  for (let x = 1; x < w - 1; x++) assert.ok(Math.abs(v[x] - x / 10) < 1e-3, `x=${x}: ${v[x]}`);
});

test('seamlessClone of a flat source into a gradient destination takes the destination', () => {
  const w = 48,
    h = 40,
    ch = 3;
  const mask = disc(w, h, 24, 20, 14);
  const src = new Float32Array(w * h * ch).fill(0.9);
  const dst = new Float32Array(w * h * ch);
  for (let i = 0; i < w * h; i++) {
    const x = i % w,
      y = Math.floor(i / w);
    dst.set([0.1 + 0.01 * x, 0.2 + 0.008 * y, 0.5], i * ch);
  }
  const out = seamlessClone(w, h, ch, src, dst, mask);
  let err = 0;
  for (let i = 0; i < out.length; i++) err = Math.max(err, Math.abs(out[i] - dst[i]));
  assert.ok(err < 2e-3, `max error ${err}`);
});

test('a textured source healed into a brighter area keeps its texture but takes the mean', () => {
  const w = 64,
    h = 64,
    ch = 3;
  const mask = disc(w, h, 32, 32, 20);
  const tex = (x) => (Math.floor(x / 4) % 2 === 0 ? 0.05 : -0.05);
  const src = new Float32Array(w * h * ch);
  const dst = new Float32Array(w * h * ch).fill(0.8);
  for (let i = 0; i < w * h; i++) {
    const t = tex(i % w);
    src.set([0.2 + t, 0.25 + t, 0.3 + t], i * ch);
  }
  const out = seamlessClone(w, h, ch, src, dst, mask);
  const inside = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) inside.push(i);
  for (let c = 0; c < ch; c++) {
    const m = inside.reduce((a, i) => a + out[i * ch + c], 0) / inside.length;
    assert.ok(Math.abs(m - 0.8) < 0.02, `channel ${c} mean ${m}`);
  }
  let e = 0,
    n = 0;
  for (const i of inside) {
    if (!mask[i + 1]) continue;
    e += Math.abs(out[(i + 1) * ch] - out[i * ch] - (src[(i + 1) * ch] - src[i * ch]));
    n++;
  }
  assert.ok(e / n < 0.01, `gradient error ${e / n}`);
  // Outside the mask: the destination, untouched.
  assert.deepEqual(Array.from(out.slice(0, 3)), Array.from(dst.slice(0, 3)));
});

// Left half (x < 16): dark stripes. Right half: flat bright.
function stripeImage(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = x < 16 ? (Math.floor(x / 2) % 2 ? 70 : 30) : 200;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return data;
}

test('healStroke composites the healed pixels at the coverage and honours the mask', () => {
  const W = 32,
    H = 16;
  const src = stripeImage(W, H);
  const cov = new Float32Array(W * H);
  for (let y = 5; y < 11; y++) for (let x = 21; x < 27; x++) cov[y * W + x] = 1;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 24; x++) mask[y * W + x] = 1;

  const dst = new Uint8ClampedArray(src);
  const box = healStroke(dst, src, W, H, -16, 0, cov, mask);
  assert.deepEqual(box, [20, 4, 28, 12]);
  // Masked-out pixels inside the stroke stay as they were.
  for (let x = 24; x < 27; x++) assert.deepEqual(px(dst, W, x, 8), px(src, W, x, 8), `x=${x}`);
  // Healed pixels carry the stripes (texture) around the bright destination level.
  const a = px(dst, W, 21, 8)[0],
    b = px(dst, W, 22, 8)[0];
  assert.ok(Math.abs(a - b) > 25, `texture kept: ${a} vs ${b}`);
  assert.ok(a > 150 && b > 150, `brighter: ${a}, ${b}`);
  // Outside the coverage nothing moves.
  assert.deepEqual(px(dst, W, 20, 8), px(src, W, 20, 8));
});

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

function fakeOverlay(W, H) {
  const ov = { canvas: { width: W, height: H } };
  for (const name of ['clearRect', 'save', 'restore', 'fillText']) ov[name] = () => {};
  return ov;
}

function healState(order) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions.healingBrush, { size: 6, hardness: 100 });
  return {
    toolOptions,
    brushSize: 6,
    sel: { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
}

test('healingBrush is a tool with Size, Hardness, and Aligned (on)', () => {
  assert.equal(TOOLS.healingBrush.label, 'Healing Brush');
  const keys = TOOL_OPTION_SCHEMA.healingBrush.map((o) => o.key);
  for (const key of ['size', 'hardness', 'aligned']) assert.ok(keys.includes(key), key);
  const aligned = TOOL_OPTION_SCHEMA.healingBrush.find((o) => o.key === 'aligned');
  assert.equal(aligned.type, 'checkbox');
  assert.equal(aligned.default, true);
});

test('a heal stroke pushes undo before the first put, then heals on pointer up', () => {
  const W = 32,
    H = 16;
  const order = [];
  const orig = stripeImage(W, H);
  const ctx = fakeCtx(W, H, orig.slice(), order);
  const ov = fakeOverlay(W, H);
  const state = healState(order);
  const tool = TOOLS.healingBrush;

  state.altKey = true;
  tool.onDown(ctx, ov, state, 8, 8);
  assert.deepEqual(state.clone.source, { x: 8, y: 8 });
  assert.deepEqual(order, []);
  state.altKey = false;

  tool.onDown(ctx, ov, state, 24, 8);
  assert.equal(order[0], 'undo:Healing Brush');
  assert.equal(order[1], 'put');
  // During the drag: the Clone Stamp preview, the raw dark source pixel.
  assert.deepEqual(px(ctx.img.data, W, 24, 8), px(orig, W, 8, 8));
  tool.onUp(ctx, ov, state, 24, 8);
  assert.equal(state.cloneStroke, null);
  assert.equal(state.drawing, false);
  // After the solve: brightened toward the surrounding 200 level.
  assert.ok(px(ctx.img.data, W, 24, 8)[0] > 150, `${px(ctx.img.data, W, 24, 8)}`);
  assert.deepEqual(state.clone.offset, { dx: -16, dy: 0 });
});

test('an active selection limits the heal', () => {
  const W = 32,
    H = 16;
  const order = [];
  const orig = stripeImage(W, H);
  const ctx = fakeCtx(W, H, orig.slice(), order);
  const ov = fakeOverlay(W, H);
  const state = healState(order);
  state.sel = { mode: 'active', x: 0, y: 0, w: 24, h: 16, mask: null, data: null, baseData: null };
  const tool = TOOLS.healingBrush;
  state.altKey = true;
  tool.onDown(ctx, ov, state, 8, 8);
  state.altKey = false;
  tool.onDown(ctx, ov, state, 24, 8);
  tool.onUp(ctx, ov, state, 24, 8);
  for (let x = 24; x < 28; x++) {
    assert.deepEqual(px(ctx.img.data, W, x, 8), px(orig, W, x, 8), `outside ${x}`);
  }
  assert.notDeepEqual(px(ctx.img.data, W, 22, 8), px(orig, W, 22, 8), 'inside healed');
});
