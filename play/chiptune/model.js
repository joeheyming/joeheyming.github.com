/**
 * Chiptune song model — patterns, channels, arrangement.
 */

export const WAVEFORMS = [
  { id: 'square', label: 'Square' },
  { id: 'pulse25', label: 'Pulse 25%' },
  { id: 'pulse50', label: 'Pulse 50%' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'saw', label: 'Saw' },
  { id: 'noise', label: 'Noise' }
];

export const CHANNEL_COUNT = 6;
/** Sixteenth-note steps per bar (4/4). */
export const STEPS_PER_BAR = 16;
export const DEFAULT_BARS = 2;
export const MIN_BARS = 1;
export const MAX_BARS = 16;
export const DEFAULT_STEPS = DEFAULT_BARS * STEPS_PER_BAR;
export const MAX_STEPS = MAX_BARS * STEPS_PER_BAR;
export const PITCH_MIN = 36; // C2
export const PITCH_MAX = 84; // C6
export const PITCH_COUNT = PITCH_MAX - PITCH_MIN + 1;

/**
 * @typedef {{ p: number, s: number, l: number }} Note
 * @typedef {{
 *   wave: string,
 *   volume: number,
 *   attack: number,
 *   release: number,
 *   mute: boolean,
 *   solo: boolean
 * }} Channel
 * @typedef {{ name: string, tracks: Note[][] }} Pattern
 * @typedef {{
 *   v: number,
 *   tempo: number,
 *   steps: number,
 *   activePattern: number,
 *   activeChannel: number,
 *   channels: Channel[],
 *   patterns: Pattern[],
 *   arrangement: number[]
 * }} Song
 */

/** @returns {Channel} */
export function createChannel(wave = 'square') {
  return {
    wave,
    volume: 0.65,
    attack: 0.01,
    release: 0.06,
    mute: false,
    solo: false
  };
}

/** @param {number} steps @param {number} channels */
export function createEmptyTracks(steps, channels = CHANNEL_COUNT) {
  void steps;
  return Array.from({ length: channels }, () => /** @type {Note[]} */ ([]));
}

/** @param {string} name @param {number} [steps] */
export function createPattern(name = 'A', steps = DEFAULT_STEPS) {
  return {
    name,
    tracks: createEmptyTracks(steps)
  };
}

/** @returns {Song} */
export function createSong() {
  const defaults = ['square', 'pulse25', 'triangle', 'saw', 'noise', 'square'];
  return {
    v: 1,
    tempo: 120,
    steps: DEFAULT_STEPS,
    activePattern: 0,
    activeChannel: 0,
    channels: defaults.map((wave) => createChannel(wave)),
    patterns: [createPattern('A'), createPattern('B')],
    arrangement: [0]
  };
}

/** @param {Song} song */
export function activePattern(song) {
  return song.patterns[song.activePattern] || song.patterns[0];
}

/** @param {Song} song */
export function activeTrack(song) {
  const pat = activePattern(song);
  return pat.tracks[song.activeChannel] || pat.tracks[0];
}

/**
 * @param {Note[]} notes
 * @param {number} pitch
 * @param {number} start
 * @param {number} length
 */
export function findNoteAt(notes, pitch, start) {
  return notes.find((n) => n.p === pitch && start >= n.s && start < n.s + n.l) || null;
}

/**
 * @param {Note[]} notes
 * @param {number} pitch
 * @param {number} start
 * @param {number} length
 * @param {number} maxSteps
 */
export function paintNote(notes, pitch, start, length, maxSteps) {
  const s = Math.max(0, Math.min(maxSteps - 1, start));
  const l = Math.max(1, Math.min(maxSteps - s, length));
  const existing = findNoteAt(notes, pitch, s);
  if (existing) {
    const idx = notes.indexOf(existing);
    notes.splice(idx, 1);
    return { action: 'erase', note: existing };
  }
  // Remove overlaps on same pitch
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.p !== pitch) continue;
    if (n.s < s + l && s < n.s + n.l) notes.splice(i, 1);
  }
  const note = { p: pitch, s, l };
  notes.push(note);
  notes.sort((a, b) => a.s - b.s || a.p - b.p);
  return { action: 'paint', note };
}

/**
 * Extend or create note while dragging length.
 * @param {Note[]} notes
 * @param {number} pitch
 * @param {number} start
 * @param {number} endStep
 * @param {number} maxSteps
 */
export function setNoteSpan(notes, pitch, start, endStep, maxSteps) {
  const s0 = Math.max(0, Math.min(maxSteps - 1, Math.min(start, endStep)));
  const s1 = Math.max(0, Math.min(maxSteps - 1, Math.max(start, endStep)));
  const l = Math.max(1, s1 - s0 + 1);
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.p !== pitch) continue;
    if (n.s < s0 + l && s0 < n.s + n.l) notes.splice(i, 1);
  }
  const note = { p: pitch, s: s0, l };
  notes.push(note);
  notes.sort((a, b) => a.s - b.s || a.p - b.p);
  return note;
}

/** @param {Song} song */
export function anySolo(song) {
  return song.channels.some((c) => c.solo);
}

/** @param {Song} song @param {number} channelIndex */
export function channelAudible(song, channelIndex) {
  const ch = song.channels[channelIndex];
  if (!ch || ch.mute) return false;
  if (anySolo(song) && !ch.solo) return false;
  return true;
}

const PATTERN_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** @param {Song} song */
export function addPattern(song) {
  const name =
    PATTERN_NAMES[song.patterns.length % PATTERN_NAMES.length] || `P${song.patterns.length + 1}`;
  song.patterns.push(createPattern(name, song.steps));
  song.activePattern = song.patterns.length - 1;
  return song.activePattern;
}

/** @param {Song} song @param {number} patternIndex */
export function appendArrangement(song, patternIndex) {
  const idx = Math.max(0, Math.min(song.patterns.length - 1, patternIndex));
  song.arrangement.push(idx);
}

/** @param {Song} song */
export function barsOf(song) {
  return Math.max(MIN_BARS, Math.round(song.steps / STEPS_PER_BAR) || DEFAULT_BARS);
}

/**
 * Resize the pattern length by bar count. Notes past the new end are trimmed.
 * @param {Song} song
 * @param {number} bars
 */
export function setBars(song, bars) {
  const next = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(bars) || DEFAULT_BARS));
  const steps = next * STEPS_PER_BAR;
  if (steps === song.steps) return song.steps;
  song.steps = steps;
  for (const pat of song.patterns) {
    for (const track of pat.tracks) {
      for (let i = track.length - 1; i >= 0; i--) {
        const n = track[i];
        if (n.s >= steps) {
          track.splice(i, 1);
          continue;
        }
        if (n.s + n.l > steps) n.l = steps - n.s;
      }
    }
  }
  return song.steps;
}

/** @param {Song} song */
export function addBar(song) {
  return setBars(song, barsOf(song) + 1);
}

/** @param {Song} song */
export function removeBar(song) {
  return setBars(song, barsOf(song) - 1);
}

/** @param {Song} song */
export function cloneSong(song) {
  return structuredClone(song);
}
