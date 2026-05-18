/**
 * Trip Log — record real-world GPS trips into your own Google Sheet.
 *
 * Flow on first sign-in:
 *
 *   1. GIS pops the consent dialog → `requestAccessToken`.
 *   2. `openSiteDatabase` either reuses the same workbook the Todo app
 *      created or makes a fresh one.
 *   3. We make sure the two `triplog-*` tables exist with the right
 *      headers (`triplog-sheets.js` ensures this is idempotent).
 *
 * Recording flow:
 *
 *   • START — append a `recording` row to `triplog-trips`, start the
 *     tracker, kick off a periodic flush of buffered points to the
 *     `triplog-points` table (every 5s).
 *   • Live — every accepted GPS fix updates the map polyline + stats
 *     panel, and lands in the buffer.
 *   • STOP — last flush, mark the trip row `complete` with final stats.
 */

import {
  initGoogleAuth,
  isOAuthUserCancelledError,
  requestAccessToken,
  getCachedAccessToken,
  waitForGoogle,
  clearAccessToken
} from '../google-db/google-auth.js';
import { openSiteDatabase } from '../google-db/site-database.js';
import { createOSEmbed } from '/os-embed.js';
import { TRIPS_TABLE, defaultTripName, TRIP_STATUS } from './triplog-constants.js';
import {
  createPointBuffer,
  createTrip,
  ensureTripLogTables,
  listPoints,
  listTrips,
  updateTripStats
} from './triplog-sheets.js';
import { createTracker } from './triplog-tracker.js';
import { createLiveMap, createReplayMap } from './triplog-map.js';

/** Flush buffered GPS points to Sheets at most this often (ms). */
const FLUSH_INTERVAL_MS = 5_000;

/** Update the trip-row stats columns at most this often (ms). */
const TRIP_ROW_UPDATE_MS = 30_000;

const STATUS_BASE = 'min-w-0 flex-1 break-words text-right empty:hidden text-xs sm:text-sm';

/** @param {HTMLElement} el */
function setStatus(el, text, isError = false) {
  el.textContent = typeof text === 'string' ? text.trim() : String(text);
  el.className = isError
    ? `${STATUS_BASE} text-red-600 dark:text-red-400`
    : `${STATUS_BASE} text-zinc-500 dark:text-zinc-400`;
}

/** @param {number} m */
function formatDistance(m) {
  if (!Number.isFinite(m) || m <= 0) {
    return '0.00 km';
  }
  if (m < 1000) {
    return `${Math.round(m)} m`;
  }
  return `${(m / 1000).toFixed(2)} km`;
}

/** @param {number} sec */
function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) {
    return '0:00';
  }
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** @param {number | null | undefined} ms */
function formatSpeed(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return '— km/h';
  }
  return `${(ms * 3.6).toFixed(1)} km/h`;
}

/** @param {number | null | undefined} m */
function formatAccuracy(m) {
  if (m == null || !Number.isFinite(m)) {
    return '—';
  }
  return `±${Math.round(m)} m`;
}

/** @param {string} iso */
function formatTripStartedAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/** @template T @param {string} id @returns {T} */
function $(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id} in DOM`);
  }
  return /** @type {T} */ (/** @type {unknown} */ (el));
}

function main() {
  /** @type {HTMLElement} */
  const statusEl = $('status');
  /** @type {HTMLButtonElement} */
  const btnSignin = $('btn-signin');
  /** @type {HTMLButtonElement} */
  const btnSignout = $('btn-signout');
  /** @type {HTMLButtonElement} */
  const btnStart = $('btn-start');
  /** @type {HTMLButtonElement} */
  const btnStop = $('btn-stop');
  /** @type {HTMLButtonElement} */
  const btnFollow = $('btn-follow');
  /** @type {HTMLButtonElement} */
  const btnRefreshTrips = $('btn-refresh-trips');
  /** @type {HTMLInputElement} */
  const tripNameInput = $('trip-name');
  /** @type {HTMLElement} */
  const signedOutEl = $('signed-out');
  /** @type {HTMLElement} */
  const appLoadingEl = $('app-loading');
  /** @type {HTMLElement} */
  const appLoadingMsgEl = $('app-loading-message');
  /** @type {HTMLElement} */
  const appMainEl = $('app-main');
  /** @type {HTMLElement} */
  const statDistance = $('stat-distance');
  /** @type {HTMLElement} */
  const statDuration = $('stat-duration');
  /** @type {HTMLElement} */
  const statSpeed = $('stat-speed');
  /** @type {HTMLElement} */
  const statAccuracy = $('stat-accuracy');
  /** @type {HTMLElement} */
  const tripsList = $('trips-list');
  /** @type {HTMLElement} */
  const tripsEmpty = $('trips-empty');
  /** @type {HTMLElement} */
  const mapEl = $('map');
  /** @type {HTMLDialogElement} */
  const tripViewDialog = $('trip-view-dialog');
  /** @type {HTMLElement} */
  const tripViewMap = $('trip-view-map');
  /** @type {HTMLElement} */
  const tripViewTitle = $('trip-view-title');
  /** @type {HTMLElement} */
  const tripViewSummary = $('trip-view-summary');
  /** @type {HTMLButtonElement} */
  const btnTripViewClose = $('btn-trip-view-close');

  const embed = createOSEmbed({ app: 'triplog' });

  /** @type {{
   *   db: import('../google-db/site-database.js').SiteDatabase | null,
   *   liveMap: ReturnType<typeof createLiveMap> | null,
   *   tracker: ReturnType<typeof createTracker> | null,
   *   buffer: ReturnType<typeof createPointBuffer> | null,
   *   currentTrip: import('./triplog-sheets.js').TripRow | null,
   *   flushHandle: number | null,
   *   tripRowUpdateHandle: number | null,
   *   replayMap: ReturnType<typeof createReplayMap> | null
   * }} */
  const state = {
    db: null,
    liveMap: null,
    tracker: null,
    buffer: null,
    currentTrip: null,
    flushHandle: null,
    tripRowUpdateHandle: null,
    replayMap: null
  };

  function setUiVisibility({ signedIn, loading }) {
    signedOutEl.hidden = signedIn || loading;
    appLoadingEl.hidden = !loading;
    appMainEl.hidden = !signedIn || loading;
  }

  function setLoading(message) {
    appLoadingMsgEl.textContent = message;
    setUiVisibility({ signedIn: false, loading: true });
  }

  async function getAccessToken() {
    let t = getCachedAccessToken();
    if (t) {
      return t;
    }
    await requestAccessToken({ prompt: '' });
    t = getCachedAccessToken();
    if (!t) {
      throw new Error('No access token');
    }
    return t;
  }

  function ensureLiveMap() {
    if (state.liveMap) {
      return state.liveMap;
    }
    state.liveMap = createLiveMap(mapEl);
    // Leaflet measures the container at construction time. Inside a
    // flex column, measurements are off until the next paint—nudge it.
    requestAnimationFrame(() => state.liveMap?.invalidateSize());
    return state.liveMap;
  }

  function tryShowInitialPosition() {
    if (!('geolocation' in navigator)) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        ensureLiveMap().showInitialPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          zoom: 15
        });
      },
      () => {
        // Permission not granted yet; the map stays at world view until
        // the user hits Start.
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 5000 }
    );
  }

  async function refreshTripsList() {
    if (!state.db) {
      return;
    }
    try {
      const trips = await listTrips(state.db);
      tripsList.replaceChildren();
      if (trips.length === 0) {
        tripsEmpty.hidden = false;
        return;
      }
      tripsEmpty.hidden = true;
      for (const trip of trips) {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between gap-3 py-2.5';

        const left = document.createElement('button');
        left.type = 'button';
        left.className =
          'flex min-w-0 flex-1 flex-col items-start text-left transition hover:opacity-80';
        const title = document.createElement('span');
        title.className = 'truncate text-sm font-medium';
        title.textContent = trip.name || 'Untitled trip';
        const meta = document.createElement('span');
        meta.className = 'mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400 tabular-nums';
        const status = trip.status === TRIP_STATUS.RECORDING ? ' • ⏺ recording' : '';
        meta.textContent =
          `${formatTripStartedAt(trip.startedAt)} • ${formatDistance(trip.distanceMeters)}` +
          ` • ${formatDuration(trip.durationSec)}${status}`;
        left.append(title, meta);
        left.addEventListener('click', () => openTripView(trip));

        li.appendChild(left);
        tripsList.appendChild(li);
      }
    } catch (err) {
      console.error('[triplog] refreshTripsList', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    }
  }

  /** @param {import('./triplog-sheets.js').TripRow} trip */
  async function openTripView(trip) {
    if (!state.db) {
      return;
    }
    tripViewTitle.textContent = trip.name || 'Untitled trip';
    tripViewSummary.textContent = `${formatTripStartedAt(trip.startedAt)} • ${formatDistance(
      trip.distanceMeters
    )} • ${formatDuration(trip.durationSec)}`;
    tripViewDialog.showModal();

    if (state.replayMap) {
      state.replayMap.destroy();
      state.replayMap = null;
    }
    tripViewMap.innerHTML = '';
    state.replayMap = createReplayMap(tripViewMap);
    requestAnimationFrame(() => state.replayMap?.invalidateSize());

    try {
      const points = await listPoints(state.db, trip.id);
      state.replayMap.drawTrack(points);
    } catch (err) {
      console.error('[triplog] openTripView', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    }
  }

  function closeTripView() {
    if (tripViewDialog.open) {
      tripViewDialog.close();
    }
    if (state.replayMap) {
      state.replayMap.destroy();
      state.replayMap = null;
    }
  }

  function applyStatsToUi(stats) {
    statDistance.textContent = formatDistance(stats.distanceMeters);
    statDuration.textContent = formatDuration(stats.durationSec);
    statSpeed.textContent = formatSpeed(stats.currentSpeedMs);
    statAccuracy.textContent = formatAccuracy(stats.accuracyM);
  }

  async function safeFlush() {
    if (!state.buffer || !state.db) {
      return;
    }
    if (state.buffer.size === 0) {
      return;
    }
    try {
      await state.buffer.flush();
    } catch (err) {
      console.error('[triplog] flush failed; will retry', err);
      setStatus(statusEl, 'Saving GPS points failed; will retry…', true);
    }
  }

  async function periodicTripRowUpdate() {
    if (!state.db || !state.currentTrip || !state.tracker) {
      return;
    }
    try {
      const stats = state.tracker.stats;
      await updateTripStats(state.db, state.currentTrip, {
        distanceMeters: stats.distanceMeters,
        durationSec: stats.durationSec,
        pointCount: stats.pointCount
      });
    } catch (err) {
      console.warn('[triplog] periodicTripRowUpdate', err);
    }
  }

  async function startRecording() {
    if (!state.db) {
      setStatus(statusEl, 'Not connected to your spreadsheet yet.', true);
      return;
    }
    if (state.tracker?.isRecording) {
      return;
    }
    btnStart.disabled = true;
    setStatus(statusEl, 'Asking for GPS…');

    try {
      const tripId = crypto.randomUUID();
      const name = tripNameInput.value.trim() || defaultTripName();
      const startedAt = new Date();

      // Create the row first so the UI list shows the in-progress trip
      // even if the user reloads partway through.
      state.currentTrip = await createTrip(state.db, { id: tripId, name, startedAt });
      state.buffer = createPointBuffer(state.db);

      const tracker = createTracker({
        onPoint: (p, stats) => {
          state.buffer?.push(p);
          state.liveMap?.addLivePoint({
            lat: p.lat,
            lon: p.lon,
            accuracy: p.accuracy
          });
          applyStatsToUi(stats);
        },
        onStats: (stats) => {
          applyStatsToUi(stats);
        },
        onError: (err) => {
          const msg =
            'code' in err && err.code === 1
              ? 'Location permission denied. Allow location and tap Start again.'
              : err.message || 'GPS error';
          setStatus(statusEl, msg, true);
        }
      });
      state.tracker = tracker;

      await tracker.start({ tripId });

      btnStart.hidden = true;
      btnStop.hidden = false;
      btnFollow.classList.remove('hidden');
      btnFollow.classList.add('flex');
      btnFollow.setAttribute('aria-pressed', 'true');
      btnFollow.dataset.on = 'true';
      tripNameInput.disabled = true;

      ensureLiveMap();

      state.flushHandle = window.setInterval(() => void safeFlush(), FLUSH_INTERVAL_MS);
      state.tripRowUpdateHandle = window.setInterval(
        () => void periodicTripRowUpdate(),
        TRIP_ROW_UPDATE_MS
      );

      setStatus(statusEl, 'Recording.');
      embed.notify('Trip Log: started recording.', { kind: 'info' });
      void refreshTripsList();
    } catch (err) {
      console.error('[triplog] startRecording', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
      state.tracker = null;
      state.buffer = null;
      state.currentTrip = null;
    } finally {
      btnStart.disabled = false;
    }
  }

  async function stopRecording() {
    if (!state.tracker?.isRecording) {
      return;
    }
    btnStop.disabled = true;
    setStatus(statusEl, 'Stopping…');

    try {
      const final = state.tracker.stop();
      if (state.flushHandle !== null) {
        window.clearInterval(state.flushHandle);
        state.flushHandle = null;
      }
      if (state.tripRowUpdateHandle !== null) {
        window.clearInterval(state.tripRowUpdateHandle);
        state.tripRowUpdateHandle = null;
      }

      // Final flush of the points buffer.
      await safeFlush();

      if (state.db && state.currentTrip) {
        await updateTripStats(state.db, state.currentTrip, {
          distanceMeters: final.distanceMeters,
          durationSec: final.durationSec,
          pointCount: final.pointCount,
          endedAt: final.endedAt,
          status: TRIP_STATUS.COMPLETE
        });
      }

      setStatus(
        statusEl,
        `Saved trip — ${formatDistance(final.distanceMeters)} in ${formatDuration(
          final.durationSec
        )}`
      );
      embed.notify(
        `Trip saved: ${formatDistance(final.distanceMeters)} in ${formatDuration(
          final.durationSec
        )}`,
        { kind: 'success' }
      );
    } catch (err) {
      console.error('[triplog] stopRecording', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    } finally {
      state.tracker = null;
      state.buffer = null;
      state.currentTrip = null;
      btnStop.hidden = true;
      btnStart.hidden = false;
      btnStop.disabled = false;
      tripNameInput.disabled = false;
      tripNameInput.value = '';
      btnFollow.classList.add('hidden');
      btnFollow.classList.remove('flex');
      void refreshTripsList();
    }
  }

  async function connect({ silent }) {
    setLoading('Connecting to Google…');
    try {
      await waitForGoogle();
      initGoogleAuth();
      let token = getCachedAccessToken();
      if (!token) {
        if (silent) {
          setUiVisibility({ signedIn: false, loading: false });
          return;
        }
        await requestAccessToken({ prompt: 'consent' });
        token = getCachedAccessToken();
        if (!token) {
          throw new Error('No access token');
        }
      }

      const opened = await openSiteDatabase({
        getAccessToken,
        initialTables: [TRIPS_TABLE],
        silent,
        onWillCreateWorkbook: () => {
          appLoadingMsgEl.textContent = 'Setting up your spreadsheet…';
        }
      });
      if (!opened) {
        setUiVisibility({ signedIn: false, loading: false });
        return;
      }
      state.db = opened.db;

      appLoadingMsgEl.textContent = 'Preparing tables…';
      await ensureTripLogTables(state.db);

      setUiVisibility({ signedIn: true, loading: false });
      setStatus(statusEl, '');
      ensureLiveMap();
      tryShowInitialPosition();
      await refreshTripsList();
    } catch (err) {
      if (isOAuthUserCancelledError(err)) {
        setUiVisibility({ signedIn: false, loading: false });
        return;
      }
      console.error('[triplog] connect', err);
      setUiVisibility({ signedIn: false, loading: false });
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    }
  }

  btnSignin.addEventListener('click', () => {
    void connect({ silent: false });
  });

  btnSignout.addEventListener('click', () => {
    if (state.tracker?.isRecording) {
      setStatus(statusEl, 'Stop the current recording before signing out.', true);
      return;
    }
    clearAccessToken();
    state.db = null;
    setUiVisibility({ signedIn: false, loading: false });
    setStatus(statusEl, '');
  });

  btnStart.addEventListener('click', () => void startRecording());
  btnStop.addEventListener('click', () => void stopRecording());

  btnFollow.addEventListener('click', () => {
    const on = btnFollow.dataset.on !== 'true';
    btnFollow.dataset.on = on ? 'true' : 'false';
    btnFollow.setAttribute('aria-pressed', on ? 'true' : 'false');
    btnFollow.textContent = '';
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '📍';
    btnFollow.append(icon, document.createTextNode(on ? ' Follow' : ' Free'));
    state.liveMap?.setFollow(on);
  });

  btnRefreshTrips.addEventListener('click', () => void refreshTripsList());

  btnTripViewClose.addEventListener('click', () => closeTripView());
  tripViewDialog.addEventListener('close', () => closeTripView());

  // Best-effort flush if the user closes the tab mid-recording. The
  // browser kills async work fast on unload, but `keepalive` is a
  // browser-level hint we don't get from `appendTableRow`, so this is
  // best-effort and the periodic flush is the real safety net.
  window.addEventListener('pagehide', () => {
    void safeFlush();
  });

  void connect({ silent: true });
}

main();
