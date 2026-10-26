import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  edgeMap,
  liveWire,
  magneticSpacing,
  quickSelectDab,
  snapToEdge
} from '../paint/smart-select.js';
import { TOOLS, TOOL_GROUPS, TOOL_OPTION_SCHEMA, toolForKey } from '../paint/tools.js';
import { ICONS } from '../paint/icons.js';

const W = 32,
  H = 24;

// Left half (x < 16) red, right half blue.
function twoColor() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data.set(x < 16 ? [220, 30, 30, 255] : [30, 40, 210, 255], i);
    }
  }
  return { width: W, height: H, data };
}

function leftHalf() {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < 16; x++) m[y * W + x] = 1;
  return m;
}

// A canvas-context stand-in: getImageData over the fixture.
function fakeCtx(img) {
  return {
    canvas: { width: img.width, height: img.height },
    getImageData: () => ({ width: img.width, height: img.height, data: img.data.slice() })
  };
}

function fakeOverlay() {
  const noop = () => {};
  return {
    canvas: { width: W, height: H },
    clearRect: noop,
    setLineDash: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fillRect: noop
  };
}

// The tool state the selection tools read, recording applySelectionWithMask calls.
function toolState(opts = {}) {
  const calls = [];
  const state = {
    sel: { mode: 'none' },
    selectionMode: 'new',
    toolOptions: { quickSelection: { size: 6 }, magneticLasso: {}, ...opts },
    zoom: 1,
    calls,
    applySelectionWithMask(mask, w, h, mode) {
      calls.push({ mask: mask.slice(), mode });
      state.sel.mode = 'active';
    },
    commitSelection() {}
  };
  return state;
}

test('edge map peaks on the colour boundary and is flat inside each region', () => {
  const e = edgeMap(twoColor());
  assert.equal(e[10 * W + 5], 0);
  assert.equal(e[10 * W + 26], 0);
  assert.ok(e[10 * W + 15] > 0.5);
  assert.ok(e[10 * W + 16] > 0.5);
});

test('a Quick Selection dab inside one region selects that region only', () => {
  const img = twoColor();
  const mask = quickSelectDab(img, edgeMap(img), 6, 12, 6);
  assert.deepEqual(mask, leftHalf());
  // Off the canvas the dab selects nothing.
  assert.equal(quickSelectDab(img, edgeMap(img), -20, -20, 6), null);
});

test('the Quick Selection tool selects the region, then Alt subtracts a dab', () => {
  const img = twoColor();
  const ctx = fakeCtx(img);
  const ov = fakeOverlay();
  const state = toolState();
  TOOLS.quickSelection.onDown(ctx, ov, state, 6, 12);
  TOOLS.quickSelection.onUp(ctx, ov, state);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].mode, null);
  assert.deepEqual(state.calls[0].mask, leftHalf());

  // A later plain stroke adds; holding Alt subtracts.
  state.altKey = true;
  TOOLS.quickSelection.onDown(ctx, ov, state, 26, 12);
  TOOLS.quickSelection.onMove(ctx, ov, state, 27, 13);
  TOOLS.quickSelection.onUp(ctx, ov, state);
  assert.equal(state.calls[1].mode, 'subtract');
  assert.equal(state.calls[1].mask[12 * W + 26], 1);
  assert.equal(state.calls[1].mask[12 * W + 5], 0);
  assert.ok(TOOL_OPTION_SCHEMA.quickSelection.some((o) => o.key === 'size'));
});

test('the live wire between two anchors follows the edge', () => {
  const e = edgeMap(twoColor());
  // The straight line from (13, 1) to (18, 22) cuts across the boundary; the wire hugs it.
  const path = liveWire(e, W, H, [13, 1], [18, 22], 10, 0.1);
  assert.deepEqual(path[0], [13.5, 1.5]);
  assert.deepEqual(path[path.length - 1], [18.5, 22.5]);
  for (const [x, y] of path) {
    if (y < 5 || y > 18) continue;
    assert.ok(Math.floor(x) === 15 || Math.floor(x) === 16, `(${x}, ${y}) left the edge`);
  }
  // Anchors snap to the edge inside Width, and stay put when no edge is strong enough.
  assert.ok([15.5, 16.5].includes(snapToEdge(e, W, H, 12, 8, 10, 0.1)[0]));
  assert.deepEqual(snapToEdge(e, W, H, 3, 8, 4, 0.1), [3, 8]);
  // Frequency spaces the automatic fastening points: 8 px at 100, 98 at 0.
  assert.equal(magneticSpacing(100), 8);
  assert.equal(magneticSpacing(0), 98);
});

test('the Magnetic Lasso fastens along the edge and closes into a selection', () => {
  const img = twoColor();
  const ctx = fakeCtx(img);
  const ov = fakeOverlay();
  const state = toolState({ magneticLasso: { frequency: 100 } });
  // The edge from the top to the bottom, then the canvas' right side back to the start.
  TOOLS.magneticLasso.onDown(ctx, ov, state, 15, 0);
  TOOLS.magneticLasso.onMove(ctx, ov, state, 15, 23);
  assert.ok(state.magnetic.anchors.length > 1, 'Frequency fastened points along the way');
  TOOLS.magneticLasso.onDown(ctx, ov, state, 15, 23);
  TOOLS.magneticLasso.onDown(ctx, ov, state, 31, 23);
  TOOLS.magneticLasso.onDown(ctx, ov, state, 31, 0);
  const middle = state.magnetic.path.filter(([x, y]) => x < 24 && y > 3 && y < 20);
  assert.ok(middle.length > 0);
  for (const [x] of middle) assert.ok(Math.floor(x) === 15 || Math.floor(x) === 16);
  TOOLS.magneticLasso.onDown(ctx, ov, state, 15.5, 0.5);
  assert.equal(state.magnetic, null);
  assert.equal(state.drawing, false);
  const { mask, mode } = state.calls[0];
  assert.equal(mode, null);
  assert.equal(mask[12 * W + 24], 1, 'the blue side is selected');
  assert.equal(mask[12 * W + 5], 0, 'the red side is not');
  for (const k of ['width', 'contrast', 'frequency']) {
    assert.ok(TOOL_OPTION_SCHEMA.magneticLasso.some((o) => o.key === k));
  }
});

test('both tools sit in PhotoCraft toolbox groups with their icons', () => {
  assert.deepEqual(TOOL_GROUPS[2], ['lasso', 'polyLasso', 'magneticLasso']);
  assert.deepEqual(TOOL_GROUPS[3], ['quickSelection', 'magicWand']);
  assert.equal(TOOLS.magneticLasso.label, 'Magnetic Lasso');
  assert.equal(TOOLS.quickSelection.label, 'Quick Selection');
  assert.ok(ICONS[TOOLS.magneticLasso.icon]);
  assert.ok(ICONS[TOOLS.quickSelection.icon]);
  assert.equal(toolForKey('L', true, 'polyLasso'), 'magneticLasso');
  assert.equal(toolForKey('W', true, 'quickSelection'), 'magicWand');
});
