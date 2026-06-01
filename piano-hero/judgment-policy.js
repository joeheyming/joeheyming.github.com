// Pure judgment policy — single source of truth shared by engine, score
// panel, and any future tests. Mirrors stepmania/js/judgmentPolicy.js so
// the rhythm-game numbers stay legible.
//
// Timing windows are in **seconds** — the engine and judgment.js work in
// audio-context time, not beats, because we generate audio note-by-note
// and have no fixed BPM.

export const JUDGMENT_INDEX = {
  PERFECT: 0,
  GREAT: 1,
  GOOD: 2,
  BAD: 3,
  MISS: 4
};

export const JUDGMENT_LABELS = ['Perfect', 'Great', 'Good', 'Bad', 'Miss'];

/** Tightest → widest. Each entry is the *outer* edge of that window. */
export const TIMING_WINDOWS = [
  0.05, // PERFECT: ±50 ms
  0.1, // GREAT:   ±100 ms
  0.15, // GOOD:    ±150 ms
  0.25, // BAD:     ±250 ms
  0.3 // MISS threshold: outside this, the note expires unmatched
];

/** Index of the miss bucket in TIMING_WINDOWS. */
export const MISS_INDEX = JUDGMENT_INDEX.MISS;

/** Per-judgment point reward (parallel to TIMING_WINDOWS). */
export const TAP_NOTE_POINTS = [3, 3, 2, 1, 0];

/** Object form for callers that prefer named lookups. */
export const SCORING = {
  PERFECT: TAP_NOTE_POINTS[JUDGMENT_INDEX.PERFECT],
  GREAT: TAP_NOTE_POINTS[JUDGMENT_INDEX.GREAT],
  GOOD: TAP_NOTE_POINTS[JUDGMENT_INDEX.GOOD],
  BAD: TAP_NOTE_POINTS[JUDGMENT_INDEX.BAD],
  MISS: TAP_NOTE_POINTS[JUDGMENT_INDEX.MISS]
};

/**
 * Classify a delta-from-expected (in seconds, can be negative for "early")
 * into a judgment index.
 *
 * @param {number} deltaSec  Signed seconds: positive = late, negative = early.
 * @returns {number} Index into JUDGMENT_LABELS, or MISS_INDEX if outside the
 *                   miss window.
 */
export function classify(deltaSec) {
  const abs = Math.abs(deltaSec);
  for (let i = 0; i < TIMING_WINDOWS.length; i++) {
    if (abs <= TIMING_WINDOWS[i]) return i;
  }
  return MISS_INDEX;
}
