// Compare view — Flowx-style stacked multi-model forecast graphs for
// the currently-active location.
//
// One row per forecast model (DWD ICON, NCEP GFS, ECMWF IFS); each row
// is an SVG sparkline of one variable's hourly trace across an 8-day
// window that runs from *yesterday's* model reanalysis through today
// and the next 6 forecast days. The past portion gets a subtle tint
// and the day-axis labels the first day as "Yesterday" — so you can
// glance at any chart and answer "is tomorrow going to be warmer or
// cooler than yesterday was?" without leaving this view.
//
// Public API:
//   const view = createCompareView({ container, getUnits });
//   view.setLocations(savedLocations, activeId);
//   view.refresh();   // re-render with same data (e.g. after a units toggle)
//   view.destroy();

import {
  fetchModelComparison,
  COMPARE_MODELS,
  COMPARE_VARIABLES
} from './api.js';
import { renderSparkline } from './sparkline.js';

/** @typedef {import('./state.js').SavedLocation} SavedLocation */
/** @typedef {import('./api.js').ModelComparison} ModelComparison */
/** @typedef {'c' | 'f'} Units */

/**
 * Per-variable rendering config. Open-Meteo always returns temperature
 * in °C and wind in km/h; we convert at display time so the chart and
 * the labels both live in user-facing units.
 *
 * @typedef {Object} VarStyle
 * @property {string} color
 * @property {'min'|'zero'|number} fillFrom
 * @property {(v: number, units: Units) => number} [transform]
 * @property {(units: Units) => string} unit
 * @property {(v: number, units: Units) => string} format
 * @property {(units: Units) => { min?: number, max?: number } | undefined} [yRange]
 */

/** @type {Record<string, VarStyle>} */
const VAR_STYLES = {
  temperature_2m: {
    color: '#fb923c',
    fillFrom: 'min',
    transform: (v, units) => (units === 'f' ? v * 9 / 5 + 32 : v),
    unit: (units) => (units === 'f' ? '°F' : '°C'),
    format: (v) => `${Math.round(v)}°`
  },
  precipitation: {
    color: '#38bdf8',
    fillFrom: 0,
    unit: () => 'mm/h',
    format: (v) => (v < 0.05 ? '0' : v < 1 ? v.toFixed(2) : v.toFixed(1)),
    yRange: () => ({ min: 0 })
  },
  wind_speed_10m: {
    color: '#cbd5e1',
    fillFrom: 0,
    transform: (v, units) => (units === 'f' ? v * 0.621371 : v),
    unit: (units) => (units === 'f' ? 'mph' : 'km/h'),
    format: (v) => `${Math.round(v)}`,
    yRange: () => ({ min: 0 })
  },
  cloud_cover: {
    color: '#94a3b8',
    fillFrom: 0,
    unit: () => '%',
    format: (v) => `${Math.round(v)}`,
    yRange: () => ({ min: 0, max: 100 })
  },
  relative_humidity_2m: {
    color: '#22d3ee',
    fillFrom: 0,
    unit: () => '%',
    format: (v) => `${Math.round(v)}`,
    yRange: () => ({ min: 0, max: 100 })
  },
  pressure_msl: {
    color: '#c084fc',
    fillFrom: 'min',
    unit: () => 'hPa',
    format: (v) => `${Math.round(v)}`
  }
};

/**
 * @param {{
 *   container: HTMLElement,
 *   getUnits: () => Units,
 *   onSelectLocation?: (id: string) => void
 * }} cfg
 */
export function createCompareView(cfg) {
  /** @type {string} */
  let activeVariable = 'precipitation';
  /** @type {ModelComparison | null} */
  let comparison = null;
  /** @type {SavedLocation | null} */
  let activeLocation = null;
  /** @type {SavedLocation[]} */
  let allLocations = [];
  /** @type {string} */
  let error = '';
  let loading = false;
  /** @type {AbortController | null} */
  let inflight = null;
  /** @type {Map<string, ModelComparison>} */
  const cache = new Map();

  cfg.container.innerHTML = `
    <div class="compare-head">
      <select class="compare-place-select" aria-label="Active location" hidden></select>
      <div class="compare-place" aria-live="polite">—</div>
      <div class="compare-meta">Yesterday + 7-day forecast · ${COMPARE_MODELS.length} models</div>
    </div>
    <div class="compare-vars" role="group" aria-label="Variable">
      ${COMPARE_VARIABLES.map(
        (v) => `
          <button
            type="button"
            class="compare-var"
            data-var="${v.id}"
            title="${escapeHtml(v.label)} (${escapeHtml(v.unit)})"
          ><span class="compare-var-emoji">${v.emoji}</span><span class="compare-var-label">${escapeHtml(v.label)}</span></button>
        `
      ).join('')}
    </div>
    <div class="compare-rows" aria-live="polite"></div>
  `;

  const placeEl = /** @type {HTMLDivElement} */ (cfg.container.querySelector('.compare-place'));
  const placeSelect = /** @type {HTMLSelectElement} */ (
    cfg.container.querySelector('.compare-place-select')
  );
  const varBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    cfg.container.querySelectorAll('.compare-var')
  );
  const rowsEl = /** @type {HTMLDivElement} */ (cfg.container.querySelector('.compare-rows'));

  for (const btn of varBtns) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.var || activeVariable;
      if (next === activeVariable) return;
      activeVariable = next;
      setActiveVariableButton();
      renderRows();
    });
  }
  setActiveVariableButton();

  placeSelect.addEventListener('change', () => {
    const id = placeSelect.value;
    if (id && cfg.onSelectLocation) cfg.onSelectLocation(id);
  });

  /**
   * @param {SavedLocation[]} locs
   * @param {string} activeId
   */
  function setLocations(locs, activeId) {
    allLocations = locs.slice();
    const next = locs.find((l) => l.id === activeId) || null;
    renderLocationPicker();
    void selectLocation(next);
  }

  /**
   * @param {SavedLocation | null} loc
   */
  async function selectLocation(loc) {
    activeLocation = loc;
    placeEl.textContent = loc ? formatLocationLabel(loc) : '—';
    if (placeSelect && loc) placeSelect.value = loc.id;
    if (!loc) {
      comparison = null;
      renderRows();
      return;
    }
    const cached = cache.get(loc.id);
    if (cached) {
      comparison = cached;
      error = '';
      renderRows();
      return;
    }
    if (inflight) inflight.abort();
    inflight = new AbortController();
    const myCtrl = inflight;
    loading = true;
    error = '';
    renderRows();
    try {
      // `past_days=1` extends the timeline backwards so the chart shows
      // "yesterday" (the model's reanalysis) right next to the 7-day
      // forecast. Total: 8 days × 24h = 192 entries.
      const data = await fetchModelComparison(loc, {
        pastDays: 1,
        forecastDays: 7,
        signal: myCtrl.signal
      });
      if (myCtrl.signal.aborted) return;
      cache.set(loc.id, data);
      comparison = data;
      error = '';
    } catch (err) {
      if (myCtrl.signal.aborted) return;
      comparison = null;
      error = err?.message || String(err);
    } finally {
      if (inflight === myCtrl) inflight = null;
      loading = false;
      renderRows();
    }
  }

  function renderLocationPicker() {
    const showSelect = allLocations.length > 1;
    placeSelect.hidden = !showSelect;
    placeEl.hidden = showSelect;
    if (showSelect) {
      placeSelect.innerHTML = '';
      for (const loc of allLocations) {
        const opt = document.createElement('option');
        opt.value = loc.id;
        opt.textContent = formatLocationLabel(loc);
        placeSelect.appendChild(opt);
      }
      if (activeLocation) placeSelect.value = activeLocation.id;
    }
  }

  function refresh() {
    renderRows();
  }

  function destroy() {
    if (inflight) inflight.abort();
    inflight = null;
    cache.clear();
    cfg.container.innerHTML = '';
  }

  function setActiveVariableButton() {
    for (const btn of varBtns) {
      btn.classList.toggle('active', btn.dataset.var === activeVariable);
    }
  }

  function renderRows() {
    rowsEl.innerHTML = '';
    if (!activeLocation) {
      rowsEl.innerHTML = `
        <div class="compare-empty">
          Pick a location from the Cards view to see model forecasts here.
        </div>
      `;
      return;
    }
    if (loading) {
      rowsEl.innerHTML = `<div class="compare-empty">Loading multi-model forecast…</div>`;
      return;
    }
    if (error) {
      rowsEl.innerHTML = `<div class="compare-empty compare-empty-error">${escapeHtml(error)}</div>`;
      return;
    }
    if (!comparison || !comparison.times.length) {
      rowsEl.innerHTML = `<div class="compare-empty">No data available.</div>`;
      return;
    }

    const units = cfg.getUnits();
    const style = VAR_STYLES[activeVariable] || VAR_STYLES.precipitation;
    const variable = COMPARE_VARIABLES.find((v) => v.id === activeVariable);
    const nowMs = Date.now();
    // First 24 hours of the window are "yesterday" (past_days=1 in the
    // API call). Track the boundary so the sparkline can tint that
    // region and the axis can label the first day "Yesterday."
    const pastUntilMs = comparison.times.length > 24 ? comparison.times[24] : 0;

    const commonRange = computeCommonRange(comparison, activeVariable, style, units);

    for (const model of COMPARE_MODELS) {
      const series = comparison.byModel.get(model.id);
      const rawValues = series?.[activeVariable] || [];
      const values = style.transform
        ? rawValues.map((v) => (typeof v === 'number' ? style.transform(v, units) : v))
        : rawValues;

      const row = document.createElement('div');
      row.className = 'compare-row';
      row.dataset.model = model.id;

      const stats = summarizeSeries(values);
      const statsLabel = stats
        ? `${style.format(stats.min, units)} – ${style.format(stats.max, units)} ${style.unit(units)}`
        : 'no data';

      row.innerHTML = `
        <div class="compare-row-head">
          <span class="compare-row-model">${escapeHtml(model.label)}</span>
          <span class="compare-row-stats">${escapeHtml(statsLabel)}</span>
        </div>
        <div class="compare-row-chart">
          <svg class="compare-row-svg" preserveAspectRatio="none"></svg>
        </div>
        <div class="compare-row-axis" aria-hidden="true"></div>
      `;
      rowsEl.appendChild(row);

      const svg = /** @type {SVGSVGElement} */ (row.querySelector('.compare-row-svg'));
      renderSparkline(svg, {
        times: comparison.times,
        series: [{ values, color: style.color, filled: true }],
        width: 700,
        height: 90,
        padTop: 8,
        padBottom: 6,
        fillFrom: style.fillFrom,
        yRange: commonRange,
        nowMs,
        showDayBands: true,
        pastUntilMs
      });

      renderWeekAxis(
        /** @type {HTMLElement} */ (row.querySelector('.compare-row-axis')),
        comparison.times,
        nowMs,
        pastUntilMs
      );

      if (commonRange) {
        appendYAxisLabels(row, style, units, commonRange);
      }
    }

    const foot = document.createElement('div');
    foot.className = 'compare-footnote';
    foot.textContent = `${variable?.emoji || ''} ${variable?.label || activeVariable} · ${style.unit(units)} · times shown in viewer-local time · yesterday is the model's reanalysis`;
    rowsEl.appendChild(foot);
  }

  function appendYAxisLabels(/** @type {HTMLElement} */ row, /** @type {VarStyle} */ style, /** @type {Units} */ units, /** @type {[number, number]} */ yRange) {
    const labels = document.createElement('div');
    labels.className = 'compare-row-yaxis';
    labels.innerHTML = `
      <span class="compare-y-hi">${escapeHtml(style.format(yRange[1], units))}</span>
      <span class="compare-y-lo">${escapeHtml(style.format(yRange[0], units))}</span>
    `;
    /** @type {HTMLElement} */ (row.querySelector('.compare-row-chart')).appendChild(labels);
  }

  return {
    setLocations,
    refresh,
    destroy
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Auto-fit y-range across every model so we can visually compare
 * amplitudes. Respects each variable's `yRange` hint (cloud_cover and
 * humidity are always 0–100; precipitation/wind floor at zero).
 *
 * @param {ModelComparison} comparison
 * @param {string} variable
 * @param {VarStyle} style
 * @param {Units} units
 * @returns {[number, number] | undefined}
 */
function computeCommonRange(comparison, variable, style, units) {
  const hint = style.yRange ? style.yRange(units) : undefined;
  if (hint && typeof hint.min === 'number' && typeof hint.max === 'number') {
    return [hint.min, hint.max];
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const series of comparison.byModel.values()) {
    const arr = series[variable] || [];
    for (const raw of arr) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const v = style.transform ? style.transform(raw, units) : raw;
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return undefined;
  if (hint) {
    if (typeof hint.min === 'number') yMin = hint.min;
    if (typeof hint.max === 'number') yMax = hint.max;
  }
  if (yMin === yMax) {
    const hasFloor = !!hint && typeof hint.min === 'number';
    if (hasFloor && yMin === hint.min) {
      yMax = Math.max(yMin + 1, Math.abs(yMin) * 0.1 + 1);
    } else {
      yMin -= 0.5;
      yMax += 0.5;
    }
  } else if (style.fillFrom === 'min') {
    yMin -= (yMax - yMin) * 0.05;
  }
  return [yMin, yMax];
}

/**
 * @param {Array<number | null>} values
 * @returns {{ min: number, max: number, avg: number } | null}
 */
function summarizeSeries(values) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n += 1;
  }
  if (!n) return null;
  return { min, max, avg: sum / n };
}

/**
 * Day labels along the bottom of each chart. The first calendar day
 * gets labeled "Yesterday" so the visual past/future split is obvious.
 *
 * @param {HTMLElement} el
 * @param {number[]} times
 * @param {number} nowMs
 * @param {number} pastUntilMs       Boundary between past reanalysis and forecast.
 */
function renderWeekAxis(el, times, nowMs, pastUntilMs) {
  el.innerHTML = '';
  if (!times.length) return;
  const t0 = times[0];
  const tN = times[times.length - 1];
  const span = Math.max(1, tN - t0);

  /** @type {Map<string, { start: number, end: number, t: number }>} */
  const days = new Map();
  for (const t of times) {
    const d = new Date(t);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const entry = days.get(key);
    if (!entry) {
      days.set(key, { start: t, end: t, t });
    } else {
      entry.end = t;
    }
  }
  let isFirst = true;
  for (const day of days.values()) {
    const mid = (day.start + day.end) / 2;
    const left = ((mid - t0) / span) * 100;
    const isToday = nowMs >= day.start && nowMs <= day.end;
    const isPast = pastUntilMs > 0 && day.end < pastUntilMs;
    /** @type {string} */
    let label;
    if (isFirst && isPast) {
      label = 'Yesterday';
    } else if (isToday) {
      label = 'Today';
    } else {
      label = new Intl.DateTimeFormat([], { weekday: 'short' }).format(new Date(day.t));
    }
    const tick = document.createElement('span');
    tick.className = 'compare-axis-tick';
    if (isToday) tick.classList.add('today');
    if (isPast) tick.classList.add('past');
    tick.style.left = `${left.toFixed(2)}%`;
    tick.textContent = label;
    el.appendChild(tick);
    isFirst = false;
  }
}

function formatLocationLabel(/** @type {SavedLocation} */ loc) {
  const parts = [loc.name, loc.admin1, loc.countryCode || loc.country].filter(Boolean);
  const dedup = parts.filter(
    (p, i) => i === 0 || p.toLowerCase() !== parts[0].toLowerCase()
  );
  return dedup.join(', ');
}

function escapeHtml(/** @type {string} */ s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}
