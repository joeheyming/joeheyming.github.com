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
  ACTIVITY_TUNING,
  defaultTripName,
  loadStoredActivity,
  loadStoredUnit,
  METERS_PER_FOOT,
  METERS_PER_KM,
  METERS_PER_MILE,
  randomUuid,
  saveStoredActivity,
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
import { downsample, renderLineChart } from './triplog-chart.js';
import { createSplitTracker } from './triplog-splits.js';
import { createTracker, haversineMeters } from './triplog-tracker.js';
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

/**
 * Pace, the runner's reciprocal of speed: "minutes per kilometer/mile".
 * Caps out at "—" for stationary samples so we don't show "Infinity /km".
 *
 * @param {number | null | undefined} ms speed in m/s
 * @param {import('./triplog-constants.js').Unit} unit
 */
function formatPace(ms, unit) {
  const unitLabel = unit === UNITS.IMPERIAL ? '/mi' : '/km';
  if (ms == null || !Number.isFinite(ms) || ms <= 0.05) {
    // <0.05 m/s ≈ standing still — Strava shows pace as "—" rather
    // than "00:00:33 /km" in that case.
    return `— ${unitLabel}`;
  }
  const metersPerUnit = unit === UNITS.IMPERIAL ? METERS_PER_MILE : METERS_PER_KM;
  const secPerUnit = metersPerUnit / ms;
  if (secPerUnit > 60 * 60) {
    // Cap at "60+ min" so a barely-moving sample doesn't blow out the
    // layout with three-digit minutes.
    return `60+ min ${unitLabel}`;
  }
  const totalSec = Math.round(secPerUnit);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')} ${unitLabel}`;
}

/**
 * Elevation gain — display in meters (metric) or feet (imperial).
 *
 * @param {number | null | undefined} m
 * @param {import('./triplog-constants.js').Unit} [unit]
 */
function formatElevation(m, unit = UNITS.METRIC) {
  if (m == null || !Number.isFinite(m) || m < 0) {
    return unit === UNITS.IMPERIAL ? '0 ft' : '0 m';
  }
  if (unit === UNITS.IMPERIAL) {
    return `${Math.round(m / METERS_PER_FOOT)} ft`;
  }
  return `${Math.round(m)} m`;
}

/**
 * Format split time. Splits are short enough that we don't need hours.
 * @param {number} sec
 */
function formatSplitTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) {
    return '0:00';
  }
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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
  const btnPause = $('btn-pause');
  /** @type {HTMLButtonElement} */
  const btnResume = $('btn-resume');
  /** @type {HTMLButtonElement} */
  const btnFinish = $('btn-finish');
  /** @type {HTMLButtonElement} */
  const btnFollow = $('btn-follow');
  /** @type {HTMLButtonElement} */
  const btnRefreshTrips = $('btn-refresh-trips');
  /** @type {HTMLButtonElement} */
  const btnUnits = $('btn-units');
  /** @type {HTMLDialogElement} */
  const finishDialog = $('finish-dialog');
  /** @type {HTMLFormElement} */
  const finishForm = $('finish-form');
  /** @type {HTMLInputElement} */
  const finishNameInput = $('finish-name');
  /** @type {HTMLElement} */
  const finishDistance = $('finish-distance');
  /** @type {HTMLElement} */
  const finishDuration = $('finish-duration');
  /** @type {HTMLElement} */
  const finishPace = $('finish-pace');
  /** @type {HTMLElement} */
  const finishPaceLabel = $('finish-pace-label');
  /** @type {HTMLElement} */
  const finishElevation = $('finish-elevation');
  /** @type {HTMLElement} */
  const finishActivityBadge = $('finish-activity-badge');
  /** @type {HTMLButtonElement} */
  const btnFinishSave = $('btn-finish-save');
  /** @type {HTMLButtonElement} */
  const btnFinishDiscard = $('btn-finish-discard');
  /** @type {HTMLButtonElement} */
  const btnFinishBack = $('btn-finish-back');
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
  const statElapsed = $('stat-elapsed');
  /** @type {HTMLElement} */
  const statSpeed = $('stat-speed');
  /** @type {HTMLElement} */
  const statSpeedLabel = $('stat-speed-label');
  /** @type {HTMLElement} */
  const statAvgSpeed = $('stat-avg-speed');
  /** @type {HTMLElement} */
  const statAvgSpeedLabel = $('stat-avg-speed-label');
  /** @type {HTMLElement} */
  const statElevation = $('stat-elevation');
  /** @type {HTMLElement} */
  const statAccuracy = $('stat-accuracy');
  /** @type {HTMLElement} */
  const pausedBadge = $('paused-badge');
  /** @type {HTMLSelectElement} */
  const activitySelect = $('activity-select');
  /** @type {HTMLElement} */
  const splitsCard = $('splits-card');
  /** @type {HTMLElement} */
  const splitsList = $('splits-list');
  /** @type {HTMLElement} */
  const splitsUnitLabel = $('splits-unit-label');
  /** @type {HTMLElement} */
  const splitsSummary = $('splits-summary');
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
  /** @type {HTMLElement} */
  const tvActivityBadge = $('trip-view-activity-badge');
  /** @type {HTMLElement} */
  const tvWhen = $('trip-view-when');
  /** @type {HTMLElement} */
  const tvDistance = $('tv-distance');
  /** @type {HTMLElement} */
  const tvDuration = $('tv-duration');
  /** @type {HTMLElement} */
  const tvElapsed = $('tv-elapsed');
  /** @type {HTMLElement} */
  const tvPace = $('tv-pace');
  /** @type {HTMLElement} */
  const tvPaceLabel = $('tv-pace-label');
  /** @type {HTMLElement} */
  const tvElevation = $('tv-elevation');
  /** @type {HTMLElement} */
  const tvPoints = $('tv-points');
  /** @type {HTMLElement} */
  const tvElevCard = $('trip-view-elev-card');
  /** @type {HTMLElement} */
  const tvElevChart = $('trip-view-elev-chart');
  /** @type {HTMLElement} */
  const tvElevHover = $('trip-view-elev-hover');
  /** @type {HTMLElement} */
  const tvPaceCard = $('trip-view-pace-card');
  /** @type {HTMLElement} */
  const tvPaceChart = $('trip-view-pace-chart');
  /** @type {HTMLElement} */
  const tvPaceTitle = $('trip-view-pace-title');
  /** @type {HTMLElement} */
  const tvPaceHover = $('trip-view-pace-hover');
  /** @type {HTMLElement} */
  const tvPaceScaleMin = $('trip-view-pace-scale-min');
  /** @type {HTMLElement} */
  const tvPaceScaleMax = $('trip-view-pace-scale-max');
  /** @type {HTMLElement} */
  const tvBestsCard = $('trip-view-bests-card');
  /** @type {HTMLElement} */
  const tvBestsList = $('trip-view-bests-list');
  /** @type {HTMLElement} */
  const tvSplitsCard = $('trip-view-splits-card');
  /** @type {HTMLElement} */
  const tvSplitsList = $('trip-view-splits-list');
  /** @type {HTMLElement} */
  const tvSplitsUnitLabel = $('tv-splits-unit-label');
  /** @type {HTMLElement} */
  const tvSplitsSummary = $('tv-splits-summary');
  /** @type {HTMLButtonElement} */
  const btnTripViewClose = $('btn-trip-view-close');
  /** @type {HTMLButtonElement} */
  const btnTripViewDelete = $('btn-trip-view-delete');
  /** @type {HTMLButtonElement} */
  const btnTripViewCrop = $('btn-trip-view-crop');
  /** @type {HTMLElement} */
  const cropBar = $('crop-bar');
  /** @type {HTMLInputElement} */
  const cropSlider = $('crop-slider');
  /** @type {HTMLElement} */
  const cropKeepSummary = $('crop-keep-summary');
  /** @type {HTMLElement} */
  const cropTrimSummary = $('crop-trim-summary');
  /** @type {HTMLButtonElement} */
  const btnCropSave = $('btn-crop-save');
  /** @type {HTMLButtonElement} */
  const btnCropCancel = $('btn-crop-cancel');
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
    /** @type {import('./triplog-constants.js').Activity} */
    activity: loadStoredActivity(),
    /** Last live stats snapshot so we can re-render when the unit toggles. */
    lastStats: /** @type {import('./triplog-tracker.js').TrackerStats | null} */ (null),
    /** Split trackers — one per unit so toggling mid-trip is lossless. */
    splits: {
      /** @type {ReturnType<typeof createSplitTracker> | null} */
      km: null,
      /** @type {ReturnType<typeof createSplitTracker> | null} */
      mi: null
    },
    /**
     * Replay-side state. `replayPoints` is loaded once when the trip
     * view opens and reused by the crop slider so we don't re-hit IDB
     * on every drag tick.
     */
    /** @type {import('./triplog-db.js').PointRecord[]} */
    replayPoints: [],
    cropMode: false
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
          `${formatTripStartedAt(trip.startedAt)} • ${formatDistance(
            trip.distanceMeters,
            state.unit
          )}` + ` • ${formatDuration(trip.durationSec)}${status}`;
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
      trip.distanceMeters,
      state.unit
    )} • ${formatDuration(trip.durationSec)}`;
    tripViewDialog.showModal();

    if (state.replayMap) {
      state.replayMap.destroy();
      state.replayMap = null;
    }
    tripViewMap.innerHTML = '';
    state.replayMap = createReplayMap(tripViewMap);
    requestAnimationFrame(() => state.replayMap?.invalidateSize());

    // Reset the secondary cards while we load — avoids briefly showing
    // the previous trip's chart/splits if the user opens a new one.
    tvElevCard.hidden = true;
    tvElevChart.replaceChildren();
    tvElevHover.textContent = '';
    tvPaceCard.hidden = true;
    tvPaceChart.replaceChildren();
    tvPaceHover.textContent = '';
    tvBestsCard.hidden = true;
    tvBestsList.replaceChildren();
    tvSplitsCard.hidden = true;
    tvSplitsList.replaceChildren();
    tvSplitsSummary.textContent = '';
    renderTripStatsCard(trip, []);

    try {
      const points = await state.db.listPoints(trip.id);
      state.replayPoints = points;
      renderTripViewDetails(trip, points);
      // Crop is only meaningful on completed trips with at least 2 points
      // (anything less can be deleted, not cropped).
      btnTripViewCrop.disabled = points.length < 2 || trip.status === TRIP_STATUS.RECORDING;
    } catch (err) {
      console.error('[triplog] openTripView', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    }
  }

  /**
   * Render all the trip-view detail panels (colored polyline, mile
   * markers, stats grid, elevation + pace charts, best efforts,
   * splits). Called whenever the trip viewer needs a full refresh
   * — initial open, unit toggle, after a crop save, after exiting
   * crop mode.
   *
   * @param {import('./triplog-db.js').TripRecord} trip
   * @param {import('./triplog-db.js').PointRecord[]} points
   */
  function renderTripViewDetails(trip, points) {
    const activityKey =
      trip.activity && Object.prototype.hasOwnProperty.call(ACTIVITY_TUNING, trip.activity)
        ? /** @type {import('./triplog-constants.js').Activity} */ (trip.activity)
        : 'other';
    const tuning = ACTIVITY_TUNING[activityKey];
    const segmentSpeeds = computeSegmentSpeeds(points);
    state.replayMap?.setColoredTrack(points, segmentSpeeds);
    state.replayMap?.setMileMarkers(computeMileMarkers(points, state.unit));
    renderTripStatsCard(trip, points);
    renderElevationChart(points);
    renderPaceChart(points, tuning);
    renderBestEfforts(points, tuning);
    renderTripSplits(points);
  }

  /**
   * Populate the trip-view stats card from a `TripRecord` plus the
   * full point list. We rely on the stored stats for moving time and
   * elevation (those needed live computation we can't perfectly
   * replay), and use `points` to fill in elapsed time and the GPS
   * sample count.
   *
   * @param {import('./triplog-db.js').TripRecord} trip
   * @param {import('./triplog-db.js').PointRecord[]} points
   */
  function renderTripStatsCard(trip, points) {
    const activityKey =
      trip.activity && Object.prototype.hasOwnProperty.call(ACTIVITY_TUNING, trip.activity)
        ? /** @type {import('./triplog-constants.js').Activity} */ (trip.activity)
        : 'other';
    const tuning = ACTIVITY_TUNING[activityKey];
    tvActivityBadge.textContent = `${tuning.emoji} ${tuning.label}`;
    tvWhen.textContent = formatTripStartedAt(trip.startedAt);

    tvDistance.textContent = formatDistance(trip.distanceMeters, state.unit);
    tvDuration.textContent = formatDuration(trip.durationSec);

    // Prefer the stored elapsedSec; if it's missing (old trips) or
    // zero, derive it from the points' first/last timestamps.
    let elapsedSec = trip.elapsedSec ?? 0;
    if ((!elapsedSec || elapsedSec < trip.durationSec) && points.length >= 2) {
      elapsedSec = Math.max(0, (points[points.length - 1].t - points[0].t) / 1000);
    }
    tvElapsed.textContent = formatDuration(elapsedSec);

    // Average pace/speed is derived from distance / moving time, the
    // same way the live screen shows it during recording.
    const avgMs = trip.durationSec > 0 ? trip.distanceMeters / trip.durationSec : 0;
    if (tuning.prefersPace) {
      tvPaceLabel.textContent = 'Avg pace';
      tvPace.textContent = formatPace(avgMs, state.unit);
    } else {
      tvPaceLabel.textContent = 'Avg speed';
      tvPace.textContent = formatSpeed(avgMs, state.unit);
    }

    tvElevation.textContent = formatElevation(trip.elevationGainM ?? 0, state.unit);
    tvPoints.textContent = String(trip.pointCount ?? points.length);
  }

  /**
   * Build the elevation-over-distance area chart. Skips if too few
   * points or if no altitude data was recorded (which is the case on
   * a lot of phones — the GPS chip reports altitude when it has it
   * and `null` when it doesn't).
   *
   * Hover/drag the chart to drop a synced marker on the trip map.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   */
  function renderElevationChart(points) {
    tvElevChart.replaceChildren();
    tvElevHover.textContent = '';
    if (points.length < 2) {
      tvElevCard.hidden = true;
      return;
    }
    // Walk the points once to build {distanceCumulative, altitude}
    // tuples, skipping samples without altitude. Lat/lon ride along so
    // the hover callback can drop a synced marker on the map.
    /** @type {{ x: number, y: number, lat: number, lon: number }[]} */
    const series = [];
    let cumDist = 0;
    /** @type {import('./triplog-db.js').PointRecord | null} */
    let prev = null;
    for (const p of points) {
      if (prev) {
        cumDist += haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
      }
      if (typeof p.altitude === 'number' && Number.isFinite(p.altitude)) {
        series.push({ x: cumDist, y: p.altitude, lat: p.lat, lon: p.lon });
      }
      prev = p;
    }
    if (series.length < 2) {
      // No usable altitude data — hide the card rather than show an
      // empty chart.
      tvElevCard.hidden = true;
      return;
    }
    tvElevCard.hidden = false;
    const sampled = downsample(series, 180);
    const useImperial = state.unit === UNITS.IMPERIAL;
    const xDivisor = useImperial ? METERS_PER_MILE : METERS_PER_KM;
    const xLabel = useImperial ? 'mi' : 'km';
    const xConverted = sampled.map((p) => ({
      x: p.x / xDivisor,
      y: useImperial ? p.y / METERS_PER_FOOT : p.y,
      lat: p.lat,
      lon: p.lon
    }));
    /** @param {number} v */
    const fmtY = (v) => `${Math.round(v)}${useImperial ? ' ft' : ' m'}`;
    /** @param {number} v */
    const fmtX = (v) => `${v.toFixed(v < 10 ? 1 : 0)} ${xLabel}`;
    const svg = renderLineChart({
      points: xConverted,
      color: '#7c3aed',
      fillColor: 'rgba(124, 58, 237, 0.18)',
      width: 360,
      height: 130,
      title: 'Elevation profile',
      formatY: fmtY,
      formatX: fmtX,
      onHover: (_idx, p) => {
        if (!p) {
          state.replayMap?.setHoverMarker(null);
          tvElevHover.textContent = '';
          return;
        }
        state.replayMap?.setHoverMarker({ lat: p.lat, lon: p.lon });
        tvElevHover.textContent = `${fmtX(p.x)} • ${fmtY(p.y)}`;
      }
    });
    tvElevChart.appendChild(svg);
  }

  /**
   * Build the pace (or speed) chart. Smoothed using a ~10-second
   * sliding window so GPS jitter doesn't create a saw-tooth. For
   * paced activities (run/walk/etc.) we plot pace (sec / unit) so
   * the chart reads like a Strava pace chart: peaks = slow points.
   * For wheel activities we plot speed (units / hour) instead.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   * @param {import('./triplog-constants.js').ActivityTuning} tuning
   */
  function renderPaceChart(points, tuning) {
    tvPaceChart.replaceChildren();
    tvPaceHover.textContent = '';
    if (points.length < 2) {
      tvPaceCard.hidden = true;
      return;
    }
    const useImperial = state.unit === UNITS.IMPERIAL;
    const metersPerUnit = useImperial ? METERS_PER_MILE : METERS_PER_KM;
    const unitLabel = useImperial ? 'mi' : 'km';

    const speedsMs = smoothSpeeds(points, 10);
    const cumDistArr = cumulativeDistances(points);
    /** @type {{ x: number, y: number, lat: number, lon: number }[]} */
    const series = [];
    for (let i = 0; i < points.length; i += 1) {
      const sp = speedsMs[i];
      // Skip basically-stationary samples — they'd otherwise yank the
      // line to the floor (or to infinite pace) and ruin the Y range.
      if (!Number.isFinite(sp) || sp < 0.3) continue;
      const x = cumDistArr[i] / metersPerUnit;
      const y = tuning.prefersPace
        ? metersPerUnit / sp // seconds per unit (pace)
        : (sp * 3600) / metersPerUnit; // units per hour (speed)
      series.push({ x, y, lat: points[i].lat, lon: points[i].lon });
    }
    if (series.length < 2) {
      tvPaceCard.hidden = true;
      return;
    }
    tvPaceCard.hidden = false;
    tvPaceTitle.textContent = tuning.prefersPace ? 'Pace profile' : 'Speed profile';
    const sampled = downsample(series, 180);

    /** @param {number} secPerUnit */
    const formatPaceSec = (secPerUnit) => {
      const total = Math.max(0, Math.round(secPerUnit));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${m}:${String(s).padStart(2, '0')} /${unitLabel}`;
    };
    /** @param {number} v */
    const fmtY = tuning.prefersPace
      ? formatPaceSec
      : (v) => `${v.toFixed(v < 10 ? 1 : 0)} ${useImperial ? 'mph' : 'km/h'}`;
    /** @param {number} v */
    const fmtX = (v) => `${v.toFixed(v < 10 ? 1 : 0)} ${unitLabel}`;

    // The min/max labels under the gradient strip mirror the trip's
    // observed range, in the same unit the chart uses.
    const ys = sampled.map((p) => p.y);
    if (tuning.prefersPace) {
      // High Y = slow pace, low Y = fast pace.
      tvPaceScaleMin.textContent = `slow (${fmtY(Math.max(...ys))})`;
      tvPaceScaleMax.textContent = `fast (${fmtY(Math.min(...ys))})`;
    } else {
      tvPaceScaleMin.textContent = `slow (${fmtY(Math.min(...ys))})`;
      tvPaceScaleMax.textContent = `fast (${fmtY(Math.max(...ys))})`;
    }

    const svg = renderLineChart({
      points: sampled,
      color: '#0d9488', // teal — distinct from the violet elevation chart
      fillColor: 'rgba(13, 148, 136, 0.18)',
      width: 360,
      height: 130,
      title: tuning.prefersPace ? 'Pace profile' : 'Speed profile',
      formatY: fmtY,
      formatX: fmtX,
      onHover: (_idx, p) => {
        if (!p) {
          state.replayMap?.setHoverMarker(null);
          tvPaceHover.textContent = '';
          return;
        }
        state.replayMap?.setHoverMarker({ lat: p.lat, lon: p.lon });
        tvPaceHover.textContent = `${fmtX(p.x)} • ${fmtY(p.y)}`;
      }
    });
    tvPaceChart.appendChild(svg);
  }

  /**
   * Sliding-window best efforts (fastest 1k / 1mi / 5k / 10k / half /
   * full) for paced activities. Skipped for wheel activities — "best
   * 5 km on a bike" isn't really a thing people care about.
   *
   * For each target distance, we find the smallest time window in
   * which the cumulative distance grows by ≥ target. Binary search
   * keeps it O(N log N) which is fine for the few-thousand points a
   * GPS trip produces.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   * @param {import('./triplog-constants.js').ActivityTuning} tuning
   */
  function renderBestEfforts(points, tuning) {
    tvBestsList.replaceChildren();
    if (!tuning.prefersPace || points.length < 2) {
      tvBestsCard.hidden = true;
      return;
    }
    /** @type {{ meters: number, label: string }[]} */
    const targets = [
      { meters: 400, label: '400 m' },
      { meters: METERS_PER_KM, label: '1 km' },
      { meters: METERS_PER_MILE, label: '1 mi' },
      { meters: 5 * METERS_PER_KM, label: '5 km' },
      { meters: 10 * METERS_PER_KM, label: '10 km' },
      { meters: 21097.5, label: 'Half marathon' },
      { meters: 42195, label: 'Marathon' }
    ];
    const cumDistArr = cumulativeDistances(points);
    const totalDist = cumDistArr[cumDistArr.length - 1];
    /** @type {{ label: string, meters: number, timeSec: number }[]} */
    const results = [];
    for (const target of targets) {
      if (totalDist < target.meters) continue;
      let bestTime = Infinity;
      for (let i = 0; i < cumDistArr.length; i += 1) {
        const need = cumDistArr[i] + target.meters;
        // Binary search for the smallest j where cumDist[j] >= need.
        let lo = i + 1;
        let hi = cumDistArr.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (cumDistArr[mid] >= need) hi = mid;
          else lo = mid + 1;
        }
        if (cumDistArr[lo] < need) break;
        const time = (points[lo].t - points[i].t) / 1000;
        if (time > 0 && time < bestTime) {
          bestTime = time;
        }
      }
      if (Number.isFinite(bestTime)) {
        results.push({ label: target.label, meters: target.meters, timeSec: bestTime });
      }
    }
    if (results.length === 0) {
      tvBestsCard.hidden = true;
      return;
    }
    tvBestsCard.hidden = false;
    for (const r of results) {
      const li = document.createElement('li');
      li.className = 'flex items-baseline justify-between gap-3 py-1.5 text-sm';
      const label = document.createElement('span');
      label.className = 'flex-1 font-medium';
      label.textContent = r.label;
      const time = document.createElement('span');
      time.className = 'w-20 text-right tabular-nums';
      time.textContent = formatDuration(r.timeSec);
      const paceMs = r.meters / r.timeSec;
      const pace = document.createElement('span');
      pace.className = 'w-24 text-right text-zinc-600 dark:text-zinc-300';
      pace.textContent = formatPace(paceMs, state.unit);
      li.append(label, time, pace);
      tvBestsList.appendChild(li);
    }
  }

  /**
   * Smoothed per-point speed in m/s using a sliding time window. For
   * each sample we walk outwards until the surrounding window spans
   * `windowSec` seconds total, then divide that window's distance by
   * its time. Way calmer than raw segment speeds.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   * @param {number} windowSec
   * @returns {number[]}
   */
  function smoothSpeeds(points, windowSec) {
    const n = points.length;
    const speeds = new Array(n).fill(0);
    const halfMs = (windowSec * 1000) / 2;
    for (let i = 0; i < n; i += 1) {
      let lo = i;
      let hi = i;
      while (lo > 0 && points[i].t - points[lo - 1].t < halfMs) lo -= 1;
      while (hi < n - 1 && points[hi + 1].t - points[i].t < halfMs) hi += 1;
      if (hi <= lo) continue;
      let dist = 0;
      for (let k = lo + 1; k <= hi; k += 1) {
        dist += haversineMeters(points[k - 1].lat, points[k - 1].lon, points[k].lat, points[k].lon);
      }
      const dt = (points[hi].t - points[lo].t) / 1000;
      if (dt > 0) speeds[i] = dist / dt;
    }
    return speeds;
  }

  /**
   * Per-segment speeds (between consecutive points) using the same
   * smoothing as the pace chart. `result[i]` is the speed in m/s for
   * the segment that connects `points[i]` and `points[i+1]`. The
   * coloured polyline on the replay map consumes this directly.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   * @returns {number[]}
   */
  function computeSegmentSpeeds(points) {
    if (points.length < 2) return [];
    const sm = smoothSpeeds(points, 10);
    const out = new Array(points.length - 1);
    for (let i = 0; i < points.length - 1; i += 1) {
      // Average the two endpoint speeds for the segment between them.
      out[i] = (sm[i] + sm[i + 1]) / 2;
    }
    return out;
  }

  /**
   * Cumulative distance in meters at each point — `result[0]` is 0,
   * `result[i]` is the running total at point i. Used by the pace
   * chart and best-efforts search to avoid recomputing haversine
   * lengths each time.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   * @returns {number[]}
   */
  function cumulativeDistances(points) {
    const out = new Array(points.length);
    out[0] = 0;
    for (let i = 1; i < points.length; i += 1) {
      out[i] =
        out[i - 1] +
        haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    }
    return out;
  }

  /**
   * Build km/mi marker locations along the track. We walk the cumulative
   * distance and, each time it crosses `N * unitMeters`, linearly
   * interpolate between the bracketing GPS points to estimate the
   * exact lat/lon of the crossing. Returns one marker per whole unit.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   * @param {import('./triplog-constants.js').Unit} unit
   * @returns {{ lat: number, lon: number, label: string }[]}
   */
  function computeMileMarkers(points, unit) {
    if (points.length < 2) return [];
    const unitMeters = unit === UNITS.IMPERIAL ? METERS_PER_MILE : METERS_PER_KM;
    /** @type {{ lat: number, lon: number, label: string }[]} */
    const markers = [];
    let cum = 0;
    let nextTarget = unitMeters;
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const cur = points[i];
      const segLen = haversineMeters(prev.lat, prev.lon, cur.lat, cur.lon);
      while (cum + segLen >= nextTarget) {
        const t = (nextTarget - cum) / segLen;
        markers.push({
          lat: prev.lat + (cur.lat - prev.lat) * t,
          lon: prev.lon + (cur.lon - prev.lon) * t,
          label: String(Math.round(nextTarget / unitMeters))
        });
        nextTarget += unitMeters;
        // Cap the number of markers we ever render so a very long
        // trip doesn't paint hundreds of overlapping pins.
        if (markers.length > 100) return markers;
      }
      cum += segLen;
    }
    return markers;
  }

  /**
   * Recompute splits from the persisted points so past trips show the
   * same splits the user saw live. Uses the active unit (km vs mi)
   * and pipes cumulative distance + (best-effort) elapsed time into
   * the existing `createSplitTracker`. We don't have the live
   * auto-pause window here, so "time per split" is wall-clock from
   * the first to the last point in that split — close enough for a
   * post-trip recap.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   */
  function renderTripSplits(points) {
    tvSplitsList.replaceChildren();
    tvSplitsSummary.textContent = '';
    if (points.length < 2) {
      tvSplitsCard.hidden = true;
      return;
    }
    const unitMeters = state.unit === UNITS.IMPERIAL ? METERS_PER_MILE : METERS_PER_KM;
    tvSplitsUnitLabel.textContent = state.unit === UNITS.IMPERIAL ? '(mi)' : '(km)';
    const splits = createSplitTracker(unitMeters);
    let cumDist = 0;
    const t0 = points[0].t;
    /** @type {import('./triplog-db.js').PointRecord | null} */
    let prev = null;
    for (const p of points) {
      if (prev) {
        cumDist += haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
      }
      splits.update(cumDist, Math.max(0, (p.t - t0) / 1000));
      prev = p;
    }
    const snap = splits.snapshot();
    if (snap.completed.length === 0 && !snap.inProgress) {
      tvSplitsCard.hidden = true;
      return;
    }
    tvSplitsCard.hidden = false;
    // Pre-compute the min/max pace across completed splits so the bar
    // widths give a relative sense of which splits were slower. The
    // bar is filled in proportion to (pace - minPace) / range, so the
    // slowest split gets a full bar and the fastest a near-empty one.
    const paces = snap.completed.map((s) => s.paceSecPerMeter).filter((p) => p > 0);
    const minPace = paces.length ? Math.min(...paces) : 0;
    const maxPace = paces.length ? Math.max(...paces) : 0;
    const range = maxPace - minPace;
    /** @param {number} pace */
    const widthFor = (pace) => {
      if (!Number.isFinite(pace) || pace <= 0 || range === 0) return 0.5;
      return 0.15 + 0.85 * ((pace - minPace) / range);
    };
    for (const s of snap.completed) {
      tvSplitsList.appendChild(
        renderTripSplitRow(
          s.index,
          s.timeSec,
          s.paceSecPerMeter,
          false,
          widthFor(s.paceSecPerMeter)
        )
      );
    }
    if (snap.inProgress && snap.inProgress.distanceMeters > 0) {
      tvSplitsList.appendChild(
        renderTripSplitRow(
          snap.inProgress.index,
          snap.inProgress.timeSec,
          snap.inProgress.paceSecPerMeter,
          true,
          widthFor(snap.inProgress.paceSecPerMeter)
        )
      );
    }
    if (snap.completed.length > 0) {
      const fastest = snap.completed.reduce((best, s) =>
        s.paceSecPerMeter > 0 &&
        (best.paceSecPerMeter === 0 || s.paceSecPerMeter < best.paceSecPerMeter)
          ? s
          : best
      );
      const fastestPaceLabel = formatPace(
        fastest.paceSecPerMeter > 0 ? 1 / fastest.paceSecPerMeter : null,
        state.unit
      );
      tvSplitsSummary.textContent = `Fastest: split ${fastest.index} • ${fastestPaceLabel}`;
    }
  }

  /**
   * @param {number} index
   * @param {number} timeSec
   * @param {number} paceSecPerMeter
   * @param {boolean} inProgress
   * @param {number} [barWidth] 0..1 — used for the inline "longer bar = slower" indicator
   */
  function renderTripSplitRow(index, timeSec, paceSecPerMeter, inProgress, barWidth = 0.5) {
    const li = document.createElement('li');
    li.className =
      'flex items-center gap-3 py-1.5 text-sm' +
      (inProgress ? ' text-zinc-500 dark:text-zinc-400' : '');
    const left = document.createElement('span');
    left.className = 'w-8 font-semibold';
    left.textContent = `${index}${inProgress ? '·' : ''}`;
    // Bar takes the middle column; the inner fill is colored teal and
    // sized by `barWidth`. Visually mirrors Strava-style split bars
    // where slower splits stretch farther across the row.
    const barWrap = document.createElement('span');
    barWrap.className =
      'relative h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800';
    const barFill = document.createElement('span');
    barFill.className = 'absolute inset-y-0 left-0 rounded-full bg-teal-500/80';
    barFill.style.width = `${Math.round(Math.max(0, Math.min(1, barWidth)) * 100)}%`;
    barWrap.appendChild(barFill);
    const time = document.createElement('span');
    time.className = 'w-12 text-right tabular-nums';
    time.textContent = formatSplitTime(timeSec);
    const pace = document.createElement('span');
    pace.className = 'w-24 text-right tabular-nums text-zinc-600 dark:text-zinc-300';
    pace.textContent = formatPace(paceSecPerMeter > 0 ? 1 / paceSecPerMeter : null, state.unit);
    li.append(left, barWrap, time, pace);
    return li;
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
    state.replayPoints = [];
    exitCropMode();
  }

  /**
   * Re-derive total distance + elevation gain from a kept slice of
   * points. We use the same Haversine helper and elevation-delta rule
   * the live tracker uses, so cropped stats stay consistent with what
   * the user saw during recording.
   *
   * @param {import('./triplog-db.js').PointRecord[]} points
   */
  function recomputeStatsFromPoints(points) {
    let distance = 0;
    let elevation = 0;
    /** @type {import('./triplog-db.js').PointRecord | null} */
    let prev = null;
    /** @type {number | null} */
    let lastElev = null;
    for (const p of points) {
      if (prev) {
        distance += haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
      }
      if (typeof p.altitude === 'number' && Number.isFinite(p.altitude)) {
        if (lastElev === null) {
          lastElev = p.altitude;
        } else {
          const dAlt = p.altitude - lastElev;
          if (Math.abs(dAlt) >= 2) {
            if (dAlt > 0) {
              elevation += dAlt;
            }
            lastElev = p.altitude;
          }
        }
      }
      prev = p;
    }
    return { distanceMeters: distance, elevationGainM: elevation };
  }

  /** Push crop summary text + slider value into the bar. */
  function renderCropSummary() {
    const total = state.replayPoints.length;
    const keep = Math.max(1, Math.min(total, Number(cropSlider.value) || total));
    const kept = state.replayPoints.slice(0, keep);
    const trimmedCount = total - keep;
    const keptStats = recomputeStatsFromPoints(kept);
    const lastKeptT = kept[kept.length - 1]?.t ?? 0;
    const firstT = kept[0]?.t ?? 0;
    const keptDurSec = Math.max(0, (lastKeptT - firstT) / 1000);
    cropKeepSummary.textContent = `${formatDistance(
      keptStats.distanceMeters,
      state.unit
    )} • ${formatDuration(keptDurSec)}`;
    if (trimmedCount === 0) {
      cropTrimSummary.textContent = '0 points';
    } else {
      const trimmed = state.replayPoints.slice(keep);
      const trimmedStats = recomputeStatsFromPoints([kept[kept.length - 1], ...trimmed]);
      const tailDurSec =
        trimmed.length > 0 ? Math.max(0, (trimmed[trimmed.length - 1].t - lastKeptT) / 1000) : 0;
      cropTrimSummary.textContent = `${trimmedCount} points • ${formatDistance(
        trimmedStats.distanceMeters,
        state.unit
      )} • ${formatDuration(tailDurSec)}`;
    }
    state.replayMap?.previewCrop?.(keep);
  }

  function enterCropMode() {
    if (state.replayPoints.length < 2 || !state.replayMap) {
      return;
    }
    state.cropMode = true;
    cropBar.hidden = false;
    cropSlider.max = String(state.replayPoints.length);
    cropSlider.value = String(state.replayPoints.length);
    // Hide the destructive Delete button while cropping so the bar is
    // the focused interaction.
    btnTripViewDelete.disabled = true;
    btnTripViewCrop.disabled = true;
    renderCropSummary();
  }

  function exitCropMode() {
    state.cropMode = false;
    cropBar.hidden = true;
    btnTripViewDelete.disabled = false;
    // Only re-enable Crop if there's a trip loaded with enough points.
    btnTripViewCrop.disabled = state.replayPoints.length < 2;
    state.replayMap?.clearCropPreview?.();
    // Redraw the full track in its colored form so the dashed overlay
    // disappears and the end marker snaps back to the true end.
    if (state.replayPoints.length > 0 && state.db && state.currentReplayTripId) {
      const id = state.currentReplayTripId;
      state.db
        .getTrip(id)
        .then((trip) => {
          if (trip && state.currentReplayTripId === id) {
            renderTripViewDetails(trip, state.replayPoints);
          } else {
            state.replayMap?.drawTrack(state.replayPoints);
          }
        })
        .catch((err) => {
          console.error('[triplog] exitCropMode refresh', err);
          state.replayMap?.drawTrack(state.replayPoints);
        });
    }
  }

  async function saveCrop() {
    if (!state.db || !state.currentReplayTripId || !state.cropMode) {
      return;
    }
    const total = state.replayPoints.length;
    const keep = Math.max(1, Math.min(total, Number(cropSlider.value) || total));
    if (keep >= total) {
      // Nothing to trim.
      exitCropMode();
      return;
    }
    const kept = state.replayPoints.slice(0, keep);
    const keepThroughMs = kept[kept.length - 1].t;
    const tripId = state.currentReplayTripId;

    btnCropSave.disabled = true;
    btnCropCancel.disabled = true;
    try {
      const removed = await state.db.removePointsAfter(tripId, keepThroughMs);
      const recomputed = recomputeStatsFromPoints(kept);
      const firstT = kept[0].t;
      const newEndedAt = new Date(keepThroughMs);
      // Wall-clock duration to the new end point. We lose the moving-
      // time refinement because we don't replay the auto-pause logic
      // here; that's a deliberate trade-off — cropping is usually about
      // removing a forgotten-to-stop tail, where wall-clock is the
      // honest number anyway.
      const newDurationSec = Math.max(0, (keepThroughMs - firstT) / 1000);
      await state.db.updateTripStats(tripId, {
        distanceMeters: recomputed.distanceMeters,
        durationSec: newDurationSec,
        elapsedSec: newDurationSec,
        pointCount: kept.length,
        elevationGainM: recomputed.elevationGainM,
        endedAt: newEndedAt
      });
      state.replayPoints = kept;
      // exitCropMode below will redraw the colored track and refresh
      // all the detail cards from the freshly-persisted trip record.
      exitCropMode();
      const updated = await state.db.getTrip(tripId);
      if (updated) {
        tripViewSummary.textContent = `${formatTripStartedAt(updated.startedAt)} • ${formatDistance(
          updated.distanceMeters,
          state.unit
        )} • ${formatDuration(updated.durationSec)}`;
        renderTripViewDetails(updated, kept);
      }
      void refreshTripsList();
      setStatus(statusEl, `Trimmed ${removed} point${removed === 1 ? '' : 's'} from the end.`);
    } catch (err) {
      console.error('[triplog] saveCrop', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    } finally {
      btnCropSave.disabled = false;
      btnCropCancel.disabled = false;
    }
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

  /** Bike shows speed; run/walk show pace. Driven by the activity tuning. */
  function activityPrefersPace() {
    return ACTIVITY_TUNING[state.activity].prefersPace;
  }

  /**
   * Drive button visibility from the three recorder states. Single
   * source of truth so we don't get stuck with both Pause and Resume
   * showing at the same time.
   *
   * @param {'idle' | 'recording' | 'paused'} mode
   */
  function setRecorderMode(mode) {
    btnStart.hidden = mode !== 'idle';
    btnPause.hidden = mode !== 'recording';
    btnResume.hidden = mode !== 'paused';
    btnFinish.hidden = mode !== 'paused';
  }

  function applyStatsToUi(stats) {
    state.lastStats = stats;
    statDistance.textContent = formatDistance(stats.distanceMeters, state.unit);
    statDuration.textContent = formatDuration(stats.durationSec);
    statElapsed.textContent = formatDuration(stats.elapsedSec || stats.durationSec);
    if (activityPrefersPace()) {
      statSpeedLabel.textContent = 'Pace';
      statAvgSpeedLabel.textContent = 'Avg pace';
      statSpeed.textContent = formatPace(stats.currentSpeedMs, state.unit);
      statAvgSpeed.textContent = formatPace(stats.averageSpeedMs, state.unit);
    } else {
      statSpeedLabel.textContent = 'Speed';
      statAvgSpeedLabel.textContent = 'Avg speed';
      statSpeed.textContent = formatSpeed(stats.currentSpeedMs, state.unit);
      statAvgSpeed.textContent = formatSpeed(stats.averageSpeedMs, state.unit);
    }
    statElevation.textContent = formatElevation(stats.elevationGainM, state.unit);
    statAccuracy.textContent = formatAccuracy(stats.accuracyM, state.unit);
    if (stats.paused) {
      pausedBadge.hidden = false;
      pausedBadge.lastElementChild?.remove?.();
      pausedBadge.textContent = '';
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⏸';
      const label = document.createTextNode(
        ' ' + (stats.pauseReason === 'manual' ? 'Paused' : 'Auto-paused')
      );
      pausedBadge.append(icon, label);
    } else {
      pausedBadge.hidden = true;
    }
    // Keep button visibility in lock-step with manual pause. We only
    // toggle between recording/paused here; idle is owned by start/stop.
    if (state.tracker?.isRecording) {
      setRecorderMode(stats.pauseReason === 'manual' ? 'paused' : 'recording');
    }
  }

  /** Empty placeholder stats; used between trips and after init. */
  function emptyStats() {
    return /** @type {import('./triplog-tracker.js').TrackerStats} */ ({
      distanceMeters: 0,
      durationSec: 0,
      elapsedSec: 0,
      pointCount: 0,
      currentSpeedMs: null,
      averageSpeedMs: 0,
      accuracyM: null,
      elevationGainM: 0,
      paused: false,
      pauseReason: null
    });
  }

  /**
   * Render the units toggle text to reflect the *opposite* of the
   * current unit (because the button label tells the user what
   * tapping it will switch to, not what they're currently seeing).
   */
  function refreshUnitsButton() {
    btnUnits.textContent = state.unit === UNITS.IMPERIAL ? 'Switch to km' : 'Switch to mi';
    btnUnits.setAttribute(
      'aria-label',
      state.unit === UNITS.IMPERIAL ? 'Switch to metric units' : 'Switch to imperial units'
    );
  }

  function toggleUnits() {
    state.unit = state.unit === UNITS.IMPERIAL ? UNITS.METRIC : UNITS.IMPERIAL;
    saveStoredUnit(state.unit);
    refreshUnitsButton();
    renderSplits();
    if (state.lastStats) {
      applyStatsToUi(state.lastStats);
    } else {
      // No active recording — just refresh the placeholders so the
      // unit labels in "— km/h" / "0.00 km" reflect the new choice.
      applyStatsToUi(emptyStats());
    }
    // If the trip viewer is open, re-render its stats/charts/splits so
    // distances, elevation, pace axis, splits, mile markers, and best
    // efforts all switch to the new unit.
    if (tripViewDialog.open && state.currentReplayTripId && state.db) {
      const currentId = state.currentReplayTripId;
      state.db
        .getTrip(currentId)
        .then((trip) => {
          if (!trip || state.currentReplayTripId !== currentId) {
            return;
          }
          renderTripViewDetails(trip, state.replayPoints);
        })
        .catch((err) => console.error('[triplog] refresh trip view after units', err));
    }
  }

  /** @param {import('./triplog-constants.js').Activity} activity */
  function setActivity(activity) {
    if (state.activity === activity) {
      return;
    }
    state.activity = activity;
    saveStoredActivity(activity);
    refreshActivityPicker();
    // Activity changes what "Speed" vs "Pace" means, so re-render stats.
    if (state.lastStats) {
      applyStatsToUi(state.lastStats);
    } else {
      applyStatsToUi(emptyStats());
    }
  }

  /** Populate the activity dropdown from ACTIVITY_TUNING. Idempotent. */
  function populateActivitySelect() {
    activitySelect.replaceChildren();
    for (const [value, tuning] of Object.entries(ACTIVITY_TUNING)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = `${tuning.emoji} ${tuning.label}`;
      activitySelect.appendChild(opt);
    }
    activitySelect.value = state.activity;
  }

  function refreshActivityPicker() {
    if (activitySelect.value !== state.activity) {
      activitySelect.value = state.activity;
    }
  }

  /** Lock the activity picker once recording starts; unlock when it ends. */
  function setActivityPickerLocked(locked) {
    activitySelect.disabled = locked;
  }

  /**
   * Render the splits panel from the active split tracker (chosen by
   * `state.unit`). Hides the panel entirely when there are no completed
   * splits AND nothing in progress — i.e. before recording starts.
   */
  function renderSplits() {
    const tracker = state.unit === UNITS.IMPERIAL ? state.splits.mi : state.splits.km;
    splitsUnitLabel.textContent = state.unit === UNITS.IMPERIAL ? '(mi)' : '(km)';
    if (!tracker) {
      splitsCard.hidden = true;
      splitsList.replaceChildren();
      splitsSummary.textContent = '';
      return;
    }
    const snap = tracker.snapshot();
    if (snap.completed.length === 0 && !snap.inProgress) {
      splitsCard.hidden = true;
      splitsList.replaceChildren();
      splitsSummary.textContent = '';
      return;
    }
    splitsCard.hidden = false;

    splitsList.replaceChildren();
    for (const s of snap.completed) {
      splitsList.appendChild(renderSplitRow(s.index, s.timeSec, s.paceSecPerMeter, false));
    }
    if (snap.inProgress && snap.inProgress.distanceMeters > 0) {
      splitsList.appendChild(
        renderSplitRow(
          snap.inProgress.index,
          snap.inProgress.timeSec,
          snap.inProgress.paceSecPerMeter,
          true
        )
      );
    }

    if (snap.completed.length > 0) {
      const fastest = snap.completed.reduce((best, s) =>
        s.paceSecPerMeter > 0 &&
        (best.paceSecPerMeter === 0 || s.paceSecPerMeter < best.paceSecPerMeter)
          ? s
          : best
      );
      const fastestPaceLabel = formatPace(
        fastest.paceSecPerMeter > 0 ? 1 / fastest.paceSecPerMeter : null,
        state.unit
      );
      splitsSummary.textContent = `Fastest: split ${fastest.index} • ${fastestPaceLabel}`;
    } else {
      splitsSummary.textContent = '';
    }
  }

  /**
   * Build a single row of the splits list. Marks the in-progress
   * (partial) split with reduced opacity and a "current" suffix so
   * runners don't think their pace just got 3× better.
   *
   * @param {number} index
   * @param {number} timeSec
   * @param {number} paceSecPerMeter
   * @param {boolean} inProgress
   */
  function renderSplitRow(index, timeSec, paceSecPerMeter, inProgress) {
    const li = document.createElement('li');
    li.className =
      'flex items-baseline justify-between gap-3 py-1.5 text-sm' +
      (inProgress ? ' text-zinc-500 dark:text-zinc-400' : '');
    const left = document.createElement('span');
    left.className = 'w-12 font-semibold';
    left.textContent = `${index}${inProgress ? '·' : ''}`;
    const time = document.createElement('span');
    time.className = 'flex-1 text-right';
    time.textContent = formatSplitTime(timeSec);
    const pace = document.createElement('span');
    pace.className = 'w-24 text-right text-zinc-600 dark:text-zinc-300';
    pace.textContent = formatPace(paceSecPerMeter > 0 ? 1 / paceSecPerMeter : null, state.unit);
    li.append(left, time, pace);
    return li;
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
        elapsedSec: stats.elapsedSec,
        pointCount: stats.pointCount,
        elevationGainM: stats.elevationGainM
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
      const startedAt = new Date();
      const activity = state.activity;
      // Strava-style: the trip gets a friendly auto-name now and the
      // user can rename it in the Finish dialog if they care to.
      const name = defaultTripName(startedAt, activity);

      await state.db.createTrip({ id: tripId, name, startedAt, activity });
      state.currentTripId = tripId;
      state.buffer = [];
      state.splits.km = createSplitTracker(METERS_PER_KM);
      state.splits.mi = createSplitTracker(METERS_PER_MILE);
      renderSplits();

      // First-fix latch: zoom the live map in tight the moment we get
      // a real position. We can't do it before `tracker.start` because
      // the user may still be looking at the OS permission prompt.
      let zoomedToTrip = false;

      const tuning = ACTIVITY_TUNING[activity];
      const tracker = createTracker({
        tuning: {
          autoPauseSpeedMs: tuning.autoPauseSpeedMs,
          autoPauseSeconds: tuning.autoPauseSeconds
        },
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
          // Feed both split trackers so toggling units mid-trip is free.
          state.splits.km?.update(stats.distanceMeters, stats.durationSec);
          state.splits.mi?.update(stats.distanceMeters, stats.durationSec);
          applyStatsToUi(stats);
          renderSplits();
        },
        onStats: (stats) => {
          // Time-only tick (no new fix): still push to splits so the
          // in-progress row's time keeps counting while standing still.
          state.splits.km?.update(stats.distanceMeters, stats.durationSec);
          state.splits.mi?.update(stats.distanceMeters, stats.durationSec);
          applyStatsToUi(stats);
          renderSplits();
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

      setRecorderMode('recording');
      btnFollow.classList.remove('hidden');
      btnFollow.classList.add('flex');
      btnFollow.setAttribute('aria-pressed', 'true');
      btnFollow.dataset.on = 'true';
      setActivityPickerLocked(true);

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

  function pauseRecording() {
    if (!state.tracker?.isRecording || state.tracker.isManuallyPaused) {
      return;
    }
    state.tracker.pauseManual();
    setRecorderMode('paused');
    setStatus(statusEl, 'Paused.');
  }

  function resumeRecording() {
    if (!state.tracker?.isRecording || !state.tracker.isManuallyPaused) {
      return;
    }
    state.tracker.resumeManual();
    setRecorderMode('recording');
    setStatus(statusEl, 'Recording.');
  }

  /**
   * Open the Strava-style "Finish trip" dialog. The recording is *not*
   * stopped yet — that happens when the user taps Save or Discard from
   * inside the dialog. "Back" returns to the paused state so they can
   * keep going.
   */
  async function openFinishDialog() {
    if (!state.tracker?.isRecording || !state.currentTripId) {
      return;
    }
    // Make sure we're paused before we open the dialog so the timers
    // freeze and the snapshot we show doesn't tick under the user.
    if (!state.tracker.isManuallyPaused) {
      state.tracker.pauseManual();
      setRecorderMode('paused');
    }
    const snap = state.tracker.stats;
    const tuning = ACTIVITY_TUNING[state.activity];
    const usePace = tuning.prefersPace;

    finishDistance.textContent = formatDistance(snap.distanceMeters, state.unit);
    finishDuration.textContent = formatDuration(snap.durationSec);
    finishPaceLabel.textContent = usePace ? 'Avg pace' : 'Avg speed';
    finishPace.textContent = usePace
      ? formatPace(snap.averageSpeedMs, state.unit)
      : formatSpeed(snap.averageSpeedMs, state.unit);
    finishElevation.textContent = formatElevation(snap.elevationGainM, state.unit);
    finishActivityBadge.textContent = `${tuning.emoji} ${tuning.label}`;

    // Pre-fill the editable name with whatever's currently on the trip
    // (the auto-name picked at Start), so the user only has to type if
    // they actually want a different name.
    const current = state.db ? await state.db.getTrip(state.currentTripId) : null;
    finishNameInput.value = current?.name || defaultTripName(new Date(), state.activity);

    if (typeof finishDialog.showModal === 'function') {
      finishDialog.showModal();
    } else {
      finishDialog.setAttribute('open', '');
    }
    // Focus the name field on a slight delay so the dialog has actually
    // mounted before we try to grab focus (avoids a Safari quirk).
    requestAnimationFrame(() => finishNameInput.select());
  }

  /**
   * Shared cleanup after a trip has been finished (either saved or
   * discarded). Resets the recorder UI and in-memory state so the user
   * can immediately start another trip.
   */
  function resetAfterFinish() {
    state.tracker = null;
    state.buffer = [];
    state.currentTripId = null;
    state.splits.km = null;
    state.splits.mi = null;
    setRecorderMode('idle');
    btnFinish.disabled = false;
    btnFollow.classList.add('hidden');
    btnFollow.classList.remove('flex');
    setActivityPickerLocked(false);
    pausedBadge.hidden = true;
    renderSplits();
  }

  /**
   * Persist the in-progress trip, applying any name change from the
   * Finish dialog. Closes the dialog and refreshes the trips list.
   */
  async function saveTrip() {
    if (!state.tracker?.isRecording || !state.currentTripId) {
      return;
    }
    btnFinishSave.disabled = true;
    btnFinishDiscard.disabled = true;
    btnFinishBack.disabled = true;
    try {
      const tripId = state.currentTripId;
      const final = state.tracker.stop();
      if (state.flushHandle !== null) {
        window.clearInterval(state.flushHandle);
        state.flushHandle = null;
      }
      if (state.tripRowUpdateHandle !== null) {
        window.clearInterval(state.tripRowUpdateHandle);
        state.tripRowUpdateHandle = null;
      }
      await flushPointBuffer();

      if (state.db) {
        // First update the rolling stats fields...
        const updated = await state.db.updateTripStats(tripId, {
          distanceMeters: final.distanceMeters,
          durationSec: final.durationSec,
          elapsedSec: final.elapsedSec,
          pointCount: final.pointCount,
          elevationGainM: final.elevationGainM,
          endedAt: final.endedAt,
          status: TRIP_STATUS.COMPLETE
        });
        // ...then apply the (possibly edited) name in a second write.
        // We keep the rename out of `updateTripStats` to avoid blowing
        // out its narrow contract; this is the only place rename
        // happens.
        const desiredName = finishNameInput.value.trim();
        if (desiredName && desiredName !== updated.name) {
          await state.db.renameTrip(tripId, desiredName);
        }
      }

      finishDialog.close();
      setStatus(
        statusEl,
        `Saved — ${formatDistance(final.distanceMeters, state.unit)} in ${formatDuration(
          final.durationSec
        )}`
      );
      embed.notify(
        `Trip saved: ${formatDistance(final.distanceMeters, state.unit)} in ${formatDuration(
          final.durationSec
        )}`,
        { kind: 'success' }
      );
    } catch (err) {
      console.error('[triplog] saveTrip', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    } finally {
      btnFinishSave.disabled = false;
      btnFinishDiscard.disabled = false;
      btnFinishBack.disabled = false;
      resetAfterFinish();
      void refreshTripsList();
    }
  }

  /**
   * Throw away the in-progress trip — deletes the IDB record and every
   * point — after a confirmation prompt. Used by the Discard button in
   * the Finish dialog when the user starts and immediately realises
   * they didn't mean to.
   */
  async function discardTrip() {
    if (!state.tracker?.isRecording || !state.currentTripId) {
      return;
    }
    if (!globalThis.confirm('Discard this trip? It will be deleted and cannot be recovered.')) {
      return;
    }
    btnFinishSave.disabled = true;
    btnFinishDiscard.disabled = true;
    btnFinishBack.disabled = true;
    try {
      const tripId = state.currentTripId;
      try {
        state.tracker.stop();
      } catch {
        /* already stopped */
      }
      if (state.flushHandle !== null) {
        window.clearInterval(state.flushHandle);
        state.flushHandle = null;
      }
      if (state.tripRowUpdateHandle !== null) {
        window.clearInterval(state.tripRowUpdateHandle);
        state.tripRowUpdateHandle = null;
      }
      // Drop the in-memory buffer so it can't get flushed against the
      // about-to-be-deleted trip's id.
      state.buffer = [];
      if (state.db) {
        await state.db.deleteTrip(tripId);
      }
      finishDialog.close();
      setStatus(statusEl, 'Trip discarded.');
    } catch (err) {
      console.error('[triplog] discardTrip', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    } finally {
      btnFinishSave.disabled = false;
      btnFinishDiscard.disabled = false;
      btnFinishBack.disabled = false;
      resetAfterFinish();
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
  btnPause.addEventListener('click', () => pauseRecording());
  btnResume.addEventListener('click', () => resumeRecording());
  btnFinish.addEventListener('click', () => void openFinishDialog());

  // The Save button is type="submit" so Enter in the name field also
  // saves. We preventDefault so the dialog doesn't auto-close — we
  // close it explicitly inside saveTrip after the write succeeds.
  finishForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void saveTrip();
  });
  btnFinishDiscard.addEventListener('click', () => void discardTrip());
  btnFinishBack.addEventListener('click', () => {
    // Close without saving — recording stays paused. The user can hit
    // Resume to keep going, or Finish again to bring the dialog back.
    if (finishDialog.open) {
      finishDialog.close();
    }
  });

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

  populateActivitySelect();
  activitySelect.addEventListener('change', () => {
    const v = activitySelect.value;
    if (Object.prototype.hasOwnProperty.call(ACTIVITY_TUNING, v)) {
      setActivity(/** @type {import('./triplog-constants.js').Activity} */ (v));
    }
  });

  refreshUnitsButton();
  // Render placeholder stats once so the initial labels match the saved unit + activity.
  applyStatsToUi(emptyStats());
  // Clear the cached snapshot so an actual recording later doesn't think
  // these placeholder values are real samples.
  state.lastStats = null;

  btnTripViewClose.addEventListener('click', () => closeTripView());
  btnTripViewDelete.addEventListener('click', () => void deleteCurrentReplayTrip());
  btnTripViewCrop.addEventListener('click', () => enterCropMode());
  btnCropCancel.addEventListener('click', () => exitCropMode());
  btnCropSave.addEventListener('click', () => void saveCrop());
  cropSlider.addEventListener('input', () => renderCropSummary());
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
