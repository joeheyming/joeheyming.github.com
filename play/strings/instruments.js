/**
 * Catalog of fretted string instruments rendered by the Strings page.
 *
 * Each entry pins the tuning (high pitch first to match the visual stack
 * with high strings on top), fret count, inlay positions, default +
 * selectable sounds, and any per-instrument quirks.
 *
 * `tuning[i].midi` is the open-string pitch — the note that sounds when
 * the leftmost playable cell is plucked. `startFret` defaults to 0 but
 * can be set higher (banjo's 5th drone string starts at fret 5; cells
 * before it render as unavailable).
 *
 * `paired: true` instruments (mandolin) render two thin lines per row
 * and fire a short 2-attack tremolo on each pluck.
 *
 * `chords: true` instruments expose the chord builder. Currently
 * guitar-only because the curated chord voicings live in `chords.js`
 * and assume EADGBE shapes.
 */
export const INSTRUMENTS = {
  guitar: {
    id: 'guitar',
    name: 'Guitar',
    emoji: '🎸',
    tuning: [
      { name: 'E', midi: 64, thickness: 1.4 }, // 1 - high E
      { name: 'B', midi: 59, thickness: 1.6 }, // 2 - B
      { name: 'G', midi: 55, thickness: 1.8 }, // 3 - G
      { name: 'D', midi: 50, thickness: 2.2 }, // 4 - D
      { name: 'A', midi: 45, thickness: 2.6 }, // 5 - A
      { name: 'E', midi: 40, thickness: 3.0 } // 6 - low E
    ],
    fretCount: 19,
    singleDots: [3, 5, 7, 9, 15, 17],
    doubleDots: [12],
    helpStrings: 'E A D G B E (low to high)',
    defaultTone: 'acoustic_guitar_samples',
    tones: [
      { value: 'acoustic_guitar_samples', label: 'Acoustic (samples)' },
      { value: 'electric_guitar_samples', label: 'Electric clean (samples)' },
      { value: 'acoustic_guitar_steel', label: 'Acoustic steel (soundfont)' },
      { value: 'acoustic_guitar_nylon', label: 'Classical nylon (soundfont)' },
      { value: 'electric_guitar_clean', label: 'Electric clean (soundfont)' },
      { value: 'electric_guitar_jazz', label: 'Electric jazz (soundfont)' },
      { value: 'overdriven_guitar', label: 'Overdriven (soundfont)' }
    ],
    chords: true
  },
  bass: {
    id: 'bass',
    name: 'Bass',
    emoji: '🎸',
    // Standard 4-string EADG tuned an octave below guitar's lowest 4
    // strings. Frets are wider on a real bass; we just give it a longer
    // neck (21 frets) so jazz-bass-style upper register is reachable.
    tuning: [
      { name: 'G', midi: 43, thickness: 2.4 }, // G2
      { name: 'D', midi: 38, thickness: 2.8 }, // D2
      { name: 'A', midi: 33, thickness: 3.4 }, // A1
      { name: 'E', midi: 28, thickness: 4.0 } // E1
    ],
    fretCount: 21,
    singleDots: [3, 5, 7, 9, 15, 17, 19, 21],
    doubleDots: [12],
    helpStrings: 'E A D G (low to high) — one octave below guitar',
    defaultTone: 'electric_bass_finger',
    tones: [
      { value: 'electric_bass_finger', label: 'Bass (finger)' },
      { value: 'electric_bass_pick', label: 'Bass (pick)' },
      { value: 'fretless_bass', label: 'Fretless bass' },
      { value: 'slap_bass_1', label: 'Slap bass' },
      { value: 'acoustic_bass', label: 'Upright bass' }
    ],
    chords: false
  },
  ukulele: {
    id: 'ukulele',
    name: 'Ukulele',
    emoji: '🎸',
    // Standard high-G GCEA. The 4th string (G) is RE-ENTRANT — it sits
    // higher in pitch than the 3rd string (C). We display in playing-
    // position order (high pitches on top) but the re-entrant G ends up
    // at the bottom because it's the "4th string" by convention even
    // though it's pitched between E4 and A4.
    tuning: [
      { name: 'A', midi: 69, thickness: 1.2 }, // A4
      { name: 'E', midi: 64, thickness: 1.4 }, // E4
      { name: 'C', midi: 60, thickness: 1.6 }, // C4 (lowest string)
      { name: 'G', midi: 67, thickness: 1.2 } // G4 (re-entrant; higher than C)
    ],
    fretCount: 15,
    singleDots: [5, 7, 10, 12],
    doubleDots: [],
    helpStrings: 'G C E A — high-G re-entrant tuning (G is higher than C)',
    defaultTone: 'acoustic_guitar_nylon',
    tones: [
      { value: 'acoustic_guitar_nylon', label: 'Nylon strings' },
      { value: 'acoustic_guitar_steel', label: 'Steel strings' }
    ],
    chords: true
  },
  banjo: {
    id: 'banjo',
    name: 'Banjo',
    emoji: '🪕',
    // 5-string open G: gDGBD. The 5th string (high g) is short — it's a
    // drone string that physically attaches at the 5th fret peg. We
    // model that with `startFret: 5`: the open pitch (midi 67) only
    // sounds at fret 5, and frets 0-4 on that row render as unavailable.
    // Visual order follows banjo convention with the 5th drone at the
    // bottom even though it's the highest pitch.
    tuning: [
      { name: 'D', midi: 62, thickness: 1.2 }, // D4 - 1st
      { name: 'B', midi: 59, thickness: 1.4 }, // B3 - 2nd
      { name: 'G', midi: 55, thickness: 1.6 }, // G3 - 3rd
      { name: 'D', midi: 50, thickness: 1.8 }, // D3 - 4th (wound)
      { name: 'g', midi: 67, thickness: 1.2, startFret: 5 } // g4 - 5th drone
    ],
    fretCount: 22,
    singleDots: [3, 5, 7, 10, 12, 15, 17, 19],
    doubleDots: [],
    helpStrings: 'g D G B D — open G tuning; 5th string starts at fret 5',
    defaultTone: 'banjo',
    tones: [
      { value: 'banjo', label: 'Banjo' },
      { value: 'acoustic_guitar_steel', label: 'Steel strings' }
    ],
    chords: true
  },
  mandolin: {
    id: 'mandolin',
    name: 'Mandolin',
    emoji: '🎻',
    // Standard GDAE — paired courses. Each row visually shows two strings
    // and plays a quick 2-attack tremolo (~55ms apart) so a single tap
    // gets the characteristic mandolin sound without a dedicated mandolin
    // soundfont (which is rare in the gleitz catalog).
    tuning: [
      { name: 'E', midi: 76, thickness: 0.9 }, // E5
      { name: 'A', midi: 69, thickness: 1.1 }, // A4
      { name: 'D', midi: 62, thickness: 1.4 }, // D4
      { name: 'G', midi: 55, thickness: 1.8 } // G3
    ],
    fretCount: 20,
    singleDots: [5, 7, 10, 12, 15, 17],
    doubleDots: [],
    helpStrings: 'G D A E — paired courses tuned in unison',
    paired: true,
    defaultTone: 'acoustic_guitar_nylon',
    tones: [
      { value: 'acoustic_guitar_nylon', label: 'Nylon strings (mandolin-ish)' },
      { value: 'acoustic_guitar_steel', label: 'Steel strings' },
      { value: 'pizzicato_strings', label: 'Pizzicato strings' }
    ],
    chords: true
  }
};

export const DEFAULT_INSTRUMENT_ID = 'guitar';

/** Look up an instrument config by id, falling back to the default. */
export function getInstrument(id) {
  return INSTRUMENTS[id] || INSTRUMENTS[DEFAULT_INSTRUMENT_ID];
}

/**
 * Resolve the playable midi for a given (string, fret) of an instrument,
 * honouring `startFret` for the banjo's drone string. Returns null if
 * the cell is unavailable (fret < startFret on a startFret>0 string).
 */
export function midiAtCell(instrument, stringIdx, fret) {
  const str = instrument.tuning[stringIdx];
  if (!str) return null;
  const start = str.startFret || 0;
  if (fret < start) return null;
  return str.midi + (fret - start);
}
