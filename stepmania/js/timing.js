// Timing Module - ES Module
// Beat/second conversions for the loaded chart.
//
// The math lives in timingData.js (a port of StepMania's TimingData); this
// module is the thin binding to whichever chart gameState currently holds.
//
// Two clocks to keep straight:
//   - chart seconds: beat 0 is at 0. What secondsToBeats/beatsToSeconds use.
//   - music seconds: `audio.currentTime`. Converted with getMusicBeat /
//     getMusicSeconds, which apply the simfile's #OFFSET.

import gameState from './gameState.js';
import {
  getBeatFromElapsedTime,
  getElapsedTimeFromBeat,
  getBpmAtBeat,
  isJudgableAtBeat
} from './timingData.js';

/**
 * Get the BPM at a specific beat, accounting for BPM changes
 * @param {number} beat - The beat to check
 * @returns {number} BPM at that beat
 */
export function getBPMAtBeat(beat) {
  return getBpmAtBeat(gameState.getTiming(), beat);
}

/**
 * Convert chart seconds to beats, accounting for BPM changes, freezes, and warps
 * @param {number} seconds - Time in chart seconds
 * @returns {number} Equivalent beat number
 */
export function secondsToBeats(seconds) {
  return getBeatFromElapsedTime(gameState.getTiming(), seconds).beat;
}

/**
 * Convert beats to chart seconds, accounting for BPM changes, freezes, and warps
 * @param {number} beats - The beat number
 * @returns {number} Equivalent time in chart seconds
 */
export function beatsToSeconds(beats) {
  return getElapsedTimeFromBeat(gameState.getTiming(), beats);
}

/**
 * Whether the chart is paused on a freeze at this moment
 * @param {number} seconds - Time in chart seconds
 * @returns {boolean}
 */
export function isFrozenAt(seconds) {
  const result = getBeatFromElapsedTime(gameState.getTiming(), seconds);
  return result.freeze || result.delay;
}

/**
 * Whether a note at this beat can be hit. Notes inside a warp are skipped by
 * the song, so they never reach the receptors.
 * @param {number} beat
 * @returns {boolean}
 */
export function isJudgable(beat) {
  return isJudgableAtBeat(gameState.getTiming(), beat);
}

/**
 * Get the current music beat from audio time
 * @param {number} musicSec - Current audio time in seconds
 * @returns {number} Current beat
 */
export function getMusicBeat(musicSec) {
  return secondsToBeats(musicSec + gameState.getMusicOffset());
}

/**
 * Get the audio time at which a beat is heard
 * @param {number} beat
 * @returns {number} Time in audio seconds
 */
export function getMusicSeconds(beat) {
  return beatsToSeconds(beat) - gameState.getMusicOffset();
}
