import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';
import { resolveSelectionMode } from '../paint/selection.js';
import { ICONS } from '../paint/icons.js';
import { renderToolOptions } from '../paint/ui.js';

const SELECTION_TOOLS = ['rectSelect', 'ellipseSelect', 'lasso', 'polyLasso', 'magicWand'];

const MODES = [
  ['new', 'square', 'New selection'],
  ['add', 'plus', 'Add to selection (Shift)'],
  ['subtract', 'minus', 'Subtract from selection (Alt)'],
  ['intersect', 'squares-subtract', 'Intersect with selection (Shift+Alt)']
];

const EMOJI = /\p{Extended_Pictographic}/u;
const W = 20;
const H = 10;

test('every selection tool lists the selection mode buttons first', () => {
  for (const tool of SELECTION_TOOLS) {
    const first = TOOL_OPTION_SCHEMA[tool][0];
    assert.equal(first.key, 'selectionMode', tool);
    assert.equal(first.type, 'iconButtons', tool);
    assert.equal(first.default, 'new', tool);
    assert.deepEqual(
      first.options.map((o) => [o.value, o.icon, o.title]),
      MODES,
      tool
    );
    for (const o of first.options) {
      assert.ok(ICONS[o.icon], `${o.icon} missing from ICONS`);
      assert.doesNotMatch(o.title + o.label, EMOJI);
    }
  }
  // The mode is shared on state.selectionMode, so no tool keeps its own copy.
  const defaults = defaultToolOptions();
  for (const tool of SELECTION_TOOLS) assert.equal(defaults[tool].selectionMode, undefined);
});

test('resolveSelectionMode: held modifiers win, otherwise the option applies', () => {
  const none = { shiftKey: false, ctrlKey: false, altKey: false };
  const shift = { ...none, shiftKey: true };
  const ctrl = { ...none, ctrlKey: true };
  const alt = { ...none, altKey: true };
  const shiftAlt = { ...none, shiftKey: true, altKey: true };
  const expected = { new: null, add: 'add', subtract: 'subtract', intersect: 'intersect' };
  for (const [option] of MODES) {
    assert.equal(resolveSelectionMode(option, none), expected[option], option);
    assert.equal(resolveSelectionMode(option, shift), 'add', option);
    assert.equal(resolveSelectionMode(option, ctrl), 'add', option);
    assert.equal(resolveSelectionMode(option, alt), 'subtract', option);
    assert.equal(resolveSelectionMode(option, shiftAlt), 'intersect', option);
  }
  assert.equal(resolveSelectionMode(undefined, none), null);
  assert.equal(resolveSelectionMode('bogus', none), null);
});

function selState(selectionMode) {
  const calls = { apply: [], moves: 0, commits: 0 };
  const state = {
    sel: { mode: 'active', x: 0, y: 0, w: W, h: H, data: null, mask: null, baseData: null },
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    zoom: 1,
    selectionMode,
    scanlineFill: (path, w, h) => new Uint8Array(w * h).fill(1),
    commitSelection() {
      calls.commits++;
    },
    tryBeginMove() {
      calls.moves++;
      return true;
    },
    applySelectionWithMask(mask, w, h, mode) {
      calls.apply.push(mode);
    },
    doMagicWand: () => ({ x: 0, y: 0, w: 1, h: 1, mask: new Uint8Array(W * H) })
  };
  return { state, calls };
}

const ctx = { canvas: { width: W, height: H } };

function drag(tool, state) {
  TOOLS[tool].onDown(ctx, null, state, 2, 2);
  TOOLS[tool].onMove?.(ctx, overlayStub(), state, 8, 6);
  TOOLS[tool].onUp(ctx, overlayStub(), state);
}

function overlayStub() {
  const noop = () => {};
  return {
    canvas: ctx.canvas,
    clearRect: noop,
    setLineDash: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    ellipse: noop,
    stroke: noop,
    arc: noop,
    fill: noop
  };
}

test('a non-new option combines like a modifier and never starts a move', () => {
  for (const tool of ['rectSelect', 'ellipseSelect', 'lasso', 'magicWand']) {
    for (const option of ['add', 'subtract', 'intersect']) {
      const { state, calls } = selState(option);
      if (tool === 'lasso') {
        TOOLS.lasso.onDown(ctx, null, state, 2, 2);
        TOOLS.lasso.onMove(ctx, overlayStub(), state, 8, 2);
        TOOLS.lasso.onMove(ctx, overlayStub(), state, 8, 6);
        TOOLS.lasso.onUp(ctx, overlayStub(), state);
      } else {
        drag(tool, state);
      }
      assert.equal(calls.moves, 0, `${tool} ${option} tried a move`);
      assert.equal(calls.commits, 0, `${tool} ${option} committed`);
      assert.deepEqual(calls.apply, [option], `${tool} ${option}`);
    }
  }
});

test('the New option still moves a selection when clicked inside it', () => {
  for (const tool of ['rectSelect', 'ellipseSelect', 'lasso', 'polyLasso', 'magicWand']) {
    const { state, calls } = selState('new');
    TOOLS[tool].onDown(ctx, overlayStub(), state, 2, 2);
    assert.equal(calls.moves, 1, tool);
  }
});

test('polyLasso takes the option mode for the whole polygon', () => {
  const { state, calls } = selState('subtract');
  const ov = overlayStub();
  TOOLS.polyLasso.onDown(ctx, ov, state, 2, 2);
  TOOLS.polyLasso.onDown(ctx, ov, state, 8, 2);
  TOOLS.polyLasso.onDown(ctx, ov, state, 8, 6);
  assert.equal(calls.moves, 0);
  assert.equal(TOOLS.polyLasso.close(ctx, ov, state), true);
  assert.deepEqual(calls.apply, ['subtract']);
  assert.equal(calls.commits, 0);
});

test('a held modifier wins over the option', () => {
  const { state, calls } = selState('add');
  state.altKey = true;
  drag('rectSelect', state);
  assert.deepEqual(calls.apply, ['subtract']);
});

test('renderToolOptions builds #opt-selectionMode as a radiogroup of four svg buttons', () => {
  const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    const container = window.document.getElementById('opts');
    const calls = [];
    renderToolOptions(TOOL_OPTION_SCHEMA.rectSelect, {}, container, (k, v) => calls.push([k, v]));
    const group = container.querySelector('#opt-selectionMode');
    assert.ok(group, '#opt-selectionMode missing');
    assert.equal(group.getAttribute('role'), 'radiogroup');
    assert.equal(container.querySelector('[role=radiogroup]'), group, 'not the first control');
    const buttons = Array.from(group.querySelectorAll('button'));
    assert.equal(buttons.length, 4);
    buttons.forEach((btn, i) => {
      assert.equal(btn.title, MODES[i][2]);
      assert.ok(btn.querySelector('svg'), `${MODES[i][0]} has no svg`);
      assert.doesNotMatch(btn.textContent, EMOJI);
    });
    const checked = () => buttons.map((b) => b.getAttribute('aria-checked'));
    assert.deepEqual(checked(), ['true', 'false', 'false', 'false']);

    buttons[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(calls, [['selectionMode', 'add']]);
    assert.deepEqual(checked(), ['false', 'true', 'false', 'false']);

    // A shared value passed in (switching tools keeps Add) renders checked.
    renderToolOptions(TOOL_OPTION_SCHEMA.lasso, { selectionMode: 'add' }, container, () => {});
    const lassoButtons = Array.from(container.querySelectorAll('#opt-selectionMode button'));
    assert.deepEqual(
      lassoButtons.map((b) => b.getAttribute('aria-checked')),
      ['false', 'true', 'false', 'false']
    );
  } finally {
    globalThis.document = prev;
  }
});
