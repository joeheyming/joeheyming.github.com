/**
 * Pure stats helpers used by the trip-view replay.
 *
 * `smoothSpeeds` / `computeSegmentSpeeds` feed the coloured polyline
 * and the pace chart; `cumulativeDistances` is shared by pace, best-
 * efforts, and mile-marker computation; `computeMileMarkers` produces
 * the per-unit lat/lon pins; `recomputeStatsFromPoints` re-derives
 * total distance + elevation gain after a crop.
 *
 * Side-effect-free. Takes raw point arrays and returns plain data.
 */

import {
  METERS_PER_KM,
  METERS_PER_MILE,
  UNITS
} from './triplog-constants.js';
import { haversineMeters } from './triplog-tracker.js';

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
export function smoothSpeeds(points, windowSec) {
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
export function computeSegmentSpeeds(points) {
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
export function cumulativeDistances(points) {
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
export function computeMileMarkers(points, unit) {
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
 * Re-derive total distance + elevation gain from a kept slice of
 * points. We use the same Haversine helper and elevation-delta rule
 * the live tracker uses, so cropped stats stay consistent with what
 * the user saw during recording.
 *
 * @param {import('./triplog-db.js').PointRecord[]} points
 */
export function recomputeStatsFromPoints(points) {
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
