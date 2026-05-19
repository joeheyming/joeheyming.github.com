// Sparkline — minimal SVG line + area renderer for the Compare view's
// per-model weather graphs. No third-party charting library: each row
// is a single `<svg>` with a fill-path, a stroke-path, an optional
// "now" marker, and (optionally) subtle alternating-day background
// bands. The SVG uses a viewBox so it scales to whatever the row's
// container is wide.
//
// We deliberately keep this tiny rather than reach for d3/chart.js —
// the data shape is fixed (timestamps + parallel value arrays), null
// gaps are common, and the visual style needs to be tuned to match the
// rest of the app's dark theme. A bespoke renderer is ~80 lines and
// gives us full control over breaks, fills, and the "now" marker.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @typedef {Object} SparklineSeries
 * @property {Array<number | null>} values
 * @property {string} color                        Stroke color (hex or rgba).
 * @property {string} [fillColor]                  Defaults to color with low alpha.
 * @property {number} [strokeWidth]                Default 1.5 in viewBox units.
 * @property {boolean} [filled]                    Default true.
 * @property {string} [strokeDasharray]            SVG dash pattern, e.g. "4,3". Default solid.
 * @property {number} [fillOpacity]                Multiplier for the fill alpha. Default 1.
 * @property {boolean} [smooth]                    Use Catmull–Rom curve. Default false (cheaper + reads cleaner for noisy precip data).
 */

/**
 * @typedef {Object} SparklineOpts
 * @property {number[]} times                      Unix ms, parallel to each series's `values`.
 * @property {SparklineSeries[]} series
 * @property {number} [width]                      ViewBox width.  Default 700.
 * @property {number} [height]                     ViewBox height. Default 80.
 * @property {number} [padTop]                     Default 6.
 * @property {number} [padBottom]                  Default 4.
 * @property {'min'|'zero'|number} [fillFrom]      Default 'min'.
 * @property {[number, number]} [yRange]           Override auto-detected.
 * @property {number} [nowMs]                      Vertical line at this time.
 * @property {string} [nowColor]                   Default 'rgba(255,255,255,0.55)'.
 * @property {boolean} [showDayBands]              Alternate day backgrounds. Default true.
 * @property {string} [dayBandColor]               Default 'rgba(148,163,184,0.07)'.
 * @property {number} [pastUntilMs]                If set, render a "past" tint from t0 up to this time.
 * @property {string} [pastTintColor]              Default 'rgba(244,114,182,0.10)'.
 */

/**
 * Render (or re-render) a sparkline into `svg`. Idempotent: existing
 * children are removed first so the same `<svg>` element can be reused
 * when the user switches variables.
 *
 * @param {SVGSVGElement} svg
 * @param {SparklineOpts} opts
 * @returns {{ yMin: number, yMax: number }}      Useful for the caller to render axis labels.
 */
export function renderSparkline(svg, opts) {
  const width = opts.width ?? 700;
  const height = opts.height ?? 80;
  const padTop = opts.padTop ?? 6;
  const padBottom = opts.padBottom ?? 4;
  const series = opts.series || [];
  const times = opts.times || [];

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  if (!times.length || !series.length) {
    return { yMin: 0, yMax: 0 };
  }

  // Auto-detect y range across every series.
  let yMin = Infinity;
  let yMax = -Infinity;
  if (opts.yRange) {
    [yMin, yMax] = opts.yRange;
  } else {
    for (const s of series) {
      for (const v of s.values) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return { yMin: 0, yMax: 0 };
  }
  if (yMin === yMax) {
    // Flat series — pad so the line sits in the middle.
    const pad = Math.max(Math.abs(yMin) * 0.05, 0.5);
    yMin -= pad;
    yMax += pad;
  }

  const innerTop = padTop;
  const innerBottom = height - padBottom;

  const t0 = times[0];
  const tN = times[times.length - 1];
  const span = Math.max(1, tN - t0);

  const xAt = (/** @type {number} */ t) => ((t - t0) / span) * width;
  const yAt = (/** @type {number} */ v) =>
    innerBottom - ((v - yMin) / (yMax - yMin)) * (innerBottom - innerTop);

  // Resolve the baseline for filled areas.
  /** @type {number} */
  let baselineY;
  if (opts.fillFrom === 'zero') {
    baselineY = yAt(Math.max(yMin, Math.min(yMax, 0)));
  } else if (typeof opts.fillFrom === 'number') {
    baselineY = yAt(Math.max(yMin, Math.min(yMax, opts.fillFrom)));
  } else {
    baselineY = innerBottom;
  }

  // ── Past tint ──────────────────────────────────────────────────────
  // Drawn first so day-bands and the chart line both sit on top of it.
  if (typeof opts.pastUntilMs === 'number' && opts.pastUntilMs > t0) {
    const x = Math.min(width, xAt(opts.pastUntilMs));
    svg.appendChild(
      el('rect', {
        x: 0,
        y: 0,
        width: Math.max(0, x),
        height,
        fill: opts.pastTintColor || 'rgba(244,114,182,0.10)'
      })
    );
  }

  // ── Day bands ──────────────────────────────────────────────────────
  if (opts.showDayBands !== false) {
    const bandColor = opts.dayBandColor || 'rgba(148,163,184,0.07)';
    const bandsGroup = el('g', { class: 'sparkline-day-bands' });
    const dayStarts = collectDayStarts(times);
    for (let i = 0; i < dayStarts.length; i += 2) {
      const x1 = xAt(dayStarts[i]);
      const next = dayStarts[i + 1];
      const x2 = next != null ? xAt(next) : width;
      bandsGroup.appendChild(
        el('rect', {
          x: x1,
          y: 0,
          width: Math.max(0, x2 - x1),
          height,
          fill: bandColor
        })
      );
    }
    svg.appendChild(bandsGroup);
  }

  // ── Each series: filled area + stroke ──────────────────────────────
  for (const s of series) {
    const filled = s.filled !== false;
    const stroke = s.color;
    const fill = s.fillColor || withAlpha(s.color, 0.28);
    const strokeWidth = s.strokeWidth ?? 1.5;
    const segments = splitSegments(times, s.values, xAt, yAt);

    if (filled) {
      const fillOpacity = s.fillOpacity != null ? s.fillOpacity : 1;
      for (const seg of segments) {
        if (seg.length < 2) continue;
        const d = areaPath(seg, baselineY);
        svg.appendChild(
          el('path', {
            d,
            fill,
            'fill-opacity': fillOpacity,
            stroke: 'none'
          })
        );
      }
    }
    for (const seg of segments) {
      if (seg.length < 2) continue;
      const d = linePath(seg);
      svg.appendChild(
        el('path', {
          d,
          fill: 'none',
          stroke,
          'stroke-width': strokeWidth,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'stroke-dasharray': s.strokeDasharray || null
        })
      );
    }
  }

  // ── "Now" marker ───────────────────────────────────────────────────
  if (typeof opts.nowMs === 'number' && opts.nowMs >= t0 && opts.nowMs <= tN) {
    const x = xAt(opts.nowMs);
    svg.appendChild(
      el('line', {
        x1: x,
        y1: 0,
        x2: x,
        y2: height,
        stroke: opts.nowColor || 'rgba(255,255,255,0.55)',
        'stroke-width': 1,
        'stroke-dasharray': '2,3'
      })
    );
  }

  return { yMin, yMax };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Walk the values array, breaking the polyline at null/NaN gaps so the
 * fill+stroke don't connect across missing data.
 *
 * @param {number[]} times
 * @param {Array<number | null>} values
 * @param {(t: number) => number} xAt
 * @param {(v: number) => number} yAt
 * @returns {Array<Array<[number, number]>>}
 */
function splitSegments(times, values, xAt, yAt) {
  /** @type {Array<Array<[number, number]>>} */
  const out = [];
  /** @type {Array<[number, number]>} */
  let cur = [];
  const n = Math.min(times.length, values.length);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    cur.push([xAt(times[i]), yAt(v)]);
  }
  if (cur.length) out.push(cur);
  return out;
}

function linePath(/** @type {Array<[number, number]>} */ pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L${pts[i][0].toFixed(2)},${pts[i][1].toFixed(2)}`;
  }
  return d;
}

function areaPath(/** @type {Array<[number, number]>} */ pts, /** @type {number} */ baselineY) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(2)},${baselineY.toFixed(2)}`;
  for (const [x, y] of pts) {
    d += ` L${x.toFixed(2)},${y.toFixed(2)}`;
  }
  d += ` L${pts[pts.length - 1][0].toFixed(2)},${baselineY.toFixed(2)} Z`;
  return d;
}

/**
 * Return the unix-ms timestamp of each local-midnight that falls within
 * the timeline. We use the original timestamp where a day starts, so
 * the bands always line up with hour 0 of each calendar day.
 *
 * @param {number[]} times
 * @returns {number[]}
 */
function collectDayStarts(times) {
  /** @type {number[]} */
  const out = [];
  let lastDay = -1;
  for (const t of times) {
    const d = new Date(t).getDay();
    if (d !== lastDay) {
      out.push(t);
      lastDay = d;
    }
  }
  return out;
}

function el(/** @type {string} */ tag, /** @type {Record<string, any>} */ attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    e.setAttribute(k, String(v));
  }
  return e;
}

/**
 * Convert a hex / rgb / rgba color to rgba with the given alpha.
 * Accepts inputs like `#38bdf8`, `rgb(56,189,248)`, or `rgba(56,189,248,0.5)`.
 *
 * @param {string} color
 * @param {number} alpha
 * @returns {string}
 */
function withAlpha(color, alpha) {
  const s = String(color).trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    const full = hex.length === 3
      ? hex.split('').map((c) => c + c).join('')
      : hex;
    if (full.length !== 6) return `rgba(56,189,248,${alpha})`;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim());
    const [r, g, b] = parts;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(56,189,248,${alpha})`;
}
