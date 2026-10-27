/* Board, clock, and controls. The rules live in engine.js. */

import { faceLabel, faceMarkup } from './faces.js';
import { LAYOUTS, layoutById } from './layouts.js';
import {
  createGame,
  hintPair,
  hydrateGame,
  isFree,
  isStuck,
  isWon,
  selectTile,
  shuffleRemaining,
  tilesLeft,
  undo,
  mulberry32
} from './engine.js';

const SAVE_KEY = 'mahjongg.game.v1';
const BEST_KEY = 'mahjongg.best.v1';
const HINT_MS = 15000;
const TILE_ASPECT = 1.22;
const MIN_UNIT = 18;

const board = /** @type {HTMLDivElement} */ (document.getElementById('board'));
const scroll = /** @type {HTMLDivElement} */ (document.getElementById('table-scroll'));
const layoutSelect = /** @type {HTMLSelectElement} */ (document.getElementById('layout'));
const timeEl = /** @type {HTMLElement} */ (document.getElementById('time'));
const timeBox = /** @type {HTMLElement} */ (document.getElementById('time-box'));
const leftEl = /** @type {HTMLElement} */ (document.getElementById('left'));
const bestEl = /** @type {HTMLElement} */ (document.getElementById('best'));
const undoBtn = /** @type {HTMLButtonElement} */ (document.getElementById('undo'));
const hintBtn = /** @type {HTMLButtonElement} */ (document.getElementById('hint'));
const shuffleBtn = /** @type {HTMLButtonElement} */ (document.getElementById('shuffle'));
const newBtn = /** @type {HTMLButtonElement} */ (document.getElementById('new-game'));
const overlay = /** @type {HTMLDivElement} */ (document.getElementById('overlay'));
const overlayTitle = /** @type {HTMLElement} */ (document.getElementById('overlay-title'));
const overlaySub = /** @type {HTMLElement} */ (document.getElementById('overlay-sub'));
const overlayPrimary = /** @type {HTMLButtonElement} */ (
  document.getElementById('overlay-primary')
);
const overlaySecondary = /** @type {HTMLButtonElement} */ (
  document.getElementById('overlay-secondary')
);
const live = /** @type {HTMLElement} */ (document.getElementById('live'));

/** @type {import('./engine.js').Game} */
let game;
let currentLayout = 'turtle';
let seed = 1;
let elapsedMs = 0;
let penaltyMs = 0;
let clockStarted = false;
let timerOn = false;
let tickStart = 0;
let animating = false;
/** @type {'win' | 'stuck' | 'confirm' | null} */
let overlayMode = null;
let pendingLayout = 'turtle';
let hintTimer = 0;

function freshSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
}

/**
 * @param {number} ms
 */
function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function displayedMs() {
  const running = timerOn ? performance.now() - tickStart : 0;
  return elapsedMs + running + penaltyMs;
}

function freezeClock() {
  if (!timerOn) return;
  elapsedMs += performance.now() - tickStart;
  timerOn = false;
}

function overlayOpen() {
  return !overlay.hidden;
}

function resumeClock() {
  if (timerOn || !clockStarted || isWon(game) || overlayOpen()) return;
  tickStart = performance.now();
  timerOn = true;
}

function startClock() {
  clockStarted = true;
  resumeClock();
}

/** @returns {Record<string, number>} */
function readBests() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * @param {number} ms
 */
function rememberBest(ms) {
  const bests = readBests();
  const previous = bests[currentLayout];
  if (typeof previous === 'number' && previous <= ms) return false;
  bests[currentLayout] = Math.round(ms);
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(bests));
  } catch {
    /* private mode */
  }
  return true;
}

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return null;
    const layout = layoutById(data.layoutId);
    if (!layout || !Array.isArray(data.tiles)) return null;
    if (data.tiles.length !== layout.slots.length) return null;
    for (let i = 0; i < data.tiles.length; i++) {
      const tile = data.tiles[i];
      const slot = layout.slots[i];
      if (!tile || tile.id !== i || !tile.face) return null;
      if (tile.x !== slot.x || tile.y !== slot.y || tile.z !== slot.z) return null;
      if (typeof tile.removed !== 'boolean') return null;
    }
    return data;
  } catch {
    return null;
  }
}

function persist() {
  const payload = {
    v: 1,
    layoutId: currentLayout,
    seed,
    tiles: game.tiles,
    history: game.history,
    moves: game.moves,
    hints: game.hints,
    shuffles: game.shuffles,
    penaltyMs,
    elapsedMs: timerOn ? elapsedMs + (performance.now() - tickStart) : elapsedMs,
    clockStarted
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode */
  }
}

function bounds(slots) {
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;
  for (const slot of slots) {
    if (slot.x + 2 > maxX) maxX = slot.x + 2;
    if (slot.y + 2 > maxY) maxY = slot.y + 2;
    if (slot.z > maxZ) maxZ = slot.z;
  }
  return { maxX, maxY, maxZ };
}

function measure(slots) {
  const { maxX, maxY, maxZ } = bounds(slots);
  const style = getComputedStyle(scroll);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const availW = Math.max(160, scroll.clientWidth - (Number.isFinite(padX) ? padX : 0));
  const top = scroll.getBoundingClientRect().top;
  const availH = Math.max(180, window.innerHeight - top - 28);
  const spanX = maxX / 2 + maxZ * 0.08;
  const spanY = (maxY / 2) * TILE_ASPECT + maxZ * TILE_ASPECT * 0.1;
  let tileW = Math.floor((availW - 8) / spanX);
  const tileWFromH = Math.floor((availH - 8) / spanY);
  if (tileWFromH > 0 && tileWFromH < tileW) tileW = tileWFromH;
  if (tileW < MIN_UNIT * 2) tileW = MIN_UNIT * 2;
  if (tileW % 2 !== 0) tileW -= 1;
  const tileH = Math.round(tileW * TILE_ASPECT);
  const liftX = Math.max(2, Math.round(tileW * 0.08));
  const liftY = Math.max(3, Math.round(tileH * 0.1));
  const originX = maxZ * liftX + 2;
  const originY = maxZ * liftY + 2;
  const boardW = originX + (maxX / 2) * tileW + 4;
  const boardH = originY + (maxY / 2) * tileH + 4;
  return { tileW, tileH, liftX, liftY, originX, originY, boardW, boardH, availW };
}

/**
 * @param {import('./engine.js').Tile} tile
 * @param {ReturnType<typeof measure>} metrics
 * @param {boolean} exiting
 * @param {boolean} dealt
 */
function tileButton(tile, metrics, exiting, dealt) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tile';
  if (exiting) btn.classList.add('removing');
  else if (dealt) btn.classList.add('dealt');
  if (tile.id === game.selectedId) btn.classList.add('selected');
  btn.dataset.id = String(tile.id);
  const free = !exiting && isFree(game.tiles, tile.id);
  btn.dataset.free = free ? 'true' : 'false';
  btn.tabIndex = free ? 0 : -1;
  btn.setAttribute('aria-pressed', tile.id === game.selectedId ? 'true' : 'false');
  btn.setAttribute('aria-label', `${faceLabel(tile.face)}, ${free ? 'free' : 'blocked'}`);
  const left = metrics.originX + (tile.x / 2) * metrics.tileW - tile.z * metrics.liftX;
  const top = metrics.originY + (tile.y / 2) * metrics.tileH - tile.z * metrics.liftY;
  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
  btn.style.width = `${metrics.tileW}px`;
  btn.style.height = `${metrics.tileH}px`;
  btn.style.zIndex = String(tile.id === game.selectedId ? 8000 : tile.z * 100 + tile.y);
  const face = document.createElement('span');
  face.className = 'tile-face';
  face.innerHTML = faceMarkup(tile.face);
  btn.appendChild(face);
  return btn;
}

/**
 * @param {{ exiting?: number[], dealt?: boolean }} [options]
 */
function render(options = {}) {
  const layout = layoutById(currentLayout);
  if (!layout) return;
  const exiting = new Set(options.exiting || []);
  const metrics = measure(layout.slots);
  board.style.width = `${metrics.boardW}px`;
  board.style.height = `${metrics.boardH}px`;
  const center = metrics.boardW <= metrics.availW;
  board.style.marginLeft = center ? 'auto' : '0';
  board.style.marginRight = center ? 'auto' : '0';
  const frag = document.createDocumentFragment();
  const ordered = game.tiles.slice().sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  for (const tile of ordered) {
    if (tile.removed && !exiting.has(tile.id)) continue;
    frag.appendChild(tileButton(tile, metrics, exiting.has(tile.id), options.dealt === true));
  }
  board.replaceChildren(frag);
}

/**
 * @param {number} id
 * @returns {HTMLButtonElement | null}
 */
function tileEl(id) {
  return board.querySelector(`[data-id="${id}"]`);
}

function updateHud() {
  timeEl.textContent = formatTime(displayedMs());
  leftEl.textContent = String(tilesLeft(game));
  const best = readBests()[currentLayout];
  bestEl.textContent = typeof best === 'number' ? formatTime(best) : '—';
  undoBtn.disabled = game.history.length === 0;
  const over = isWon(game);
  hintBtn.disabled = over;
  shuffleBtn.disabled = over || tilesLeft(game) < 2;
}

function updateTime() {
  if (!timerOn) return;
  timeEl.textContent = formatTime(displayedMs());
}

/**
 * @param {'win' | 'stuck' | 'confirm'} mode
 * @param {{ ms?: number, isBest?: boolean }} [info]
 */
function showOverlay(mode, info = {}) {
  overlayMode = mode;
  freezeClock();
  overlay.hidden = false;
  if (mode === 'win') {
    const ms = info.ms || 0;
    overlayTitle.textContent = 'Cleared';
    overlaySub.textContent = info.isBest
      ? `Cleared in ${formatTime(ms)}. That's the best time for this layout.`
      : `Cleared in ${formatTime(ms)}.`;
    overlayPrimary.textContent = 'Play again';
    overlaySecondary.hidden = true;
  } else if (mode === 'stuck') {
    overlayTitle.textContent = 'No moves left';
    overlaySub.textContent = 'Shuffle the remaining tiles, undo, or deal again.';
    overlayPrimary.textContent = 'Shuffle';
    overlaySecondary.hidden = false;
    overlaySecondary.textContent = 'New game';
  } else {
    overlayTitle.textContent = 'New game?';
    overlaySub.textContent = 'The current board will be replaced.';
    overlayPrimary.textContent = 'New game';
    overlaySecondary.hidden = false;
    overlaySecondary.textContent = 'Keep playing';
  }
  overlayPrimary.focus();
}

function hideOverlay() {
  overlay.hidden = true;
  overlayMode = null;
  resumeClock();
}

function finishIfNeeded() {
  if (isWon(game)) {
    freezeClock();
    const ms = displayedMs();
    const previous = readBests()[currentLayout];
    const isBest = typeof previous !== 'number' || ms < previous;
    rememberBest(ms);
    showOverlay('win', { ms, isBest });
    updateHud();
    persist();
    live.textContent = `Cleared in ${formatTime(ms)}.`;
    return;
  }
  if (isStuck(game)) {
    showOverlay('stuck');
    updateHud();
    persist();
    live.textContent = 'No moves left.';
  }
}

/**
 * @param {string} layoutId
 */
function start(layoutId) {
  const layout = layoutById(layoutId) || layoutById('turtle');
  if (!layout) return;
  currentLayout = layout.id;
  layoutSelect.value = layout.id;
  seed = freshSeed();
  game = createGame(layout.slots, seed);
  elapsedMs = 0;
  penaltyMs = 0;
  clockStarted = false;
  timerOn = false;
  animating = false;
  window.clearTimeout(hintTimer);
  overlay.hidden = true;
  overlayMode = null;
  render({ dealt: true });
  updateHud();
  persist();
  live.textContent = `${layout.name} dealt. ${layout.slots.length} tiles.`;
}

/**
 * @param {string} layoutId
 */
function requestNew(layoutId) {
  if (game && game.moves > 0 && !isWon(game) && !isStuck(game)) {
    pendingLayout = layoutId;
    layoutSelect.value = currentLayout;
    showOverlay('confirm');
    return;
  }
  start(layoutId);
}

/**
 * @param {number} id
 */
function shake(id) {
  const el = tileEl(id);
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

/**
 * Prefer a free tile in the direction of travel. Score is distance plus a
 * penalty for being off-axis, so a diagonal only wins when nothing sits
 * closer to the arrow.
 *
 * @param {number} id
 * @param {number} dx
 * @param {number} dy
 */
function neighbor(id, dx, dy) {
  const from = game.tiles[id];
  if (!from) return null;
  let best = null;
  let bestScore = Infinity;
  for (const tile of game.tiles) {
    if (tile.removed || tile.id === id || !isFree(game.tiles, tile.id)) continue;
    const vx = tile.x - from.x;
    const vy = tile.y - from.y;
    if (vx * dx + vy * dy <= 0) continue;
    const score = Math.hypot(vx, vy) + Math.abs(vx * dy - vy * dx) * 3;
    if (score < bestScore) {
      bestScore = score;
      best = tile.id;
    }
  }
  return best;
}

function topFree() {
  let best = null;
  for (const tile of game.tiles) {
    if (tile.removed || !isFree(game.tiles, tile.id)) continue;
    if (
      !best ||
      tile.z > best.z ||
      (tile.z === best.z && (tile.y < best.y || (tile.y === best.y && tile.x < best.x)))
    ) {
      best = tile;
    }
  }
  return best ? best.id : null;
}

/**
 * @param {number} id
 */
function onPick(id) {
  if (animating || overlayOpen()) return;
  const hadTileFocus = document.activeElement?.classList.contains('tile') === true;
  const result = selectTile(game, id);
  if (result.action === 'blocked') {
    const tile = game.tiles[id];
    live.textContent = tile
      ? `${faceLabel(tile.face)} is blocked. Clear a side, or the tiles above it.`
      : 'That tile is blocked.';
    shake(id);
    return;
  }
  if (result.action === 'ignore') return;
  startClock();
  if (result.action === 'match' && result.matched) {
    const [a, b] = result.matched;
    live.textContent = `Matched ${faceLabel(game.tiles[a].face)}. ${tilesLeft(game)} tiles left.`;
    animating = true;
    render({ exiting: result.matched });
    window.setTimeout(() => {
      animating = false;
      render();
      if (hadTileFocus) {
        const next = neighbor(a, 1, 0) ?? neighbor(a, -1, 0) ?? topFree();
        if (next != null) tileEl(next)?.focus();
      }
      updateHud();
      persist();
      finishIfNeeded();
    }, 190);
    return;
  }
  render();
  const focusId = game.selectedId == null ? id : game.selectedId;
  if (hadTileFocus) tileEl(focusId)?.focus();
  updateHud();
  persist();
}

function doUndo() {
  if (animating || !undo(game)) return;
  hideOverlay();
  render();
  updateHud();
  persist();
  live.textContent = 'Undid the last move.';
}

function doShuffle() {
  if (animating || isWon(game)) return;
  const rng = mulberry32(freshSeed());
  if (!shuffleRemaining(game, rng)) {
    live.textContent = 'Could not shuffle the remaining tiles.';
    return;
  }
  startClock();
  overlay.hidden = true;
  overlayMode = null;
  resumeClock();
  render({ dealt: true });
  updateHud();
  persist();
  live.textContent = 'Tiles shuffled.';
}

function doHint() {
  if (animating || isWon(game)) return;
  const pair = hintPair(game);
  if (!pair) {
    showOverlay('stuck');
    persist();
    live.textContent = 'No moves left.';
    return;
  }
  penaltyMs += HINT_MS;
  startClock();
  timeBox.classList.remove('penalized');
  void timeBox.offsetWidth;
  timeBox.classList.add('penalized');
  render();
  for (const id of pair) tileEl(id)?.classList.add('hint');
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    for (const id of pair) tileEl(id)?.classList.remove('hint');
  }, 1800);
  updateHud();
  persist();
  live.textContent = `Hint: ${faceLabel(game.tiles[pair[0]].face)}. Fifteen seconds added.`;
}

function onOverlayPrimary() {
  if (overlayMode === 'stuck') {
    doShuffle();
    return;
  }
  const layout = overlayMode === 'confirm' ? pendingLayout : currentLayout;
  start(layout);
}

function onOverlaySecondary() {
  if (overlayMode === 'stuck') {
    start(currentLayout);
    return;
  }
  hideOverlay();
  layoutSelect.value = currentLayout;
}

/**
 * @param {string} key
 */
function moveFocus(key) {
  const dirs = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  };
  const dir = dirs[key];
  if (!dir) return;
  const active = document.activeElement;
  const current =
    active instanceof HTMLElement && active.dataset.id != null && board.contains(active)
      ? Number(active.dataset.id)
      : null;
  if (current == null || !Number.isFinite(current)) {
    const startId = topFree();
    if (startId != null) tileEl(startId)?.focus();
    return;
  }
  const next = neighbor(current, dir[0], dir[1]);
  if (next != null) tileEl(next)?.focus();
}

function fillLayouts() {
  for (const layout of LAYOUTS) {
    const option = document.createElement('option');
    option.value = layout.id;
    option.textContent = layout.name;
    layoutSelect.appendChild(option);
  }
}

function boot() {
  fillLayouts();
  const saved = readSave();
  if (saved) {
    currentLayout = saved.layoutId;
    seed = typeof saved.seed === 'number' ? saved.seed : 1;
    game = hydrateGame(saved.tiles, saved.history, saved);
    elapsedMs = typeof saved.elapsedMs === 'number' ? saved.elapsedMs : 0;
    penaltyMs = typeof saved.penaltyMs === 'number' ? saved.penaltyMs : 0;
    clockStarted = saved.clockStarted === true;
    layoutSelect.value = currentLayout;
    render();
    updateHud();
    if (isWon(game)) {
      showOverlay('win', { ms: displayedMs(), isBest: false });
    } else if (isStuck(game)) {
      showOverlay('stuck');
    } else if (clockStarted) {
      resumeClock();
    }
  } else {
    start('turtle');
  }
  window.setInterval(updateTime, 250);
}

board.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const btn = target.closest('.tile');
  if (!(btn instanceof HTMLElement) || btn.dataset.id == null) return;
  onPick(Number(btn.dataset.id));
});

newBtn.addEventListener('click', () => requestNew(currentLayout));
undoBtn.addEventListener('click', doUndo);
hintBtn.addEventListener('click', doHint);
shuffleBtn.addEventListener('click', doShuffle);
overlayPrimary.addEventListener('click', onOverlayPrimary);
overlaySecondary.addEventListener('click', onOverlaySecondary);

layoutSelect.addEventListener('change', () => {
  const next = layoutSelect.value;
  if (!next || next === currentLayout) return;
  // The menu picks the board. Deal it immediately. New is what asks
  // before replacing a game already in progress.
  start(next);
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    if (event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      doUndo();
    }
    return;
  }
  const tag = event.target instanceof HTMLElement ? event.target.tagName : '';
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (event.key === 'Escape' && overlayMode && overlayMode !== 'win') {
    hideOverlay();
    layoutSelect.value = currentLayout;
    return;
  }
  if (overlayOpen()) return;
  if (
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'ArrowUp' ||
    event.key === 'ArrowDown'
  ) {
    event.preventDefault();
    moveFocus(event.key);
    return;
  }
  if ((event.key === 'Enter' || event.key === ' ') && !event.isTrusted) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains('tile') && active.dataset.id) {
      event.preventDefault();
      onPick(Number(active.dataset.id));
    }
    return;
  }
  if (event.key === 'u' || event.key === 'U') doUndo();
  else if (event.key === 'h' || event.key === 'H') doHint();
  else if (event.key === 'n' || event.key === 'N') requestNew(currentLayout);
  else if (event.key === 's' || event.key === 'S') doShuffle();
  else if (event.key === 'Escape') {
    game.selectedId = null;
    render();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    freezeClock();
    persist();
  } else {
    resumeClock();
  }
});

window.addEventListener('pagehide', () => {
  freezeClock();
  persist();
});

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    if (!animating && game) render();
  }).observe(scroll);
}

boot();
