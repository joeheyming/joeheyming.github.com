/**
 * Chart loader: turns a song JSON into a flat event list ready for the
 * lane engine.
 *
 * Input shape (see `songs/thats-amore.json` for a worked example):
 *
 *   {
 *     title, artist, bpm, timeSig: [3, 4], key,
 *     pattern: "oom-pah-pah" | "march" | ...,
 *     progression: [{ bars, chord, voicing? }, ...]
 *   }
 *
 * Output shape:
 *
 *   {
 *     meta: { title, artist, bpm, timeSig, key },
 *     events: [
 *       {
 *         beat: number,           // absolute beat from song start (in quarter-notes)
 *         chordBeatId: number,    // groups simultaneous events into one chord beat
 *         lane: { row, pc },      // 'bass' | 'major' | 'minor' | 'dom7' | 'dim7'
 *         targetChord: { rootPc, kind }, // for the chord-judge
 *         label: string,          // chord-name label used in UI
 *         isSuggested: true
 *       },
 *       ...
 *     ],
 *     totalBeats: number
 *   }
 */

import { buildChord, parseChordName } from '../play/accordion/stradella-chords.js';

// `holdBeats` is the suggested sustain duration of the event in beats.
// The renderer draws a vertical "tail" of this length above the note
// head, turning each beat into a hold-note that feels less staccato
// than a bare tap. A real Stradella bass thump is short (~⅓ beat) while
// the chord buttons ring out under the pah, so chord ticks get a much
// longer hold than bass ticks. Audio sustain follows the player's
// release naturally — the visual tail just nudges them to hold through
// it.
const PATTERNS = {
  // 3/4 oom-pah-pah: bass on 1, chord on 2 and 3.
  // The classic Italian-waltz feel — sways. Used for "That's Amore", etc.
  'oom-pah-pah': [
    { tickBeat: 0, type: 'bass', holdBeats: 0.35 },
    { tickBeat: 1, type: 'chord', holdBeats: 0.9 },
    { tickBeat: 2, type: 'chord', holdBeats: 0.9 }
  ],
  // 3/4 waltz-march: bass + chord together on every beat.
  'waltz-march': [
    { tickBeat: 0, type: 'both', holdBeats: 0.6 },
    { tickBeat: 1, type: 'both', holdBeats: 0.6 },
    { tickBeat: 2, type: 'both', holdBeats: 0.6 }
  ],
  // 3/4 ballad: bass on beat 1, chord on beat 2, beat 3 silent.
  // Chord rings through beats 2 and 3 (≈ 1.8 beats) for the laid-back feel.
  'ballad-3': [
    { tickBeat: 0, type: 'bass', holdBeats: 0.35 },
    { tickBeat: 1, type: 'chord', holdBeats: 1.8 }
  ],
  // 4/4 boom-chick: bass on 1 and 3, chord on 2 and 4.
  'boom-chick': [
    { tickBeat: 0, type: 'bass', holdBeats: 0.35 },
    { tickBeat: 1, type: 'chord', holdBeats: 0.85 },
    { tickBeat: 2, type: 'bass', holdBeats: 0.35 },
    { tickBeat: 3, type: 'chord', holdBeats: 0.85 }
  ],
  // 4/4 simple march: bass + chord together on every beat.
  march: [
    { tickBeat: 0, type: 'both', holdBeats: 0.55 },
    { tickBeat: 1, type: 'both', holdBeats: 0.55 },
    { tickBeat: 2, type: 'both', holdBeats: 0.55 },
    { tickBeat: 3, type: 'both', holdBeats: 0.55 }
  ]
};

// Bass thumps ("oom" beats) are always short and percussive regardless
// of what holdBeats the tick declares — keeps real-Stradella feel where
// the bass is staccato while the chord sustains.
const BASS_STACCATO_HOLD = 0.35;

export function loadChart(song) {
  if (!song || !Array.isArray(song.progression)) {
    throw new Error('Song has no progression');
  }
  const timeSig = song.timeSig || [4, 4];
  const beatsPerBar = timeSig[0];
  const patternName = song.pattern || (beatsPerBar === 3 ? 'oom-pah-pah' : 'march');
  const pattern = PATTERNS[patternName];
  if (!pattern) throw new Error(`Unknown pattern: ${patternName}`);

  const events = [];
  let chordBeatId = 0;
  let bar = 0;

  for (const entry of song.progression) {
    const bars = entry.bars ?? 1;
    const built = buildChord(entry.chord, { voicing: entry.voicing });
    if (!built) {
      throw new Error(`Could not parse chord: ${entry.chord}`);
    }

    for (let b = 0; b < bars; b++) {
      const barStartBeat = bar * beatsPerBar;
      for (const tick of pattern) {
        if (tick.tickBeat >= beatsPerBar) continue;
        const beat = barStartBeat + tick.tickBeat;
        const wantsBass = tick.type === 'bass' || tick.type === 'both';
        const wantsChord = tick.type === 'chord' || tick.type === 'both';
        const tickHold = tick.holdBeats ?? 0.5;
        // Chord-row notes (and any extra bass that comes with the
        // chord-button press) ring out for the tick's full holdBeats.
        // Dedicated bass notes — the "oom" — always stay staccato.
        const chordHold = tickHold;
        const bassHold = BASS_STACCATO_HOLD;
        const beatEvents = [];

        if (wantsBass) {
          beatEvents.push({
            beat,
            chordBeatId,
            holdBeats: bassHold,
            lane: { row: 'bass', pc: built.targetChord.rootPc },
            targetChord: built.targetChord,
            label: built.label,
            isSuggested: true
          });
        }
        if (wantsChord) {
          beatEvents.push({
            beat,
            chordBeatId,
            holdBeats: chordHold,
            lane: { row: built.chordButton.row, pc: built.chordButton.pc },
            targetChord: built.targetChord,
            label: built.label,
            isSuggested: true
          });
          for (const extra of built.extraBass) {
            beatEvents.push({
              beat,
              chordBeatId,
              // Alternating bass that comes with a chord-button press
              // sustains alongside the chord, not as a separate thump.
              holdBeats: chordHold,
              lane: { row: 'bass', pc: extra.pc },
              targetChord: built.targetChord,
              label: built.label,
              isSuggested: true
            });
          }
        }

        if (beatEvents.length > 0) {
          events.push(...beatEvents);
          chordBeatId += 1;
        }
      }
      bar += 1;
    }
  }

  const totalBeats = bar * beatsPerBar;

  return {
    meta: {
      title: song.title || 'Untitled',
      artist: song.artist || '',
      bpm: song.bpm || 100,
      timeSig,
      key: song.key || 'C'
    },
    events,
    totalBeats
  };
}

export { parseChordName };
