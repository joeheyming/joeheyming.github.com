import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  addSnapshot,
  deleteCurrentState,
  restoreSnapshot
} from '../paint/history-snapshots.js';
import { renderHistoryPanel } from '../paint/history.js';

const { window } = new JSDOM('<!doctype html><div id="history"></div>');
globalThis.document = window.document;
window.HTMLElement.prototype.scrollIntoView = () => {};

// A stand-in for paint.js: the document is a layer list, an undo entry holds the list it
// replaced, and step() swaps the current list for the entry's (stepHistory / remountStack).
function makeDoc(layers) {
  const doc = { layers, undoStack: [], redoStack: [], snapshots: [] };
  doc.pushUndo = (label) => {
    doc.undoStack.push({ label, stack: [...doc.layers] });
    doc.redoStack = [];
  };
  doc.edit = (label, layers) => {
    doc.pushUndo(label);
    doc.layers = layers;
  };
  doc.step = (from, to) => {
    const entry = from.pop();
    to.push({ label: entry.label, stack: [...doc.layers] });
    doc.layers = [...entry.stack];
  };
  doc.remount = (stack) => {
    doc.layers = [...stack];
  };
  return doc;
}

function render(doc) {
  const box = window.document.getElementById('history');
  renderHistoryPanel(box, doc.undoStack, doc.redoStack, () => {}, () => {}, {
    snapshots: doc.snapshots,
    onSnapshot: (i) => {
      restoreSnapshot(doc.snapshots, i, doc);
      render(doc);
    },
    onDeleteState: () => {
      deleteCurrentState(doc, doc.step);
      render(doc);
    },
    onNewSnapshot: () => {
      doc.snapshots = addSnapshot(doc.snapshots, [...doc.layers]);
      render(doc);
    }
  });
  return box;
}

const click = (box, sel) => box.querySelector(sel).click();

test('delete current state steps back once and clears redo', () => {
  const doc = makeDoc(['Background']);
  doc.edit('New Layer', ['Background', 'Layer 1']);
  doc.edit('New Layer', ['Background', 'Layer 1', 'Layer 2']);
  doc.edit('Fill', ['Background', 'Layer 1', 'Layer 2', 'filled']);
  doc.step(doc.undoStack, doc.redoStack);
  assert.equal(doc.undoStack.length, 2);
  assert.equal(doc.redoStack.length, 1);

  let box = render(doc);
  click(box, '.history-footer button[data-action=delete]');
  assert.equal(doc.undoStack.length, 1);
  assert.equal(doc.redoStack.length, 0);
  assert.deepEqual(doc.layers, ['Background', 'Layer 1']);

  box = window.document.getElementById('history');
  assert.equal(box.querySelectorAll('.history-item').length, 2);
  assert.equal(box.querySelector('.history-item.current').textContent, 'New Layer');
});

test('delete is a no-op once only the opened state is left', () => {
  const doc = makeDoc(['Background']);
  doc.edit('Fill', ['filled']);
  const box = render(doc);
  click(box, '.history-footer button[data-action=delete]');
  assert.equal(doc.undoStack.length, 0);
  assert.deepEqual(doc.layers, ['Background']);
  const del = box.querySelector('.history-footer button[data-action=delete]');
  assert.equal(del.disabled, true);
  assert.equal(deleteCurrentState(doc, doc.step), false);
  assert.equal(doc.undoStack.length, 0);
});

test('snapshot adds Snapshot N above the states', () => {
  const doc = makeDoc(['Background']);
  doc.edit('New Layer', ['Background', 'Layer 1']);
  const box = render(doc);
  click(box, '.history-footer button[data-action=snapshot]');
  click(box, '.history-footer button[data-action=snapshot]');
  assert.deepEqual(
    doc.snapshots.map((s) => s.name),
    ['Snapshot 1', 'Snapshot 2']
  );
  assert.deepEqual(doc.snapshots[0].stack, ['Background', 'Layer 1']);
  // A snapshot is not a history state.
  assert.equal(doc.undoStack.length, 1);
  const rows = [...box.querySelector('.history-list').children];
  assert.deepEqual(
    rows.slice(0, 2).map((r) => r.textContent),
    ['Snapshot 1', 'Snapshot 2']
  );
  assert.ok(rows.slice(2).every((r) => r.classList.contains('history-item')));
});

test('clicking a snapshot row restores its stack as an undoable state', () => {
  const doc = makeDoc(['Background']);
  doc.edit('New Layer', ['Background', 'Layer 1']);
  let box = render(doc);
  click(box, '.history-footer button[data-action=snapshot]');
  doc.edit('Delete Layer', ['Background']);
  doc.edit('Fill', ['filled']);
  box = render(doc);

  click(box, '.history-snapshot');
  assert.deepEqual(doc.layers, ['Background', 'Layer 1']);
  assert.equal(doc.undoStack.length, 4);
  assert.equal(doc.undoStack.at(-1).label, 'Snapshot 1');
  assert.equal(box.querySelector('.history-item.current').textContent, 'Snapshot 1');

  // Undo takes the restore back out.
  doc.step(doc.undoStack, doc.redoStack);
  assert.deepEqual(doc.layers, ['filled']);
});

test('addSnapshot leaves the old list alone and restoreSnapshot ignores a bad index', () => {
  const before = [{ name: 'Snapshot 1', stack: [] }];
  const after = addSnapshot(before, ['x']);
  assert.equal(before.length, 1);
  assert.equal(after[1].name, 'Snapshot 2');
  const calls = [];
  const ok = restoreSnapshot(after, 5, {
    pushUndo: () => calls.push('push'),
    remount: () => calls.push('remount')
  });
  assert.equal(ok, false);
  assert.deepEqual(calls, []);
});
