import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TOOLS, TOOL_OPTION_SCHEMA, singleLinePx, defaultToolOptions } from '../paint/tools.js';
import { ICONS } from '../paint/icons.js';

const LINE_TOOLS = ['singleRowMarquee', 'singleColumnMarquee'];

test('singleLinePx selects the row or column under the point, clamped to the canvas', () => {
  assert.deepEqual(singleLinePx('singleRowMarquee', 3.7, 5.9, 20, 10), [0, 5, 20, 6]);
  assert.deepEqual(singleLinePx('singleColumnMarquee', 3.7, 5.9, 20, 10), [3, 0, 4, 10]);
  // Off-canvas points clamp to the nearest edge line.
  assert.deepEqual(singleLinePx('singleRowMarquee', 0, -4, 20, 10), [0, 0, 20, 1]);
  assert.deepEqual(singleLinePx('singleRowMarquee', 0, 99, 20, 10), [0, 9, 20, 10]);
  assert.deepEqual(singleLinePx('singleColumnMarquee', -0.5, 0, 20, 10), [0, 0, 1, 10]);
  assert.deepEqual(singleLinePx('singleColumnMarquee', 20, 0, 20, 10), [19, 0, 20, 10]);
});

test('singleLinePx is null for a non-finite point, an empty canvas, or another tool', () => {
  assert.equal(singleLinePx('singleRowMarquee', NaN, 2, 20, 10), null);
  assert.equal(singleLinePx('singleColumnMarquee', 2, Infinity, 20, 10), null);
  assert.equal(singleLinePx('singleRowMarquee', 2, 2, 0, 10), null);
  assert.equal(singleLinePx('singleColumnMarquee', 2, 2, 20, 0), null);
  assert.equal(singleLinePx('rectSelect', 2, 2, 20, 10), null);
});

test('the single-line marquees are registered after ellipseSelect with their icons', () => {
  const ids = Object.keys(TOOLS);
  const at = ids.indexOf('ellipseSelect');
  assert.deepEqual(ids.slice(at + 1, at + 3), LINE_TOOLS);
  assert.equal(TOOLS.singleRowMarquee.label, 'Single Row Marquee');
  assert.equal(TOOLS.singleRowMarquee.icon, 'marquee-row');
  assert.equal(TOOLS.singleColumnMarquee.label, 'Single Column Marquee');
  assert.equal(TOOLS.singleColumnMarquee.icon, 'marquee-column');
  assert.ok(ICONS['marquee-row'].includes('M3 8v8'));
  assert.ok(ICONS['marquee-column'].includes('M8 3h8'));
});

test('their options are the selection mode and Feather like rectSelect', () => {
  for (const id of LINE_TOOLS) {
    const fields = TOOL_OPTION_SCHEMA[id].filter((f) => f.type !== 'hint');
    assert.deepEqual(
      fields.map((f) => f.key),
      ['selectionMode', 'feather']
    );
    assert.equal(fields[0], TOOL_OPTION_SCHEMA.rectSelect[0]);
    assert.equal(fields[1], TOOL_OPTION_SCHEMA.rectSelect[1]);
    assert.equal(defaultToolOptions()[id].feather, 0);
  }
});

test('the tools join the selection lists in pointer.js and paint.js', () => {
  const pointer = readFileSync(new URL('../paint/pointer.js', import.meta.url), 'utf8');
  const sets = pointer.match(/const SELECTION_TOOLS = new Set\(\[[\s\S]*?\]\)/);
  const paint = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  const keep = paint.match(/'rectSelect',\s*'ellipseSelect',[\s\S]*?\]\.includes\(id\)/);
  const shortcutKeep = paint.match(/!\[\s*'rectSelect',[\s\S]*?'select'\s*\]\.includes\(\s*toolId/);
  for (const id of LINE_TOOLS) {
    assert.ok(sets[0].includes(`'${id}'`), `SELECTION_TOOLS has ${id}`);
    assert.ok(keep[0].includes(`'${id}'`), `toolbar list has ${id}`);
    assert.ok(shortcutKeep[0].includes(`'${id}'`), `shortcut list has ${id}`);
  }
});

function fakeCtx(W, H) {
  return { canvas: { width: W, height: H } };
}

function toolState(extra = {}) {
  const state = {
    sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0, mask: null },
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    tryBeginMove: () => false,
    commitSelection: () => {
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

function click(id, state, W, H, from, to = from) {
  const ctx = fakeCtx(W, H);
  TOOLS[id].onDown(ctx, ctx, state, ...from);
  TOOLS[id].onMove(ctx, ctx, state, ...to);
  TOOLS[id].onUp(ctx, ctx, state, ...to);
}

test('a New click selects the line under the release point', () => {
  const W = 8,
    H = 6;
  const row = toolState();
  click('singleRowMarquee', row, W, H, [2, 1], [5, 3.5]);
  assert.equal(row.applied.mode, null);
  assert.equal(row.sel.mode, 'active');
  assert.equal(row.applied.mask.length, W * H);
  for (let x = 0; x < W; x++) assert.equal(row.applied.mask[3 * W + x], 1);
  assert.equal(row.drawing, false);

  const col = toolState();
  click('singleColumnMarquee', col, W, H, [6.2, 4]);
  assert.equal(col.applied.mode, null);
  for (let y = 0; y < H; y++) assert.equal(col.applied.mask[y * W + 6], 1);
});

test('Shift adds the line through applySelectionWithMask with a one-pixel mask', () => {
  const W = 8,
    H = 6;
  const state = toolState({ shiftKey: true });
  click('singleColumnMarquee', state, W, H, [2, 2]);
  assert.equal(state.applied.mode, 'add');
  const mask = state.applied.mask;
  assert.equal(mask.length, W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) assert.equal(mask[y * W + x], x === 2 ? 1 : 0, `${x},${y}`);
  }

  const sub = toolState({ selectionMode: 'subtract' });
  click('singleRowMarquee', sub, W, H, [0, 5]);
  assert.equal(sub.applied.mode, 'subtract');
  assert.deepEqual(
    Array.from(sub.applied.mask)
      .map((v, i) => (v ? Math.floor(i / W) : -1))
      .filter((r) => r >= 0),
    Array(W).fill(5)
  );
});

test('a plain click inside an active selection moves it instead', () => {
  let moved = false;
  const state = toolState({
    tryBeginMove: () => {
      moved = true;
      return true;
    }
  });
  const ctx = fakeCtx(8, 6);
  TOOLS.singleRowMarquee.onDown(ctx, ctx, state, 1, 1);
  assert.equal(moved, true);
  assert.equal(state.sel.mode, 'none');
  assert.notEqual(state.drawing, true);
});
