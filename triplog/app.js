/**
 * Trip Log — record real-world GPS trips into local browser storage.
 *
 * Storage is IndexedDB (`triplog-db.js`); no sign-in, no network. The
 * app boots by opening the database, populating the trip list, and
 * showing a live map. Recording is a `navigator.geolocation.watchPosition`
 * loop that streams accepted fixes into the points store and keeps the
 * stats panel + polyline live.
 *
 * This file is the orchestrator: it collects DOM references, owns the
 * shared `state` bag, wires the controller factories together, and
 * handles top-level events (Start / Pause / Save / unit toggle). The
 * actual behaviour lives in focused siblings:
 *   - **triplog-format.js**          — pure display helpers
 *   - **triplog-trip-stats.js**      — pure stats math
 *   - **triplog-permission-card.js** — location-permission help panel
 *   - **triplog-trip-view.js**       — replay modal (incl. end-crop)
 *   - **triplog-live-ui.js**         — live stats sidebar + splits + units
 *   - **triplog-recorder.js**        — Start → Pause → Save lifecycle
 *
 * Buffering exists for IDB efficiency (one transaction per flush
 * instead of one per fix), but the flush cadence is small enough that
 * a tab-close mid-recording loses at most a couple of seconds of data.
 */

import { createOSEmbed } from '/os-embed.js';
import {
  ACTIVITY_TUNING,
  TRIP_STATUS,
  loadStoredActivity,
  loadStoredUnit
} from './triplog-constants.js';
import * as format from './triplog-format.js';
import { openTriplogDb } from './triplog-db.js';
import {
  getGeolocationState,
  getPlatform,
  onGeolocationStateChange
} from './triplog-permissions.js';
import { createLiveMap } from './triplog-map.js';
import { createLiveUi } from './triplog-live-ui.js';
import { createPermissionCard } from './triplog-permission-card.js';
import { createRecorder } from './triplog-recorder.js';
import { createTripView } from './triplog-trip-view.js';

const { $, setStatus, formatDistance, formatDuration, formatTripStartedAt } = format;

/** Flush buffered GPS points to IndexedDB at most this often (ms). */
const FLUSH_INTERVAL_MS = 2_000;

/** Update the trip record's stats columns at most this often (ms). */
const TRIP_ROW_UPDATE_MS = 5_000;

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
  /** @type {HTMLElement} */
  const gapBadge = $('gap-badge');
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
  const tvGapBadge = $('trip-view-gap-badge');
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
  /** @type {HTMLButtonElement} */
  const btnTripViewPost = $('btn-trip-view-post');
  /** @type {HTMLInputElement} */
  const tripViewPostMap = $('trip-view-post-map');
  /** @type {HTMLElement} */
  const tripViewPostMapOption = $('trip-view-post-map-option');
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
  const permissionCardEl = $('permission-card');
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
   *   tracker: ReturnType<typeof import('./triplog-tracker.js').createTracker> | null,
   *   buffer: import('./triplog-db.js').PointRecord[],
   *   currentTripId: string | null,
   *   flushHandle: number | null,
   *   tripRowUpdateHandle: number | null,
   *   replayMap: ReturnType<typeof import('./triplog-map.js').createReplayMap> | null,
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
      /** @type {ReturnType<typeof import('./triplog-splits.js').createSplitTracker> | null} */
      km: null,
      /** @type {ReturnType<typeof import('./triplog-splits.js').createSplitTracker> | null} */
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
        meta.className = 'mt-0.5 truncate text-xs text-text-3 tabular-nums';
        const status = trip.status === TRIP_STATUS.RECORDING ? ' • ⏺ recording' : '';
        meta.textContent =
          `${formatTripStartedAt(trip.startedAt)} • ${formatDistance(
            trip.distanceMeters,
            state.unit
          )}` + ` • ${formatDuration(trip.durationSec)}${status}`;
        left.append(title, meta);
        left.addEventListener('click', () => tripView.open(trip));

        li.appendChild(left);
        tripsList.appendChild(li);
      }
    } catch (err) {
      console.error('[triplog] refreshTripsList', err);
      setStatus(statusEl, err instanceof Error ? err.message : String(err), true);
    }
  }

  // ---- Wire up controllers --------------------------------------------------
  // Order matters: tripView is referenced lazily by liveUi.onUnitChange and
  // by refreshTripsList; recorder needs liveUi + permissionCard ready first.

  const permissionCard = createPermissionCard({
    dom: {
      card: permissionCardEl,
      title: permissionTitle,
      body: permissionBody,
      androidLink: permissionAndroidLink,
      retryBtn: permissionRetryBtn,
      dismissBtn: permissionDismissBtn,
      statusEl
    },
    platform,
    getLiveMap: () => state.liveMap
  });

  const tripView = createTripView({
    state,
    dom: {
      tripViewDialog,
      tripViewMap,
      tripViewTitle,
      tripViewSummary,
      tvActivityBadge,
      tvGapBadge,
      tvWhen,
      tvDistance,
      tvDuration,
      tvElapsed,
      tvPace,
      tvPaceLabel,
      tvElevation,
      tvPoints,
      tvElevCard,
      tvElevChart,
      tvElevHover,
      tvPaceCard,
      tvPaceChart,
      tvPaceTitle,
      tvPaceHover,
      tvPaceScaleMin,
      tvPaceScaleMax,
      tvBestsCard,
      tvBestsList,
      tvSplitsCard,
      tvSplitsList,
      tvSplitsUnitLabel,
      tvSplitsSummary,
      btnTripViewCrop,
      btnTripViewDelete,
      btnTripViewPost,
      tripViewPostMap,
      tripViewPostMapOption,
      cropBar,
      cropSlider,
      cropKeepSummary,
      cropTrimSummary,
      btnCropSave,
      btnCropCancel,
      statusEl
    },
    format,
    callbacks: { refreshTripsList }
  });

  const liveUi = createLiveUi({
    state,
    dom: {
      statDistance,
      statDuration,
      statElapsed,
      statSpeed,
      statSpeedLabel,
      statAvgSpeed,
      statAvgSpeedLabel,
      statElevation,
      statAccuracy,
      pausedBadge,
      gapBadge,
      splitsCard,
      splitsList,
      splitsUnitLabel,
      splitsSummary,
      btnUnits,
      btnStart,
      btnPause,
      btnResume,
      btnFinish,
      activitySelect
    },
    format,
    callbacks: { onUnitChange: () => tripView.refreshIfOpen() }
  });

  const recorder = createRecorder({
    state,
    dom: {
      btnStart,
      btnFollow,
      finishDialog,
      finishNameInput,
      finishDistance,
      finishDuration,
      finishPace,
      finishPaceLabel,
      finishElevation,
      finishActivityBadge,
      btnFinishSave,
      btnFinishDiscard,
      btnFinishBack,
      statusEl,
      pausedBadge
    },
    format,
    embed,
    liveUi,
    permissionCard,
    intervals: { flushMs: FLUSH_INTERVAL_MS, tripRowUpdateMs: TRIP_ROW_UPDATE_MS },
    callbacks: { refreshTripsList, ensureLiveMap }
  });

  // ---- service worker + install-time wiring ----------------------------------

  /**
   * Register the Trip Log service worker. The SW exists so Chrome
   * counts the page as a "real" PWA (one of the install heuristics)
   * AND so we have somewhere to host the ongoing recording
   * notification. We deliberately skip registration inside the
   * Heyming OS iframe — the shell page already owns the SW scope at
   * `/`, and registering a nested one creates "scope already in use"
   * errors that don't help anyone.
   */
  async function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    if (window.self !== window.top) {
      return;
    }
    try {
      await navigator.serviceWorker.register('/triplog/sw.js', { scope: '/triplog/' });
    } catch (err) {
      console.warn('[triplog] service worker registration failed', err);
    }
  }

  /**
   * Ask the user for notification permission. Must be called from a
   * user gesture (the Start button) or some browsers — notably iOS
   * Safari — refuse to surface the prompt. Idempotent: a no-op when
   * permission is already decided. The recorder doesn't *block* on
   * the answer; granted permission just lets the keepalive show its
   * ongoing recording notification (which significantly improves
   * background tracking on installed PWAs).
   */
  async function ensureNotificationPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    try {
      await Notification.requestPermission();
    } catch (err) {
      console.warn('[triplog] notification permission request failed', err);
    }
  }

  // ---- init + event wiring --------------------------------------------------

  async function init() {
    setUiVisibility({ ready: false, loading: true, error: false });
    appLoadingMsgEl.textContent = 'Opening local trip database…';
    // Fire-and-forget — we don't want to block the UI on SW boot,
    // and the page is fully usable without one. A failure here just
    // means no offline shell + no ongoing notification.
    void registerServiceWorker();
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
        permissionCard.show('site-blocked');
      }
      onGeolocationStateChange((s) => {
        if (s === 'granted') {
          permissionCard.hide();
        } else if (s === 'denied') {
          permissionCard.show('site-blocked');
        }
      });
    } catch (err) {
      console.error('[triplog] init', err);
      const msg = err instanceof Error ? err.message : String(err);
      appErrorMsgEl.textContent = msg;
      setUiVisibility({ ready: false, loading: false, error: true });
    }
  }

  btnStart.addEventListener('click', () => {
    // Piggy-back on the user gesture to ask for notification
    // permission — iOS Safari ignores requestPermission() outside
    // one, and we want the granted answer in place before the
    // keepalive starts posting recording-status to the SW.
    void ensureNotificationPermission();
    void recorder.start();
  });
  btnPause.addEventListener('click', () => recorder.pause());
  btnResume.addEventListener('click', () => recorder.resume());
  btnFinish.addEventListener('click', () => void recorder.openFinish());

  // The Save button is type="submit" so Enter in the name field also
  // saves. We preventDefault so the dialog doesn't auto-close — we
  // close it explicitly inside recorder.save after the write succeeds.
  finishForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void recorder.save();
  });
  btnFinishDiscard.addEventListener('click', () => void recorder.discard());
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
  btnUnits.addEventListener('click', () => liveUi.toggleUnits());

  liveUi.populateActivitySelect();
  activitySelect.addEventListener('change', () => {
    const v = activitySelect.value;
    if (Object.prototype.hasOwnProperty.call(ACTIVITY_TUNING, v)) {
      liveUi.setActivity(/** @type {import('./triplog-constants.js').Activity} */ (v));
    }
  });

  liveUi.refreshUnitsButton();
  // Render placeholder stats once so the initial labels match the saved unit + activity.
  liveUi.applyStatsToUi(liveUi.emptyStats());
  // Clear the cached snapshot so an actual recording later doesn't think
  // these placeholder values are real samples.
  state.lastStats = null;

  btnTripViewClose.addEventListener('click', () => tripView.close());
  btnTripViewDelete.addEventListener('click', () => void tripView.deleteCurrent());
  btnTripViewCrop.addEventListener('click', () => tripView.enterCrop());
  btnTripViewPost.addEventListener('click', () => void tripView.sharePost());
  btnCropCancel.addEventListener('click', () => tripView.exitCrop());
  btnCropSave.addEventListener('click', () => void tripView.saveCrop());
  cropSlider.addEventListener('input', () => tripView.renderCropSummary());
  tripViewDialog.addEventListener('close', () => tripView.close());

  permissionRetryBtn.addEventListener('click', () => permissionCard.recheck());
  permissionDismissBtn.addEventListener('click', () => permissionCard.hide());

  // Best-effort flush if the user closes the tab mid-recording. The
  // browser kills async work fast on unload, so this is best-effort
  // and the periodic flush is the real safety net.
  window.addEventListener('pagehide', () => {
    void recorder.flushPointBuffer();
  });

  void init();
}

main();
