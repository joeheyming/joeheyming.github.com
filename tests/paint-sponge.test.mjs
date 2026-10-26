import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { colorDab, perDab, saturation, sponge } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { buildToolbar } from '../paint/ui.js';

const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

function solid(W, H, rgba) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(rgba, p * 4);
  return data;
}

function px(data, W, x, y) {
  const i = (y * W + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

test('Desaturate lowers saturation and keeps luma', () => {
  const c = [0.8, 0.4, 0.2];
  const d = sponge(c, 0.5, false, false);
  assert.ok(saturation(d) < saturation(c));
  assert.ok(Math.abs(luma(d) - luma(c)) < 1e-9);
  // Full strength collapses to the luma grey.
  const g = sponge(c, 1, false, false);
  for (const v of g) assert.ok(Math.abs(v - luma(c)) < 1e-9);
});

test('Saturate raises saturation and stays in 0..1', () => {
  const c = [0.8, 0.4, 0.2];
  const s = sponge(c, 0.5, true, false);
  assert.ok(saturation(s) > saturation(c));
  for (const col of [c, [0.95, 0.9, 0.05], [0.02, 0.6, 0.98]]) {
    const out = sponge(col, 1, true, false);
    assert.ok(
      out.every((v) => v >= 0 && v <= 1),
      String(out)
    );
    assert.ok(Math.abs(luma(out) - luma(col)) < 1e-9, 'gamut-compressed around luma');
  }
});

test('Vibrance protects an already-saturated colour when saturating', () => {
  const c = [0.8, 0.2, 0.2];
  const v = sponge(c, 0.5, true, true);
  const nv = sponge(c, 0.5, true, false);
  const moved = (o) => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]);
  assert.ok(saturation(v) > saturation(c));
  assert.ok(moved(v) < moved(nv));
  // PhotoCraft's case: a colour already at the gamut edge moves no more with Vibrance than without.
  const e = [1, 0.1, 0.1];
  const dv = Math.abs(sponge(e, 0.5, true, true)[1] - 0.1);
  assert.ok(dv <= Math.abs(sponge(e, 0.5, true, false)[1] - 0.1) + 1e-12);
  // Desaturating, Vibrance moves a near-grey less than without it.
  const n = [0.55, 0.5, 0.5];
  assert.ok(
    Math.abs(sponge(n, 0.5, false, true)[0] - n[0]) <
      Math.abs(sponge(n, 0.5, false, false)[0] - n[0])
  );
});

test('a grey stays grey', () => {
  for (const saturate of [false, true]) {
    for (const vib of [false, true]) {
      for (const v of sponge([0.5, 0.5, 0.5], 1, saturate, vib))
        assert.ok(Math.abs(v - 0.5) < 1e-12);
    }
  }
  assert.deepEqual(sponge([0.8, 0.4, 0.2], 0, true, true), [0.8, 0.4, 0.2]);
});

test('perDab follows 1 - (1 - e)^spacing', () => {
  assert.equal(perDab(0, 0.25), 0);
  assert.ok(Math.abs(perDab(0.5, 0.25) - (1 - 0.5 ** 0.25)) < 1e-12);
  assert.equal(perDab(1, 0.25), 1);
});

test('colorDab builds up and the mask limits writes', () => {
  const W = 8,
    H = 8;
  const work = new Float32Array(W * H * 3);
  for (let p = 0; p < W * H; p++) work.set([0.8, 0.4, 0.2], p * 3);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 4; x < W; x++) mask[y * W + x] = 1;
  const f = (rgb, k) => sponge(rgb, k, false, false);
  colorDab(work, W, H, 4, 4, 3, 1, 0.5, 0.125, f, mask);
  const at = (x, y) => Array.from(work.slice((y * W + x) * 3, (y * W + x) * 3 + 3));
  const first = saturation(at(4, 4));
  assert.ok(first < saturation([0.8, 0.4, 0.2]));
  assert.deepEqual(at(3, 4), Array.from(new Float32Array([0.8, 0.4, 0.2])), 'outside the mask');
  colorDab(work, W, H, 4, 4, 3, 1, 0.5, 0.125, f, mask);
  assert.ok(saturation(at(4, 4)) < first, 'a second dab builds on the first');
});

function fakeCtx(W, H, data, order) {
  const img = { width: W, height: H, data };
  return {
    img,
    canvas: { width: W, height: H },
    getImageData() {
      order.push('get');
      return { width: W, height: H, data: img.data.slice() };
    },
    putImageData(next) {
      order.push('put');
      img.data.set(next.data);
    }
  };
}

const ov = { canvas: { width: 1, height: 1 }, clearRect() {} };

function spongeState(order, opts = {}) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions.sponge, { size: 6, hardness: 100 }, opts);
  return {
    toolOptions,
    brushSize: 6,
    sel: { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
}

test('sponge is a tool with the PhotoCraft options and a tool-column button', () => {
  assert.equal(TOOLS.sponge.label, 'Sponge');
  const by = Object.fromEntries(TOOL_OPTION_SCHEMA.sponge.map((o) => [o.key, o]));
  for (const key of ['size', 'hardness']) assert.ok(by[key], key);
  assert.equal(by.mode.type, 'select');
  assert.deepEqual(
    by.mode.options.map((o) => o.value),
    ['desaturate', 'saturate']
  );
  assert.equal(by.mode.default, 'desaturate');
  assert.equal(by.flow.min, 1);
  assert.equal(by.flow.max, 100);
  assert.equal(by.flow.default, 50);
  assert.equal(by.vibrance.type, 'checkbox');
  assert.equal(by.vibrance.default, true);

  const { document } = new JSDOM('<div id="tool-buttons"></div>').window;
  const prev = globalThis.document;
  globalThis.document = document;
  try {
    const container = document.getElementById('tool-buttons');
    buildToolbar(TOOLS, { tool: 'brush' }, container, () => {});
    assert.ok(container.querySelector('[data-tool="sponge"]'));
  } finally {
    globalThis.document = prev;
  }
});

test('a stroke pushes undo before the first put, builds up, and keeps alpha', () => {
  const W = 12,
    H = 12;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, [200, 100, 50, 180]), order);
  const state = spongeState(order);
  TOOLS.sponge.onDown(ctx, ov, state, 6.5, 6.5);
  const afterOne = px(ctx.img.data, W, 6, 6);
  for (let i = 0; i < 4; i++) {
    TOOLS.sponge.onMove(ctx, ov, state, 8.5, 6.5);
    TOOLS.sponge.onMove(ctx, ov, state, 6.5, 6.5);
  }
  TOOLS.sponge.onUp(ctx, ov, state, 6.5, 6.5);
  assert.equal(order[0], 'undo:Sponge');
  assert.ok(order.indexOf('undo:Sponge') < order.indexOf('put'));
  const sat = (p) => saturation(p.slice(0, 3).map((v) => v / 255));
  const start = sat([200, 100, 50]);
  assert.ok(sat(afterOne) < start, 'desaturated');
  assert.ok(sat(px(ctx.img.data, W, 6, 6)) < sat(afterOne), 'the stroke builds up');
  assert.deepEqual(px(ctx.img.data, W, 0, 0), [200, 100, 50, 180]);
  for (let p = 0; p < W * H; p++) assert.equal(ctx.img.data[p * 4 + 3], 180);

  const order2 = [];
  const ctx2 = fakeCtx(W, H, solid(W, H, [200, 100, 50, 255]), order2);
  const st2 = spongeState(order2, { mode: 'saturate', vibrance: false });
  TOOLS.sponge.onDown(ctx2, ov, st2, 6.5, 6.5);
  TOOLS.sponge.onUp(ctx2, ov, st2, 6.5, 6.5);
  assert.ok(sat(px(ctx2.img.data, W, 6, 6)) > start, 'saturated');
});

test('an active selection limits the stroke', () => {
  const W = 10,
    H = 10;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, [200, 100, 50, 255]), order);
  const state = spongeState(order, { size: 8 });
  state.sel = { mode: 'active', x: 5, y: 0, w: 5, h: 10, mask: null, data: null, baseData: null };
  TOOLS.sponge.onDown(ctx, ov, state, 5, 5);
  TOOLS.sponge.onUp(ctx, ov, state, 5, 5);
  assert.deepEqual(px(ctx.img.data, W, 4, 5), [200, 100, 50, 255], 'outside unchanged');
  assert.notDeepEqual(px(ctx.img.data, W, 5, 5), [200, 100, 50, 255], 'inside changed');
});
