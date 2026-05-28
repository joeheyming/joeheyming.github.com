/**
 * Diatonic (bisonoric) button accordion — right-hand layout.
 *
 * Real diatonic accordions are bisonoric: each physical button plays a
 * different note on the push (close) of the bellows than on the pull
 * (open). The natural "press a button while the air's flowing the
 * right way" mechanic isn't available in a browser, so instead of one
 * keyboard whose labels swap with bellows direction, this view shows
 * BOTH directions simultaneously as two side-by-side keyboards:
 *
 *   PUSH side (green tint)        |        PULL side (orange tint)
 *   D row : D F♯ A D F♯ A …       |        D row : E A C♯ E G B …
 *   G row : G B D G B D …         |        G row : A D F♯ A C E …
 *
 * Each button on the PUSH half plays its push note; each button on
 * the PULL half plays its pull note. They sit `next to each other
 * with space in between them` (the user's spec), making the two
 * directions concrete and visible at all times.
 *
 * **Mutex**: only one half can sound at a time — a real bellows can
 * only push OR pull, never both. While any button on one side is
 * held, presses on the other side are no-ops. This is enforced
 * internally by tracking the active side and ignoring out-of-side
 * presses; a single-finger drag from one side to the other works
 * fine because the leave fires before the enter, releasing the
 * count back to zero before the new side acquires it.
 *
 * Tunings shipped here:
 *   - C 1-row (Cajun / Hohner Pokerwork) — 10 buttons
 *   - D/G 2-row — most common British / French folk tuning
 *   - G/C 2-row — common in continental folk
 *   - B/C 2-row — Irish trad standard, semitone offset between rows
 */

import { createPointerSurface } from '../shared/pointer-surface.js';
import { tap as hapticTap } from '../shared/haptics.js';

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/**
 * Build a single-row diatonic from a "scale-pair" recipe rooted at a
 * MIDI value. Classic 10-button melodeon row pattern:
 *
 *   button:  1   2   3   4   5   6   7   8   9   10
 *   push:    1   3   5   8   10  12  15  17  19  22   (semis from root)
 *   pull:    2   7   11  14  17  21  23  26  29  33   (semis from root)
 *
 * In C (root = C4 = 60) this is the Hohner Pokerwork layout:
 *   push : C4 E4 G4 C5 E5 G5 C6 E6 G6 C7
 *   pull : D4 G4 B4 D5 F5 A5 B5 D6 F6 A6
 */
function diatonicRow(rootMidi) {
  const PUSH = [0, 4, 7, 12, 16, 19, 24, 28, 31, 36];
  const PULL = [2, 7, 11, 14, 17, 21, 23, 26, 29, 33];
  const buttons = [];
  for (let i = 0; i < 10; i++) {
    buttons.push({ push: rootMidi + PUSH[i], pull: rootMidi + PULL[i] });
  }
  return buttons;
}

export const DIATONIC_TUNINGS = {
  C: {
    label: 'C (1 row, Cajun)',
    rows: [{ name: 'C', buttons: diatonicRow(60) }] // C4
  },
  DG: {
    label: 'D/G (2 row)',
    rows: [
      { name: 'D', buttons: diatonicRow(62) }, // D4
      { name: 'G', buttons: diatonicRow(55) } // G3
    ]
  },
  GC: {
    label: 'G/C (2 row)',
    rows: [
      { name: 'G', buttons: diatonicRow(55) }, // G3
      { name: 'C', buttons: diatonicRow(60) } // C4
    ]
  },
  BC: {
    label: 'B/C (2 row, Irish)',
    rows: [
      { name: 'C', buttons: diatonicRow(60) }, // C4
      { name: 'B', buttons: diatonicRow(59) } // B3 — semitone below
    ]
  }
};

const DEFAULT_TUNING = 'C';
const FLIP_MODES = new Set(['normal', 'horizontal', 'vertical', 'both']);

function shortMidiName(midi) {
  const pc = ((midi % 12) + 12) % 12;
  return SHARP_NAMES[pc];
}

function midiName(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${SHARP_NAMES[pc]}${oct}`;
}

function isAccidental(midi) {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

const SIDES = ['push', 'pull'];
const SIDE_GLYPH = { push: '▲', pull: '▼' };
const SIDE_LABEL = { push: 'PUSH', pull: 'PULL' };

/**
 * Render a diatonic right-hand into `rootEl`.
 *
 * Required opts:
 *   - onPress(midis: number[])
 *   - onRelease(midis: number[])
 *
 * Returns:
 *   - setTuning(id)         : 'C' | 'DG' | 'GC' | 'BC'
 *   - setOrientation(o)     : 'horizontal' | 'vertical'
 *   - setFlip(mode)         : 'normal' | 'horizontal' | 'vertical' | 'both'
 *   - setBellowsDirection(d): pure visual hint (highlight whichever side
 *                             the phone is currently swinging towards);
 *                             does NOT gate which side can sound, the
 *                             mutex below already handles that.
 *   - clearActive()         : drop visual / audible press state
 */
export function renderDiatonic(rootEl, opts) {
  const onPress = opts.onPress;
  const onRelease = opts.onRelease;
  const onActivity = opts.onActivity || (() => {});

  let tuningId = opts.tuning && DIATONIC_TUNINGS[opts.tuning] ? opts.tuning : DEFAULT_TUNING;

  let orientation = opts.orientation === 'vertical' ? 'vertical' : 'horizontal';
  let currentFlip = FLIP_MODES.has(opts.flip) ? opts.flip : 'normal';
  // Global octave shift in semitones (multiples of 12), driven from the
  // accordion page's Octave control. Button labels are pitch-class only
  // (C, D, F♯, …) so they remain accurate at any shift; we just bump
  // the per-button MIDI value.
  let octaveShift = Number.isInteger(opts.octaveShift) ? opts.octaveShift : 0;

  // Mutex state: which half (if any) currently has buttons held. While
  // it's set, presses on the OTHER half are ignored — you can't push
  // and pull a real bellows simultaneously.
  let activeSide = null;
  // Number of buttons currently held on each side. activeSide flips
  // back to null when both reach zero.
  const heldCount = { push: 0, pull: 0 };

  const refreshActiveSideAttr = () => {
    rootEl.dataset.activeSide = activeSide || '';
  };

  const createButton = (rowIdx, colIdx, side, midi) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `diatonic-button diatonic-button-row-${rowIdx}`;
    btn.classList.add(`diatonic-button-${side}`);
    btn.classList.add(isAccidental(midi) ? 'is-accidental' : 'is-natural');
    btn.dataset.side = side;
    btn._midi = midi;
    btn._side = side;
    btn._row = rowIdx;
    btn._col = colIdx;
    btn._pressed = false;

    const labelEl = document.createElement('span');
    labelEl.className = 'diatonic-button-label';
    labelEl.textContent = shortMidiName(midi);
    btn.appendChild(labelEl);

    btn.setAttribute('aria-label', `${midiName(midi)} (${side})`);
    return btn;
  };

  const buildHalf = (side) => {
    const half = document.createElement('div');
    half.className = `diatonic-half diatonic-half-${side}`;
    half.dataset.side = side;

    // Header banner inside each half — colored to match the side's
    // tint (green for push, orange for pull) and showing the bellows
    // glyph (▲ / ▼) so the player can read the direction at a glance.
    const header = document.createElement('div');
    header.className = 'diatonic-half-header';
    const headerArrow = document.createElement('span');
    headerArrow.className = 'diatonic-half-header-arrow';
    headerArrow.setAttribute('aria-hidden', 'true');
    headerArrow.textContent = SIDE_GLYPH[side];
    const headerLabel = document.createElement('span');
    headerLabel.className = 'diatonic-half-header-label';
    headerLabel.textContent = SIDE_LABEL[side];
    header.appendChild(headerArrow);
    header.appendChild(headerLabel);
    half.appendChild(header);

    // Wrapper around the rows so vertical orientation can flip them into
    // a left-to-right strip while keeping the header in its natural
    // place above. In horizontal orientation the wrapper is a flex
    // column and rows stack normally.
    const rowsEl = document.createElement('div');
    rowsEl.className = 'diatonic-half-rows';

    const tuning = DIATONIC_TUNINGS[tuningId];
    tuning.rows.forEach((row, rowIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = `diatonic-row diatonic-row-${rowIdx}`;
      rowEl.dataset.rowName = row.name;

      const labelEl = document.createElement('div');
      labelEl.className = 'diatonic-row-label';
      const labelText = document.createElement('span');
      labelText.className = 'diatonic-row-label-text';
      labelText.textContent = `${row.name} row`;
      labelEl.appendChild(labelText);
      rowEl.appendChild(labelEl);

      row.buttons.forEach((pair, colIdx) => {
        const midi = (side === 'push' ? pair.push : pair.pull) + octaveShift;
        rowEl.appendChild(createButton(rowIdx, colIdx, side, midi));
      });

      rowsEl.appendChild(rowEl);
    });
    half.appendChild(rowsEl);

    return half;
  };

  const build = () => {
    rootEl.innerHTML = '';
    rootEl.dataset.tuning = tuningId;
    rootEl.dataset.orientation = orientation;
    rootEl.dataset.flip = currentFlip;
    rootEl.dataset.activeSide = '';

    const tuning = DIATONIC_TUNINGS[tuningId];
    rootEl.style.setProperty('--row-count', String(tuning.rows.length));
    rootEl.style.setProperty('--col-count', String(tuning.rows[0]?.buttons.length || 10));

    const pushHalf = buildHalf('push');
    const pullHalf = buildHalf('pull');

    const divider = document.createElement('div');
    divider.className = 'diatonic-side-divider';
    divider.setAttribute('aria-hidden', 'true');

    rootEl.appendChild(pushHalf);
    rootEl.appendChild(divider);
    rootEl.appendChild(pullHalf);
  };

  const press = (btn) => {
    if (!btn || btn._pressed) return;
    // Mutex: while the other side is sounding, ignore presses on this
    // side. _pressed stays false so the eventual release is a no-op.
    if (activeSide && activeSide !== btn._side) return;
    btn._pressed = true;
    btn.classList.add('active');
    if (!activeSide) {
      activeSide = btn._side;
      refreshActiveSideAttr();
    }
    heldCount[btn._side] += 1;
    hapticTap();
    onPress([btn._midi]);
    onActivity(btn._midi);
  };

  const release = (btn) => {
    if (!btn || !btn._pressed) return;
    btn._pressed = false;
    btn.classList.remove('active');
    onRelease([btn._midi]);
    heldCount[btn._side] = Math.max(0, heldCount[btn._side] - 1);
    if (heldCount.push === 0 && heldCount.pull === 0) {
      activeSide = null;
      refreshActiveSideAttr();
    }
  };

  const surface = createPointerSurface(rootEl, {
    targetSelector: '.diatonic-button',
    deferScrollOnTouch: true,
    onEnter: (btn) => press(btn),
    onLeave: (btn) => release(btn),
    onRelease: (btn) => release(btn)
  });

  const resetMutex = () => {
    activeSide = null;
    heldCount.push = 0;
    heldCount.pull = 0;
    refreshActiveSideAttr();
  };

  build();

  return {
    setTuning(id) {
      if (!DIATONIC_TUNINGS[id]) return;
      if (id === tuningId) return;
      surface.releaseAll();
      resetMutex();
      tuningId = id;
      build();
    },
    setOrientation(o) {
      if (o !== 'horizontal' && o !== 'vertical') return;
      if (o === orientation) return;
      surface.releaseAll();
      resetMutex();
      orientation = o;
      build();
    },
    setFlip(mode) {
      if (!FLIP_MODES.has(mode)) return;
      if (mode === currentFlip) return;
      surface.releaseAll();
      currentFlip = mode;
      rootEl.dataset.flip = currentFlip;
    },
    setOctaveShift(semis) {
      const next = Number.isInteger(semis) ? semis : 0;
      if (next === octaveShift) return;
      surface.releaseAll();
      resetMutex();
      octaveShift = next;
      build();
    },
    /**
     * Pure visual hint from a phone bellows / Shift-key — does NOT gate
     * which side can produce sound (the mutex above handles that). We
     * just decorate the matching half so the player gets feedback that
     * the device is detecting their swing.
     */
    setBellowsDirection(dir) {
      if (dir !== 'push' && dir !== 'pull') {
        delete rootEl.dataset.bellowsHint;
        return;
      }
      rootEl.dataset.bellowsHint = dir;
    },
    clearActive() {
      surface.releaseAll();
      rootEl.querySelectorAll('.diatonic-button.active').forEach((el) => {
        el.classList.remove('active');
        el._pressed = false;
      });
      resetMutex();
    },
    /**
     * Test/debug only: which side, if any, is currently held.
     */
    _getActiveSide() {
      return activeSide;
    }
  };
}

// Side identifiers used by external callers. Keeping a named export
// avoids string-typo bugs in `setBellowsDirection` callers.
export const DIATONIC_SIDES = SIDES;
