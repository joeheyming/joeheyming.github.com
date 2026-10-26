// Gradient Map stops (PhotoCraft crates/ui-egui/src/adjust_editors.rs Gradient Map editor). Params
// hold params.stops: [location 0..1 rounded to 0.001, '#rrggbb'] sorted by location. Every helper
// returns a new array, so params that share a stops array with an undo snapshot stay intact.

// PhotoCraft's cap on stops in one gradient.
export const MAX_GRADIENT_STOPS = 64;

// read_stops' fallback for fewer than two stops. Frozen: edits always build a new array.
export const DEFAULT_GRADIENT_STOPS = Object.freeze([
  Object.freeze([0, '#000000']),
  Object.freeze([1, '#ffffff'])
]);

const roundLocation = (t) => Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000;

/** '#rrggbb' → [r, g, b] 0..1; anything else is black (PhotoCraft rgb_of's default). */
export function hexToUnit(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

/** [r, g, b] 0..1 → '#rrggbb' (PhotoCraft adjust_params::hex). */
export function unitToHex(c) {
  const b = (v) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return '#' + c.map(b).join('');
}

// PhotoCraft adjust.rs gradient(): stops are [position 0..1, [r, g, b] 0..1] sorted by position.
// No stops gives grey t, one stop its colour; outside the end stops the end colour holds.
export function gradientMapColor(stops, t) {
  if (stops.length === 0) return [t, t, t];
  if (stops.length === 1 || t <= stops[0][0]) return stops[0][1].slice();
  for (let s = 1; s < stops.length; s++) {
    const [p0, c0] = stops[s - 1];
    const [p1, c1] = stops[s];
    if (t <= p1) {
      const k = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
      return [0, 1, 2].map((i) => c0[i] + (c1[i] - c0[i]) * k);
    }
  }
  return stops[stops.length - 1][1].slice();
}

/**
 * PhotoCraft read_stops + write_stops: keep [number, color] entries, clamp and round locations,
 * lower-case the hex, and sort (stable) by location. Fewer than two stops is black → white.
 */
export function normalizeStops(raw) {
  const stops = (Array.isArray(raw) ? raw : [])
    .filter((s) => Array.isArray(s) && typeof s[0] === 'number' && Number.isFinite(s[0]))
    .map((s) => [roundLocation(s[0]), unitToHex(hexToUnit(s[1]))]);
  if (stops.length < 2) return DEFAULT_GRADIENT_STOPS.map((s) => s.slice());
  return stops.sort((a, b) => a[0] - b[0]);
}

/**
 * The stops a Gradient Map's params describe: params.stops when present, else a legacy
 * startColor / endColor pair (older .paintproj files and adjustment layers), else black → white.
 */
export function gradientMapStops(params = {}) {
  if (Array.isArray(params.stops)) return normalizeStops(params.stops);
  if (params.startColor != null || params.endColor != null) {
    return normalizeStops([
      [0, params.startColor ?? '#000000'],
      [1, params.endColor ?? '#ffffff']
    ]);
  }
  return normalizeStops(DEFAULT_GRADIENT_STOPS);
}

/** Hex stops → gradientMapColor's [t, [r, g, b]] stops, sorted. */
export function unitStops(stops) {
  return stops.map(([t, c]) => [t, hexToUnit(c)]).sort((a, b) => a[0] - b[0]);
}

/** PhotoCraft sample_stops: the gradient's [r, g, b] 0..1 at t. */
export function sampleStops(stops, t) {
  return gradientMapColor(unitStops(stops), t);
}

/**
 * PhotoCraft move_map_stop: move stop index to location (clamped, rounded to 0.001) and re-sort.
 * The returned index follows the same stop, even past another stop at the same location.
 */
export function moveMapStop(stops, index, location) {
  if (!stops[index]) return { stops, index };
  const at = roundLocation(location);
  const rank = stops.filter(
    (s, i) => i !== index && (s[0] < at || (s[0] === at && i < index))
  ).length;
  const moved = stops.map((s, i) => (i === index ? [at, s[1]] : s));
  return { stops: moved.sort((a, b) => a[0] - b[0]), index: rank };
}

/** Add a stop at location in the gradient's colour there and select it; null at the cap. */
export function addStopAt(stops, location) {
  if (stops.length >= MAX_GRADIENT_STOPS) return null;
  const at = roundLocation(location);
  const added = [...stops, [at, unitToHex(sampleStops(stops, at))]];
  return moveMapStop(added, added.length - 1, at);
}

/** PhotoCraft's Add Stop: halfway along the widest gap (the last one on a tie). */
export function addStopInWidestGap(stops) {
  const sorted = stops.map((s) => s[0]).sort((a, b) => a - b);
  let at = 0.5;
  let widest = -Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap >= widest) {
      widest = gap;
      at = (sorted[i - 1] + sorted[i]) / 2;
    }
  }
  return addStopAt(stops, at);
}

/** Remove stop index; a gradient keeps at least two stops. */
export function removeStop(stops, index) {
  if (stops.length <= 2 || !stops[index]) return { stops, index };
  const left = stops.filter((_, i) => i !== index);
  return { stops: left, index: Math.min(index, left.length - 1) };
}

/** Recolor stop index with '#rrggbb'. */
export function setStopColor(stops, index, hex) {
  return stops.map((s, i) => (i === index ? [s[0], unitToHex(hexToUnit(hex))] : s));
}
