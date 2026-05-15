// Chart rendering: line / area / candlestick on the main pane, optional volume
// secondary axis, plus separate RSI and MACD subpanes. Indicators (SMA/EMA/BB)
// overlay the price series for the *first* visible symbol (the "focused" one).
//
// Candlesticks are drawn by a custom Chart.js plugin that reads OHLC off
// `dataset._ohlc` and renders manually in `afterDatasetsDraw`. This keeps us
// off finicky external candlestick plugins.

import Chart from 'chart.js/auto';
import 'chartjs-adapter-luxon';

import { sma, ema, bollinger, rsi, macd } from './indicators.js';

// --- Custom candlestick plugin ---
const candlestickPlugin = {
  id: 'candlestickPlugin',
  afterDatasetsDraw(chart) {
    const ds = chart.data.datasets;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if (!xScale || !yScale) return;
    const ctx = chart.ctx;
    for (let di = 0; di < ds.length; di++) {
      const d = /** @type {any} */ (ds[di]);
      if (!d._candles || !Array.isArray(d._candles) || !d._candles.length) continue;
      if (chart.getDatasetMeta(di).hidden) continue;

      const candles = d._candles;
      // Pick a body width that scales with available pixels.
      const xRange = Math.abs(
        xScale.getPixelForValue(candles[candles.length - 1].t) -
          xScale.getPixelForValue(candles[0].t)
      );
      const bodyW = Math.max(
        2,
        Math.min(14, Math.floor((xRange / Math.max(1, candles.length - 1)) * 0.65))
      );

      ctx.save();
      ctx.lineWidth = 1;
      for (const c of candles) {
        if (c.o == null || c.h == null || c.l == null || c.c == null) continue;
        const px = xScale.getPixelForValue(c.t);
        const py_h = yScale.getPixelForValue(c.h);
        const py_l = yScale.getPixelForValue(c.l);
        const py_o = yScale.getPixelForValue(c.o);
        const py_c = yScale.getPixelForValue(c.c);
        const up = c.c >= c.o;
        const stroke = up ? '#34d399' : '#f87171';
        const fill = up ? 'rgba(52, 211, 153, 0.55)' : 'rgba(248, 113, 113, 0.55)';
        ctx.strokeStyle = stroke;
        ctx.fillStyle = fill;
        // wick
        ctx.beginPath();
        ctx.moveTo(px, py_h);
        ctx.lineTo(px, py_l);
        ctx.stroke();
        // body
        const top = Math.min(py_o, py_c);
        const h = Math.max(1, Math.abs(py_o - py_c));
        ctx.fillRect(px - bodyW / 2, top, bodyW, h);
        ctx.strokeRect(px - bodyW / 2, top, bodyW, h);
      }
      ctx.restore();
    }
  }
};

let candleRegistered = false;
function ensureCandleRegistered() {
  if (candleRegistered) return;
  Chart.register(candlestickPlugin);
  candleRegistered = true;
}

// --- Crosshair plugin ---
// Draws a thin vertical line at the hovered x position across the chart.
const crosshairPlugin = {
  id: 'crosshair',
  afterDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.();
    if (!active || !active.length) return;
    const x = active[0].element.x;
    const top = chart.chartArea.top;
    const bottom = chart.chartArea.bottom;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  }
};
let crossRegistered = false;
function ensureCrosshairRegistered() {
  if (crossRegistered) return;
  Chart.register(crosshairPlugin);
  crossRegistered = true;
}

// --- Helpers ---

function axisHintsFor(rangeId) {
  switch (rangeId) {
    case '1d':
      return { unit: 'hour', tooltipFmt: 'LLL d, h:mm a' };
    case '5d':
      return { unit: 'day', tooltipFmt: 'LLL d, h:mm a' };
    case '1mo':
      return { unit: 'day', tooltipFmt: 'LLL d, yyyy' };
    case '3mo':
    case '6mo':
      return { unit: 'week', tooltipFmt: 'LLL d, yyyy' };
    case '1y':
      return { unit: 'month', tooltipFmt: 'LLL d, yyyy' };
    case '5y':
      return { unit: 'month', tooltipFmt: 'LLL yyyy' };
    case 'max':
      return { unit: 'year', tooltipFmt: 'LLL yyyy' };
    default:
      return { unit: 'day', tooltipFmt: 'LLL d, yyyy' };
  }
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

function formatCompact(n) {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

/**
 * @typedef {Object} ChartViewOptions
 * @property {string} range
 * @property {boolean} normalize       Compare % change from start.
 * @property {boolean} logScale        Log Y axis on price pane.
 * @property {'line'|'area'|'candle'} chartType
 * @property {boolean} showVolume
 * @property {boolean} showRsi
 * @property {boolean} showMacd
 * @property {{sma20:boolean,sma50:boolean,sma200:boolean,ema12:boolean,ema26:boolean,bb:boolean}} indicators
 */

/**
 * @typedef {Object} ChartViewInputEntry
 * @property {string} symbol
 * @property {string} [name]
 * @property {string} color
 * @property {boolean} visible
 * @property {import('./api.js').ChartSeries} [series]
 */

/**
 * Owns three Chart instances (main / rsi / macd), all sharing the same time axis range.
 */
export class ChartView {
  /**
   * @param {{
   *   priceCanvas: HTMLCanvasElement,
   *   rsiCanvas: HTMLCanvasElement,
   *   macdCanvas: HTMLCanvasElement,
   *   rsiPane: HTMLElement,
   *   macdPane: HTMLElement
   * }} els
   */
  constructor(els) {
    this.els = els;
    /** @type {Chart|null} */
    this.priceChart = null;
    /** @type {Chart|null} */
    this.rsiChart = null;
    /** @type {Chart|null} */
    this.macdChart = null;
    ensureCandleRegistered();
    ensureCrosshairRegistered();
  }

  /**
   * @param {ChartViewInputEntry[]} entries
   * @param {ChartViewOptions} opts
   */
  render(entries, opts) {
    const visibleEntries = entries.filter((e) => e.visible && e.series && e.series.points.length);

    // The "focused" symbol for indicators is the first visible series.
    const focused = visibleEntries[0] || null;

    this._renderMain(visibleEntries, focused, opts);
    this._renderRsi(focused, opts);
    this._renderMacd(focused, opts);

    this.els.rsiPane.classList.toggle('hidden', !opts.showRsi || !focused);
    this.els.macdPane.classList.toggle('hidden', !opts.showMacd || !focused);
  }

  /** Export the main price chart as a PNG data URL. */
  toPNG() {
    if (!this.priceChart) return null;
    return this.priceChart.toBase64Image('image/png', 1);
  }

  destroy() {
    this.priceChart?.destroy();
    this.rsiChart?.destroy();
    this.macdChart?.destroy();
    this.priceChart = this.rsiChart = this.macdChart = null;
  }

  // --- internals ---

  /**
   * @param {ChartViewInputEntry[]} visibleEntries
   * @param {ChartViewInputEntry|null} focused
   * @param {ChartViewOptions} opts
   */
  _renderMain(visibleEntries, focused, opts) {
    const hints = axisHintsFor(opts.range);
    /** @type {any[]} */
    const datasets = [];

    // Price datasets per visible symbol.
    visibleEntries.forEach((entry) => {
      if (!entry.series) return;
      const pts = entry.series.points;
      let data;
      if (opts.normalize) {
        const first = pts[0]?.c ?? 0;
        data = pts.map((p) => ({
          x: p.t,
          y: first === 0 ? 0 : ((p.c - first) / first) * 100
        }));
      } else {
        data = pts.map((p) => ({ x: p.t, y: p.c }));
      }

      // For the focused symbol with candle mode, hide the line and let the candle
      // plugin draw — but we still need the dataset present so the scales pick
      // up the y range.
      const isCandle = opts.chartType === 'candle' && entry === focused && !opts.normalize;

      datasets.push({
        label: entry.symbol,
        data,
        borderColor: isCandle ? 'transparent' : entry.color,
        backgroundColor:
          opts.chartType === 'area' && !isCandle ? entry.color + '33' : entry.color + '22',
        fill: opts.chartType === 'area' && !isCandle ? 'origin' : false,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.15,
        spanGaps: true,
        yAxisID: 'y',
        order: 1,
        _candles: isCandle ? pts : null,
        _meta: entry.series.meta,
        _currency: entry.series.meta?.currency
      });
    });

    // Indicator overlays (only for the focused symbol, only in absolute mode).
    if (focused && focused.series && !opts.normalize) {
      const closes = focused.series.points.map((p) => p.c);
      const ts = focused.series.points.map((p) => p.t);

      /**
       * @param {Array<number|null>} arr
       * @param {string} label
       * @param {string} color
       * @param {number[]} [dash]
       */
      const pushOverlay = (arr, label, color, dash) => {
        datasets.push({
          label,
          data: ts.map((t, i) => ({ x: t, y: arr[i] == null ? null : arr[i] })),
          borderColor: color,
          backgroundColor: 'transparent',
          borderWidth: 1.2,
          borderDash: dash || [],
          pointRadius: 0,
          pointHoverRadius: 0,
          spanGaps: true,
          tension: 0,
          yAxisID: 'y',
          order: 0,
          _indicator: true
        });
      };

      if (opts.indicators.sma20) pushOverlay(sma(closes, 20), 'SMA 20', '#fde68a');
      if (opts.indicators.sma50) pushOverlay(sma(closes, 50), 'SMA 50', '#a78bfa');
      if (opts.indicators.sma200) pushOverlay(sma(closes, 200), 'SMA 200', '#f472b6');
      if (opts.indicators.ema12) pushOverlay(ema(closes, 12), 'EMA 12', '#22d3ee', [4, 3]);
      if (opts.indicators.ema26) pushOverlay(ema(closes, 26), 'EMA 26', '#fb923c', [4, 3]);
      if (opts.indicators.bb) {
        const bb = bollinger(closes, 20, 2);
        pushOverlay(bb.upper, 'BB Upper', 'rgba(148,163,184,0.7)', [2, 2]);
        pushOverlay(bb.mid, 'BB Mid', 'rgba(148,163,184,0.7)');
        pushOverlay(bb.lower, 'BB Lower', 'rgba(148,163,184,0.7)', [2, 2]);
      }
    }

    // Volume bars for the focused symbol on a secondary axis.
    if (opts.showVolume && focused && focused.series && !opts.normalize) {
      const pts = focused.series.points;
      const volData = pts.map((p) => ({
        x: p.t,
        y: typeof p.v === 'number' ? p.v : 0
      }));
      // Color volumes green if up day, red if down day.
      const colors = pts.map((p, i) => {
        const prev = i > 0 ? pts[i - 1].c : p.o ?? p.c;
        return p.c >= (prev ?? p.c) ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.45)';
      });
      datasets.push({
        type: 'bar',
        label: 'Volume',
        data: volData,
        backgroundColor: colors,
        borderColor: 'transparent',
        yAxisID: 'yVolume',
        order: 99,
        _indicator: true
      });
    }

    const cfg = {
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', axis: 'x', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#cbd5e1',
              boxWidth: 14,
              usePointStyle: true,
              filter: (item) => !/^BB (Upper|Lower)$/.test(item.text)
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#f1f5f9',
            bodyColor: '#e2e8f0',
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                const t = /** @type {any} */ (items[0].parsed).x;
                try {
                  return new Date(t).toLocaleString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: opts.range === '1d' || opts.range === '5d' ? 'numeric' : undefined,
                    minute: opts.range === '1d' || opts.range === '5d' ? '2-digit' : undefined
                  });
                } catch {
                  return String(t);
                }
              },
              label: (ctx) => {
                const ds = /** @type {any} */ (ctx.dataset);
                const v = /** @type {number} */ (ctx.parsed.y);
                if (ds.label === 'Volume') {
                  return ` Volume: ${formatCompact(v)}`;
                }
                if (ds._indicator) {
                  return ` ${ctx.dataset.label}: ${formatPrice(v, ds._currency)}`;
                }
                // OHLC tooltip if we have candles.
                if (ds._candles) {
                  const pt = ds._candles.find(
                    (p) => Math.abs(p.t - /** @type {any} */ (ctx.parsed.x)) < 1
                  );
                  if (pt) {
                    return [
                      ` ${ctx.dataset.label}`,
                      `   O ${formatPrice(pt.o, ds._currency)}`,
                      `   H ${formatPrice(pt.h, ds._currency)}`,
                      `   L ${formatPrice(pt.l, ds._currency)}`,
                      `   C ${formatPrice(pt.c, ds._currency)}`
                    ];
                  }
                }
                if (opts.normalize) {
                  const sign = v >= 0 ? '+' : '';
                  return ` ${ctx.dataset.label}: ${sign}${v.toFixed(2)}%`;
                }
                return ` ${ctx.dataset.label}: ${formatPrice(v, ds._currency)}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: hints.unit, tooltipFormat: hints.tooltipFmt },
            grid: { color: 'rgba(148, 163, 184, 0.08)' },
            ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }
          },
          y: {
            type: opts.logScale && !opts.normalize ? 'logarithmic' : 'linear',
            position: 'left',
            weight: 3,
            grid: { color: 'rgba(148, 163, 184, 0.08)' },
            ticks: {
              color: '#94a3b8',
              callback: (v) =>
                opts.normalize ? `${Number(v).toFixed(0)}%` : formatPrice(Number(v))
            }
          },
          yVolume: {
            display: opts.showVolume && !!focused && !opts.normalize,
            type: 'linear',
            position: 'right',
            weight: 1,
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#64748b',
              callback: (v) => formatCompact(Number(v))
            }
          }
        }
      }
    };

    if (this.priceChart) {
      this.priceChart.data = cfg.data;
      this.priceChart.options = cfg.options;
      this.priceChart.update('none');
    } else {
      this.priceChart = new Chart(this.els.priceCanvas, {
        type: 'line',
        ...cfg
      });
    }
  }

  /**
   * @param {ChartViewInputEntry|null} focused
   * @param {ChartViewOptions} opts
   */
  _renderRsi(focused, opts) {
    if (!opts.showRsi || !focused || !focused.series) {
      if (this.rsiChart) {
        this.rsiChart.destroy();
        this.rsiChart = null;
      }
      return;
    }
    const closes = focused.series.points.map((p) => p.c);
    const ts = focused.series.points.map((p) => p.t);
    const rsiArr = rsi(closes, 14);
    const data = ts.map((t, i) => ({ x: t, y: rsiArr[i] }));
    const hints = axisHintsFor(opts.range);

    const cfg = {
      type: 'line',
      data: {
        datasets: [
          {
            label: `RSI 14 (${focused.symbol})`,
            data,
            borderColor: '#a78bfa',
            backgroundColor: 'rgba(167,139,250,0.1)',
            borderWidth: 1.4,
            pointRadius: 0,
            spanGaps: true,
            tension: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', axis: 'x', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { color: '#cbd5e1', boxWidth: 14 } },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#f1f5f9',
            bodyColor: '#e2e8f0',
            callbacks: {
              label: (ctx) => ` RSI: ${Number(ctx.parsed.y).toFixed(1)}`
            }
          },
          // Draw overbought/oversold guide lines.
          annotationsLite: {}
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: hints.unit, tooltipFormat: hints.tooltipFmt },
            grid: { color: 'rgba(148, 163, 184, 0.06)' },
            ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(148, 163, 184, 0.08)' },
            ticks: {
              color: '#94a3b8',
              stepSize: 25,
              callback: (v) => Number(v).toFixed(0)
            }
          }
        }
      },
      plugins: [overboughtOversoldPlugin]
    };

    if (this.rsiChart) {
      this.rsiChart.data = cfg.data;
      this.rsiChart.options = cfg.options;
      this.rsiChart.update('none');
    } else {
      this.rsiChart = new Chart(this.els.rsiCanvas, cfg);
    }
  }

  /**
   * @param {ChartViewInputEntry|null} focused
   * @param {ChartViewOptions} opts
   */
  _renderMacd(focused, opts) {
    if (!opts.showMacd || !focused || !focused.series) {
      if (this.macdChart) {
        this.macdChart.destroy();
        this.macdChart = null;
      }
      return;
    }
    const closes = focused.series.points.map((p) => p.c);
    const ts = focused.series.points.map((p) => p.t);
    const m = macd(closes, 12, 26, 9);
    const hints = axisHintsFor(opts.range);

    const cfg = {
      data: {
        datasets: [
          {
            type: 'bar',
            label: 'Histogram',
            data: ts.map((t, i) => ({ x: t, y: m.histogram[i] })),
            backgroundColor: ts.map((_, i) =>
              (m.histogram[i] ?? 0) >= 0 ? 'rgba(52,211,153,0.55)' : 'rgba(248,113,113,0.55)'
            ),
            borderColor: 'transparent',
            order: 10
          },
          {
            type: 'line',
            label: `MACD (${focused.symbol})`,
            data: ts.map((t, i) => ({ x: t, y: m.macd[i] })),
            borderColor: '#22d3ee',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            spanGaps: true,
            tension: 0,
            order: 0
          },
          {
            type: 'line',
            label: 'Signal',
            data: ts.map((t, i) => ({ x: t, y: m.signal[i] })),
            borderColor: '#fbbf24',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            spanGaps: true,
            tension: 0,
            order: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', axis: 'x', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { color: '#cbd5e1', boxWidth: 14 } },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#f1f5f9',
            bodyColor: '#e2e8f0'
          }
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: hints.unit, tooltipFormat: hints.tooltipFmt },
            grid: { color: 'rgba(148, 163, 184, 0.06)' },
            ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }
          },
          y: {
            grid: { color: 'rgba(148, 163, 184, 0.08)' },
            ticks: { color: '#94a3b8' }
          }
        }
      }
    };

    if (this.macdChart) {
      this.macdChart.data = cfg.data;
      this.macdChart.options = cfg.options;
      this.macdChart.update('none');
    } else {
      this.macdChart = new Chart(this.els.macdCanvas, { type: 'line', ...cfg });
    }
  }
}

// Plugin that draws horizontal 30/70 RSI bands.
const overboughtOversoldPlugin = {
  id: 'rsiGuides',
  afterDatasetsDraw(chart) {
    const y = chart.scales.y;
    if (!y) return;
    const ctx = chart.ctx;
    const { left, right } = chart.chartArea;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.45)';
    let py = y.getPixelForValue(70);
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
    py = y.getPixelForValue(30);
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
    ctx.stroke();
    ctx.restore();
  }
};
