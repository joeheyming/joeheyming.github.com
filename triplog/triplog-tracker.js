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
 * @property {boolean} [gap]      — set on a fix that resumes after a long
 *                                  silent gap (browser-tab suspension);
 *                                  the segment from the previous accepted
 *                                  fix to this one is "we don't really
 *                                  know what happened in between."
 */

/**
 * Wall-clock seconds with no accepted fix that we treat as "the browser
 * was suspended" rather than "the user moved very slowly". GPS callbacks
 * normally arrive at roughly 1 Hz, so any quiet stretch much longer than
 * that on a phone strongly implies the tab went into the background.
 */
export const GAP_DETECT_SEC = 30;

/**
 * Minimum displacement between the last accepted fix and the next one
 * for us to credit a gap as "moving" (rather than "the user really did
 * stop moving for a while"). 20 m at any reasonable walking pace is
 * well above GPS noise but small enough to catch a slow walk through
 * the silent period.
 */
const GAP_MOVEMENT_M = 20;

/**
 * Whether the segment between two consecutive points crossed a GPS gap
 * — i.e. the tracker recorded a long silent stretch (typically because
 * Chrome backgrounded the tab on Android). Newer recordings tag the
 * resume point with `gap: true`; older recordings fall back to the raw
 * timestamp delta so they still get the dashed-rendering treatment.
 *
 * @param {{ t: number } | null | undefined} prev
 * @param {{ t: number, gap?: boolean } | null | undefined} next
 */
export function isGapSegment(prev, next) {
  if (!prev || !next) {
    return false;
  }
  if (next.gap === true) {
    return true;
  }
  return (next.t - prev.t) / 1000 >= GAP_DETECT_SEC;
}

/**
 * Smallest absolute altitude change worth counting toward elevation
 * gain. GPS altitude is noisy (often ±5–10m on consumer hardware), so
 * smaller wiggles produce phantom climbs of hundreds of meters on a
 * flat walk. 2 m is a reasonable compromise between filtering noise
 * and still seeing real stairs/hills.
 */
const MIN_ELEVATION_DELTA_M = 2;

/**
 * @typedef {object} TrackerStats
 * @property {number} distanceMeters
 * @property {number} durationSec       — moving time (auto-pause subtracted)
 * @property {number} elapsedSec        — wall-clock time since start
 * @property {number} pointCount
 * @property {number | null} currentSpeedMs
 * @property {number} averageSpeedMs    — distance / movingSec
 * @property {number | null} accuracyM  — accuracy of the last accepted fix
 * @property {number} elevationGainM    — cumulative positive altitude delta
 * @property {boolean} paused           — currently paused (either auto or manual)
 * @property {'auto' | 'manual' | null} pauseReason
 */

/**
 * @typedef {object} TrackerOptions
 * @property {number} [autoPauseSpeedMs] — below this speed, auto-pause kicks in
 * @property {number} [autoPauseSeconds] — how long below the threshold before pausing
 */

/**
 * @typedef {object} TrackerCallbacks
 * @property {(p: TrackPoint, stats: TrackerStats) => void} [onPoint]
 * @property {(stats: TrackerStats) => void} [onStats]   — fired every tick (~1s) even without new fixes
 * @property {(err: GeolocationPositionError | Error) => void} [onError]
 * @property {TrackerOptions} [tuning]
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
  const autoPauseSpeedMs = callbacks.tuning?.autoPauseSpeedMs ?? 0.5;
  const autoPauseSeconds = callbacks.tuning?.autoPauseSeconds ?? 5;

  /** @type {number | null} */
  let watchId = null;
  /** @type {WakeLockSentinel | null} */
  let wakeLock = null;
  /** @type {number | null} */
  let tickHandle = null;
  /** @type {string | null} */
  let tripId = null;
  let startedAtMs = 0;
  /**
   * User-initiated pause flag. While true, GPS fixes are dropped (no
   * distance, no points, no marker movement), the moving-time clock is
   * frozen, and the `paused` stat reports reason `'manual'` regardless
   * of speed. Only `resumeManual()` clears it.
   */
  let manuallyPaused = false;
  /** @type {TrackPoint | null} */
  let lastAccepted = null;
  /** Last altitude that counted toward elevation gain. */
  let lastElevAccepted = /** @type {number | null} */ (null);
  /**
   * Wall-clock timestamp of the previous `emitStats` call. We integrate
   * `now - lastTickMs` into `movingSec` when not paused, which is more
   * accurate than relying on the GPS sample cadence (which can stutter
   * or pause entirely while still backgrounded).
   */
  let lastTickMs = 0;
  /** Wall-clock of last sample whose speed was above the pause threshold. */
  let lastMovingMs = 0;
  let movingSec = 0;
  /** @type {TrackerStats} */
  let stats = freshStats();

  function freshStats() {
    return /** @type {TrackerStats} */ ({
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
   * Decide whether we're currently in an auto-pause window. The rule:
   * if no fix has shown movement above the pause threshold in the last
   * `autoPauseSeconds`, we're paused.
   *
   * @param {number} now epoch ms
   */
  function computePaused(now) {
    if (lastMovingMs === 0) {
      // We've never seen movement (just started). Don't pause yet —
      // we'd just be staring at "PAUSED" while waiting for the first
      // real fix.
      return false;
    }
    return (now - lastMovingMs) / 1000 >= autoPauseSeconds;
  }

  function emitStats() {
    if (startedAtMs > 0) {
      const now = Date.now();
      const elapsed = Math.max(0, (now - startedAtMs) / 1000);
      // Add wall-clock since last tick to movingSec, but only if we
      // weren't paused at the start of that interval. This is what
      // makes pace stable through stop lights — `durationSec` is the
      // *moving* time so "distance / time" matches what runners see
      // on a Garmin.
      const autoPaused = computePaused(now);
      if (lastTickMs > 0 && !stats.paused) {
        movingSec += (now - lastTickMs) / 1000;
      }
      lastTickMs = now;
      // Manual pause always wins over auto. Auto is only meaningful
      // while we're "trying to record" — if the user explicitly hit
      // Pause, we don't care that their speed dropped to zero.
      if (manuallyPaused) {
        stats.paused = true;
        stats.pauseReason = 'manual';
      } else if (autoPaused) {
        stats.paused = true;
        stats.pauseReason = 'auto';
      } else {
        stats.paused = false;
        stats.pauseReason = null;
      }
      stats.elapsedSec = elapsed;
      stats.durationSec = Math.max(0, movingSec);
      stats.averageSpeedMs = stats.durationSec > 0 ? stats.distanceMeters / stats.durationSec : 0;
    }
    callbacks.onStats?.({ ...stats });
  }

  /** @param {GeolocationPosition} pos */
  function handlePosition(pos) {
    if (!tripId) {
      return;
    }
    if (manuallyPaused) {
      // User explicitly paused — drop the fix entirely so the polyline,
      // distance, and points buffer all freeze where they were. Still
      // emit a stats tick so the UI's "Paused" badge stays alive even
      // if no `setInterval` ticks land between fixes.
      emitStats();
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

    /** Implied speed of the segment ending at this point, m/s. null if there's no prior anchor. */
    let segmentSpeedMs = /** @type {number | null} */ (null);

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
      // Gap recovery. When the tab was suspended (Chrome on Android
      // backgrounds aggressively the moment the screen locks) the 1 Hz
      // tick has been silent and `lastMovingMs` is stale, so emitStats
      // has been declaring auto-pause and discarding moving time. If
      // the next accepted fix is far from the previous anchor we have
      // direct evidence the user kept moving through the silent
      // window, so credit the wall-clock as moving time and tag the
      // point so the polyline can render the segment as "we don't
      // really know the path here."
      if (dt >= GAP_DETECT_SEC && d >= GAP_MOVEMENT_M) {
        movingSec += dt;
        lastTickMs = point.t;
        lastMovingMs = point.t;
        point.gap = true;
      }
      segmentSpeedMs = implied;
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

    if (typeof altitude === 'number' && Number.isFinite(altitude)) {
      if (lastElevAccepted === null) {
        lastElevAccepted = altitude;
      } else {
        const dAlt = altitude - lastElevAccepted;
        if (Math.abs(dAlt) >= MIN_ELEVATION_DELTA_M) {
          if (dAlt > 0) {
            stats.elevationGainM += dAlt;
          }
          lastElevAccepted = altitude;
        }
      }
    }

    stats.pointCount += 1;
    stats.currentSpeedMs = typeof speed === 'number' && speed >= 0 ? speed : null;
    stats.accuracyM = accuracy;

    // Mark "movement" for auto-pause. Prefer the device's reported
    // speed (the GPS chip uses doppler hints we can't replicate); fall
    // back to the segment's implied speed; if we have neither (first
    // fix), don't make a decision yet.
    const movementSpeed =
      typeof speed === 'number' && Number.isFinite(speed) && speed >= 0 ? speed : segmentSpeedMs;
    if (movementSpeed !== null && movementSpeed >= autoPauseSpeedMs) {
      lastMovingMs = point.t;
    }

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
      manuallyPaused = false;
      lastAccepted = null;
      lastElevAccepted = null;
      lastTickMs = 0;
      lastMovingMs = 0;
      movingSec = 0;
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

      // Final accumulate of any not-yet-ticked moving time so the
      // saved durationSec matches what the user saw last on screen.
      const now = Date.now();
      if (lastTickMs > 0 && !stats.paused) {
        movingSec += (now - lastTickMs) / 1000;
      }
      const elapsed = Math.max(0, (now - startedAtMs) / 1000);
      const finalStats = {
        ...stats,
        durationSec: Math.max(0, movingSec),
        elapsedSec: elapsed,
        paused: false,
        startedAt: new Date(startedAtMs),
        endedAt: new Date()
      };
      finalStats.averageSpeedMs =
        finalStats.durationSec > 0 ? finalStats.distanceMeters / finalStats.durationSec : 0;

      tripId = null;
      startedAtMs = 0;
      manuallyPaused = false;
      lastAccepted = null;
      lastElevAccepted = null;
      lastTickMs = 0;
      lastMovingMs = 0;
      movingSec = 0;
      return finalStats;
    },

    /**
     * Pause the recording at the user's request. While paused, no new
     * GPS fixes are recorded (no distance, no points, no marker move),
     * and the moving-time clock is frozen. The Wake Lock stays held so
     * the screen doesn't sleep — they'll want it on to hit Resume.
     */
    pauseManual() {
      if (!tripId || manuallyPaused) {
        return;
      }
      // Flush the in-progress moving-time slice into the counter so we
      // get an accurate freeze point before flipping the flag.
      const now = Date.now();
      if (lastTickMs > 0 && !stats.paused) {
        movingSec += (now - lastTickMs) / 1000;
      }
      lastTickMs = now;
      manuallyPaused = true;
      emitStats();
    },

    /**
     * Resume after a manual pause. We deliberately reset the anchor
     * point and the auto-pause "last moving" timestamp: otherwise the
     * straight-line distance between the pause point and wherever the
     * user resumed (could be meters away) would attribute to the trip,
     * and the auto-pause heuristic would think we'd been sitting still
     * for the whole break.
     */
    resumeManual() {
      if (!tripId || !manuallyPaused) {
        return;
      }
      manuallyPaused = false;
      lastAccepted = null;
      // Start the pause-detection window fresh so we don't immediately
      // re-enter auto-pause just because the user is gathering speed.
      lastMovingMs = Date.now();
      lastTickMs = Date.now();
      emitStats();
    },

    /** @returns {boolean} */
    get isManuallyPaused() {
      return manuallyPaused;
    }
  };
}
