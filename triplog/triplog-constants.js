/**
 * Small constants and helpers shared between modules in the Trip Log app.
 */

/** Status values stored on each trip record. */
export const TRIP_STATUS = /** @type {const} */ ({
  RECORDING: 'recording',
  COMPLETE: 'complete'
});

/** Units the user can pick for the stats display. */
export const UNITS = /** @type {const} */ ({
  METRIC: 'metric',
  IMPERIAL: 'imperial'
});

/** @typedef {'metric' | 'imperial'} Unit */

const LS_UNITS = 'triplog.units';

/**
 * @returns {Unit}
 */
export function loadStoredUnit() {
  try {
    const raw = localStorage.getItem(LS_UNITS);
    if (raw === UNITS.IMPERIAL) {
      return UNITS.IMPERIAL;
    }
  } catch {
    /* private mode / disabled storage */
  }
  return UNITS.METRIC;
}

/** @param {Unit} unit */
export function saveStoredUnit(unit) {
  try {
    localStorage.setItem(LS_UNITS, unit);
  } catch {
    /* private mode / quota */
  }
}

/** Conversions used by both the UI and the splits/pace math. */
export const METERS_PER_KM = 1000;
export const METERS_PER_MILE = 1609.344;
export const METERS_PER_FOOT = 0.3048;

/**
 * Activity kinds. Picked before the trip starts; influences auto-pause
 * thresholds and whether the stats card shows pace (foot-powered) or
 * speed (everything else) by default.
 */
export const ACTIVITIES = /** @type {const} */ ({
  RUN: 'run',
  WALK: 'walk',
  HIKE: 'hike',
  BIKE: 'bike',
  SKI_ALPINE: 'ski_alpine',
  SKI_NORDIC: 'ski_nordic',
  SKATE: 'skate',
  SKATEBOARD: 'skateboard',
  DRIVE: 'drive',
  BOAT: 'boat',
  OTHER: 'other'
});

/** @typedef {(typeof ACTIVITIES)[keyof typeof ACTIVITIES]} Activity */

/**
 * Per-activity tuning knobs — see `ACTIVITY_TUNING` below.
 *
 * @typedef {object} ActivityTuning
 * @property {number} autoPauseSpeedMs threshold below which auto-pause arms
 * @property {number} autoPauseSeconds dwell time below threshold before pausing
 * @property {boolean} prefersPace whether to show pace instead of speed in UIs
 * @property {string} label human label, e.g. "Run"
 * @property {string} emoji single-glyph emoji used in badges
 */

/**
 * Per-activity tuning. `autoPauseSpeedMs` is the upper bound on "this
 * person has effectively stopped" — once the current speed sits below
 * it for `autoPauseSeconds` straight, we freeze the duration counter
 * so red lights, water breaks, and chair-lift queues don't crater
 * your average pace. Resume happens immediately once a fix lands
 * above the threshold; the asymmetry is intentional (we'd rather wake
 * from pause too eagerly than too lazily).
 *
 * Tuning notes:
 *  - Foot-powered (run/walk/hike/nordic): pace, low pause threshold.
 *  - Bike/skate/skateboard: speed, slightly higher threshold (a
 *    coasting bike at 0.5 m/s isn't paused, it's just slow).
 *  - Alpine ski: long pauses at the lift; bump the window to 30s so
 *    a ride up doesn't get cut up into a hundred tiny segments.
 *  - Drive: huge pause window — red lights and gas stops both matter.
 *  - Boat (kayak/paddleboard): low threshold, paddle strokes are
 *    intermittent.
 *  - Other: friendly defaults that won't be wildly wrong for anything.
 *
 * @type {Record<Activity, { autoPauseSpeedMs: number, autoPauseSeconds: number, prefersPace: boolean, label: string, emoji: string }>}
 */
export const ACTIVITY_TUNING = {
  run: {
    autoPauseSpeedMs: 0.5,
    autoPauseSeconds: 5,
    prefersPace: true,
    label: 'Run',
    emoji: '🏃'
  },
  walk: {
    autoPauseSpeedMs: 0.2,
    autoPauseSeconds: 8,
    prefersPace: true,
    label: 'Walk',
    emoji: '🚶'
  },
  hike: {
    autoPauseSpeedMs: 0.2,
    autoPauseSeconds: 10,
    prefersPace: true,
    label: 'Hike',
    emoji: '🥾'
  },
  bike: {
    autoPauseSpeedMs: 1.0,
    autoPauseSeconds: 5,
    prefersPace: false,
    label: 'Bike',
    emoji: '🚴'
  },
  ski_alpine: {
    autoPauseSpeedMs: 1.0,
    autoPauseSeconds: 30,
    prefersPace: false,
    label: 'Skiing',
    emoji: '⛷️'
  },
  ski_nordic: {
    autoPauseSpeedMs: 0.5,
    autoPauseSeconds: 10,
    prefersPace: true,
    label: 'Nordic ski',
    emoji: '🎿'
  },
  skate: {
    autoPauseSpeedMs: 0.5,
    autoPauseSeconds: 5,
    prefersPace: false,
    label: 'Skate',
    emoji: '🛼'
  },
  skateboard: {
    autoPauseSpeedMs: 0.5,
    autoPauseSeconds: 5,
    prefersPace: false,
    label: 'Skateboard',
    emoji: '🛹'
  },
  drive: {
    autoPauseSpeedMs: 1.0,
    autoPauseSeconds: 60,
    prefersPace: false,
    label: 'Drive',
    emoji: '🚗'
  },
  boat: {
    autoPauseSpeedMs: 0.3,
    autoPauseSeconds: 15,
    prefersPace: false,
    label: 'Paddle',
    emoji: '🛶'
  },
  other: {
    autoPauseSpeedMs: 0.3,
    autoPauseSeconds: 10,
    prefersPace: false,
    label: 'Other',
    emoji: '📍'
  }
};

const LS_ACTIVITY = 'triplog.activity';

/** @returns {Activity} */
export function loadStoredActivity() {
  try {
    const raw = localStorage.getItem(LS_ACTIVITY);
    if (raw && Object.prototype.hasOwnProperty.call(ACTIVITY_TUNING, raw)) {
      return /** @type {Activity} */ (raw);
    }
  } catch {
    /* private mode / disabled storage */
  }
  return ACTIVITIES.RUN;
}

/** @param {Activity} activity */
export function saveStoredActivity(activity) {
  try {
    localStorage.setItem(LS_ACTIVITY, activity);
  } catch {
    /* private mode / quota */
  }
}

/**
 * UUID generator that survives insecure contexts.
 *
 * `crypto.randomUUID()` is the obvious choice but it's gated to secure
 * contexts (HTTPS or `localhost`), so it's literally not a function on
 * `http://192.168.x.x:8000`. `crypto.getRandomValues()` IS available
 * even on insecure origins, so we use it to spin a v4 UUID by hand;
 * `Math.random()` is the last-resort path for ancient browsers.
 *
 * @returns {string}
 */
export function randomUuid() {
  const c = /** @type {Crypto | undefined} */ (globalThis.crypto);
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Per RFC 4122 §4.4: set the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
    `${hex[4]}${hex[5]}-` +
    `${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-` +
    `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  );
}

/**
 * Friendly default trip name in the spirit of Strava: "Morning Run",
 * "Evening Bike", etc. We intentionally don't bake the date in — the
 * trip card already shows the start timestamp, and a name like
 * "Morning Run" plus that timestamp reads as "Morning Run · Apr 12,
 * 7:14 AM" which is much nicer than "Trip Apr 12 7:14 AM".
 *
 * Buckets are local-clock:
 *   4 – 12 → Morning
 *   12 – 17 → Afternoon
 *   17 – 21 → Evening
 *   else    → Night
 *
 * @param {Date} [now]
 * @param {Activity} [activity]
 */
export function defaultTripName(now = new Date(), activity = ACTIVITIES.RUN) {
  const h = now.getHours();
  const bucket =
    h >= 4 && h < 12
      ? 'Morning'
      : h >= 12 && h < 17
      ? 'Afternoon'
      : h >= 17 && h < 21
      ? 'Evening'
      : 'Night';
  const tuning = ACTIVITY_TUNING[activity] ?? ACTIVITY_TUNING.run;
  return `${bucket} ${tuning.label}`;
}
