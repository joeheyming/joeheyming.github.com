import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canMove, makeGameId, normalizeRow, replayGame, seatFor } from '../chess/sync.js';

/**
 * @param {Set<string>} illegal
 */
function fakeChess(illegal) {
  /** @type {string[]} */
  const sans = [];
  return {
    sans,
    /**
     * @param {string} san
     */
    move(san) {
      if (illegal.has(san)) throw new Error('Invalid move');
      sans.push(san);
      return { san };
    },
    turn() {
      return sans.length % 2 === 0 ? 'w' : 'b';
    }
  };
}

describe('shared chess replay', () => {
  const gameId = 'ABCDE';

  it('replays SAN in ply order and drops a move the rules reject', () => {
    const chess = fakeChess(new Set(['Nf6']));
    const replay = replayGame(
      [
        { gameId, ply: 0, name: 'Ann', san: '', color: 'w' },
        { gameId, ply: 2, name: 'Bob', san: 'e5', color: 'b' },
        { gameId, ply: 1, name: 'Ann', san: 'e4', color: 'w' },
        { gameId, ply: 0, name: 'Bob', san: '', color: 'b' },
        { gameId, ply: 3, name: 'Ann', san: 'Nf6', color: 'w' },
        { gameId, ply: 3, name: 'Ann', san: 'Nf3', color: 'w' },
        { gameId, ply: 3, name: 'Ann', san: 'Nc3', color: 'w' },
        { gameId, ply: 4, name: 'Ann', san: 'Nc6', color: 'w' }
      ],
      chess,
      gameId
    );

    assert.deepEqual(chess.sans, ['e4', 'e5', 'Nf3']);
    assert.deepEqual(
      replay.applied.map((row) => row.san),
      ['e4', 'e5', 'Nf3']
    );
    assert.equal(replay.white, 'Ann');
    assert.equal(replay.black, 'Bob');
    assert.equal(chess.turn(), 'b');
    const droppedSans = replay.dropped.map((row) => row.san);
    assert.ok(droppedSans.includes('Nf6'));
    assert.ok(droppedSans.includes('Nc3'));
    assert.ok(droppedSans.includes('Nc6'));
  });

  it('gives the next move to the side whose turn it is', () => {
    const chess = fakeChess(new Set());
    const replay = replayGame(
      [
        { gameId, ply: 0, name: 'Ann', san: '', color: 'w' },
        { gameId, ply: 1, name: 'Ann', san: 'e4', color: 'w' }
      ],
      chess,
      gameId
    );
    assert.equal(chess.turn(), 'b');
    assert.equal(canMove('shared', 'w', chess.turn(), false), false);
    assert.equal(canMove('shared', 'b', chess.turn(), false), true);
    assert.equal(canMove('local', null, chess.turn(), false), true);
    assert.equal(canMove('shared', '', chess.turn(), false), false);
    assert.equal(canMove('shared', 'b', chess.turn(), true), false);
    assert.equal(seatFor(replay, 'Ann'), 'w');
    assert.equal(seatFor(replay, 'Cara'), 'b');
  });

  it('keeps a taken black seat from a new name', () => {
    const replay = replayGame(
      [
        { gameId, ply: 0, name: 'Ann', san: '', color: 'w' },
        { gameId, ply: 0, name: 'Bob', san: '', color: 'b' }
      ],
      fakeChess(new Set()),
      gameId
    );
    assert.equal(seatFor(replay, 'Bob'), 'b');
    assert.equal(seatFor(replay, 'Cara'), '');
  });

  it('rejects a row that is not a move record', () => {
    assert.equal(normalizeRow({ gameId, ply: '', name: 'Ann', san: '', color: 'w' }), null);
    assert.equal(normalizeRow({ gameId, ply: 1, name: 'Ann', san: 'e4', color: 'x' }), null);
  });

  it('builds a short code from the unambiguous alphabet', () => {
    const id = makeGameId(new Uint8Array([0, 1, 2, 3, 4]));
    assert.equal(id.length, 5);
    assert.match(id, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });
});
