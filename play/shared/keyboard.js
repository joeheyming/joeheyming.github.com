/**
 * Reusable on-screen piano keyboard renderer + input handler.
 *
 * Used by piano, accordion, and synth pages. Calls a host-provided synth
 * object that must implement `noteOn(midi)`, `noteOff(midi)`, `allOff()`.
 */
import { isBlackKey, isC, midiToName } from './audio.js';
import { createPointerSurface } from './pointer-surface.js';

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
    // Anchor for the QWERTY → MIDI mapping. By default it tracks
    // `startMidi` (free-play instruments want pressing `z` to play the
    // leftmost visible key — same as the original behavior, and the
    // octave-shift buttons on /play/piano move both together). Pages
    // that want a wide visible piano with QWERTY centered on a melodic
    // octave (piano-hero shows C2..C6 but maps `z` to C3) can pass an
    // explicit `kbdBase` to decouple the two; in that case octave-shift
    // calls to `setStartMidi` won't disturb the QWERTY anchor. The
    // on-key QWERTY labels (rendered when `.show-kbd` is on) follow
    // this anchor too, so the letters appear on the keys they actually
    // trigger.
    this._kbdBaseExplicit = typeof opts.kbdBase === 'number';
    this.kbdBase = this._kbdBaseExplicit ? opts.kbdBase : opts.startMidi;
    // Opt-in: render a pitch label on accidental keys too. Default off
    // because piano-style layouts squeeze the black keys above the
    // whites — there's no room for a label without crowding. Pages that
    // present accidentals as a separate row of full-size bars (e.g. the
    // mallets page's xylophone-style two-row layout) flip this on so
    // every bar reads as a discrete pitched target.
    this.labelAccidentals = opts.labelAccidentals === true;

    this.keyEls = new Map();
    this._sustain = false;
    this._heldBySustain = new Set();
    // Track which pointers are currently held, for sustain-aware release.
    // The PointerSurface owns the target tracking; this set just tells us
    // whether a pointer is "live" so onRelease can decide noteOff vs hold.
    this._activePointers = new Set();
    this._tapDelayMs = opts.tapDelayMs ?? 80;

    this.render();
    this.attachPointerHandlers();
  }

  setStartMidi(midi) {
    this.startMidi = midi;
    if (!this._kbdBaseExplicit) this.kbdBase = midi;
    this.synth.allOff();
    this.render();
  }

  setKbdBase(midi) {
    this.kbdBase = midi;
    this._kbdBaseExplicit = true;
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

    // Expose the white-key count as a CSS variable so stylesheets can
    // size the keyboard relative to it (e.g. enforcing a minimum
    // tap-target width by giving the keyboard `min-width: calc(var(--white-key-count) * 26px)`
    // and letting the stage scroll horizontally on phones).
    this.root.style.setProperty('--white-key-count', String(this.whiteKeyCount));

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

    // Render the note name on every natural — and, when `labelAccidentals`
    // is on, on each accidental too. CSS decides whether to show the
    // text: by default only C carries the full octave anchor ("C4"),
    // every other natural is just its pitch letter ("D", "E"…), and an
    // accidental (when labelled at all) reads as "C#", "D#", etc.
    if (!black || this.labelAccidentals) {
      const noteSpan = document.createElement('span');
      noteSpan.className = 'note';
      // Full "C4" on C keys, just the letter ("D", "E", …) on the rest.
      // Accidentals use the same trim — the octave already lives on the
      // adjacent C, so duplicating it on every sharp would clutter the
      // row.
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
    const offset = midi - this.kbdBase;
    for (const [k, v] of Object.entries(KEYBOARD_MAP)) {
      if (v === offset) return k;
    }
    return null;
  }

  midiForKbd(rawKey) {
    const key = rawKey.toLowerCase();
    const offset = KEYBOARD_MAP[key];
    if (offset === undefined) return null;
    return this.kbdBase + offset;
  }

  attachPointerHandlers() {
    // PointerSurface owns the pointerdown/move/up/cancel wiring, the
    // scroll-gesture deferral (tap-vs-pan-x on touch), and per-pointer
    // target tracking. We adapt its three callbacks to the keyboard's
    // sustain-on-press semantics:
    //   - onEnter  → noteOn (initial press OR drag-cross to a new key)
    //   - onLeave  → noteOff (drag-cross away mid-press)
    //   - onRelease → noteOff unless sustain is held
    this.surface = createPointerSurface(this.root, {
      targetSelector: '.piano-key',
      deferScrollOnTouch: true,
      tapDelayMs: this._tapDelayMs,
      onEnter: (target, ptrId) => {
        this._activePointers.add(ptrId);
        const midi = Number(target.dataset.midi);
        this.pressVisual(midi, true);
        this.synth.noteOn(midi);
        this.onActivity(midi);
      },
      onLeave: (target) => {
        const midi = Number(target.dataset.midi);
        this.pressVisual(midi, false);
        this.synth.noteOff(midi);
      },
      onRelease: (target, ptrId) => {
        this._activePointers.delete(ptrId);
        if (!target) return;
        const midi = Number(target.dataset.midi);
        this.pressVisual(midi, false);
        if (!this._sustain) this.synth.noteOff(midi);
        else this._heldBySustain.add(midi);
      }
    });
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
