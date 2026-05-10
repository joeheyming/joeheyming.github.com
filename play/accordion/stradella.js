import { createPointerSurface } from '../shared/pointer-surface.js';
import { tap as hapticTap } from '../shared/haptics.js';

/**
 * Stradella bass system — the left-hand button system on a piano accordion.
 *
 * Columns are arranged around the **circle of fifths** (each column to the
 * right is a perfect 5th up from the previous). Rows are by function:
 *
 *   counter-bass   — single note, a major 3rd above the bass
 *   bass           — single note, the column's root
 *   major          — major triad in the chord-octave
 *   minor          — minor triad
 *   dom7           — dominant 7th (root, major 3rd, minor 7th)
 *   dim7           — diminished 7th (root, b3, b5, bb7)
 *
 * Layouts:
 *   - "standard"   : full 6-row Stradella (Western 120-button accordions).
 *   - "eastern"    : 5-row, no diminished 7th. Common on Eastern European
 *                    folk accordions, 80- and 96-bass models.
 *   - "free-bass"  : 3 octaves of single chromatic notes (Russian bayan
 *                    soloist setup), columns still in circle-of-5ths.
 */

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/**
 * Full 120-bass column layout: 20 columns × 6 rows = 120 buttons.
 *
 * Order: left → right (horizontal) / top → bottom (vertical) is the
 * **descending** circle of fifths (each step right/down is a perfect 5th
 * down / perfect 4th up). This puts sharp-side keys at the top of the
 * instrument (closest to the bellows) and flat-side keys at the bottom
 * (resting on the player's knee), matching the standard 120-bass range
 * shown in every Stradella chart and on most real instruments: from
 * A♯ at the bellows-end down through C (the home column) to B♭♭ (= A)
 * at the knee-end.
 *
 * Edge columns use theoretical accordion spellings (A♯, B♭♭, …) — those
 * buttons exist on real 120-bass instruments for chord-progression
 * consistency, even though they're enharmonic duplicates of buttons
 * elsewhere in the row (A♯ ≡ B♭, B♭♭ ≡ A).
 */
const STRADELLA_COLS_20 = [
  { name: 'A♯', pc: 10 }, // = B♭
  { name: 'D♯', pc: 3 },
  { name: 'G♯', pc: 8 },
  { name: 'C♯', pc: 1 },
  { name: 'F♯', pc: 6 },
  { name: 'B', pc: 11 },
  { name: 'E', pc: 4 },
  { name: 'A', pc: 9 },
  { name: 'D', pc: 2 },
  { name: 'G', pc: 7 },
  { name: 'C', pc: 0 },
  { name: 'F', pc: 5 },
  { name: 'B♭', pc: 10 },
  { name: 'E♭', pc: 3 },
  { name: 'A♭', pc: 8 },
  { name: 'D♭', pc: 1 },
  { name: 'G♭', pc: 6 }, // = F♯
  { name: 'C♭', pc: 11 }, // = B
  { name: 'F♭', pc: 4 }, // = E
  { name: 'B♭♭', pc: 9 } // = A
];

/**
 * Concave / colored "home" markers the player feels for blind navigation.
 *
 * Standard 120-bass Stradella spacing: markers fall every **major 3rd**
 * going around the circle of fifths — pitch classes C (0), E (4) and
 * G♯/A♭ (8). With 20 columns of P5 spacing, that puts a marker every 4th
 * column: G♯, E, C, A♭, F♭(=E). Three markers per octave gives the player
 * a clean 4-bar sense of where they are by feel.
 */
const HOME_PITCH_CLASSES = new Set([0, 4, 8]);

const ROW_LABELS = {
  'counter-bass': 'Counter-bass',
  bass: 'Bass',
  major: 'Major',
  minor: 'Minor',
  dom7: 'Dom 7',
  dim7: 'Dim 7',
  'free-low': 'Bass',
  'free-mid': 'Tenor',
  'free-high': 'Alto'
};

// Compact labels for vertical mode, where each column is only one button
// wide and a label like "Counter-bass" overflows into the neighbour.
const ROW_LABELS_SHORT = {
  'counter-bass': '↑3',
  bass: 'B',
  major: 'M',
  minor: 'm',
  dom7: '7',
  dim7: '°',
  'free-low': 'L',
  'free-mid': 'M',
  'free-high': 'H'
};

const ROW_GLYPH = {
  'counter-bass': null, // shows note name instead
  bass: null,
  major: 'M',
  minor: 'm',
  dom7: '7',
  dim7: '°'
};

const FLIP_MODES = new Set(['normal', 'horizontal', 'vertical', 'both']);

export const STRADELLA_LAYOUTS = {
  standard: {
    label: 'Standard Stradella',
    rows: ['counter-bass', 'bass', 'major', 'minor', 'dom7', 'dim7']
  },
  eastern: {
    label: 'Eastern (5-row, no dim7)',
    rows: ['counter-bass', 'bass', 'major', 'minor', 'dom7']
  },
  'free-bass': {
    label: 'Free bass (chromatic)',
    rows: ['free-low', 'free-mid', 'free-high']
  }
};

/**
 * Standard piano-accordion bass-button counts. Each entry maps to the
 * column window into STRADELLA_COLS_20, plus (for 12 / 24 instruments) a
 * reduced row set — these tiny instruments physically lack the dim7,
 * dom7, and minor rows.
 *
 * Ordered from compact → professional. The defaults match what real
 * accordions in each tier ship with: e.g. a 12-bass Hohner Mignon
 * literally has no minor or 7th rows; a 48-bass folk accordion runs all
 * six rows but only B♭–B columns; a 120-bass pro instrument has the
 * full 20-column matrix.
 */
export const STRADELLA_SIZES = {
  // Tiny vintage / child accordions. 4 columns of just bass + major
  // chords, no minor, no 7th. Root range D–F (around C).
  8: {
    label: '8 bass',
    cols: 4,
    colStart: 8,
    forceRows: ['bass', 'major']
  },
  12: {
    label: '12 bass',
    cols: 6,
    colStart: 6,
    forceRows: ['bass', 'major']
  },
  24: {
    label: '24 bass',
    cols: 6,
    colStart: 6,
    forceRows: ['counter-bass', 'bass', 'major', 'minor']
  },
  // Child / beginner instrument. Same column window as the 40 below
  // (E–E♭, 8 keys around the circle of fifths) but no counter-bass row
  // — the player only has roots, not the major-3rd alternates.
  32: {
    label: '32 bass',
    cols: 8,
    colStart: 6,
    forceRows: ['bass', 'major', 'minor', 'dom7']
  },
  // Folk / vintage 8-column instrument: 32-bass plus the counter-bass
  // row. Same column window E–E♭.
  40: {
    label: '40 bass',
    cols: 8,
    colStart: 6,
    forceRows: ['counter-bass', 'bass', 'major', 'minor', 'dom7']
  },
  48: { label: '48 bass', cols: 8, colStart: 5 },
  // Mid-tier folk model. 12 columns (F♯–D♭) but no dim7 row.
  60: {
    label: '60 bass',
    cols: 12,
    colStart: 4,
    forceRows: ['counter-bass', 'bass', 'major', 'minor', 'dom7']
  },
  72: { label: '72 bass', cols: 12, colStart: 3 },
  // 80-bass instruments physically lack the dim7 row — they trade that
  // row for 4 extra bass columns versus the 72. Force the 5-row set
  // (Eastern-style) regardless of which layout the user picked.
  80: {
    label: '80 bass',
    cols: 16,
    colStart: 1,
    forceRows: ['counter-bass', 'bass', 'major', 'minor', 'dom7']
  },
  96: { label: '96 bass', cols: 16, colStart: 1 },
  120: { label: '120 bass', cols: 20, colStart: 0 }
};

const BASS_OCTAVE_MIDI = 36; // C2 = 36
const CHORD_OCTAVE_MIDI = 48; // C3 = 48

function bassNoteFor(pc) {
  return BASS_OCTAVE_MIDI + pc;
}

function counterBassNoteFor(pc) {
  return BASS_OCTAVE_MIDI + pc + 4;
}

function chordNotesFor(pc, type) {
  const root = CHORD_OCTAVE_MIDI + pc;
  switch (type) {
    case 'major':
      return [root, root + 4, root + 7];
    case 'minor':
      return [root, root + 3, root + 7];
    case 'dom7':
      // Common Stradella voicing drops the 5th: root, major 3rd, minor 7th.
      return [root, root + 4, root + 10];
    case 'dim7':
      return [root, root + 3, root + 6, root + 9];
    default:
      return [];
  }
}

function notesForButton(rowType, pc) {
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

function buttonLabel(rowType, col) {
  switch (rowType) {
    case 'bass':
      return col.name;
    case 'counter-bass': {
      const pc = (col.pc + 4) % 12;
      // Use whichever spelling matches the column tonality (sharp-side cols
      // get sharps, flat-side cols get flats).
      return col.name.includes('♭') ? FLAT_NAMES[pc] : SHARP_NAMES[pc];
    }
    case 'free-low':
    case 'free-mid':
    case 'free-high':
      return col.name;
    default:
      return ROW_GLYPH[rowType] || '';
  }
}

/**
 * Render a Stradella section into `rootEl`.
 *
 * Returns:
 *   - `setLayout(layoutId)`: switch the layout in place
 *   - `clearActive()`: drop all visual press states (used on blur)
 */
export function renderStradella(rootEl, opts) {
  const onPress = opts.onPress; // (midis: number[]) => void
  const onRelease = opts.onRelease; // (midis: number[]) => void
  const onActivity = opts.onActivity || (() => {}); // (firstMidi: number) => void

  let currentLayout = opts.initialLayout || 'standard';
  let currentOrientation = opts.orientation || 'horizontal';
  let currentSize = opts.size && STRADELLA_SIZES[opts.size] ? opts.size : '120';
  // `flip` mirrors the entire bass section in CSS so a player who reads
  // the layout from a different perspective (audience-facing vs.
  // player-facing, instrument turned around in the lap, etc.) can
  // re-orient it without us having to re-author the data structure.
  // Valid: 'normal' | 'horizontal' | 'vertical' | 'both'.
  let currentFlip = FLIP_MODES.has(opts.flip) ? opts.flip : 'normal';

  const build = () => {
    rootEl.innerHTML = '';
    rootEl.dataset.layout = currentLayout;
    rootEl.dataset.orientation = currentOrientation;
    rootEl.dataset.size = currentSize;
    rootEl.dataset.flip = currentFlip;
    const layout = STRADELLA_LAYOUTS[currentLayout];
    const size = STRADELLA_SIZES[currentSize];
    if (!layout || !size) return;

    // Smaller bass counts (12 / 24) physically don't have the lower rows.
    // For those, override the layout's row list with the size's required
    // row list. Free-bass keeps its own row set regardless of size.
    let rows = layout.rows;
    if (currentLayout !== 'free-bass' && size.forceRows) {
      rows = size.forceRows;
    }

    const visibleCols = STRADELLA_COLS_20.slice(size.colStart, size.colStart + size.cols);
    // Expose to CSS for grid sizing / auto-fit calculations.
    rootEl.style.setProperty('--col-count', String(visibleCols.length));
    rootEl.style.setProperty('--row-count', String(rows.length));

    for (const rowType of rows) {
      const row = document.createElement('div');
      row.className = `stradella-row stradella-row-${rowType}`;

      const label = document.createElement('div');
      label.className = 'stradella-row-label';
      const longLabel = ROW_LABELS[rowType] || rowType;
      // Wrap text in a span so the flip-mode CSS can counter-transform
      // just the text without disturbing the label's flex sizing.
      const labelText = document.createElement('span');
      labelText.className = 'stradella-row-label-text';
      labelText.textContent =
        currentOrientation === 'vertical' ? ROW_LABELS_SHORT[rowType] || longLabel : longLabel;
      label.appendChild(labelText);
      // Keep the long label discoverable on hover/screen-readers.
      label.title = longLabel;
      label.setAttribute('aria-label', longLabel);
      row.appendChild(label);

      // Buttons sit directly in the row; the diagonal stagger is applied
      // via margin on the first button so the label is not pushed.
      for (const col of visibleCols) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `stradella-button stradella-button-${rowType}`;
        if (rowType === 'bass' && HOME_PITCH_CLASSES.has(col.pc)) {
          btn.classList.add('is-home');
        }
        btn.dataset.col = col.name;
        btn.dataset.row = rowType;
        // Text in a span so flip-mode can mirror the glyph back upright
        // while leaving the button's own `.active` transform free.
        const btnText = document.createElement('span');
        btnText.className = 'stradella-button-label';
        btnText.textContent = buttonLabel(rowType, col);
        btn.appendChild(btnText);
        btn.setAttribute('aria-label', `${ROW_LABELS[rowType] || rowType} ${col.name}`);

        const notes = notesForButton(rowType, col.pc);
        btn._notes = notes;
        btn._pressed = false;

        row.appendChild(btn);
      }

      rootEl.appendChild(row);
    }
  };

  const press = (btn) => {
    if (!btn || btn._pressed) return;
    btn._pressed = true;
    btn.classList.add('active');
    hapticTap();
    onPress(btn._notes);
    if (btn._notes.length) onActivity(btn._notes[0]);
  };

  const release = (btn) => {
    if (!btn || !btn._pressed) return;
    btn._pressed = false;
    btn.classList.remove('active');
    onRelease(btn._notes);
  };

  // PointerSurface handles per-pointer tracking, drag-cross detection,
  // and tap-vs-pan-x deferral on touch (`touch-action: pan-x` on
  // `.stradella-button`). We just supply the press/release semantics.
  const surface = createPointerSurface(rootEl, {
    targetSelector: '.stradella-button',
    deferScrollOnTouch: true,
    onEnter: (btn) => press(btn),
    onLeave: (btn) => release(btn),
    onRelease: (btn) => release(btn)
  });

  build();

  return {
    setLayout(layoutId) {
      if (!STRADELLA_LAYOUTS[layoutId]) return;
      // Release everything before redrawing.
      surface.releaseAll();
      currentLayout = layoutId;
      build();
    },
    setOrientation(orientation) {
      if (orientation !== 'horizontal' && orientation !== 'vertical') return;
      if (orientation === currentOrientation) return;
      surface.releaseAll();
      currentOrientation = orientation;
      build();
    },
    setSize(sizeId) {
      if (!STRADELLA_SIZES[sizeId]) return;
      if (sizeId === currentSize) return;
      surface.releaseAll();
      currentSize = sizeId;
      build();
    },
    setFlip(mode) {
      if (!FLIP_MODES.has(mode)) return;
      if (mode === currentFlip) return;
      // No rebuild needed — the flip is pure CSS driven by the data
      // attribute. We do release any in-flight presses so a user who
      // flips mid-press doesn't get stranded "stuck" buttons.
      surface.releaseAll();
      currentFlip = mode;
      rootEl.dataset.flip = currentFlip;
    },
    clearActive() {
      surface.releaseAll();
      rootEl.querySelectorAll('.stradella-button.active').forEach((el) => {
        el.classList.remove('active');
        el._pressed = false;
      });
    }
  };
}
