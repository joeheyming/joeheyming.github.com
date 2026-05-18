// Radar map — Leaflet wrapper that draws an OSM base, location markers,
// and a smooth time-stepped RainViewer precipitation overlay.
//
// Playback strategy: we mount **every** frame as its own tile layer at
// opacity 0 up front, then toggle the active frame's opacity to the
// target value. This is the canonical RainViewer + Leaflet pairing — it
// trades a bit of memory for jitter-free playback because tiles for the
// next frame are already in the browser's cache (and often already in
// the DOM) by the time the slider advances.
//
// Public API:
//   const radar = createRadarMap({ map, controls, getUnits });
//   await radar.loadFrames();
//   radar.setLocations(locations, activeId);
//   radar.setForecasts(forecastByLoc);
//   radar.invalidateSize();   // call after the container becomes visible
//   radar.destroy();

import { fetchRainviewerFrames, frameTileUrl } from './rainviewer.js';
import { weatherCodeMeta } from './api.js';

/** @typedef {import('./state.js').SavedLocation} SavedLocation */
/** @typedef {import('./api.js').Forecast} Forecast */
/** @typedef {import('./rainviewer.js').RainviewerFrame} RainviewerFrame */
/** @typedef {import('./rainviewer.js').RainviewerFrameSet} RainviewerFrameSet */

const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const RAINVIEWER_ATTR = 'Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>';

/**
 * Time between frames during autoplay. RainViewer frames are spaced
 * 10 minutes apart; 500ms per frame gives a brisk-but-readable loop.
 */
const PLAYBACK_INTERVAL_MS = 500;

/** Opacity applied to the active frame's tile layer. */
const ACTIVE_OPACITY = 0.75;

function leaflet() {
  // eslint-disable-next-line no-undef
  const L = /** @type {any} */ (globalThis).L;
  if (!L || typeof L.map !== 'function') {
    throw new Error('Leaflet is not loaded yet.');
  }
  return L;
}

/**
 * @param {{
 *   map: HTMLElement,
 *   controls: HTMLElement,
 *   getUnits: () => 'c'|'f'
 * }} cfg
 */
export function createRadarMap(cfg) {
  const L = leaflet();

  const lmap = L.map(cfg.map, {
    zoomControl: true,
    worldCopyJump: true
  }).setView([20, 0], 2);

  L.tileLayer(OSM_TILES, {
    maxZoom: 19,
    attribution: OSM_ATTR
  }).addTo(lmap);

  /** @type {RainviewerFrameSet | null} */
  let frames = null;
  /** @type {RainviewerFrame[]} */
  let timeline = [];
  /** @type {any[]} Parallel array of tile layers, one per timeline entry. */
  let frameLayers = [];
  let frameIdx = 0;
  /** @type {ReturnType<typeof setInterval> | null} */
  let playTimer = null;
  let playing = false;

  /** @type {Map<string, any>} */
  const markersById = new Map();
  /** @type {Map<string, Forecast>} */
  let forecasts = new Map();

  // ── Time-slider DOM ────────────────────────────────────────────────
  cfg.controls.innerHTML = `
    <button type="button" class="radar-play" data-state="paused" aria-label="Play radar loop">▶</button>
    <input
      type="range"
      class="radar-slider"
      min="0"
      max="0"
      step="1"
      value="0"
      aria-label="Radar frame"
    />
    <div class="radar-time" aria-live="polite">—</div>
  `;
  const playBtn = /** @type {HTMLButtonElement} */ (cfg.controls.querySelector('.radar-play'));
  const slider = /** @type {HTMLInputElement} */ (cfg.controls.querySelector('.radar-slider'));
  const timeLabel = /** @type {HTMLDivElement} */ (cfg.controls.querySelector('.radar-time'));

  playBtn.addEventListener('click', () => {
    if (playing) pause();
    else play();
  });
  slider.addEventListener('input', () => {
    pause();
    setFrame(Number(slider.value));
  });

  // ── Frame rendering ────────────────────────────────────────────────

  function formatFrameLabel(/** @type {RainviewerFrame} */ frame) {
    const ms = frame.t * 1000;
    const date = new Date(ms);
    const hh = new Intl.DateTimeFormat([], {
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
    const isFuture = ms > Date.now();
    if (isFuture) return `${hh} · nowcast`;
    const minsAgo = Math.round((Date.now() - ms) / 60000);
    if (minsAgo <= 1) return `${hh} · now`;
    return `${hh} · ${minsAgo}m ago`;
  }

  function clearFrameLayers() {
    for (const layer of frameLayers) {
      lmap.removeLayer(layer);
    }
    frameLayers = [];
  }

  function buildFrameLayers() {
    clearFrameLayers();
    if (!frames || !timeline.length) return;
    for (const frame of timeline) {
      const url = frameTileUrl(frame, { host: frames.host, kind: 'radar', size: 256 });
      const layer = L.tileLayer(url, {
        opacity: 0,
        attribution: RAINVIEWER_ATTR,
        zIndex: 400
      });
      // Cheap diagnostic: surface tile errors in DevTools without
      // spamming the UI. RainViewer occasionally 404s tiles outside
      // its current radar coverage and that's not actionable here.
      layer.on('tileerror', (e) => {
        // eslint-disable-next-line no-console
        console.debug('[weather/radar] tile error', e?.tile?.src || '');
      });
      layer.addTo(lmap);
      frameLayers.push(layer);
    }
  }

  function setFrame(/** @type {number} */ idx) {
    if (!timeline.length) {
      timeLabel.textContent = '—';
      return;
    }
    frameIdx = Math.max(0, Math.min(timeline.length - 1, idx));
    slider.value = String(frameIdx);
    for (let i = 0; i < frameLayers.length; i++) {
      frameLayers[i].setOpacity(i === frameIdx ? ACTIVE_OPACITY : 0);
    }
    timeLabel.textContent = formatFrameLabel(timeline[frameIdx]);
  }

  function play() {
    if (!timeline.length) return;
    playing = true;
    playBtn.textContent = '❚❚';
    playBtn.dataset.state = 'playing';
    playBtn.setAttribute('aria-label', 'Pause radar loop');
    if (playTimer) clearInterval(playTimer);
    playTimer = setInterval(() => {
      const next = (frameIdx + 1) % timeline.length;
      setFrame(next);
    }, PLAYBACK_INTERVAL_MS);
  }

  function pause() {
    playing = false;
    playBtn.textContent = '▶';
    playBtn.dataset.state = 'paused';
    playBtn.setAttribute('aria-label', 'Play radar loop');
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }

  // ── Public methods ─────────────────────────────────────────────────

  async function loadFrames() {
    timeLabel.textContent = 'Loading radar…';
    try {
      frames = await fetchRainviewerFrames();
      rebuildTimeline();
    } catch (err) {
      timeLabel.textContent = `Radar unavailable: ${err?.message || err}`;
    }
  }

  function rebuildTimeline() {
    if (!frames) {
      timeline = [];
      slider.max = '0';
      slider.value = '0';
      clearFrameLayers();
      return;
    }
    timeline = [...frames.radarPast, ...frames.radarNowcast];
    if (!timeline.length) {
      slider.max = '0';
      slider.value = '0';
      clearFrameLayers();
      timeLabel.textContent = 'No frames available';
      return;
    }
    slider.max = String(timeline.length - 1);
    buildFrameLayers();
    // Land on the most recent "real" frame so the user sees current
    // conditions first, with nowcast frames available by scrubbing right.
    const defaultIdx = frames.radarPast.length
      ? frames.radarPast.length - 1
      : timeline.length - 1;
    setFrame(defaultIdx);
  }

  function setLocations(/** @type {SavedLocation[]} */ locations, /** @type {string} */ activeId) {
    const wantIds = new Set(locations.map((l) => l.id));
    for (const [id, marker] of markersById) {
      if (!wantIds.has(id)) {
        marker.remove();
        markersById.delete(id);
      }
    }
    for (const loc of locations) {
      let marker = markersById.get(loc.id);
      if (!marker) {
        marker = L.marker([loc.latitude, loc.longitude], {
          title: loc.name,
          riseOnHover: true
        }).addTo(lmap);
        marker.bindPopup(() => buildPopupHtml(loc));
        markersById.set(loc.id, marker);
      } else {
        marker.setLatLng([loc.latitude, loc.longitude]);
      }
    }
    const active = locations.find((l) => l.id === activeId);
    if (active) {
      const z = lmap.getZoom();
      lmap.setView([active.latitude, active.longitude], z < 7 ? 7 : z, {
        animate: false
      });
    } else if (locations.length) {
      const group = L.featureGroup(Array.from(markersById.values()));
      lmap.fitBounds(group.getBounds().pad(0.25), { animate: false });
    }
  }

  function setForecasts(/** @type {Map<string, Forecast>} */ next) {
    forecasts = next;
    for (const [id, marker] of markersById) {
      if (marker.isPopupOpen()) {
        marker.setPopupContent(buildPopupHtml(findLocation(id)));
      }
    }
  }

  /** @returns {SavedLocation | null} */
  function findLocation(/** @type {string} */ id) {
    const m = markersById.get(id);
    if (!m) return null;
    const ll = m.getLatLng();
    return {
      id,
      name: m.options.title || '',
      latitude: ll.lat,
      longitude: ll.lng
    };
  }

  function buildPopupHtml(/** @type {SavedLocation | null} */ loc) {
    if (!loc) return '<div class="radar-popup">Unknown location</div>';
    const units = cfg.getUnits();
    const f = forecasts.get(loc.id);
    if (!f) {
      return `
        <div class="radar-popup">
          <div class="radar-popup-name">${escapeHtml(loc.name || 'Location')}</div>
          <div class="radar-popup-loading">No forecast yet</div>
        </div>
      `;
    }
    const meta = weatherCodeMeta(f.current.weatherCode, f.current.isDay);
    const temp = formatTemp(f.current.temperatureC, units);
    const feels = formatTemp(f.current.apparentC, units);
    return `
      <div class="radar-popup">
        <div class="radar-popup-name">${escapeHtml(loc.name || 'Location')}</div>
        <div class="radar-popup-row">
          <span class="radar-popup-emoji">${meta.emoji}</span>
          <span class="radar-popup-temp">${temp}</span>
        </div>
        <div class="radar-popup-cond">${escapeHtml(meta.label)} · feels ${feels}</div>
      </div>
    `;
  }

  function invalidateSize() {
    setTimeout(() => lmap.invalidateSize(), 0);
  }

  function destroy() {
    pause();
    for (const m of markersById.values()) m.remove();
    markersById.clear();
    clearFrameLayers();
    lmap.remove();
    cfg.controls.innerHTML = '';
  }

  return {
    loadFrames,
    setLocations,
    setForecasts,
    invalidateSize,
    destroy
  };
}

function escapeHtml(/** @type {string} */ s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

function formatTemp(/** @type {number} */ c, /** @type {'c'|'f'} */ units) {
  if (!Number.isFinite(c)) return '—';
  if (units === 'f') return `${Math.round(c * 9 / 5 + 32)}°`;
  return `${Math.round(c)}°`;
}
