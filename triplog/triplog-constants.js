/**
 * Sheet table titles, column layouts, and small helpers shared across the
 * Trip Log app. The site workbook (see `../google-db/site-database.js`) is
 * shared with other apps (e.g. todo), so we prefix our tabs with
 * `triplog-` to keep our data clearly separated.
 */

/** Tab names — one row per trip, one row per GPS sample. */
export const TRIPS_TABLE = 'triplog-trips';
export const POINTS_TABLE = 'triplog-points';

/**
 * Header rows we expect (and write on first run). Order matters: callers
 * use these as the canonical column order when reading/writing rows.
 */
export const TRIPS_HEADER = /** @type {const} */ ([
  'id',
  'name',
  'startedAt',
  'endedAt',
  'durationSec',
  'distanceMeters',
  'pointCount',
  'status'
]);

export const POINTS_HEADER = /** @type {const} */ ([
  'tripId',
  't',
  'lat',
  'lon',
  'accuracy',
  'altitude',
  'speed',
  'heading'
]);

/** A1 ranges for the columns above. */
export const TRIPS_RANGE = `A:${columnLetter(TRIPS_HEADER.length)}`;
export const POINTS_RANGE = `A:${columnLetter(POINTS_HEADER.length)}`;

/** @param {number} count 1-based number of columns. */
export function columnLetter(count) {
  let n = count;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Status values stored in the trips sheet. */
export const TRIP_STATUS = /** @type {const} */ ({
  RECORDING: 'recording',
  COMPLETE: 'complete'
});

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
