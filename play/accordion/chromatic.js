/**
 * Chromatic button accordion (right-hand) layout.
 *
 * Both B-system and C-system have the same logical structure:
 *
 *   - Three rows of buttons.
 *   - Within each row, notes ascend by **minor 3rds**.
 *   - Each successive row is **one semitone higher** than the previous.
 *   - Reading diagonally gives a chromatic scale.
 *
 * The systems are **visual mirror images** of each other:
 *
 *   - B-system (Russian bayan / "B-griff" — common in Eastern Europe):
 *     odd rows are offset to the **right**, so the chromatic ascent
 *     diagonal rises **up-right** (NE).
 *   - C-system (Italian / Belgian / "C-griff" — common in Western
 *     Europe): odd rows are offset to the **left**, so the chromatic
 *     ascent diagonal rises **up-left** (NW).
 *
 * Same MIDI mapping per (row, col); only the geometry flips.
 *
 * Two orientations:
 *
 *   - `horizontal`  : 3 rows running left → right, ascending minor 3rds.
 *                     Diagonal stagger by half a button between rows.
 *   - `vertical`    : 3 columns running top → bottom in each "stack",
 *                     ascending minor 3rds. Mimics how the right-hand
 *                     button board sits on a real chromatic accordion held
 *                     by the player.
 */

import { createPointerSurface } from '../shared/pointer-surface.js';
import { tap as hapticTap } from '../shared/haptics.js';

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/**
 * Standard chromatic-button accordion right-hand keyboard sizes.
 *
 *   - 3-row models are the basic chromatic system (each row is one of
 *     the three distinct chromatic rows; no duplicates).
 *   - 4-row models add a "helper row" that duplicates row 1 (closest to
 *     the player's wrist), giving alternate fingerings.
 *   - 5-row models add two helper rows duplicating rows 1 and 2 — the
 *     standard for modern professional CBAs and bayans.
 *
 * Button counts are real model sizes: e.g. Hohner Bravo IV 72 (4×18),
 * Hohner Morino V 120 (5×24), Bugari 5-row 100 (5×20). The duplicate
 * rows play the *same MIDI notes* as the rows they mirror, just at a
 * different physical position; we collapse them with `rowIdx % 3` in
 * the MIDI lookup.
 */
/**
 * Per-layout shape of the right-hand keyboard.
 *
 * The 5-row layouts use the row orders from the reference CBA charts:
 *
 *   C-system 5-row (anchor D♯, lowest pitch at row 3):
 *     row 0 (bottom)   : F♯ A  C  D♯  …  (D♯ + 3 semis = F♯)
 *     row 1            : E  G  A♯ C♯  …  (D♯ + 1)
 *     row 2 (middle)   : F  G♯ B  D   …  (D♯ + 2)
 *     row 3            : D♯ F♯ A  C   …  (D♯ + 0)
 *     row 4 (top)      : E  G  A♯ C♯  …  (D♯ + 1 — same as row 1)
 *
 *   B-system 5-row (anchor A♯, lowest pitch at row 1):
 *     row 0 (bottom)   : B  D  F  G♯  …  (A♯ + 1)
 *     row 1            : A♯ C♯ E  G   …  (A♯ + 0)
 *     row 2 (middle)   : C  D♯ F♯ A   …  (A♯ + 2)
 *     row 3            : B  D  F  G♯  …  (A♯ + 1 — same as row 0)
 *     row 4 (top)      : C♯ E  G  A♯  …  (A♯ + 3)
 *
 * 4-row layouts drop the top row of the 5-row spec (DOM 4), giving
 * the three main diminished-7th rows plus one helper row at the
 * bottom. This matches the standard 4-row CBA convention (popular
 * with French C-system players); per the accordionists.info CBA
 * conversion thread, the 4th row IS different between B and C
 * systems, which is why each gets its own offset table here.
 *
 *   C-system 4-row (anchor D♯):
 *     row 0 (bottom)   : F♯ A  C  D♯  …  (helper for the D♯ row)
 *     row 1            : E  G  A♯ C♯  …
 *     row 2            : F  G♯ B  D   …
 *     row 3 (top)      : D♯ F♯ A  C   …  (the "C row")
 *
 *   B-system 4-row (anchor A♯):
 *     row 0 (bottom)   : B  D  F  G♯  …  (helper for the B row)
 *     row 1            : A♯ C♯ E  G   …
 *     row 2            : C  D♯ F♯ A   …  (the "C row" in B-system)
 *     row 3 (top)      : B  D  F  G♯  …
 *
 * 3-row layouts have no helpers, so B and C share the same chromatic
 * ascent (system difference is purely visual stagger).
 */
const FIVE_ROW = {
  // C-system: D♯ anchor, F♯ at the bottom.
  startMidi: 39,
  rowOffsets: [3, 1, 2, 0, 1],
  // B-system: A♯ anchor, B at the bottom.
  startMidiB: 46,
  rowOffsetsB: [1, 0, 2, 1, 3]
};

const FOUR_ROW = {
  startMidi: 39,
  rowOffsets: [3, 1, 2, 0],
  startMidiB: 46,
  rowOffsetsB: [1, 0, 2, 1]
};

const FOUR_ROW_HIGH = {
  startMidi: 51,
  rowOffsets: [3, 1, 2, 0],
  startMidiB: 58,
  rowOffsetsB: [1, 0, 2, 1]
};

export const CHROMATIC_LAYOUTS = {
  42: {
    label: '42-button (3 rows)',
    rows: 3,
    cols: 14,
    startMidi: 51, // D♯3
    rowOffsets: [0, 1, 2]
  },
  52: { label: '52-button (4 rows)', rows: 4, cols: 13, ...FOUR_ROW_HIGH },
  64: { label: '64-button (4 rows)', rows: 4, cols: 16, ...FOUR_ROW_HIGH },
  72: { label: '72-button (4 rows)', rows: 4, cols: 18, ...FOUR_ROW },
  96: { label: '96-button (4 rows)', rows: 4, cols: 24, ...FOUR_ROW },
  100: { label: '100-button (5 rows)', rows: 5, cols: 20, ...FIVE_ROW },
  120: { label: '120-button (5 rows)', rows: 5, cols: 24, ...FIVE_ROW }
};
const DEFAULT_LAYOUT = 64;

function midiName(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${SHARP_NAMES[pc]}${oct}`;
}

function shortMidiName(midi) {
  const pc = ((midi % 12) + 12) % 12;
  return SHARP_NAMES[pc];
}

function isC(midi) {
  return ((midi % 12) + 12) % 12 === 0;
}

/**
 * "Accidental" notes — i.e. the black piano keys: C♯, D♯, F♯, G♯, A♯.
 * Used to color buttons differently from natural notes (C, D, E, F, G,
 * A, B), which mirrors the piano-key metaphor real CBA chord charts
 * use to show which notes are which.
 */
function isAccidental(midi) {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function midiForCell(rowIdx, colIdx, layout, system) {
  const useB = system === 'B' && layout.rowOffsetsB;
  const startMidi = useB ? layout.startMidiB : layout.startMidi;
  const rowOffsets = useB ? layout.rowOffsetsB : layout.rowOffsets;
  return startMidi + rowOffsets[rowIdx] + 3 * colIdx;
}

/**
 * Visual half-button offset of a DOM row in the honeycomb stagger.
 * Even DOM rows (0, 2, 4) are shifted right by 0.5; odd rows sit flush.
 * Same formula as the inline `offsetFor()` used by `renderChromatic`.
 */
export function rowVisualOffset(rowIdx) {
  return ((rowIdx + 1) % 2) * 0.5;
}

/**
 * Whether two buttons at (r1, c1) and (r2, c2) are visual neighbours in
 * the honeycomb grid — i.e. close enough that a player can drag from
 * one to the other in a single motion.
 *
 * Same row → adjacent columns.
 * Adjacent row → the half-button stagger means each button has TWO
 * neighbours in the row above and TWO in the row below.
 */
export function areNeighbors(r1, c1, r2, c2) {
  if (r1 === r2) return Math.abs(c1 - c2) === 1;
  if (Math.abs(r1 - r2) !== 1) return false;
  const o1 = rowVisualOffset(r1);
  const o2 = rowVisualOffset(r2);
  if (o1 > o2) {
    // r1 is shifted right relative to r2 → r1's neighbours in r2 are c1 and c1+1.
    return c2 === c1 || c2 === c1 + 1;
  }
  if (o1 < o2) {
    // r1 sits flush, r2 shifted right → r1's neighbours in r2 are c1-1 and c1.
    return c2 === c1 - 1 || c2 === c1;
  }
  // Same offset (shouldn't happen with alternating stagger, but be safe):
  return c1 === c2;
}

/**
 * Render a chromatic-button section into `rootEl`.
 *
 * Returns:
 *   - `setOrientation(o)`   : 'horizontal' | 'vertical'
 *   - `setSystem(s)`        : 'B' | 'C'
 *   - `clearActive()`       : drop visual press state
 */
const FLIP_MODES = new Set(['normal', 'horizontal', 'vertical', 'both']);

export function renderChromatic(rootEl, opts) {
  const onPress = opts.onPress;
  const onRelease = opts.onRelease;
  const onActivity = opts.onActivity || (() => {});

  let orientation = opts.orientation || 'horizontal';
  let system = opts.system || 'B';
  let layoutId = opts.layout && CHROMATIC_LAYOUTS[opts.layout] ? opts.layout : DEFAULT_LAYOUT;
  // Mirror mode for the right-hand surface. Same scheme as the
  // Stradella side: the data attribute drives a CSS transform on the
  // container, with a counter-transform on the per-button text span so
  // glyphs stay readable. Valid: 'normal' | 'horizontal' | 'vertical'
  // | 'both'.
  let currentFlip = FLIP_MODES.has(opts.flip) ? opts.flip : 'normal';
  // Global octave shift in semitones (multiples of 12), driven from the
  // accordion page's Octave control. Button labels are pitch-class only
  // (C, D♯, F, …) so they remain accurate at any shift; only the
  // emitted MIDI value changes.
  let octaveShift = Number.isInteger(opts.octaveShift) ? opts.octaveShift : 0;

  const createButton = (rowIdx, colIdx) => {
    const midi = midiForCell(rowIdx, colIdx, CHROMATIC_LAYOUTS[layoutId], system) + octaveShift;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chromatic-button chromatic-button-row-${rowIdx}`;
    btn.classList.add(isAccidental(midi) ? 'is-accidental' : 'is-natural');
    if (isC(midi)) btn.classList.add('is-c');
    // Text in a span so the flip-mode CSS can counter-transform just
    // the glyph without disturbing the button's own `.active` press
    // animation (which itself sets `transform`).
    const labelEl = document.createElement('span');
    labelEl.className = 'chromatic-button-label';
    labelEl.textContent = shortMidiName(midi);
    btn.appendChild(labelEl);
    btn.dataset.midi = String(midi);
    btn.setAttribute('aria-label', midiName(midi));
    btn._notes = [midi];
    btn._pressed = false;
    return btn;
  };

  const build = () => {
    rootEl.innerHTML = '';
    rootEl.dataset.orientation = orientation;
    rootEl.dataset.system = system;
    rootEl.dataset.layout = String(layoutId);
    rootEl.dataset.flip = currentFlip;

    const { rows, cols } = CHROMATIC_LAYOUTS[layoutId];
    // Expose grid dimensions so the CSS can auto-fit button size to
    // viewport (same trick as the Stradella side).
    rootEl.style.setProperty('--row-count', String(rows));
    rootEl.style.setProperty('--col-count', String(cols));

    // Honeycomb stagger: alternating rows offset by half a button so
    // every button gets six equidistant neighbours. Counting rows from
    // the *top* of the visible keyboard down (1, 2, 3, 4, 5), the *odd*
    // rows (1, 3, 5) are shifted right by half a button and the even
    // rows (2, 4) sit flush — matching how the standard CBA spelling
    // charts are drawn for both B-system and C-system layouts.
    //
    // With `flex-direction: column-reverse` the DOM order is the
    // opposite of the visual stack, so DOM-even rows (0, 2, 4) end up
    // as visual rows 5, 3, 1 — the rows we want shifted.
    const offsetFor = (r) => ((r + 1) % 2) * 0.5;

    // Helper rows in the user's spec sit at the visual ends:
    //   - 5-row: DOM 0 (bottom) and DOM 4 (top) are helpers
    //   - 4-row: DOM 0 (bottom) is the helper
    //   - 3-row: no helpers
    const isHelperRow = (r) => {
      if (rows === 5) return r === 0 || r === 4;
      if (rows === 4) return r === 0;
      return false;
    };

    if (orientation === 'horizontal') {
      // `rows` rows, each with `cols` buttons going across in minor-3rds.
      for (let r = 0; r < rows; r++) {
        const row = document.createElement('div');
        row.className = `chromatic-row chromatic-row-${r}`;
        if (isHelperRow(r)) row.classList.add('chromatic-row-duplicate');
        row.style.setProperty('--row-offset', String(offsetFor(r)));
        for (let c = 0; c < cols; c++) {
          row.appendChild(createButton(r, c));
        }
        rootEl.appendChild(row);
      }
    } else {
      // Vertical: `rows` columns left-to-right, `cols` buttons stacked
      // top-to-bottom — the column reads in the same order as a
      // horizontal row reads left-to-right, so each column starts with
      // the lowest note of its row pattern at the top.
      for (let r = 0; r < rows; r++) {
        const col = document.createElement('div');
        col.className = `chromatic-col chromatic-col-${r}`;
        if (isHelperRow(r)) col.classList.add('chromatic-col-duplicate');
        col.style.setProperty('--col-offset', String(offsetFor(r)));
        for (let c = 0; c < cols; c++) {
          // Append low-to-high; CSS uses column-reverse so they stack
          // bottom-up visually.
          col.appendChild(createButton(r, c));
        }
        rootEl.appendChild(col);
      }
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

  // PointerSurface owns the per-pointer tracking, drag-cross detection,
  // and tap-vs-pan-x deferral on touch (`touch-action: pan-x` on the
  // CBA buttons). Same shape as the Stradella half above.
  const surface = createPointerSurface(rootEl, {
    targetSelector: '.chromatic-button',
    deferScrollOnTouch: true,
    onEnter: (btn) => press(btn),
    onLeave: (btn) => release(btn),
    onRelease: (btn) => release(btn)
  });

  build();

  return {
    setOrientation(o) {
      if (o !== 'horizontal' && o !== 'vertical') return;
      if (o === orientation) return;
      surface.releaseAll();
      orientation = o;
      build();
    },
    setSystem(s) {
      if (s !== 'B' && s !== 'C') return;
      if (s === system) return;
      surface.releaseAll();
      system = s;
      build();
    },
    setLayout(id) {
      const key = typeof id === 'number' ? id : Number(id);
      if (!CHROMATIC_LAYOUTS[key]) return;
      if (key === layoutId) return;
      surface.releaseAll();
      layoutId = key;
      build();
    },
    setFlip(mode) {
      if (!FLIP_MODES.has(mode)) return;
      if (mode === currentFlip) return;
      // CSS-only — no rebuild. Release any in-flight presses so a
      // user who flips mid-press doesn't get stranded buttons.
      surface.releaseAll();
      currentFlip = mode;
      rootEl.dataset.flip = currentFlip;
    },
    setOctaveShift(semis) {
      const next = Number.isInteger(semis) ? semis : 0;
      if (next === octaveShift) return;
      surface.releaseAll();
      octaveShift = next;
      build();
    },
    clearActive() {
      surface.releaseAll();
      rootEl.querySelectorAll('.chromatic-button.active').forEach((el) => {
        el.classList.remove('active');
        el._pressed = false;
      });
    }
  };
}
