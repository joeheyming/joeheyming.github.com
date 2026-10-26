import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { mixPremultiplied, smudgeDab, smudgeStroke } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { buildToolbar } from '../paint/ui.js';

const W = 64,
  H = 16;

function fakeCtx(data, order) {
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

function toolState(order, opts = {}, sel = { mode: 'none' }) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions.smudge, { size: 8, hardness: 100, strength: 80 }, opts);
  return {
    toolOptions,
    brushSize: 8,
    color: '#0000ff',
    sel,
    pushUndo: (label) => order.push('undo:' + label)
  };
}

// Red (or `left`) for x < 16, `right` elsewhere.
function split(left, right) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set(p % W < 16 ? left : right, p * 4);
  return data;
}

const RED = [255, 0, 0, 255],
  WHITE = [255, 255, 255, 255];

// A stroke from x = 10 to x = 50 along row 8.
function stroke(ctx, state) {
  TOOLS.smudge.onDown(ctx, ov, state, 10, 8.5);
  for (let x = 14; x <= 50; x += 4) TOOLS.smudge.onMove(ctx, ov, state, x, 8.5);
  TOOLS.smudge.onUp(ctx, ov, state, 50, 8.5);
}

const green = (data, x, y = 8) => data[(y * W + x) * 4 + 1];

test('smudge is a tool with the PhotoCraft options and a tool-column button', () => {
  assert.equal(TOOLS.smudge.label, 'Smudge');
  const by = Object.fromEntries(TOOL_OPTION_SCHEMA.smudge.map((o) => [o.key, o]));
  assert.ok(by.size && by.hardness);
  assert.equal(by.strength.min, 1);
  assert.equal(by.strength.max, 100);
  assert.equal(by.strength.default, 50);
  assert.equal(by.fingerPainting.type, 'checkbox');
  assert.equal(by.fingerPainting.default, false);

  const { document } = new JSDOM('<div id="tool-buttons"></div>').window;
  const prev = globalThis.document;
  globalThis.document = document;
  try {
    const container = document.getElementById('tool-buttons');
    buildToolbar(TOOLS, { tool: 'brush' }, container, () => {});
    assert.ok(container.querySelector('[data-tool="smudge"]'));
  } finally {
    globalThis.document = prev;
  }
});

test('mixPremultiplied ignores the colour of transparent pixels', () => {
  const d = [0, 0, 0, 0];
  mixPremultiplied(d, [1, 0.5, 0, 1], 0.25);
  assert.deepEqual(d, [1, 0.5, 0, 0.25]);
  const e = [0.2, 0.2, 0.2, 1];
  mixPremultiplied(e, [0, 0, 0, 0], 1);
  assert.equal(e[3], 0);
  const f = [0.2, 0.4, 0.6, 1, 0, 0, 0, 1];
  mixPremultiplied(f, [9, 1, 0, 0, 1, 1, 1, 1], 0.5, 4, 4);
  assert.deepEqual(f, [0.2, 0.4, 0.6, 1, 0.5, 0.5, 0.5, 1], 'offsets');
});

test('a stroke from red into white carries red, fading with distance; undo first', () => {
  const order = [];
  const ctx = fakeCtx(split(RED, WHITE), order);
  stroke(ctx, toolState(order));
  assert.equal(order[0], 'undo:Smudge');
  assert.ok(order.indexOf('undo:Smudge') < order.indexOf('put'));
  const d = ctx.img.data;
  assert.ok(green(d, 20) < 128, `x=20 green ${green(d, 20)}`);
  assert.ok(green(d, 20) < green(d, 40), 'fades with distance');
  assert.equal(green(d, 30, 0), 255, 'off-stroke row untouched');
  for (let p = 0; p < W * H; p++) assert.equal(d[p * 4 + 3], 255);
});

test('a low strength carries colour a shorter distance than strength 100', () => {
  const reach = (strength) => {
    const order = [];
    const ctx = fakeCtx(split(RED, WHITE), order);
    stroke(ctx, toolState(order, { strength }));
    let x = 16;
    while (x < W && green(ctx.img.data, x) < 200) x++;
    return x;
  };
  const full = reach(100),
    low = reach(20);
  assert.ok(low < full, `low ${low} vs full ${full}`);
  assert.ok(full >= 45, `strength 100 carries red to the stroke end (${full})`);
});

test('Finger Painting lays the foreground colour from the first dab', () => {
  const order = [];
  const ctx = fakeCtx(split(WHITE, WHITE), order);
  stroke(ctx, toolState(order, { fingerPainting: true }));
  const i = (8 * W + 11) * 4;
  const px = Array.from(ctx.img.data.slice(i, i + 4));
  assert.ok(px[0] < 128 && px[1] < 128 && px[2] === 255, String(px));
  // Without it the first dab picks up the white under it.
  const ctx2 = fakeCtx(split(WHITE, WHITE), order);
  stroke(ctx2, toolState(order));
  assert.deepEqual(ctx2.img.data, split(WHITE, WHITE));
});

test('smudging out of a transparent area does not darken or tint opaque pixels', () => {
  const order = [];
  const ORANGE = [255, 204, 0, 255];
  const ctx = fakeCtx(split([0, 0, 0, 0], ORANGE), order);
  stroke(ctx, toolState(order));
  const d = ctx.img.data;
  let thinned = 0;
  for (let p = 0; p < W * H; p++) {
    const a = d[p * 4 + 3];
    if (p % W < 16 || a === 0) continue;
    if (a < 255) thinned++;
    assert.ok(Math.abs(d[p * 4] - 255) <= 1, `pixel ${p} red ${d[p * 4]}`);
    assert.ok(Math.abs(d[p * 4 + 1] - 204) <= 1, `pixel ${p} green ${d[p * 4 + 1]}`);
    assert.ok(d[p * 4 + 2] <= 1, `pixel ${p} blue ${d[p * 4 + 2]}`);
  }
  assert.ok(thinned > 10, 'transparency was dragged in');
});

test('a flat area is unchanged', () => {
  const order = [];
  const flat = split([90, 140, 40, 200], [90, 140, 40, 200]);
  const ctx = fakeCtx(flat.slice(), order);
  stroke(ctx, toolState(order));
  assert.deepEqual(ctx.img.data, flat);
});

test('the mask limits smudgeDab writes and an active selection limits the stroke', () => {
  const work = new Float32Array(W * H * 4);
  for (let p = 0; p < W * H; p++) work.set(p % W < 16 ? [1, 0, 0, 1] : [1, 1, 1, 1], p * 4);
  const before = work.slice();
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) mask[y * W + 18] = 1;
  const sm = smudgeStroke(1, null, 8);
  for (let x = 12; x <= 22; x++) smudgeDab(sm, work, W, H, x, 8.5, 4, 1, mask);
  for (let p = 0; p < W * H; p++) {
    if (mask[p]) continue;
    for (let c = 0; c < 4; c++) assert.equal(work[p * 4 + c], before[p * 4 + c], `pixel ${p}`);
  }
  assert.ok(work[(8 * W + 18) * 4 + 1] < 0.5, 'inside the mask smudged');

  const order = [];
  const ctx = fakeCtx(split(RED, WHITE), order);
  const sel = { mode: 'active', x: 30, y: 0, w: W - 30, h: H, mask: null, data: null };
  stroke(ctx, toolState(order, {}, sel));
  const orig = split(RED, WHITE);
  for (let p = 0; p < W * H; p++) {
    if (p % W >= 30) continue;
    for (let c = 0; c < 4; c++) assert.equal(ctx.img.data[p * 4 + c], orig[p * 4 + c], `${p}`);
  }
  assert.ok(green(ctx.img.data, 32) < 255, 'inside the selection smudged');
});
