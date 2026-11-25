// Exhaustive check of piano-hero engine status. The expected edges live
// here, not in a read-back of game-state.js. Each test loads a fresh
// module so the singleton does not leak between cases.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HREF = pathToFileURL(join(__dirname, '..', 'piano-hero', 'game-state.js')).href;

let loadGate = Promise.resolve();
let loadGeneration = 0;

async function freshState() {
  const turn = loadGate.then(async () => {
    loadGeneration += 1;
    const mod = await import(HREF + '?n=' + loadGeneration);
    return mod.default;
  });
  loadGate = turn.then(
    () => {},
    () => {}
  );
  return turn;
}

const statuses = ['idle', 'playing', 'paused', 'finished'];

// Spec. Missing target means setStatus must refuse.
const next = {
  idle: { playing: 'playing' },
  playing: { paused: 'paused', finished: 'finished', idle: 'idle' },
  paused: { playing: 'playing', idle: 'idle' },
  finished: { idle: 'idle' }
};

async function reach(status) {
  const state = await freshState();
  if (status === 'idle') return state;
  assert.equal(state.setStatus('playing'), true);
  if (status === 'playing') return state;
  if (status === 'paused') {
    assert.equal(state.setStatus('paused'), true);
    return state;
  }
  assert.equal(state.setStatus('finished'), true);
  return state;
}

describe('piano-hero status', () => {
  it('names every status', () => {
    assert.deepEqual(Object.keys(next).sort(), statuses.slice().sort());
    assert.equal(statuses.length * statuses.length, 16);
  });

  for (const from of statuses) {
    for (const to of statuses) {
      const dest = (next[from] && next[from][to]) || null;
      it(from + ' → ' + (dest || 'refused ' + to), async () => {
        const state = await reach(from);
        const heard = [];
        state.on(() => heard.push(true));
        const ok = state.setStatus(to);
        if (dest) {
          assert.equal(ok, true);
          assert.equal(state.status, dest);
          assert.equal(heard.length, 1);
        } else {
          assert.equal(ok, false);
          assert.equal(state.status, from);
          assert.equal(heard.length, 0);
        }
      });
    }
  }

  it('refuses an unknown status', async () => {
    const state = await freshState();
    const heard = [];
    state.on(() => heard.push(true));
    assert.equal(state.setStatus('banana'), false);
    assert.equal(state.status, 'idle');
    assert.equal(heard.length, 0);
  });

  for (const from of statuses) {
    it('setChart from ' + from + ' forces idle and emits', async () => {
      const state = await reach(from);
      const heard = [];
      state.on(() => heard.push(state.status));
      state.setChart({ title: 'Etude', notes: [] }, 'etude', 'Etude');
      assert.equal(state.status, 'idle');
      assert.equal(state.currentSongLabel, 'Etude');
      assert.deepEqual(heard, ['idle']);
    });
  }
});
