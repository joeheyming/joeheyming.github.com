import test from 'node:test';
import assert from 'node:assert/strict';

import { dodgeBurn, toneCurve, toneDab } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

const grey = (v) => [v, v, v];
const lift = (v, range, e = 0.5) => dodgeBurn(grey(v), e, range, false, true)[0] - v;
const drop = (v, range, e = 0.5) => v - dodgeBurn(grey(v), e, range, true, true)[0];

function solid(W, H, rgba) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(rgba, p * 4);
  return data;
}

function px(data, W, x, y) {
  const i = (y * W + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

test('Midtones dodge lightens mid-grey more than near-black or near-white', () => {
  assert.ok(lift(0.5, 'midtones') > 0.1);
  assert.ok(lift(0.5, 'midtones') > 2 * lift(0.05, 'midtones'));
  assert.ok(lift(0.5, 'midtones') > 2 * lift(0.95, 'midtones'));
  // Black and white stay put for Midtones.
  assert.deepEqual(dodgeBurn(grey(0), 0.5, 'midtones', false, true), grey(0));
  assert.equal(toneCurve(1, 0.5, 'midtones', false), 1);
});

test('Burn darkens', () => {
  assert.ok(dodgeBurn(grey(0.5), 0.5, 'midtones', true, true)[0] < 0.45);
  for (const range of ['shadows', 'midtones', 'highlights']) {
    assert.ok(drop(0.6, range) > 0, range);
  }
});

test('Shadows and Highlights weight their own range most', () => {
  assert.ok(lift(0.1, 'shadows') > lift(0.9, 'shadows'));
  assert.ok(lift(0.9, 'highlights') > lift(0.1, 'highlights'));
  assert.ok(drop(0.9, 'highlights') > drop(0.2, 'highlights'));
  assert.ok(drop(0.3, 'shadows') / 0.3 > drop(0.9, 'shadows') / 0.9);
});

test('Protect Tones keeps hue; off runs each channel through the curve', () => {
  const c = [0.6, 0.3, 0.2];
  const p = dodgeBurn(c, 0.8, 'midtones', false, true);
  assert.ok(p.every((v) => v >= 0 && v <= 1));
  assert.ok(Math.abs(p[0] / p[1] - c[0] / c[1]) < 0.05);
  const q = dodgeBurn(c, 0.8, 'midtones', false, false);
  assert.deepEqual(
    q,
    c.map((v) => toneCurve(v, 0.8, 'midtones', false))
  );
});

test('repeated dabs in one stroke do not compound past the stroke exposure', () => {
  const W = 9,
    H = 9;
  const src = solid(W, H, [128, 128, 128, 255]);
  const tone = (rgb) => dodgeBurn(rgb, 0.5, 'midtones', false, true);
  const once = new Uint8ClampedArray(src);
  toneDab(once, src, W, H, 4.5, 4.5, 3, 1, tone, null, new Float32Array(W * H));
  const many = new Uint8ClampedArray(src);
  const cov = new Float32Array(W * H);
  for (let i = 0; i < 6; i++) toneDab(many, src, W, H, 4.5, 4.5, 3, 1, tone, null, cov);
  // The centre is fully covered by one dab, so more dabs leave it where it was.
  assert.deepEqual(px(many, W, 4, 4), px(once, W, 4, 4));
  const want = Math.round(tone(grey(128 / 255))[0] * 255);
  assert.ok(Math.abs(px(many, W, 4, 4)[0] - want) <= 1);
  assert.ok(px(many, W, 4, 4)[0] > 140);
});

test('the mask limits writes and alpha is unchanged', () => {
  const W = 8,
    H = 8;
  const src = solid(W, H, [100, 120, 140, 90]);
  const dst = new Uint8ClampedArray(src);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 4; x < W; x++) mask[y * W + x] = 1;
  const tone = (rgb) => dodgeBurn(rgb, 1, 'midtones', true, true);
  toneDab(dst, src, W, H, 4, 4, 3, 1, tone, mask, new Float32Array(W * H));
  assert.deepEqual(px(dst, W, 3, 4), px(src, W, 3, 4), 'outside the mask untouched');
  const inside = px(dst, W, 4, 4);
  assert.ok(inside[0] < 100 && inside[1] < 120 && inside[2] < 140, 'burned');
  for (let p = 0; p < W * H; p++) assert.equal(dst[p * 4 + 3], 90);
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

const ov = { canvas: { width: 1, height: 1 }, clearRect() {} };

function toneState(id, order) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions[id], { size: 6, hardness: 100 });
  return {
    toolOptions,
    brushSize: 6,
    sel: { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
}

test('dodge and burn are tools with the PhotoCraft options', () => {
  assert.equal(TOOLS.dodge.label, 'Dodge');
  assert.equal(TOOLS.burn.label, 'Burn');
  for (const id of ['dodge', 'burn']) {
    const schema = TOOL_OPTION_SCHEMA[id];
    const by = Object.fromEntries(schema.map((o) => [o.key, o]));
    for (const key of ['size', 'hardness']) assert.ok(by[key], key);
    assert.equal(by.range.type, 'select');
    assert.deepEqual(
      by.range.options.map((o) => o.value),
      ['shadows', 'midtones', 'highlights']
    );
    assert.equal(by.range.default, 'midtones');
    assert.equal(by.exposure.min, 1);
    assert.equal(by.exposure.max, 100);
    assert.equal(by.exposure.default, 50);
    assert.equal(by.protectTones.default, true);
  }
});

test('a stroke pushes undo before changing pixels, and passes over one spot do not compound', () => {
  const W = 12,
    H = 12;
  for (const id of ['dodge', 'burn']) {
    const order = [];
    const ctx = fakeCtx(W, H, solid(W, H, [128, 128, 128, 255]), order);
    const state = toneState(id, order);
    const tool = TOOLS[id];
    tool.onDown(ctx, ov, state, 6.5, 6.5);
    const afterOne = px(ctx.img.data, W, 6, 6);
    for (let i = 0; i < 5; i++) {
      tool.onMove(ctx, ov, state, 8.5, 6.5);
      tool.onMove(ctx, ov, state, 6.5, 6.5);
    }
    tool.onUp(ctx, ov, state, 6.5, 6.5);
    assert.equal(order[0], 'undo:' + TOOLS[id].label);
    assert.ok(order.includes('put'));
    assert.deepEqual(px(ctx.img.data, W, 6, 6), afterOne, id);
    assert.ok(id === 'dodge' ? afterOne[0] > 128 : afterOne[0] < 128, id);
    assert.deepEqual(px(ctx.img.data, W, 0, 0), [128, 128, 128, 255]);
    // A second stroke builds on the first.
    tool.onDown(ctx, ov, state, 6.5, 6.5);
    tool.onUp(ctx, ov, state, 6.5, 6.5);
    const again = px(ctx.img.data, W, 6, 6)[0];
    assert.ok(id === 'dodge' ? again > afterOne[0] : again < afterOne[0], id);
  }
});

test('an active selection limits the stroke', () => {
  const W = 10,
    H = 10;
  const order = [];
  const ctx = fakeCtx(W, H, solid(W, H, [128, 128, 128, 255]), order);
  const state = toneState('dodge', order);
  state.toolOptions.dodge.size = 8;
  state.sel = { mode: 'active', x: 5, y: 0, w: 5, h: 10, mask: null, data: null, baseData: null };
  TOOLS.dodge.onDown(ctx, ov, state, 5, 5);
  TOOLS.dodge.onUp(ctx, ov, state, 5, 5);
  assert.deepEqual(px(ctx.img.data, W, 4, 5), [128, 128, 128, 255], 'outside unchanged');
  assert.ok(px(ctx.img.data, W, 5, 5)[0] > 128, 'inside dodged');
});
