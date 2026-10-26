import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_UNDO,
  captureHistoryEntry,
  createHistoryController,
  stepHistoryStacks
} from '../paint/document-history.js';

function makeDoc(layers, extras = {}) {
  return {
    layers,
    activeLayerIdx: layers.length - 1,
    docMode: 'rgb',
    colorTable: null,
    objects: [],
    selectedObjectIds: [],
    selectedObjectId: null,
    channels: [],
    paths: { work: null, saved: [], target: null },
    guides: [],
    quickMask: null,
    undoStack: [],
    redoStack: [],
    ...extras
  };
}

function layer(id, pixels) {
  return { id, name: `L${id}`, pixels: pixels.slice() };
}

test('captureHistoryEntry records a stack snapshot and document side fields', () => {
  const doc = makeDoc([layer(1, [1]), layer(2, [2])], {
    channels: [{ name: 'Alpha 1' }],
    guides: [{ orient: 'h', pos: 10 }]
  });
  const entry = captureHistoryEntry(doc, {
    label: 'New Layer',
    stack: true,
    snapshotStack: (layers, idx) => ({
      activeIdx: idx,
      layers: layers.map((l) => ({ id: l.id, pixels: l.pixels.slice() }))
    }),
    layerSnapshot: () => {
      throw new Error('layerSnapshot should not run for stack entries');
    },
    cloneObjects: (o) => o.slice()
  });
  assert.equal(entry.label, 'New Layer');
  assert.equal(entry.docMode, 'rgb');
  assert.deepEqual(entry.channels, [{ name: 'Alpha 1' }]);
  assert.deepEqual(entry.guides, [{ orient: 'h', pos: 10 }]);
  assert.equal(entry.stack.activeIdx, 1);
  assert.deepEqual(
    entry.stack.layers.map((l) => l.id),
    [1, 2]
  );
});

test('captureHistoryEntry returns null when the layer id is missing', () => {
  const doc = makeDoc([layer(1, [9])]);
  const entry = captureHistoryEntry(doc, {
    label: 'Draw',
    stack: false,
    layerId: 99,
    snapshotStack: () => null,
    layerSnapshot: (l) => ({ data: l.pixels.slice() }),
    cloneObjects: (o) => o.slice()
  });
  assert.equal(entry, null);
});

test('stepHistoryStacks swaps the live stack for the entry and pushes a back-capture', () => {
  const doc = makeDoc([layer(1, [1]), layer(2, [2])]);
  const snap = (layers, idx) => ({
    activeIdx: idx,
    layers: layers.map((l) => ({ id: l.id, pixels: l.pixels.slice() }))
  });
  const ports = {
    snapshotStack: snap,
    layerSnapshot: (l) => ({ data: l.pixels.slice() }),
    restoreLayerSnapshot: () => {
      throw new Error('single-layer restore unused');
    },
    remountStack: (s) => {
      doc.layers = s.layers.map((r) => layer(r.id, r.pixels));
      doc.activeLayerIdx = s.activeIdx;
    },
    cloneObjects: (o) => o.slice(),
    applyDocMode: () => {}
  };
  const from = [
    captureHistoryEntry(doc, {
      label: 'New Layer',
      stack: true,
      snapshotStack: snap,
      layerSnapshot: ports.layerSnapshot,
      cloneObjects: ports.cloneObjects
    })
  ];
  // Live doc has three layers; undo restores the two-layer snapshot.
  doc.layers = [layer(1, [1]), layer(2, [2]), layer(3, [3])];
  doc.activeLayerIdx = 2;
  const to = [];
  assert.equal(stepHistoryStacks(from, to, doc, ports), true);
  assert.equal(from.length, 0);
  assert.equal(to.length, 1);
  assert.equal(to[0].label, 'New Layer');
  assert.deepEqual(
    doc.layers.map((l) => l.id),
    [1, 2]
  );
  assert.equal(doc.activeLayerIdx, 1);
});

test('createHistoryController pushUndo / undo / redo round-trips through ports', () => {
  const doc = makeDoc([layer(1, [0])]);
  const events = [];
  const snap = (layers, idx) => ({
    activeIdx: idx,
    layers: layers.map((l) => ({ id: l.id, pixels: l.pixels.slice() }))
  });
  const history = createHistoryController({
    getDoc: () => doc,
    activeLayerId: () => doc.layers[doc.activeLayerIdx].id,
    commitOpenSessions: () => events.push('commit'),
    layerSnapshot: (l) => ({ data: l.pixels.slice() }),
    restoreLayerSnapshot: (layer, entry) => {
      layer.pixels = entry.data.slice();
    },
    remountStack: (s) => {
      doc.layers = s.layers.map((r) => layer(r.id, r.pixels));
      doc.activeLayerIdx = s.activeIdx;
    },
    cloneObjects: (o) => o.slice(),
    snapshotStack: snap,
    isStackUndoLabel: (label) => label === 'New Layer',
    applyDocMode: () => {},
    noteFadeStep: (label) => events.push(`fade:${label}`),
    onPushed: () => events.push('pushed'),
    onStepped: () => events.push('stepped')
  });

  history.pushUndo('Draw');
  doc.layers[0].pixels = [7];
  history.pushUndo('New Layer');
  doc.layers = [layer(1, [7]), layer(2, [2])];
  doc.activeLayerIdx = 1;

  assert.equal(doc.undoStack.length, 2);
  assert.deepEqual(events, ['commit', 'fade:Draw', 'pushed', 'commit', 'fade:New Layer', 'pushed']);

  history.undo();
  assert.deepEqual(
    doc.layers.map((l) => l.pixels),
    [[7]]
  );
  assert.equal(doc.redoStack.length, 1);
  assert.ok(events.includes('stepped'));

  history.redo();
  assert.deepEqual(
    doc.layers.map((l) => l.id),
    [1, 2]
  );
});

test('MAX_UNDO caps the undo stack', () => {
  assert.equal(MAX_UNDO, 50);
  const doc = makeDoc([layer(1, [0])]);
  const history = createHistoryController({
    getDoc: () => doc,
    activeLayerId: () => 1,
    layerSnapshot: (l) => ({ data: l.pixels.slice() }),
    restoreLayerSnapshot: () => {},
    remountStack: () => {},
    cloneObjects: (o) => o.slice(),
    snapshotStack: () => ({ layers: [], activeIdx: 0 }),
    isStackUndoLabel: () => false,
    applyDocMode: () => {},
    maxUndo: 3
  });
  for (let i = 0; i < 5; i++) {
    doc.layers[0].pixels = [i];
    history.pushUndo(`Draw ${i}`);
  }
  assert.equal(doc.undoStack.length, 3);
  assert.deepEqual(
    doc.undoStack.map((e) => e.label),
    ['Draw 2', 'Draw 3', 'Draw 4']
  );
});
