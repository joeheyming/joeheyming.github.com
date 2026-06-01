// Hit-detection for play-along mode.
//
// The engine builds a list of "expected" notes (from the parsed chart,
// filtered by hands-active) when the song starts. Each expected note has
// a `hit` flag. When the player triggers a key, judge() looks for the
// nearest unhit expected-note matching the same MIDI pitch within the
// MISS window:
//
//   |inputTime - note.time| <= TIMING_WINDOWS[MISS_INDEX]
//
// The note is classified by `classify(delta)` from judgment-policy and
// marked hit. If no candidate is found, it's a stray press — currently
// ignored (could be turned into a "false note" penalty later).
//
// `sweepMissed(now)` is called by the engine's rAF loop. Any expected
// note whose time is older than `now - MISS_WINDOW` and is still unhit
// is recorded as a miss.

import { TIMING_WINDOWS, MISS_INDEX, classify } from './judgment-policy.js';

const MISS_WINDOW = TIMING_WINDOWS[MISS_INDEX];

/**
 * @typedef {Object} ExpectedNote
 * @property {number} midi
 * @property {number} time
 * @property {boolean} hit       Set true once judged (Hit or Miss).
 * @property {number} judgmentIndex  Set when hit; -1 otherwise.
 */

/**
 * Build the expected-note list from a chart, filtered to active hands.
 * Returned array is sorted by time (the chart already is, but we filter).
 *
 * @param {import('./midi-parser.js').ParsedMidi} chart
 * @param {{ left: boolean, right: boolean }} handsActive
 * @returns {ExpectedNote[]}
 */
export function buildExpectedNotes(chart, handsActive) {
  if (!chart) return [];
  const out = [];
  for (const n of chart.notes) {
    if (n.hand === 'left' && !handsActive.left) continue;
    if (n.hand === 'right' && !handsActive.right) continue;
    out.push({
      midi: n.midi,
      time: n.time,
      hit: false,
      judgmentIndex: -1
    });
  }
  return out;
}

/**
 * Judge a single keypress event.
 *
 * @param {ExpectedNote[]} expected
 * @param {number} midi
 * @param {number} time     Song-seconds when the key went down.
 * @param {{ start: number }} cursor  Mutable index into `expected` —
 *        callers should keep a single cursor that we advance past
 *        already-resolved notes for amortised O(1) per press.
 * @returns {{ index: number, judgment: number, delta: number } | null}
 *          The matched note's index in `expected`, the judgment index
 *          (PERFECT..MISS), and the signed delta. Null if the press
 *          didn't match any unhit note in window.
 */
export function judge(expected, midi, time, cursor) {
  // Advance cursor past notes that are already resolved or are too far
  // in the past to be matchable.
  while (
    cursor.start < expected.length &&
    (expected[cursor.start].hit || expected[cursor.start].time + MISS_WINDOW < time)
  ) {
    cursor.start += 1;
  }

  let bestIdx = -1;
  let bestAbsDelta = Infinity;
  let bestDelta = 0;
  // Scan forward while in window.
  for (let i = cursor.start; i < expected.length; i++) {
    const note = expected[i];
    const delta = time - note.time;
    if (delta < -MISS_WINDOW) break; // future notes, sorted, give up
    if (delta > MISS_WINDOW) continue; // past expired — cursor will catch up
    if (note.hit) continue;
    if (note.midi !== midi) continue;
    const abs = Math.abs(delta);
    if (abs < bestAbsDelta) {
      bestAbsDelta = abs;
      bestIdx = i;
      bestDelta = delta;
    }
  }

  if (bestIdx === -1) return null;

  const judgment = classify(bestDelta);
  if (judgment === MISS_INDEX) {
    // Outside the BAD window but inside MISS window — extremely rare;
    // treat as a miss-on-press.
    expected[bestIdx].hit = true;
    expected[bestIdx].judgmentIndex = MISS_INDEX;
    return { index: bestIdx, judgment: MISS_INDEX, delta: bestDelta };
  }

  expected[bestIdx].hit = true;
  expected[bestIdx].judgmentIndex = judgment;
  return { index: bestIdx, judgment, delta: bestDelta };
}

/**
 * Sweep the expected list once per frame, marking any unhit note whose
 * time has slipped past the MISS window as a miss.
 *
 * @param {ExpectedNote[]} expected
 * @param {number} now           Current song time.
 * @param {{ start: number }} cursor
 * @returns {number[]}           Indices of newly-missed notes.
 */
export function sweepMissed(expected, now, cursor) {
  const newlyMissed = [];
  // Walk from the cursor forward; stop as soon as we find a note that's
  // still in the future window (sorted, so further notes are too).
  let i = cursor.start;
  while (i < expected.length) {
    const note = expected[i];
    if (!note.hit && note.time + MISS_WINDOW < now) {
      note.hit = true;
      note.judgmentIndex = MISS_INDEX;
      newlyMissed.push(i);
    }
    if (note.time > now + MISS_WINDOW) break;
    i += 1;
  }
  return newlyMissed;
}
