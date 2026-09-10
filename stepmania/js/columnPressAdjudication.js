// Column-press vs chart resolution (hold head, tap, mine). Mutates note rows and activeHolds like the playfield engine.

import { TIMING_WINDOWS, MISS_TIMING_INDEX, MINE_TIMING_INDEX } from './judgmentPolicy.js';

const NOTHING = { mineHitCount: 0, hit: false, tapNoteScore: 0 };

/**
 * The nearest ungraded note in a column, or null when the press lands in
 * empty space. Port of Player::GetClosestNote.
 *
 * @param {Array<[number, number, Object]>} noteData
 * @param {number} col
 * @param {number} songSeconds
 * @param {(beat: number) => number} beatToSeconds
 * @returns {{note: [number, number, Object], diff: number}|null}
 */
function closestUngradedNote(noteData, col, songSeconds, beatToSeconds) {
  let closest = null;

  for (const note of noteData) {
    if (note[1] != col) continue;
    if ('tapNoteScore' in note[2]) continue;

    const diff = Math.abs(beatToSeconds(note[0]) - songSeconds);
    if (diff >= TIMING_WINDOWS[MISS_TIMING_INDEX]) continue;
    if (!closest || diff < closest.diff) closest = { note, diff };
  }

  return closest;
}

/**
 * Resolve a single column press against the chart at the current moment.
 * Mutates the matched note's property object and `activeHolds` like the legacy engine loop.
 * Does not update gameState, audio, or UI — apply those in the caller when `mineHit` or `hit`.
 *
 * Judgment happens in seconds, not beats: TIMING_WINDOWS are wall-clock
 * windows, so comparing them against a beat distance would silently halve
 * the window every time the chart doubles its BPM.
 *
 * One press resolves one note — the closest. Grading every note inside the
 * miss window lets a single tap swallow the notes behind it in any stream
 * faster than 8ths, scoring them off the timing of the note in front.
 *
 * @param {Object} press
 * @param {number} press.songSeconds - Current position in chart seconds
 * @param {number} press.col
 * @param {Array<[number, number, Object]>} press.noteData
 * @param {Object<number, Object>} press.activeHolds
 * @param {(beat: number) => number} press.beatToSeconds
 * @returns {{ mineHitCount: number, hit: boolean, tapNoteScore: number }}
 */
export function adjudicateColumnPress({ songSeconds, col, noteData, activeHolds, beatToSeconds }) {
  const closest = closestUngradedNote(noteData, col, songSeconds, beatToSeconds);
  if (!closest) return NOTHING;

  const { note, diff } = closest;
  const noteProps = note[2];

  if (noteProps.Type === 'M') {
    if (diff > TIMING_WINDOWS[MINE_TIMING_INDEX]) return NOTHING;
    noteProps.tapNoteScore = 5;
    return { mineHitCount: 1, hit: false, tapNoteScore: 0 };
  }

  const score = TIMING_WINDOWS.findIndex((window) => diff <= window);
  if (score === -1) return NOTHING;

  noteProps.tapNoteScore = score;

  if (noteProps.Type === 2 && noteProps.Duration) {
    activeHolds[col] = {
      note: note,
      startBeat: note[0],
      endBeat: note[0] + noteProps.Duration / 48,
      startTime: songSeconds,
      hitScore: score,
      wasDropped: false,
      lastCheckTime: songSeconds
    };
    return { mineHitCount: 0, hit: false, tapNoteScore: 0 };
  }

  return { mineHitCount: 0, hit: true, tapNoteScore: score };
}
