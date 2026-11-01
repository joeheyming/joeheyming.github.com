import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GhostModeClock,
  aheadOffset,
  cardinalFromFacing,
  chaseTarget,
  chooseNextTile,
  elroyStage,
  findGridPath,
  openWorldScatterTarget,
  patrolTarget,
  scatterCorner
} from '../pacman/js/ghost-ai.js';

const pac = { x: 10, y: 10 };
const corner = { x: -2, y: -2 };

describe('chase targets', () => {
  it('sends Blinky to Pac-Man', () => {
    assert.deepEqual(
      chaseTarget({
        ghostType: 'blinky',
        ghostTile: { x: 1, y: 1 },
        pacmanTile: pac,
        pacmanDirection: 'left',
        blinkyTile: null,
        scatterTarget: corner
      }),
      pac
    );
  });

  it('aims Pinky four tiles ahead, and four up plus four left when Pac-Man faces up', () => {
    assert.deepEqual(aheadOffset('right', 4), { x: 4, y: 0 });
    assert.deepEqual(aheadOffset('up', 4), { x: -4, y: 4 });
    assert.deepEqual(
      chaseTarget({
        ghostType: 'pinky',
        ghostTile: { x: 0, y: 0 },
        pacmanTile: pac,
        pacmanDirection: 'right',
        blinkyTile: null,
        scatterTarget: corner
      }),
      { x: 14, y: 10 }
    );
    assert.deepEqual(
      chaseTarget({
        ghostType: 'pinky',
        ghostTile: { x: 0, y: 0 },
        pacmanTile: pac,
        pacmanDirection: 'up',
        blinkyTile: null,
        scatterTarget: corner
      }),
      { x: 6, y: 14 }
    );
  });

  it('doubles the vector from Blinky through a point two tiles ahead of Pac-Man', () => {
    assert.deepEqual(
      chaseTarget({
        ghostType: 'inky',
        ghostTile: { x: 0, y: 0 },
        pacmanTile: pac,
        pacmanDirection: 'right',
        blinkyTile: { x: 8, y: 10 },
        scatterTarget: corner
      }),
      { x: 16, y: 10 }
    );
    assert.deepEqual(
      chaseTarget({
        ghostType: 'inky',
        ghostTile: { x: 0, y: 0 },
        pacmanTile: pac,
        pacmanDirection: 'up',
        blinkyTile: { x: 10, y: 8 },
        scatterTarget: corner
      }),
      { x: 6, y: 16 }
    );
  });

  it('lets Clyde chase past eight tiles and retreat to his corner inside that', () => {
    const far = chaseTarget({
      ghostType: 'clyde',
      ghostTile: { x: 0, y: 0 },
      pacmanTile: { x: 9, y: 0 },
      pacmanDirection: 'left',
      blinkyTile: null,
      scatterTarget: corner
    });
    const near = chaseTarget({
      ghostType: 'clyde',
      ghostTile: { x: 0, y: 0 },
      pacmanTile: { x: 8, y: 0 },
      pacmanDirection: 'left',
      blinkyTile: null,
      scatterTarget: corner
    });
    assert.deepEqual(far, { x: 9, y: 0 });
    assert.deepEqual(near, corner);
  });
});

describe('scatter and elroy', () => {
  it('parks scatter targets just outside each corner', () => {
    assert.deepEqual(scatterCorner('blinky', 23, 22), { x: 24, y: 23 });
    assert.deepEqual(scatterCorner('pinky', 23, 22), { x: -2, y: 23 });
    assert.deepEqual(scatterCorner('inky', 23, 22), { x: 24, y: -2 });
    assert.deepEqual(scatterCorner('clyde', 23, 22), { x: -2, y: -2 });
  });

  it('keeps Elroy Blinky in chase during a scatter wave', () => {
    const args = {
      mode: 'scatter',
      ghostType: 'blinky',
      ghostTile: { x: 1, y: 1 },
      pacmanTile: pac,
      pacmanDirection: 'down',
      blinkyTile: null,
      scatterTarget: { x: 24, y: 23 },
      elroyStage: 1
    };
    assert.deepEqual(patrolTarget(args), pac);
    assert.deepEqual(patrolTarget({ ...args, elroyStage: 0 }), { x: 24, y: 23 });
  });

  it('matches the arcade 244-dot Elroy counts', () => {
    assert.equal(elroyStage(21, 244), 0);
    assert.equal(elroyStage(20, 244), 1);
    assert.equal(elroyStage(10, 244), 2);
    assert.equal(elroyStage(0, 0), 0);
  });
});

describe('tile choice', () => {
  const tile = { x: 5, y: 5 };
  const neighbors = [
    { x: 5, y: 6 },
    { x: 5, y: 4 },
    { x: 6, y: 5 },
    { x: 4, y: 5 }
  ];

  it('breaks an equal distance toward up before left', () => {
    const choice = chooseNextTile({
      tile,
      neighbors,
      target: { x: 4, y: 6 },
      lastDirection: null
    });
    assert.deepEqual(choice, { x: 5, y: 6 });
  });

  it('refuses to reverse while a forward exit exists', () => {
    const choice = chooseNextTile({
      tile,
      neighbors,
      target: { x: 0, y: 5 },
      lastDirection: { x: 1, y: 0 }
    });
    assert.notDeepEqual(choice, { x: 4, y: 5 });
    assert.deepEqual(choice, { x: 5, y: 6 });
  });

  it('reverses when a mode change demands it', () => {
    const choice = chooseNextTile({
      tile,
      neighbors,
      target: { x: 20, y: 5 },
      lastDirection: { x: 1, y: 0 },
      forceReverse: true
    });
    assert.deepEqual(choice, { x: 4, y: 5 });
  });

  it('picks a frightened exit from the injected rng and still will not reverse', () => {
    const reverseFirst = [
      { x: 5, y: 4 },
      { x: 5, y: 6 },
      { x: 6, y: 5 },
      { x: 4, y: 5 }
    ];
    const choice = chooseNextTile({
      tile,
      neighbors: reverseFirst,
      target: tile,
      lastDirection: { x: 0, y: 1 },
      frightened: true,
      rng: () => 0
    });
    assert.deepEqual(choice, { x: 5, y: 6 });
  });
});

describe('path home', () => {
  it('leaves a dead-end that points at the house instead of bouncing in it', () => {
    // Goal is north at (2,6). (2,3) and (3,2) are closer to it than the
    // real exit, and both are dead ends off the junction (2,2).
    const tiles = [
      [2, 2],
      [2, 3],
      [3, 2],
      [2, 1],
      [1, 1],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [1, 5],
      [2, 5],
      [2, 6]
    ];
    const open = new Set(tiles.map(([x, y]) => `${x},${y}`));
    const neighborsOf = (x, y) =>
      [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0]
      ]
        .filter(([dx, dy]) => open.has(`${x + dx},${y + dy}`))
        .map(([dx, dy]) => ({ x: x + dx, y: y + dy }));

    const path = findGridPath({ x: 2, y: 2 }, { x: 2, y: 6 }, neighborsOf);
    assert.deepEqual(path[0], { x: 2, y: 1 });
    assert.deepEqual(path[path.length - 1], { x: 2, y: 6 });
  });

  it('can route every level-1 floor tile back to the ghost house', () => {
    const level = JSON.parse(
      readFileSync(new URL('../pacman/levels/level1.json', import.meta.url), 'utf8')
    );
    const walkable = new Set([1, 3, 4, 5, 6, 7]);
    const open = new Set();
    level.map.forEach((row, y) => {
      row.forEach((tile, x) => {
        if (walkable.has(tile)) open.add(`${x},${y}`);
      });
    });
    const neighborsOf = (x, y) => {
      const neighbors = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0]
      ]
        .filter(([dx, dy]) => open.has(`${x + dx},${y + dy}`))
        .map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
      if ((x === 1 && y === 10) || (x === 21 && y === 10)) {
        neighbors.push(x === 1 ? { x: 21, y: 10 } : { x: 1, y: 10 });
      }
      return neighbors;
    };

    for (const key of open) {
      const [x, y] = key.split(',').map(Number);
      const path = findGridPath({ x, y }, { x: 11, y: 11 }, neighborsOf);
      assert.ok(path, `no route home from ${key}`);
    }
  });
});

describe('scatter/chase clock', () => {
  it('walks the level-1 waves and pauses while frightened', () => {
    const clock = new GhostModeClock();
    assert.equal(clock.mode, 'scatter');
    clock.update(7);
    assert.equal(clock.mode, 'chase');
    clock.paused = true;
    clock.update(100);
    assert.equal(clock.mode, 'chase');
    clock.paused = false;
    clock.update(20);
    assert.equal(clock.mode, 'scatter');
  });

  it('quantizes a free-look facing vector to a cardinal', () => {
    assert.equal(cardinalFromFacing(0.2, 0.9), 'up');
    assert.equal(cardinalFromFacing(-0.8, 0.2), 'left');
    assert.equal(cardinalFromFacing(0, -1), 'down');
  });

  it('uses the stronger axis of a diagonal facing before aiming ahead', () => {
    const direction = cardinalFromFacing(0.6, 0.8);
    assert.equal(direction, 'up');
    assert.deepEqual(
      chaseTarget({
        ghostType: 'pinky',
        ghostTile: { x: 0, y: 0 },
        pacmanTile: { x: 10, y: 10 },
        pacmanDirection: direction,
        blinkyTile: null,
        scatterTarget: { x: 0, y: 0 }
      }),
      { x: 6, y: 14 }
    );
  });

  it('sends an open-world Clyde toward the southwest when he is close', () => {
    const scatter = openWorldScatterTarget('clyde', 20, 30);
    assert.deepEqual(scatter, { x: 8, y: 18 });
    assert.deepEqual(
      chaseTarget({
        ghostType: 'clyde',
        ghostTile: { x: 20, y: 30 },
        pacmanTile: { x: 24, y: 30 },
        pacmanDirection: 'right',
        blinkyTile: null,
        scatterTarget: scatter
      }),
      scatter
    );
  });
});
