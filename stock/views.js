// Stock Ticker — the three top-level views over the active watchlist.
// Each render function takes a `ctx` with the DOM container, current state slice,
// the cached series Map, the detail-view, and a small set of mutator callbacks.

import { escapeHtml, formatPrice, colorForIndex } from './format.js';

/**
 * @typedef {Object} ViewMutators
 * @property {(symbol: string) => void} toggleVisible
 * @property {(symbol: string) => void} removeSymbol
 * @property {(symbol: string, beforeSymbol: string) => void} reorder
 * @property {() => void} saveState
 * @property {() => void} renderPortfolio
 */

/**
 * Pull the latest price + previous-close out of a cached series, falling back
 * through chart points when the meta fields aren't populated yet.
 */
function quoteFromSeries(series) {
  if (!series) return { last: null, prev: null, currency: 'USD' };
  const m = series.meta || {};
  const currency = m.currency || 'USD';
  const last =
    typeof m.regularMarketPrice === 'number'
      ? m.regularMarketPrice
      : series.points?.length
      ? series.points[series.points.length - 1].c
      : null;
  const prev =
    typeof m.chartPreviousClose === 'number'
      ? m.chartPreviousClose
      : series.points?.length
      ? series.points[0].c
      : null;
  return { last, prev, currency };
}

export function renderTiles(ctx) {
  const { container, list, seriesBySymbol, detailView, mutators } = ctx;
  container.innerHTML = '';
  if (!list) return;

  list.symbols.forEach((entry, idx) => {
    const series = seriesBySymbol.get(entry.symbol);
    const color = colorForIndex(idx);
    const tile = document.createElement('div');
    tile.className = 'quote-tile';
    tile.dataset.symbol = entry.symbol;
    tile.draggable = true;

    let priceHtml = '<span class="text-text-3 text-sm">Loading…</span>';
    let deltaHtml = '';
    let cls = 'flat';
    const { last, prev, currency } = quoteFromSeries(series);

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
        <button type="button" class="tile-btn danger js-remove" aria-label="Remove ${escapeHtml(
          entry.symbol
        )}">×</button>
      </div>
    `;

    tile.querySelector('.js-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      mutators.toggleVisible(entry.symbol);
    });
    tile.querySelector('.js-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      mutators.removeSymbol(entry.symbol);
    });
    tile.querySelector('.js-detail')?.addEventListener('click', (e) => {
      e.stopPropagation();
      detailView.open(entry.symbol, nameText);
    });

    tile.addEventListener('click', () => detailView.open(entry.symbol, nameText));

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
      if (src && src !== entry.symbol) mutators.reorder(src, entry.symbol);
    });

    container.appendChild(tile);
  });
}

export function renderHeatmap(ctx) {
  const { container, list, seriesBySymbol, detailView } = ctx;
  container.innerHTML = '';
  if (!list) return;

  list.symbols.forEach((entry) => {
    const series = seriesBySymbol.get(entry.symbol);
    const tile = document.createElement('div');
    tile.className = 'heatmap-tile';

    const { last, prev, currency } = quoteFromSeries(series);
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
    container.appendChild(tile);
  });
}

export function renderPortfolio(ctx) {
  const { tbody, summary, list, seriesBySymbol, mutators } = ctx;
  if (!list) return;
  tbody.innerHTML = '';

  let totalCost = 0;
  let totalValue = 0;
  let totalDay = 0;

  list.symbols.forEach((entry) => {
    const series = seriesBySymbol.get(entry.symbol);
    const { last, prev, currency } = quoteFromSeries(series);

    const shares = entry.shares ?? 0;
    const cost = entry.costBasis ?? 0;
    const mktVal = typeof last === 'number' ? last * shares : 0;
    const costVal = cost * shares;
    const dayDiff =
      typeof last === 'number' && typeof prev === 'number' ? (last - prev) * shares : 0;
    const totalDiff = mktVal - costVal;

    totalCost += costVal;
    totalValue += mktVal;
    totalDay += dayDiff;

    const dayCls = dayDiff > 0 ? 'text-success' : dayDiff < 0 ? 'text-danger' : 'text-text-2';
    const totalCls = totalDiff > 0 ? 'text-success' : totalDiff < 0 ? 'text-danger' : 'text-text-2';

    const totalPct = costVal !== 0 ? (totalDiff / costVal) * 100 : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-2 py-1.5 font-medium">${escapeHtml(entry.symbol)}</td>
      <td class="px-2 py-1.5 text-right">
        <input type="number" min="0" step="any" value="${
          shares || ''
        }" data-field="shares" placeholder="0" />
      </td>
      <td class="px-2 py-1.5 text-right">
        <input type="number" min="0" step="any" value="${
          cost || ''
        }" data-field="costBasis" placeholder="0.00" />
      </td>
      <td class="px-2 py-1.5 text-right tabular-nums">${
        typeof last === 'number' ? formatPrice(last, currency) : '—'
      }</td>
      <td class="px-2 py-1.5 text-right tabular-nums">${formatPrice(mktVal, currency)}</td>
      <td class="px-2 py-1.5 text-right tabular-nums ${dayCls}">${
      dayDiff >= 0 ? '+' : ''
    }${formatPrice(dayDiff, currency)}</td>
      <td class="px-2 py-1.5 text-right tabular-nums ${totalCls}">
        ${totalDiff >= 0 ? '+' : ''}${formatPrice(totalDiff, currency)}
        <span class="text-xs">(${totalDiff >= 0 ? '+' : ''}${totalPct.toFixed(2)}%)</span>
      </td>
      <td class="px-2 py-1.5 text-right">
        <button class="text-text-3 hover:text-danger text-sm" data-rm="${escapeHtml(
          entry.symbol
        )}">×</button>
      </td>
    `;
    tr.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const field = inp.getAttribute('data-field');
        const v = parseFloat(inp.value);
        if (field === 'shares') entry.shares = Number.isFinite(v) ? v : 0;
        if (field === 'costBasis') entry.costBasis = Number.isFinite(v) ? v : 0;
        mutators.saveState();
        mutators.renderPortfolio();
      });
    });
    tr.querySelector('[data-rm]')?.addEventListener('click', () =>
      mutators.removeSymbol(entry.symbol)
    );
    tbody.appendChild(tr);
  });

  const dayCls = totalDay > 0 ? 'text-success' : totalDay < 0 ? 'text-danger' : 'text-text-2';
  const totalPL = totalValue - totalCost;
  const totalCls = totalPL > 0 ? 'text-success' : totalPL < 0 ? 'text-danger' : 'text-text-2';
  const totalPct = totalCost !== 0 ? (totalPL / totalCost) * 100 : 0;

  summary.innerHTML = `
    <div class="summary-card"><div class="lbl">Total cost</div><div class="val">${formatPrice(
      totalCost
    )}</div></div>
    <div class="summary-card"><div class="lbl">Market value</div><div class="val">${formatPrice(
      totalValue
    )}</div></div>
    <div class="summary-card"><div class="lbl">Day Δ</div><div class="val ${dayCls}">${
    totalDay >= 0 ? '+' : ''
  }${formatPrice(totalDay)}</div></div>
    <div class="summary-card">
      <div class="lbl">Total P/L</div>
      <div class="val ${totalCls}">
        ${totalPL >= 0 ? '+' : ''}${formatPrice(totalPL)}
        <span class="text-sm">(${totalPL >= 0 ? '+' : ''}${totalPct.toFixed(2)}%)</span>
      </div>
    </div>
  `;
}
