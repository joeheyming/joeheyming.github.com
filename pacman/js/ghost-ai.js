/**
 * Arcade Pac-Man ghost targeting.
 *
 * Ghosts do not pathfind. At each tile they look at the legal exits
 * (never the tile they just left, unless that is the only exit or a
 * mode change forces a reverse) and step toward the neighbor with the
 * smallest squared Euclidean distance to a target tile. Equal distances
 * break toward up, then left, then down, then right.
 *
 * Targets, from the Pac-Man Dossier:
 * - Blinky: Pac-Man's tile. In Cruise Elroy he keeps that target even
 *   during scatter waves.
 * - Pinky: four tiles ahead of Pac-Man. Facing up also shifts the
 *   target four tiles left — the arcade's overflow bug, which is part
 *   of how the original board plays.
 * - Inky: two tiles ahead of Pac-Man, then the vector from Blinky to
 *   that tile, doubled. The same up-offset bug applies.
 * - Clyde: Pac-Man's tile when more than eight tiles away, otherwise
 *   his scatter corner.
 *
 * Scatter corners sit just outside the maze so a ghost circles the
 * corner instead of camping on the corner tile.
 */

export const GHOST_AI = {
  PINKY_AHEAD: 4,
  INKY_AHEAD: 2,
  CLYDE_SHY_TILES: 8,
  TURN_PRIORITY: ['up', 'left', 'down', 'right']
};

// Level-1 wave table. Later arcade levels shorten scatter; this maze
// set is not those levels, so the familiar 7/20/7/20/5/20/5/forever
// pattern is the one players recognize.
export const SCATTER_CHASE_WAVES = [
  { mode: 'scatter', duration: 7 },
  { mode: 'chase', duration: 20 },
  { mode: 'scatter', duration: 7 },
  { mode: 'chase', duration: 20 },
  { mode: 'scatter', duration: 5 },
  { mode: 'chase', duration: 20 },
  { mode: 'scatter', duration: 5 },
  { mode: 'chase', duration: Infinity }
];

const TURN_RANK = {
  up: 0,
  left: 1,
  down: 2,
  right: 3
};

export function cardinalFromFacing(x, y) {
  if (Math.abs(x) > Math.abs(y)) return x >= 0 ? 'right' : 'left';
  return y >= 0 ? 'up' : 'down';
}

// Open-world stand-in for a maze corner. There is no board edge, so
// each personality keeps walking this far toward its arcade corner:
// Blinky northeast, Pinky northwest, Inky southeast, Clyde southwest.
// +Y is world up, matching Pac-Man's facing vector.
export const OPEN_WORLD_SCATTER_TILES = 12;

const OPEN_WORLD_SCATTER_DIR = {
  blinky: { x: 1, y: 1 },
  pinky: { x: -1, y: 1 },
  inky: { x: 1, y: -1 },
  clyde: { x: -1, y: -1 }
};

export function openWorldScatterTarget(ghostType, gridX, gridY, tiles = OPEN_WORLD_SCATTER_TILES) {
  const dir = OPEN_WORLD_SCATTER_DIR[ghostType] || OPEN_WORLD_SCATTER_DIR.blinky;
  return { x: gridX + dir.x * tiles, y: gridY + dir.y * tiles };
}

export function scatterCorner(ghostType, width, height) {
  switch (ghostType) {
    case 'pinky':
      return { x: -2, y: height + 1 };
    case 'inky':
      return { x: width + 1, y: -2 };
    case 'clyde':
      return { x: -2, y: -2 };
    case 'blinky':
    default:
      return { x: width + 1, y: height + 1 };
  }
}

/**
 * Ahead-of-Pac-Man offset. `up` includes the arcade leftward bug.
 */
export function aheadOffset(direction, tiles) {
  switch (direction) {
    case 'up':
      return { x: -tiles, y: tiles };
    case 'down':
      return { x: 0, y: -tiles };
    case 'left':
      return { x: -tiles, y: 0 };
    case 'right':
      return { x: tiles, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

export function chaseTarget({
  ghostType,
  ghostTile,
  pacmanTile,
  pacmanDirection,
  blinkyTile,
  scatterTarget
}) {
  switch (ghostType) {
    case 'pinky': {
      const offset = aheadOffset(pacmanDirection, GHOST_AI.PINKY_AHEAD);
      return { x: pacmanTile.x + offset.x, y: pacmanTile.y + offset.y };
    }
    case 'inky': {
      const offset = aheadOffset(pacmanDirection, GHOST_AI.INKY_AHEAD);
      const pivot = { x: pacmanTile.x + offset.x, y: pacmanTile.y + offset.y };
      if (!blinkyTile) return pivot;
      return {
        x: pivot.x + (pivot.x - blinkyTile.x),
        y: pivot.y + (pivot.y - blinkyTile.y)
      };
    }
    case 'clyde': {
      const dx = ghostTile.x - pacmanTile.x;
      const dy = ghostTile.y - pacmanTile.y;
      const shy = GHOST_AI.CLYDE_SHY_TILES;
      if (dx * dx + dy * dy > shy * shy) return { x: pacmanTile.x, y: pacmanTile.y };
      return scatterTarget;
    }
    case 'blinky':
    default:
      return { x: pacmanTile.x, y: pacmanTile.y };
  }
}

/**
 * Scatter sends each ghost to its corner, except Cruise Elroy Blinky,
 * who keeps chasing.
 */
export function patrolTarget({ mode, elroyStage = 0, ...chaseArgs }) {
  if (mode === 'chase' || (chaseArgs.ghostType === 'blinky' && elroyStage > 0)) {
    return chaseTarget(chaseArgs);
  }
  return chaseArgs.scatterTarget;
}

/**
 * Breadth-first path from `start` to `goal`. The result omits `start`
 * and ends at `goal`, so the first entry is the next step. Returns an
 * empty array when already there, and null when no route exists.
 * `neighborsOf` may include non-adjacent tiles (tunnel endpoints).
 */
export function findGridPath(start, goal, neighborsOf) {
  if (start.x === goal.x && start.y === goal.y) return [];
  const keyOf = (x, y) => `${x},${y}`;
  const startKey = keyOf(start.x, start.y);
  const goalKey = keyOf(goal.x, goal.y);
  const previous = new Map();
  previous.set(startKey, null);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.x === goal.x && current.y === goal.y) break;
    for (const next of neighborsOf(current.x, current.y)) {
      const key = keyOf(next.x, next.y);
      if (previous.has(key)) continue;
      previous.set(key, keyOf(current.x, current.y));
      queue.push(next);
    }
  }
  if (!previous.has(goalKey)) return null;

  const steps = [];
  let cursor = goalKey;
  while (cursor !== startKey) {
    const [x, y] = cursor.split(',').map(Number);
    steps.push({ x, y });
    cursor = previous.get(cursor);
  }
  steps.reverse();
  return steps;
}

function directionOf(dx, dy) {
  if (dy > 0 && dx === 0) return 'up';
  if (dy < 0 && dx === 0) return 'down';
  if (dx < 0 && dy === 0) return 'left';
  if (dx > 0 && dy === 0) return 'right';
  return null;
}

/**
 * Pick the next tile. `frightened` chooses uniformly among legal exits.
 * `forceReverse` takes the tile behind the ghost when it is open.
 */
export function chooseNextTile({
  tile,
  neighbors,
  target,
  lastDirection = null,
  frightened = false,
  forceReverse = false,
  rng = Math.random
}) {
  if (!neighbors || neighbors.length === 0) return null;

  if (forceReverse && lastDirection) {
    const back = neighbors.find(
      (neighbor) =>
        neighbor.x - tile.x === -lastDirection.x && neighbor.y - tile.y === -lastDirection.y
    );
    if (back) return back;
  }

  let options = neighbors;
  if (lastDirection && neighbors.length > 1) {
    const forward = neighbors.filter(
      (neighbor) =>
        !(neighbor.x - tile.x === -lastDirection.x && neighbor.y - tile.y === -lastDirection.y)
    );
    if (forward.length > 0) options = forward;
  }

  if (frightened) {
    const index = Math.min(options.length - 1, Math.floor(rng() * options.length));
    return options[index];
  }

  let best = options[0];
  let bestDist = Infinity;
  let bestRank = Infinity;
  for (const neighbor of options) {
    const dx = neighbor.x - target.x;
    const dy = neighbor.y - target.y;
    const dist = dx * dx + dy * dy;
    const rank = TURN_RANK[directionOf(neighbor.x - tile.x, neighbor.y - tile.y)] ?? 9;
    if (dist < bestDist || (dist === bestDist && rank < bestRank)) {
      best = neighbor;
      bestDist = dist;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Cruise Elroy thresholds scale with the pellet count so a 244-dot
 * board matches the arcade (20, then 10) and a smaller maze still
 * waits until the board is nearly clear.
 */
export function elroyStage(remaining, total) {
  if (!total || total <= 0) return 0;
  const first = Math.max(8, Math.round(total * 0.08));
  const second = Math.max(4, Math.round(first / 2));
  if (remaining <= second) return 2;
  if (remaining <= first) return 1;
  return 0;
}

export class GhostModeClock {
  constructor() {
    this.waveIndex = 0;
    this.elapsed = 0;
    this.paused = false;
  }

  get mode() {
    return SCATTER_CHASE_WAVES[this.waveIndex].mode;
  }

  reset() {
    this.waveIndex = 0;
    this.elapsed = 0;
    this.paused = false;
  }

  update(dt) {
    if (this.paused || !(dt > 0)) return;
    this.elapsed += dt;
    const waves = SCATTER_CHASE_WAVES;
    while (this.waveIndex < waves.length - 1 && this.elapsed >= waves[this.waveIndex].duration) {
      this.elapsed -= waves[this.waveIndex].duration;
      this.waveIndex += 1;
    }
  }
}
