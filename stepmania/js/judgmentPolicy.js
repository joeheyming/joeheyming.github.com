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
 * Points awarded for each judgment type (tap row; mine uses MINE_HIT).
 *
 * Values mirror StepMania `_fallback` theme's `PercentScoreWeight*`
 * metrics: W1=3, W2=2, W3=1, W4=0, W5=0. Keeping the canonical ratio
 * here means the `actualPoints` number behaves like SM's "DP earned",
 * and the dance-points percent below maxes out at `totalNotes * 3`.
 *
 * Mine hit penalty (-5) is slightly harsher than SM's -2 to discourage
 * spam-tapping on a browser layout where mines are easy to brush.
 */
export const SCORING = {
  PERFECT: 3,
  GREAT: 2,
  GOOD: 1,
  BAD: 0,
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
