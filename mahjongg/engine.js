/* Mahjong solitaire rules.
 *
 * A tile is free when no tile overlaps it from a higher layer, and at least
 * one long side is open. A side is blocked when another tile on the same
 * layer intersects the 2×2 cell immediately left or right — a corner touch
 * counts, which is what pins the turtle's neck until the head is gone.
 *
 * A deal removes a matching pair from two free slots, over and over, and
 * that removal order is a solution. Replaying it clears the board, so every
 * deal is solvable. Flowers match any flower; seasons match any season.
 * Everything else matches the same suit and rank.
 */

/** @typedef {{ suit: string, rank: number, group: string | null }} Face */
/** @typedef {{ a: Face, b: Face }} Pair */
/** @typedef {{ x: number, y: number, z: number }} Slot */
/**
 * @typedef {{
 *   id: number,
 *   x: number,
 *   y: number,
 *   z: number,
 *   face: Face,
 *   removed: boolean
 * }} Tile
 */
/**
 * @typedef {{ kind: 'match', a: number, b: number }} MatchEntry
 * @typedef {{ kind: 'shuffle', tiles: { id: number, face: Face, removed: boolean }[] }} ShuffleEntry
 * @typedef {MatchEntry | ShuffleEntry} HistoryEntry
 */
/**
 * @typedef {{
 *   tiles: Tile[],
 *   solution: [number, number][],
 *   selectedId: number | null,
 *   history: HistoryEntry[],
 *   moves: number,
 *   hints: number,
 *   shuffles: number
 * }} Game
 */

const TILE = 2;

/**
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 */
function overlaps(ax, ay, bx, by) {
  return ax < bx + TILE && ax + TILE > bx && ay < by + TILE && ay + TILE > by;
}

/**
 * @param {Slot[]} slots
 * @param {(index: number) => boolean} present
 * @param {number} index
 */
function isOpenSlot(slots, present, index) {
  if (!present(index)) return false;
  const tile = slots[index];
  let left = false;
  let right = false;
  for (let j = 0; j < slots.length; j++) {
    if (j === index || !present(j)) continue;
    const other = slots[j];
    if (other.z > tile.z && overlaps(tile.x, tile.y, other.x, other.y)) return false;
    if (other.z !== tile.z) continue;
    if (!left && overlaps(tile.x - TILE, tile.y, other.x, other.y)) left = true;
    if (!right && overlaps(tile.x + TILE, tile.y, other.x, other.y)) right = true;
  }
  return !(left && right);
}

/**
 * @param {Tile[]} tiles
 * @param {number} id
 */
export function isFree(tiles, id) {
  const tile = tiles[id];
  if (!tile || tile.removed || tile.id !== id) return false;
  return isOpenSlot(tiles, (index) => !tiles[index].removed, id);
}

/**
 * @param {Face} a
 * @param {Face} b
 */
export function facesMatch(a, b) {
  if (a.group && b.group) return a.group === b.group;
  return a.suit === b.suit && a.rank === b.rank;
}

/**
 * @param {Face} face
 */
function matchKey(face) {
  if (face.group) return `g:${face.group}`;
  return `${face.suit}:${face.rank}`;
}

/**
 * @template T
 * @param {T[]} list
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffle(list, rng) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * @param {number[]} free
 * @param {() => number} rng
 * @returns {[number, number]}
 */
function pickTwo(free, rng) {
  const a = free[Math.floor(rng() * free.length)];
  const rest = [];
  for (const id of free) {
    if (id !== a) rest.push(id);
  }
  const b = rest[Math.floor(rng() * rest.length)];
  return [a, b];
}

/** @returns {Pair[]} */
function allPairs() {
  /** @type {Pair[]} */
  const pairs = [];
  const exact = (suit, rank) => {
    const face = { suit, rank, group: null };
    return { a: face, b: { suit, rank, group: null } };
  };
  for (const suit of ['dots', 'bamboo', 'characters']) {
    for (let rank = 1; rank <= 9; rank++) {
      pairs.push(exact(suit, rank), exact(suit, rank));
    }
  }
  for (let rank = 1; rank <= 4; rank++) pairs.push(exact('wind', rank), exact('wind', rank));
  for (let rank = 1; rank <= 3; rank++) pairs.push(exact('dragon', rank), exact('dragon', rank));
  const flower = (rank) => ({ suit: 'flower', rank, group: 'flower' });
  const season = (rank) => ({ suit: 'season', rank, group: 'season' });
  pairs.push(
    { a: flower(1), b: flower(2) },
    { a: flower(3), b: flower(4) },
    { a: season(1), b: season(2) },
    { a: season(3), b: season(4) }
  );
  return pairs;
}

/**
 * @param {Slot[]} slots
 * @param {Pair[]} bag
 * @param {() => number} rng
 * @returns {{ faces: Face[], solution: [number, number][] }}
 */
function dealFaces(slots, bag, rng) {
  const alive = new Set(slots.map((_, index) => index));
  /** @type {Face[]} */
  const faces = new Array(slots.length);
  /** @type {[number, number][]} */
  const placed = [];
  const pool = bag.slice();
  while (alive.size > 0) {
    /** @type {number[]} */
    const free = [];
    for (const index of alive) {
      if (isOpenSlot(slots, (j) => alive.has(j), index)) free.push(index);
    }
    if (free.length < 2) throw new Error('layout has fewer than two free slots');
    const pair = pool.pop();
    if (!pair) throw new Error('not enough tile pairs for this layout');
    const [a, b] = pickTwo(free, rng);
    faces[a] = pair.a;
    faces[b] = pair.b;
    placed.push([a, b]);
    alive.delete(a);
    alive.delete(b);
  }
  return { faces, solution: placed };
}

/**
 * @param {Slot[]} slots
 * @param {number} seed
 * @returns {Game}
 */
export function createGame(slots, seed) {
  if (slots.length < 2 || slots.length % 2 !== 0) {
    throw new Error('a layout needs an even number of tiles');
  }
  if (slots.length > 144) throw new Error('a layout cannot exceed 144 tiles');
  const rng = mulberry32(seed);
  const bag = shuffle(allPairs(), rng).slice(0, slots.length / 2);
  const { faces, solution } = dealFaces(slots, bag, rng);
  /** @type {Tile[]} */
  const tiles = slots.map((slot, id) => ({
    id,
    x: slot.x,
    y: slot.y,
    z: slot.z,
    face: faces[id],
    removed: false
  }));
  return {
    tiles,
    solution,
    selectedId: null,
    history: [],
    moves: 0,
    hints: 0,
    shuffles: 0
  };
}

/**
 * @param {Tile[]} tiles
 * @param {HistoryEntry[]} history
 * @param {{ moves?: number, hints?: number, shuffles?: number }} stats
 * @returns {Game}
 */
export function hydrateGame(tiles, history, stats) {
  return {
    tiles,
    solution: [],
    selectedId: null,
    history: Array.isArray(history) ? history : [],
    moves: stats.moves || 0,
    hints: stats.hints || 0,
    shuffles: stats.shuffles || 0
  };
}

/**
 * @param {Game} state
 */
export function tilesLeft(state) {
  let count = 0;
  for (const tile of state.tiles) {
    if (!tile.removed) count += 1;
  }
  return count;
}

/**
 * @param {Game} state
 */
export function isWon(state) {
  return state.tiles.length > 0 && tilesLeft(state) === 0;
}

/**
 * @param {Tile[]} tiles
 * @returns {[number, number][]}
 */
export function matchingFreePairs(tiles) {
  /** @type {Tile[]} */
  const free = [];
  for (const tile of tiles) {
    if (!tile.removed && isFree(tiles, tile.id)) free.push(tile);
  }
  /** @type {[number, number][]} */
  const pairs = [];
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (facesMatch(free[i].face, free[j].face)) pairs.push([free[i].id, free[j].id]);
    }
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return pairs;
}

/**
 * @param {Game} state
 */
export function isStuck(state) {
  if (isWon(state)) return false;
  return matchingFreePairs(state.tiles).length === 0;
}

/**
 * @param {Game} state
 * @param {number} id
 * @returns {{ action: 'ignore' | 'blocked' | 'select' | 'deselect' | 'match', matched?: [number, number] }}
 */
export function selectTile(state, id) {
  const tile = state.tiles[id];
  if (!tile || tile.removed || tile.id !== id) return { action: 'ignore' };
  if (!isFree(state.tiles, id)) return { action: 'blocked' };
  if (state.selectedId === id) {
    state.selectedId = null;
    return { action: 'deselect' };
  }
  const selected = state.selectedId == null ? null : state.tiles[state.selectedId];
  if (!selected || selected.removed || !isFree(state.tiles, selected.id)) {
    state.selectedId = id;
    return { action: 'select' };
  }
  if (!facesMatch(selected.face, tile.face)) {
    state.selectedId = id;
    return { action: 'select' };
  }
  selected.removed = true;
  tile.removed = true;
  state.history.push({ kind: 'match', a: selected.id, b: tile.id });
  state.moves += 1;
  state.selectedId = null;
  return { action: 'match', matched: [selected.id, tile.id] };
}

/**
 * @param {Game} state
 * @returns {[number, number] | null}
 */
export function hintPair(state) {
  const pairs = matchingFreePairs(state.tiles);
  if (pairs.length === 0) return null;
  state.hints += 1;
  return pairs[0];
}

/**
 * @param {Game} state
 * @param {{ id: number, face: Face, removed: boolean }[]} snapshot
 */
function applySnapshot(state, snapshot) {
  for (const snap of snapshot) {
    const tile = state.tiles[snap.id];
    tile.face = snap.face;
    tile.removed = snap.removed;
  }
}

/**
 * Keep the tiles still on the board, but lay their faces out so the
 * remainder is solvable again. Removed tiles stay removed.
 *
 * @param {Game} state
 * @param {() => number} rng
 */
export function shuffleRemaining(state, rng) {
  const remaining = state.tiles.filter((tile) => !tile.removed);
  if (remaining.length < 2) return false;
  const snapshot = state.tiles.map((tile) => ({
    id: tile.id,
    face: tile.face,
    removed: tile.removed
  }));
  const groups = new Map();
  for (const tile of remaining) {
    const key = matchKey(tile.face);
    const list = groups.get(key);
    if (list) list.push(tile.face);
    else groups.set(key, [tile.face]);
  }
  /** @type {Pair[]} */
  const pairs = [];
  for (const list of groups.values()) {
    if (list.length % 2 !== 0) return false;
    const order = shuffle(list, rng);
    for (let i = 0; i < order.length; i += 2) {
      pairs.push({ a: order[i], b: order[i + 1] });
    }
  }
  const slots = remaining.map((tile) => ({ x: tile.x, y: tile.y, z: tile.z }));
  let dealt;
  try {
    dealt = dealFaces(slots, shuffle(pairs, rng), rng);
  } catch {
    return false;
  }
  for (let i = 0; i < remaining.length; i++) remaining[i].face = dealt.faces[i];
  state.history.push({ kind: 'shuffle', tiles: snapshot });
  state.shuffles += 1;
  state.selectedId = null;
  state.solution = dealt.solution.map(([a, b]) => [remaining[a].id, remaining[b].id]);
  return true;
}

/**
 * @param {Game} state
 */
export function undo(state) {
  const entry = state.history.pop();
  if (!entry) return false;
  if (entry.kind === 'match') {
    state.tiles[entry.a].removed = false;
    state.tiles[entry.b].removed = false;
    state.moves = Math.max(0, state.moves - 1);
  } else {
    applySnapshot(state, entry.tiles);
    state.shuffles = Math.max(0, state.shuffles - 1);
  }
  state.selectedId = null;
  return true;
}
