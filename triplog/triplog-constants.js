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
 * Default trip name when the user doesn't provide one. Uses the device's
 * locale so users see something familiar.
 * @param {Date} [now]
 */
export function defaultTripName(now = new Date()) {
  const date = now.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const time = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  return `Trip ${date} ${time}`;
}
