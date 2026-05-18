/**
 * Geolocation tracker for the Trip Log app.
 *
 * Wraps `navigator.geolocation.watchPosition`, filters out the obvious
 * GPS junk (huge accuracy, teleport jumps), accumulates distance with
 * Haversine, and keeps the screen on with the Wake Lock API while a
 * trip is recording.
 *
 * Public surface is one `createTracker()` factory that exposes:
 *
 *   • `start({ tripId })` — begin a recording.
 *   • `stop()`            — end it; final stats are returned.
 *   • Subscribers (`onPoint`, `onStats`, `onError`) get the live stream.
 *
 * Note: nothing here talks to Sheets. The caller wires `onPoint` to
 * the point buffer and `onStats` to the live counters.
 */

const EARTH_RADIUS_M = 6_371_000;

/** Drop fixes wider than this radius — usually wifi/IP fallback. */
const MAX_GOOD_ACCURACY_M = 50;

/**
 * Drop a sample if the implied speed from the previous point is faster
 * than this. Catches GPS jumps without rejecting actual driving.
 * (≈ 360 km/h)
 */
const MAX_PLAUSIBLE_SPEED_M_S = 100;

/**
 * Don't accumulate distance for sub-meter wiggle. Tuned for walking:
 * at a 1.4 m/s pace with 1 Hz samples each segment is roughly 1.4 m,
 * so the threshold needs to sit well under that or we discard real
 * footsteps. 0.5 m still filters typical stationary jitter (a phone
 * sitting on a table drifts ~0.1–0.3 m between fixes).
 */
const MIN_MOVEMENT_M = 0.5;

/**
 * @typedef {object} TrackPoint
 * @property {string} tripId
 * @property {number} t           — epoch ms
 * @property {number} lat
 * @property {number} lon
 * @property {number} accuracy
 * @property {number | null} altitude
 * @property {number | null} speed   — m/s, from device when available
 * @property {number | null} heading — degrees, from device when available
 */

/**
 * @typedef {object} TrackerStats
 * @property {number} distanceMeters
 * @property {number} durationSec
 * @property {number} pointCount
 * @property {number | null} currentSpeedMs
 * @property {number} averageSpeedMs   — based on (distance / duration)
 * @property {number | null} accuracyM — accuracy of the last accepted fix
 */

/**
 * @typedef {object} TrackerCallbacks
 * @property {(p: TrackPoint, stats: TrackerStats) => void} [onPoint]
 * @property {(stats: TrackerStats) => void} [onStats]   — fired every tick (~1s) even without new fixes
 * @property {(err: GeolocationPositionError | Error) => void} [onError]
 */

/**
 * Distance between two lat/lon pairs in meters (great-circle, Haversine).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * @param {TrackerCallbacks} callbacks
 */
export function createTracker(callbacks = {}) {
  /** @type {number | null} */
  let watchId = null;
  /** @type {WakeLockSentinel | null} */
  let wakeLock = null;
  /** @type {number | null} */
  let tickHandle = null;
  /** @type {string | null} */
  let tripId = null;
  let startedAtMs = 0;
  /** @type {TrackPoint | null} */
  let lastAccepted = null;
  /** @type {TrackerStats} */
  let stats = freshStats();

  function freshStats() {
    return /** @type {TrackerStats} */ ({
      distanceMeters: 0,
      durationSec: 0,
      pointCount: 0,
      currentSpeedMs: null,
      averageSpeedMs: 0,
      accuracyM: null
    });
  }

  function emitStats() {
    if (startedAtMs > 0) {
      stats.durationSec = Math.max(0, (Date.now() - startedAtMs) / 1000);
      stats.averageSpeedMs = stats.durationSec > 0 ? stats.distanceMeters / stats.durationSec : 0;
    }
    callbacks.onStats?.({ ...stats });
  }

  /** @param {GeolocationPosition} pos */
  function handlePosition(pos) {
    if (!tripId) {
      return;
    }
    const { latitude, longitude, accuracy, altitude, speed, heading } = pos.coords;

    if (typeof accuracy !== 'number' || accuracy > MAX_GOOD_ACCURACY_M) {
      // Still surface it as a stat update so the UI can show "waiting for
      // GPS" with a live accuracy radius if it wants.
      stats.accuracyM = typeof accuracy === 'number' ? accuracy : null;
      emitStats();
      return;
    }

    const point = /** @type {TrackPoint} */ ({
      tripId,
      t: pos.timestamp || Date.now(),
      lat: latitude,
      lon: longitude,
      accuracy,
      altitude: typeof altitude === 'number' ? altitude : null,
      speed: typeof speed === 'number' ? speed : null,
      heading: typeof heading === 'number' ? heading : null
    });

    if (lastAccepted) {
      const dt = Math.max(0.001, (point.t - lastAccepted.t) / 1000);
      const d = haversineMeters(lastAccepted.lat, lastAccepted.lon, point.lat, point.lon);
      const implied = d / dt;
      if (implied > MAX_PLAUSIBLE_SPEED_M_S) {
        // Looks like a GPS jump — drop the sample entirely.
        stats.accuracyM = accuracy;
        emitStats();
        return;
      }
      if (d >= MIN_MOVEMENT_M) {
        stats.distanceMeters += d;
        lastAccepted = point;
      } else {
        // Sub-threshold movement: keep the same anchor so slow walking
        // (or anything where each tick is tiny) accumulates once the
        // cumulative move crosses the threshold. If we advanced the
        // anchor here we'd lose `d` meters every single sample, and a
        // long walk would round down to a couple of meters. The point
        // itself is still real GPS data, so the polyline + buffer
        // still see it below.
      }
    } else {
      lastAccepted = point;
    }

    stats.pointCount += 1;
    stats.currentSpeedMs = typeof speed === 'number' && speed >= 0 ? speed : null;
    stats.accuracyM = accuracy;

    emitStats();
    callbacks.onPoint?.(point, { ...stats });
  }

  /** @param {GeolocationPositionError} err */
  function handleError(err) {
    callbacks.onError?.(err);
  }

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) {
      return;
    }
    try {
      // @ts-expect-error — wakeLock typings aren't in lib.dom on older TS
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock?.addEventListener?.('release', () => {
        wakeLock = null;
      });
    } catch (e) {
      console.warn('[triplog] wake lock denied', e);
    }
  }

  function releaseWakeLock() {
    try {
      wakeLock?.release?.();
    } catch {
      /* already released */
    }
    wakeLock = null;
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && tripId && !wakeLock) {
      void acquireWakeLock();
    }
  }

  return {
    /** @returns {boolean} */
    get isRecording() {
      return tripId !== null;
    },

    /** @returns {TrackerStats} */
    get stats() {
      return { ...stats };
    },

    /**
     * Begin tracking. Resolves once the browser hands us the watch id;
     * actual GPS fixes arrive asynchronously through `onPoint`.
     * @param {{ tripId: string }} init
     */
    async start(init) {
      if (tripId) {
        throw new Error('Tracker already running.');
      }
      if (!('geolocation' in navigator)) {
        throw new Error('Geolocation API is not available in this browser.');
      }
      tripId = init.tripId;
      startedAtMs = Date.now();
      lastAccepted = null;
      stats = freshStats();

      watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30_000
      });

      await acquireWakeLock();
      document.addEventListener('visibilitychange', handleVisibilityChange);

      // 1Hz tick keeps the duration/avg-speed counters smooth even when
      // GPS goes silent for a few seconds.
      tickHandle = window.setInterval(emitStats, 1000);
      emitStats();
    },

    /**
     * Stop tracking. Returns the final stats snapshot.
     * @returns {TrackerStats & { startedAt: Date, endedAt: Date }}
     */
    stop() {
      if (!tripId) {
        throw new Error('Tracker is not running.');
      }
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (tickHandle !== null) {
        window.clearInterval(tickHandle);
        tickHandle = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();

      const finalStats = {
        ...stats,
        durationSec: Math.max(0, (Date.now() - startedAtMs) / 1000),
        startedAt: new Date(startedAtMs),
        endedAt: new Date()
      };
      finalStats.averageSpeedMs =
        finalStats.durationSec > 0 ? finalStats.distanceMeters / finalStats.durationSec : 0;

      tripId = null;
      startedAtMs = 0;
      lastAccepted = null;
      return finalStats;
    }
  };
}
