/**
 * Reusable on-screen piano keyboard renderer + input handler.
 *
 * Used by piano, accordion, and synth pages. Calls a host-provided synth
 * object that must implement `noteOn(midi)`, `noteOff(midi)`, `allOff()`.
 */
import { isBlackKey, isC, midiToName } from './audio.js';

/**
 * Two-row "piano-roll" keyboard layout (FL Studio / many online pianos).
 * Offsets are in semitones above `startMidi` (the lowest visible C).
 */
export const KEYBOARD_MAP = {
  // Lower octave whites (bottom row)
  z: 0,
  x: 2,
  c: 4,
  v: 5,
  b: 7,
  n: 9,
  m: 11,
  // Lower octave blacks (home row)
  s: 1,
  d: 3,
  g: 6,
  h: 8,
  j: 10,
  // Upper octave whites (top row)
  q: 12,
  w: 14,
  e: 16,
  r: 17,
  t: 19,
  y: 21,
  u: 23,
  // Upper octave blacks (number row)
  2: 13,
  3: 15,
  5: 18,
  6: 20,
  7: 22,
  // Third-octave bonus
  i: 24,
  o: 26,
  p: 28,
  9: 25,
  0: 27
};

export class Keyboard {
  constructor(rootEl, opts) {
    this.root = rootEl;
    this.startMidi = opts.startMidi;
    this.whiteKeyCount = opts.whiteKeyCount;
    this.synth = opts.synth;
    this.onActivity = opts.onActivity || (() => {});

    this.keyEls = new Map();
    this.activePointers = new Map();
    this._sustain = false;
    this._heldBySustain = new Set();

    this.render();
    this.attachPointerHandlers();
  }

  setStartMidi(midi) {
    this.startMidi = midi;
    this.synth.allOff();
    this.render();
  }

  setWhiteKeyCount(count) {
    this.whiteKeyCount = count;
    this.synth.allOff();
    this.render();
  }

  render() {
    this.root.innerHTML = '';
    this.keyEls.clear();

    const midis = [];
    let cursor = this.startMidi;
    let whitesFound = 0;
    while (whitesFound < this.whiteKeyCount) {
      midis.push(cursor);
      if (!isBlackKey(cursor)) whitesFound += 1;
      cursor += 1;
    }

    const whiteWidthPct = 100 / this.whiteKeyCount;
    let whiteIndex = 0;

    for (const midi of midis) {
      if (isBlackKey(midi)) continue;
      const el = this.makeKeyEl(midi, false);
      el.style.left = `${whiteIndex * whiteWidthPct}%`;
      el.style.width = `calc(${whiteWidthPct}% - 2px)`;
      this.root.appendChild(el);
      this.keyEls.set(midi, el);
      whiteIndex += 1;
    }

    whiteIndex = 0;
    for (const midi of midis) {
      if (!isBlackKey(midi)) {
        whiteIndex += 1;
        continue;
      }
      const blackWidthPct = whiteWidthPct * 0.62;
      const center = whiteIndex * whiteWidthPct;
      const leftPct = center - blackWidthPct / 2;
      const el = this.makeKeyEl(midi, true);
      el.style.left = `${leftPct}%`;
      el.style.width = `${blackWidthPct}%`;
      this.root.appendChild(el);
      this.keyEls.set(midi, el);
    }
  }

  makeKeyEl(midi, black) {
    const el = document.createElement('div');
    el.className = `piano-key ${black ? 'black' : 'white'}`;
    if (isC(midi) && !black) el.classList.add('is-c');
    el.dataset.midi = String(midi);
    el.setAttribute('role', 'button');
    const noteName = midiToName(midi);
    el.setAttribute('aria-label', `Play ${noteName}`);
    el.setAttribute('aria-pressed', 'false');
    const kbd = this.kbdForMidi(midi);
    if (kbd) {
      el.setAttribute('aria-keyshortcuts', kbd);
      el.classList.add('qwerty-mapped');
    }
    if (!black) el.setAttribute('tabindex', '0');

    const label = document.createElement('span');
    label.className = 'key-label';

    // Render the note name on every white key. CSS decides whether to show
    // it: by default only C is shown (with full octave), but on mobile we
    // show all white keys with just the pitch letter.
    if (!black) {
      const noteSpan = document.createElement('span');
      noteSpan.className = 'note';
      // Full "C4" on C keys, just the letter ("D", "E", …) on the rest.
      noteSpan.textContent = isC(midi) ? noteName : noteName.replace(/\d+$/, '');
      label.appendChild(noteSpan);
    }

    if (kbd) {
      const kbdSpan = document.createElement('span');
      kbdSpan.className = 'kbd';
      kbdSpan.textContent = kbd.toUpperCase();
      label.appendChild(kbdSpan);
    }

    el.appendChild(label);
    return el;
  }

  kbdForMidi(midi) {
    const offset = midi - this.startMidi;
    for (const [k, v] of Object.entries(KEYBOARD_MAP)) {
      if (v === offset) return k;
    }
    return null;
  }

  midiForKbd(rawKey) {
    const key = rawKey.toLowerCase();
    const offset = KEYBOARD_MAP[key];
    if (offset === undefined) return null;
    return this.startMidi + offset;
  }

  attachPointerHandlers() {
    const startFromEvent = (event) => {
      const target = event.target.closest('.piano-key');
      if (!target) return null;
      return Number(target.dataset.midi);
    };

    // Drag-to-play: as long as a pointer is held down (anywhere), we keep
    // tracking it. The active note follows whichever key the pointer is
    // over — including dragging off the keyboard and back on. The map can
    // store `null` for "currently held but off-key".
    this.root.addEventListener('pointerdown', (event) => {
      const midi = startFromEvent(event);
      if (midi == null) return;
      this.root.setPointerCapture?.(event.pointerId);
      this.activePointers.set(event.pointerId, midi);
      this.pressVisual(midi, true);
      this.synth.noteOn(midi);
      this.onActivity(midi);
      event.preventDefault();
    });

    this.root.addEventListener('pointermove', (event) => {
      if (!this.activePointers.has(event.pointerId)) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const keyEl = target && target.closest && target.closest('.piano-key');
      const newMidi = keyEl ? Number(keyEl.dataset.midi) : null;
      const prevMidi = this.activePointers.get(event.pointerId);
      if (newMidi === prevMidi) return;
      if (prevMidi != null) {
        this.pressVisual(prevMidi, false);
        this.synth.noteOff(prevMidi);
      }
      if (newMidi != null) {
        this.pressVisual(newMidi, true);
        this.synth.noteOn(newMidi);
        this.onActivity(newMidi);
      }
      // Keep the pointer tracked even when off-key, so a subsequent drag
      // back over a key re-engages.
      this.activePointers.set(event.pointerId, newMidi);
    });

    const endPointer = (event) => {
      if (!this.activePointers.has(event.pointerId)) return;
      const midi = this.activePointers.get(event.pointerId);
      this.activePointers.delete(event.pointerId);
      if (midi == null) return;
      this.pressVisual(midi, false);
      if (!this._sustain) this.synth.noteOff(midi);
      else this._heldBySustain.add(midi);
    };
    this.root.addEventListener('pointerup', endPointer);
    this.root.addEventListener('pointercancel', endPointer);
    // Note: no `pointerleave` handler. Pointer capture means we keep
    // getting events even when the cursor leaves the element bounds, and
    // a leave handler would short-circuit drag-off-and-back-on behavior.
  }

  pressVisual(midi, on) {
    const el = this.keyEls.get(midi);
    if (!el) return;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  setSustain(on) {
    this._sustain = on;
    if (!on) {
      for (const midi of this._heldBySustain) {
        this.synth.noteOff(midi);
      }
      this._heldBySustain.clear();
    }
  }

  addToSustain(midi) {
    if (this._sustain) this._heldBySustain.add(midi);
  }

  clearActiveVisuals() {
    this.root.querySelectorAll('.piano-key.active').forEach((el) => el.classList.remove('active'));
    this.root
      .querySelectorAll('.piano-key[aria-pressed="true"]')
      .forEach((el) => el.setAttribute('aria-pressed', 'false'));
  }
}
