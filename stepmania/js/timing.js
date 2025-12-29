// Timing Module - ES Module
// BPM and beat timing calculations

import gameState from './gameState.js';

/**
 * Get the BPM at a specific beat, accounting for BPM changes
 * @param {number} beat - The beat to check
 * @returns {number} BPM at that beat
 */
export function getBPMAtBeat(beat) {
  const bpmChanges = gameState.getBpmChanges();
  const baseBpm = gameState.getBpm();

  if (bpmChanges.length === 0) {
    return baseBpm;
  }

  let currentBPM = baseBpm;
  for (let i = 0; i < bpmChanges.length; i++) {
    if (bpmChanges[i].beat <= beat) {
      currentBPM = bpmChanges[i].bpm;
    } else {
      break;
    }
  }

  return currentBPM;
}

/**
 * Convert seconds to beats, accounting for BPM changes
 * @param {number} seconds - Time in seconds
 * @returns {number} Equivalent beat number
 */
export function secondsToBeats(seconds) {
  const bpmChanges = gameState.getBpmChanges();
  const baseBpm = gameState.getBpm();
  const beatsPerSec = baseBpm / 60;

  if (bpmChanges.length === 0) {
    return seconds * beatsPerSec;
  }

  let currentTime = 0;
  let currentBeat = 0;
  let currentBPM = baseBpm;

  for (let i = 0; i < bpmChanges.length; i++) {
    const bpmChange = bpmChanges[i];
    const nextTime = currentTime + ((bpmChange.beat - currentBeat) / currentBPM) * 60;

    if (seconds <= nextTime) {
      return currentBeat + (seconds - currentTime) * (currentBPM / 60);
    }

    currentTime = nextTime;
    currentBeat = bpmChange.beat;
    currentBPM = bpmChange.bpm;
  }

  return currentBeat + (seconds - currentTime) * (currentBPM / 60);
}

/**
 * Convert beats to seconds, accounting for BPM changes
 * @param {number} beats - The beat number
 * @returns {number} Equivalent time in seconds
 */
export function beatsToSeconds(beats) {
  const bpmChanges = gameState.getBpmChanges();
  const baseBpm = gameState.getBpm();

  if (bpmChanges.length === 0) {
    return (beats / baseBpm) * 60;
  }

  let currentTime = 0;
  let currentBeat = 0;
  let currentBPM = baseBpm;

  for (let i = 0; i < bpmChanges.length; i++) {
    const bpmChange = bpmChanges[i];

    if (beats <= bpmChange.beat) {
      return currentTime + ((beats - currentBeat) / currentBPM) * 60;
    }

    currentTime += ((bpmChange.beat - currentBeat) / currentBPM) * 60;
    currentBeat = bpmChange.beat;
    currentBPM = bpmChange.bpm;
  }

  return currentTime + ((beats - currentBeat) / currentBPM) * 60;
}

/**
 * Get the current music beat from audio time
 * @param {number} musicSec - Current audio time in seconds
 * @returns {number} Current beat
 */
export function getMusicBeat(musicSec) {
  const offset = gameState.getMusicOffset();
  return secondsToBeats(musicSec + offset);
}
