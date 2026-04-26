// Shared tap judgment timing and score weights — single source for engine, HUD, and tests

/**
 * Timing windows for note judgments (seconds). Index 0 = tightest (perfect), last = miss window.
 */
export const JUDGMENT_TIMING_SECONDS = {
  PERFECT: 0.05,
  GREAT: 0.1,
  GOOD: 0.15,
  BAD: 0.25,
  MISS: 0.3
};

/** Ordered windows for iteration (perfect → miss threshold) */
export const TIMING_WINDOWS = [
  JUDGMENT_TIMING_SECONDS.PERFECT,
  JUDGMENT_TIMING_SECONDS.GREAT,
  JUDGMENT_TIMING_SECONDS.GOOD,
  JUDGMENT_TIMING_SECONDS.BAD,
  JUDGMENT_TIMING_SECONDS.MISS
];

/** Index of the miss bucket in TIMING_WINDOWS */
export const MISS_TIMING_INDEX = TIMING_WINDOWS.length - 1;

/**
 * Points awarded for each judgment type (tap row; mine uses MINE_HIT)
 */
export const SCORING = {
  PERFECT: 3,
  GREAT: 3,
  GOOD: 2,
  BAD: 1,
  MISS: 0,
  MINE_HIT: -5
};

/** Point deltas per tap judgment index (matches TIMING_WINDOWS order; last entry is mine penalty) */
export const TAP_NOTE_POINTS = [
  SCORING.PERFECT,
  SCORING.GREAT,
  SCORING.GOOD,
  SCORING.BAD,
  SCORING.MISS,
  SCORING.MINE_HIT
];
