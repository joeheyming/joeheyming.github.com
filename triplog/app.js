/**
 * Trip Log — record real-world GPS trips into local browser storage.
 *
 * Storage is IndexedDB (`triplog-db.js`); no sign-in, no network. The
 * app boots by opening the database, populating the trip list, and
 * showing a live map. Recording is a `navigator.geolocation.watchPosition`
 * loop that streams accepted fixes into the points store and keeps the
 * stats panel + polyline live.
 *
 * Buffering exists for IDB efficiency (one transaction per flush
 * instead of one per fix), but the flush cadence is small enough that
 * a tab-close mid-recording loses at most a couple of seconds of data.
 */

import { createOSEmbed } from '/os-embed.js';
import {
  defaultTripName,
  loadStoredUnit,
  randomUuid,
  saveStoredUnit,
  TRIP_STATUS,
  UNITS
} from './triplog-constants.js';
import { openTriplogDb } from './triplog-db.js';
import {
  getGeolocationState,
  getPlatform,
  onGeolocationStateChange
} from './triplog-permissions.js';
import { createTracker } from './triplog-tracker.js';
import { createLiveMap, createReplayMap } from './triplog-map.js';

/** Flush buffered GPS points to IndexedDB at most this often (ms). */
const FLUSH_INTERVAL_MS = 2_000;

/** Update the trip record's stats columns at most this often (ms). */
const TRIP_ROW_UPDATE_MS = 5_000;

const STATUS_BASE = 'min-w-0 flex-1 break-words text-right empty:hidden text-xs sm:text-sm';

/** @param {HTMLElement} el */
function setStatus(el, text, isError = false) {
  el.textContent = typeof text === 'string' ? text.trim() : String(text);
  el.className = isError
    ? `${STATUS_BASE} text-red-600 dark:text-red-400`
    : `${STATUS_BASE} text-zinc-500 dark:text-zinc-400`;
}

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

/**
 * @param {number} m
 * @param {import('./triplog-constants.js').Unit} [unit]
 */
function formatDistance(m, unit = UNITS.METRIC) {
  if (!Number.isFinite(m) || m <= 0) {
    return unit === UNITS.IMPERIAL ? '0 ft' : '0.00 km';
  }
  if (unit === UNITS.IMPERIAL) {
    const feet = m / METERS_PER_FOOT;
    if (feet < 1000) {
      return `${Math.round(feet)} ft`;
    }
    return `${(m / METERS_PER_MILE).toFixed(2)} mi`;
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

/**
 * @param {number | null | undefined} ms
 * @param {import('./triplog-constants.js').Unit} [unit]
 */
function formatSpeed(ms, unit = UNITS.METRIC) {
  const unitLabel = unit === UNITS.IMPERIAL ? 'mph' : 'km/h';
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return `— ${unitLabel}`;
  }
  if (unit === UNITS.IMPERIAL) {
    return `${(ms * 2.23694).toFixed(1)} mph`;
  }
  return `${(ms * 3.6).toFixed(1)} km/h`;
}

/**
 * @param {number | null | undefined} m
 * @param {import('./triplog-constants.js').Unit} [unit]
 */
function formatAccuracy(m, unit = UNITS.METRIC) {
  if (m == null || !Number.isFinite(m)) {
    return '—';
  }
  if (unit === UNITS.IMPERIAL) {
    return `±${Math.round(m / METERS_PER_FOOT)} ft`;
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
  const btnStart = $('btn-start');
  /** @type {HTMLButtonElement} */
  const btnStop = $('btn-stop');
  /** @type {HTMLButtonElement} */
  const btnFollow = $('btn-follow');
  /** @type {HTMLButtonElement} */
  const btnRefreshTrips = $('btn-refresh-trips');
  /** @type {HTMLButtonElement} */
  const btnUnits = $('btn-units');
  /** @type {HTMLInputElement} */
  const tripNameInput = $('trip-name');
  /** @type {HTMLElement} */
  const appLoadingEl = $('app-loading');
  /** @type {HTMLElement} */
  const appLoadingMsgEl = $('app-loading-message');
  /** @type {HTMLElement} */
  const appMainEl = $('app-main');
  /** @type {HTMLElement} */
  const appErrorEl = $('app-error');
  /** @type {HTMLElement} */
  const appErrorMsgEl = $('app-error-message');
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
  /** @type {HTMLButtonElement} */
  const btnTripViewDelete = $('btn-trip-view-delete');
  /** @type {HTMLElement} */
  const permissionCard = $('permission-card');
  /** @type {HTMLElement} */
  const permissionTitle = $('permission-title');
  /** @type {HTMLElement} */
  const permissionBody = $('permission-body');
  /** @type {HTMLAnchorElement} */
  const permissionAndroidLink = $('permission-android-link');
  /** @type {HTMLButtonElement} */
  const permissionRetryBtn = $('permission-retry');
  /** @type {HTMLButtonElement} */
  const permissionDismissBtn = $('permission-dismiss');

  const embed = createOSEmbed({ app: 'triplog' });
  const platform = getPlatform();

  /** @type {{
   *   db: Awaited<ReturnType<typeof openTriplogDb>> | null,
   *   liveMap: ReturnType<typeof createLiveMap> | null,
   *   tracker: ReturnType<typeof createTracker> | null,
   *   buffer: import('./triplog-db.js').PointRecord[],
   *   currentTripId: string | null,
   *   flushHandle: number | null,
   *   tripRowUpdateHandle: number | null,
   *   replayMap: ReturnType<typeof createReplayMap> | null,
   *   currentReplayTripId: string | null
   * }} */
  const state = {
    db: null,
    liveMap: null,
    tracker: null,
    buffer: [],
    currentTripId: null,
    flushHandle: null,
    tripRowUpdateHandle: null,
    replayMap: null,
    currentReplayTripId: null,
    /** @type {import('./triplog-constants.js').Unit} */
    unit: loadStoredUnit(),
    /** Last live stats snapshot so we can re-render when the unit toggles. */
    lastStats: /** @type {import('./triplog-tracker.js').TrackerStats | null} */ (null)
  };

  function setUiVisibility({ ready, loading, error }) {
    appLoadingEl.hidden = !loading;
    appMainEl.hidden = !ready;
    appErrorEl.hidden = !error;
  }

  /**
   * Render plain-English guidance into the permission-help card, then
   * show it. The card is hidden again whenever permission flips to
   * granted (via the Permissions API onchange) or when the user taps
   * Hide / Try again with success.
   *
   * @param {'site-blocked' | 'system-off' | 'timeout'} reason
   */
  function showPermissionCard(reason) {
    permissionBody.replaceChildren();
    permissionAndroidLink.hidden = true;

    /** @param {string} text */
    const para = (text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    };

    /** @param {string[]} items */
    const steps = (items) => {
      const ol = document.createElement('ol');
      ol.className = 'mt-1 list-decimal space-y-0.5 pl-5';
      for (const t of items) {
        const li = document.createElement('li');
        li.textContent = t;
        ol.appendChild(li);
      }
      return ol;
    };

    if (reason === 'site-blocked') {
      permissionTitle.textContent = "Trip Log isn't allowed to use your location";
      if (platform === 'android') {
        permissionBody.append(
          para('To fix this on your phone:'),
          steps([
            'Tap the lock icon to the left of the address bar.',
            'Tap "Permissions" (or "Reset permissions").',
            'Set Location to "Allow" — or tap Reset and reload the page.'
          ])
        );
      } else if (platform === 'ios') {
        permissionBody.append(
          para('To fix this in Safari:'),
          steps([
            'Tap "AA" in the address bar.',
            'Tap "Website Settings".',
            'Set Location to "Allow".'
          ])
        );
      } else {
        permissionBody.append(
          para('To fix this in your browser:'),
          steps([
            'Click the lock icon to the left of the address bar.',
            'Change "Location" to "Allow".',
            'Reload the page.'
          ])
        );
      }
    } else if (reason === 'system-off') {
      permissionTitle.textContent = "Your phone's location appears to be off";
      if (platform === 'android') {
        permissionBody.append(
          para(
            'Turn on Location in your phone, then tap Try again. The button below jumps to the settings page on your phone.'
          )
        );
        permissionAndroidLink.hidden = false;
      } else if (platform === 'ios') {
        permissionBody.append(
          para('To turn it on:'),
          steps([
            'Open the Settings app.',
            'Tap Privacy & Security, then Location Services.',
            'Make sure Location Services is on at the top.',
            'Scroll to Safari Websites and choose "While Using the App".'
          ])
        );
      } else {
        permissionBody.append(
          para(
            "Your device's location service appears to be off. Turn it on in your system settings, then come back and tap Try again."
          )
        );
      }
    } else if (reason === 'timeout') {
      permissionTitle.textContent = "GPS couldn't get a fix";
      permissionBody.append(
        para(
          'Try moving outside or near a window — indoor GPS is often unreliable. When you have signal, tap Try again.'
        )
      );
    }

    permissionCard.hidden = false;
  }

  function hidePermissionCard() {
    permissionCard.hidden = true;
  }

  /**
   * Re-check whether we can get a fix. Used by the "Try again" button.
   * If permission is granted and the device returns a position, the
   * card is hidden. Otherwise we re-show the right card based on the
   * new error.
   */
  function recheckLocation() {
    if (!('geolocation' in navigator)) {
      return;
    }
    setStatus(statusEl, 'Checking location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        hidePermissionCard();
        setStatus(statusEl, '');
        state.liveMap?.showInitialPosition({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          zoom: 15
        });
      },
      (err) => {
        setStatus(statusEl, '');
        if (err.code === 1) {
          showPermissionCard('site-blocked');
        } else if (err.code === 2) {
          showPermissionCard('system-off');
        } else {
          showPermissionCard('timeout');
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
    );
  }

  function ensureLiveMap() {
    if (state.liveMap) {
      return state.liveMap;
    }
    state.liveMap = createLiveMap(mapEl);
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
      const trips = await state.db.listTrips();
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

  /** @param {import('./triplog-db.js').TripRecord} trip */
  async function openTripView(trip) {
    if (!state.db) {
      return;
    }
    state.currentReplayTripId = trip.id;
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
      const points = await state.db.listPoints(trip.id);
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
    state.currentReplayTripId = null;
  }

  async function deleteCurrentReplayTrip() {
    if (!state.db || !state.currentReplayTripId) {
      return;
    }
    const id = state.currentReplayTripId;
    if (id === state.currentTripId) {
      setStatus(statusEl, 'Stop the active recording before deleting this trip.', true);
      return;
    }
    if (!globalThis.confirm('Delete this trip and all of its GPS points? This cannot be undone.')) {
      return;
    }
    try {
      await state.db.deleteTrip(id);
      closeTripView();
      void refreshTripsList();
      setStatus(statusEl, 'Trip deleted.');
    } catch (err) {
      console.error('[triplog] deleteCurrentReplayTrip', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    }
  }

  function applyStatsToUi(stats) {
    state.lastStats = stats;
    statDistance.textContent = formatDistance(stats.distanceMeters, state.unit);
    statDuration.textContent = formatDuration(stats.durationSec);
    statSpeed.textContent = formatSpeed(stats.currentSpeedMs, state.unit);
    statAccuracy.textContent = formatAccuracy(stats.accuracyM, state.unit);
  }

  /**
   * Render the units toggle text to reflect the *opposite* of the
   * current unit (because the button label tells the user what
   * tapping it will switch to, not what they're currently seeing).
   */
  function refreshUnitsButton() {
    btnUnits.textContent =
      state.unit === UNITS.IMPERIAL ? 'Switch to km' : 'Switch to mi';
    btnUnits.setAttribute(
      'aria-label',
      state.unit === UNITS.IMPERIAL ? 'Switch to metric units' : 'Switch to imperial units'
    );
  }

  function toggleUnits() {
    state.unit = state.unit === UNITS.IMPERIAL ? UNITS.METRIC : UNITS.IMPERIAL;
    saveStoredUnit(state.unit);
    refreshUnitsButton();
    if (state.lastStats) {
      applyStatsToUi(state.lastStats);
    } else {
      // No active recording — just refresh the placeholders so the
      // unit labels in "— km/h" / "0.00 km" reflect the new choice.
      applyStatsToUi({
        distanceMeters: 0,
        durationSec: 0,
        pointCount: 0,
        currentSpeedMs: null,
        averageSpeedMs: 0,
        accuracyM: null
      });
    }
  }

  async function flushPointBuffer() {
    if (!state.db || state.buffer.length === 0) {
      return;
    }
    const batch = state.buffer;
    state.buffer = [];
    try {
      await state.db.addPoints(batch);
    } catch (err) {
      console.error('[triplog] flush failed; re-queueing', err);
      // Put the points back so the next flush retries them. Most IDB
      // failures here are transient (quota, version change in another
      // tab); blocking the UI on it would be worse.
      state.buffer = batch.concat(state.buffer);
      setStatus(statusEl, 'Saving GPS points failed; will retry…', true);
    }
  }

  async function periodicTripRowUpdate() {
    if (!state.db || !state.currentTripId || !state.tracker) {
      return;
    }
    try {
      const stats = state.tracker.stats;
      await state.db.updateTripStats(state.currentTripId, {
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
      setStatus(statusEl, 'Database is not ready yet.', true);
      return;
    }
    if (state.tracker?.isRecording) {
      return;
    }
    btnStart.disabled = true;
    setStatus(statusEl, 'Asking for GPS…');

    try {
      const tripId = randomUuid();
      const name = tripNameInput.value.trim() || defaultTripName();
      const startedAt = new Date();

      await state.db.createTrip({ id: tripId, name, startedAt });
      state.currentTripId = tripId;
      state.buffer = [];

      // First-fix latch: zoom the live map in tight the moment we get
      // a real position. We can't do it before `tracker.start` because
      // the user may still be looking at the OS permission prompt.
      let zoomedToTrip = false;

      const tracker = createTracker({
        onPoint: (p, stats) => {
          state.buffer.push(p);
          if (!zoomedToTrip) {
            state.liveMap?.setView({ lat: p.lat, lon: p.lon }, 22);
            zoomedToTrip = true;
          }
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
          const code = 'code' in err ? err.code : 0;
          if (code === 1) {
            showPermissionCard('site-blocked');
            setStatus(statusEl, '');
          } else if (code === 2) {
            showPermissionCard('system-off');
            setStatus(statusEl, '');
          } else if (code === 3) {
            showPermissionCard('timeout');
            setStatus(statusEl, '');
          } else {
            setStatus(statusEl, err.message || 'GPS error', true);
          }
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

      state.flushHandle = window.setInterval(() => void flushPointBuffer(), FLUSH_INTERVAL_MS);
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
      state.buffer = [];
      state.currentTripId = null;
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
      await flushPointBuffer();

      if (state.db && state.currentTripId) {
        await state.db.updateTripStats(state.currentTripId, {
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
      state.buffer = [];
      state.currentTripId = null;
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

  async function init() {
    setUiVisibility({ ready: false, loading: true, error: false });
    appLoadingMsgEl.textContent = 'Opening local trip database…';
    try {
      state.db = await openTriplogDb();
      setUiVisibility({ ready: true, loading: false, error: false });
      setStatus(statusEl, '');
      ensureLiveMap();
      tryShowInitialPosition();
      await refreshTripsList();

      // Preemptively check permission so we can show the help card
      // before the user even taps Start. Subscribe to changes so
      // flipping it from site settings in another tab hides the card
      // automatically — no manual reload required.
      const initialState = await getGeolocationState();
      if (initialState === 'denied') {
        showPermissionCard('site-blocked');
      }
      onGeolocationStateChange((s) => {
        if (s === 'granted') {
          hidePermissionCard();
        } else if (s === 'denied') {
          showPermissionCard('site-blocked');
        }
      });
    } catch (err) {
      console.error('[triplog] init', err);
      const msg = err instanceof Error ? err.message : String(err);
      appErrorMsgEl.textContent = msg;
      setUiVisibility({ ready: false, loading: false, error: true });
    }
  }

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
  btnUnits.addEventListener('click', () => toggleUnits());
  refreshUnitsButton();
  // Render placeholder stats once so the initial labels match the saved unit.
  applyStatsToUi({
    distanceMeters: 0,
    durationSec: 0,
    pointCount: 0,
    currentSpeedMs: null,
    averageSpeedMs: 0,
    accuracyM: null
  });
  // Clear the cached snapshot so an actual recording later doesn't think
  // these placeholder values are real samples.
  state.lastStats = null;

  btnTripViewClose.addEventListener('click', () => closeTripView());
  btnTripViewDelete.addEventListener('click', () => void deleteCurrentReplayTrip());
  tripViewDialog.addEventListener('close', () => closeTripView());

  permissionRetryBtn.addEventListener('click', () => recheckLocation());
  permissionDismissBtn.addEventListener('click', () => hidePermissionCard());

  // Best-effort flush if the user closes the tab mid-recording. The
  // browser kills async work fast on unload, so this is best-effort
  // and the periodic flush is the real safety net.
  window.addEventListener('pagehide', () => {
    void flushPointBuffer();
  });

  void init();
}

main();
