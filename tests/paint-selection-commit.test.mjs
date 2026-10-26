import test from 'node:test';
import assert from 'node:assert/strict';

import { applySelectionWithMask, commitToolSelection } from '../paint/selection.js';

function doc(sel = { mode: 'none', mask: null }) {
  return {
    sel: { x: 0, y: 0, w: 0, h: 0, data: null, baseData: null, ...sel }
  };
}

test('commitToolSelection applies through selection.js when nothing is injected', () => {
  const state = doc();
  const W = 4,
    H = 1;
  const mask = new Uint8Array([0, 1, 1, 0]);
  commitToolSelection(state, mask, W, H, null);
  assert.equal(state.sel.mode, 'active');
  assert.deepEqual([state.sel.x, state.sel.y, state.sel.w, state.sel.h], [1, 0, 2, 1]);
  assert.deepEqual([...state.sel.mask], [0, 1, 1, 0]);
});

test('commitToolSelection prefers state.selectionCommit over the legacy spy', () => {
  const state = doc();
  const calls = [];
  state.selectionCommit = (mask, w, h, mode) => calls.push({ via: 'commit', mode, len: mask.length });
  state.applySelectionWithMask = () => calls.push({ via: 'legacy' });
  commitToolSelection(state, new Uint8Array(8), 4, 2, 'add');
  assert.deepEqual(calls, [{ via: 'commit', mode: 'add', len: 8 }]);
  assert.equal(state.sel.mode, 'none');
});

test('commitToolSelection falls back to legacy applySelectionWithMask spies', () => {
  const state = doc();
  let seen = null;
  state.applySelectionWithMask = (mask, w, h, mode) => {
    seen = { mode, w, h };
    applySelectionWithMask(state, mask, w, h, mode);
  };
  commitToolSelection(state, new Uint8Array([1, 0]), 2, 1, null);
  assert.deepEqual(seen, { mode: null, w: 2, h: 1 });
  assert.equal(state.sel.mode, 'active');
});
