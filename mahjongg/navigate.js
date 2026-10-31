/**
 * Arrow targets for the board. Tiles are drawn with a layer lift, so the
 * turtle's cap sits up between the free tiles on either side of it. Searching
 * the slot grid misses that cap: nothing in the grid points at it, and a
 * arrow-key navigation can never land there.
 */

/**
 * @typedef {{
 *   tileW: number,
 *   tileH: number,
 *   liftX: number,
 *   liftY: number,
 *   originX: number,
 *   originY: number
 * }} BoardMetrics
 */

/**
 * @typedef {{ id: number, x: number, y: number }} FocusPoint
 */

/**
 * @param {{ x: number, y: number, z: number }} tile
 * @param {BoardMetrics} metrics
 */
export function tileOffset(tile, metrics) {
  return {
    left: metrics.originX + (tile.x / 2) * metrics.tileW - tile.z * metrics.liftX,
    top: metrics.originY + (tile.y / 2) * metrics.tileH - tile.z * metrics.liftY
  };
}

/**
 * @param {{ id: number, x: number, y: number, z: number }} tile
 * @param {BoardMetrics} metrics
 * @returns {FocusPoint}
 */
export function tileFocusPoint(tile, metrics) {
  const offset = tileOffset(tile, metrics);
  return {
    id: tile.id,
    x: offset.left + metrics.tileW / 2,
    y: offset.top + metrics.tileH / 2
  };
}

/**
 * Nearest point in the direction of (dx, dy). Distance plus an off-axis
 * penalty, so a straight neighbor beats a diagonal when both are candidates.
 *
 * @param {FocusPoint[]} points
 * @param {number} fromId
 * @param {number} dx
 * @param {number} dy
 * @returns {number | null}
 */
export function nearestInDirection(points, fromId, dx, dy) {
  const from = points.find((point) => point.id === fromId);
  if (!from) return null;
  let best = null;
  let bestScore = Infinity;
  for (const point of points) {
    if (point.id === fromId) continue;
    const vx = point.x - from.x;
    const vy = point.y - from.y;
    if (vx * dx + vy * dy <= 0) continue;
    const score = Math.hypot(vx, vy) + Math.abs(vx * dy - vy * dx) * 3;
    if (score < bestScore) {
      bestScore = score;
      best = point.id;
    }
  }
  return best;
}
