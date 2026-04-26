// Column-press vs chart resolution (hold head, tap, mine). Mutates note rows and activeHolds like the playfield engine.

import { TIMING_WINDOWS, MISS_TIMING_INDEX } from './judgmentPolicy.js';

/**
 * Resolve a single column press against the chart at the current beat.
 * Mutates `noteData` note property objects and `activeHolds` like the legacy engine loop.
 * Does not update gameState, audio, or UI — apply those in the caller when `mineHit` or `hit`.
 *
 * @param {number} songBeats
 * @param {number} col
 * @param {Array<[number, number, Object]>} noteData
 * @param {Object<number, Object>} activeHolds
 * @param {number} songSeconds - stored on new hold entries as startTime
 * @returns {{ mineHitCount: number, hit: boolean, tapNoteScore: number }}
 */
export function adjudicateColumnPress(songBeats, col, noteData, activeHolds, songSeconds) {
  let mineHitCount = 0;
  let hit = false;
  let tapNoteScore = 0;

  noteData.forEach(function (note) {
    const noteBeat = note[0];
    const noteCol = note[1];
    const noteProps = note[2];
    const diff = Math.abs(noteBeat - songBeats);

    if ('tapNoteScore' in noteProps) return;
    if (noteCol != col) return;
    if (diff >= TIMING_WINDOWS[MISS_TIMING_INDEX]) return;

    if (noteProps.Type === 'M') {
      noteProps.tapNoteScore = 5;
      mineHitCount++;
      return;
    }

    if (noteProps.Type === 2 && noteProps.Duration) {
      for (let j = 0; j < TIMING_WINDOWS.length; j++) {
        if (diff <= TIMING_WINDOWS[j]) {
          noteProps.tapNoteScore = j;
          activeHolds[col] = {
            note: note,
            startBeat: noteBeat,
            endBeat: noteBeat + noteProps.Duration / 48,
            startTime: songSeconds,
            hitScore: j,
            wasDropped: false,
            lastCheckTime: songSeconds
          };
          hit = false;
          break;
        }
      }
    } else {
      for (let j = 0; j < TIMING_WINDOWS.length; j++) {
        if (diff <= TIMING_WINDOWS[j]) {
          noteProps.tapNoteScore = j;
          tapNoteScore = j;
          hit = true;
          break;
        }
      }
    }
  });

  return { mineHitCount, hit, tapNoteScore };
}
