import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions, marqueeMask } from '../paint/tools.js';
import { ellipseMask, featherMask, selectionToFullMask } from '../paint/selection.js';
import { renderToolOptions } from '../paint/ui.js';

const MARQUEES = ['rectSelect', 'ellipseSelect'];

test('Feather and Anti-alias sit between the selection mode and Style', () => {
  for (const tool of MARQUEES) {
    const keys = TOOL_OPTION_SCHEMA[tool].map((o) => o.key);
    assert.deepEqual(keys.slice(0, 4), ['selectionMode', 'feather', 'antiAlias', 'marqueeStyle']);
    const [, feather, antiAlias] = TOOL_OPTION_SCHEMA[tool];
    assert.equal(feather.type, 'number');
    assert.equal(feather.label, 'Feather');
    assert.equal(feather.min, 0);
    assert.equal(feather.max, 1000);
    assert.equal(feather.default, 0);
    assert.equal(antiAlias.type, 'checkbox');
    assert.equal(antiAlias.label, 'Anti-alias');
    assert.equal(antiAlias.default, true);
    assert.equal(antiAlias.disabled, tool === 'rectSelect', tool);
    const defaults = defaultToolOptions()[tool];
    assert.equal(defaults.feather, 0);
    assert.equal(defaults.antiAlias, true);
  }
});

const W = 40;
const H = 30;
const BOX = { x: 5, y: 4, w: 20, h: 14 };
const rectMask = (b) => selectionToFullMask({ mode: 'active', ...b }, W, H);

test('marqueeMask with feather 0 is the plain rect / ellipse mask', () => {
  assert.deepEqual(marqueeMask('rect', BOX, W, H, 0), rectMask(BOX));
  assert.deepEqual(
    marqueeMask('ellipse', BOX, W, H, 0),
    ellipseMask(BOX.x, BOX.y, BOX.w, BOX.h, W, H)
  );
});

test('marqueeMask with feather > 0 is featherMask of the plain mask', () => {
  const rect = rectMask(BOX);
  const ell = ellipseMask(BOX.x, BOX.y, BOX.w, BOX.h, W, H);
  assert.deepEqual(marqueeMask('rect', BOX, W, H, 3), featherMask(rect, W, H, 3));
  assert.deepEqual(marqueeMask('ellipse', BOX, W, H, 3), featherMask(ell, W, H, 3));
  assert.notDeepEqual(marqueeMask('ellipse', BOX, W, H, 3), ell);
});

test('marqueeMask clips a box that runs off the canvas', () => {
  const m = marqueeMask('rect', { x: -5, y: -5, w: 10, h: 10 }, W, H, 0);
  assert.equal(
    m.reduce((a, b) => a + b, 0),
    25
  );
});

const ctx = { canvas: { width: W, height: H } };
const ov = {
  canvas: ctx.canvas,
  clearRect() {},
  setLineDash() {},
  beginPath() {},
  ellipse() {},
  stroke() {}
};

function marqueeState(tool, opts) {
  const calls = [];
  const state = {
    sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0, data: null, mask: null, baseData: null },
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    selectionMode: 'new',
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

test('a feathered New marquee commits the feathered mask', () => {
  for (const [tool, shape] of [
    ['rectSelect', 'rect'],
    ['ellipseSelect', 'ellipse']
  ]) {
    const { state, calls } = marqueeState(tool, { feather: 2 });
    TOOLS[tool].onDown(ctx, ov, state, BOX.x, BOX.y);
    TOOLS[tool].onMove(ctx, ov, state, BOX.x + BOX.w, BOX.y + BOX.h);
    TOOLS[tool].onUp(ctx, ov, state);
    assert.equal(calls.length, 1, tool);
    assert.equal(calls[0].mode, null, tool);
    assert.deepEqual(state.sel.mask, marqueeMask(shape, BOX, W, H, 2), tool);
  }
});

test('an unfeathered New rect marquee commits the plain box mask', () => {
  const { state, calls } = marqueeState('rectSelect', {});
  TOOLS.rectSelect.onDown(ctx, ov, state, BOX.x, BOX.y);
  TOOLS.rectSelect.onMove(ctx, ov, state, BOX.x + BOX.w, BOX.y + BOX.h);
  TOOLS.rectSelect.onUp(ctx, ov, state);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, null);
  assert.deepEqual(state.sel.mask, marqueeMask('rect', BOX, W, H, 0));
  assert.equal(state.sel.mode, 'active');
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

test('renderToolOptions builds Feather and Anti-alias before Style', () => {
  for (const tool of MARQUEES) {
    withDocument((container) => {
      const values = { ...defaultToolOptions()[tool] };
      renderToolOptions(TOOL_OPTION_SCHEMA[tool], values, container, (k, v) => (values[k] = v));
      const ids = Array.from(container.querySelectorAll('[id^="opt-"]')).map((el) => el.id);
      const at = (id) => ids.indexOf(id);
      assert.ok(at('opt-feather') >= 0, '#opt-feather missing');
      assert.ok(at('opt-feather') < at('opt-antiAlias'));
      assert.ok(at('opt-antiAlias') < at('opt-marqueeStyle'));
      const feather = container.querySelector('#opt-feather');
      assert.equal(feather.type, 'number');
      assert.equal(feather.disabled, false);
      const aa = container.querySelector('#opt-antiAlias');
      assert.equal(aa.type, 'checkbox');
      assert.equal(aa.checked, true);
      assert.equal(aa.disabled, tool === 'rectSelect', tool);
    });
  }
});
