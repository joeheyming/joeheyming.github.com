/**
 * Per-unit "splits" — the per-km (or per-mile) breakdown runners and
 * cyclists expect to see next to total time.
 *
 * A `SplitTracker` consumes a stream of `(cumulativeDistanceMeters,
 * movingTimeSec)` updates and emits a finalized split each time the
 * cumulative distance crosses a unit boundary. The current in-progress
 * split is also exposed so the UI can render it greyed out next to the
 * completed ones (Strava-style).
 *
 * The implementation interpolates linearly between the previous and
 * current sample at the boundary crossing — so a single 2km jump
 * (which would happen if GPS sampling lagged) still produces two
 * completed splits with sensible per-split times instead of attributing
 * the entire 2km to one split.
 *
 * Two trackers are run in parallel (km and mile) so the user can flip
 * the units toggle mid-trip without losing data. Each tracker is
 * cheap (O(1) per update, O(N splits) memory) so doubling up is fine.
 *
 * @typedef {{
 *   index: number,
 *   distanceMeters: number,    // size of this split (usually exactly the unit length)
 *   timeSec: number,           // moving time spent inside this split
 *   cumulativeDistanceMeters: number,
 *   cumulativeTimeSec: number,
 *   paceSecPerMeter: number    // average pace inside this split
 * }} Split
 *
 * @typedef {{
 *   completed: Split[],
 *   inProgress: {
 *     index: number,
 *     distanceMeters: number,
 *     timeSec: number,
 *     paceSecPerMeter: number
 *   } | null
 * }} SplitSnapshot
 */

/**
 * @param {number} unitMeters length of one split (e.g. 1000 for km, 1609.344 for mi)
 */
export function createSplitTracker(unitMeters) {
  if (!Number.isFinite(unitMeters) || unitMeters <= 0) {
    throw new Error('SplitTracker requires a positive unitMeters');
  }

  /** @type {Split[]} */
  const completed = [];
  /** Cumulative state at the previous update — used to interpolate boundary crossings. */
  let prevDistance = 0;
  let prevTime = 0;
  /** Cumulative state at the start of the current in-progress split. */
  let splitStartDistance = 0;
  let splitStartTime = 0;

  return {
    /**
     * Feed the latest cumulative distance + moving time. Returns the
     * splits that newly completed in this update (usually 0 or 1, but
     * could be many if GPS skipped ahead).
     *
     * @param {number} cumulativeDistanceMeters
     * @param {number} cumulativeMovingSec
     * @returns {Split[]} newly-completed splits since the last call
     */
    update(cumulativeDistanceMeters, cumulativeMovingSec) {
      if (
        !Number.isFinite(cumulativeDistanceMeters) ||
        !Number.isFinite(cumulativeMovingSec) ||
        cumulativeDistanceMeters < prevDistance
      ) {
        // Bad input — distance went backwards (shouldn't happen). Skip
        // rather than corrupting the splits.
        return [];
      }

      /** @type {Split[]} */
      const newlyCompleted = [];
      const segmentDistance = cumulativeDistanceMeters - prevDistance;
      const segmentTime = Math.max(0, cumulativeMovingSec - prevTime);

      while (true) {
        const nextBoundary = (completed.length + 1) * unitMeters;
        if (cumulativeDistanceMeters < nextBoundary) {
          break;
        }
        // Where in *this* update interval did we cross the boundary?
        // Linear interpolation: fraction of the segment needed to
        // reach the boundary.
        const remaining = nextBoundary - prevDistance;
        const frac = segmentDistance > 0 ? remaining / segmentDistance : 1;
        const crossingTime = prevTime + segmentTime * frac;
        const splitDistance = nextBoundary - splitStartDistance;
        const splitTime = Math.max(0, crossingTime - splitStartTime);
        const split = /** @type {Split} */ ({
          index: completed.length + 1,
          distanceMeters: splitDistance,
          timeSec: splitTime,
          cumulativeDistanceMeters: nextBoundary,
          cumulativeTimeSec: crossingTime,
          paceSecPerMeter: splitDistance > 0 ? splitTime / splitDistance : 0
        });
        completed.push(split);
        newlyCompleted.push(split);
        // The next split starts exactly at the boundary we just crossed.
        splitStartDistance = nextBoundary;
        splitStartTime = crossingTime;
      }

      prevDistance = cumulativeDistanceMeters;
      prevTime = cumulativeMovingSec;
      return newlyCompleted;
    },

    /** @returns {SplitSnapshot} */
    snapshot() {
      const inProgressDistance = Math.max(0, prevDistance - splitStartDistance);
      const inProgressTime = Math.max(0, prevTime - splitStartTime);
      /** @type {SplitSnapshot['inProgress']} */
      const inProgress =
        inProgressDistance > 0 || inProgressTime > 0
          ? {
              index: completed.length + 1,
              distanceMeters: inProgressDistance,
              timeSec: inProgressTime,
              paceSecPerMeter: inProgressDistance > 0 ? inProgressTime / inProgressDistance : 0
            }
          : null;
      return { completed: completed.slice(), inProgress };
    },

    reset() {
      completed.length = 0;
      prevDistance = 0;
      prevTime = 0;
      splitStartDistance = 0;
      splitStartTime = 0;
    }
  };
}
