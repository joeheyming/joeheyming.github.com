import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, scanlineFill } from '../paint/tools.js';

const W = 40,
  H = 40;
// Right triangle: legs along the top and left edges, hypotenuse from (30,0) to (0,30).
const TRIANGLE = [
  [0, 0],
  [30, 0],
  [0, 30]
];

test('scanlineFill selects the interior of a right triangle and not the far corner', () => {
  const mask = scanlineFill(TRIANGLE, W, H);
  assert.equal(mask.length, W * H);
  for (const [x, y] of [
    [1, 1],
    [5, 5],
    [10, 10],
    [20, 2],
    [2, 20]
  ]) {
    assert.equal(mask[y * W + x], 1, `inside ${x},${y}`);
  }
  for (const [x, y] of [
    [39, 39],
    [20, 20],
    [29, 29],
    [35, 1],
    [1, 35]
  ]) {
    assert.equal(mask[y * W + x], 0, `outside ${x},${y}`);
  }
});

test('polyLasso is registered right after lasso', () => {
  const ids = Object.keys(TOOLS);
  assert.equal(ids[ids.indexOf('lasso') + 1], 'polyLasso');
  const schemaIds = Object.keys(TOOL_OPTION_SCHEMA);
  assert.equal(schemaIds[schemaIds.indexOf('lasso') + 1], 'polyLasso');
});

function fakeCtx() {
  const calls = [];
  const rec =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  return {
    calls,
    canvas: { width: W, height: H },
    clearRect: rec('clearRect'),
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    stroke: rec('stroke'),
    setLineDash: rec('setLineDash')
  };
}

function toolState(extra = {}) {
  const prior = new Uint8Array(W * H);
  prior[39 * W + 39] = 1;
  const state = {
    sel: { mode: 'active', x: 39, y: 39, w: 1, h: 1, mask: prior },
    zoom: 1,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    scanlineFill,
    selectionModeFor: (s) =>
      s.shiftKey || s.ctrlKey ? (s.altKey ? 'intersect' : 'add') : s.altKey ? 'subtract' : null,
    tryBeginMove: () => false,
    commitSelection: () => {
      state.committed = true;
      state.sel.mode = 'none';
      state.sel.mask = null;
    },
    ...extra
  };
  state.applySelectionWithMask = (mask, w, h, mode) => {
    state.applied = { mask, mode };
    state.sel = { mode: 'active', mask };
  };
  return state;
}

function clickAll(state, ctx, points) {
  const tool = TOOLS.polyLasso;
  for (const [x, y] of points) {
    tool.onDown(ctx, ctx, state, x, y);
    tool.onUp(ctx, ctx, state, x, y);
  }
}

test('polyLasso places points, previews a rubber band, and closes into scanlineFill', () => {
  const ctx = fakeCtx();
  const state = toolState();
  clickAll(state, ctx, TRIANGLE);
  assert.equal(state.drawing, true);
  assert.deepEqual(state.polyPath, TRIANGLE);
  assert.equal(state.applied, undefined, 'nothing selected before close');

  ctx.calls.length = 0;
  TOOLS.polyLasso.onMove(ctx, ctx, state, 12, 34);
  const lines = ctx.calls.filter((c) => c[0] === 'lineTo');
  assert.deepEqual(lines.at(-1), ['lineTo', 12, 34], 'rubber band ends at the pointer');

  assert.equal(TOOLS.polyLasso.close(ctx, ctx, state), true);
  assert.equal(state.drawing, false);
  assert.equal(state.committed, true);
  assert.equal(state.applied.mode, null);
  assert.deepEqual(state.applied.mask, scanlineFill(TRIANGLE, W, H));
  assert.equal(state.sel.mask[5 * W + 5], 1);
  assert.equal(state.sel.mask[39 * W + 39], 0);
});

test('a double-click duplicate point is ignored and clicking the first point closes', () => {
  const ctx = fakeCtx();
  const state = toolState();
  clickAll(state, ctx, [...TRIANGLE, [0, 30]]);
  assert.equal(state.polyPath.length, 3);
  clickAll(state, ctx, [[1, 1]]);
  assert.equal(state.drawing, false);
  assert.deepEqual(state.applied.mask, scanlineFill(TRIANGLE, W, H));
});

test('cancel leaves the existing selection alone', () => {
  const ctx = fakeCtx();
  const state = toolState();
  const before = state.sel;
  clickAll(state, ctx, TRIANGLE);
  TOOLS.polyLasso.cancel(ctx, state);
  assert.equal(state.drawing, false);
  assert.equal(state.polyPath, null);
  assert.equal(state.sel, before);
  assert.equal(state.sel.mode, 'active');
  assert.equal(state.committed, undefined);
  assert.equal(state.applied, undefined);
});

test('the first-click modifier is passed to applySelectionWithMask', () => {
  for (const [keys, mode] of [
    [{ shiftKey: true }, 'add'],
    [{ altKey: true }, 'subtract'],
    [{ shiftKey: true, altKey: true }, 'intersect']
  ]) {
    const ctx = fakeCtx();
    const state = toolState(keys);
    clickAll(state, ctx, TRIANGLE.slice(0, 1));
    // Releasing the modifier mid-polygon does not change the mode.
    Object.assign(state, { shiftKey: false, altKey: false });
    clickAll(state, ctx, TRIANGLE.slice(1));
    TOOLS.polyLasso.close(ctx, ctx, state);
    assert.equal(state.applied.mode, mode);
    assert.equal(state.committed, undefined);
  }
});

test('closing with fewer than three points selects nothing', () => {
  const ctx = fakeCtx();
  const state = toolState();
  clickAll(state, ctx, TRIANGLE.slice(0, 2));
  assert.equal(TOOLS.polyLasso.close(ctx, ctx, state), false);
  assert.equal(state.drawing, false);
  assert.equal(state.applied, undefined);
  assert.equal(state.sel.mode, 'active');
});

test('a click inside an active selection starts a move instead of a polygon', () => {
  const ctx = fakeCtx();
  let moved = false;
  const state = toolState({
    tryBeginMove: () => {
      moved = true;
      return true;
    }
  });
  clickAll(state, ctx, [[39, 39]]);
  assert.equal(moved, true);
  assert.notEqual(state.drawing, true);
});
