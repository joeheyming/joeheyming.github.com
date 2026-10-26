import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  TOOLS,
  TOOL_OPTION_SCHEMA,
  autoSelectLayerAt,
  defaultToolOptions
} from '../paint/tools.js';
import { renderToolOptions } from '../paint/ui.js';

function withDocument(fn) {
  const { window } = new JSDOM('<!doctype html><div id="opts"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  try {
    return fn(window.document.getElementById('opts'));
  } finally {
    globalThis.document = prev;
  }
}

// A fake layer: alpha is a W * H array of per-pixel alpha.
function layer(W, H, alpha, extra = {}) {
  return {
    kind: 'pixel',
    visible: true,
    canvas: { width: W, height: H },
    ctx: {
      getImageData: (x, y) => ({ data: [0, 0, 0, alpha[y * W + x]] })
    },
    mask: null,
    maskEnabled: true,
    ...extra
  };
}

test('no tool option schema has a hint entry', () => {
  for (const [tool, opts] of Object.entries(TOOL_OPTION_SCHEMA)) {
    assert.ok(!opts.some((o) => o.type === 'hint'), tool);
  }
});

test('the Move schema is Auto-Select and Show Transform Controls, with no hint', () => {
  // The align buttons and their menu follow the checkboxes (paint-arrange-align.test.mjs).
  const schema = TOOL_OPTION_SCHEMA.select.filter((o) => o.type === 'checkbox');
  assert.ok(!schema.some((o) => o.type === 'hint'));
  assert.doesNotMatch(JSON.stringify(schema), /Drag to move/i);
  assert.deepEqual(
    schema.map((o) => [o.key, o.type, o.label, o.default]),
    [
      ['autoSelect', 'checkbox', 'Auto-Select', false],
      ['showTransform', 'checkbox', 'Show Transform Controls', true]
    ]
  );
  assert.deepEqual(defaultToolOptions().select, { autoSelect: false, showTransform: true });
});

test('a jsdom render of the Move options is two checkboxes and no Drag text', () => {
  withDocument((container) => {
    renderToolOptions(TOOL_OPTION_SCHEMA.select, defaultToolOptions().select, container, () => {});
    const boxes = container.querySelectorAll('input[type=checkbox]');
    assert.deepEqual(
      [...boxes].map((b) => [b.id, b.checked]),
      [
        ['opt-autoSelect', false],
        ['opt-showTransform', true]
      ]
    );
    assert.match(container.textContent, /Auto-Select/);
    assert.match(container.textContent, /Show Transform Controls/);
    assert.doesNotMatch(container.textContent, /Drag/);
  });
});

test('Brush, Pencil, and Eraser keep their controls and carry no hint', () => {
  for (const tool of ['brush', 'pencil', 'eraser']) {
    const schema = TOOL_OPTION_SCHEMA[tool];
    assert.ok(!schema.some((o) => o.type === 'hint'), tool);
    assert.ok(
      schema.some((o) => o.key === 'size'),
      tool
    );
    withDocument((container) => {
      renderToolOptions(schema, defaultToolOptions()[tool], container, () => {});
      assert.ok(container.querySelector('#opt-size'), tool);
      assert.equal(container.querySelector('.tool-opt-hint'), null, tool);
    });
  }
  const brushKeys = TOOL_OPTION_SCHEMA.brush.map((o) => o.key);
  for (const key of ['size', 'opacity', 'flow']) assert.ok(brushKeys.includes(key), key);
});

test('renderToolOptions ignores a hint option it is passed', () => {
  withDocument((container) => {
    const schema = [
      { key: '_hint', type: 'hint', text: 'Drag to do a thing', title: 'help' },
      { key: 'on', type: 'checkbox', label: 'On', default: true }
    ];
    renderToolOptions(schema, {}, container, () => {});
    assert.equal(container.children.length, 1);
    assert.equal(container.querySelector('.tool-opt-hint'), null);
    assert.doesNotMatch(container.textContent, /Drag/);
  });
});

test('autoSelectLayerAt picks the topmost visible pixel layer with alpha under the point', () => {
  const bottom = layer(2, 1, [255, 255]);
  const top = layer(2, 1, [0, 200]);
  const layers = [bottom, top];
  assert.equal(autoSelectLayerAt(layers, 1.6, 0.2), 1);
  assert.equal(autoSelectLayerAt(layers, 0, 0), 0);
  assert.equal(autoSelectLayerAt(layers, 5, 0), -1);
  top.visible = false;
  assert.equal(autoSelectLayerAt(layers, 1, 0), 0);
  top.visible = true;
  top.mask = new Uint8Array([255, 0]);
  assert.equal(autoSelectLayerAt(layers, 1, 0), 0, 'a mask hiding the pixel is a miss');
  top.maskEnabled = false;
  assert.equal(autoSelectLayerAt(layers, 1, 0), 1, 'a disabled mask hides nothing');
  const adj = layer(2, 1, [255, 255], { kind: 'adjustment' });
  assert.equal(autoSelectLayerAt([bottom, adj], 0, 0), 0, 'adjustment layers are skipped');
});

function moveState(autoSelect) {
  const calls = [];
  const state = {
    layers: [layer(2, 1, [255, 255]), layer(2, 1, [0, 255])],
    activeLayerIdx: 0,
    toolOptions: { select: { autoSelect, showTransform: true } },
    setActiveLayer(idx) {
      calls.push(['active', idx]);
      state.activeLayerIdx = idx;
    },
    beginObjectSelect(x, y) {
      calls.push(['begin', x, y, state.activeLayerIdx]);
    }
  };
  return { state, calls };
}

test('Move with Auto-Select on makes the hit layer active before the move', () => {
  const { state, calls } = moveState(true);
  TOOLS.select.onDown(null, null, state, 1, 0);
  assert.deepEqual(calls, [
    ['active', 1],
    ['begin', 1, 0, 1]
  ]);
});

test('Move with Auto-Select off stays on the active layer', () => {
  const { state, calls } = moveState(false);
  TOOLS.select.onDown(null, null, state, 1, 0);
  assert.deepEqual(calls, [['begin', 1, 0, 0]]);
});

test('Auto-Select on a transparent point or the active layer keeps the active layer', () => {
  const { state, calls } = moveState(true);
  state.activeLayerIdx = 1;
  TOOLS.select.onDown(null, null, state, 1, 0);
  assert.deepEqual(calls, [['begin', 1, 0, 1]]);
});
