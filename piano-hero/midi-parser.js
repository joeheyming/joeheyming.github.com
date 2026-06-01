// Thin wrapper around @tonejs/midi. Turns a Standard MIDI File ArrayBuffer
// into a flat, time-sorted list of note events suitable for the falling-
// notes renderer and the play-along judgment engine.
//
// We don't preserve the full MIDI track structure — only the bits the
// game needs:
//   - title (from the MIDI file header, falls back to caller-supplied label)
//   - durationSec
//   - notes[]: { midi, time, duration, velocity, hand, trackIdx }
//
// "Hand" is one of 'left' | 'right'. Heuristic:
//   - 1 track: every note is "right".
//   - 2 tracks: the track with the lower mean MIDI is "left".
//   - 3+ tracks: per-track mean < 60 → "left", else "right".
// A real Synthesia would honour MIDI Channel 16 hand-marker conventions
// or look at the MIDI File Type-1 track ordering, but the mean-pitch
// heuristic gives the right answer on essentially every two-handed
// piano arrangement we tested.

import { Midi } from '@tonejs/midi';

/**
 * @typedef {Object} HeroNote
 * @property {number} midi      0..127
 * @property {number} time      Seconds from the start of the song.
 * @property {number} duration  Seconds.
 * @property {number} velocity  0..1
 * @property {'left'|'right'} hand
 * @property {number} trackIdx  Index of the source track in the parsed MIDI.
 */

/**
 * @typedef {Object} ParsedMidi
 * @property {string} title
 * @property {number} durationSec
 * @property {HeroNote[]} notes      Sorted by time, then midi.
 * @property {number} trackCount
 * @property {number[]} leftHandTracks   Indices of tracks classified as "left".
 * @property {number[]} rightHandTracks  Indices of tracks classified as "right".
 */

/**
 * Parse a MIDI file ArrayBuffer.
 *
 * @param {ArrayBuffer} buf
 * @param {{ fallbackTitle?: string }} [opts]
 * @returns {ParsedMidi}
 * @throws {Error} If the buffer is not a valid MIDI file or contains no notes.
 */
export function parseMidi(buf, opts = {}) {
  const midi = new Midi(buf);

  const noteyTracks = midi.tracks
    .map((t, idx) => ({ track: t, idx, notes: t.notes }))
    .filter((t) => t.notes && t.notes.length > 0);

  if (noteyTracks.length === 0) {
    throw new Error('MIDI file contains no notes');
  }

  // Mean pitch per note-bearing track, used to decide hand assignment.
  const trackMeans = noteyTracks.map((t) => {
    const sum = t.notes.reduce((s, n) => s + n.midi, 0);
    return { idx: t.idx, mean: sum / t.notes.length, noteCount: t.notes.length };
  });

  const handForTrack = assignHands(trackMeans);

  const notes = [];
  let durationSec = 0;
  for (const t of noteyTracks) {
    const hand = handForTrack.get(t.idx) || 'right';
    for (const n of t.notes) {
      const note = {
        midi: n.midi,
        time: n.time,
        duration: Math.max(n.duration, 0.05), // never collapse to zero
        velocity: typeof n.velocity === 'number' ? n.velocity : 0.8,
        hand,
        trackIdx: t.idx
      };
      notes.push(note);
      const end = note.time + note.duration;
      if (end > durationSec) durationSec = end;
    }
  }

  notes.sort((a, b) => (a.time === b.time ? a.midi - b.midi : a.time - b.time));

  const leftHandTracks = [];
  const rightHandTracks = [];
  for (const [idx, hand] of handForTrack.entries()) {
    if (hand === 'left') leftHandTracks.push(idx);
    else rightHandTracks.push(idx);
  }

  const title =
    (midi.header && midi.header.name && midi.header.name.trim()) ||
    opts.fallbackTitle ||
    'Untitled MIDI';

  return {
    title,
    durationSec,
    notes,
    trackCount: midi.tracks.length,
    leftHandTracks,
    rightHandTracks
  };
}

/**
 * Decide which hand each note-bearing track belongs to based on mean pitch.
 *
 * @param {{idx:number, mean:number, noteCount:number}[]} trackMeans
 * @returns {Map<number, 'left'|'right'>}
 */
function assignHands(trackMeans) {
  const out = new Map();
  if (trackMeans.length === 0) return out;

  if (trackMeans.length === 1) {
    out.set(trackMeans[0].idx, 'right');
    return out;
  }

  if (trackMeans.length === 2) {
    // Lower-mean track = left hand.
    const sorted = [...trackMeans].sort((a, b) => a.mean - b.mean);
    out.set(sorted[0].idx, 'left');
    out.set(sorted[1].idx, 'right');
    return out;
  }

  // 3+ tracks: per-track mean < middle-C (MIDI 60) is left, else right.
  // Middle-C is the conventional Synthesia-style cutoff between the bass
  // and treble staves on a two-staff piano arrangement.
  for (const t of trackMeans) {
    out.set(t.idx, t.mean < 60 ? 'left' : 'right');
  }
  return out;
}
