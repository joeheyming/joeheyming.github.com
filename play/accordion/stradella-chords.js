/**
 * Shared Stradella chord math + chord-name parser + two-finger chord builder.
 *
 * Imported by both:
 *   - `play/accordion/stradella.js` — the on-screen Stradella keyboard
 *   - `accordion-hero/lane-engine.js` — the rhythm-game judgment engine
 *
 * Keeps the bass / counter-bass / triad voicing rules in one place so the
 * keyboard and the rhythm game can never drift out of sync about which
 * MIDI notes a given Stradella button actually plays.
 */

export const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

// Pitch-class lookup for parsing chord names. Accepts ASCII (`#`, `b`)
// and Unicode (`♯`, `♭`) accidentals; `Bb` and `B♭` both parse to 10.
const ROOT_PC = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

export const BASS_OCTAVE_MIDI = 36; // C2
export const CHORD_OCTAVE_MIDI = 48; // C3

export function bassNoteFor(pc) {
  return BASS_OCTAVE_MIDI + pc;
}

export function counterBassNoteFor(pc) {
  return BASS_OCTAVE_MIDI + ((pc + 4) % 12);
}

/**
 * Notes a single Stradella chord button plays. The voicings are the
 * common 3-/4-note voicings used by real piano accordions (dom7 drops
 * the 5th to stay legible in the chord octave).
 */
export function chordNotesFor(pc, type) {
  const root = CHORD_OCTAVE_MIDI + pc;
  switch (type) {
    case 'major':
      return [root, root + 4, root + 7];
    case 'minor':
      return [root, root + 3, root + 7];
    case 'dom7':
      return [root, root + 4, root + 10];
    case 'dim7':
      return [root, root + 3, root + 6, root + 9];
    default:
      return [];
  }
}

/**
 * Notes a button on any Stradella row plays. `rowType` is one of the
 * row IDs from `STRADELLA_LAYOUTS` in `stradella.js`.
 */
export function notesForButton(rowType, pc) {
  switch (rowType) {
    case 'bass':
      return [bassNoteFor(pc)];
    case 'counter-bass':
      return [counterBassNoteFor(pc)];
    case 'major':
    case 'minor':
    case 'dom7':
    case 'dim7':
      return chordNotesFor(pc, rowType);
    case 'free-low':
      return [BASS_OCTAVE_MIDI + pc];
    case 'free-mid':
      return [CHORD_OCTAVE_MIDI + pc];
    case 'free-high':
      return [CHORD_OCTAVE_MIDI + 12 + pc];
    default:
      return [];
  }
}

/**
 * Parse a chord name like `D`, `Dm`, `A7`, `Gdim`, `C6`, `Am7`, `Cmaj7`,
 * `F#m7`, `Bb9` into `{ rootPc, kind }` where `kind` is the abstract chord
 * quality (not the Stradella row, since extended chords don't map 1:1 to
 * rows).
 *
 * `kind` ∈ `'maj' | 'min' | '7' | 'dim' | 'dim7' | '6' | 'm6' | 'm7' | 'maj7' | '9' | 'sus4' | 'sus2' | 'aug'`.
 */
export function parseChordName(name) {
  if (typeof name !== 'string' || name.length === 0) return null;
  const trimmed = name.trim();

  // Root letter + optional accidental. Accept both ASCII and Unicode.
  const m = trimmed.match(/^([A-Ga-g])([#♯b♭]?)(.*)$/);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const suffix = m[3].trim();
  let pc = ROOT_PC[letter];
  if (pc == null) return null;
  if (accidental === '#' || accidental === '♯') pc = (pc + 1) % 12;
  if (accidental === 'b' || accidental === '♭') pc = (pc + 11) % 12;

  const s = suffix.toLowerCase();
  let kind;
  // Longest-prefix-wins matching so `maj7` beats `maj`, `m7` beats `m`.
  if (s === '' || s === 'maj' || s === 'M') kind = 'maj';
  else if (s === 'maj7' || s === 'M7' || s === 'ma7') kind = 'maj7';
  else if (s === 'm' || s === 'min' || s === '-') kind = 'min';
  else if (s === 'm7' || s === 'min7' || s === '-7') kind = 'm7';
  else if (s === 'm6' || s === 'min6' || s === '-6') kind = 'm6';
  else if (s === '7' || s === 'dom7') kind = '7';
  else if (s === '6') kind = '6';
  else if (s === '9' || s === 'dom9') kind = '9';
  else if (s === 'dim' || s === '°' || s === 'o') kind = 'dim';
  else if (s === 'dim7' || s === '°7' || s === 'o7') kind = 'dim7';
  else if (s === 'sus' || s === 'sus4') kind = 'sus4';
  else if (s === 'sus2') kind = 'sus2';
  else if (s === 'aug' || s === '+') kind = 'aug';
  else return null;
  return { rootPc: pc, kind };
}

/**
 * Pitch-class set for a chord — the set of MIDI-mod-12 values that the
 * chord theoretically contains. Used by the chord-judge to score what
 * the player actually pressed against what the chart's chord wants.
 */
export function chordPitchClassSet(name) {
  const parsed = typeof name === 'string' ? parseChordName(name) : name;
  if (!parsed) return null;
  const { rootPc, kind } = parsed;
  const intervals = CHORD_INTERVALS[kind];
  if (!intervals) return null;
  return new Set(intervals.map((iv) => (rootPc + iv) % 12));
}

// Intervals (semitones from root) for each chord quality.
const CHORD_INTERVALS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  9: [0, 4, 7, 10, 2],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  aug: [0, 4, 8]
};

/**
 * Two-finger chord builder. Decomposes any chord-name into a Stradella
 * voicing: one chord-row button (`maj` / `min` / `dom7` / `dim7`) plus
 * zero or more extra bass-row notes that, combined, sound the full chord.
 *
 * `voicing`:
 *   - `'simple'` (default) — use a dedicated chord button alone when one
 *     exists (e.g. `C7` → Cdom7 button, no extra bass).
 *   - `'built'` — force the two-finger build even when a single button
 *     would suffice (e.g. `C7` → Cmaj button + B♭ bass). Mirrors what
 *     a player does on a real accordion to vary the timbre.
 *
 * Returns:
 *   ```
 *   {
 *     chordButton: { pc, row },   // row ∈ 'major' | 'minor' | 'dom7' | 'dim7'
 *     extraBass:   [{ pc }, ...], // 0+ additional bass-row buttons to add
 *     targetChord: { rootPc, kind }, // for the judge to score against
 *     label: string,              // canonical chord name for UI
 *   }
 *   ```
 */
export function buildChord(name, { voicing = 'simple' } = {}) {
  const parsed = typeof name === 'string' ? parseChordName(name) : name;
  if (!parsed) return null;
  const { rootPc, kind } = parsed;
  const target = { rootPc, kind };
  const label = typeof name === 'string' ? name : canonicalChordName(parsed);

  // Helper to build the return shape.
  const make = (chordRow, chordPc, extraPcs) => ({
    chordButton: { pc: chordPc, row: chordRow },
    extraBass: extraPcs.map((pc) => ({ pc })),
    targetChord: target,
    label
  });

  switch (kind) {
    case 'maj':
      return make('major', rootPc, []);

    case 'min':
      return make('minor', rootPc, []);

    case '7':
      if (voicing === 'built') {
        // Cmaj + B♭ bass = C E G + B♭ = C7.
        return make('major', rootPc, [(rootPc + 10) % 12]);
      }
      return make('dom7', rootPc, []);

    case 'dim':
      return make('dim7', rootPc, []);

    case 'dim7':
      return make('dim7', rootPc, []);

    case '6':
      // C6 = Cmaj + A bass = C E G + A. Same notes as Am7.
      return make('major', rootPc, [(rootPc + 9) % 12]);

    case 'm6':
      // Cm6 = Cmin + A bass = C E♭ G + A.
      return make('minor', rootPc, [(rootPc + 9) % 12]);

    case 'm7':
      // Cm7 = Cmin + B♭ bass = C E♭ G + B♭.
      // (Could also be Cmaj+A=Am7 alias — but Cm7 with min button is the
      // direct voicing.)
      return make('minor', rootPc, [(rootPc + 10) % 12]);

    case 'maj7':
      // Cmaj7 = Cmaj + B bass = C E G + B.
      return make('major', rootPc, [(rootPc + 11) % 12]);

    case '9':
      // C9 = Cdom7 + D bass = C E G B♭ + D.
      return make('dom7', rootPc, [(rootPc + 2) % 12]);

    case 'sus4':
      // No native Stradella sus button — approximate as the major triad
      // with the F (4th) added; player can substitute the bass to taste.
      return make('major', rootPc, [(rootPc + 5) % 12]);

    case 'sus2':
      return make('major', rootPc, [(rootPc + 2) % 12]);

    case 'aug':
      // No aug row; nearest is the major button (root+3rd+5th vs aug's
      // root+3rd+#5). Players add the #5 via the bass row.
      return make('major', rootPc, [(rootPc + 8) % 12]);

    default:
      return null;
  }
}

/**
 * Canonical short name for a parsed chord (round-trip from parseChordName).
 * Used as a default label when the chart only passes a parsed shape.
 */
export function canonicalChordName({ rootPc, kind }) {
  const root = SHARP_NAMES[rootPc];
  const suffix = {
    maj: '',
    min: 'm',
    7: '7',
    6: '6',
    m6: 'm6',
    m7: 'm7',
    maj7: 'maj7',
    9: '9',
    dim: 'dim',
    dim7: 'dim7',
    sus4: 'sus4',
    sus2: 'sus2',
    aug: 'aug'
  }[kind];
  return root + (suffix == null ? '' : suffix);
}
