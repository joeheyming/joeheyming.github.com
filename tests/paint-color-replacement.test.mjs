import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ICONS } from '../paint/icons.js';
import { blendLum, colorReplaceDab } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

const GREEN = [51, 153, 51, 255];
const BLUE = [26, 26, 128, 255];
const RED = [1, 0, 0];

function px(data, W, x, y) {
  const i = (y * W + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

// Left half green, right half blue (PhotoCraft replace.rs setup).
function halves(W, H) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) d.set(x < W / 2 ? GREEN : BLUE, (y * W + x) * 4);
  return d;
}

function solid(W, H, rgba) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) d.set(rgba, p * 4);
  return d;
}

function work(pre) {
  return Float32Array.from(pre, (v) => v / 255);
}

function rgb(w, W, x, y) {
  const i = (y * W + x) * 4;
  return [w[i], w[i + 1], w[i + 2]];
}

function dab(pre, W, H, cx, cy, opts = {}) {
  const w = work(pre);
  colorReplaceDab(
    w,
    pre,
    W,
    H,
    cx,
    cy,
    opts.radius ?? 30,
    1,
    opts.sample ?? null,
    opts.fg ?? RED,
    opts.mode ?? 'color',
    opts.tolerance ?? 0.1,
    opts.antiAlias ?? true,
    opts.contiguous ?? false,
    opts.mask ?? null
  );
  return w;
}

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

function replaceState(order, opts = {}, sel) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions.colorReplacement, { size: 20, hardness: 100 }, opts);
  return {
    toolOptions,
    brushSize: 20,
    color: '#ff0000',
    bgColor: '#ffffff',
    sel: sel ?? { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
}

function stroke(ctx, state, x0, y0, x1, y1) {
  const ov = { canvas: ctx.canvas };
  const tool = TOOLS.colorReplacement;
  tool.onDown(ctx, ov, state, x0, y0);
  tool.onMove(ctx, ov, state, x1, y1);
  tool.onUp(ctx, ov, state);
}

test('colorReplacement follows mixerBrush with the brush-replace icon and its options', () => {
  const ids = Object.keys(TOOLS);
  assert.equal(ids[ids.indexOf('mixerBrush') + 1], 'colorReplacement');
  assert.equal(TOOLS.colorReplacement.icon, 'brush-replace');
  assert.ok(ICONS['brush-replace']);
  const schema = Object.fromEntries(TOOL_OPTION_SCHEMA.colorReplacement.map((f) => [f.key, f]));
  for (const key of ['size', 'hardness']) assert.equal(schema[key].type, 'range');
  assert.deepEqual(
    schema.mode.options.map((o) => o.label),
    ['Hue', 'Saturation', 'Color', 'Luminosity']
  );
  assert.equal(schema.mode.default, 'color');
  assert.deepEqual(
    schema.sampling.options.map((o) => o.label),
    ['Continuous', 'Once', 'Background Swatch']
  );
  assert.equal(schema.sampling.default, 'continuous');
  assert.deepEqual(
    schema.limits.options.map((o) => o.label),
    ['Contiguous', 'Discontiguous']
  );
  assert.equal(schema.limits.default, 'contiguous');
  assert.equal(schema.tolerance.min, 0);
  assert.equal(schema.tolerance.max, 100);
  assert.equal(schema.tolerance.default, 30);
  assert.equal(schema.antiAlias.type, 'checkbox');
  assert.equal(schema.antiAlias.default, true);
});

test('Color mode sampled once on green recolors green at its luma and leaves blue alone', () => {
  const W = 80,
    H = 40;
  const pre = halves(W, H);
  const w = dab(pre, W, H, 40, 20, { sample: [0.2, 0.6, 0.2], radius: 40 });
  const c = rgb(w, W, 30, 20);
  assert.ok(Math.abs(blendLum(c) - blendLum([0.2, 0.6, 0.2])) < 1e-3, `luma ${c}`);
  assert.ok(c[0] > c[1] && c[0] > c[2], `red hue ${c}`);
  const b = rgb(w, W, 50, 20);
  assert.ok(Math.abs(b[0] - 26 / 255) < 1e-6 && Math.abs(b[2] - 128 / 255) < 1e-6, `${b}`);
});

test('Luminosity mode keeps the hue and takes the foreground luma', () => {
  const W = 40,
    H = 40;
  const pre = solid(W, H, GREEN);
  const fg = [0.9, 0.9, 0.9];
  const w = dab(pre, W, H, 20, 20, { mode: 'luminosity', fg, sample: [0.2, 0.6, 0.2] });
  const c = rgb(w, W, 20, 20);
  assert.ok(Math.abs(blendLum(c) - blendLum(fg)) < 1e-3, `luma ${c}`);
  assert.ok(c[1] > c[0] && c[1] > c[2], `still green ${c}`);
});

test('Tolerance 0 changes only exact matches', () => {
  const W = 20,
    H = 1;
  const pre = new Uint8ClampedArray(W * H * 4);
  for (let x = 0; x < W; x++) pre.set(x % 2 ? [52, 153, 51, 255] : GREEN, x * 4);
  const w = dab(pre, W, H, 10, 0.5, {
    sample: [51 / 255, 153 / 255, 51 / 255],
    tolerance: 0,
    radius: 30
  });
  for (let x = 0; x < W; x++) {
    const changed = Math.abs(w[x * 4] - pre[x * 4] / 255) > 1e-6;
    assert.equal(changed, x % 2 === 0, `x ${x}`);
  }
});

test('Contiguous stops at a non-matching ring; Discontiguous reaches the island', () => {
  const W = 40,
    H = 40;
  const pre = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.max(Math.abs(x - 30), Math.abs(y - 20));
      pre.set(d === 2 || d === 3 ? [0, 0, 255, 255] : GREEN, (y * W + x) * 4);
    }
  }
  for (const contiguous of [true, false]) {
    const w = dab(pre, W, H, 10, 20, {
      sample: [0.2, 0.6, 0.2],
      tolerance: 0.05,
      radius: 40,
      contiguous
    });
    assert.ok(rgb(w, W, 10, 20)[0] > 0.3, 'centre recolored');
    const island = rgb(w, W, 30, 20);
    assert.equal(Math.abs(island[0] - 0.2) > 0.05, !contiguous, `contiguous ${contiguous}`);
  }
});

test('Background Swatch replaces only colors near the background color', () => {
  const W = 80,
    H = 40;
  const order = [];
  const ctx = fakeCtx(W, H, halves(W, H), order);
  const state = replaceState(order, { sampling: 'background', limits: 'discontiguous', size: 80 });
  state.bgColor = '#1a1a80';
  stroke(ctx, state, 40, 20, 41, 20);
  assert.deepEqual(px(ctx.img.data, W, 30, 20), GREEN);
  const b = px(ctx.img.data, W, 50, 20);
  assert.ok(b[0] > b[1] && b[0] > b[2], `blue half recolored ${b}`);

  const ctx2 = fakeCtx(W, H, halves(W, H), order);
  stroke(ctx2, replaceState(order, { sampling: 'background', size: 80 }), 20, 20, 60, 20);
  assert.deepEqual(ctx2.img.data, halves(W, H), 'white swatch matches nothing');
});

test('the selection limits writes and undo is pushed before the put', () => {
  const W = 40,
    H = 40;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, GREEN), order);
  const sel = { mode: 'active', type: 'rect', x: 0, y: 0, w: 20, h: 40 };
  const state = replaceState(order, { size: 40, limits: 'discontiguous' }, sel);
  stroke(ctx, state, 20, 20, 21, 20);
  assert.equal(order[0], 'undo:Color Replacement');
  assert.ok(order.indexOf('put') > 0);
  const inside = px(ctx.img.data, W, 15, 20);
  assert.ok(inside[0] > inside[1], `inside recolored ${inside}`);
  assert.deepEqual(px(ctx.img.data, W, 25, 20), GREEN);
});

test('colorReplacement is a drag stroke tool and keeps the selection', () => {
  const pointer = readFileSync(new URL('../paint/pointer.js', import.meta.url), 'utf8');
  const drag = pointer.match(/DRAG_STROKE_TOOLS = new Set\(\[[\s\S]*?\]\)/);
  assert.match(drag[0], /'colorReplacement'/);
  const paint = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  const keep = paint.match(/'rectSelect',\s*'ellipseSelect',[\s\S]*?\]\.includes\(id\)/);
  assert.match(keep[0], /'colorReplacement'/);
});
