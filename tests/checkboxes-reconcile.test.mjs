import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyServerRow,
  colorForClient,
  CLIENT_COLORS,
  isRemoteFlip
} from '../checkboxes/reconcile.js';

const snapshotMaxTs = Date.parse('2026-11-01T20:33:27.074Z');
const serverTs = Date.parse('2026-11-03T03:58:56.000Z');

test('a same-second confirmation is replayed after the snapshot wipes the bit', () => {
  const confirmed = applyServerRow(
    { bit: 1, lastTs: 0, pending: { value: true } },
    { ts: serverTs, bit: 1 },
    snapshotMaxTs
  );
  assert.equal(confirmed.pending, null);
  assert.equal(confirmed.bit, 1);
  assert.equal(confirmed.lastTs, serverTs);

  const replayed = applyServerRow(
    { bit: 0, lastTs: confirmed.lastTs, pending: null },
    { ts: serverTs, bit: 1 },
    snapshotMaxTs
  );
  assert.equal(replayed.bit, 1);
  assert.equal(replayed.lastTs, serverTs);
});

test('a click clock later in that second hides the confirmation', () => {
  const replayed = applyServerRow(
    { bit: 0, lastTs: serverTs + 400, pending: null },
    { ts: serverTs, bit: 1 },
    snapshotMaxTs
  );
  assert.equal(replayed.bit, 0);
  assert.equal(replayed.lastTs, serverTs + 400);
});

test('rows already folded into the snapshot do not move the cell', () => {
  const cell = { bit: 0, lastTs: 0, pending: null };
  assert.deepEqual(applyServerRow(cell, { ts: snapshotMaxTs, bit: 1 }, snapshotMaxTs), cell);
});

test('an older server row does not uncheck a newer one', () => {
  const cell = { bit: 1, lastTs: serverTs, pending: null };
  assert.deepEqual(applyServerRow(cell, { ts: serverTs - 1000, bit: 0 }, snapshotMaxTs), cell);
});

test('each client keeps one color, and different clients can differ', () => {
  assert.equal(colorForClient('alice'), colorForClient('alice'));
  assert.ok(CLIENT_COLORS.includes(colorForClient('alice')));
  assert.ok(CLIENT_COLORS.includes(colorForClient('')));
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(colorForClient(`client-${i}`));
  assert.ok(seen.size > 6);
});

test('another tab with the same client id still moves the ring', () => {
  assert.equal(isRemoteFlip({ before: 0, after: 1, ownClick: false }), true);
  assert.equal(isRemoteFlip({ before: 1, after: 1, ownClick: false }), false);
  assert.equal(isRemoteFlip({ before: 0, after: 1, ownClick: true }), false);
});

test('a pending click is not flipped by a disagreeing row', () => {
  const cell = { bit: 1, lastTs: 0, pending: { value: true } };
  const next = applyServerRow(cell, { ts: serverTs, bit: 0 }, snapshotMaxTs);
  assert.equal(next.bit, 1);
  assert.equal(next.pending, cell.pending);
  assert.equal(next.lastTs, serverTs);
});
