import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { focusDab, localBlur, localSharpen } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { buildToolbar } from '../paint/ui.js';

// A 1-channel W × H edge: 0.2 on the left half, 0.8 on the right.
function edge(W, H) {
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = x < W / 2 ? 0.2 : 0.8;
  return d;
}

// The step across the edge on row y, from the pixels either side of it.
const step = (d, W, y) => d[y * W + W / 2] - d[y * W + W / 2 - 1];

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

function toolState(id, order, opts = {}) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions[id], { size: 8, hardness: 100, strength: 100 }, opts);
  return {
    toolOptions,
    brushSize: 8,
    sel: { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
}

// An RGBA edge: dark grey on the left, light grey on the right.
function rgbaEdge(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++)
      data.set(x < W / 2 ? [50, 50, 50, 255] : [200, 200, 200, 255], (y * W + x) * 4);
  }
  return data;
}

function stroke(id, ctx, state, y) {
  TOOLS[id].onDown(ctx, ov, state, 8, y);
  for (let i = 0; i < 3; i++) {
    TOOLS[id].onMove(ctx, ov, state, 12, y);
    TOOLS[id].onMove(ctx, ov, state, 4, y);
  }
  TOOLS[id].onUp(ctx, ov, state, 8, y);
}

test('blur and sharpen are tools with the PhotoCraft options and tool-column buttons', () => {
  for (const id of ['blur', 'sharpen']) {
    assert.ok(TOOLS[id], id);
    const by = Object.fromEntries(TOOL_OPTION_SCHEMA[id].map((o) => [o.key, o]));
    assert.ok(by.size && by.hardness, id);
    assert.equal(by.strength.min, 1);
    assert.equal(by.strength.max, 100);
    assert.equal(by.strength.default, 50);
  }
  assert.equal(TOOLS.blur.label, 'Blur');
  assert.equal(TOOLS.sharpen.label, 'Sharpen');
  const protect = TOOL_OPTION_SCHEMA.sharpen.find((o) => o.key === 'protectDetail');
  assert.equal(protect.type, 'checkbox');
  assert.equal(protect.default, true);
  assert.ok(!TOOL_OPTION_SCHEMA.blur.some((o) => o.key === 'protectDetail'));

  const { document } = new JSDOM('<div id="tool-buttons"></div>').window;
  const prev = globalThis.document;
  globalThis.document = document;
  try {
    const container = document.getElementById('tool-buttons');
    buildToolbar(TOOLS, { tool: 'brush' }, container, () => {});
    assert.ok(container.querySelector('[data-tool="blur"]'));
    assert.ok(container.querySelector('[data-tool="sharpen"]'));
  } finally {
    globalThis.document = prev;
  }
});

test('localBlur lowers contrast at an edge and localSharpen raises it', () => {
  const W = 16,
    H = 4;
  const d = edge(W, H);
  const win = [0, 0, W, H];
  const b = localBlur(d, W, H, 1, null, win, 1.5);
  assert.ok(step(b, W, 1) < step(d, W, 1) * 0.6, String(step(b, W, 1)));
  const s = localSharpen(d, W, H, 1, null, win, 1, false);
  assert.ok(step(s, W, 1) > step(d, W, 1));
  assert.ok(s[W / 2 - 1 + W] < 0.2 && s[W / 2 + W] > 0.8, 'overshoots without Protect Detail');
});

test('Protect Detail keeps Sharpen inside the 3x3 range', () => {
  const W = 12,
    H = 12;
  const d = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) d[p] = 0.3 + 0.03 * (p % W) + (p % W === 6 ? 0.2 : 0);
  const s = localSharpen(d, W, H, 1, null, [0, 0, W, H], 4, true);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let lo = Infinity,
        hi = -Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v =
            d[Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))];
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      const v = s[y * W + x];
      assert.ok(v >= lo - 1e-6 && v <= hi + 1e-6, `${x},${y}: ${v} not in ${lo}..${hi}`);
    }
  }
});

test('a flat area is unchanged by both', () => {
  const W = 8,
    H = 8;
  const d = new Float32Array(W * H * 4);
  for (let p = 0; p < W * H; p++) d.set([0.4, 0.6, 0.2, 0.7], p * 4);
  const win = [2, 2, 6, 6];
  for (const out of [
    localBlur(d, W, H, 4, 3, win, 2),
    localSharpen(d, W, H, 4, 3, win, 1, false),
    localSharpen(d, W, H, 4, 3, win, 1, true)
  ]) {
    assert.equal(out.length, 16 * 4);
    for (let i = 0; i < out.length; i++) assert.ok(Math.abs(out[i] - d[i % 4]) < 1e-5);
  }
  for (const id of ['blur', 'sharpen']) {
    const order = [];
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let p = 0; p < 256; p++) data.set([90, 140, 40, 255], p * 4);
    const ctx = fakeCtx(16, 16, data.slice(), order);
    stroke(id, ctx, toolState(id, order), 8);
    assert.deepEqual(ctx.img.data, data, id);
  }
});

test('transparent pixels do not bleed colour under Blur', () => {
  const W = 8,
    H = 1;
  const d = new Float32Array(W * 4);
  for (let x = 0; x < W; x++) d.set(x < 4 ? [1, 0, 0, 1] : [0, 1, 0, 0], x * 4);
  const b = localBlur(d, W, H, 4, 3, [2, 0, 6, 1], 1);
  for (let i = 0; i < b.length; i += 4) {
    if (b[i + 3] > 0.01) assert.ok(b[i] > 0.99 && b[i + 1] < 0.01, String(b.slice(i, i + 4)));
  }
});

test('Blur and Sharpen strokes change edge contrast, push undo before the first put', () => {
  const W = 16,
    H = 16;
  const at = (data, x, y) => data[(y * W + x) * 4];
  for (const id of ['blur', 'sharpen']) {
    const order = [];
    const ctx = fakeCtx(W, H, rgbaEdge(W, H), order);
    stroke(id, ctx, toolState(id, order, { protectDetail: false }), 8);
    assert.equal(order[0], 'undo:' + TOOLS[id].label);
    assert.ok(order.indexOf('undo:' + TOOLS[id].label) < order.indexOf('put'));
    const s = at(ctx.img.data, 8, 8) - at(ctx.img.data, 7, 8);
    if (id === 'blur') assert.ok(s < 150, `blur step ${s}`);
    else assert.ok(s > 150, `sharpen step ${s}`);
    assert.deepEqual(Array.from(ctx.img.data.slice(0, 4)), [50, 50, 50, 255], 'far pixel kept');
    for (let p = 0; p < W * H; p++) assert.equal(ctx.img.data[p * 4 + 3], 255);
  }
});

test('the mask limits focusDab writes and an active selection limits the stroke', () => {
  const W = 16,
    H = 4;
  const work = edge(W, H);
  const before = work.slice();
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) mask[y * W + 8] = 1;
  const filter = (win) => localBlur(work, W, H, 1, null, win, 1.5);
  const box = focusDab(work, W, H, 1, 8, 2, 4, 1, 1, 0.25, filter, mask);
  assert.ok(box);
  for (let p = 0; p < W * H; p++) {
    if (mask[p]) continue;
    assert.equal(work[p], before[p], `pixel ${p} outside the mask`);
  }
  assert.ok(work[2 * W + 8] < before[2 * W + 8], 'inside the mask blurred');

  const order = [];
  const ctx = fakeCtx(16, 16, rgbaEdge(16, 16), order);
  const state = toolState('blur', order);
  state.sel = { mode: 'active', x: 8, y: 0, w: 8, h: 16, mask: null, data: null, baseData: null };
  stroke('blur', ctx, state, 8);
  assert.deepEqual(
    Array.from(ctx.img.data.slice((8 * 16 + 7) * 4, (8 * 16 + 8) * 4)),
    [50, 50, 50, 255]
  );
  assert.notDeepEqual(
    Array.from(ctx.img.data.slice((8 * 16 + 8) * 4, (8 * 16 + 9) * 4)),
    [200, 200, 200, 255]
  );
});
