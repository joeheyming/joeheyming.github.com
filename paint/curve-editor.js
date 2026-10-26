// Curves dialog point editing (PhotoCraft Image > Adjustments > Curves). Pure: points are
// { input, output } in 0..255, kept sorted by input with both end points present. Every helper
// returns a new array, so params that share a point array with an undo snapshot stay intact.

// Pick radius around a control point, in graph levels.
export const CURVE_HIT_RADIUS = 8;
// How far past the graph edge a dragged point has to go before it is removed.
export const CURVE_REMOVE_MARGIN = 12;

const clampLevel = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Graph pixel (x right, y down, size × size) → curve level { input, output }, unclamped. */
export function graphToLevel(x, y, size = 256) {
  const s = (size - 1) / 255;
  return { input: x / s, output: 255 - y / s };
}

/** Curve level → graph pixel. */
export function levelToGraph(point, size = 256) {
  const s = (size - 1) / 255;
  return { x: point.input * s, y: (255 - point.output) * s };
}

/** Whether a level lies far enough outside 0..255 to remove the point being dragged. */
export function isOffGraph(level, margin = CURVE_REMOVE_MARGIN) {
  return (
    level.input < -margin ||
    level.input > 255 + margin ||
    level.output < -margin ||
    level.output > 255 + margin
  );
}

/** Index of the point nearest level within radius, or -1. */
export function hitTestCurve(points, level, radius = CURVE_HIT_RADIUS) {
  let best = -1;
  let bestD = radius * radius;
  points.forEach((p, i) => {
    const d = (p.input - level.input) ** 2 + (p.output - level.output) ** 2;
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/**
 * Add a point at level (clamped to 0..255). A point already at that input takes the new output.
 * Returns { points, index }.
 */
export function insertCurvePoint(points, level) {
  const pt = { input: clampLevel(level.input), output: clampLevel(level.output) };
  const same = points.findIndex((p) => p.input === pt.input);
  if (same >= 0) {
    return { points: points.map((p, i) => (i === same ? pt : p)), index: same };
  }
  let index = points.findIndex((p) => p.input > pt.input);
  if (index < 0) index = points.length;
  return { points: [...points.slice(0, index), pt, ...points.slice(index)], index };
}

/**
 * Move point index to level, clamped to 0..255 and strictly between its neighbours' inputs,
 * so the order never changes.
 */
export function moveCurvePoint(points, index, level) {
  const lo = index > 0 ? points[index - 1].input + 1 : 0;
  const hi = index < points.length - 1 ? points[index + 1].input - 1 : 255;
  const pt = {
    input: Math.max(lo, Math.min(hi, clampLevel(level.input))),
    output: clampLevel(level.output)
  };
  return points.map((p, i) => (i === index ? pt : p));
}

/** Remove point index. The first and last points stay, so a curve keeps both ends. */
export function removeCurvePoint(points, index) {
  if (index <= 0 || index >= points.length - 1) return points;
  return points.filter((_, i) => i !== index);
}

/**
 * Pointer down on the graph: pick the point under level, or insert one there.
 * Returns { points, index } for dragCurvePoint.
 */
export function pickOrInsertCurvePoint(points, level) {
  const hit = hitTestCurve(points, level);
  if (hit >= 0) return { points, index: hit };
  return insertCurvePoint(points, level);
}

/**
 * One drag step, always from the points as they were at pointer down: moves point index to
 * level, or removes it while level is off the graph (dragging back in puts it back).
 */
export function dragCurvePoint(points, index, level) {
  const isEnd = index <= 0 || index >= points.length - 1;
  if (!isEnd && isOffGraph(level)) return removeCurvePoint(points, index);
  return moveCurvePoint(points, index, level);
}
