import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions, scanlineFill } from '../paint/tools.js';
import { featherMask } from '../paint/selection.js';
import { renderToolOptions } from '../paint/ui.js';

const LASSOS = ['lasso', 'polyLasso'];

test('Feather and Anti-alias follow the selection mode for both lassos', () => {
  for (const tool of LASSOS) {
    const keys = TOOL_OPTION_SCHEMA[tool].map((o) => o.key);
    assert.deepEqual(keys, ['selectionMode', 'feather', 'antiAlias'], tool);
    const [, feather, antiAlias] = TOOL_OPTION_SCHEMA[tool];
    assert.equal(feather.type, 'number');
    assert.equal(feather.label, 'Feather');
    assert.equal(feather.min, 0);
    assert.equal(feather.max, 1000);
    assert.equal(feather.default, 0);
    assert.equal(antiAlias.type, 'checkbox');
    assert.equal(antiAlias.label, 'Anti-alias');
    assert.equal(antiAlias.default, true);
    assert.ok(!antiAlias.disabled, tool);
    const defaults = defaultToolOptions()[tool];
    assert.equal(defaults.feather, 0);
    assert.equal(defaults.antiAlias, true);
  }
});

const W = 40;
const H = 30;
const PATH = [
  [5, 4],
  [30, 6],
  [26, 24],
  [8, 20]
];
const ctx = { canvas: { width: W, height: H } };
const ov = {
  canvas: ctx.canvas,
  clearRect() {},
  setLineDash() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  arc() {},
  fill() {},
  stroke() {}
};

function lassoState(tool, opts) {
  const calls = [];
  const state = {
    sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0, data: null, mask: null, baseData: null },
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    zoom: 1,
    selectionMode: 'new',
    scanlineFill,
    toolOptions: { [tool]: { ...defaultToolOptions()[tool], ...opts } },
    commitSelection() {},
    tryBeginMove: () => false,
    applySelectionWithMask(mask, w, h, mode) {
      calls.push({ mask, mode });
      state.sel = { mode: 'active', mask };
    }
  };
  return { state, calls };
}

function drive(tool, state) {
  const t = TOOLS[tool];
  if (tool === 'lasso') {
    t.onDown(ctx, ov, state, ...PATH[0]);
    for (const p of PATH.slice(1)) t.onMove(ctx, ov, state, ...p);
    t.onUp(ctx, ov, state);
  } else {
    for (const p of PATH) t.onDown(ctx, ov, state, ...p);
    t.close(ctx, ov, state);
  }
}

test('a feathered New lasso commits featherMask of the feather-0 mask', () => {
  for (const tool of LASSOS) {
    const plain = lassoState(tool, { feather: 0 });
    drive(tool, plain.state);
    const base = plain.state.sel.mask;
    assert.ok(base, tool);

    const { state, calls } = lassoState(tool, { feather: 2 });
    drive(tool, state);
    assert.equal(calls.length, 1, tool);
    assert.equal(calls[0].mode, null, tool);
    assert.deepEqual(state.sel.mask, featherMask(base, W, H, 2), tool);
    assert.notDeepEqual(state.sel.mask, base, tool);
  }
});

test('an unfeathered New freehand lasso commits the filled polygon mask', () => {
  const { state, calls } = lassoState('lasso', {});
  drive('lasso', state);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, null);
  assert.equal(state.sel.mode, 'active');
  assert.ok(state.sel.mask);
  assert.equal(state.sel.mask.length, W * H);
});

function withDocument(fn) {
  const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    fn(window.document.getElementById('opts'));
  } finally {
    globalThis.document = prev;
  }
}

test('renderToolOptions builds Feather then an enabled Anti-alias with no hint', () => {
  for (const tool of LASSOS) {
    withDocument((container) => {
      const values = { ...defaultToolOptions()[tool] };
      renderToolOptions(TOOL_OPTION_SCHEMA[tool], values, container, (k, v) => (values[k] = v));
      const feather = container.querySelector('#opt-feather');
      const aa = container.querySelector('#opt-antiAlias');
      assert.ok(feather && aa, tool);
      assert.equal(container.querySelector('.tool-opt-hint'), null, tool);
      const follows = (a, b) => !!(a.compareDocumentPosition(b) & 4);
      assert.ok(follows(feather, aa), tool);
      assert.equal(feather.type, 'number');
      assert.equal(aa.type, 'checkbox');
      assert.equal(aa.checked, true);
      assert.equal(aa.disabled, false, tool);
    });
  }
});
