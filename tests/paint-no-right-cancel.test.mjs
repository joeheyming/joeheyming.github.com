import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TOOLS } from '../paint/tools.js';
import { createPointerController, ignoresChordedPress } from '../paint/pointer.js';

const src = (f) => readFileSync(new URL(`../paint/${f}`, import.meta.url), 'utf8');

test('the stroke-cancel path is gone', () => {
  const paint = src('paint.js');
  const pointer = src('pointer.js');
  assert.doesNotMatch(paint, /cancelInProgressStroke|cancelStroke/);
  assert.doesNotMatch(pointer, /cancelStroke/);
  assert.doesNotMatch(pointer, /e\.button === 2\)\s*\|\|/);
});

test('ignoresChordedPress drops the other button mid stroke, never cancels', () => {
  for (const tool of ['pencil', 'brush', 'eraser']) {
    assert.equal(ignoresChordedPress({ drawing: true, tool, strokeButton: 0 }, 2), true);
    assert.equal(ignoresChordedPress({ drawing: true, tool, strokeButton: 2 }, 0), true);
    assert.equal(ignoresChordedPress({ drawing: true, tool, strokeButton: 0 }, 0), false);
    assert.equal(ignoresChordedPress({ drawing: false, tool, strokeButton: 0 }, 2), false);
  }
  // Multi-click tools keep drawing between clicks; their clicks still go through.
  assert.equal(
    ignoresChordedPress({ drawing: true, tool: 'polyLasso', strokeButton: 0 }, 2),
    false
  );
});

function harness(tool) {
  const calls = [];
  const saved = {};
  for (const k of ['onDown', 'onMove', 'onUp']) {
    saved[k] = TOOLS[tool][k];
    TOOLS[tool][k] = (_ctx, _ov, state) => {
      calls.push(k);
      if (k === 'onDown') state.drawing = true;
      if (k === 'onUp') state.drawing = false;
    };
  }
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = { getElementById: () => null };
  globalThis.window = {};
  const state = {
    tool,
    drawing: false,
    sel: { mode: 'none' },
    color: '#000000',
    bgColor: '#ffffff',
    undoStack: [],
    toolOptions: {}
  };
  const undo = [];
  const overlayCanvas = {
    width: 100,
    height: 100,
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture() {}
  };
  const pointer = createPointerController({
    state,
    overlayCanvas,
    ov: {},
    activeCtx: () => ({}),
    activeLayer: () => ({}),
    pushUndo: (label) => undo.push(label),
    updateTransform() {},
    refreshLayerPanel() {}
  });
  const restore = () => {
    Object.assign(TOOLS[tool], saved);
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  };
  return { calls, state, undo, pointer, restore };
}

const ev = (button, x = 10, y = 10) => ({
  button,
  clientX: x,
  clientY: y,
  pointerId: 1,
  pointerType: 'mouse',
  preventDefault() {}
});

for (const tool of ['pencil', 'brush', 'eraser']) {
  test(`a secondary press during a ${tool} stroke does not roll it back`, () => {
    const h = harness(tool);
    try {
      h.pointer.onPointerDown(ev(0));
      assert.deepEqual(h.calls, ['onDown']);
      assert.equal(h.undo.length, 1);
      h.pointer.onPointerDown(ev(2, 20, 20));
      assert.equal(h.state.drawing, true, 'stroke still in progress');
      assert.equal(h.state.strokeButton, 0);
      assert.equal(h.undo.length, 1, 'no extra undo step and no undo()');
      h.pointer.onPointerMove(ev(0, 30, 30));
      h.pointer.onPointerUp(ev(0, 30, 30));
      assert.deepEqual(h.calls, ['onDown', 'onMove', 'onUp']);
    } finally {
      h.restore();
    }
  });
}
