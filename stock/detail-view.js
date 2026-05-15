// Detail drawer: per-symbol stats panel + news + price-alert form.
// Stats come from Yahoo v7/quote when reachable, with chart-derived fallbacks
// (52-week range, average volume, current price) so the panel is always useful.

import { fetchQuotesWithFallback, fetchNews } from './api.js';

/**
 * @typedef {import('./api.js').ExtendedQuote} ExtendedQuote
 * @typedef {import('./api.js').ChartSeries} ChartSeries
 * @typedef {import('./api.js').NewsItem} NewsItem
 * @typedef {import('./alerts.js').AlertSpec} AlertSpec
 */

/**
 * @typedef {Object} DetailDeps
 * @property {() => AlertSpec[]} getAlerts            All alerts (across symbols).
 * @property {(alert: Omit<AlertSpec,'id'|'lastTriggeredAt'>) => void} addAlert
 * @property {(id: string) => void} removeAlert
 * @property {(symbol: string) => ChartSeries|undefined} getSeries  Latest series in cache.
 * @property {(symbol: string) => void} onAddToPortfolio
 */

function fmt(n, opts = {}) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: opts.maxFrac ?? 2,
      minimumFractionDigits: opts.minFrac ?? 0,
      ...(opts.currency ? { style: 'currency', currency: opts.currency } : {})
    }).format(n);
  } catch {
    return n.toFixed(opts.maxFrac ?? 2);
  }
}
function fmtCompact(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(
    n
  );
}
function fmtPct(n, digits = 2) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(digits)}%`;
}
function fmtDate(ms) {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c
  );
}

/**
 * Compute fallback stats from a chart series (for use when v7/quote is unavailable).
 * @param {ChartSeries} series
 */
function fallbackStatsFromSeries(series) {
  const pts = series.points;
  if (!pts.length) return {};
  const closes = pts.map((p) => p.c);
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const volSamples = pts.map((p) => p.v).filter((v) => typeof v === 'number');
  const avgVol = volSamples.length
    ? volSamples.reduce((a, b) => a + b, 0) / volSamples.length
    : null;
  return {
    rangeHigh: high,
    rangeLow: low,
    avgVolInRange: avgVol,
    pointsCount: pts.length,
    firstPrice: closes[0],
    lastPrice: closes[closes.length - 1]
  };
}

export class DetailView {
  /**
   * @param {{
   *   drawer: HTMLElement,
   *   backdrop: HTMLElement,
   *   body: HTMLElement,
   *   title: HTMLElement,
   *   closeBtn: HTMLElement
   * }} els
   * @param {DetailDeps} deps
   */
  constructor(els, deps) {
    this.els = els;
    this.deps = deps;
    this.currentSymbol = '';
    this.currentName = '';
    this.lastQuote = /** @type {ExtendedQuote|undefined} */ (undefined);

    this.els.closeBtn.addEventListener('click', () => this.close());
    this.els.backdrop.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });
  }

  isOpen() {
    return !this.els.drawer.classList.contains('hidden');
  }

  /**
   * Open the drawer for a given symbol.
   * @param {string} symbol
   * @param {string} [name]
   */
  async open(symbol, name) {
    const sym = String(symbol).toUpperCase();
    this.currentSymbol = sym;
    this.currentName = name || '';

    this.els.title.textContent = sym + (name ? ` — ${name}` : '');
    this.els.drawer.classList.remove('hidden');
    this.els.backdrop.classList.remove('hidden');

    this._renderSkeleton();
    await this._loadAndRender();
  }

  close() {
    this.els.drawer.classList.add('hidden');
    this.els.backdrop.classList.add('hidden');
    this.currentSymbol = '';
  }

  /** Refresh the panel (e.g. after a stat or alert change). */
  async refresh() {
    if (!this.currentSymbol) return;
    await this._loadAndRender();
  }

  // --- internals ---

  _renderSkeleton() {
    this.els.body.innerHTML = `
      <div class="space-y-4">
        <div class="text-sm text-slate-400">Loading stats…</div>
      </div>
    `;
  }

  async _loadAndRender() {
    const sym = this.currentSymbol;
    const series = this.deps.getSeries(sym);

    // Fire stats + news in parallel; degrade gracefully on either failure.
    const [quotes, news] = await Promise.all([
      fetchQuotesWithFallback([sym]).catch(() => []),
      fetchNews(sym, { count: 8 }).catch(() => [])
    ]);

    if (this.currentSymbol !== sym) return; // user closed/changed during fetch

    const q = quotes[0];
    this.lastQuote = q;
    const fb = series ? fallbackStatsFromSeries(series) : {};

    this._render(q, series, fb, news);
  }

  /**
   * @param {ExtendedQuote|undefined} q
   * @param {ChartSeries|undefined} series
   * @param {ReturnType<typeof fallbackStatsFromSeries>} fb
   * @param {NewsItem[]} news
   */
  _render(q, series, fb, news) {
    const sym = this.currentSymbol;
    const currency = q?.currency || series?.meta?.currency || 'USD';
    const price =
      q?.regularMarketPrice ??
      series?.meta?.regularMarketPrice ??
      fb.lastPrice ??
      undefined;
    const prev =
      q?.regularMarketPreviousClose ??
      series?.meta?.chartPreviousClose ??
      fb.firstPrice ??
      undefined;
    const change =
      typeof q?.regularMarketChange === 'number'
        ? q.regularMarketChange
        : typeof price === 'number' && typeof prev === 'number'
          ? price - prev
          : undefined;
    const changePct =
      typeof q?.regularMarketChangePercent === 'number'
        ? q.regularMarketChangePercent
        : typeof change === 'number' && typeof prev === 'number' && prev !== 0
          ? (change / prev) * 100
          : undefined;

    const dirCls =
      typeof change === 'number'
        ? change > 0
          ? 'text-emerald-400'
          : change < 0
            ? 'text-rose-400'
            : 'text-slate-300'
        : 'text-slate-300';

    const longName = q?.longName || q?.shortName || this.currentName || sym;

    // Pull values with v7 → v10 → chart-meta fallback chain.
    const m = series?.meta;
    const marketCap = q?.marketCap;
    const volume = q?.regularMarketVolume ?? m?.regularMarketVolume;
    const dayHigh = q?.regularMarketDayHigh ?? m?.regularMarketDayHigh;
    const dayLow = q?.regularMarketDayLow ?? m?.regularMarketDayLow;
    const fiftyTwoH = q?.fiftyTwoWeekHigh ?? m?.fiftyTwoWeekHigh;
    const fiftyTwoL = q?.fiftyTwoWeekLow ?? m?.fiftyTwoWeekLow;

    /** [label, value, optionalCls] rows. */
    const stats = [
      [
        'Market cap',
        typeof marketCap === 'number' ? fmtCompact(marketCap) : '—'
      ],
      ['Volume', typeof volume === 'number' ? fmtCompact(volume) : '—'],
      [
        'Avg vol (3M)',
        typeof q?.averageDailyVolume3Month === 'number'
          ? fmtCompact(q.averageDailyVolume3Month)
          : fb.avgVolInRange != null
            ? fmtCompact(fb.avgVolInRange)
            : '—'
      ],
      ['P/E (TTM)', typeof q?.trailingPE === 'number' ? fmt(q.trailingPE) : '—'],
      ['Fwd P/E', typeof q?.forwardPE === 'number' ? fmt(q.forwardPE) : '—'],
      ['P/Book', typeof q?.priceToBook === 'number' ? fmt(q.priceToBook) : '—'],
      [
        'EPS (TTM)',
        typeof q?.epsTrailingTwelveMonths === 'number' ? fmt(q.epsTrailingTwelveMonths) : '—'
      ],
      ['Beta', typeof q?.beta === 'number' ? fmt(q.beta) : '—'],
      [
        'Div yield',
        typeof q?.dividendYield === 'number'
          ? `${(q.dividendYield * 100).toFixed(2)}%`
          : typeof q?.trailingAnnualDividendYield === 'number'
            ? `${(q.trailingAnnualDividendYield * 100).toFixed(2)}%`
            : '—'
      ],
      [
        'Div rate',
        typeof q?.dividendRate === 'number'
          ? fmt(q.dividendRate, { currency })
          : typeof q?.trailingAnnualDividendRate === 'number'
            ? fmt(q.trailingAnnualDividendRate, { currency })
            : '—'
      ],
      ['Shares out', typeof q?.sharesOutstanding === 'number' ? fmtCompact(q.sharesOutstanding) : '—'],
      ['Float', typeof q?.floatShares === 'number' ? fmtCompact(q.floatShares) : '—']
    ];

    const range = [
      ['Day low', typeof dayLow === 'number' ? fmt(dayLow, { currency }) : '—'],
      ['Day high', typeof dayHigh === 'number' ? fmt(dayHigh, { currency }) : '—'],
      ['Open', typeof q?.regularMarketOpen === 'number' ? fmt(q.regularMarketOpen, { currency }) : '—'],
      ['Prev close', typeof prev === 'number' ? fmt(prev, { currency }) : '—'],
      [
        '52W low',
        typeof fiftyTwoL === 'number'
          ? fmt(fiftyTwoL, { currency })
          : typeof fb.rangeLow === 'number'
            ? fmt(fb.rangeLow, { currency })
            : '—'
      ],
      [
        '52W high',
        typeof fiftyTwoH === 'number'
          ? fmt(fiftyTwoH, { currency })
          : typeof fb.rangeHigh === 'number'
            ? fmt(fb.rangeHigh, { currency })
            : '—'
      ],
      ['50D avg', typeof q?.fiftyDayAverage === 'number' ? fmt(q.fiftyDayAverage, { currency }) : '—'],
      ['200D avg', typeof q?.twoHundredDayAverage === 'number' ? fmt(q.twoHundredDayAverage, { currency }) : '—']
    ];

    const earnings = typeof q?.earningsTimestamp === 'number'
      ? new Date(q.earningsTimestamp * 1000).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        })
      : '—';

    const alerts = this.deps.getAlerts().filter((a) => a.symbol === sym);

    this.els.body.innerHTML = `
      <section class="mb-5">
        <div class="text-xs uppercase tracking-wide text-slate-500">${escapeHtml(longName)}</div>
        <div class="flex items-baseline gap-3 mt-1">
          <div class="text-3xl font-semibold tabular-nums">
            ${typeof price === 'number' ? fmt(price, { currency }) : '—'}
          </div>
          <div class="text-sm ${dirCls} tabular-nums">
            ${
              typeof change === 'number'
                ? `${change >= 0 ? '+' : ''}${fmt(change, { currency })} (${fmtPct(changePct ?? 0)})`
                : ''
            }
          </div>
        </div>
        <div class="text-xs text-slate-500 mt-1">
          ${escapeHtml(q?.exchange || series?.meta?.exchangeName || '')}
          ${q?.marketState ? ` · ${escapeHtml(q.marketState)}` : ''}
          ${q?.preMarketPrice ? ` · Pre: ${fmt(q.preMarketPrice, { currency })} (${fmtPct(q.preMarketChangePercent ?? 0)})` : ''}
          ${q?.postMarketPrice ? ` · After: ${fmt(q.postMarketPrice, { currency })} (${fmtPct(q.postMarketChangePercent ?? 0)})` : ''}
        </div>
      </section>

      <section class="mb-5">
        <h3 class="section-h">Key stats</h3>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          ${stats
            .map(
              ([k, v]) => `
            <div class="flex items-center justify-between border-b border-slate-800/70 py-1">
              <span class="text-slate-400">${escapeHtml(k)}</span>
              <span class="tabular-nums">${v}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </section>

      <section class="mb-5">
        <h3 class="section-h">Trading range</h3>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          ${range
            .map(
              ([k, v]) => `
            <div class="flex items-center justify-between border-b border-slate-800/70 py-1">
              <span class="text-slate-400">${escapeHtml(k)}</span>
              <span class="tabular-nums">${v}</span>
            </div>
          `
            )
            .join('')}
          <div class="flex items-center justify-between border-b border-slate-800/70 py-1 col-span-2">
            <span class="text-slate-400">Next earnings</span>
            <span class="tabular-nums">${escapeHtml(earnings)}</span>
          </div>
        </div>
      </section>

      <section class="mb-5">
        <h3 class="section-h flex items-center justify-between">
          Price alerts
          <button id="dv-add-alert" type="button" class="text-xs px-2 py-1 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-600/30">+ New</button>
        </h3>
        <form id="dv-alert-form" class="hidden mt-2 flex flex-wrap items-center gap-2 text-sm bg-slate-900/50 border border-slate-800 rounded p-2">
          <select id="dv-alert-cond" class="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm">
            <option value="above">Notify when price ≥</option>
            <option value="below">Notify when price ≤</option>
          </select>
          <input
            id="dv-alert-price"
            type="number"
            step="0.01"
            inputmode="decimal"
            class="flex-1 min-w-[8rem] bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm placeholder:text-slate-500"
            placeholder="${typeof price === 'number' ? fmt(price, { maxFrac: 2 }) : '0.00'}"
            required
          />
          <button class="px-3 py-1 rounded bg-emerald-500 text-slate-950 text-sm font-medium hover:bg-emerald-400">Create</button>
          <button type="button" id="dv-alert-cancel" class="px-3 py-1 rounded border border-slate-700 text-slate-300 text-sm hover:bg-slate-800">Cancel</button>
        </form>
        <ul class="mt-2 space-y-1 text-sm">
          ${
            alerts.length
              ? alerts
                  .map(
                    (a) => `
              <li class="flex items-center justify-between bg-slate-900/40 border border-slate-800 rounded px-2 py-1">
                <span>
                  <span class="text-slate-400 text-xs uppercase tracking-wider mr-1">${a.condition === 'above' ? '↑' : '↓'}</span>
                  ${a.condition === 'above' ? '≥' : '≤'} ${fmt(a.price, { currency, maxFrac: 4 })}
                  ${a.lastTriggeredAt ? `<span class="text-xs text-amber-400 ml-2">triggered ${fmtDate(a.lastTriggeredAt)}</span>` : ''}
                </span>
                <button class="text-rose-400 text-xs hover:text-rose-300" data-rm-alert="${a.id}">Remove</button>
              </li>
            `
                  )
                  .join('')
              : `<li class="text-slate-500 text-xs">No alerts yet.</li>`
          }
        </ul>
      </section>

      <section class="mb-2">
        <h3 class="section-h flex items-center justify-between">
          News
          <button id="dv-portfolio" type="button" class="text-xs px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">+ Add to portfolio</button>
        </h3>
        <ul class="mt-2 space-y-2 text-sm">
          ${
            news.length
              ? news
                  .map(
                    (n) => `
              <li class="bg-slate-900/40 border border-slate-800 rounded p-2 hover:border-slate-600 transition">
                <a href="${escapeHtml(n.url)}" target="_blank" rel="noopener" class="text-slate-200 hover:text-emerald-300">
                  ${escapeHtml(n.title)}
                </a>
                <div class="text-xs text-slate-500 mt-1">
                  ${escapeHtml(n.publisher)} · ${fmtDate(n.publishedAtMs)}
                </div>
              </li>
            `
                  )
                  .join('')
              : `<li class="text-slate-500 text-xs">No news found.</li>`
          }
        </ul>
      </section>
    `;

    // Wire interactive bits.
    const addBtn = this.els.body.querySelector('#dv-add-alert');
    const form = /** @type {HTMLFormElement|null} */ (
      this.els.body.querySelector('#dv-alert-form')
    );
    const cancel = this.els.body.querySelector('#dv-alert-cancel');
    addBtn?.addEventListener('click', () => form?.classList.remove('hidden'));
    cancel?.addEventListener('click', () => form?.classList.add('hidden'));
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const cond = /** @type {HTMLSelectElement} */ (
        form.querySelector('#dv-alert-cond')
      ).value;
      const price = parseFloat(
        /** @type {HTMLInputElement} */ (form.querySelector('#dv-alert-price')).value
      );
      if (!Number.isFinite(price) || price <= 0) return;
      this.deps.addAlert({
        symbol: sym,
        condition: /** @type {'above'|'below'} */ (cond),
        price
      });
      this.refresh();
    });

    this.els.body.querySelectorAll('[data-rm-alert]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = /** @type {HTMLElement} */ (btn).dataset.rmAlert;
        if (id) {
          this.deps.removeAlert(id);
          this.refresh();
        }
      })
    );

    this.els.body
      .querySelector('#dv-portfolio')
      ?.addEventListener('click', () => this.deps.onAddToPortfolio(sym));
  }
}
