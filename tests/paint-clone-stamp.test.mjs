import test from 'node:test';
import assert from 'node:assert/strict';

import { cloneDab, cloneStrokeOffset, dabCoverage, tipReach } from '../paint/retouch.js';
import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

// Every pixel is distinct: r = 20x, g = 20y, b = 7, opaque.
function gridImage(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data.set([x * 20, y * 20, 7, 255], (y * W + x) * 4);
  }
  return data;
}

function px(data, W, x, y) {
  const i = (y * W + x) * 4;
  return Array.from(data.slice(i, i + 4));
}

test('a hard tip is solid at its centre and paints nothing past its reach', () => {
  assert.equal(dabCoverage(0, 5, 1), 1);
  assert.equal(dabCoverage(tipReach(5, 1) + 0.5, 5, 1), 0);
  // A soft tip still paints just past its nominal radius.
  assert.ok(dabCoverage(5.2, 5, 0) > 0);
  assert.ok(dabCoverage(2, 5, 0) < 1);
});

test('cloneDab copies the source pixel at the fixed offset', () => {
  const W = 12,
    H = 12;
  const src = gridImage(W, H);
  const dst = new Uint8ClampedArray(src);
  const box = cloneDab(dst, src, W, H, 7.5, 6.5, -4, 2, 1.5, 1, 1, null, null);
  assert.ok(box);
  assert.deepEqual(px(dst, W, 7, 6), px(src, W, 3, 8));
  assert.deepEqual(px(dst, W, 6, 6), px(src, W, 2, 8));
  // Far from the dab nothing changes.
  assert.deepEqual(px(dst, W, 0, 0), px(src, W, 0, 0));
  assert.deepEqual(px(dst, W, 11, 11), px(src, W, 11, 11));
});

test('pixels painted earlier in the stroke are never re-sampled', () => {
  const W = 16,
    H = 8;
  const src = gridImage(W, H);
  const dst = new Uint8ClampedArray(src);
  const cov = new Float32Array(W * H);
  // Source 4 px to the left. The second dab samples where the first one painted.
  cloneDab(dst, src, W, H, 4.5, 3.5, -4, 0, 1.5, 1, 1, null, cov);
  assert.deepEqual(px(dst, W, 4, 3), px(src, W, 0, 3));
  cloneDab(dst, src, W, H, 8.5, 3.5, -4, 0, 1.5, 1, 1, null, cov);
  assert.deepEqual(px(dst, W, 8, 3), px(src, W, 4, 3), 'pre-stroke pixel, not the cloned one');
  assert.notDeepEqual(px(dst, W, 8, 3), px(dst, W, 4, 3));
});

test('overlapping dabs do not compound opacity past the stroke opacity', () => {
  const W = 8,
    H = 8;
  const src = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) src.set(p % W < 4 ? [0, 0, 0, 255] : [200, 100, 50, 255], p * 4);
  const dst = new Uint8ClampedArray(src);
  const cov = new Float32Array(W * H);
  for (let i = 0; i < 3; i++) cloneDab(dst, src, W, H, 1.5, 3.5, 4, 0, 1.5, 1, 0.5, null, cov);
  assert.deepEqual(px(dst, W, 1, 3), [100, 50, 25, 255]);
});

test('source pixels off the canvas leave the destination untouched', () => {
  const W = 10,
    H = 10;
  const src = gridImage(W, H);
  const dst = new Uint8ClampedArray(src);
  cloneDab(dst, src, W, H, 2.5, 2.5, -3, 0, 2.5, 1, 1, null, null);
  // x + dx < 0 for x = 0..2: unchanged.
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x <= 2; x++) assert.deepEqual(px(dst, W, x, y), px(src, W, x, y), `${x},${y}`);
  }
  // x = 3 samples x = 0, which is on the canvas.
  assert.deepEqual(px(dst, W, 3, 2), px(src, W, 0, 2));
});

test('the mask limits writes', () => {
  const W = 10,
    H = 10;
  const src = gridImage(W, H);
  const dst = new Uint8ClampedArray(src);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 5; x < W; x++) mask[y * W + x] = 1;
  cloneDab(dst, src, W, H, 5, 5.5, 0, -3, 3, 1, 1, mask, null);
  for (let x = 2; x < 5; x++) assert.deepEqual(px(dst, W, x, 5), px(src, W, x, 5), `outside ${x}`);
  for (let x = 5; x < 7; x++) assert.deepEqual(px(dst, W, x, 5), px(src, W, x, 2), `inside ${x}`);
});

test('Aligned keeps the first offset; unaligned restarts from the source point', () => {
  const clone = { source: { x: 10, y: 20 }, offset: null };
  assert.deepEqual(cloneStrokeOffset(clone, 30, 25, true), { dx: -20, dy: -5 });
  assert.deepEqual(cloneStrokeOffset(clone, 50, 50, true), { dx: -20, dy: -5 });

  const free = { source: { x: 10, y: 20 }, offset: null };
  assert.deepEqual(cloneStrokeOffset(free, 30, 25, false), { dx: -20, dy: -5 });
  assert.deepEqual(cloneStrokeOffset(free, 50, 50, false), { dx: -40, dy: -30 });
  assert.equal(free.offset, null);

  assert.equal(cloneStrokeOffset({ source: null, offset: null }, 1, 1, true), null);
});

// Fake 2D context over a plain ImageData-like buffer.
function fakeCtx(W, H, data) {
  const img = { width: W, height: H, data };
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
  for (const name of ['clearRect', 'save', 'restore', 'fillText']) {
    ov[name] = (...args) => ops.push([name, ...args]);
  }
  return ov;
}

function cloneState(order, aligned = true) {
  const toolOptions = defaultToolOptions();
  Object.assign(toolOptions.cloneStamp, { size: 3, hardness: 100, aligned });
  return {
    toolOptions,
    brushSize: 3,
    sel: { mode: 'none' },
    pushUndo: (label) => order.push('undo:' + label)
  };
}

test('clone stamp is a tool with Aligned on by default', () => {
  assert.equal(TOOLS.cloneStamp.label, 'Clone Stamp');
  const aligned = TOOL_OPTION_SCHEMA.cloneStamp.find((o) => o.key === 'aligned');
  assert.equal(aligned.type, 'checkbox');
  assert.equal(aligned.default, true);
  for (const key of ['size', 'hardness', 'opacity']) {
    assert.ok(
      TOOL_OPTION_SCHEMA.cloneStamp.some((o) => o.key === key),
      key
    );
  }
});

test('dragging without a source shows a hint and paints nothing', () => {
  const W = 8,
    H = 8;
  const ctx = fakeCtx(W, H, gridImage(W, H));
  const ov = fakeOverlay(W, H);
  const order = [];
  const state = cloneState(order);
  const tool = TOOLS.cloneStamp;
  tool.onDown(ctx, ov, state, 4, 4);
  tool.onMove(ctx, ov, state, 6, 4);
  assert.ok(ov.ops.some(([n, text]) => n === 'fillText' && /Alt-click/.test(text)));
  tool.onUp(ctx, ov, state, 6, 4);
  assert.deepEqual(order, []);
  assert.equal(ctx.calls.length, 0);
  assert.equal(state.drawing, false);
});

test('Alt+click sets the source, then a stroke pushes undo before painting', () => {
  const W = 16,
    H = 8;
  const orig = gridImage(W, H);
  const ctx = fakeCtx(W, H, orig.slice());
  const ov = fakeOverlay(W, H);
  const order = [];
  ctx.putImageData = ((put) => (next) => {
    order.push('put');
    put.call(ctx, next);
  })(ctx.putImageData);
  const state = cloneState(order);
  const tool = TOOLS.cloneStamp;

  state.altKey = true;
  tool.onDown(ctx, ov, state, 2.4, 3.4);
  assert.deepEqual(state.clone.source, { x: 2, y: 3 });
  assert.ok(!state.drawing);
  assert.deepEqual(order, []);

  state.altKey = false;
  tool.onDown(ctx, ov, state, 8.5, 3.5);
  tool.onMove(ctx, ov, state, 12.5, 3.5);
  tool.onUp(ctx, ov, state, 12.5, 3.5);
  assert.equal(order[0], 'undo:Clone Stamp');
  assert.ok(order.includes('put'));
  // Offset is (2 - 8, 3 - 3) = (-6, 0); pixel (12, 3) shows the pre-stroke pixel (6, 3), not
  // the one the stroke had already painted there.
  assert.deepEqual(px(ctx.img.data, W, 8, 3), px(orig, W, 2, 3));
  assert.deepEqual(px(ctx.img.data, W, 12, 3), px(orig, W, 6, 3));
  assert.deepEqual(state.clone.offset, { dx: -6, dy: 0 });
});

test('Aligned carries the offset to the next stroke; off restarts from the source', () => {
  const W = 16,
    H = 8;
  for (const aligned of [true, false]) {
    const orig = gridImage(W, H);
    const ctx = fakeCtx(W, H, orig.slice());
    const ov = fakeOverlay(W, H);
    const state = cloneState([], aligned);
    const tool = TOOLS.cloneStamp;
    state.altKey = true;
    tool.onDown(ctx, ov, state, 1, 1);
    state.altKey = false;
    tool.onDown(ctx, ov, state, 4.5, 1.5);
    tool.onUp(ctx, ov, state, 4.5, 1.5);
    const before = ctx.img.data.slice();
    tool.onDown(ctx, ov, state, 10.5, 5.5);
    tool.onUp(ctx, ov, state, 10.5, 5.5);
    // Aligned: (10, 5) + (-3, 0) = (7, 5). Unaligned: back to the source (1, 1).
    const want = aligned ? px(before, W, 7, 5) : px(before, W, 1, 1);
    assert.deepEqual(px(ctx.img.data, W, 10, 5), want, `aligned=${aligned}`);
  }
});

test('an active selection limits the clone stroke', () => {
  const W = 10,
    H = 10;
  const orig = gridImage(W, H);
  const ctx = fakeCtx(W, H, orig.slice());
  const ov = fakeOverlay(W, H);
  const state = cloneState([]);
  state.toolOptions.cloneStamp.size = 8;
  state.sel = { mode: 'active', x: 5, y: 0, w: 5, h: 10, mask: null, data: null, baseData: null };
  const tool = TOOLS.cloneStamp;
  state.altKey = true;
  tool.onDown(ctx, ov, state, 5, 2);
  state.altKey = false;
  tool.onDown(ctx, ov, state, 5, 6);
  tool.onUp(ctx, ov, state, 5, 6);
  assert.deepEqual(px(ctx.img.data, W, 4, 6), px(orig, W, 4, 6), 'outside unchanged');
  assert.deepEqual(px(ctx.img.data, W, 5, 6), px(orig, W, 5, 2), 'inside cloned');
});
