// Stock Ticker — main entry. ES module.
// Owns app state, persistence, URL state, all UI wiring. Delegates chart drawing
// to ChartView, stat-panel rendering to DetailView, and the three top-level
// list views (tiles, heatmap, portfolio) to ./views.js.

import { fetchManyCharts, fetchQuotesWithFallback } from './api.js';
import { ChartView } from './chart-view.js';
import { DetailView } from './detail-view.js';
import {
  newAlertId,
  ensureNotificationPermission,
  checkAlerts,
  notifyAlert
} from './alerts.js';
import {
  RANGES,
  loadInitialState,
  saveState as persistState,
  buildShareUrl,
  newListId
} from './state.js';
import { renderTiles, renderHeatmap, renderPortfolio } from './views.js';
import { createSearchController } from './search-ui.js';
import { createKeyboardHandler } from './keyboard.js';
import { colorForIndex, escapeHtml } from './format.js';
import { createNotifier } from '/notifications.js';

/** @typedef {import('./state.js').AppState} AppState */
/** @typedef {import('./api.js').ChartSeries} ChartSeries */

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
const $makePost = /** @type {HTMLButtonElement} */ ($('make-post'));
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
const $pricePane = $('price-pane');
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
let autoRefreshTimer = /** @type {ReturnType<typeof setInterval>|null} */ (null);

function saveState() {
  persistState(state);
}

function activeList() {
  return state.lists.find((l) => l.id === state.activeListId);
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

// --- Small renderers tied to the toolbar ---

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

// --- Composite renderers (delegate to views.js) ---

function renderTilesView() {
  renderTiles({
    container: $tiles,
    list: activeList(),
    seriesBySymbol,
    detailView,
    mutators: { toggleVisible, removeSymbol, reorder }
  });
}

function renderHeatmapView() {
  renderHeatmap({
    container: $heatmapGrid,
    list: activeList(),
    seriesBySymbol,
    detailView
  });
}

function renderPortfolioView() {
  renderPortfolio({
    tbody: $portfolioTbody,
    summary: $portfolioSummary,
    list: activeList(),
    seriesBySymbol,
    mutators: {
      saveState,
      removeSymbol,
      renderPortfolio: renderPortfolioView
    }
  });
}

function renderChart() {
  const list = activeList();
  const entries = list ? list.symbols : [];
  const hasAny = entries.length > 0;
  $empty.classList.toggle('hidden', hasAny);
  // Hide the chart canvas pane when empty so its default axes don't draw
  // behind the empty-state message and intercept clicks on its buttons.
  $pricePane.classList.toggle('hidden', !hasAny);

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
    renderHeatmapView();
  } else if (state.mode === 'portfolio') {
    renderPortfolioView();
  }
}

function renderAll() {
  renderListTabs();
  renderTilesView();
  if (state.mode === 'chart') renderChart();
  if (state.mode === 'heatmap') renderHeatmapView();
  if (state.mode === 'portfolio') renderPortfolioView();
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
  renderTilesView();
  if (state.mode === 'chart') renderChart();
  if (state.mode === 'heatmap') renderHeatmapView();
  if (state.mode === 'portfolio') renderPortfolioView();

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

// --- Errors & toasts ---

function showError(msg) {
  $errorBox.textContent = msg;
  $errorBox.classList.remove('hidden');
}
function hideError() {
  $errorBox.textContent = '';
  $errorBox.classList.add('hidden');
}

// Reuses the existing `.toast.toast-${kind}` CSS in stock/style.css; the
// shared notifier owns lifecycle + safety (textContent, ARIA, dismiss).
const _notifier = createNotifier({
  container: $toastStack,
  kindClass: (k) => `toast toast-${k}`,
  defaultDurationMs: 4000,
  dismissible: true
});
function showToast(msg, kind = 'info', ms = 4000) {
  _notifier.notify(msg, { kind, durationMs: ms });
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
  renderTilesView();
  if (state.mode === 'heatmap') renderHeatmapView();
  if (state.mode === 'portfolio') renderPortfolioView();
  evaluateAlerts();
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

async function makePost() {
  const dataUrl = chartView.toPNG();
  if (!dataUrl) {
    showToast('No chart to post — add a ticker first.', 'error');
    return;
  }

  const list = activeList();
  const symbol = list?.symbols.find((entry) => entry.visible)?.symbol || list?.symbols[0]?.symbol;
  if (!symbol) {
    showToast('No chart to post — add a ticker first.', 'error');
    return;
  }

  const range = RANGES.find((candidate) => candidate.id === state.range)?.label || state.range;
  $makePost.disabled = true;
  try {
    const { share } = await import('/posts/share-client.js');
    await share({
      text: `${symbol} · ${range} chart\n\nMade with [Stock Ticker](/stock/)`,
      attachments: [dataUrl]
    });
  } catch (err) {
    console.error('Could not share stock chart to Posts:', err);
    showToast('Could not prepare the chart post. Please try again.', 'error');
    $makePost.disabled = false;
  }
}

// --- Share link ---

async function copyShareLink() {
  const url = buildShareUrl(state, activeList());
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

  $listNew.addEventListener('click', newList);

  // Search controller.
  const search = createSearchController({
    input: $search,
    suggestions: $suggestions,
    onPick: (sym, name) => addSymbolToActive(sym, name)
  });
  $search.addEventListener('input', search.handleInput);
  $search.addEventListener('keydown', search.handleKeydown);
  $search.addEventListener('blur', () => setTimeout(search.close, 120));
  $search.addEventListener('focus', () => {
    if ($search.value.trim()) search.handleInput();
  });

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

  $typeBtns.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.chartType = /** @type {AppState['chartType']} */ (btn.getAttribute('data-type'));
      saveState();
      renderTypeButtons();
      renderChart();
    });
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = /** @type {AppState['mode']} */ (btn.getAttribute('data-mode'));
      saveState();
      applyMode();
    });
  });

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

  $refresh.addEventListener('click', () => refreshAll());
  $exportPng.addEventListener('click', exportPng);
  $makePost.addEventListener('click', makePost);
  $copyLink.addEventListener('click', copyShareLink);
  $helpBtn.addEventListener('click', () => $helpModal.classList.remove('hidden'));
  $helpClose.addEventListener('click', () => $helpModal.classList.add('hidden'));
  $helpModal.addEventListener('click', (e) => {
    if (e.target === $helpModal) $helpModal.classList.add('hidden');
  });

  document.querySelectorAll('button[data-add-suggested]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sym = btn.getAttribute('data-add-suggested');
      if (sym) addSymbolToActive(sym);
    });
  });

  document.addEventListener(
    'keydown',
    createKeyboardHandler({
      getState: () => state,
      $search,
      $log,
      $normalize,
      $indicatorsMenu,
      $helpModal,
      saveState,
      refreshAll,
      renderChart,
      renderTypeButtons,
      renderRangeButtons,
      renderIndicatorsMenu,
      applyMode
    })
  );

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
