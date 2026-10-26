import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import {
  createGame,
  facesMatch,
  hintPair,
  isFree,
  isStuck,
  isWon,
  matchingFreePairs,
  mulberry32,
  selectTile,
  shuffleRemaining,
  tilesLeft,
  undo
} from '../mahjongg/engine.js';
import { faceLabel, faceMarkup } from '../mahjongg/faces.js';
import { LAYOUTS, layoutById } from '../mahjongg/layouts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('layouts are even, unique, and the turtle is the classic 144', () => {
  assert.equal(layoutById('turtle').slots.length, 144);
  for (const layout of LAYOUTS) {
    assert.equal(layout.slots.length % 2, 0, layout.id);
    const seen = new Set();
    for (const slot of layout.slots) {
      const key = `${slot.x},${slot.y},${slot.z}`;
      assert.equal(seen.has(key), false, `${layout.id} ${key}`);
      seen.add(key);
    }
  }
});

test('a full turtle uses four of each suit tile, and flowers match across pictures', () => {
  const game = createGame(layoutById('turtle').slots, 5);
  const flowers = game.tiles.filter((tile) => tile.face.group === 'flower');
  const seasons = game.tiles.filter((tile) => tile.face.group === 'season');
  assert.equal(flowers.length, 4);
  assert.equal(seasons.length, 4);
  assert.equal(facesMatch(flowers[0].face, flowers[3].face), true);
  assert.equal(facesMatch(flowers[0].face, seasons[0].face), false);
  const dots = game.tiles.filter((tile) => tile.face.suit === 'dots' && tile.face.rank === 1);
  assert.equal(dots.length, 4);
  assert.equal(faceMarkup(flowers[0].face).includes('<svg'), true);
  assert.match(faceLabel(flowers[0].face), /flower/);
});

test('the turtle head and cap start free, and the neck does not', () => {
  const game = createGame(layoutById('turtle').slots, 1);
  const at = (x, y, z) => game.tiles.find((tile) => tile.x === x && tile.y === y && tile.z === z);
  assert.equal(isFree(game.tiles, at(28, 7, 0).id), true);
  assert.equal(isFree(game.tiles, at(0, 7, 0).id), true);
  assert.equal(isFree(game.tiles, at(13, 7, 4).id), true);
  assert.equal(isFree(game.tiles, at(26, 7, 0).id), false);
});

test('a covered tile and a sandwiched tile cannot be taken', () => {
  const game = createGame(
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 6, y: 0, z: 0 }
    ],
    1
  );
  assert.equal(isFree(game.tiles, 0), true);
  assert.equal(isFree(game.tiles, 1), false);
  assert.equal(isFree(game.tiles, 3), true);
  selectTile(game, 0);
  assert.equal(selectTile(game, 1).action, 'blocked');
  assert.equal(game.selectedId, 0);

  const stacked = createGame(
    [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 }
    ],
    2
  );
  assert.equal(isFree(stacked.tiles, 0), false);
  assert.equal(isFree(stacked.tiles, 2), true);
});

test('every layout deals a board the recorded solution clears', () => {
  for (const layout of LAYOUTS) {
    for (let seed = 1; seed <= 6; seed++) {
      const game = createGame(layout.slots, seed);
      assert.equal(game.solution.length, layout.slots.length / 2);
      for (const [a, b] of game.solution) {
        assert.equal(selectTile(game, a).action, 'select', `${layout.id} seed ${seed}`);
        assert.equal(selectTile(game, b).action, 'match', `${layout.id} seed ${seed}`);
      }
      assert.equal(isWon(game), true);
    }
  }
});

test('undo restores a pair, and a stuck board reports no hint', () => {
  const game = createGame(layoutById('easy').slots, 3);
  const [a, b] = game.solution[0];
  selectTile(game, a);
  selectTile(game, b);
  assert.equal(tilesLeft(game), layoutById('easy').slots.length - 2);
  assert.equal(undo(game), true);
  assert.equal(game.tiles[a].removed, false);
  assert.equal(undo(game), false);

  const open = createGame(
    [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 8, y: 0, z: 0 },
      { x: 12, y: 0, z: 0 }
    ],
    1
  );
  for (let i = 0; i < open.tiles.length; i++) {
    open.tiles[i].face = { suit: 'dots', rank: i + 1, group: null };
  }
  assert.equal(isStuck(open), true);
  assert.equal(hintPair(open), null);
  assert.equal(matchingFreePairs(open.tiles).length, 0);
});

test('selecting a different free tile moves the selection', () => {
  const game = createGame(
    [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 8, y: 0, z: 0 },
      { x: 12, y: 0, z: 0 }
    ],
    4
  );
  const first = game.tiles[0];
  const other = game.tiles.find((tile) => !facesMatch(tile.face, first.face));
  assert.ok(other);
  assert.equal(selectTile(game, first.id).action, 'select');
  assert.equal(selectTile(game, other.id).action, 'select');
  assert.equal(game.selectedId, other.id);
  assert.equal(selectTile(game, other.id).action, 'deselect');
});

test('shuffle keeps removed tiles removed and leaves a solvable board', () => {
  const game = createGame(layoutById('turtle').slots, 9);
  for (let i = 0; i < 5; i++) {
    const [a, b] = game.solution[i];
    selectTile(game, a);
    selectTile(game, b);
  }
  const removedBefore = game.tiles.filter((tile) => tile.removed).map((tile) => tile.id);
  const facesBefore = game.tiles.map((tile) => tile.face);
  assert.equal(shuffleRemaining(game, mulberry32(99)), true);
  const removedAfter = game.tiles.filter((tile) => tile.removed).map((tile) => tile.id);
  assert.deepEqual(removedAfter, removedBefore);
  for (const [a, b] of game.solution) {
    assert.equal(selectTile(game, a).action, 'select');
    assert.equal(selectTile(game, b).action, 'match');
  }
  assert.equal(isWon(game), true);
  assert.equal(undo(game), true);
  assert.equal(isWon(game), false);

  const fresh = createGame(layoutById('bridge').slots, 2);
  const before = fresh.tiles.map((tile) => ({ ...tile.face }));
  shuffleRemaining(fresh, mulberry32(3));
  assert.equal(undo(fresh), true);
  assert.deepEqual(
    fresh.tiles.map((tile) => tile.face),
    before
  );
  assert.deepEqual(facesBefore.length > 0, true);
});

test('a hint names a free matching pair and odd layouts are rejected', () => {
  const game = createGame(layoutById('pyramid').slots, 7);
  const pair = hintPair(game);
  assert.ok(pair);
  assert.equal(game.hints, 1);
  assert.equal(isFree(game.tiles, pair[0]), true);
  assert.equal(isFree(game.tiles, pair[1]), true);
  assert.equal(facesMatch(game.tiles[pair[0]].face, game.tiles[pair[1]].face), true);
  assert.throws(() => createGame([{ x: 0, y: 0, z: 0 }], 1));
});

test('the page is indexable and the title matches the social cards', () => {
  const html = readFileSync(path.join(ROOT, 'mahjongg/index.html'), 'utf8');
  const document = new JSDOM(html).window.document;
  const title = 'Mahjongg — Match the Tiles 🀄';
  assert.equal(document.title, title);
  assert.equal(document.querySelector('meta[property="og:title"]').getAttribute('content'), title);
  assert.equal(document.querySelector('meta[name="twitter:title"]').getAttribute('content'), title);
  assert.equal(
    document.querySelector('meta[name="robots"]').getAttribute('content'),
    'index, follow'
  );
  assert.equal(
    document.querySelector('link[rel="canonical"]').getAttribute('href'),
    'https://joeheyming.github.io/mahjongg/'
  );
  const description = document.querySelector('meta[name="description"]').getAttribute('content');
  assert.ok(description.length >= 150, description);
  assert.equal(document.querySelector('h1').textContent, 'Mahjongg');
  assert.ok(document.querySelector('script[src="index.js"]'));
});
