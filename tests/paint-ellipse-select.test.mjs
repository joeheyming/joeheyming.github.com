import test from 'node:test';
import assert from 'node:assert/strict';

import { ellipseMask } from '../paint/selection.js';
import { TOOLS, TOOL_OPTION_SCHEMA } from '../paint/tools.js';

test('ellipseMask returns a W*H mask with the center in and the box corners out', () => {
  const W = 64,
    H = 48;
  const mask = ellipseMask(8, 4, 40, 30, W, H);
  assert.equal(mask.length, W * H);
  assert.ok(mask instanceof Uint8Array);
  assert.equal(mask[19 * W + 28], 1);
  for (const [x, y] of [
    [8, 4],
    [47, 4],
    [8, 33],
    [47, 33]
  ]) {
    assert.equal(mask[y * W + x], 0, `corner ${x},${y}`);
  }
  // Nothing outside the bounding box.
  assert.equal(mask[19 * W + 7], 0);
  assert.equal(mask[19 * W + 48], 0);
  assert.equal(mask[19 * W + 8], 1);
  assert.equal(mask[19 * W + 47], 1);
});

test('ellipseMask from a square box is a circle', () => {
  const W = 40,
    H = 40;
  const mask = ellipseMask(0, 0, 40, 40, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - 20, y + 0.5 - 20);
      if (d < 19.5) assert.equal(mask[y * W + x], 1, `inside ${x},${y}`);
      if (d > 20.5) assert.equal(mask[y * W + x], 0, `outside ${x},${y}`);
      // Symmetric across both axes and the diagonal.
      assert.equal(mask[y * W + x], mask[y * W + (W - 1 - x)]);
      assert.equal(mask[y * W + x], mask[(H - 1 - y) * W + x]);
      assert.equal(mask[y * W + x], mask[x * W + y]);
    }
  }
});

test('ellipseMask clips a box that hangs off the canvas', () => {
  const W = 20,
    H = 20;
  const mask = ellipseMask(-10, -10, 20, 20, W, H);
  assert.equal(mask.length, W * H);
  assert.equal(mask[0], 1);
  assert.equal(mask[9 * W + 9], 0);
  assert.equal(mask[19 * W + 19], 0);
  assert.equal(ellipseMask(30, 30, 10, 10, W, H).some(Boolean), false);
});

test('ellipseMask accepts a negative width and height', () => {
  const W = 30,
    H = 30;
  assert.deepEqual(ellipseMask(25, 25, -20, -20, W, H), ellipseMask(5, 5, 20, 20, W, H));
  assert.equal(ellipseMask(5, 5, 0, 10, W, H).some(Boolean), false);
});

test('ellipseSelect is registered right after rectSelect', () => {
  const ids = Object.keys(TOOLS);
  assert.equal(ids[ids.indexOf('rectSelect') + 1], 'ellipseSelect');
  assert.ok(TOOL_OPTION_SCHEMA.ellipseSelect);
  const schemaIds = Object.keys(TOOL_OPTION_SCHEMA);
  assert.equal(schemaIds[schemaIds.indexOf('rectSelect') + 1], 'ellipseSelect');
});

function fakeCtx(W, H) {
  const noop = () => {};
  return {
    canvas: { width: W, height: H },
    clearRect: noop,
    beginPath: noop,
    ellipse: noop,
    stroke: noop,
    setLineDash: noop
  };
}

function toolState(W, H, extra = {}) {
  const state = {
    sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0, mask: null },
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    selectionModeFor: (s) =>
      s.shiftKey || s.ctrlKey ? (s.altKey ? 'intersect' : 'add') : s.altKey ? 'subtract' : null,
    tryBeginMove: () => false,
    // The real commitSelection mutates state.sel in place.
    commitSelection: () => {
      state.sel.mode = 'none';
      state.sel.mask = null;
    },
    constrainSquare: (x0, y0, x1, y1) => {
      const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      return { x: x0 + Math.sign(x1 - x0 || 1) * s, y: y0 + Math.sign(y1 - y0 || 1) * s };
    },
    ...extra
  };
  state.applySelectionWithMask = (mask, w, h, mode) => {
    state.applied = { mask, mode };
    state.sel = { mode: 'active', mask };
  };
  return state;
}

function drag(state, W, H, from, to) {
  const ctx = fakeCtx(W, H);
  const tool = TOOLS.ellipseSelect;
  tool.onDown(ctx, ctx, state, ...from);
  tool.onMove(ctx, ctx, state, ...to);
  tool.onUp(ctx, ctx, state, ...to);
}

test('ellipseSelect drag selects an ellipse; Shift makes it a circle', () => {
  const W = 50,
    H = 50;
  const plain = toolState(W, H);
  drag(plain, W, H, [0, 0], [40, 20]);
  assert.equal(plain.sel.mode, 'active');
  assert.deepEqual(plain.applied.mask, ellipseMask(0, 0, 40, 20, W, H));
  assert.equal(plain.applied.mode, null);

  const circle = toolState(W, H, { shiftKey: true });
  drag(circle, W, H, [0, 0], [40, 20]);
  assert.deepEqual(circle.applied.mask, ellipseMask(0, 0, 40, 40, W, H));
});

test('ellipseSelect passes modifiers through and moves without one', () => {
  const W = 50,
    H = 50;
  const sub = toolState(W, H, { altKey: true });
  drag(sub, W, H, [0, 0], [20, 20]);
  assert.equal(sub.applied.mode, 'subtract');

  let moved = false;
  const move = toolState(W, H, {
    tryBeginMove: () => {
      moved = true;
      return true;
    }
  });
  drag(move, W, H, [5, 5], [20, 20]);
  assert.equal(moved, true);
  assert.equal(move.applied, undefined);
});
