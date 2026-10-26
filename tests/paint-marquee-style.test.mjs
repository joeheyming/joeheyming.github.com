import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions, marqueeRect } from '../paint/tools.js';
import { ICONS } from '../paint/icons.js';
import { renderToolOptions } from '../paint/ui.js';

const MARQUEES = ['rectSelect', 'ellipseSelect'];

test('both marquees list Style, Width, swap, Height after the selection mode', () => {
  for (const tool of MARQUEES) {
    // Feather and Anti-alias (US-126) sit between the mode and Style.
    const schema = TOOL_OPTION_SCHEMA[tool].filter(
      (o) => o.key !== 'feather' && o.key !== 'antiAlias'
    );
    const keys = schema.map((o) => o.key);
    assert.deepEqual(
      keys.slice(0, 5),
      ['selectionMode', 'marqueeStyle', 'marqueeWidth', '_marqueeSwap', 'marqueeHeight'],
      tool
    );
    const [, style, width, swap, height] = schema;
    assert.equal(style.type, 'select');
    assert.equal(style.label, 'Style');
    assert.equal(style.default, 'normal');
    assert.deepEqual(
      style.options.map((o) => [o.value, o.label]),
      [
        ['normal', 'Normal'],
        ['fixedRatio', 'Fixed Ratio'],
        ['fixedSize', 'Fixed Size']
      ]
    );
    assert.deepEqual(style.onSelect('fixedSize'), { marqueeWidth: 64, marqueeHeight: 64 });
    assert.deepEqual(style.onSelect('fixedRatio'), { marqueeWidth: 1, marqueeHeight: 1 });
    assert.deepEqual(style.onSelect('normal'), { marqueeWidth: 1, marqueeHeight: 1 });
    for (const f of [width, height]) {
      assert.equal(f.type, 'number');
      assert.equal(f.default, 1);
    }
    assert.equal(swap.type, 'iconAction');
    assert.equal(swap.icon, 'arrow-left-right');
    assert.ok(ICONS[swap.icon]);
    assert.equal(swap.title, 'Swaps height and width');
    assert.deepEqual(swap.patch({ marqueeWidth: 3, marqueeHeight: 7 }), {
      marqueeWidth: 7,
      marqueeHeight: 3
    });
    const defaults = defaultToolOptions()[tool];
    assert.equal(defaults.marqueeStyle, 'normal');
    assert.equal(defaults.marqueeWidth, 1);
    assert.equal(defaults.marqueeHeight, 1);
    assert.equal('_marqueeSwap' in defaults, false);
  }
});

// Start at (50, 50); each direction drags +-30 in x and +-10 in y.
const DIRS = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1]
];

test('marqueeRect Normal is the dragged box in every direction', () => {
  for (const [sx, sy] of DIRS) {
    const r = marqueeRect('normal', 1, 1, 50, 50, 50 + sx * 30, 50 + sy * 10);
    assert.deepEqual(r, { x: sx < 0 ? 20 : 50, y: sy < 0 ? 40 : 50, w: 30, h: 10 });
  }
});

test('marqueeRect Fixed Ratio follows the larger extent in the drag direction', () => {
  for (const [sx, sy] of DIRS) {
    // 2:1 ratio, drag 30 x 10: x wins (k = 15), so the box is 30 x 15.
    const r = marqueeRect('fixedRatio', 2, 1, 50, 50, 50 + sx * 30, 50 + sy * 10);
    assert.deepEqual(r, { x: sx < 0 ? 20 : 50, y: sy < 0 ? 35 : 50, w: 30, h: 15 }, `${sx},${sy}`);
    // 1:2 ratio, drag 30 x 10: x still wins (k = 30), so the box is 30 x 60.
    const t = marqueeRect('fixedRatio', 1, 2, 50, 50, 50 + sx * 30, 50 + sy * 10);
    assert.deepEqual(t, { x: sx < 0 ? 20 : 50, y: sy < 0 ? -10 : 50, w: 30, h: 60 });
    // 4:1 ratio, drag 30 x 10: y wins (k = 10), so the box is 40 x 10.
    const u = marqueeRect('fixedRatio', 4, 1, 50, 50, 50 + sx * 30, 50 + sy * 10);
    assert.deepEqual(u, { x: sx < 0 ? 10 : 50, y: sy < 0 ? 40 : 50, w: 40, h: 10 });
  }
});

test('marqueeRect Fixed Size is anchored at the start whatever the drag', () => {
  for (const [sx, sy] of DIRS) {
    const r = marqueeRect('fixedSize', 64, 32, 50, 50, 50 + sx * 30, 50 + sy * 10);
    assert.deepEqual(r, { x: 50, y: 50, w: 64, h: 32 });
  }
  assert.deepEqual(marqueeRect('fixedSize', 0, 2.6, 5, 6, 5, 6), { x: 5, y: 6, w: 1, h: 3 });
});

const W = 100;
const H = 100;
const ctx = { canvas: { width: W, height: H } };

function overlayStub() {
  const noop = () => {};
  return {
    canvas: ctx.canvas,
    clearRect: noop,
    setLineDash: noop,
    beginPath: noop,
    ellipse: noop,
    stroke: noop
  };
}

function marqueeState(tool, opts, shiftKey = false) {
  const applied = [];
  const state = {
    sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0, data: null, mask: null, baseData: null },
    shiftKey,
    ctrlKey: false,
    altKey: false,
    selectionMode: 'new',
    toolOptions: { [tool]: { ...defaultToolOptions()[tool], ...opts } },
    constrainSquare: (x0, y0, x1, y1) => {
      const m = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      return { x: x0 + Math.sign(x1 - x0) * m, y: y0 + Math.sign(y1 - y0) * m };
    },
    commitSelection() {},
    tryBeginMove: () => false,
    applySelectionWithMask(mask, w, h, mode) {
      applied.push(mask.reduce((a, b) => a + b, 0));
      state.sel.mode = 'active';
      void mode;
    }
  };
  return { state, applied };
}

test('Fixed Size selects on a plain click', () => {
  for (const tool of MARQUEES) {
    const { state } = marqueeState(tool, {
      marqueeStyle: 'fixedSize',
      marqueeWidth: 10,
      marqueeHeight: 6
    });
    TOOLS[tool].onDown(ctx, overlayStub(), state, 20, 30);
    TOOLS[tool].onUp(ctx, overlayStub(), state);
    assert.equal(state.sel.mode, 'active', tool);
    assert.deepEqual([state.sel.x, state.sel.y, state.sel.w, state.sel.h], [20, 30, 10, 6]);
  }
});

test('a Normal click still deselects', () => {
  for (const tool of MARQUEES) {
    const { state } = marqueeState(tool, {});
    TOOLS[tool].onDown(ctx, overlayStub(), state, 20, 30);
    TOOLS[tool].onUp(ctx, overlayStub(), state);
    assert.equal(state.sel.mode, 'none', tool);
  }
});

test('Shift squares the box only in Normal', () => {
  for (const tool of MARQUEES) {
    const normal = marqueeState(tool, {}, true).state;
    TOOLS[tool].onDown(ctx, overlayStub(), normal, 10, 10);
    TOOLS[tool].onMove(ctx, overlayStub(), normal, 40, 20);
    assert.deepEqual([normal.sel.w, normal.sel.h], [30, 30], tool);

    const ratio = marqueeState(tool, { marqueeStyle: 'fixedRatio', marqueeWidth: 3 }, true).state;
    TOOLS[tool].onDown(ctx, overlayStub(), ratio, 10, 10);
    TOOLS[tool].onMove(ctx, overlayStub(), ratio, 40, 20);
    assert.deepEqual([ratio.sel.w, ratio.sel.h], [30, 10], tool);
  }
});

function withDocument(fn) {
  const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    fn(window, window.document.getElementById('opts'));
  } finally {
    globalThis.document = prev;
  }
}

test('renderToolOptions builds Style, then Width and Height, disabled in Normal', () => {
  withDocument((window, container) => {
    const values = { ...defaultToolOptions().rectSelect };
    const onChange = (k, v) => (values[k] = v);
    renderToolOptions(TOOL_OPTION_SCHEMA.rectSelect, values, container, onChange);
    const ids = Array.from(container.querySelectorAll('[id^="opt-"]')).map((el) => el.id);
    const at = (id) => ids.indexOf(id);
    assert.ok(at('opt-marqueeStyle') >= 0, '#opt-marqueeStyle missing');
    assert.ok(at('opt-marqueeStyle') < at('opt-marqueeWidth'));
    assert.ok(at('opt-marqueeWidth') < at('opt-_marqueeSwap'));
    assert.ok(at('opt-_marqueeSwap') < at('opt-marqueeHeight'));
    const q = (id) => container.querySelector('#' + id);
    assert.equal(q('opt-marqueeStyle').tagName, 'SELECT');
    assert.equal(q('opt-marqueeWidth').type, 'number');
    assert.equal(q('opt-marqueeWidth').disabled, true);
    assert.equal(q('opt-marqueeHeight').disabled, true);
    assert.equal(q('opt-_marqueeSwap').disabled, true);
    assert.ok(q('opt-_marqueeSwap').querySelector('svg'));

    const style = q('opt-marqueeStyle');
    style.value = 'fixedSize';
    style.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(values.marqueeStyle, 'fixedSize');
    assert.equal(values.marqueeWidth, 64);
    assert.equal(values.marqueeHeight, 64);
    assert.equal(q('opt-marqueeWidth').disabled, false);
    assert.equal(q('opt-marqueeWidth').value, '64');
    assert.equal(q('opt-marqueeStyle').value, 'fixedSize');

    const width = q('opt-marqueeWidth');
    width.value = '20';
    width.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(values.marqueeWidth, 20);

    q('opt-_marqueeSwap').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(values.marqueeWidth, 64);
    assert.equal(values.marqueeHeight, 20);
    assert.equal(q('opt-marqueeHeight').value, '20');

    q('opt-marqueeStyle').value = 'normal';
    q('opt-marqueeStyle').dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.deepEqual([values.marqueeWidth, values.marqueeHeight], [1, 1]);
    assert.equal(q('opt-marqueeHeight').disabled, true);
  });
});
