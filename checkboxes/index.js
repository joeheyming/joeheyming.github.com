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
// cellLastTs lets us discard stale delta rows on reconciliation. Pending
// is the optimistic-flip set: cellId → expected new value while a POST
// is in flight, cleared on the next confirming poll or after 30s.
// ---------------------------------------------------------------------
const state = new Uint8Array(N >> 3);
const cellLastTs = new Float64Array(N);
let snapshotMaxTs = 0;
const pending = new Map();

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
    const sent = submitFlip(cellId, next);
    if (sent) {
      pending.set(cellId, next);
      setTimeout(() => {
        pending.delete(cellId);
        paintCellId(cellId);
      }, 30000);
    }
  }

  paintCellId(cellId);
  updateChecked();
});

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
// Write path: opaque POST to the form's formResponse endpoint. CORS
// blocks reading the response, so we don't observe success — the next
// poll either confirms the optimistic flip or reverts it.
// ---------------------------------------------------------------------
let lastWriteAt = 0;

function submitFlip(cellId, value) {
  if (!CONFIGURED) return false;
  const now = Date.now();
  if (now - lastWriteAt < CONFIG.minWriteIntervalMs) return false;
  lastWriteAt = now;

  const body = new URLSearchParams();
  body.set(CONFIG.entryIds.cellId, String(cellId));
  body.set(CONFIG.entryIds.value, value ? 'TRUE' : 'FALSE');
  body.set(CONFIG.entryIds.clientId, getClientId());
  body.set(CONFIG.entryIds.honeypot, '');

  fetch(CONFIG.formActionUrl, {
    method: 'POST',
    mode: 'no-cors',
    body
  }).catch(() => {});
  return true;
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
function applyEncodedSnapshot(b64) {
  const decoded = atob(b64);
  const len = Math.min(decoded.length, state.length);
  for (let i = 0; i < len; i++) state[i] = decoded.charCodeAt(i);
  // Any trailing bytes in `state` past the snapshot length are kept as
  // local optimistic flips — the snapshot doesn't speak about them yet.
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
    // Old format. Each row is [cellId, value, lastTs].
    for (const row of rows) {
      const id = Number(row[0]);
      const bit = toBit(row[1]);
      const ts = parseTs(row[2]);
      if (!Number.isInteger(id) || id < 0 || id >= N) continue;
      if (bit < 0) continue;
      setBit(id, bit);
      cellLastTs[id] = ts;
      if (ts > maxTs) maxTs = ts;
    }
  }
  if (maxTs > snapshotMaxTs) snapshotMaxTs = maxTs;
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
  // Track per-cell which tiles need a repaint after this batch.
  const dirtyTiles = new Set();
  for (const { ts, id, bit } of parsed) {
    if (ts < cellLastTs[id]) continue;
    const prev = getBit(id);
    if (prev !== bit) {
      setBit(id, bit);
      dirtyTiles.add(Math.floor(id / COLS / ROWS_PER_TILE));
    }
    cellLastTs[id] = ts;
    const pendingValue = pending.get(id);
    if (pendingValue !== undefined && pendingValue === !!bit) {
      pending.delete(id);
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

async function poll() {
  if (polling) return;
  polling = true;
  try {
    statusEl.textContent = 'syncing…';
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
    lastSyncAt = Date.now();
    statusEl.textContent = 'live';
  } catch (err) {
    statusEl.textContent = 'offline (retrying)';
    console.warn('[checkboxes] poll failed', err);
  } finally {
    polling = false;
  }
}

function setStatusIdle() {
  if (!lastSyncAt) return;
  const ago = Math.round((Date.now() - lastSyncAt) / 1000);
  statusEl.textContent = ago < 5 ? 'live' : `synced ${ago}s ago`;
}

// Hooks for the OG-preview generator (generate-previews.js). Lets the
// hook scatter checks into state and force a paint without having to
// reach into module internals.
window.cbState = state;
window.cbPaintAll = paintAllTiles;

buildTiles();
paintAllTiles();

if (CONFIGURED) {
  poll();
  setInterval(poll, CONFIG.pollIntervalMs);
  setInterval(setStatusIdle, 1000);
} else {
  statusEl.textContent = 'demo mode';
}
