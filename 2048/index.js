/* 2048 — single-file ES module
 *
 * Model:
 *   The grid is a 4x4 array of Tile|null. Tile = { id, value, row, col }.
 *   Each tile has a stable DOM node keyed by id, so a "move" is just
 *   updating row/col on existing tiles (CSS transition slides them) plus
 *   removing tiles that got merged into a new doubled tile.
 *
 * Move:
 *   For each row/column in move-direction order, we walk tiles toward
 *   the target edge: equal neighbours merge once, others slide. We
 *   collect the previous board snapshot for undo BEFORE applying.
 *
 * Persistence:
 *   localStorage holds best score and the live game state so a refresh
 *   resumes mid-game. State is a plain JSON object — no schema version
 *   yet because the format is the simplest thing that round-trips.
 */

const SIZE = 4;
const STORAGE_KEY = 'g2048.state.v1';
const BEST_KEY = 'g2048.best.v1';

/** @typedef {{ id: number, value: number, row: number, col: number }} Tile */

let nextTileId = 1;

/** @type {(Tile | null)[][]} */
let grid = makeEmpty();
let score = 0;
let best = readBest();
let won = false; // user has reached 2048 at least once this game
let continueAfterWin = false; // dismissed the win overlay
/** @type {{ grid: (Tile | null)[][], score: number, won: boolean } | null} */
let lastSnapshot = null;
let isAnimating = false;

const els = {
  board: /** @type {HTMLDivElement} */ (document.getElementById('board')),
  tiles: /** @type {HTMLDivElement} */ (document.getElementById('tiles')),
  gridBg: /** @type {HTMLDivElement} */ (document.querySelector('.grid-bg')),
  score: /** @type {HTMLSpanElement} */ (document.getElementById('score')),
  scoreBox: /** @type {HTMLDivElement} */ (document.getElementById('score-box')),
  best: /** @type {HTMLSpanElement} */ (document.getElementById('best')),
  newGame: /** @type {HTMLButtonElement} */ (document.getElementById('new-game-btn')),
  undo: /** @type {HTMLButtonElement} */ (document.getElementById('undo-btn')),
  overlay: /** @type {HTMLDivElement} */ (document.getElementById('overlay')),
  overlayTitle: /** @type {HTMLDivElement} */ (document.getElementById('overlay-title')),
  overlaySub: /** @type {HTMLDivElement} */ (document.getElementById('overlay-sub')),
  overlayContinue: /** @type {HTMLButtonElement} */ (document.getElementById('overlay-continue')),
  overlayRestart: /** @type {HTMLButtonElement} */ (document.getElementById('overlay-restart'))
};

/* ── Setup ────────────────────────────────────────────────────────── */

function makeEmpty() {
  /** @type {(Tile | null)[][]} */
  const g = [];
  for (let r = 0; r < SIZE; r++) {
    g.push(new Array(SIZE).fill(null));
  }
  return g;
}

function buildGridBackground() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell-bg';
    frag.appendChild(cell);
  }
  els.gridBg.appendChild(frag);
}

/* ── Tile DOM ─────────────────────────────────────────────────────── */

function tilePosTransform(row, col) {
  // translate3d nudges browsers to put the tile on the GPU compositor
  // so the slide stays at 60fps even with 16 tiles in flight on a
  // mid-range phone. The math is identical to translate() on x/y.
  const x = `calc((var(--cell-size) + var(--gap)) * ${col})`;
  const y = `calc((var(--cell-size) + var(--gap)) * ${row})`;
  return `translate3d(${x}, ${y}, 0)`;
}

/**
 * @param {Tile} tile
 * @param {{ appear?: boolean, merged?: boolean }} [opts]
 */
function createTileEl(tile, opts) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.id = String(tile.id);
  // The inner node carries the appear/merge scale animations. Keeping them
  // off the outer node matters: an animation outranks inline styles, so a
  // scale animation sharing `transform` with the slide would pin the tile to
  // its birth cell for good and turn every later move into a teleport.
  el.appendChild(document.createElement('div')).className = 'tile-inner';
  applyTileStyle(el, tile);
  el.style.transform = tilePosTransform(tile.row, tile.col);
  if (opts?.appear) el.classList.add('appear');
  if (opts?.merged) el.classList.add('merged');
  els.tiles.appendChild(el);
  return el;
}

/**
 * @param {HTMLDivElement} el
 * @param {Tile} tile
 */
function applyTileStyle(el, tile) {
  el.dataset.value = String(tile.value);
  if (tile.value > 2048) {
    el.classList.add('super');
  } else {
    el.classList.remove('super');
  }
  const inner = el.querySelector('.tile-inner');
  if (inner) inner.textContent = String(tile.value);
}

/**
 * @param {Tile} tile
 */
function tileEl(tile) {
  return /** @type {HTMLDivElement | null} */ (
    els.tiles.querySelector(`.tile[data-id="${tile.id}"]`)
  );
}

/* ── Render ───────────────────────────────────────────────────────── */

function renderAll() {
  els.tiles.replaceChildren();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      if (t) createTileEl(t);
    }
  }
  updateScore();
}

function updateScore() {
  els.score.textContent = String(score);
  if (score > best) {
    best = score;
    writeBest(best);
  }
  els.best.textContent = String(best);
  els.undo.disabled = !lastSnapshot;
}

/**
 * @param {number} delta
 */
function flashScoreDelta(delta) {
  if (delta <= 0) return;
  const node = document.createElement('div');
  node.className = 'score-delta';
  node.textContent = '+' + delta;
  els.scoreBox.appendChild(node);
  setTimeout(() => node.remove(), 700);
}

/* ── Random tile spawning ─────────────────────────────────────────── */

/**
 * @returns {{ row: number, col: number } | null}
 */
function pickEmptyCell() {
  /** @type {{ row: number, col: number }[]} */
  const empties = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid[r][c]) empties.push({ row: r, col: c });
    }
  }
  if (empties.length === 0) return null;
  return empties[Math.floor(Math.random() * empties.length)];
}

function spawnTile() {
  const cell = pickEmptyCell();
  if (!cell) return null;
  const value = Math.random() < 0.9 ? 2 : 4;
  const tile = { id: nextTileId++, value, row: cell.row, col: cell.col };
  grid[cell.row][cell.col] = tile;
  createTileEl(tile, { appear: true });
  return tile;
}

/* ── Move logic ───────────────────────────────────────────────────── */

/**
 * Compact a single line (array of Tile|null, length SIZE) toward index 0.
 * Returns { line: new packed line, gained: score gained, moved: bool, mergedIds: Set<number> }.
 *
 * This is the canonical 2048 step: walk left-to-right, push each tile
 * into the next free slot; if the new neighbour matches and isn't
 * already a merge product this step, fuse them.
 *
 * @param {(Tile | null)[]} line
 */
function compactLine(line) {
  /** @type {Tile[]} */
  const packed = [];
  let gained = 0;
  let moved = false;
  /** @type {Set<number>} */
  const mergedIds = new Set();
  /** @type {Map<number, number>} */
  const consumedBy = new Map();
  let mergedThisStep = false;

  for (let i = 0; i < line.length; i++) {
    const t = line[i];
    if (!t) continue;
    // mergedIds.has(packed[last].id) ⇒ the last packed slot is the
    // result of an in-step merge; canonical 2048 rules forbid merging
    // it again until the next move, so we treat it as inert.
    if (
      packed.length > 0 &&
      packed[packed.length - 1].value === t.value &&
      !mergedIds.has(packed[packed.length - 1].id)
    ) {
      // Merge: the previous packed tile takes the doubled value and
      // a new identity. The current tile is consumed (will be deleted
      // post-animation) — we record which winner consumed it so the
      // animation can slide its DOM node onto the winner's slot.
      const winner = packed[packed.length - 1];
      const newValue = winner.value * 2;
      const merged = { id: nextTileId++, value: newValue, row: 0, col: 0 };
      // Mark `winner` as consumed in the same step (it morphs into
      // the new tile) by recording it in consumedBy.
      consumedBy.set(winner.id, merged.id);
      consumedBy.set(t.id, merged.id);
      packed[packed.length - 1] = merged;
      mergedIds.add(merged.id);
      gained += newValue;
      moved = true;
      mergedThisStep = true;
    } else {
      packed.push(t);
    }
  }
  // Detect a translation-only move: any tile that ended up at a
  // different array index has moved.
  if (!mergedThisStep) {
    let nonNullIndex = 0;
    for (let i = 0; i < line.length; i++) {
      const t = line[i];
      if (!t) continue;
      if (i !== nonNullIndex) {
        moved = true;
        break;
      }
      nonNullIndex++;
    }
  }

  // Pad packed back out to SIZE.
  /** @type {(Tile | null)[]} */
  const result = [];
  for (let i = 0; i < SIZE; i++) {
    result.push(packed[i] ?? null);
  }

  return { line: result, gained, moved, mergedIds, consumedBy };
}

/**
 * Extract the line of tiles to compact for a given direction. The
 * returned line is ordered such that index 0 is the "leading edge" —
 * compactLine always pushes toward index 0.
 *
 * @param {'left' | 'right' | 'up' | 'down'} dir
 * @param {number} idx
 */
function extractLine(dir, idx) {
  /** @type {(Tile | null)[]} */
  const line = [];
  if (dir === 'left') {
    for (let c = 0; c < SIZE; c++) line.push(grid[idx][c]);
  } else if (dir === 'right') {
    for (let c = SIZE - 1; c >= 0; c--) line.push(grid[idx][c]);
  } else if (dir === 'up') {
    for (let r = 0; r < SIZE; r++) line.push(grid[r][idx]);
  } else {
    for (let r = SIZE - 1; r >= 0; r--) line.push(grid[r][idx]);
  }
  return line;
}

/**
 * Write a packed line (length SIZE) back into the grid, in the same
 * orientation extractLine used. Also updates each tile's row/col so
 * the post-move position transforms reflect the new layout.
 *
 * @param {'left' | 'right' | 'up' | 'down'} dir
 * @param {number} idx
 * @param {(Tile | null)[]} line
 */
function writeLine(dir, idx, line) {
  for (let i = 0; i < SIZE; i++) {
    const t = line[i];
    let r;
    let c;
    if (dir === 'left') {
      r = idx;
      c = i;
    } else if (dir === 'right') {
      r = idx;
      c = SIZE - 1 - i;
    } else if (dir === 'up') {
      r = i;
      c = idx;
    } else {
      r = SIZE - 1 - i;
      c = idx;
    }
    grid[r][c] = t;
    if (t) {
      t.row = r;
      t.col = c;
    }
  }
}

/**
 * @param {'left' | 'right' | 'up' | 'down'} dir
 */
function move(dir) {
  // Match the canonical game's termination guard: while the win/game-over
  // prompt is asking for a decision, directional input must not mutate the
  // board behind it. Undo remains available as an explicit escape hatch.
  if (isAnimating || !els.overlay.hidden) return;
  const snapshot = snapshotGrid();
  // Clear the previous grid array; we'll overwrite each line below.
  /** @type {(Tile | null)[][]} */
  const newGrid = makeEmpty();
  let gained = 0;
  let anyMoved = false;
  /** @type {Set<number>} */
  const mergedTileIds = new Set();
  /** @type {Map<number, number>} */
  const consumedByMap = new Map();

  for (let i = 0; i < SIZE; i++) {
    const line = extractLine(dir, i);
    const out = compactLine(line);
    if (out.moved) anyMoved = true;
    gained += out.gained;
    for (const id of out.mergedIds) mergedTileIds.add(id);
    for (const [k, v] of out.consumedBy) consumedByMap.set(k, v);

    // Write packed line into newGrid using the same orientation.
    for (let j = 0; j < SIZE; j++) {
      const t = out.line[j];
      if (!t) continue;
      let r;
      let c;
      if (dir === 'left') {
        r = i;
        c = j;
      } else if (dir === 'right') {
        r = i;
        c = SIZE - 1 - j;
      } else if (dir === 'up') {
        r = j;
        c = i;
      } else {
        r = SIZE - 1 - j;
        c = i;
      }
      newGrid[r][c] = t;
      t.row = r;
      t.col = c;
    }
  }

  if (!anyMoved) return;

  // The merge logic above creates new tile objects for each merge, but
  // they have no DOM node yet. Animate the consumed tiles onto the
  // winner's position, then on transition end swap them out for a
  // freshly-created merged tile node (so the merge "pop" animation
  // runs cleanly without inheriting any in-flight transforms).
  lastSnapshot = snapshot;
  grid = newGrid;
  score += gained;
  flashScoreDelta(gained);

  // Animate: for each tile that exists in the new grid AND already had
  // a DOM node, update its transform. For consumed tiles, find the
  // winning merged tile's position and slide them there too — they
  // get removed once the merge tile pops.
  isAnimating = true;
  /** @type {Map<number, Tile>} */
  const newTilesById = new Map();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      if (t) newTilesById.set(t.id, t);
    }
  }

  // Slide existing tiles that survived the move.
  for (const t of newTilesById.values()) {
    if (mergedTileIds.has(t.id)) continue; // brand-new merged tile
    const el = tileEl(t);
    if (!el) continue;
    el.style.transform = tilePosTransform(t.row, t.col);
  }

  // Slide consumed tiles onto the merge winner's position so the merge
  // looks like two tiles sliding into one.
  for (const [consumedId, winnerId] of consumedByMap) {
    const el = els.tiles.querySelector(`.tile[data-id="${consumedId}"]`);
    if (!el) continue;
    const winner = newTilesById.get(winnerId);
    if (!winner) {
      el.remove();
      continue;
    }
    /** @type {HTMLDivElement} */ (el).style.transform = tilePosTransform(winner.row, winner.col);
  }

  // After the slide settles, drop consumed tile nodes and spawn the
  // new merged tile DOM with its pop animation. Then check end-state.
  setTimeout(() => {
    for (const consumedId of consumedByMap.keys()) {
      const el = els.tiles.querySelector(`.tile[data-id="${consumedId}"]`);
      if (el) el.remove();
    }
    for (const id of mergedTileIds) {
      const t = newTilesById.get(id);
      if (!t) continue;
      createTileEl(t, { merged: true });
    }
    // A 4096 tile can only be born from a merge, so scanning this move's
    // merged tiles is enough — no need to walk the whole board.
    for (const id of mergedTileIds) {
      const t = newTilesById.get(id);
      if (t && t.value >= 4096) {
        window.heymingAchievements?.unlockForCurrentApp('4096');
        break;
      }
    }
    // Spawn a new tile and re-evaluate.
    spawnTile();
    updateScore();
    persistState();
    isAnimating = false;

    if (!won && hasValue(2048)) {
      won = true;
      window.heymingAchievements?.unlockForCurrentApp('first-action');
      if (!continueAfterWin) {
        showOverlay({ kind: 'win' });
      }
    } else if (!hasMoves()) {
      clearPersistedState();
      showOverlay({ kind: 'lose' });
    }
  }, 180);
}

/* ── End-state ────────────────────────────────────────────────────── */

/**
 * @param {number} value
 */
function hasValue(value) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      if (t && t.value >= value) return true;
    }
  }
  return false;
}

function hasMoves() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      if (!t) return true;
      if (c + 1 < SIZE) {
        const n = grid[r][c + 1];
        if (!n || n.value === t.value) return true;
      }
      if (r + 1 < SIZE) {
        const n = grid[r + 1][c];
        if (!n || n.value === t.value) return true;
      }
    }
  }
  return false;
}

/* ── Overlay ──────────────────────────────────────────────────────── */

/**
 * @param {{ kind: 'win' | 'lose' }} opts
 */
function showOverlay(opts) {
  els.overlay.classList.toggle('win', opts.kind === 'win');
  if (opts.kind === 'win') {
    els.overlayTitle.textContent = 'You Win!';
    els.overlaySub.textContent = 'You reached 2048. Keep going for an even higher score?';
    els.overlayContinue.hidden = false;
    els.overlayRestart.textContent = 'New Game';
  } else {
    els.overlayTitle.textContent = 'Game Over';
    els.overlaySub.textContent = `No moves left. Final score: ${score}`;
    els.overlayContinue.hidden = true;
    els.overlayRestart.textContent = 'Try Again';
  }
  els.overlay.hidden = false;
}

function hideOverlay() {
  els.overlay.hidden = true;
  els.overlay.classList.remove('win');
}

/* ── Snapshot / undo ──────────────────────────────────────────────── */

function snapshotGrid() {
  /** @type {(Tile | null)[][]} */
  const out = [];
  for (let r = 0; r < SIZE; r++) {
    /** @type {(Tile | null)[]} */
    const row = [];
    for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      row.push(t ? { id: t.id, value: t.value, row: t.row, col: t.col } : null);
    }
    out.push(row);
  }
  return { grid: out, score, won };
}

function undo() {
  if (!lastSnapshot || isAnimating) return;
  grid = lastSnapshot.grid.map((row) => row.map((t) => (t ? { ...t } : null)));
  score = lastSnapshot.score;
  won = lastSnapshot.won;
  lastSnapshot = null;
  hideOverlay();
  // Make sure tile ids stay above any restored tile id so future
  // merges don't collide with restored ones.
  let maxId = 0;
  for (const row of grid) for (const t of row) if (t && t.id > maxId) maxId = t.id;
  if (nextTileId <= maxId) nextTileId = maxId + 1;
  renderAll();
  persistState();
}

/* ── Persistence ──────────────────────────────────────────────────── */

function readBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {number} value
 */
function writeBest(value) {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage may be disabled (private mode etc); best score becomes
    // session-local in that case, which is fine.
  }
}

function persistState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        grid,
        score,
        won,
        continueAfterWin,
        nextTileId
      })
    );
  } catch {
    // Storage full or disabled — drop the autosave silently.
  }
}

function clearPersistedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage disabled — there is no persisted state to clear.
  }
}

/**
 * @returns {boolean} whether a saved state was restored
 */
function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.grid)) return false;
    grid = data.grid.map((/** @type {(Tile | null)[]} */ row) =>
      row.map((/** @type {Tile | null} */ t) => (t ? { ...t } : null))
    );
    score = typeof data.score === 'number' ? data.score : 0;
    won = !!data.won;
    continueAfterWin = !!data.continueAfterWin;
    if (typeof data.nextTileId === 'number') nextTileId = data.nextTileId;
    return true;
  } catch {
    return false;
  }
}

/* ── New game ─────────────────────────────────────────────────────── */

function newGame() {
  hideOverlay();
  grid = makeEmpty();
  score = 0;
  won = false;
  continueAfterWin = false;
  lastSnapshot = null;
  nextTileId = 1;
  els.tiles.replaceChildren();
  spawnTile();
  spawnTile();
  updateScore();
  persistState();
}

/* ── Input ────────────────────────────────────────────────────────── */

const keyMap = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyH: 'left',
  KeyL: 'right',
  KeyK: 'up',
  KeyJ: 'down'
};

// Legacy arrow names, still what some embedded and older WebKit builds put
// in `key`. The PS5 system web view sends its D-pad as key events, but its
// exact field values still need to be captured.
const LEGACY_ARROWS = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight'
};

const LEGACY_KEY_CODES = {
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown'
};

/**
 * Resolve a move direction from a key event across engines that disagree
 * about which field carries the arrow. `code` is the modern answer, but some
 * browsers leave it empty and report only `key` — occasionally under the
 * legacy `Up` / `Down` names — or nothing but the deprecated `keyCode`.
 *
 * @param {KeyboardEvent} ev
 * @returns {'left' | 'right' | 'up' | 'down' | null}
 */
function directionFromKey(ev) {
  const { code, key, keyCode } = ev;

  const candidates = [code, key, LEGACY_ARROWS[key], LEGACY_KEY_CODES[keyCode]];
  // A bare letter in `key` belongs to the WASD / HJKL bindings, which are
  // named by physical code ('a' → 'KeyA').
  if (key && /^[a-zA-Z]$/.test(key)) candidates.push('Key' + key.toUpperCase());

  for (const name of candidates) {
    if (name && keyMap[name]) return keyMap[name];
  }
  return null;
}

/**
 * @param {KeyboardEvent} ev
 */
function onKeyDown(ev) {
  const hasModifier = ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey;
  if (
    !hasModifier &&
    (ev.code === 'KeyR' || ev.key === 'r' || ev.key === 'R' || ev.keyCode === 82)
  ) {
    ev.preventDefault();
    newGame();
    return;
  }

  if (ev.metaKey || ev.ctrlKey) {
    if (ev.code === 'KeyZ' || ev.key === 'z' || ev.key === 'Z') {
      ev.preventDefault();
      undo();
    }
    return;
  }
  const dir = directionFromKey(ev);
  if (!dir) return;
  ev.preventDefault();
  move(dir);
}

/* Touch / swipe.
 *
 * The board has touch-action: none so the browser won't claim the
 * gesture for scroll/pinch/pull-to-refresh. While the user is mid-
 * gesture we also paint a small rubber-banded preview offset on the
 * .tiles container — it tilts up to MAX_DRAG_PX in the dominant axis
 * so the player feels resistance before the move actually fires. On
 * release we clear the preview (CSS transitions snap it back) and
 * trigger the real move animation. */
const SWIPE_THRESHOLD = 18;
const MAX_DRAG_PX = 14;
const RUBBER_BAND = 0.22;

/** @type {{ x: number, y: number, axis: 'x' | 'y' | null } | null} */
let touchStart = null;

function rubberBand(distance) {
  // sub-linear easing so the preview slows down the further you push.
  // distance is signed; we apply rubberBand in absolute then re-sign.
  const sign = Math.sign(distance);
  const abs = Math.abs(distance);
  const eased = Math.min(MAX_DRAG_PX, abs * RUBBER_BAND);
  return sign * eased;
}

function clearDragPreview() {
  els.tiles.classList.remove('dragging');
  els.tiles.style.removeProperty('--drag-x');
  els.tiles.style.removeProperty('--drag-y');
}

/**
 * @param {TouchEvent} ev
 */
function onTouchStart(ev) {
  if (ev.touches.length !== 1) return;
  const t = ev.touches[0];
  touchStart = { x: t.clientX, y: t.clientY, axis: null };
  els.tiles.classList.add('dragging');
}

/**
 * @param {TouchEvent} ev
 */
function onTouchMove(ev) {
  if (!touchStart) return;
  const t = ev.touches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  // Lock the axis as soon as one component clears a small dead-zone,
  // so a slightly diagonal swipe still feels like a clean horizontal
  // or vertical drag.
  if (!touchStart.axis) {
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      touchStart.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
  }
  if (touchStart.axis === 'x') {
    els.tiles.style.setProperty('--drag-x', `${rubberBand(dx)}px`);
    els.tiles.style.setProperty('--drag-y', '0px');
  } else if (touchStart.axis === 'y') {
    els.tiles.style.setProperty('--drag-x', '0px');
    els.tiles.style.setProperty('--drag-y', `${rubberBand(dy)}px`);
  }
}

/**
 * @param {TouchEvent} ev
 */
function onTouchEnd(ev) {
  if (!touchStart) return;
  const t = ev.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const axis = touchStart.axis;
  touchStart = null;
  clearDragPreview();
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) < SWIPE_THRESHOLD) return;
  // Honor the axis we locked during touchmove so a swipe that drifts
  // a little off-axis at the end still resolves to the original
  // direction the user was committing to.
  if (axis === 'x' || (!axis && absX > absY)) {
    move(dx > 0 ? 'right' : 'left');
  } else {
    move(dy > 0 ? 'down' : 'up');
  }
}

function onTouchCancel() {
  touchStart = null;
  clearDragPreview();
}

/* ── Init ─────────────────────────────────────────────────────────── */

function init() {
  buildGridBackground();

  const restored = restoreState();
  if (!restored || isEmptyGrid()) {
    newGame();
  } else {
    renderAll();
    if (won && !continueAfterWin) {
      // User reloaded mid-celebration; let them pick up where they left off.
      // The win overlay would be obnoxious on every refresh, so suppress
      // it and treat the win as already acknowledged.
      continueAfterWin = true;
      persistState();
    }
    if (!hasMoves()) showOverlay({ kind: 'lose' });
  }

  document.addEventListener('keydown', onKeyDown);
  // touch-action: none on .board already blocks browser-level scroll
  // hijack, so passive listeners are fine and keep the touchmove
  // pipeline cheap on phones.
  els.board.addEventListener('touchstart', onTouchStart, { passive: true });
  els.board.addEventListener('touchmove', onTouchMove, { passive: true });
  els.board.addEventListener('touchend', onTouchEnd, { passive: true });
  els.board.addEventListener('touchcancel', onTouchCancel);

  els.newGame.addEventListener('click', () => newGame());
  els.undo.addEventListener('click', () => undo());
  els.overlayContinue.addEventListener('click', () => {
    continueAfterWin = true;
    hideOverlay();
    persistState();
  });
  els.overlayRestart.addEventListener('click', () => newGame());

  els.board.focus();
}

function isEmptyGrid() {
  for (const row of grid) for (const t of row) if (t) return false;
  return true;
}

init();
