/**
 * Pure display helpers for Trip Log.
 *
 * Distance / duration / speed / pace / elevation formatters that
 * respect the user-selected unit, plus tiny shared utilities
 * (`$`, `setStatus`) that the orchestrator and the controller
 * factories all consume.
 *
 * Everything in this file is intentionally side-effect-free except
 * `setStatus`, which writes to a passed-in element. No `state` and
 * no module-level DOM refs — each function takes what it needs.
 */

import {
  ACTIVITY_TUNING,
  METERS_PER_FOOT,
  METERS_PER_KM,
  METERS_PER_MILE,
  UNITS
} from './triplog-constants.js';

const STATUS_BASE = 'min-w-0 flex-1 break-words text-right empty:hidden text-xs sm:text-sm';

/** @param {HTMLElement} el */
export function setStatus(el, text, isError = false) {
  el.textContent = typeof text === 'string' ? text.trim() : String(text);
  el.className = isError ? `${STATUS_BASE} text-danger` : `${STATUS_BASE} text-text-3`;
}

/** @template T @param {string} id @returns {T} */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id} in DOM`);
  }
  return /** @type {T} */ (/** @type {unknown} */ (el));
}

/**
 * @param {number} m
 * @param {import('./triplog-constants.js').Unit} [unit]
 */
export function formatDistance(m, unit = UNITS.METRIC) {
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
export function formatDuration(sec) {
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
export function formatSpeed(ms, unit = UNITS.METRIC) {
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
export function formatAccuracy(m, unit = UNITS.METRIC) {
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
export function formatPace(ms, unit) {
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
export function formatElevation(m, unit = UNITS.METRIC) {
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
export function formatSplitTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) {
    return '0:00';
  }
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** @param {string} iso */
export function formatTripStartedAt(iso) {
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

/**
 * Privacy-conscious markdown summary for Posts. Aggregate stats only —
 * never include lat/lon, polyline, map images, or other location
 * identifiers from the GPS track.
 *
 * @param {import('./triplog-db.js').TripRecord} trip
 * @param {import('./triplog-constants.js').Unit} [unit]
 */
export function formatTripShareMarkdown(trip, unit = UNITS.METRIC) {
  const activityKey =
    trip.activity && Object.prototype.hasOwnProperty.call(ACTIVITY_TUNING, trip.activity)
      ? /** @type {import('./triplog-constants.js').Activity} */ (trip.activity)
      : 'other';
  const tuning = ACTIVITY_TUNING[activityKey];
  const name = trip.name || 'Untitled trip';
  const when = formatTripStartedAt(trip.startedAt);
  const avgMs = trip.durationSec > 0 ? trip.distanceMeters / trip.durationSec : 0;
  const lines = [
    `## ${name}`,
    '',
    `${tuning.emoji} ${tuning.label} · ${when}`,
    '',
    `- **Distance:** ${formatDistance(trip.distanceMeters, unit)}`,
    `- **Moving time:** ${formatDuration(trip.durationSec)}`,
    `- **Elapsed:** ${formatDuration(trip.elapsedSec ?? trip.durationSec)}`
  ];
  if (tuning.prefersPace) {
    lines.push(`- **Avg pace:** ${formatPace(avgMs, unit)}`);
  } else {
    lines.push(`- **Avg speed:** ${formatSpeed(avgMs, unit)}`);
  }
  lines.push(
    `- **Elevation gain:** ${formatElevation(trip.elevationGainM ?? 0, unit)}`,
    '',
    'Made with [Trip Log](https://joeheyming.github.io/triplog/).'
  );
  return lines.join('\n');
}
