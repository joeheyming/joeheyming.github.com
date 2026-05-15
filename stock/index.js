// Stock Ticker — main entry. ES module.
// Owns app state, persistence, URL state, all UI wiring. Delegates chart drawing
// to ChartView and stat-panel rendering to DetailView.

import { searchTickers, fetchManyCharts, fetchQuotesWithFallback } from './api.js';
import { ChartView } from './chart-view.js';
import { DetailView } from './detail-view.js';
import {
  newAlertId,
  ensureNotificationPermission,
  checkAlerts,
  notifyAlert
} from './alerts.js';

const STORAGE_KEY = 'heyming.stock.v2';

/** @typedef {import('./api.js').ChartSeries} ChartSeries */
/** @typedef {import('./alerts.js').AlertSpec} AlertSpec */

/**
 * @typedef {Object} WatchEntry
 * @property {string} symbol
 * @property {string} [name]
 * @property {boolean} visible
 * @property {number} [shares]
 * @property {number} [costBasis]
 */

/**
 * @typedef {Object} WatchList
 * @property {string} id
 * @property {string} name
 * @property {WatchEntry[]} symbols
 */

/**
 * @typedef {Object} AppState
 * @property {WatchList[]} lists
 * @property {string} activeListId
 * @property {'1d'|'5d'|'1mo'|'3mo'|'6mo'|'1y'|'5y'|'max'} range
 * @property {boolean} normalize
 * @property {boolean} logScale
 * @property {'line'|'area'|'candle'} chartType
 * @property {boolean} showVolume
 * @property {boolean} showRsi
 * @property {boolean} showMacd
 * @property {{sma20:boolean,sma50:boolean,sma200:boolean,ema12:boolean,ema26:boolean,bb:boolean}} indicators
 * @property {'chart'|'heatmap'|'portfolio'} mode
 * @property {number} autoRefreshSec
 * @property {AlertSpec[]} alerts
 */

const RANGES = [
  { id: '1d', label: '1D' },
  { id: '5d', label: '5D' },
  { id: '1mo', label: '1M' },
  { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
  { id: 'max', label: 'MAX' }
];

const PALETTE = [
  '#34d399',
  '#60a5fa',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#facc15',
  '#4ade80',
  '#f87171'
];

// --- DOM ---
const $ = (id) => /** @type {any} */ (document.getElementById(id));
const $search = /** @type {HTMLInputElement} */ ($('ticker-search'));
const $suggestions = $('ticker-suggestions');
const $listTabs = $('list-tabs');
const $rangeBtns = $('range-buttons');
const $typeBtns = $('chart-type-buttons');
const $indicatorsBtn = $('indicators-btn');
const $indicatorsMenu = $('indicators-menu');
const $normalize = /** @type {HTMLInputElement} */ ($('normalize-toggle'));
const $log = /** @type {HTMLInputElement} */ ($('log-toggle'));
const $autoRefresh = /** @type {HTMLSelectElement} */ ($('auto-refresh'));
const $refresh = $('refresh-btn');
const $exportPng = $('export-png');
const $copyLink = $('copy-link');
const $helpBtn = $('help-btn');
const $helpModal = $('help-modal');
const $helpClose = $('help-close');
const $tiles = $('quote-tiles');
const $chartMode = $('chart-mode');
const $heatmapMode = $('heatmap-mode');
const $portfolioMode = $('portfolio-mode');
const $heatmapGrid = $('heatmap-grid');
const $portfolioSummary = $('portfolio-summary');
const $portfolioTbody = $('portfolio-tbody');
const $priceCanvas = $('price-chart');
const $rsiCanvas = $('rsi-chart');
const $macdCanvas = $('macd-chart');
const $rsiPane = $('rsi-pane');
const $macdPane = $('macd-pane');
const $empty = $('chart-empty');
const $loading = $('chart-loading');
const $errorBox = $('chart-error');
const $listNew = $('list-new');
const $toastStack = $('toast-stack');

// --- Views ---
const chartView = new ChartView({
  priceCanvas: $priceCanvas,
  rsiCanvas: $rsiCanvas,
  macdCanvas: $macdCanvas,
  rsiPane: $rsiPane,
  macdPane: $macdPane
});

const detailView = new DetailView(
  {
    drawer: $('detail-drawer'),
    backdrop: $('detail-backdrop'),
    body: $('detail-body'),
    title: $('detail-title'),
    closeBtn: $('detail-close')
  },
  {
    getAlerts: () => state.alerts,
    addAlert: (a) => {
      state.alerts.push({ ...a, id: newAlertId() });
      saveState();
      ensureNotificationPermission().catch(() => {});
    },
    removeAlert: (id) => {
      state.alerts = state.alerts.filter((x) => x.id !== id);
      saveState();
    },
    getSeries: (sym) => seriesBySymbol.get(sym),
    onAddToPortfolio: (sym) => {
      state.mode = 'portfolio';
      const list = activeList();
      const entry = list?.symbols.find((e) => e.symbol === sym);
      if (entry && typeof entry.shares !== 'number') entry.shares = 0;
      saveState();
      applyMode();
      detailView.close();
    }
  }
);

// --- State ---

/** @type {AppState} */
const state = loadInitialState();

/** Cached series for the active list, keyed by symbol. */
const seriesBySymbol = new Map();

let inflightAbort = /** @type {AbortController|null} */ (null);
let fetchToken = 0;
let searchToken = 0;
let searchTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
let suggestionIndex = -1;
let autoRefreshTimer = /** @type {ReturnType<typeof setInterval>|null} */ (null);

// --- Persistence ---

function defaultState() {
  return /** @type {AppState} */ ({
    lists: [
      {
        id: newListId(),
        name: 'Watchlist',
        symbols: []
      }
    ],
    activeListId: '',
    range: '1mo',
    normalize: false,
    logScale: false,
    chartType: 'line',
    showVolume: false,
    showRsi: false,
    showMacd: false,
    indicators: {
      sma20: false,
      sma50: false,
      sma200: false,
      ema12: false,
      ema26: false,
      bb: false
    },
    mode: 'chart',
    autoRefreshSec: 0,
    alerts: []
  });
}

function newListId() {
  return 'wl_' + Math.random().toString(36).slice(2, 10);
}

function loadInitialState() {
  /** @type {AppState} */
  let s = defaultState();
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          s = sanitize({ ...s, ...parsed });
        }
      }
    } catch {
      /* ignore */
    }
  }
  // URL state overrides storage (so shared links work in a fresh window).
  const fromUrl = readUrlState();
  if (fromUrl) {
    if (Array.isArray(fromUrl.symbols) && fromUrl.symbols.length) {
      // Place into a new "Shared" list (or update existing one).
      let shared = s.lists.find((l) => l.name === 'Shared');
      if (!shared) {
        shared = { id: newListId(), name: 'Shared', symbols: [] };
        s.lists.push(shared);
      }
      shared.symbols = fromUrl.symbols.map((sym) => ({
        symbol: sym.toUpperCase(),
        name: '',
        visible: true
      }));
      s.activeListId = shared.id;
    }
    if (fromUrl.range) s.range = fromUrl.range;
    if (fromUrl.type) s.chartType = fromUrl.type;
    if (fromUrl.log != null) s.logScale = fromUrl.log;
    if (fromUrl.norm != null) s.normalize = fromUrl.norm;
    if (fromUrl.mode) s.mode = fromUrl.mode;
    if (fromUrl.indicators) {
      Object.assign(s.indicators, fromUrl.indicators);
    }
    if (fromUrl.panes) {
      s.showVolume = !!fromUrl.panes.volume;
      s.showRsi = !!fromUrl.panes.rsi;
      s.showMacd = !!fromUrl.panes.macd;
    }
  }
  // Ensure activeListId points at a real list.
  if (!s.lists.some((l) => l.id === s.activeListId)) {
    s.activeListId = s.lists[0]?.id || (s.lists[0] = { id: newListId(), name: 'Watchlist', symbols: [] }).id;
  }
  return s;
}

function sanitize(raw) {
  const d = defaultState();
  /** @type {AppState} */
  const out = {
    lists: Array.isArray(raw.lists) && raw.lists.length
      ? raw.lists.map((l) => ({
          id: typeof l.id === 'string' && l.id ? l.id : newListId(),
          name: typeof l.name === 'string' ? l.name : 'Watchlist',
          symbols: Array.isArray(l.symbols)
            ? l.symbols
                .map((e) => ({
                  symbol: String(e?.symbol || '').toUpperCase(),
                  name: typeof e?.name === 'string' ? e.name : '',
                  visible: e?.visible !== false,
                  shares: typeof e?.shares === 'number' ? e.shares : undefined,
                  costBasis: typeof e?.costBasis === 'number' ? e.costBasis : undefined
                }))
                .filter((e) => e.symbol)
            : []
        }))
      : d.lists,
    activeListId: typeof raw.activeListId === 'string' ? raw.activeListId : '',
    range: RANGES.some((r) => r.id === raw.range) ? raw.range : d.range,
    normalize: Boolean(raw.normalize),
    logScale: Boolean(raw.logScale),
    chartType: ['line', 'area', 'candle'].includes(raw.chartType) ? raw.chartType : d.chartType,
    showVolume: Boolean(raw.showVolume),
    showRsi: Boolean(raw.showRsi),
    showMacd: Boolean(raw.showMacd),
    indicators: { ...d.indicators, ...(raw.indicators || {}) },
    mode: ['chart', 'heatmap', 'portfolio'].includes(raw.mode) ? raw.mode : d.mode,
    autoRefreshSec:
      typeof raw.autoRefreshSec === 'number' && raw.autoRefreshSec >= 0
        ? raw.autoRefreshSec
        : d.autoRefreshSec,
    alerts: Array.isArray(raw.alerts)
      ? raw.alerts
          .map((a) => ({
            id: typeof a?.id === 'string' ? a.id : newAlertId(),
            symbol: String(a?.symbol || '').toUpperCase(),
            condition: a?.condition === 'below' ? 'below' : 'above',
            price: Number(a?.price),
            lastTriggeredAt: typeof a?.lastTriggeredAt === 'number' ? a.lastTriggeredAt : undefined
          }))
          .filter((a) => a.symbol && Number.isFinite(a.price))
      : []
  };
  return out;
}

function saveState() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

// --- URL state ---

function readUrlState() {
  const url = new URL(location.href);
  const sp = url.searchParams;
  if (![...sp.keys()].length) return null;
  /** @type {any} */
  const out = {};
  const list = sp.get('list');
  if (list) out.symbols = list.split(',').map((s) => s.trim()).filter(Boolean);
  const range = sp.get('range');
  if (range && RANGES.some((r) => r.id === range)) out.range = range;
  const type = sp.get('type');
  if (type && ['line', 'area', 'candle'].includes(type)) out.type = type;
  if (sp.has('log')) out.log = sp.get('log') === '1';
  if (sp.has('norm')) out.norm = sp.get('norm') === '1';
  const mode = sp.get('mode');
  if (mode && ['chart', 'heatmap', 'portfolio'].includes(mode)) out.mode = mode;
  const ind = sp.get('ind');
  if (ind) {
    out.indicators = {};
    ind.split(',').forEach((k) => (out.indicators[k] = true));
  }
  const panes = sp.get('panes');
  if (panes) {
    out.panes = {};
    panes.split(',').forEach((k) => (out.panes[k] = true));
  }
  return out;
}

function buildShareUrl() {
  const url = new URL(location.href);
  url.search = '';
  const list = activeList();
  if (list && list.symbols.length) {
    url.searchParams.set('list', list.symbols.map((s) => s.symbol).join(','));
  }
  url.searchParams.set('range', state.range);
  url.searchParams.set('type', state.chartType);
  url.searchParams.set('mode', state.mode);
  if (state.logScale) url.searchParams.set('log', '1');
  if (state.normalize) url.searchParams.set('norm', '1');
  const ind = Object.entries(state.indicators)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (ind.length) url.searchParams.set('ind', ind.join(','));
  const panes = [
    state.showVolume && 'volume',
    state.showRsi && 'rsi',
    state.showMacd && 'macd'
  ].filter(Boolean);
  if (panes.length) url.searchParams.set('panes', panes.join(','));
  return url.toString();
}

// --- Accessors ---

function activeList() {
  return state.lists.find((l) => l.id === state.activeListId);
}

function colorForIndex(i) {
  return PALETTE[i % PALETTE.length];
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c
  );
}

function formatPrice(n, currency) {
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: currency ? 'currency' : 'decimal',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

// --- Watchlist mutations ---

function addSymbolToActive(symbol, name) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;
  const list = activeList();
  if (!list) return;
  if (list.symbols.some((e) => e.symbol === sym)) return;
  list.symbols.push({ symbol: sym, name: name || '', visible: true });
  saveState();
  refreshAll();
}

function removeSymbol(symbol) {
  const sym = String(symbol).toUpperCase();
  const list = activeList();
  if (!list) return;
  list.symbols = list.symbols.filter((e) => e.symbol !== sym);
  seriesBySymbol.delete(sym);
  saveState();
  renderAll();
}

function toggleVisible(symbol) {
  const list = activeList();
  const e = list?.symbols.find((s) => s.symbol === symbol);
  if (!e) return;
  e.visible = !e.visible;
  saveState();
  renderAll();
}

function reorder(symbol, beforeSymbol) {
  const list = activeList();
  if (!list) return;
  const from = list.symbols.findIndex((s) => s.symbol === symbol);
  if (from < 0) return;
  const [moved] = list.symbols.splice(from, 1);
  const to = beforeSymbol
    ? list.symbols.findIndex((s) => s.symbol === beforeSymbol)
    : list.symbols.length;
  list.symbols.splice(to < 0 ? list.symbols.length : to, 0, moved);
  saveState();
  renderAll();
}

// --- List management ---

function newList() {
  const name = prompt('Watchlist name?', `Watchlist ${state.lists.length + 1}`);
  if (!name) return;
  const id = newListId();
  state.lists.push({ id, name, symbols: [] });
  state.activeListId = id;
  seriesBySymbol.clear();
  saveState();
  refreshAll();
}

function renameList(id) {
  const list = state.lists.find((l) => l.id === id);
  if (!list) return;
  const name = prompt('Rename watchlist:', list.name);
  if (!name) return;
  list.name = name;
  saveState();
  renderListTabs();
}

function deleteList(id) {
  if (state.lists.length <= 1) {
    showToast('Cannot delete the last watchlist.', 'error');
    return;
  }
  if (!confirm('Delete this watchlist?')) return;
  state.lists = state.lists.filter((l) => l.id !== id);
  if (state.activeListId === id) {
    state.activeListId = state.lists[0].id;
    seriesBySymbol.clear();
  }
  saveState();
  refreshAll();
}

function switchList(id) {
  if (id === state.activeListId) return;
  state.activeListId = id;
  seriesBySymbol.clear();
  saveState();
  refreshAll();
}

// --- Rendering: tabs ---

function renderListTabs() {
  $listTabs.innerHTML = '';
  state.lists.forEach((list) => {
    const isActive = list.id === state.activeListId;
    const tab = document.createElement('div');
    tab.className = 'list-tab' + (isActive ? ' active' : '');
    tab.setAttribute('role', 'tab');
    tab.innerHTML = `
      <span class="list-name">${escapeHtml(list.name)}</span>
      <span class="list-count">${list.symbols.length}</span>
      ${state.lists.length > 1 ? `<span class="list-close" title="Delete list">×</span>` : ''}
    `;
    tab.addEventListener('click', (e) => {
      const tgt = /** @type {HTMLElement} */ (e.target);
      if (tgt.classList.contains('list-close')) {
        e.stopPropagation();
        deleteList(list.id);
      } else {
        switchList(list.id);
      }
    });
    tab.addEventListener('dblclick', () => renameList(list.id));
    $listTabs.appendChild(tab);
  });
}

// --- Rendering: range and type ---

function renderRangeButtons() {
  $rangeBtns.innerHTML = '';
  RANGES.forEach((r) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'range-btn' + (state.range === r.id ? ' active' : '');
    btn.textContent = r.label;
    btn.addEventListener('click', () => {
      if (state.range === r.id) return;
      state.range = /** @type {AppState['range']} */ (r.id);
      saveState();
      renderRangeButtons();
      refreshAll();
    });
    $rangeBtns.appendChild(btn);
  });
}

function renderTypeButtons() {
  $typeBtns.querySelectorAll('button').forEach((btn) => {
    const t = btn.getAttribute('data-type');
    btn.classList.toggle('active', t === state.chartType);
  });
}

function renderIndicatorsMenu() {
  $indicatorsMenu.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    const key = /** @type {HTMLElement} */ (cb).dataset.ind;
    if (!key) return;
    if (key === 'volume') /** @type {HTMLInputElement} */ (cb).checked = state.showVolume;
    else if (key === 'rsi') /** @type {HTMLInputElement} */ (cb).checked = state.showRsi;
    else if (key === 'macd') /** @type {HTMLInputElement} */ (cb).checked = state.showMacd;
    else
      /** @type {HTMLInputElement} */ (cb).checked = !!state.indicators[
        /** @type {keyof typeof state.indicators} */ (key)
      ];
  });
}

// --- Rendering: quote tiles ---

function renderTiles() {
  $tiles.innerHTML = '';
  const list = activeList();
  if (!list) return;
  list.symbols.forEach((entry, idx) => {
    const series = seriesBySymbol.get(entry.symbol);
    const color = colorForIndex(idx);
    const tile = document.createElement('div');
    tile.className = 'quote-tile';
    tile.dataset.symbol = entry.symbol;
    tile.draggable = true;

    let priceHtml = '<span class="text-slate-500 text-sm">Loading…</span>';
    let deltaHtml = '';
    let cls = 'flat';
    let currency = 'USD';

    if (series) {
      const m = series.meta;
      currency = m.currency || 'USD';
      const last =
        typeof m.regularMarketPrice === 'number'
          ? m.regularMarketPrice
          : series.points.length
            ? series.points[series.points.length - 1].c
            : undefined;
      const prev =
        typeof m.chartPreviousClose === 'number'
          ? m.chartPreviousClose
          : series.points.length
            ? series.points[0].c
            : undefined;
      if (typeof last === 'number') {
        priceHtml = formatPrice(last, currency);
        if (typeof prev === 'number' && prev !== 0) {
          const diff = last - prev;
          const pct = (diff / prev) * 100;
          if (diff > 0) cls = 'up';
          else if (diff < 0) cls = 'down';
          const sign = diff >= 0 ? '+' : '';
          deltaHtml = `${sign}${formatPrice(diff, currency)} (${sign}${pct.toFixed(2)}%)`;
        }
      }
    }

    tile.classList.add(cls);
    if (!entry.visible) tile.classList.add('hidden-series');
    if (idx === 0) tile.classList.add('focused');

    const nameText = entry.name || series?.meta.longName || series?.meta.shortName || '';
    tile.innerHTML = `
      <div class="head">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="swatch" style="background:${color}"></span>
            <span class="sym">${escapeHtml(entry.symbol)}</span>
          </div>
          <div class="name" title="${escapeHtml(nameText)}">${escapeHtml(nameText)}</div>
        </div>
      </div>
      <div class="price-row">
        <div class="price">${priceHtml}</div>
        <div class="delta">${deltaHtml}</div>
      </div>
      <div class="actions">
        <button type="button" class="tile-btn js-detail">Stats</button>
        <button type="button" class="tile-btn js-toggle">${entry.visible ? 'Hide' : 'Show'}</button>
        <button type="button" class="tile-btn danger js-remove" aria-label="Remove ${escapeHtml(entry.symbol)}">×</button>
      </div>
    `;

    tile.querySelector('.js-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleVisible(entry.symbol);
    });
    tile.querySelector('.js-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSymbol(entry.symbol);
    });
    tile.querySelector('.js-detail')?.addEventListener('click', (e) => {
      e.stopPropagation();
      detailView.open(entry.symbol, nameText);
    });

    // Click the tile body opens detail.
    tile.addEventListener('click', () => detailView.open(entry.symbol, nameText));

    // Drag handlers.
    tile.addEventListener('dragstart', (ev) => {
      ev.dataTransfer?.setData('text/symbol', entry.symbol);
      tile.classList.add('dragging');
    });
    tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
    tile.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      tile.classList.add('drag-over');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
    tile.addEventListener('drop', (ev) => {
      ev.preventDefault();
      tile.classList.remove('drag-over');
      const src = ev.dataTransfer?.getData('text/symbol');
      if (src && src !== entry.symbol) reorder(src, entry.symbol);
    });

    $tiles.appendChild(tile);
  });
}

// --- Rendering: chart ---

function renderChart() {
  const list = activeList();
  const entries = list ? list.symbols : [];
  const hasAny = entries.length > 0;
  $empty.classList.toggle('hidden', hasAny);

  const inputs = entries.map((entry, idx) => ({
    symbol: entry.symbol,
    name: entry.name,
    color: colorForIndex(idx),
    visible: entry.visible,
    series: seriesBySymbol.get(entry.symbol)
  }));

  chartView.render(inputs, {
    range: state.range,
    normalize: state.normalize,
    logScale: state.logScale,
    chartType: state.chartType,
    showVolume: state.showVolume,
    showRsi: state.showRsi,
    showMacd: state.showMacd,
    indicators: state.indicators
  });
}

// --- Rendering: heatmap ---

function renderHeatmap() {
  $heatmapGrid.innerHTML = '';
  const list = activeList();
  if (!list) return;

  list.symbols.forEach((entry) => {
    const series = seriesBySymbol.get(entry.symbol);
    const tile = document.createElement('div');
    tile.className = 'heatmap-tile';

    let last = null;
    let prev = null;
    let currency = 'USD';
    if (series) {
      currency = series.meta.currency || 'USD';
      last =
        typeof series.meta.regularMarketPrice === 'number'
          ? series.meta.regularMarketPrice
          : series.points.length
            ? series.points[series.points.length - 1].c
            : null;
      prev =
        typeof series.meta.chartPreviousClose === 'number'
          ? series.meta.chartPreviousClose
          : series.points.length
            ? series.points[0].c
            : null;
    }
    /** @type {number} */
    let pct = 0;
    if (typeof last === 'number' && typeof prev === 'number' && prev !== 0) {
      pct = ((last - prev) / prev) * 100;
    }
    // Color intensity scales with |pct|, capped at 5%.
    const intensity = Math.min(1, Math.abs(pct) / 5);
    const r = pct >= 0 ? 16 : 248;
    const g = pct >= 0 ? 185 : 113;
    const b = pct >= 0 ? 129 : 113;
    tile.style.background = `rgba(${r}, ${g}, ${b}, ${0.12 + intensity * 0.4})`;
    tile.style.borderColor = `rgba(${r}, ${g}, ${b}, ${0.4 + intensity * 0.4})`;

    tile.innerHTML = `
      <div class="h-sym">${escapeHtml(entry.symbol)}</div>
      <div class="h-price">${typeof last === 'number' ? formatPrice(last, currency) : '—'}</div>
      <div class="h-delta">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</div>
    `;
    tile.addEventListener('click', () => detailView.open(entry.symbol, entry.name));
    $heatmapGrid.appendChild(tile);
  });
}

// --- Rendering: portfolio ---

function renderPortfolio() {
  const list = activeList();
  if (!list) return;
  $portfolioTbody.innerHTML = '';

  let totalCost = 0;
  let totalValue = 0;
  let totalDay = 0;

  list.symbols.forEach((entry) => {
    const series = seriesBySymbol.get(entry.symbol);
    const last =
      typeof series?.meta.regularMarketPrice === 'number'
        ? series.meta.regularMarketPrice
        : series?.points?.length
          ? series.points[series.points.length - 1].c
          : null;
    const prev =
      typeof series?.meta.chartPreviousClose === 'number'
        ? series.meta.chartPreviousClose
        : series?.points?.length
          ? series.points[0].c
          : null;
    const currency = series?.meta.currency || 'USD';

    const shares = entry.shares ?? 0;
    const cost = entry.costBasis ?? 0;
    const mktVal = typeof last === 'number' ? last * shares : 0;
    const costVal = cost * shares;
    const dayDiff = typeof last === 'number' && typeof prev === 'number' ? (last - prev) * shares : 0;
    const totalDiff = mktVal - costVal;

    totalCost += costVal;
    totalValue += mktVal;
    totalDay += dayDiff;

    const dayCls =
      dayDiff > 0 ? 'text-emerald-400' : dayDiff < 0 ? 'text-rose-400' : 'text-slate-300';
    const totalCls =
      totalDiff > 0 ? 'text-emerald-400' : totalDiff < 0 ? 'text-rose-400' : 'text-slate-300';

    const totalPct = costVal !== 0 ? (totalDiff / costVal) * 100 : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-2 py-1.5 font-medium">${escapeHtml(entry.symbol)}</td>
      <td class="px-2 py-1.5 text-right">
        <input type="number" min="0" step="any" value="${shares || ''}" data-field="shares" placeholder="0" />
      </td>
      <td class="px-2 py-1.5 text-right">
        <input type="number" min="0" step="any" value="${cost || ''}" data-field="costBasis" placeholder="0.00" />
      </td>
      <td class="px-2 py-1.5 text-right tabular-nums">${typeof last === 'number' ? formatPrice(last, currency) : '—'}</td>
      <td class="px-2 py-1.5 text-right tabular-nums">${formatPrice(mktVal, currency)}</td>
      <td class="px-2 py-1.5 text-right tabular-nums ${dayCls}">${dayDiff >= 0 ? '+' : ''}${formatPrice(dayDiff, currency)}</td>
      <td class="px-2 py-1.5 text-right tabular-nums ${totalCls}">
        ${totalDiff >= 0 ? '+' : ''}${formatPrice(totalDiff, currency)}
        <span class="text-xs">(${totalDiff >= 0 ? '+' : ''}${totalPct.toFixed(2)}%)</span>
      </td>
      <td class="px-2 py-1.5 text-right">
        <button class="text-slate-500 hover:text-rose-400 text-sm" data-rm="${escapeHtml(entry.symbol)}">×</button>
      </td>
    `;
    tr.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const field = inp.getAttribute('data-field');
        const v = parseFloat(inp.value);
        if (field === 'shares') entry.shares = Number.isFinite(v) ? v : 0;
        if (field === 'costBasis') entry.costBasis = Number.isFinite(v) ? v : 0;
        saveState();
        renderPortfolio();
      });
    });
    tr.querySelector('[data-rm]')?.addEventListener('click', () => removeSymbol(entry.symbol));
    $portfolioTbody.appendChild(tr);
  });

  const dayCls =
    totalDay > 0 ? 'text-emerald-400' : totalDay < 0 ? 'text-rose-400' : 'text-slate-300';
  const totalPL = totalValue - totalCost;
  const totalCls =
    totalPL > 0 ? 'text-emerald-400' : totalPL < 0 ? 'text-rose-400' : 'text-slate-300';
  const totalPct = totalCost !== 0 ? (totalPL / totalCost) * 100 : 0;

  $portfolioSummary.innerHTML = `
    <div class="summary-card"><div class="lbl">Total cost</div><div class="val">${formatPrice(totalCost)}</div></div>
    <div class="summary-card"><div class="lbl">Market value</div><div class="val">${formatPrice(totalValue)}</div></div>
    <div class="summary-card"><div class="lbl">Day Δ</div><div class="val ${dayCls}">${totalDay >= 0 ? '+' : ''}${formatPrice(totalDay)}</div></div>
    <div class="summary-card">
      <div class="lbl">Total P/L</div>
      <div class="val ${totalCls}">
        ${totalPL >= 0 ? '+' : ''}${formatPrice(totalPL)}
        <span class="text-sm">(${totalPL >= 0 ? '+' : ''}${totalPct.toFixed(2)}%)</span>
      </div>
    </div>
  `;
}

// --- Mode switching ---

function applyMode() {
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    const m = btn.getAttribute('data-mode');
    btn.classList.toggle('active', m === state.mode);
  });
  $chartMode.classList.toggle('hidden', state.mode !== 'chart');
  $heatmapMode.classList.toggle('hidden', state.mode !== 'heatmap');
  $portfolioMode.classList.toggle('hidden', state.mode !== 'portfolio');

  // The chart's resize observer needs a kick after un-hiding.
  if (state.mode === 'chart') {
    setTimeout(() => renderChart(), 0);
  } else if (state.mode === 'heatmap') {
    renderHeatmap();
  } else if (state.mode === 'portfolio') {
    renderPortfolio();
  }
}

// --- Top-level render orchestration ---

function renderAll() {
  renderListTabs();
  renderTiles();
  if (state.mode === 'chart') renderChart();
  if (state.mode === 'heatmap') renderHeatmap();
  if (state.mode === 'portfolio') renderPortfolio();
}

// --- Fetching ---

async function refreshAll() {
  if (inflightAbort) {
    try {
      inflightAbort.abort();
    } catch {
      /* ignore */
    }
  }
  inflightAbort = new AbortController();
  const myToken = ++fetchToken;

  hideError();
  renderListTabs();
  renderTiles();
  if (state.mode === 'chart') renderChart();
  if (state.mode === 'heatmap') renderHeatmap();
  if (state.mode === 'portfolio') renderPortfolio();

  const list = activeList();
  const symbols = list ? list.symbols.map((s) => s.symbol) : [];
  if (!symbols.length) {
    seriesBySymbol.clear();
    $loading.classList.add('hidden');
    renderChart();
    return;
  }

  $loading.classList.remove('hidden');

  let results;
  try {
    results = await fetchManyCharts(symbols, state.range, { signal: inflightAbort.signal });
  } catch (err) {
    if (myToken !== fetchToken) return;
    showError(`Network error: ${err?.message || err}`);
    $loading.classList.add('hidden');
    return;
  }
  if (myToken !== fetchToken) return;

  // Prune cache to active list.
  const watched = new Set(symbols);
  for (const k of Array.from(seriesBySymbol.keys())) {
    if (!watched.has(k)) seriesBySymbol.delete(k);
  }

  const errors = [];
  for (const r of results) {
    if (r.series) {
      seriesBySymbol.set(r.symbol, r.series);
      const entry = list?.symbols.find((e) => e.symbol === r.symbol);
      if (entry && !entry.name) {
        entry.name = r.series.meta.longName || r.series.meta.shortName || '';
      }
    } else if (r.error) {
      errors.push(`${r.symbol}: ${r.error}`);
    }
  }
  if (errors.length) showError(errors.join(' · '));
  saveState();

  $loading.classList.add('hidden');
  renderAll();
  evaluateAlerts();
}

function evaluateAlerts() {
  if (!state.alerts.length) return;
  /** @type {{symbol:string, price:number|undefined}[]} */
  const quotes = state.alerts.map((a) => {
    const s = seriesBySymbol.get(a.symbol);
    const p =
      typeof s?.meta.regularMarketPrice === 'number'
        ? s.meta.regularMarketPrice
        : s?.points?.length
          ? s.points[s.points.length - 1].c
          : undefined;
    return { symbol: a.symbol, price: p };
  });
  const { triggered, updated } = checkAlerts(state.alerts, quotes);
  if (triggered.length) {
    state.alerts = updated;
    saveState();
    triggered.forEach(({ alert, price }) => {
      notifyAlert(alert, price);
      showToast(
        `⚡ ${alert.symbol} ${alert.condition === 'above' ? '≥' : '≤'} ${alert.price} — now ${price.toFixed(2)}`,
        'alert',
        8000
      );
    });
  }
}

// --- Search dropdown ---

function onSearchInput() {
  const q = $search.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (!q) {
    closeSuggestions();
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 200);
}

async function runSearch(q) {
  const myToken = ++searchToken;
  try {
    const hits = await searchTickers(q);
    if (myToken !== searchToken) return;
    renderSuggestions(hits, q);
  } catch (err) {
    if (myToken !== searchToken) return;
    $suggestions.innerHTML = `<div class="px-3 py-2 text-sm text-rose-300">Search failed: ${escapeHtml(
      err?.message || String(err)
    )}</div>`;
    $suggestions.classList.remove('hidden');
  }
}

function renderSuggestions(hits, q) {
  const raw = q.toUpperCase();
  /** @type {{symbol:string,name:string,exchange:string,type:string}[]} */
  const rows = [];
  if (raw && !hits.some((h) => h.symbol.toUpperCase() === raw)) {
    rows.push({ symbol: raw, name: 'Add as ticker', exchange: '', type: '' });
  }
  rows.push(...hits.slice(0, 10));

  if (!rows.length) {
    $suggestions.innerHTML = `<div class="px-3 py-2 text-sm text-slate-400">No results.</div>`;
    $suggestions.classList.remove('hidden');
    suggestionIndex = -1;
    return;
  }

  $suggestions.innerHTML = '';
  rows.forEach((hit, idx) => {
    const row = document.createElement('div');
    row.className = 'suggestion-row';
    row.dataset.idx = String(idx);
    row.innerHTML = `
      <div class="min-w-0">
        <div class="sym">${escapeHtml(hit.symbol)}</div>
        <div class="name">${escapeHtml(hit.name)}</div>
      </div>
      <div class="ex">${escapeHtml(hit.exchange || hit.type || '')}</div>
    `;
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addSymbolToActive(hit.symbol, hit.name);
      $search.value = '';
      closeSuggestions();
    });
    row.addEventListener('mouseenter', () => {
      suggestionIndex = idx;
      highlightSuggestion();
    });
    $suggestions.appendChild(row);
  });

  suggestionIndex = 0;
  highlightSuggestion();
  $suggestions.classList.remove('hidden');
}

function closeSuggestions() {
  $suggestions.classList.add('hidden');
  $suggestions.innerHTML = '';
  suggestionIndex = -1;
}

function highlightSuggestion() {
  $suggestions.querySelectorAll('.suggestion-row').forEach((r, i) =>
    r.classList.toggle('hl', i === suggestionIndex)
  );
}

function onSearchKeydown(e) {
  const rows = $suggestions.querySelectorAll('.suggestion-row');
  if (e.key === 'ArrowDown') {
    if (!rows.length) return;
    e.preventDefault();
    suggestionIndex = (suggestionIndex + 1) % rows.length;
    highlightSuggestion();
  } else if (e.key === 'ArrowUp') {
    if (!rows.length) return;
    e.preventDefault();
    suggestionIndex = (suggestionIndex - 1 + rows.length) % rows.length;
    highlightSuggestion();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (rows.length && suggestionIndex >= 0) {
      rows[suggestionIndex].dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      );
    } else if ($search.value.trim()) {
      addSymbolToActive($search.value.trim().toUpperCase());
      $search.value = '';
      closeSuggestions();
    }
  } else if (e.key === 'Escape') {
    closeSuggestions();
  }
}

// --- Errors & toasts ---

function showError(msg) {
  $errorBox.textContent = msg;
  $errorBox.classList.remove('hidden');
}
function hideError() {
  $errorBox.textContent = '';
  $errorBox.classList.add('hidden');
}

function showToast(msg, kind = 'info', ms = 4000) {
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.innerHTML = `<span>${escapeHtml(msg)}</span><span class="toast-close" aria-label="Dismiss">×</span>`;
  t.querySelector('.toast-close')?.addEventListener('click', () => t.remove());
  $toastStack.appendChild(t);
  if (ms > 0) setTimeout(() => t.remove(), ms);
}

// --- Auto-refresh ---

function applyAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (state.autoRefreshSec > 0) {
    autoRefreshTimer = setInterval(() => {
      // Lightweight quote refresh: just update meta prices without full chart redraw.
      refreshQuotesOnly();
    }, state.autoRefreshSec * 1000);
  }
}

async function refreshQuotesOnly() {
  const list = activeList();
  if (!list || !list.symbols.length) return;
  const symbols = list.symbols.map((s) => s.symbol);
  const quotes = await fetchQuotesWithFallback(symbols).catch(() => []);
  if (!quotes.length) return;
  for (const q of quotes) {
    const s = seriesBySymbol.get(q.symbol);
    if (s && typeof q.regularMarketPrice === 'number') {
      s.meta.regularMarketPrice = q.regularMarketPrice;
    }
    if (s && typeof q.regularMarketPreviousClose === 'number') {
      s.meta.chartPreviousClose = q.regularMarketPreviousClose;
    }
  }
  renderTiles();
  if (state.mode === 'heatmap') renderHeatmap();
  if (state.mode === 'portfolio') renderPortfolio();
  evaluateAlerts();
}

// --- Keyboard shortcuts ---

function onKeydown(e) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key;
  if (key === '/') {
    e.preventDefault();
    $search.focus();
  } else if (key === 'r' || key === 'R') {
    refreshAll();
  } else if (key === 'l' || key === 'L') {
    state.logScale = !state.logScale;
    $log.checked = state.logScale;
    saveState();
    renderChart();
  } else if (key === '%') {
    state.normalize = !state.normalize;
    $normalize.checked = state.normalize;
    saveState();
    renderChart();
  } else if (key === 'v' || key === 'V') {
    state.showVolume = !state.showVolume;
    saveState();
    renderIndicatorsMenu();
    renderChart();
  } else if (key === 'i' || key === 'I') {
    $indicatorsMenu.classList.toggle('hidden');
  } else if (key === '?') {
    $helpModal.classList.remove('hidden');
  } else if (key === 'Escape') {
    $helpModal.classList.add('hidden');
    $indicatorsMenu.classList.add('hidden');
  } else if (key === 'c' || key === 'C') {
    state.chartType = 'line';
    saveState();
    renderTypeButtons();
    renderChart();
  } else if (key === 'a' || key === 'A') {
    state.chartType = 'area';
    saveState();
    renderTypeButtons();
    renderChart();
  } else if (key === 'k' || key === 'K') {
    state.chartType = 'candle';
    saveState();
    renderTypeButtons();
    renderChart();
  } else if (key === 'm' || key === 'M') {
    const modes = /** @type {const} */ (['chart', 'heatmap', 'portfolio']);
    const idx = modes.indexOf(state.mode);
    state.mode = modes[(idx + 1) % modes.length];
    saveState();
    applyMode();
  } else if (/^[1-8]$/.test(key)) {
    const r = RANGES[parseInt(key, 10) - 1];
    if (r) {
      state.range = /** @type {AppState['range']} */ (r.id);
      saveState();
      renderRangeButtons();
      refreshAll();
    }
  }
}

// --- PNG export ---

function exportPng() {
  const dataUrl = chartView.toPNG();
  if (!dataUrl) {
    showToast('No chart to export — add a ticker first.', 'error');
    return;
  }
  const a = document.createElement('a');
  const list = activeList();
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = dataUrl;
  a.download = `stocks-${list?.name || 'chart'}-${state.range}-${stamp}.png`.replace(/\s+/g, '-');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --- Share link ---

async function copyShareLink() {
  const url = buildShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copied — paste anywhere to share this view.', 'info');
  } catch {
    // Fallback: show URL in a toast for manual copy.
    showToast(`Copy: ${url}`, 'info', 8000);
  }
}

// --- Init / wire ---

function init() {
  if (!state.activeListId) state.activeListId = state.lists[0].id;

  renderListTabs();
  renderRangeButtons();
  renderTypeButtons();
  renderIndicatorsMenu();
  $normalize.checked = state.normalize;
  $log.checked = state.logScale;
  $autoRefresh.value = String(state.autoRefreshSec);

  applyMode();

  // List management.
  $listNew.addEventListener('click', newList);

  // Search.
  $search.addEventListener('input', onSearchInput);
  $search.addEventListener('keydown', onSearchKeydown);
  $search.addEventListener('blur', () => setTimeout(closeSuggestions, 120));
  $search.addEventListener('focus', () => {
    if ($search.value.trim()) onSearchInput();
  });

  // Toggles.
  $normalize.addEventListener('change', () => {
    state.normalize = $normalize.checked;
    saveState();
    renderChart();
  });
  $log.addEventListener('change', () => {
    state.logScale = $log.checked;
    saveState();
    renderChart();
  });
  $autoRefresh.addEventListener('change', () => {
    state.autoRefreshSec = parseInt($autoRefresh.value, 10) || 0;
    saveState();
    applyAutoRefresh();
  });

  // Type buttons.
  $typeBtns.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.chartType = /** @type {AppState['chartType']} */ (btn.getAttribute('data-type'));
      saveState();
      renderTypeButtons();
      renderChart();
    });
  });

  // Mode buttons.
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = /** @type {AppState['mode']} */ (btn.getAttribute('data-mode'));
      saveState();
      applyMode();
    });
  });

  // Indicators menu.
  $indicatorsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    $indicatorsMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (
      !$indicatorsMenu.contains(/** @type {Node} */ (e.target)) &&
      e.target !== $indicatorsBtn
    ) {
      $indicatorsMenu.classList.add('hidden');
    }
  });
  $indicatorsMenu.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const key = /** @type {HTMLElement} */ (cb).dataset.ind;
      const v = /** @type {HTMLInputElement} */ (cb).checked;
      if (!key) return;
      if (key === 'volume') state.showVolume = v;
      else if (key === 'rsi') state.showRsi = v;
      else if (key === 'macd') state.showMacd = v;
      else
        state.indicators[/** @type {keyof typeof state.indicators} */ (key)] = v;
      saveState();
      renderChart();
    });
  });

  // Toolbar buttons.
  $refresh.addEventListener('click', () => refreshAll());
  $exportPng.addEventListener('click', exportPng);
  $copyLink.addEventListener('click', copyShareLink);
  $helpBtn.addEventListener('click', () => $helpModal.classList.remove('hidden'));
  $helpClose.addEventListener('click', () => $helpModal.classList.add('hidden'));
  $helpModal.addEventListener('click', (e) => {
    if (e.target === $helpModal) $helpModal.classList.add('hidden');
  });

  // Suggested-empty-state buttons.
  document.querySelectorAll('button[data-add-suggested]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sym = btn.getAttribute('data-add-suggested');
      if (sym) addSymbolToActive(sym);
    });
  });

  // Global keyboard shortcuts.
  document.addEventListener('keydown', onKeydown);

  // Alerts via DOM event.
  document.addEventListener('stock:alert', () => {
    // The toast itself is fired in evaluateAlerts(); this is a hook point.
  });

  applyAutoRefresh();
  refreshAll();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
