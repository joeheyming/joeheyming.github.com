import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TOOLS, TOOL_OPTION_SCHEMA } from '../paint/tools.js';
import { applySelectionWithMask, selectionModeFor } from '../paint/selection.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';

const W = 20;
const H = 10;

function marqueeState(mods = {}) {
  const calls = { crop: 0, apply: [] };
  const state = {
    sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0, data: null, mask: null, baseData: null },
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
    selectionModeFor,
    commitSelection() {},
    tryBeginMove: () => false,
    cropToSelection() {
      calls.crop++;
    },
    applySelectionWithMask(mask, w, h, mode) {
      calls.apply.push({ mask, w, h, mode });
      applySelectionWithMask(state, mask, w, h, mode);
    }
  };
  return { state, calls };
}

function drag(state) {
  const ctx = { canvas: { width: W, height: H } };
  TOOLS.rectSelect.onDown(ctx, null, state, 2, 2);
  TOOLS.rectSelect.onMove(ctx, null, state, 8, 6);
  TOOLS.rectSelect.onUp(ctx, null, state);
}

test('rectSelect.onUp does not reference cropToSelection', () => {
  assert.doesNotMatch(TOOLS.rectSelect.onUp.toString(), /cropToSelection/);
  assert.doesNotMatch(TOOLS.rectSelect.onDown.toString(), /cropToSelection/);
});

test('a plain marquee selects the box and does not crop', () => {
  const { state, calls } = marqueeState();
  drag(state);
  assert.equal(calls.crop, 0);
  assert.equal(state.sel.mode, 'active');
  assert.deepEqual([state.sel.x, state.sel.y, state.sel.w, state.sel.h], [2, 2, 6, 4]);
});

test('Ctrl/Cmd during a marquee does not crop; modifiers still combine', () => {
  for (const [mods, mode] of [
    [{ ctrlKey: true }, 'add'],
    [{ shiftKey: true }, 'add'],
    [{ altKey: true }, 'subtract'],
    [{ shiftKey: true, altKey: true }, 'intersect']
  ]) {
    const { state, calls } = marqueeState(mods);
    drag(state);
    assert.equal(calls.crop, 0, JSON.stringify(mods));
    assert.equal(calls.apply.length, 1);
    assert.equal(calls.apply[0].mode, mode);
    const m = calls.apply[0].mask;
    assert.equal(m[3 * W + 4], 1);
    assert.equal(m[0], 0);
    assert.equal(
      m.reduce((a, b) => a + b, 0),
      24
    );
  }
});

test('the marquee options carry no hint text', () => {
  assert.ok(!TOOL_OPTION_SCHEMA.rectSelect.some((f) => f.type === 'hint'));
});

test('the Crop command still crops to the selection', () => {
  const paint = readFileSync(new URL('../paint/paint.js', import.meta.url), 'utf8');
  const crop = COMMANDS_BY_ID.get('image.crop');
  assert.deepEqual([crop.menu, crop.label, crop.attrs.id], [['Image'], 'Crop', 'btn-crop']);
  const calls = [];
  crop.run({ cropToSelection: () => calls.push('crop') });
  assert.deepEqual(calls, ['crop']);
  assert.match(paint, /\n {4}cropToSelection,\n/);
  assert.match(paint, /function cropToSelection\(\)[\s\S]*?pushUndo\('Crop'\)/);
});
