import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ICONS } from '../paint/icons.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';
import { checkerPattern, definePattern, patternDab } from '../paint/retouch.js';
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

function fakeOverlay(W, H) {
  const ov = { canvas: { width: W, height: H } };
  for (const name of ['clearRect', 'save', 'restore', 'fillText']) ov[name] = () => {};
  return ov;
}

const BLUE = [0, 0, 255, 255];

// A 4 x 3 tile where every pixel has its own color.
const TW = 4,
  TH = 3;
const TILE = { width: TW, height: TH, data: new Uint8ClampedArray(TW * TH * 4) };
for (let i = 0; i < TW * TH; i++) TILE.data.set([i * 20, 255 - i * 20, (i * 37) % 256, 255], i * 4);

function tilePx(u, v) {
  const i = ((((v % TH) + TH) % TH) * TW + (((u % TW) + TW) % TW)) * 4;
  return Array.from(TILE.data.slice(i, i + 4));
}

function stampState(order, { size = 10, opacity = 100, aligned = true, scale = 100, sel } = {}) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions.patternStamp, { size, hardness: 100, opacity, aligned, scale });
  return {
    toolOptions,
    brushSize: size,
    color: '#ff0000',
    bgColor: '#ffffff',
    pattern: TILE,
    sel: sel ?? { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
}

function stroke(ctx, state, x0, y0, x1, y1) {
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const tool = TOOLS.patternStamp;
  tool.onDown(ctx, fakeOverlay(W, H), state, x0, y0);
  tool.onMove(ctx, fakeOverlay(W, H), state, x1, y1);
  tool.onUp(ctx, fakeOverlay(W, H), state);
}

test('patternStamp follows cloneStamp with the grid-3x3 icon and its options', () => {
  const ids = Object.keys(TOOLS);
  assert.equal(ids[ids.indexOf('cloneStamp') + 1], 'patternStamp');
  assert.equal(TOOLS.patternStamp.label, 'Pattern Stamp');
  assert.equal(TOOLS.patternStamp.icon, 'grid-3x3');
  assert.ok(ICONS['grid-3x3']);
  const fields = TOOL_OPTION_SCHEMA.patternStamp.filter((f) => f.type !== 'hint');
  assert.deepEqual(
    fields.map((f) => f.key),
    ['size', 'hardness', 'opacity', 'aligned', 'scale']
  );
  const aligned = fields.find((f) => f.key === 'aligned');
  assert.equal(aligned.type, 'checkbox');
  assert.equal(aligned.default, true);
  const scale = fields.find((f) => f.key === 'scale');
  assert.deepEqual([scale.min, scale.max, scale.default], [10, 400, 100]);
});

test('a full-opacity hard aligned stroke reproduces the tile exactly', () => {
  const W = 30,
    H = 20;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, BLUE), order);
  stroke(ctx, stampState(order), 6, 10, 22, 10);
  for (let y = 8; y <= 12; y++) {
    for (let x = 6; x <= 22; x++) {
      assert.deepEqual(px(ctx.img.data, W, x, y), tilePx(x, y), `(${x}, ${y})`);
    }
  }
  assert.deepEqual(px(ctx.img.data, W, 15, 1), BLUE);
});

test('aligned strokes share one phase; unaligned strokes restart at each stroke start', () => {
  const W = 30,
    H = 20;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, BLUE), order);
  const state = stampState(order);
  stroke(ctx, state, 6, 5, 10, 5);
  stroke(ctx, state, 17, 13, 21, 13);
  for (const [x, y] of [
    [7, 5],
    [9, 6],
    [18, 13],
    [20, 12]
  ]) {
    assert.deepEqual(px(ctx.img.data, W, x, y), tilePx(x, y), `aligned (${x}, ${y})`);
  }

  const loose = fakeCtx(W, H, solid(W, H, BLUE), order);
  const ustate = stampState(order, { aligned: false });
  stroke(loose, ustate, 6, 5, 10, 5);
  stroke(loose, ustate, 17, 13, 21, 13);
  for (const [x, y, sx, sy] of [
    [6, 5, 6, 5],
    [8, 6, 6, 5],
    [17, 13, 17, 13],
    [19, 12, 17, 13]
  ]) {
    assert.deepEqual(px(loose.img.data, W, x, y), tilePx(x - sx, y - sy), `unaligned (${x}, ${y})`);
  }
  // The second stroke's start is tile (0, 0), not the document-anchored tile (1, 1).
  assert.notDeepEqual(tilePx(0, 0), tilePx(17, 13));
});

test('Scale 200 doubles the tile period', () => {
  const W = 30,
    H = 20;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, BLUE), order);
  stroke(ctx, stampState(order, { scale: 200 }), 6, 10, 22, 10);
  for (let y = 8; y <= 12; y++) {
    for (let x = 6; x <= 22; x++) {
      const want = tilePx(Math.floor(x / 2), Math.floor(y / 2));
      assert.deepEqual(px(ctx.img.data, W, x, y), want, `(${x}, ${y})`);
    }
  }
  assert.deepEqual(px(ctx.img.data, W, 8, 10), px(ctx.img.data, W, 16, 10));
  assert.notDeepEqual(px(ctx.img.data, W, 8, 10), px(ctx.img.data, W, 12, 10));
});

test('opacity 50 mixes the tile halfway with the base, without compounding', () => {
  const W = 20,
    H = 20;
  const base = solid(W, H, BLUE);
  const dst = base.slice();
  const cov = new Float32Array(W * H);
  for (let i = 0; i < 12; i++) {
    patternDab(
      dst,
      base,
      TILE.data,
      TW,
      TH,
      W,
      H,
      10 + i * 0.25,
      10,
      5,
      1,
      0.5,
      0,
      0,
      1,
      null,
      cov
    );
  }
  const t = tilePx(10, 10);
  const got = px(dst, W, 10, 10);
  for (let c = 0; c < 3; c++) {
    const want = (t[c] + BLUE[c]) / 2;
    assert.ok(Math.abs(got[c] - want) <= 1, `channel ${c}: ${got[c]} vs ${want}`);
  }
  assert.equal(got[3], 255);
});

test('the selection limits writes', () => {
  const W = 30,
    H = 20;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, BLUE), order);
  const sel = { mode: 'active', x: 0, y: 0, w: 15, h: 20, mask: null };
  stroke(ctx, stampState(order, { sel }), 6, 10, 22, 10);
  assert.deepEqual(px(ctx.img.data, W, 14, 10), tilePx(14, 10));
  assert.deepEqual(px(ctx.img.data, W, 15, 10), BLUE);
  assert.deepEqual(px(ctx.img.data, W, 20, 10), BLUE);

  const mask = new Uint8Array(W * H);
  mask[10 * W + 10] = 1;
  const base = solid(W, H, BLUE);
  const dst = base.slice();
  patternDab(dst, base, TILE.data, TW, TH, W, H, 10, 10, 5, 1, 1, 0, 0, 1, mask, null);
  assert.deepEqual(px(dst, W, 10, 10), tilePx(10, 10));
  assert.deepEqual(px(dst, W, 11, 10), BLUE);
});

test('undo is pushed before the first put', () => {
  const W = 20,
    H = 20;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, BLUE), order);
  TOOLS.patternStamp.onDown(ctx, fakeOverlay(W, H), stampState(order), 10, 10);
  assert.deepEqual(order, ['undo:Pattern Stamp', 'put']);
});

test('without a defined pattern the stamp paints a fg / bg checkerboard', () => {
  const tile = checkerPattern([255, 0, 0], [255, 255, 255], 8);
  assert.equal(tile.width, 16);
  assert.equal(tile.height, 16);
  assert.deepEqual(px(tile.data, 16, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(tile.data, 16, 8, 0), [255, 255, 255, 255]);
  assert.deepEqual(px(tile.data, 16, 8, 8), [255, 0, 0, 255]);

  const W = 30,
    H = 30;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, BLUE), order);
  const state = stampState(order, { size: 20 });
  state.pattern = null;
  stroke(ctx, state, 12, 12, 13, 12);
  assert.deepEqual(px(ctx.img.data, W, 7, 7), [255, 0, 0, 255]);
  assert.deepEqual(px(ctx.img.data, W, 9, 7), [255, 255, 255, 255]);
  assert.deepEqual(px(ctx.img.data, W, 17, 17), [255, 0, 0, 255]);
});

test('Define Pattern captures the selection bounding box, or the whole layer', () => {
  const W = 6,
    H = 5;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set([p, p * 2, p * 3, 255], p * 4);
  const mask = new Uint8Array(W * H);
  mask[1 * W + 2] = 1;
  mask[3 * W + 4] = 1;
  const pat = definePattern(data, W, H, mask);
  assert.equal(pat.width, 3);
  assert.equal(pat.height, 3);
  assert.deepEqual(px(pat.data, 3, 0, 0), px(data, W, 2, 1));
  assert.deepEqual(px(pat.data, 3, 2, 2), px(data, W, 4, 3));
  assert.deepEqual(px(pat.data, 3, 1, 0), px(data, W, 3, 1));

  const whole = definePattern(data, W, H, null);
  assert.equal(whole.width, W);
  assert.equal(whole.height, H);
  assert.deepEqual(whole.data, data);
  assert.notEqual(whole.data, data);

  assert.equal(definePattern(data, W, H, new Uint8Array(W * H)), null);
});

test('Edit > Define Pattern is wired and pushes no undo', () => {
  const cmd = COMMANDS_BY_ID.get('edit.definePattern');
  assert.deepEqual(
    [cmd.menu, cmd.label, cmd.attrs.id],
    [['Edit'], 'Define Pattern…', 'btn-define-pattern']
  );
  const js = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  const fn = js.match(/function defineLayerPattern\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'defineLayerPattern missing');
  assert.doesNotMatch(fn[0], /pushUndo/);
  // Wired through createCommandCtx (command-ctx.js), not an inline paint.js handler map.
  const ctx = readFileSync(new URL('../paint/command-ctx.js', import.meta.url), 'utf8');
  assert.match(ctx, /definePattern: p\.defineLayerPattern/);
  assert.match(js, /defineLayerPattern,/);
});
