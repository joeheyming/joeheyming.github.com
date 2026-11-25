// Exhaustive check of both Pac-Man phase tables. The expected edges live
// here. applyPhase is what each game calls; a missing edge leaves the
// phase alone.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPhase, INFINITE_EDGES, MAZE_EDGES, PACMAN_PHASES } from '../pacman/js/game-phase.js';

const phases = ['start', 'intro', 'playing', 'paused', 'death', 'game_over', 'win'];

const mazeNext = {
  start: { intro: 'intro', playing: 'playing' },
  intro: { playing: 'playing' },
  playing: { paused: 'paused', death: 'death', win: 'win' },
  paused: { playing: 'playing' },
  death: { intro: 'intro', playing: 'playing', game_over: 'game_over' },
  game_over: { intro: 'intro', playing: 'playing' },
  win: { intro: 'intro', playing: 'playing' }
};

const infiniteNext = {
  start: { playing: 'playing' },
  intro: {},
  playing: { paused: 'paused', death: 'death' },
  paused: { playing: 'playing' },
  death: { playing: 'playing', game_over: 'game_over' },
  game_over: { start: 'start' },
  win: {}
};

function check(label, edges, next) {
  describe(label, () => {
    for (const from of phases) {
      for (const to of phases) {
        const dest = (next[from] && next[from][to]) || '';
        it(from + ' → ' + (dest || 'refused ' + to), () => {
          const host = { state: from };
          const ok = applyPhase(host, edges, to);
          if (dest) {
            assert.equal(ok, true);
            assert.equal(host.state, dest);
          } else {
            assert.equal(ok, false);
            assert.equal(host.state, from);
          }
        });
      }
    }
  });
}

describe('pacman phases', () => {
  it('names every phase', () => {
    assert.deepEqual(PACMAN_PHASES.slice().sort(), phases.slice().sort());
    assert.equal(phases.length * phases.length, 49);
  });
});

check('maze', MAZE_EDGES, mazeNext);
check('infinite', INFINITE_EDGES, infiniteNext);
