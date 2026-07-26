import { CONFIG, isConfigured } from './config.js';

const N = CONFIG.N;
const CONFIGURED = isConfigured(CONFIG);

// ---------------------------------------------------------------------
// Layout constants.
// ---------------------------------------------------------------------
const CELL = 16;
const GAP = 4;
const STEP = CELL + GAP;
const ROWS_PER_TILE = 60;

const PENDING_DASH = [2, 2];

// Cell colors live in index.css as CSS variables on .cb-wrapper. We
// read them here at boot and any time the theme changes, so style
// decisions stay in one place and the grid follows whatever theme
// mechanism the page uses (system prefers-color-scheme, manual
// [data-theme] toggle, or anything else brand.css supports). Canvas
// can't reference CSS vars directly — getComputedStyle is the bridge.
//
// Fallback colors match the light-mode CSS values; they only kick in
// if the variable is missing entirely (e.g. CSS file failed to load).
function readPalette() {
  const root =
    /** @type {HTMLElement} */ (document.querySelector('.cb-wrapper')) || document.documentElement;
  const cs = getComputedStyle(root);
  const get = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    accent: get('--cb-accent', '#b45309'),
    accentCheck: get('--cb-accent-fg', '#ffffff'),
    cellBg: get('--cb-cell-bg', '#e3e0d6')
  };
}
let palette = readPalette();

// ---------------------------------------------------------------------
// State. The bitmap (one bit per cell, packed) is the source of truth.
// cellLastTs lets us discard stale delta rows on reconciliation.
//
// pending : Map<cellId, { value: boolean, sentAt: number | null }>
//   "we have a local intent for this cell that the server hasn't
//   confirmed yet". sentAt is null while still in the writeQueue (not
//   yet POSTed), then a timestamp once the POST has been dispatched.
//   Pending values shield the cell against being clobbered by stale
//   snapshot/delta data. Cleared on confirming delta, or after
//   PENDING_CONFIRM_MS once sentAt is set (give-up case — Forms
//   probably ate the write).
//
// writeQueue : Map<cellId, { value: boolean, attempts: number }>
//   FIFO (by Map insertion order) of writes the worker hasn't sent
//   yet. Coalesced per cell: re-clicking the same cell before its
//   write goes out updates the entry in place rather than queueing a
//   second POST. Persisted to localStorage so reloads don't drop
//   in-flight clicks.
// ---------------------------------------------------------------------
const state = new Uint8Array(N >> 3);
const cellLastTs = new Float64Array(N);
let snapshotMaxTs = 0;
/** @type {Map<number, { value: boolean, sentAt: number | null }>} */
const pending = new Map();
/** @type {Map<number, { value: boolean, attempts: number }>} */
const writeQueue = new Map();

const QUEUE_STORAGE_KEY = 'checkboxes:writeQueue:v1';
// Time after a POST has been dispatched before we give up on confirming
// it and let the next snapshot/delta have the cell back. Forms→Sheet
// sync is usually <10s; Apps Script compaction runs hourly. 120s
// catches the common case (sync delay) without leaving a permanently
// stuck cell if Forms silently rejected the write.
const PENDING_CONFIRM_MS = 120000;
// Worker pacing for the write queue. Starts at minWriteIntervalMs;
// doubles on network error up to MAX_BACKOFF_MS.
const MAX_BACKOFF_MS = 30000;

const grid = /** @type {HTMLElement} */ (document.getElementById('cb-grid'));
const checkedEl = /** @type {HTMLElement} */ (document.getElementById('cb-checked'));
const totalEl = /** @type {HTMLElement} */ (document.getElementById('cb-total'));
const titleEl = /** @type {HTMLElement} */ (document.getElementById('cb-title'));
const statusEl = /** @type {HTMLElement} */ (document.getElementById('cb-status'));
const bannerEl = /** @type {HTMLElement} */ (document.getElementById('cb-banner'));

totalEl.textContent = N.toLocaleString();
if (titleEl) {
  // "1,000,000 Checkboxes" rather than a hardcoded string — the page
  // works at any N, the title should match what config.js says.
  titleEl.textContent = `${N.toLocaleString()} Checkboxes`;
}
if (!CONFIGURED) bannerEl.hidden = false;

// ---------------------------------------------------------------------
// Achievement modal: "you (collectively) checked every single box."
// Wired here once at module load. updateChecked() calls
// showAchievementMeme on the count===N transition. Closes via ESC,
// the close button, or backdrop click.
// ---------------------------------------------------------------------
const memeEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('cb-meme'));
const memeCloseEl = document.getElementById('cb-meme-close');

function showAchievementMeme() {
  if (!memeEl || typeof memeEl.showModal !== 'function') return;
  if (memeEl.open) return;
  try {
    memeEl.showModal();
  } catch {
    // showModal throws if the dialog is already open in some browsers
    // — safe to ignore, we're already showing it.
  }
}

if (memeCloseEl && memeEl) {
  memeCloseEl.addEventListener('click', () => memeEl.close());
  // Backdrop click: when showModal() is active, clicks on the dialog
  // element itself (not its children) land on the backdrop area
  // because the dialog's content box is sized to its inner layout.
  memeEl.addEventListener('click', (e) => {
    if (e.target === memeEl) memeEl.close();
  });
}

// ---------------------------------------------------------------------
// About dialog: tribute to the original onemillioncheckboxes.com.
// Opened by clicking the floating ⓘ button at top-right.
// ---------------------------------------------------------------------
const infoEl = /** @type {HTMLDialogElement | null} */ (document.getElementById('cb-info'));
const infoBtnEl = document.getElementById('cb-info-btn');
const infoCloseEl = document.getElementById('cb-info-close');

if (infoEl && infoBtnEl && typeof infoEl.showModal === 'function') {
  infoBtnEl.addEventListener('click', () => {
    if (!infoEl.open) infoEl.showModal();
  });
  if (infoCloseEl) {
    infoCloseEl.addEventListener('click', () => infoEl.close());
  }
  infoEl.addEventListener('click', (e) => {
    if (e.target === infoEl) infoEl.close();
  });
}

function getBit(idx) {
  return (state[idx >> 3] >> (idx & 7)) & 1;
}
function setBit(idx, v) {
  const byte = idx >> 3;
  const mask = 1 << (idx & 7);
  if (v) state[byte] |= mask;
  else state[byte] &= ~mask;
}

// ---------------------------------------------------------------------
// Tiled canvas rendering.
//
// 1M cells in a single canvas would exceed browser canvas size limits
// (~16k px tall) and OOM mobile devices. Instead we lay out N cells
// in a long vertical scroll, COLS-wide, and slice it into tiles of
// ROWS_PER_TILE rows. Each tile is a canvas mounted lazily by an
// IntersectionObserver as it enters the viewport (with margin), and
// unmounted when it leaves to keep canvas memory bounded.
//
// Click handling is on the grid container — we compute (col, row)
// from page-relative coords and flip the bit. Repaints affect only
// the touched tile.
// ---------------------------------------------------------------------
let COLS = 0;
let ROWS = 0;
let NUM_TILES = 0;
/** @type {Array<{el: HTMLElement, canvas: HTMLCanvasElement | null, ctx: CanvasRenderingContext2D | null, startRow: number, endRow: number, mounted: boolean, dirty: boolean}>} */
let tiles = [];

function computeLayout() {
  // Width budget = grid container minus its 4px padding on each side.
  // Fall back to viewport width if we're called before first layout.
  const w = grid.clientWidth || Math.max(window.innerWidth - 24, 200);
  // Each cell takes STEP horizontally, but the last cell on a row only
  // takes CELL (no trailing gap). So total = COLS*STEP - GAP <= w.
  COLS = Math.max(8, Math.floor((w + GAP) / STEP));
  ROWS = Math.ceil(N / COLS);
  NUM_TILES = Math.ceil(ROWS / ROWS_PER_TILE);
}

const tileObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const tileIndex = Number(entry.target.getAttribute('data-tile'));
      const tile = tiles[tileIndex];
      if (!tile) continue;
      if (entry.isIntersecting) mountTile(tile);
      else unmountTile(tile);
    }
  },
  // Mount/unmount with generous margin so a fast scroll doesn't hit
  // unrendered tiles. The viewport is normally ~1000px tall; 800px
  // margin keeps ~3 tiles "live" around the visible window.
  { rootMargin: '800px 0px' }
);

function buildTiles() {
  computeLayout();
  // Tear down old tiles & their observers first.
  for (const t of tiles) {
    tileObserver.unobserve(t.el);
    if (t.canvas) t.canvas.remove();
  }
  grid.replaceChildren();
  tiles = [];

  // Container holds the full virtual height so the page scrollbar
  // reflects the real depth of the grid. Tiles position absolutely.
  const totalH = ROWS * STEP - GAP;
  grid.style.height = `${totalH}px`;
  grid.style.width = `${COLS * STEP - GAP}px`;

  for (let i = 0; i < NUM_TILES; i++) {
    const startRow = i * ROWS_PER_TILE;
    const endRow = Math.min(startRow + ROWS_PER_TILE, ROWS);
    const tileEl = document.createElement('div');
    tileEl.className = 'cb-tile';
    tileEl.setAttribute('data-tile', String(i));
    tileEl.style.top = `${startRow * STEP}px`;
    tileEl.style.height = `${(endRow - startRow) * STEP - GAP}px`;
    grid.appendChild(tileEl);
    const tile = {
      el: tileEl,
      canvas: null,
      ctx: null,
      startRow,
      endRow,
      mounted: false,
      dirty: false
    };
    tiles.push(tile);
    tileObserver.observe(tileEl);
  }
  // Document height just changed — keep the scrubber's 0..1000 scale
  // aligned with the new maxScrollY.
  updateScrubFromScroll();
}

function mountTile(tile) {
  if (tile.mounted) return;
  const w = COLS * STEP - GAP;
  const h = (tile.endRow - tile.startRow) * STEP - GAP;
  const canvas = document.createElement('canvas');
  // 1x DPR. At chunky 16px shapes the difference vs retina is invisible
  // but the memory savings are real: ~75% lower vs a 2x backing store.
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  tile.el.appendChild(canvas);
  tile.canvas = canvas;
  tile.ctx = ctx;
  tile.mounted = true;
  paintTile(tile);
}

function unmountTile(tile) {
  if (!tile.mounted) return;
  if (tile.canvas) {
    tile.canvas.remove();
    // Drop the backing buffer so the GC can reclaim it.
    tile.canvas.width = 0;
    tile.canvas.height = 0;
  }
  tile.canvas = null;
  tile.ctx = null;
  tile.mounted = false;
}

function paintTile(tile) {
  if (!tile.mounted || !tile.ctx) return;
  const ctx = tile.ctx;
  const w = COLS * STEP - GAP;
  const h = (tile.endRow - tile.startRow) * STEP - GAP;
  ctx.clearRect(0, 0, w, h);
  for (let r = tile.startRow; r < tile.endRow; r++) {
    for (let c = 0; c < COLS; c++) {
      const cellId = r * COLS + c;
      if (cellId >= N) return;
      const x = c * STEP;
      const y = (r - tile.startRow) * STEP;
      paintCellAt(ctx, x, y, !!getBit(cellId), pending.has(cellId));
    }
  }
  tile.dirty = false;
}

function paintCellAt(ctx, x, y, checked, isPending) {
  if (checked) {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.strokeStyle = palette.accentCheck;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 3.5, y + 8);
    ctx.lineTo(x + 6.5, y + 11);
    ctx.lineTo(x + 12.5, y + 4);
    ctx.stroke();
  } else {
    ctx.fillStyle = palette.cellBg;
    ctx.fillRect(x, y, CELL, CELL);
  }
  if (isPending) {
    ctx.strokeStyle = palette.accent;
    ctx.setLineDash(PENDING_DASH);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 1, y - 1, CELL + 2, CELL + 2);
    ctx.setLineDash([]);
  }
}

function paintAllTiles() {
  for (const t of tiles) {
    if (t.mounted) paintTile(t);
    else t.dirty = true;
  }
  updateChecked();
}

function paintCellId(cellId) {
  const r = Math.floor(cellId / COLS);
  const c = cellId % COLS;
  const tileIndex = Math.floor(r / ROWS_PER_TILE);
  const tile = tiles[tileIndex];
  if (!tile) return;
  if (!tile.mounted) {
    tile.dirty = true;
    return;
  }
  const x = c * STEP;
  const y = (r - tile.startRow) * STEP;
  // Clear a slightly oversize rect so the prior pending dash gets wiped.
  tile.ctx.clearRect(x - 2, y - 2, CELL + 4, CELL + 4);
  paintCellAt(tile.ctx, x, y, !!getBit(cellId), pending.has(cellId));
}

let lastCheckedCount = -1;
function updateChecked() {
  let count = 0;
  for (let i = 0; i < state.length; i++) {
    let b = state[i];
    while (b) {
      b &= b - 1;
      count++;
    }
  }
  if (count !== lastCheckedCount) {
    checkedEl.textContent = count.toLocaleString();
    // Achievement: every box checked. Fire on the transition from
    // "less than full" to "full" so it triggers once when someone
    // (or, more realistically, the slow accumulation of clicks across
    // the whole world) finally completes the grid. If the count
    // later drops below N and climbs back, it'll fire again — that's
    // intentional, the gag is funnier on reentry.
    if (count === N && lastCheckedCount !== N) {
      showAchievementMeme();
    }
    lastCheckedCount = count;
  }
}

// ---------------------------------------------------------------------
// Click handling. We delegate from the grid container, do hit-testing
// against the cell rectangle (skipping clicks in the GAP), and flip
// the bit + submit.
// ---------------------------------------------------------------------
grid.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const tileEl = target.closest('.cb-tile');
  if (!(tileEl instanceof HTMLElement)) return;
  const tileIndex = Number(tileEl.getAttribute('data-tile'));
  const tile = tiles[tileIndex];
  if (!tile) return;
  const rect = tileEl.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const col = Math.floor(px / STEP);
  const rowInTile = Math.floor(py / STEP);
  if (col < 0 || col >= COLS) return;
  // Skip the 4px gap on the right/bottom of each cell.
  const inCellX = px - col * STEP;
  const inCellY = py - rowInTile * STEP;
  if (inCellX > CELL || inCellY > CELL) return;

  const row = tile.startRow + rowInTile;
  const cellId = row * COLS + col;
  if (cellId < 0 || cellId >= N) return;

  const next = !getBit(cellId);
  setBit(cellId, next);
  cellLastTs[cellId] = Date.now();

  if (CONFIGURED) {
    enqueueWrite(cellId, next);
  }

  paintCellId(cellId);
  updateChecked();
});

// ---------------------------------------------------------------------
// Jump-to-checkbox widget. 1-indexed input → smooth-scroll to that
// cell, with a brief pulse ring drawn on top of the grid. Tile mounts
// auto-trigger via the IntersectionObserver as the scroll lands, so
// the cell is painted by the time the user gets there.
// ---------------------------------------------------------------------
const jumpFormEl = /** @type {HTMLFormElement | null} */ (document.getElementById('cb-jump'));
const jumpInputEl = /** @type {HTMLInputElement | null} */ (
  document.getElementById('cb-jump-input')
);

function jumpToCell(cellId) {
  if (cellId < 0 || cellId >= N || COLS === 0) return;
  const row = Math.floor(cellId / COLS);
  const col = cellId % COLS;
  const x = col * STEP;
  const y = row * STEP;

  // Center the cell vertically in the viewport. The grid is positioned
  // inside .cb-wrapper which has top padding, so we go through
  // getBoundingClientRect to get the real document-relative position.
  const gridRect = grid.getBoundingClientRect();
  const targetY = gridRect.top + window.scrollY + y - window.innerHeight / 2 + STEP / 2;
  window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });

  showJumpHighlight(x, y);
}

// One reused overlay rather than spawning a new <div> per jump; we
// retrigger the CSS animation by toggling the class off/on across a
// frame boundary.
/** @type {HTMLElement | null} */
let highlightEl = null;
function showJumpHighlight(x, y) {
  // `highlightEl` can get detached when buildTiles() calls
  // grid.replaceChildren() on resize — re-create if the reference is
  // stale rather than coupling buildTiles to know about it.
  if (!highlightEl || highlightEl.parentNode !== grid) {
    highlightEl = document.createElement('div');
    highlightEl.className = 'cb-jump-highlight';
    grid.appendChild(highlightEl);
  }
  highlightEl.style.left = `${x - 6}px`;
  highlightEl.style.top = `${y - 6}px`;
  highlightEl.style.width = `${CELL + 12}px`;
  highlightEl.style.height = `${CELL + 12}px`;

  // Restart the animation: drop the class, force a reflow so the
  // browser commits the "no-animation" state, then re-add it.
  highlightEl.classList.remove('cb-jump-highlight');
  void highlightEl.offsetWidth;
  highlightEl.classList.add('cb-jump-highlight');
}

if (jumpFormEl && jumpInputEl) {
  jumpFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    // Tolerate "500,000" or "500 000" — strip any non-digit so users
    // can copy-paste numbers from the counter without re-typing them.
    const raw = jumpInputEl.value.replace(/[^0-9]/g, '');
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > N) {
      jumpInputEl.classList.remove('cb-jump-error');
      void jumpInputEl.offsetWidth;
      jumpInputEl.classList.add('cb-jump-error');
      jumpInputEl.select();
      return;
    }
    jumpToCell(n - 1);
    jumpInputEl.blur();
  });
}

// ---------------------------------------------------------------------
// Mobile scroll scrubber. Maps a short vertical range (0..SCRUB_MAX)
// onto the full document scroll height so a finger drag can skip
// tens of thousands of rows — the native scrollbar thumb is a few
// pixels tall at 1M cells and effectively unusable on phones.
//
// Instant scroll (no smooth) while dragging so the tiles keep up.
// The floating label shows the approximate 1-indexed cell at the
// top of the viewport. Syncs back from window scroll when the user
// isn't actively scrubbing.
// ---------------------------------------------------------------------
const SCRUB_MAX = 1000;
const scrubEl = /** @type {HTMLElement | null} */ (document.getElementById('cb-scrub'));
const scrubInputEl = /** @type {HTMLInputElement | null} */ (
  document.getElementById('cb-scrub-input')
);
const scrubLabelEl = /** @type {HTMLElement | null} */ (document.getElementById('cb-scrub-label'));
let scrubbing = false;

function maxScrollY() {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

function cellAtViewportTop() {
  if (COLS === 0) return 1;
  const gridRect = grid.getBoundingClientRect();
  // Distance from the top of the grid to the top of the viewport,
  // in grid coordinates. Negative while the header is still on screen.
  const yInGrid = Math.max(0, -gridRect.top);
  const row = Math.min(ROWS - 1, Math.floor(yInGrid / STEP));
  return Math.min(N, row * COLS + 1);
}

function updateScrubFromScroll() {
  if (!scrubInputEl || scrubbing) return;
  const max = maxScrollY();
  const t = max <= 0 ? 0 : Math.round((window.scrollY / max) * SCRUB_MAX);
  scrubInputEl.value = String(Math.max(0, Math.min(SCRUB_MAX, t)));
  scrubInputEl.setAttribute('aria-valuenow', scrubInputEl.value);
  if (scrubLabelEl) scrubLabelEl.textContent = `#${cellAtViewportTop().toLocaleString()}`;
}

function scrubToValue(raw) {
  const t = Number(raw);
  if (!Number.isFinite(t)) return;
  const max = maxScrollY();
  const y = max <= 0 ? 0 : (t / SCRUB_MAX) * max;
  window.scrollTo({ top: y, behavior: 'auto' });
  if (scrubLabelEl) scrubLabelEl.textContent = `#${cellAtViewportTop().toLocaleString()}`;
  if (scrubInputEl) scrubInputEl.setAttribute('aria-valuenow', String(t));
}

if (scrubInputEl && scrubEl) {
  scrubInputEl.addEventListener('pointerdown', () => {
    scrubbing = true;
    scrubEl.classList.add('is-scrubbing');
  });
  // pointerup can land outside the thumb after a fast drag — listen
  // on window so we don't get stuck in scrubbing mode and stop syncing.
  window.addEventListener('pointerup', () => {
    if (!scrubbing) return;
    scrubbing = false;
    scrubEl.classList.remove('is-scrubbing');
    updateScrubFromScroll();
  });
  scrubInputEl.addEventListener('input', () => {
    scrubbing = true;
    scrubEl.classList.add('is-scrubbing');
    scrubToValue(scrubInputEl.value);
  });
  window.addEventListener('scroll', updateScrubFromScroll, { passive: true });
  window.addEventListener('resize', updateScrubFromScroll);
  updateScrubFromScroll();
}

// Resize: recompute COLS, rebuild tile layout. Debounced because the
// browser fires resize at ~60Hz on continuous drags.
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const oldCols = COLS;
    computeLayout();
    if (COLS !== oldCols) buildTiles();
  }, 200);
});

// Theme change: re-read CSS variables and repaint. Triggers on:
//   - System theme flip (prefers-color-scheme media query change)
//   - Manual theme toggle (data-theme attribute mutation on :root)
// Either path lands in the same code: read whatever CSS now says,
// repaint the canvas with those values.
function onThemeChanged() {
  palette = readPalette();
  paintAllTiles();
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onThemeChanged);
new MutationObserver(onThemeChanged).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme', 'class']
});

// ---------------------------------------------------------------------
// Client identity. Stable per-browser UUID for forensics.
// ---------------------------------------------------------------------
function getClientId() {
  const KEY = 'checkboxes:clientId';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'c-' + Math.random().toString(36).slice(2, 12);
    localStorage.setItem(KEY, id);
  }
  return id;
}

// ---------------------------------------------------------------------
// Write path: queued, coalesced, best-effort persistent.
//
// Every click enqueues a (cellId → desired value) into writeQueue and
// records a pending entry for visual + reconciliation use. A single
// worker drains the queue, dispatching one POST every
// minWriteIntervalMs. Re-clicking the same cell before its entry is
// sent updates the entry in place (coalesced — Forms only ever sees
// the most recent intent). On network error the entry stays in the
// queue and the worker retries with exponential backoff.
//
// The queue is persisted to localStorage on every change so a reload
// or browser crash doesn't lose un-sent writes; on boot we restore
// the queue, re-apply the local intent to the bitmap, and resume
// draining.
//
// Writes are no-cors so fetch only rejects on a true network error
// (offline, DNS failure, CORS preflight failure). Forms returning
// 4xx/5xx looks like success to us; the only way we'll find out a
// write was actually dropped is via the pending TTL expiring without
// a confirming delta.
// ---------------------------------------------------------------------

let workerBusy = false;
let workerBackoffMs = 0;

function buildFormBody(cellId, value) {
  const body = new URLSearchParams();
  body.set(CONFIG.entryIds.cellId, String(cellId));
  body.set(CONFIG.entryIds.value, value ? 'TRUE' : 'FALSE');
  body.set(CONFIG.entryIds.clientId, getClientId());
  body.set(CONFIG.entryIds.honeypot, '');
  return body;
}

function persistQueue() {
  try {
    /** @type {Array<[number, boolean]>} */
    const arr = [];
    for (const [cellId, entry] of writeQueue) arr.push([cellId, entry.value]);
    if (arr.length === 0) localStorage.removeItem(QUEUE_STORAGE_KEY);
    else localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // Quota / disabled storage / private mode — non-fatal. The queue
    // still works for the current session, just not across reloads.
  }
}

function restoreQueue() {
  let arr;
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return;
    arr = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const cellId = Number(item[0]);
    const value = !!item[1];
    if (!Number.isInteger(cellId) || cellId < 0 || cellId >= N) continue;
    writeQueue.set(cellId, { value, attempts: 0 });
    pending.set(cellId, { value, sentAt: null });
    setBit(cellId, value ? 1 : 0);
    cellLastTs[cellId] = Date.now();
  }
}

function enqueueWrite(cellId, value) {
  writeQueue.set(cellId, { value, attempts: 0 });
  pending.set(cellId, { value, sentAt: null });
  persistQueue();
  updateStatus();
  scheduleDrain(0);
}

let drainTimer = 0;
function scheduleDrain(delayMs) {
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = window.setTimeout(() => {
    drainTimer = 0;
    void drainQueue();
  }, delayMs);
}

async function drainQueue() {
  if (workerBusy || !CONFIGURED) return;
  if (writeQueue.size === 0) return;
  workerBusy = true;
  try {
    while (writeQueue.size > 0) {
      // Map iteration is insertion-ordered → FIFO.
      const next = writeQueue.entries().next();
      if (next.done) break;
      const [cellId, entry] = next.value;
      try {
        await fetch(CONFIG.formActionUrl, {
          method: 'POST',
          mode: 'no-cors',
          body: buildFormBody(cellId, entry.value)
        });
        const current = writeQueue.get(cellId);
        if (current === entry) {
          // No re-click landed while our POST was in flight, so this
          // entry's intent is still the latest. Clear it from the queue
          // and mark the pending ring as dispatched (sentAt). If
          // `current !== entry`, the user re-clicked mid-flight — leave
          // the new entry in the queue; the next drain iteration will
          // POST it.
          writeQueue.delete(cellId);
          const p = pending.get(cellId);
          if (p && p.value === entry.value) p.sentAt = Date.now();
        }
        workerBackoffMs = 0;
        persistQueue();
        updateStatus();
        if (writeQueue.size > 0) {
          await sleep(CONFIG.minWriteIntervalMs);
        }
      } catch {
        entry.attempts++;
        workerBackoffMs = Math.min(
          MAX_BACKOFF_MS,
          Math.max(CONFIG.minWriteIntervalMs, workerBackoffMs ? workerBackoffMs * 2 : 1000)
        );
        updateStatus();
        await sleep(workerBackoffMs);
      }
    }
  } finally {
    workerBusy = false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Best-effort flush when the tab is closing/backgrounded. sendBeacon
// is the only API that reliably fires after unload; we batch one
// beacon per queued cell, FIFO. Forms accepts duplicate clientId+cellId
// rows, so worst case (the worker also sent it) Sheets gets one extra
// row that compaction will fold idempotently. Anything not flushed
// here is still in localStorage and replays on the next visit.
function flushOnHide() {
  if (writeQueue.size === 0) return;
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
  for (const [cellId, entry] of writeQueue) {
    const body = buildFormBody(cellId, entry.value);
    // sendBeacon needs a Blob with the right content-type; passing
    // URLSearchParams directly works in some browsers but not all.
    const blob = new Blob([body.toString()], {
      type: 'application/x-www-form-urlencoded;charset=UTF-8'
    });
    try {
      navigator.sendBeacon(CONFIG.formActionUrl, blob);
    } catch {
      // Quota / payload-too-large — give up; the queue is still in
      // localStorage and will replay next time.
    }
  }
}
// 'pagehide' fires reliably on tab close + bfcache navigation; the
// 'visibilitychange→hidden' case (tab switch, browser minimized)
// gives us a chance to flush during otherwise-idle backgrounding.
window.addEventListener('pagehide', flushOnHide);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushOnHide();
});

// Sweep pending entries that have been "sent" for longer than
// PENDING_CONFIRM_MS without a confirming delta. Treat them as lost
// and surrender the cell to whatever the server currently says — the
// next snapshot/delta apply will paint the authoritative value.
function sweepPending() {
  const now = Date.now();
  /** @type {Set<number>} */
  const repaint = new Set();
  for (const [cellId, p] of pending) {
    if (p.sentAt != null && now - p.sentAt > PENDING_CONFIRM_MS) {
      pending.delete(cellId);
      repaint.add(cellId);
    }
  }
  for (const cellId of repaint) paintCellId(cellId);
}

// ---------------------------------------------------------------------
// Read path. Snapshot is fetched once on boot (and refreshed every
// ~minute); deltas are fetched every poll. Snapshot at 1M cells is
// ~200KB once a minute = 12MB/hr — tolerable. Deltas are tiny.
// ---------------------------------------------------------------------
function gvizUrl(tab) {
  return `https://docs.google.com/spreadsheets/d/${
    CONFIG.sheetId
  }/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
}

async function fetchTab(tab) {
  const url = gvizUrl(tab);
  const text = await fetch(url, { cache: 'no-store' }).then((r) => r.text());
  const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!m) throw new Error('gviz parse failed');
  const json = JSON.parse(m[1]);
  if (!json.table || !json.table.rows) return [];
  return json.table.rows.map((r) => (r.c || []).map((c) => (c == null ? null : c.v)));
}

function toBit(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === 'string') {
    const u = v.trim().toUpperCase();
    if (u === 'TRUE') return 1;
    if (u === 'FALSE') return 0;
  }
  return -1;
}

function parseTs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const m = v.match(/^Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)$/);
    if (m) {
      return new Date(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]).getTime();
    }
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

// Decode a base64 string into the existing `state` Uint8Array. atob
// in modern browsers handles ~200KB strings fine in one shot.
// Pending overlay is re-applied by the caller (fetchSnapshot).
function applyEncodedSnapshot(b64) {
  const decoded = atob(b64);
  const len = Math.min(decoded.length, state.length);
  for (let i = 0; i < len; i++) state[i] = decoded.charCodeAt(i);
}

// Overlay any in-flight local intents on top of the just-loaded
// bitmap. Without this, a click the user just made that Forms hasn't
// folded into the snapshot yet would silently revert on the next
// snapshot poll (~60s) — this was the headline reason persistence
// felt flaky before the queue refactor.
//
// Bonus job: snapshot-agreement auto-confirm. If we've already
// dispatched a write (sentAt != null) and the freshly-loaded snapshot
// already shows the value we asked for, the write made it all the way
// through Forms → Sheet → Apps Script compaction. We don't need to
// wait for a confirming delta row — and in fact we won't see one,
// because compaction's deleteRows() truncates the response log it was
// going to come from. Without this, the dashed-pending ring would
// linger until the 120s TTL sweep fired, which is the long-pending-ring
// case users were seeing.
function reapplyPending() {
  for (const [cellId, p] of pending) {
    const serverBit = (state[cellId >> 3] >> (cellId & 7)) & 1;
    if (p.sentAt != null && (serverBit === 1) === p.value) {
      pending.delete(cellId);
      continue;
    }
    setBit(cellId, p.value ? 1 : 0);
  }
}

async function fetchSnapshot() {
  // Tolerate both snapshot schemas:
  //   NEW (post-1M): two columns [key, value]. Keys are 'chunk0'..'chunkK'
  //        and 'maxTs'. Concatenate chunks and base64-decode for the bitmap.
  //   OLD (pre-1M): three columns [cellId, value, lastTs]. One row per cell.
  //        Carried forward so existing live data isn't lost the moment the
  //        client upgrades — until the next Apps Script run rewrites the
  //        Snapshot tab into the new format.
  const rows = await fetchTab(CONFIG.snapshotTab);
  if (rows.length === 0) return;

  // Detect: if any row's first column is a string that starts with 'chunk'
  // or equals 'maxTs', it's the new format.
  let isNew = false;
  for (const row of rows) {
    const k = row[0];
    if (typeof k === 'string' && (k.indexOf('chunk') === 0 || k === 'maxTs')) {
      isNew = true;
      break;
    }
  }

  let maxTs = 0;
  if (isNew) {
    const map = new Map();
    for (const row of rows) {
      if (!row || row.length === 0) continue;
      map.set(String(row[0] ?? ''), row[1]);
    }
    const parts = [];
    for (let i = 0; i < 64; i++) {
      const v = map.get(`chunk${i}`);
      if (v == null) break;
      parts.push(String(v));
    }
    if (parts.length > 0) applyEncodedSnapshot(parts.join(''));
    maxTs = parseTs(map.get('maxTs'));
  } else {
    // Old format. Each row is [cellId, value, lastTs]. Skip cells that
    // have a pending local intent — reapplyPending() below would just
    // overwrite our setBit anyway, but skipping also avoids stomping
    // cellLastTs with a server timestamp older than our click.
    for (const row of rows) {
      const id = Number(row[0]);
      const bit = toBit(row[1]);
      const ts = parseTs(row[2]);
      if (!Number.isInteger(id) || id < 0 || id >= N) continue;
      if (bit < 0) continue;
      if (pending.has(id)) continue;
      setBit(id, bit);
      cellLastTs[id] = ts;
      if (ts > maxTs) maxTs = ts;
    }
  }
  if (maxTs > snapshotMaxTs) snapshotMaxTs = maxTs;
  reapplyPending();
}

function applyDelta(rows) {
  const parsed = [];
  for (const row of rows) {
    const ts = parseTs(row[0]);
    const id = Number(row[1]);
    const bit = toBit(row[2]);
    const honeypot = row[4];
    if (honeypot) continue;
    if (!Number.isInteger(id) || id < 0 || id >= N) continue;
    if (bit < 0) continue;
    if (ts <= snapshotMaxTs) continue;
    parsed.push({ ts, id, bit });
  }
  parsed.sort((a, b) => a.ts - b.ts);
  const dirtyTiles = new Set();
  for (const { ts, id, bit } of parsed) {
    // Pending-confirm before staleness-skip. The row's `ts` is the
    // Sheet's clock; `cellLastTs[id]` is the browser's clock at click
    // time. If the browser clock is fast (or the sheet's timezone
    // setting parses oddly through gviz) the row can look stale even
    // though it's the very confirmation we're waiting for.
    const p = pending.get(id);
    if (p !== undefined) {
      if (p.value === !!bit) {
        pending.delete(id);
        dirtyTiles.add(Math.floor(id / COLS / ROWS_PER_TILE));
      }
      if (ts >= cellLastTs[id]) cellLastTs[id] = ts;
      continue;
    }

    if (ts < cellLastTs[id]) continue;
    cellLastTs[id] = ts;

    const prev = getBit(id);
    if (prev !== bit) {
      setBit(id, bit);
      dirtyTiles.add(Math.floor(id / COLS / ROWS_PER_TILE));
    }
  }
  for (const idx of dirtyTiles) {
    const tile = tiles[idx];
    if (tile && tile.mounted) paintTile(tile);
    else if (tile) tile.dirty = true;
  }
}

let polling = false;
let lastSyncAt = 0;
let lastSnapshotFetchAt = 0;
const SNAPSHOT_REFRESH_MS = 60000;
/** @type {'init' | 'syncing' | 'live' | 'offline'} */
let connStatus = 'init';

async function poll() {
  if (polling) return;
  polling = true;
  connStatus = 'syncing';
  updateStatus();
  try {
    const now = Date.now();
    const wantSnapshot = !lastSnapshotFetchAt || now - lastSnapshotFetchAt > SNAPSHOT_REFRESH_MS;
    if (wantSnapshot) {
      await fetchSnapshot();
      lastSnapshotFetchAt = now;
    }
    const delta = await fetchTab(CONFIG.responsesTab);
    applyDelta(delta);
    if (wantSnapshot) paintAllTiles();
    else updateChecked();
    if (imageMode !== 'off') renderImageView();
    lastSyncAt = Date.now();
    connStatus = 'live';
  } catch (err) {
    connStatus = 'offline';
    console.warn('[checkboxes] poll failed', err);
  } finally {
    polling = false;
    updateStatus();
  }
}

// Single source of truth for the footer text. Combines the read-path
// connection state (poll loop) with the write-path queue depth so a
// user can tell at a glance whether their clicks are caught up.
function updateStatus() {
  if (!CONFIGURED) {
    statusEl.textContent = 'demo mode';
    return;
  }
  const queued = writeQueue.size;
  const queuedNote = queued > 0 ? ` · ${queued} queued` : '';
  if (connStatus === 'syncing') {
    statusEl.textContent = `syncing…${queuedNote}`;
    return;
  }
  if (connStatus === 'offline') {
    statusEl.textContent = `offline (retrying)${queuedNote}`;
    return;
  }
  if (connStatus === 'init') {
    statusEl.textContent = `connecting…${queuedNote}`;
    return;
  }
  const ago = lastSyncAt ? Math.round((Date.now() - lastSyncAt) / 1000) : 0;
  const sync = ago < 5 ? 'live' : `synced ${ago}s ago`;
  statusEl.textContent = `${sync}${queuedNote}`;
}

// ---------------------------------------------------------------------
// Image-view easter egg. Renders the same `state` Uint8Array as an
// image — either a 1000×1000 monochrome grid (one bit per pixel, the
// way the OMCB Discord crowd visualized the canvas to draw pixel art
// and QR codes) or a 204×204 RGB grid (24 bits per pixel, the color
// protocol they invented).
//
// Press `i` to cycle  off → mono → rgb → off. ESC always returns to
// the checkbox view. Deep-linkable via ?view=mono or ?view=rgb.
// Clicking a pixel in mono view jumps to the corresponding cell in
// the regular grid; in RGB view a click is ambiguous (24 cells per
// pixel) so we just close the overlay.
//
// This is purely a re-renderer of the in-memory bitmap. It doesn't
// touch the persistence layer, the write queue, or the read polling.
// ---------------------------------------------------------------------
const MONO_SIDE = Math.ceil(Math.sqrt(N)); // 1000 for N=1,000,000
const RGB_SIDE = Math.floor(Math.sqrt(state.length / 3)); // 204 for N=1M

const imageOverlay = /** @type {HTMLElement | null} */ (
  document.getElementById('cb-image-overlay')
);
const imageCanvas = /** @type {HTMLCanvasElement | null} */ (
  document.getElementById('cb-image-canvas')
);
const imageLabel = /** @type {HTMLElement | null} */ (document.getElementById('cb-image-label'));
const imageCtx =
  imageCanvas instanceof HTMLCanvasElement
    ? /** @type {CanvasRenderingContext2D | null} */ (imageCanvas.getContext('2d'))
    : null;

/** @type {'off' | 'mono' | 'rgb'} */
let imageMode = 'off';

function renderImageView() {
  if (imageMode === 'off' || !imageCanvas || !imageCtx) return;

  if (imageMode === 'mono') {
    if (imageCanvas.width !== MONO_SIDE || imageCanvas.height !== MONO_SIDE) {
      imageCanvas.width = MONO_SIDE;
      imageCanvas.height = MONO_SIDE;
    }
    const img = imageCtx.createImageData(MONO_SIDE, MONO_SIDE);
    const data = img.data;
    // Off-pixels are a soft warm gray so the canvas reads as paper rather
    // than a flat white wall; on-pixels are the accent color so the
    // image matches the on-grid checkboxes. Faithful to OMCB's two-color
    // look, just inverted from black/white to amber/cream.
    const onR = 180,
      onG = 83,
      onB = 9; // #b45309, our --cb-accent
    const offR = 227,
      offG = 224,
      offB = 214; // #e3e0d6, our --cb-cell-bg
    const max = Math.min(N, MONO_SIDE * MONO_SIDE);
    for (let cellId = 0; cellId < max; cellId++) {
      const bit = (state[cellId >> 3] >> (cellId & 7)) & 1;
      const off = cellId * 4;
      if (bit) {
        data[off] = onR;
        data[off + 1] = onG;
        data[off + 2] = onB;
      } else {
        data[off] = offR;
        data[off + 1] = offG;
        data[off + 2] = offB;
      }
      data[off + 3] = 255;
    }
    imageCtx.putImageData(img, 0, 0);
  } else {
    if (imageCanvas.width !== RGB_SIDE || imageCanvas.height !== RGB_SIDE) {
      imageCanvas.width = RGB_SIDE;
      imageCanvas.height = RGB_SIDE;
    }
    const img = imageCtx.createImageData(RGB_SIDE, RGB_SIDE);
    const data = img.data;
    const total = RGB_SIDE * RGB_SIDE;
    for (let i = 0; i < total; i++) {
      const off = i * 4;
      const src = i * 3;
      // Take three consecutive bitmap bytes as R, G, B. With most cells
      // unchecked the image will be mostly near-black until users
      // actively encode something — that's the same "blank canvas"
      // feeling the OMCB botters started from.
      data[off] = state[src] || 0;
      data[off + 1] = state[src + 1] || 0;
      data[off + 2] = state[src + 2] || 0;
      data[off + 3] = 255;
    }
    imageCtx.putImageData(img, 0, 0);
  }
}

function setImageMode(mode) {
  imageMode = mode;
  if (!imageOverlay || !imageLabel) return;
  if (mode === 'off') {
    imageOverlay.hidden = true;
    return;
  }
  imageOverlay.hidden = false;
  imageLabel.textContent =
    mode === 'mono'
      ? `${MONO_SIDE}×${MONO_SIDE} mono · 1 bit/pixel`
      : `${RGB_SIDE}×${RGB_SIDE} rgb · 24 bits/pixel`;
  renderImageView();
}

document.addEventListener('keydown', (e) => {
  // Don't steal `i` while the user is typing in the jump widget — they
  // might want to type "1000" without surprise mode swaps. Same for
  // contenteditable surfaces if any get added later.
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
  if (t instanceof HTMLElement && t.isContentEditable) return;

  if (e.key === 'i' || e.key === 'I') {
    // No modifier — Ctrl/Cmd+I is browser-reserved (italic, dev tools).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const next = imageMode === 'off' ? 'mono' : imageMode === 'mono' ? 'rgb' : 'off';
    setImageMode(next);
  } else if (e.key === 'Escape' && imageMode !== 'off') {
    e.preventDefault();
    setImageMode('off');
  }
});

// Click-to-jump in mono view: pixel coords map 1:1 to cellId (since
// MONO_SIDE * MONO_SIDE = N). Translate the click from CSS-display
// coords back to the canvas's logical 1000×1000 grid.
if (imageCanvas) {
  imageCanvas.addEventListener('click', (e) => {
    if (imageMode !== 'mono') return;
    const rect = imageCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const px = Math.floor(((e.clientX - rect.left) * imageCanvas.width) / rect.width);
    const py = Math.floor(((e.clientY - rect.top) * imageCanvas.height) / rect.height);
    const cellId = py * MONO_SIDE + px;
    if (cellId < 0 || cellId >= N) return;
    setImageMode('off');
    // Defer the jump one frame so the overlay's display:none commit
    // happens before getBoundingClientRect inside jumpToCell.
    requestAnimationFrame(() => jumpToCell(cellId));
  });
}

// Backdrop click (anywhere outside the canvas) closes the overlay.
// Lets the overlay feel like the existing <dialog> chrome even though
// it's a div (we need keyboard-cycle semantics that <dialog>'s built-in
// ESC handling doesn't compose with cleanly).
if (imageOverlay) {
  imageOverlay.addEventListener('click', (e) => {
    if (e.target === imageOverlay) setImageMode('off');
  });
}

// Deep-link: ?view=mono or ?view=rgb opens the overlay on load. Useful
// for sharing a specific data view. Anything else (including no
// param) leaves the grid in its normal state.
try {
  const v = new URLSearchParams(window.location.search).get('view');
  if (v === 'mono' || v === 'rgb') setImageMode(v);
} catch {
  // SSR / locked-down embed — ignore.
}

// Hooks for the OG-preview generator (generate-previews.js). Lets the
// hook scatter checks into state and force a paint without having to
// reach into module internals.
window.cbState = state;
window.cbPaintAll = paintAllTiles;

buildTiles();
paintAllTiles();

if (CONFIGURED) {
  // Restore any clicks that were queued in a previous session and
  // never made it out. Done before the first poll so the pending
  // overlay (re-applied at the end of fetchSnapshot) keeps the
  // restored bits visible across the initial refresh.
  restoreQueue();
  paintAllTiles();
  poll();
  setInterval(poll, CONFIG.pollIntervalMs);
  setInterval(updateStatus, 1000);
  // Periodic pending-TTL sweep. Cheap (iterates pending, typically
  // empty or a handful of entries); a stuck pending eventually
  // unsticks itself instead of permanently masking the server view.
  setInterval(sweepPending, 5000);
  scheduleDrain(0);
} else {
  updateStatus();
}
