import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  bestOffset,
  dilateMask,
  membraneFill,
  proximitySourcePatch,
  spotHealStroke,
  spotSamplingWindow
} from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { buildToolbar } from '../paint/ui.js';

// Deterministic noise in 0..1.
function noise(n, seed = 7) {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = (s >>> 8) / 0x1000000;
  }
  return out;
}

function px(data, W, x, y) {
  const i = (y * W + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

function disc(W, H, cx, cy, r) {
  const m = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (Math.hypot((i % W) - cx, Math.floor(i / W) - cy) <= r) m[i] = 1;
  }
  return m;
}

// Flat 128 with a ±10 checker texture, and a dark spot (20) of radius 4 at (40, 40).
function spotImage(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = (x + y) % 2 ? 138 : 118;
      if (Math.hypot(x - 40, y - 40) <= 4) v = 20;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return data;
}

test('spotHealing is a tool with Size and Hardness, the bandage icon, and a tool button', () => {
  const tool = TOOLS.spotHealing;
  assert.equal(tool.label, 'Spot Healing Brush');
  assert.equal(tool.icon, 'bandage');
  const keys = TOOL_OPTION_SCHEMA.spotHealing.filter((o) => o.type !== 'hint').map((o) => o.key);
  assert.deepEqual(keys, ['size', 'hardness']);

  const { window } = new JSDOM('<!doctype html><div id="tools"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    const container = window.document.getElementById('tools');
    const state = { tool: 'brush', toolOptions: defaultToolOptions() };
    buildToolbar(TOOLS, state, container, () => {});
    const btn = container.querySelector('[data-tool="spotHealing"]');
    assert.ok(btn, 'tool button');
    assert.ok(btn.querySelector('svg'));
  } finally {
    globalThis.document = prev;
  }
});

test('dilateMask grows by a square and spotSamplingWindow slides inside the canvas', () => {
  const m = new Uint8Array(25);
  m[12] = 1;
  const d = dilateMask(5, 5, m, 1);
  assert.equal(
    d.reduce((a, v) => a + v, 0),
    9
  );
  assert.equal(d[6], 1);
  assert.equal(d[0], 0);
  // A 10px spot near the top-left of 400 x 300: a 200px square, slid to the corner.
  assert.deepEqual(spotSamplingWindow([5, 5, 15, 15], 400, 300), [0, 0, 200, 200]);
  // Centred where it fits.
  assert.deepEqual(spotSamplingWindow([195, 145, 205, 155], 400, 300), [100, 50, 300, 250]);
  // A canvas smaller than the square: the whole canvas.
  assert.deepEqual(spotSamplingWindow([5, 5, 15, 15], 60, 40), [0, 0, 60, 40]);
});

test('bestOffset finds a planted matching patch', () => {
  const w = 60,
    h = 60,
    ch = 1;
  const img = noise(w * h);
  const domain = new Uint8Array(w * h);
  for (let y = 28; y < 34; y++) for (let x = 28; x < 34; x++) domain[y * w + x] = 1;
  const ring = 3;
  // Make the ring around the domain a copy of the neighbourhood at (-15, +9).
  for (let y = 28 - ring; y < 34 + ring; y++) {
    for (let x = 28 - ring; x < 34 + ring; x++) {
      if (!domain[y * w + x]) img[y * w + x] = img[(y + 9) * w + x - 15];
    }
  }
  assert.deepEqual(bestOffset(w, h, ch, img, domain, ring, 25), { dx: -15, dy: 9 });
  // No room: a domain filling the grid has nowhere to move.
  assert.equal(bestOffset(w, h, ch, img, new Uint8Array(w * h).fill(1), ring, 25), null);
});

test('proximitySourcePatch reads pre-heal pixels, so overlapping offsets do not streak', () => {
  const w = 20,
    h = 1;
  const img = new Float32Array(w);
  for (let x = 0; x < w; x++) img[x] = x;
  const domain = new Uint8Array(w);
  for (let x = 5; x < 15; x++) domain[x] = 1;
  const out = proximitySourcePatch(img, w, h, 1, domain, 2, 0);
  for (let x = 0; x < w; x++) assert.equal(out[x], domain[x] ? x + 2 : x, `x=${x}`);
  assert.equal(img[5], 5, 'input untouched');
  // A source off the grid.
  assert.equal(proximitySourcePatch(img, w, h, 1, domain, 6, 0), null);
});

test('membraneFill reproduces a linear ramp', () => {
  const w = 40,
    h = 30,
    ch = 2;
  const img = new Float32Array(w * h * ch);
  const truth = (i, c) => (c ? 0.9 - 0.01 * (i % w) : 0.1 + 0.02 * Math.floor(i / w));
  for (let i = 0; i < w * h; i++) for (let c = 0; c < ch; c++) img[i * ch + c] = truth(i, c);
  const domain = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) domain[i] = Math.hypot((i % w) - 20, Math.floor(i / w) - 15) < 9;
  const out = membraneFill(w, h, ch, img, domain);
  let err = 0;
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < ch; c++) err = Math.max(err, Math.abs(out[i * ch + c] - truth(i, c)));
  }
  assert.ok(err < 2e-3, `max error ${err}`);
});

test('a dark spot on a textured flat area is replaced by pixels near the surrounding mean', () => {
  const W = 80,
    H = 80;
  const src = spotImage(W, H);
  const dst = new Uint8ClampedArray(src);
  const cov = disc(W, H, 40, 40, 6);
  const box = spotHealStroke(dst, src, W, H, cov, 12, null);
  assert.deepEqual(box, [34, 34, 47, 47]);
  let sum = 0,
    n = 0;
  for (let y = 36; y <= 44; y++) {
    for (let x = 36; x <= 44; x++) {
      if (Math.hypot(x - 40, y - 40) > 4) continue;
      const v = px(dst, W, x, y)[0];
      assert.ok(v > 100 && v < 156, `(${x}, ${y}) = ${v}`);
      sum += v;
      n++;
    }
  }
  assert.ok(Math.abs(sum / n - 128) < 8, `mean ${sum / n}`);
  // Outside the coverage nothing moves.
  assert.deepEqual(px(dst, W, 50, 40), px(src, W, 50, 40));
  assert.deepEqual(px(dst, W, 40, 33), px(src, W, 40, 33));
});

test('with no room to match, the spot falls back to the membrane fill', () => {
  const W = 12,
    H = 12;
  const src = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.hypot(x - 6, y - 6) <= 2 ? 0 : 60 + 10 * x;
      src.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  const dst = new Uint8ClampedArray(src);
  // A stroke this wide leaves no displaced copy of its ring inside 12 x 12.
  spotHealStroke(dst, src, W, H, disc(W, H, 6, 6, 3), 8, null);
  for (let x = 4; x <= 8; x++) {
    const v = px(dst, W, x, 6)[0];
    assert.ok(Math.abs(v - (60 + 10 * x)) < 4, `x=${x}: ${v}`);
  }
});

test('an active selection limits the writes', () => {
  const W = 80,
    H = 80;
  const src = spotImage(W, H);
  const dst = new Uint8ClampedArray(src);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 40; x++) mask[y * W + x] = 1;
  spotHealStroke(dst, src, W, H, disc(W, H, 40, 40, 6), 12, mask);
  for (let x = 40; x <= 44; x++) assert.deepEqual(px(dst, W, x, 40), px(src, W, x, 40), `x=${x}`);
  assert.ok(px(dst, W, 38, 40)[0] > 100, 'inside healed');
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
  for (const name of ['clearRect', 'save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke']) {
    ov[name] = () => {};
  }
  return ov;
}

test('a stroke pushes undo before the first put and heals once on pointer up', () => {
  const W = 80,
    H = 80;
  const order = [];
  const orig = spotImage(W, H);
  const ctx = fakeCtx(W, H, orig.slice(), order);
  const ov = fakeOverlay(W, H);
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions.spotHealing, { size: 12, hardness: 100 });
  const state = {
    toolOptions,
    brushSize: 12,
    sel: { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label),
    // No Alt-click source: Alt is ignored.
    altKey: true
  };
  const tool = TOOLS.spotHealing;
  tool.onDown(ctx, ov, state, 40, 40);
  assert.deepEqual(order, ['undo:Spot Healing Brush']);
  assert.equal(state.clone, undefined);
  tool.onMove(ctx, ov, state, 40.5, 40);
  // While dragging only the overlay changes.
  assert.deepEqual(order, ['undo:Spot Healing Brush']);
  assert.deepEqual(px(ctx.img.data, W, 40, 40), px(orig, W, 40, 40));
  tool.onUp(ctx, ov, state, 40.5, 40);
  assert.deepEqual(order, ['undo:Spot Healing Brush', 'put']);
  assert.equal(state.spotStroke, null);
  assert.equal(state.drawing, false);
  assert.ok(px(ctx.img.data, W, 40, 40)[0] > 100, `${px(ctx.img.data, W, 40, 40)}`);
});
