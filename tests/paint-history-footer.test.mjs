import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { deleteStatePlan, nextSnapshotName } from '../paint/history-snapshots.js';
import { renderHistoryPanel } from '../paint/history.js';

function withDocument(fn) {
  const { window } = new JSDOM('<!doctype html><div id="history"></div>');
  const prev = globalThis.document;
  globalThis.document = window.document;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  try {
    return fn(window.document);
  } finally {
    globalThis.document = prev;
  }
}

const entries = (...labels) => labels.map((label) => ({ label }));

test('deleteStatePlan steps back once and clears redo', () => {
  assert.deepEqual(deleteStatePlan(3, 0), { undoSteps: 1, clearRedo: true, dropped: 1 });
  assert.deepEqual(deleteStatePlan(1, 2), { undoSteps: 1, clearRedo: true, dropped: 3 });
});

test('deleteStatePlan is null when only the opened state is left', () => {
  assert.equal(deleteStatePlan(0, 0), null);
  assert.equal(deleteStatePlan(0, 4), null);
});

test('nextSnapshotName counts up and skips names in use', () => {
  assert.equal(nextSnapshotName([]), 'Snapshot 1');
  assert.equal(nextSnapshotName([{ name: 'Snapshot 1' }]), 'Snapshot 2');
  assert.equal(nextSnapshotName([{ name: 'Snapshot 2' }, { name: 'Before crop' }]), 'Snapshot 1');
  assert.equal(
    nextSnapshotName([{ name: 'Snapshot 1' }, { name: 'Snapshot 2' }, { name: 'Snapshot 4' }]),
    'Snapshot 3'
  );
});

test('the footer sits after the list with snapshot and delete buttons', () => {
  withDocument((doc) => {
    const box = doc.getElementById('history');
    const clicks = [];
    renderHistoryPanel(box, entries('Brush', 'Fill'), [], () => {}, () => {}, {
      onDeleteState: () => clicks.push('delete'),
      onNewSnapshot: () => clicks.push('snapshot')
    });
    const list = box.querySelector('.history-list');
    const footer = box.querySelector('.history-footer');
    assert.ok(list && footer);
    assert.equal(list.nextElementSibling, footer);
    const del = footer.querySelector('button[data-action=delete]');
    const snap = footer.querySelector('button[data-action=snapshot]');
    assert.equal(del.title, 'Delete current state');
    assert.equal(snap.title, 'Create new snapshot');
    assert.ok(del.querySelector('svg') && snap.querySelector('svg'));
    assert.equal(del.disabled, false);
    del.click();
    snap.click();
    assert.deepEqual(clicks, ['delete', 'snapshot']);
  });
});

test('the delete button is disabled when only the opened state is left', () => {
  withDocument((doc) => {
    const box = doc.getElementById('history');
    renderHistoryPanel(box, [], entries('Brush'), () => {}, () => {});
    const del = box.querySelector('.history-footer button[data-action=delete]');
    assert.equal(del.disabled, true);
    assert.equal(box.querySelector('button[data-action=snapshot]').disabled, false);
  });
});

test('snapshot rows sit above the states and report clicks', () => {
  withDocument((doc) => {
    const box = doc.getElementById('history');
    const picked = [];
    renderHistoryPanel(box, entries('Brush'), entries('Fill'), () => {}, () => {}, {
      snapshots: [{ name: 'Snapshot 1' }, { name: 'Snapshot 2' }],
      onSnapshot: (i) => picked.push(i)
    });
    const rows = [...box.querySelector('.history-list').children];
    assert.deepEqual(
      rows.slice(0, 2).map((r) => [r.className, r.textContent]),
      [
        ['history-snapshot', 'Snapshot 1'],
        ['history-snapshot', 'Snapshot 2']
      ]
    );
    assert.ok(rows.slice(2).every((r) => r.classList.contains('history-item')));
    rows[1].click();
    assert.deepEqual(picked, [1]);
  });
});
