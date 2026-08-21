// Weather app — main entry. ES module.
// Loads state, wires search + tiles + detail view, fetches forecasts in
// parallel, and refreshes every five minutes (when auto-refresh is on).

import { fetchManyForecasts, fetchForecast, searchAny, weatherCodeMeta } from './api.js';
import { loadInitialState, saveState as persistState, buildShareUrl } from './state.js';
import { createRadarMap } from './radar-map.js';
import { createCompareView } from './compare-view.js';
import { createNotifier } from '/notifications.js';

/** @typedef {import('./state.js').AppState} AppState */
/** @typedef {import('./state.js').SavedLocation} SavedLocation */
/** @typedef {import('./api.js').Forecast} Forecast */
/** @typedef {import('./api.js').GeoHit} GeoHit */

// --- DOM ---
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const $search = /** @type {HTMLInputElement} */ ($('place-search'));
const $suggestions = $('place-suggestions');
const $tiles = $('tiles');
const $emptyState = $('empty-state');
const $detail = $('detail');
const $unitF = $('unit-f');
const $unitC = $('unit-c');
const $autoRefresh = /** @type {HTMLInputElement} */ ($('auto-refresh'));
const $locateMe = $('locate-me');
const $copyLink = $('copy-link');
const $refreshBtn = $('refresh-btn');
const $toastStack = $('toast-stack');
const $modeCards = $('mode-cards');
const $modeRadar = $('mode-radar');
const $modeCompare = $('mode-compare');
const $radarMode = $('radar-mode');
const $radarMap = $('radar-map');
const $radarControls = $('radar-controls');
const $radarTicker = $('radar-ticker');
const $compareMode = $('compare-mode');
const $compareView = $('compare-view');

// --- Toast helper ---
const _notifier = createNotifier({
  container: $toastStack,
  kindClass: (k) => `toast ${k === 'error' ? 'error' : ''}`.trim(),
  defaultDurationMs: 3500
});
function toast(/** @type {string} */ msg, /** @type {'info'|'error'} */ kind = 'info') {
  _notifier.notify(msg, { kind });
}

// --- App state ---
let state = /** @type {AppState} */ (loadInitialState());
/** @type {Map<string, Forecast>} */
const forecastByLoc = new Map();
/** @type {Map<string, string>} */
const errorByLoc = new Map();
/** @type {Set<string>} */
const loadingLoc = new Set();
let refreshTimer = /** @type {ReturnType<typeof setInterval>|null} */ (null);
const REFRESH_MS = 5 * 60 * 1000;
/** @type {ReturnType<typeof createRadarMap>|null} */
let radar = null;
/** @type {ReturnType<typeof createCompareView>|null} */
let compareView = null;

function saveState() {
  persistState(state);
}

// ─────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────

function escapeHtml(/** @type {string} */ s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

function cToDisplay(/** @type {number} */ c) {
  if (!Number.isFinite(c)) return '—';
  if (state.units === 'f') {
    return `${Math.round((c * 9) / 5 + 32)}°`;
  }
  return `${Math.round(c)}°`;
}

function kmhToDisplay(/** @type {number} */ kmh) {
  if (!Number.isFinite(kmh)) return '—';
  if (state.units === 'f') {
    return `${Math.round(kmh * 0.621371)} mph`;
  }
  return `${Math.round(kmh)} km/h`;
}

function compassFromDeg(/** @type {number} */ deg) {
  if (!Number.isFinite(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((deg % 360) / 45) % 8];
}

function locationLabel(/** @type {SavedLocation} */ loc) {
  const parts = [loc.name, loc.admin1, loc.countryCode || loc.country].filter(Boolean);
  // Drop admin1 when it duplicates the name (e.g. "New York, New York").
  const dedup = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[0].toLowerCase());
  return dedup.join(', ');
}

function formatHourLocal(/** @type {number} */ tMs, /** @type {string} */ tz) {
  try {
    return new Intl.DateTimeFormat([], {
      hour: 'numeric',
      timeZone: tz
    }).format(new Date(tMs));
  } catch {
    return new Date(tMs).toLocaleTimeString([], { hour: 'numeric' });
  }
}

function formatDayLocal(/** @type {number} */ tMs, /** @type {string} */ tz) {
  try {
    return new Intl.DateTimeFormat([], {
      weekday: 'short',
      timeZone: tz
    }).format(new Date(tMs));
  } catch {
    return new Date(tMs).toLocaleDateString([], { weekday: 'short' });
  }
}

function formatTimeLocal(/** @type {string} */ iso, /** @type {string} */ tz) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  try {
    return new Intl.DateTimeFormat([], {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz
    }).format(new Date(t));
  } catch {
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Rendering — tiles grid
// ─────────────────────────────────────────────────────────────────────────

function renderTiles() {
  if (!state.locations.length) {
    $tiles.innerHTML = '';
    $tiles.classList.add('hidden');
    $emptyState.classList.remove('hidden');
    $detail.classList.add('hidden');
    $detail.innerHTML = '';
    return;
  }
  $emptyState.classList.add('hidden');
  $tiles.classList.remove('hidden');

  $tiles.innerHTML = '';
  for (const loc of state.locations) {
    const f = forecastByLoc.get(loc.id);
    const err = errorByLoc.get(loc.id);
    const loading = loadingLoc.has(loc.id);
    const tile = document.createElement('div');
    tile.className = 'weather-tile';
    if (loc.id === state.activeLocationId) tile.classList.add('active');
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-label', `Show details for ${locationLabel(loc)}`);

    const head = document.createElement('div');
    head.className = 'tile-head';
    head.innerHTML = `
      <div class="min-w-0">
        <div class="tile-name truncate">${escapeHtml(loc.name || 'Unknown')}</div>
        <div class="tile-region truncate">${escapeHtml(
          [loc.admin1, loc.countryCode || loc.country].filter(Boolean).join(', ')
        )}</div>
      </div>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tile-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', `Remove ${loc.name || 'location'}`);
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeLocation(loc.id);
    });
    head.appendChild(closeBtn);
    tile.appendChild(head);

    if (loading && !f) {
      const body = document.createElement('div');
      body.className = 'text-sm text-text-3';
      body.textContent = 'Loading…';
      tile.appendChild(body);
    } else if (err && !f) {
      const body = document.createElement('div');
      body.className = 'tile-error';
      body.textContent = err;
      tile.appendChild(body);
    } else if (f) {
      const meta = weatherCodeMeta(f.current.weatherCode, f.current.isDay);
      const tempLine = document.createElement('div');
      tempLine.className = 'tile-temp';
      tempLine.textContent = cToDisplay(f.current.temperatureC);
      tile.appendChild(tempLine);

      const condLine = document.createElement('div');
      condLine.className = 'tile-cond';
      condLine.innerHTML = `<span class="emoji">${meta.emoji}</span>${escapeHtml(meta.label)}`;
      tile.appendChild(condLine);

      // Today's hi / lo from the first daily entry.
      const today = f.daily[0];
      if (today) {
        const range = document.createElement('div');
        range.className = 'tile-range';
        range.innerHTML = `H ${cToDisplay(today.tempMaxC)} · L ${cToDisplay(today.tempMinC)}`;
        tile.appendChild(range);
      }
    }

    tile.addEventListener('click', () => {
      state.activeLocationId = loc.id;
      saveState();
      renderAll();
    });
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        state.activeLocationId = loc.id;
        saveState();
        renderAll();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeLocation(loc.id);
      }
    });

    $tiles.appendChild(tile);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Rendering — detail view (selected location)
// ─────────────────────────────────────────────────────────────────────────

function renderDetail() {
  const active = state.locations.find((l) => l.id === state.activeLocationId);
  if (!active) {
    $detail.classList.add('hidden');
    $detail.innerHTML = '';
    return;
  }
  const f = forecastByLoc.get(active.id);
  if (!f) {
    const err = errorByLoc.get(active.id);
    if (err) {
      $detail.classList.remove('hidden');
      $detail.innerHTML = `
        <div class="detail-card">
          <div class="place"><strong>${escapeHtml(locationLabel(active))}</strong></div>
          <p class="mt-2 text-danger text-sm">${escapeHtml(err)}</p>
        </div>
      `;
      return;
    }
    $detail.classList.remove('hidden');
    $detail.innerHTML = `
      <div class="detail-card">
        <div class="place"><strong>${escapeHtml(locationLabel(active))}</strong></div>
        <p class="mt-2 text-text-3 text-sm">Loading forecast…</p>
      </div>
    `;
    return;
  }

  const meta = weatherCodeMeta(f.current.weatherCode, f.current.isDay);
  const today = f.daily[0];

  // Hourly: show next 24 entries starting from "now-ish" — the API returns
  // hourly aligned to local time, so we filter to entries >= the current hour.
  const nowMs = Date.now();
  const hourly = f.hourly.filter((h) => h.t >= nowMs - 30 * 60 * 1000).slice(0, 24);

  $detail.classList.remove('hidden');
  $detail.innerHTML = `
    <div class="detail-card">
      <div class="place">
        <strong>${escapeHtml(locationLabel(active))}</strong>
        ${active.zip ? `<span class="ml-1 text-text-3">· ZIP ${escapeHtml(active.zip)}</span>` : ''}
      </div>
      <div class="now">
        <div class="emoji" aria-hidden="true">${meta.emoji}</div>
        <div>
          <div class="temp">${cToDisplay(f.current.temperatureC)}</div>
          <div class="cond">${escapeHtml(meta.label)}</div>
          <div class="feels">Feels like ${cToDisplay(f.current.apparentC)} · Humidity ${Math.round(
    f.current.humidity
  )}%</div>
        </div>
        ${
          today
            ? `<div class="ml-auto text-right text-sm text-text-2">
                <div>H <span class="font-semibold">${cToDisplay(today.tempMaxC)}</span></div>
                <div class="text-text-3">L ${cToDisplay(today.tempMinC)}</div>
              </div>`
            : ''
        }
      </div>
      <div class="stats">
        <div class="stat"><div class="lbl">Wind</div><div class="val">${kmhToDisplay(
          f.current.windKph
        )} ${escapeHtml(compassFromDeg(f.current.windDirection))}</div></div>
        <div class="stat"><div class="lbl">Humidity</div><div class="val">${Math.round(
          f.current.humidity
        )}%</div></div>
        <div class="stat"><div class="lbl">Pressure</div><div class="val">${
          f.current.pressureHpa ? `${Math.round(f.current.pressureHpa)} hPa` : '—'
        }</div></div>
        <div class="stat"><div class="lbl">UV (max)</div><div class="val">${
          today?.uvIndexMax != null ? today.uvIndexMax.toFixed(1) : '—'
        }</div></div>
        <div class="stat"><div class="lbl">Sunrise</div><div class="val">${escapeHtml(
          formatTimeLocal(today?.sunriseIso || '', f.timezone)
        )}</div></div>
        <div class="stat"><div class="lbl">Sunset</div><div class="val">${escapeHtml(
          formatTimeLocal(today?.sunsetIso || '', f.timezone)
        )}</div></div>
        <div class="stat"><div class="lbl">Precip (today)</div><div class="val">${
          today ? `${today.precipitationMm.toFixed(1)} mm` : '—'
        }</div></div>
        <div class="stat"><div class="lbl">Chance of rain</div><div class="val">${
          today ? `${Math.round(today.precipitationProb)}%` : '—'
        }</div></div>
      </div>
    </div>

    <div>
      <div class="section-h">Next 24 hours</div>
      <div class="hour-strip" id="hour-strip"></div>
    </div>

    <div>
      <div class="section-h">7-day forecast</div>
      <div id="day-list"></div>
    </div>
  `;

  const $strip = $detail.querySelector('#hour-strip');
  if ($strip) {
    for (const h of hourly) {
      const m = weatherCodeMeta(h.weatherCode, h.isDay);
      const cell = document.createElement('div');
      cell.className = 'hour-cell';
      cell.innerHTML = `
        <div class="hr">${escapeHtml(formatHourLocal(h.t, f.timezone))}</div>
        <div class="emoji" aria-hidden="true">${m.emoji}</div>
        <div class="temp">${cToDisplay(h.temperatureC)}</div>
        <div class="pop ${h.precipitationProb < 20 ? 'dry' : ''}">${Math.round(
        h.precipitationProb
      )}%</div>
      `;
      $strip.appendChild(cell);
    }
  }

  const $dayList = $detail.querySelector('#day-list');
  if ($dayList) {
    // Build a shared min/max across the 7-day range for the bar visual.
    const lo = Math.min(...f.daily.map((d) => d.tempMinC));
    const hi = Math.max(...f.daily.map((d) => d.tempMaxC));
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < f.daily.length; i++) {
      const d = f.daily[i];
      const m = weatherCodeMeta(d.weatherCode, true);
      const startPct = ((d.tempMinC - lo) / span) * 100;
      const widthPct = ((d.tempMaxC - d.tempMinC) / span) * 100;
      const row = document.createElement('div');
      row.className = 'day-row';
      row.innerHTML = `
        <div class="day-name">${
          i === 0 ? 'Today' : escapeHtml(formatDayLocal(d.t, f.timezone))
        }</div>
        <div class="day-emoji" aria-hidden="true">${m.emoji}</div>
        <div class="temp-bar">
          <div class="temp-bar-fill" style="left:${startPct.toFixed(1)}%;width:${Math.max(
        widthPct,
        4
      ).toFixed(1)}%"></div>
        </div>
        <div class="day-range"><span class="lo">${cToDisplay(d.tempMinC)}</span>${cToDisplay(
        d.tempMaxC
      )}</div>
      `;
      $dayList.appendChild(row);
    }
  }
}

function renderAll() {
  renderUnits();
  renderMode();
  if (state.mode === 'radar') {
    renderRadar();
  } else if (state.mode === 'compare') {
    renderCompare();
  } else {
    renderTiles();
    renderDetail();
  }
}

function renderUnits() {
  $unitF.classList.toggle('active', state.units === 'f');
  $unitC.classList.toggle('active', state.units === 'c');
}

function renderMode() {
  const isRadar = state.mode === 'radar';
  const isCompare = state.mode === 'compare';
  const isCards = !isRadar && !isCompare;
  $modeCards.classList.toggle('active', isCards);
  $modeRadar.classList.toggle('active', isRadar);
  $modeCompare.classList.toggle('active', isCompare);

  if (isRadar || isCompare) {
    $tiles.classList.add('hidden');
    $emptyState.classList.add('hidden');
    $detail.classList.add('hidden');
  }
  $radarMode.classList.toggle('hidden', !isRadar);
  $compareMode.classList.toggle('hidden', !isCompare);
  // The cards-mode visibility (tiles vs empty-state vs detail) is set
  // back up by renderTiles() / renderDetail().
}

function ensureRadar() {
  if (radar) return radar;
  radar = createRadarMap({
    map: $radarMap,
    controls: $radarControls,
    getUnits: () => state.units
  });
  // The radar map starts fetching its own model metadata (DWD ICON by
  // default) as soon as it constructs. We only need to feed it the
  // saved locations and forecast popups via setLocations / setForecasts
  // below.
  return radar;
}

function renderRadar() {
  const r = ensureRadar();
  r.invalidateSize();
  r.setLocations(state.locations, state.activeLocationId);
  r.setForecasts(forecastByLoc);
  renderRadarTicker();
  if (!state.locations.length) {
    // No saved locations yet — keep the radar visible (the user can still
    // browse weather worldwide) but also surface the same suggestion
    // chips the cards mode shows.
    $emptyState.classList.remove('hidden');
  }
}

/**
 * The Flowx-style "daily ticker" that sits above the map: a row of
 * color-coded daily highs (and the city name) for the active location,
 * so the user has an at-a-glance week summary even while panning the
 * radar around. Hidden if there's no active location yet.
 */
function renderRadarTicker() {
  if (!$radarTicker) return;
  const active = state.locations.find((l) => l.id === state.activeLocationId);
  const f = active ? forecastByLoc.get(active.id) : null;
  if (!active || !f || !f.daily?.length) {
    $radarTicker.hidden = true;
    $radarTicker.innerHTML = '';
    return;
  }
  $radarTicker.hidden = false;
  const items = f.daily.slice(0, 7);
  const todayIdx = 0;
  $radarTicker.innerHTML = `
    <div class="radar-ticker-head">
      <div class="radar-ticker-place">${escapeHtml(active.name)}</div>
      <div class="radar-ticker-meta">${escapeHtml(
        [active.admin1, active.countryCode || active.country].filter(Boolean).join(', ') || ' '
      )}</div>
    </div>
    <div class="radar-ticker-days">
      ${items
        .map((d, i) => {
          const label = i === 0 ? 'Today' : formatDayLocal(d.t, f.timezone);
          const tempC = d.tempMaxC;
          const colorHex = colorForTempC(tempC);
          const tempDisp = cToDisplay(tempC);
          return `
            <div class="radar-ticker-day${i === todayIdx ? ' today' : ''}">
              <div class="radar-ticker-temp" style="color:${colorHex}">${escapeHtml(tempDisp)}</div>
              <div class="radar-ticker-day-name">${escapeHtml(label)}</div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

/**
 * Quick five-stop temperature → color ramp for the ticker. Picks a
 * tone that visually matches the warm/cool palette the rest of the
 * app uses (orange = hot, sky-blue = cool, deep blue = freezing).
 *
 * @param {number} c
 */
function colorForTempC(c) {
  if (!Number.isFinite(c)) return 'rgb(148 163 184)';
  if (c >= 30) return '#f87171'; // red
  if (c >= 22) return '#fb923c'; // warm orange
  if (c >= 15) return '#facc15'; // yellow
  if (c >= 8) return '#a3e635'; // lime
  if (c >= 0) return '#38bdf8'; // sky blue
  return '#60a5fa'; // cold blue
}

function ensureCompare() {
  if (compareView) return compareView;
  compareView = createCompareView({
    container: $compareView,
    getUnits: () => state.units,
    onSelectLocation: (id) => {
      if (!id || state.activeLocationId === id) return;
      state.activeLocationId = id;
      saveState();
      // No renderAll() — switching active location inside compare mode
      // shouldn't tear down + rebuild the whole view; the compare-view
      // itself reacts via setLocations below.
      compareView?.setLocations(state.locations, state.activeLocationId);
    }
  });
  return compareView;
}

function renderCompare() {
  const cv = ensureCompare();
  cv.setLocations(state.locations, state.activeLocationId);
  cv.refresh();
  if (!state.locations.length) {
    // Same "no saved locations" treatment as radar — show the suggested
    // city chips so the user has somewhere to start.
    $emptyState.classList.remove('hidden');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────

function addLocation(/** @type {SavedLocation|GeoHit} */ loc) {
  const norm = {
    id: loc.id,
    name: loc.name,
    admin1: loc.admin1 || '',
    country: loc.country || '',
    countryCode: loc.countryCode || '',
    latitude: loc.latitude,
    longitude: loc.longitude,
    zip: 'zip' in loc ? loc.zip : undefined
  };
  if (state.locations.some((l) => l.id === norm.id)) {
    state.activeLocationId = norm.id;
    saveState();
    renderAll();
    return;
  }
  state.locations.push(norm);
  window.heymingAchievements?.unlockForCurrentApp('first-action');
  state.activeLocationId = norm.id;
  saveState();
  renderAll();
  fetchOne(norm);
}

function removeLocation(/** @type {string} */ id) {
  const idx = state.locations.findIndex((l) => l.id === id);
  if (idx === -1) return;
  state.locations.splice(idx, 1);
  forecastByLoc.delete(id);
  errorByLoc.delete(id);
  loadingLoc.delete(id);
  if (state.activeLocationId === id) {
    state.activeLocationId = state.locations[0]?.id || '';
  }
  saveState();
  renderAll();
}

// ─────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────

async function fetchOne(/** @type {SavedLocation} */ loc) {
  loadingLoc.add(loc.id);
  errorByLoc.delete(loc.id);
  if (state.mode === 'cards') {
    renderTiles();
    if (loc.id === state.activeLocationId) renderDetail();
  }
  try {
    const f = await fetchForecast(loc);
    forecastByLoc.set(loc.id, f);
    errorByLoc.delete(loc.id);
  } catch (err) {
    errorByLoc.set(loc.id, err?.message || String(err));
  } finally {
    loadingLoc.delete(loc.id);
  }
  if (state.mode === 'cards') {
    renderTiles();
    if (loc.id === state.activeLocationId) renderDetail();
  }
  radar?.setForecasts(forecastByLoc);
  // Keep the radar's daily ticker in sync once a forecast arrives.
  if (state.mode === 'radar') renderRadarTicker();
}

async function fetchAll() {
  if (!state.locations.length) return;
  for (const loc of state.locations) loadingLoc.add(loc.id);
  renderAll();

  const results = await fetchManyForecasts(state.locations);
  for (const r of results) {
    loadingLoc.delete(r.id);
    if (r.forecast) {
      forecastByLoc.set(r.id, r.forecast);
      errorByLoc.delete(r.id);
    } else if (r.error) {
      errorByLoc.set(r.id, r.error);
    }
  }
  renderAll();
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (!state.autoRefresh) return;
  refreshTimer = setInterval(() => {
    fetchAll().catch(() => {});
  }, REFRESH_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Search box
// ─────────────────────────────────────────────────────────────────────────

let searchToken = 0;
let searchTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
let suggestionIndex = -1;

function closeSuggestions() {
  $suggestions.classList.add('hidden');
  $suggestions.innerHTML = '';
  suggestionIndex = -1;
}

function highlightSuggestion() {
  $suggestions
    .querySelectorAll('.suggestion-row')
    .forEach((r, i) => r.classList.toggle('hl', i === suggestionIndex));
}

function renderSuggestions(/** @type {GeoHit[]} */ hits) {
  if (!hits.length) {
    $suggestions.innerHTML = `<div class="px-3 py-2 text-sm text-text-3">No matches.</div>`;
    $suggestions.classList.remove('hidden');
    suggestionIndex = -1;
    return;
  }
  $suggestions.innerHTML = '';
  hits.slice(0, 10).forEach((hit, idx) => {
    const row = document.createElement('div');
    row.className = 'suggestion-row';
    row.dataset.idx = String(idx);
    const region = [hit.admin1, hit.zip ? `ZIP ${hit.zip}` : ''].filter(Boolean).join(' · ');
    row.innerHTML = `
      <div class="min-w-0">
        <div class="place truncate">${escapeHtml(hit.name)}</div>
        <div class="region">${escapeHtml(region)}</div>
      </div>
      <div class="country">${escapeHtml(hit.countryCode || hit.country || '')}</div>
    `;
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addLocation(hit);
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

async function runSearch(/** @type {string} */ q) {
  const myToken = ++searchToken;
  try {
    const hits = await searchAny(q);
    if (myToken !== searchToken) return;
    renderSuggestions(hits);
  } catch (err) {
    if (myToken !== searchToken) return;
    $suggestions.innerHTML = `<div class="px-3 py-2 text-sm text-danger">Search failed: ${escapeHtml(
      err?.message || String(err)
    )}</div>`;
    $suggestions.classList.remove('hidden');
  }
}

$search.addEventListener('input', () => {
  const q = $search.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (!q) {
    closeSuggestions();
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 250);
});

$search.addEventListener('keydown', (e) => {
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
    if (rows.length && suggestionIndex >= 0) {
      e.preventDefault();
      rows[suggestionIndex].dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      );
    }
  } else if (e.key === 'Escape') {
    closeSuggestions();
  }
});

document.addEventListener('click', (e) => {
  if (!(e.target instanceof Node)) return;
  if (!$search.contains(e.target) && !$suggestions.contains(e.target)) {
    closeSuggestions();
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Toolbar wiring
// ─────────────────────────────────────────────────────────────────────────

$unitF.addEventListener('click', () => {
  if (state.units === 'f') return;
  state.units = 'f';
  saveState();
  renderAll();
});
$unitC.addEventListener('click', () => {
  if (state.units === 'c') return;
  state.units = 'c';
  saveState();
  renderAll();
});

$modeCards.addEventListener('click', () => {
  if (state.mode === 'cards') return;
  state.mode = 'cards';
  saveState();
  renderAll();
});
$modeRadar.addEventListener('click', () => {
  if (state.mode === 'radar') return;
  state.mode = 'radar';
  saveState();
  renderAll();
});
$modeCompare.addEventListener('click', () => {
  if (state.mode === 'compare') return;
  state.mode = 'compare';
  saveState();
  renderAll();
});

$autoRefresh.checked = state.autoRefresh;
$autoRefresh.addEventListener('change', () => {
  state.autoRefresh = !!$autoRefresh.checked;
  saveState();
  if (state.autoRefresh) startAutoRefresh();
  else stopAutoRefresh();
});

$refreshBtn.addEventListener('click', () => {
  fetchAll().catch(() => {});
});

$copyLink.addEventListener('click', async () => {
  const url = buildShareUrl(state);
  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied to clipboard');
  } catch {
    toast('Copy failed — long-press the address bar to share', 'error');
  }
});

$locateMe.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    toast('Geolocation is not available in this browser', 'error');
    return;
  }
  $locateMe.setAttribute('disabled', 'true');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $locateMe.removeAttribute('disabled');
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      addLocation({
        id: `geo:${lat.toFixed(3)},${lon.toFixed(3)}`,
        name: 'My location',
        admin1: '',
        country: '',
        countryCode: '',
        latitude: lat,
        longitude: lon
      });
    },
    (err) => {
      $locateMe.removeAttribute('disabled');
      toast(`Couldn't get your location: ${err.message}`, 'error');
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
});

document.querySelectorAll('[data-add-suggested]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const raw = btn.getAttribute('data-add-suggested') || '';
    try {
      const parsed = JSON.parse(raw);
      addLocation(parsed);
    } catch {
      /* ignore malformed sample */
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────

renderAll();
if (state.locations.length) {
  fetchAll().catch(() => {});
}
startAutoRefresh();
