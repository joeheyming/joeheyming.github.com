// Stock Ticker — state shape, sanitization, persistence, URL state.
// Pure module: no DOM, no closures over the running app.

import { newAlertId } from './alerts.js';
import { createPrefs } from '/play/shared/prefs.js';

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

export const STORAGE_KEY = 'heyming.stock.v2';

export const RANGES = [
  { id: '1d', label: '1D' },
  { id: '5d', label: '5D' },
  { id: '1mo', label: '1M' },
  { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
  { id: 'max', label: 'MAX' }
];

export function newListId() {
  return 'wl_' + Math.random().toString(36).slice(2, 10);
}

/** @returns {AppState} */
export function defaultState() {
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

/** @returns {AppState} */
export function sanitize(raw) {
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

export function readUrlState() {
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

// URL state has a different shape from on-disk state (it's flatter and
// uses short keys for nicer share URLs), so we can't use the standard
// `readUrlState` shallow-merge in createPrefs. Instead we let createPrefs
// read into a `__urlOverrides` slot via the helper below, then `sanitize`
// expands it back into the canonical AppState shape.
function _mergeUrlOverrides(state, overrides) {
  const s = { ...state };
  if (Array.isArray(overrides.symbols) && overrides.symbols.length) {
    // Place into a new "Shared" list (or update existing one).
    s.lists = state.lists.slice();
    let shared = s.lists.find((l) => l.name === 'Shared');
    if (!shared) {
      shared = { id: newListId(), name: 'Shared', symbols: [] };
      s.lists.push(shared);
    }
    shared.symbols = overrides.symbols.map((sym) => ({
      symbol: sym.toUpperCase(),
      name: '',
      visible: true
    }));
    s.activeListId = shared.id;
  }
  if (overrides.range) s.range = overrides.range;
  if (overrides.type) s.chartType = overrides.type;
  if (overrides.log != null) s.logScale = overrides.log;
  if (overrides.norm != null) s.normalize = overrides.norm;
  if (overrides.mode) s.mode = overrides.mode;
  if (overrides.indicators) {
    s.indicators = { ...state.indicators, ...overrides.indicators };
  }
  if (overrides.panes) {
    s.showVolume = !!overrides.panes.volume;
    s.showRsi = !!overrides.panes.rsi;
    s.showMacd = !!overrides.panes.macd;
  }
  return s;
}

const _prefs = createPrefs({
  key: STORAGE_KEY,
  defaults: defaultState,
  // Sanitize handles two cases: a freshly merged blob from localStorage
  // (`raw` already shaped like AppState) AND the URL-overrides envelope
  // produced by `readUrlState` below — the envelope rides on the
  // `__urlOverrides` field, which we expand here before re-sanitizing.
  sanitize: (raw) => {
    let s = sanitize(raw);
    if (raw && raw.__urlOverrides) {
      s = sanitize(_mergeUrlOverrides(s, raw.__urlOverrides));
    }
    // Ensure activeListId points at a real list.
    if (!s.lists.some((l) => l.id === s.activeListId)) {
      s.activeListId = s.lists[0]?.id || (s.lists[0] = { id: newListId(), name: 'Watchlist', symbols: [] }).id;
    }
    return s;
  },
  readUrlState: () => {
    const overrides = readUrlState();
    return overrides ? { __urlOverrides: overrides } : null;
  }
});

/** @returns {AppState} */
export function loadInitialState() {
  return _prefs.load();
}

export function saveState(state) {
  _prefs.save(state);
}

/**
 * @param {AppState} state
 * @param {WatchList | undefined} activeList
 */
export function buildShareUrl(state, activeList) {
  const url = new URL(location.href);
  url.search = '';
  if (activeList && activeList.symbols.length) {
    url.searchParams.set('list', activeList.symbols.map((s) => s.symbol).join(','));
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
