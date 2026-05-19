// Radar map — MapLibre GL JS wrapper around Open-Meteo's "Weather Map
// Layer" (the `om://` protocol). Renders a multi-layer animated
// forecast directly from Open-Meteo's binary `.om` tiles, no API key
// and no server-side rendering: the package fetches each `.om` file
// straight from `map-tiles.open-meteo.com` and decodes it client-side
// into a raster MapLibre source.
//
// This is the Flowx-style version of the radar tab: the user picks a
// forecast model (DWD ICON, NCEP GFS, ECMWF IFS) and a variable
// (precipitation, temperature, cloud cover, wind, pressure, CAPE),
// then scrubs the time slider through the model's full hourly valid
// times — five days for ICON, ~16 days for GFS.
//
// Public API (unchanged from earlier versions so the rest of the app
// keeps working):
//   const radar = createRadarMap({ map, controls, getUnits });
//   radar.setLocations(locations, activeId);
//   radar.setForecasts(forecastByLoc);
//   radar.invalidateSize();   // call after the container becomes visible
//   radar.destroy();
// `loadFrames()` is kept as a no-op alias for backwards compatibility
// with the previous flow that did an explicit "now load tiles" step.

import { weatherCodeMeta } from './api.js';

/** @typedef {import('./state.js').SavedLocation} SavedLocation */
/** @typedef {import('./api.js').Forecast} Forecast */

const TILE_BASE = 'https://map-tiles.open-meteo.com/data_spatial';

/**
 * Forecast models we expose in the model picker. Order matters — first
 * is the default. Variable availability differs per model; the picker
 * filters the variable list to whatever the active model actually
 * publishes (see {@link refreshFromMeta}).
 *
 * @type {Array<{ id: string, label: string, short: string, range: string }>}
 */
const MODELS = [
  { id: 'dwd_icon', label: 'DWD ICON Global', short: 'ICON', range: '5 days' },
  { id: 'ncep_gfs025', label: 'NCEP GFS', short: 'GFS', range: '~16 days' },
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', short: 'ECMWF', range: '~4 days' }
];

/**
 * Variables exposed in the picker. `id` must match one of the model's
 * published variables. `unit` is just for the status line — the
 * package supplies its own color scale + legend.
 *
 * @type {Array<{ id: string, label: string, emoji: string, unit: string }>}
 */
const VARIABLES = [
  { id: 'precipitation', label: 'Precip', emoji: '🌧', unit: 'mm/h' },
  { id: 'temperature_2m', label: 'Temp', emoji: '🌡', unit: '°' },
  { id: 'cloud_cover', label: 'Clouds', emoji: '☁', unit: '%' },
  { id: 'wind_speed_10m', label: 'Wind', emoji: '💨', unit: 'km/h' },
  { id: 'pressure_msl', label: 'Pressure', emoji: '🌀', unit: 'hPa' },
  { id: 'cape', label: 'Storm', emoji: '⚡', unit: 'J/kg' }
];

/**
 * Minimum dwell time per frame during autoplay (ms). Actual dwell may be
 * longer on slow networks — we wait for MapLibre to report the new
 * frame's tiles are loaded before counting this interval, so playback
 * naturally throttles to whatever the connection can sustain rather
 * than blindly skipping past unloaded frames.
 */
const PLAYBACK_INTERVAL_MS = 700;

/**
 * Hard cap on how long autoplay will wait for a single frame's tiles
 * before giving up and advancing anyway. Prevents one stuck tile
 * request from freezing the whole loop forever.
 */
const PLAYBACK_LOAD_TIMEOUT_MS = 4000;

/**
 * Safety-net timeout for tearing down the previous frame even if the
 * new frame's "sourcedata loaded" event never fires (e.g. a stuck
 * fetch). Long enough that a normal mobile network never trips it.
 */
const PREVIOUS_FRAME_HARD_TEARDOWN_MS = 3500;

/** Only register `om://` with MapLibre once, even across teardown. */
let omProtocolRegistered = false;

function maplibreGl() {
  // eslint-disable-next-line no-undef
  const ml = /** @type {any} */ (globalThis).maplibregl;
  if (!ml || typeof ml.Map !== 'function') {
    throw new Error('MapLibre GL JS is not loaded yet.');
  }
  return ml;
}

function omLayer() {
  // eslint-disable-next-line no-undef
  const omwml = /** @type {any} */ (globalThis).OMWeatherMapLayer;
  if (!omwml || typeof omwml.omProtocol !== 'function') {
    throw new Error('Open-Meteo Weather Map Layer is not loaded yet.');
  }
  return omwml;
}

function ensureOmProtocol() {
  if (omProtocolRegistered) return;
  const ml = maplibreGl();
  const omwml = omLayer();
  ml.addProtocol('om', omwml.omProtocol);
  omProtocolRegistered = true;
}

/**
 * Style object for MapLibre that just shows OpenStreetMap raster tiles
 * underneath whatever weather layer we sit on top. Avoids needing a
 * vector-tile API key (those usually aren't free for high traffic).
 */
function osmStyle() {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm' }
    ]
  };
}

/**
 * @param {{
 *   map: HTMLElement,
 *   controls: HTMLElement,
 *   getUnits: () => 'c'|'f'
 * }} cfg
 */
export function createRadarMap(cfg) {
  ensureOmProtocol();
  const ml = maplibreGl();

  const mlmap = new ml.Map({
    container: cfg.map,
    style: osmStyle(),
    center: [0, 20],
    zoom: 2,
    // We add our own AttributionControl below so we can mix in custom
    // text (Open-Meteo) alongside the auto-discovered OSM attribution.
    attributionControl: false
  });
  mlmap.addControl(new ml.NavigationControl({ visualizePitch: false }), 'top-right');
  mlmap.addControl(
    new ml.AttributionControl({
      customAttribution:
        'Weather &copy; <a href="https://open-meteo.com/">Open-Meteo</a>',
      compact: true
    })
  );

  // ── State ──────────────────────────────────────────────────────────
  let mapReady = false;
  /** @type {string} */
  let model = MODELS[0].id;
  /** @type {string} */
  let variable = VARIABLES[0].id;
  /** @type {string[]} */
  let validTimes = [];
  /** @type {string[]} */
  let availableVariables = [];
  /** @type {string} */
  let referenceTime = '';
  let timeIdx = 0;
  let playing = false;
  /** Monotonic token so a slow metadata fetch can't clobber a newer one. */
  let metaToken = 0;

  // ── Ping-pong frame layer state ────────────────────────────────────
  // To avoid a "flash to basemap" between frames, we keep the previous
  // frame's tile layer visible underneath while the new frame's layer
  // fades in on top of it (via MapLibre's per-tile `raster-fade-duration`).
  // The previous layer is torn down as soon as the new layer reports
  // its tiles are fully loaded (or after a hard safety-net timeout).
  // Each frame gets its own unique source + layer id so the swap is
  // atomic.
  /** @type {string | null} */
  let currentLayerId = null;
  /** @type {string | null} */
  let currentSourceId = null;
  /** @type {string | null} */
  let previousLayerId = null;
  /** @type {string | null} */
  let previousSourceId = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let previousCleanupTimer = null;
  let frameCounter = 0;

  /**
   * Promise that resolves when the current frame's tiles have actually
   * been loaded into MapLibre. Autoplay awaits this so it never advances
   * past a frame the user hasn't seen yet on slow networks.
   * @type {Promise<void> | null}
   */
  let currentLoadedPromise = null;

  /** Monotonic token so an in-flight scheduleNextFrame can be cancelled. */
  let playToken = 0;

  /** @type {Map<string, any>} */
  const markersById = new Map();
  /** @type {Map<string, Forecast>} */
  let forecasts = new Map();
  /** @type {SavedLocation[]} */
  let knownLocations = [];

  // ── DOM ────────────────────────────────────────────────────────────
  cfg.controls.innerHTML = `
    <div class="radar-row radar-row-pickers">
      <label class="radar-model-label">
        <span class="radar-row-title">Model</span>
        <select class="radar-model" aria-label="Forecast model">
          ${MODELS.map(
            (m) =>
              `<option value="${m.id}">${escapeHtml(m.label)} · ${escapeHtml(m.range)}</option>`
          ).join('')}
        </select>
      </label>
      <div class="radar-vars" role="group" aria-label="Variable">
        ${VARIABLES.map(
          (v) => `
            <button
              type="button"
              class="radar-var"
              data-var="${v.id}"
              aria-label="${escapeHtml(v.label)}"
              title="${escapeHtml(v.label)} (${escapeHtml(v.unit)})"
            ><span class="radar-var-emoji">${v.emoji}</span><span class="radar-var-label">${escapeHtml(v.label)}</span></button>
          `
        ).join('')}
      </div>
    </div>
    <div class="radar-row radar-row-time">
      <button type="button" class="radar-play" data-state="paused" aria-label="Play forecast loop">▶</button>
      <input
        type="range"
        class="radar-slider"
        min="0"
        max="0"
        step="1"
        value="0"
        aria-label="Forecast frame"
      />
      <div class="radar-time" aria-live="polite">—</div>
    </div>
    <div class="radar-status" aria-live="polite">Loading model…</div>
  `;

  const modelSelect = /** @type {HTMLSelectElement} */ (cfg.controls.querySelector('.radar-model'));
  const varBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    cfg.controls.querySelectorAll('.radar-var')
  );
  const playBtn = /** @type {HTMLButtonElement} */ (cfg.controls.querySelector('.radar-play'));
  const slider = /** @type {HTMLInputElement} */ (cfg.controls.querySelector('.radar-slider'));
  const timeLabel = /** @type {HTMLDivElement} */ (cfg.controls.querySelector('.radar-time'));
  const statusLine = /** @type {HTMLDivElement} */ (cfg.controls.querySelector('.radar-status'));

  modelSelect.value = model;
  modelSelect.addEventListener('change', () => {
    pause();
    setModel(modelSelect.value);
  });
  for (const btn of varBtns) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.var || variable;
      if (next === variable) return;
      setVariable(next);
    });
  }
  playBtn.addEventListener('click', () => {
    if (playing) pause();
    else play();
  });
  slider.addEventListener('input', () => {
    pause();
    setTime(Number(slider.value));
  });

  // ── MapLibre lifecycle ─────────────────────────────────────────────
  mlmap.on('load', () => {
    mapReady = true;
    refreshOmLayer();
  });
  mlmap.on('error', (ev) => {
    // MapLibre fires lots of harmless tile-load errors at the edges of
    // the model domain; only escalate ones that look fatal so we don't
    // spam the status line.
    const msg = ev?.error?.message || '';
    if (msg && /could not load/i.test(msg)) {
      statusLine.textContent = `Map error: ${msg}`;
      statusLine.dataset.tone = 'warn';
    }
  });

  // Kick off the initial metadata fetch.
  loadMetadata().catch(() => {});

  // ── State transitions ──────────────────────────────────────────────

  function setActiveVariableButton() {
    for (const btn of varBtns) {
      const id = btn.dataset.var || '';
      const supported = !availableVariables.length || availableVariables.includes(id);
      btn.classList.toggle('active', id === variable);
      btn.classList.toggle('unsupported', !supported);
      btn.disabled = !supported;
    }
  }

  async function setModel(/** @type {string} */ nextModel) {
    if (nextModel === model) return;
    model = nextModel;
    modelSelect.value = nextModel;
    await loadMetadata();
  }

  function setVariable(/** @type {string} */ nextVar) {
    if (nextVar === variable) return;
    variable = nextVar;
    setActiveVariableButton();
    refreshOmLayer();
    updateStatus();
  }

  function setTime(/** @type {number} */ idx) {
    if (!validTimes.length) {
      timeLabel.textContent = '—';
      return;
    }
    const n = validTimes.length;
    const next = Math.max(0, Math.min(n - 1, Math.floor(idx)));
    // Avoid re-fetching the same frame — slider `input` events can fire
    // rapidly on touch / mousewheel even when the underlying integer
    // index hasn't changed, which would otherwise rebuild the layer.
    if (next === timeIdx && currentLayerId) {
      slider.value = String(timeIdx);
      return;
    }
    timeIdx = next;
    slider.value = String(timeIdx);
    timeLabel.textContent = formatTimeLabel(validTimes[timeIdx]);
    refreshOmLayer();
  }

  async function loadMetadata() {
    const token = ++metaToken;
    statusLine.textContent = `Loading ${modelLabel(model)}…`;
    statusLine.dataset.tone = 'wait';
    try {
      const url = `${TILE_BASE}/${encodeURIComponent(model)}/latest.json`;
      const proxy = window.proxyService;
      /** @type {any} */
      const data = await (proxy?.fetchJson
        ? proxy.fetchJson(url, {
            timeout: 12000,
            maxRetries: 1,
            friendlyError: `Couldn't load ${modelLabel(model)} metadata.`
          })
        : fetch(url).then((r) => r.json()));
      if (token !== metaToken) return; // a newer setModel superseded us
      validTimes = Array.isArray(data?.valid_times) ? data.valid_times : [];
      availableVariables = Array.isArray(data?.variables) ? data.variables : [];
      referenceTime = String(data?.reference_time || '');
      // If the previously-selected variable isn't published by this
      // model, snap to the first supported one (precip is usually fine).
      if (availableVariables.length && !availableVariables.includes(variable)) {
        variable = VARIABLES.find((v) => availableVariables.includes(v.id))?.id || variable;
      }
      setActiveVariableButton();
      slider.max = String(Math.max(0, validTimes.length - 1));
      setTime(pickInitialTimeIdx(validTimes));
      updateStatus();
    } catch (err) {
      if (token !== metaToken) return;
      statusLine.textContent = `Couldn't load ${modelLabel(model)}: ${err?.message || err}`;
      statusLine.dataset.tone = 'warn';
    }
  }

  function teardownFrame(/** @type {string | null} */ layerId, /** @type {string | null} */ sourceId) {
    if (layerId && mlmap.getLayer(layerId)) mlmap.removeLayer(layerId);
    if (sourceId && mlmap.getSource(sourceId)) mlmap.removeSource(sourceId);
  }

  function refreshOmLayer() {
    if (!mapReady) return;

    // No frames available — tear everything down.
    if (!validTimes.length) {
      if (previousCleanupTimer) {
        clearTimeout(previousCleanupTimer);
        previousCleanupTimer = null;
      }
      teardownFrame(currentLayerId, currentSourceId);
      teardownFrame(previousLayerId, previousSourceId);
      currentLayerId = currentSourceId = null;
      previousLayerId = previousSourceId = null;
      currentLoadedPromise = null;
      setFrameLoadingState(false);
      return;
    }

    // If a "previous → tear down soon" timer is pending, cancel it and
    // tear that frame down NOW so we don't accumulate stale layers when
    // the user scrubs the slider faster than the cleanup interval.
    if (previousCleanupTimer) {
      clearTimeout(previousCleanupTimer);
      previousCleanupTimer = null;
      teardownFrame(previousLayerId, previousSourceId);
      previousLayerId = previousSourceId = null;
    }

    // Demote whatever's currently visible to "previous" — it stays on
    // the map until the new frame's tiles have had time to load and fade
    // in on top of it. This is the trick that hides the load latency.
    previousLayerId = currentLayerId;
    previousSourceId = currentSourceId;

    // Allocate fresh ids so the swap is atomic — if we reused 'om-weather'
    // MapLibre would treat addSource as a no-op or worse.
    const id = `om-frame-${++frameCounter}`;

    // Open-Meteo expects an absolute https URL after the `om://` scheme.
    const omUrl = `${TILE_BASE}/${encodeURIComponent(model)}/latest.json?variable=${encodeURIComponent(variable)}&time_step=valid_times_${timeIdx}&dark=true`;

    mlmap.addSource(id, {
      type: 'raster',
      url: 'om://' + omUrl,
      // Native models stop adding detail above z12 — past that point we'd
      // just be upscaling the same data.
      maxzoom: 12
    });
    mlmap.addLayer({
      id,
      type: 'raster',
      source: id,
      paint: {
        'raster-opacity': 0.78,
        // Per-tile fade as each new tile arrives.
        'raster-fade-duration': 320
      }
    });
    currentLayerId = id;
    currentSourceId = id;

    // Track when this frame's tiles are actually on screen, so the
    // autoplay loop can wait for them on slow networks and so we can
    // tear the previous frame down at exactly the right moment.
    setFrameLoadingState(true);
    const loaded = waitForSourceLoaded(id);
    currentLoadedPromise = loaded;
    loaded.then(() => {
      // Only clear the loading badge if we're still the active frame —
      // if the user moved on while we were loading, a newer call has
      // already set its own loading state.
      if (currentLayerId === id) setFrameLoadingState(false);
    });

    // Schedule teardown of the previous frame as soon as the new one is
    // loaded — with a hard cap so a stuck source can never trap the old
    // frame on top of the map forever.
    if (previousLayerId) {
      const oldLayer = previousLayerId;
      const oldSource = previousSourceId;
      const tearDownOld = () => {
        teardownFrame(oldLayer, oldSource);
        if (previousLayerId === oldLayer) {
          previousLayerId = previousSourceId = null;
        }
        if (previousCleanupTimer) {
          clearTimeout(previousCleanupTimer);
          previousCleanupTimer = null;
        }
      };
      previousCleanupTimer = setTimeout(tearDownOld, PREVIOUS_FRAME_HARD_TEARDOWN_MS);
      loaded.then(() => {
        // Give the fade-in a moment to finish on top of the old layer
        // before we kill it, so there's no visible seam.
        setTimeout(() => {
          // Still the active frame? Then it's safe to drop the previous.
          if (currentLayerId === id) tearDownOld();
        }, 200);
      });
    }
  }

  /**
   * Resolves once MapLibre reports that all tiles in the current viewport
   * for the given source are loaded. Falls back to a timeout so we never
   * hang forever on a stuck request.
   *
   * @param {string} id
   * @returns {Promise<void>}
   */
  function waitForSourceLoaded(id) {
    return new Promise((resolve) => {
      let done = false;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timer = null;
      const onSourceData = (/** @type {any} */ ev) => {
        if (ev?.sourceId !== id) return;
        // `isSourceLoaded` becomes true once all viewport tiles for this
        // source have arrived; that's the right "frame is on screen now"
        // signal for autoplay pacing.
        if (ev.isSourceLoaded) finish();
      };
      const finish = () => {
        if (done) return;
        done = true;
        mlmap.off('sourcedata', onSourceData);
        if (timer) clearTimeout(timer);
        resolve();
      };
      mlmap.on('sourcedata', onSourceData);
      // Check synchronously in case the source was already loaded
      // (cache hit) before we attached the listener.
      try {
        if (mlmap.getSource(id) && mlmap.isSourceLoaded(id)) {
          finish();
          return;
        }
      } catch {
        /* not loaded yet — wait for sourcedata */
      }
      if (!done) timer = setTimeout(finish, PLAYBACK_LOAD_TIMEOUT_MS);
    });
  }

  /**
   * Visually flag the play button / time row as "fetching tiles" so the
   * user knows playback is pacing itself to the network and the app
   * hasn't simply frozen on a slow phone.
   *
   * @param {boolean} on
   */
  function setFrameLoadingState(on) {
    playBtn.dataset.loading = on ? 'true' : 'false';
    timeLabel.dataset.loading = on ? 'true' : 'false';
  }

  function updateStatus() {
    if (!validTimes.length) {
      statusLine.textContent = `No frames available for ${modelLabel(model)}.`;
      statusLine.dataset.tone = 'warn';
      return;
    }
    const m = MODELS.find((mm) => mm.id === model);
    const v = VARIABLES.find((vv) => vv.id === variable);
    const refTime = referenceTime
      ? ` · run ${formatRefTime(referenceTime)}`
      : '';
    statusLine.textContent =
      `${m?.short || model} ${v?.emoji || ''} ${v?.label || variable} · ${validTimes.length} frames${refTime}`;
    statusLine.dataset.tone = 'ok';
  }

  // ── Markers ────────────────────────────────────────────────────────

  function ensureMarker(/** @type {SavedLocation} */ loc) {
    let m = markersById.get(loc.id);
    if (m) {
      m.setLngLat([loc.longitude, loc.latitude]);
      return m;
    }
    const popup = new ml.Popup({ closeButton: true, offset: 22 }).setHTML(buildPopupHtml(loc));
    m = new ml.Marker({ color: '#38bdf8' })
      .setLngLat([loc.longitude, loc.latitude])
      .setPopup(popup)
      .addTo(mlmap);
    markersById.set(loc.id, m);
    return m;
  }

  function setLocations(/** @type {SavedLocation[]} */ locations, /** @type {string} */ activeId) {
    knownLocations = locations.slice();

    const wantIds = new Set(locations.map((l) => l.id));
    for (const [id, marker] of markersById) {
      if (!wantIds.has(id)) {
        marker.remove();
        markersById.delete(id);
      }
    }
    for (const loc of locations) ensureMarker(loc);

    const active = locations.find((l) => l.id === activeId);
    if (active) {
      const z = mlmap.getZoom();
      mlmap.flyTo({
        center: [active.longitude, active.latitude],
        zoom: z < 5 ? 5 : z,
        duration: 600
      });
    } else if (locations.length) {
      const bounds = new ml.LngLatBounds();
      for (const loc of locations) bounds.extend([loc.longitude, loc.latitude]);
      mlmap.fitBounds(bounds, { padding: 80, duration: 600, maxZoom: 7 });
    }
  }

  function setForecasts(/** @type {Map<string, Forecast>} */ next) {
    forecasts = next;
    for (const [id, marker] of markersById) {
      const popup = marker.getPopup();
      if (popup?.isOpen()) {
        popup.setHTML(buildPopupHtml(findLocation(id)));
      }
    }
  }

  /** @returns {SavedLocation | null} */
  function findLocation(/** @type {string} */ id) {
    const known = knownLocations.find((l) => l.id === id);
    if (known) return known;
    const m = markersById.get(id);
    if (!m) return null;
    const ll = m.getLngLat();
    return { id, name: '', latitude: ll.lat, longitude: ll.lng };
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

  // ── Playback ───────────────────────────────────────────────────────
  //
  // Adaptive loop: wait until the current frame's tiles have arrived,
  // then hold the frame for PLAYBACK_INTERVAL_MS, then advance. On a
  // fast connection this is indistinguishable from a fixed 700ms
  // interval; on a slow phone it just naturally slows down to match the
  // network, so the user actually sees each frame instead of skipping
  // past unloaded ones.

  function play() {
    if (!validTimes.length || playing) return;
    playing = true;
    playBtn.textContent = '❚❚';
    playBtn.dataset.state = 'playing';
    playBtn.setAttribute('aria-label', 'Pause forecast loop');
    scheduleNextFrame();
  }

  function pause() {
    playing = false;
    playBtn.textContent = '▶';
    playBtn.dataset.state = 'paused';
    playBtn.setAttribute('aria-label', 'Play forecast loop');
    // Bump the token so any in-flight scheduleNextFrame awaits will see
    // they're stale and exit without advancing. We deliberately do NOT
    // clearTimeout the dwell timer here — that would leave the awaiting
    // async function suspended forever (memory leak). Letting it fire
    // naturally costs at most one dwell interval and exits cleanly via
    // the `playing` / token check.
    playToken++;
  }

  async function scheduleNextFrame() {
    const myToken = ++playToken;
    // 1. Wait for the current frame's tiles to actually be on screen.
    //    On fast networks this resolves more or less immediately; on
    //    slow phones it can take a beat.
    if (currentLoadedPromise) {
      try {
        await currentLoadedPromise;
      } catch {
        /* fall through; we still want to advance eventually */
      }
    }
    if (!playing || myToken !== playToken) return;

    // 2. Hold this frame on screen for the dwell interval. We don't
    //    store this timer's handle — pause()/play() use the staleness
    //    token to cancel logically rather than physically.
    await new Promise((resolve) => {
      setTimeout(resolve, PLAYBACK_INTERVAL_MS);
    });
    if (!playing || myToken !== playToken) return;

    // 3. Advance.
    const n = validTimes.length;
    if (!n) return;
    setTime((timeIdx + 1) % n);
    scheduleNextFrame();
  }

  // ── Public ─────────────────────────────────────────────────────────

  function invalidateSize() {
    // MapLibre needs to recompute its canvas size after the container
    // becomes visible (we mount the radar lazily inside a hidden tab).
    setTimeout(() => mlmap.resize(), 0);
  }

  function destroy() {
    pause();
    if (previousCleanupTimer) {
      clearTimeout(previousCleanupTimer);
      previousCleanupTimer = null;
    }
    for (const m of markersById.values()) m.remove();
    markersById.clear();
    mlmap.remove();
    cfg.controls.innerHTML = '';
  }

  // `loadFrames` exists only for backwards-compat with the old API; the
  // map fetches its tiles on demand as soon as MapLibre fires `load`.
  function loadFrames() {
    return Promise.resolve();
  }

  return {
    loadFrames,
    setLocations,
    setForecasts,
    invalidateSize,
    destroy
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function modelLabel(/** @type {string} */ id) {
  return MODELS.find((m) => m.id === id)?.label || id;
}

function pickInitialTimeIdx(/** @type {string[]} */ validTimes) {
  if (!validTimes.length) return 0;
  const now = Date.now();
  let best = 0;
  for (let i = 0; i < validTimes.length; i++) {
    const t = Date.parse(validTimes[i]);
    if (!Number.isFinite(t)) continue;
    if (t <= now) best = i;
    else break;
  }
  return best;
}

function formatTimeLabel(/** @type {string} */ iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const date = new Date(t);
  const day = new Intl.DateTimeFormat([], {
    weekday: 'short'
  }).format(date);
  const clock = new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
  const diffMin = Math.round((t - Date.now()) / 60000);
  if (Math.abs(diffMin) <= 30) return `${day} ${clock} · now`;
  if (diffMin < 0) return `${day} ${clock} · ${formatGap(-diffMin)} ago`;
  return `${day} ${clock} · in ${formatGap(diffMin)}`;
}

function formatRefTime(/** @type {string} */ iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  try {
    return new Intl.DateTimeFormat([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(t));
  } catch {
    return iso;
  }
}

function formatGap(/** @type {number} */ mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
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
