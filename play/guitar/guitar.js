/**
 * Browser guitar: a clickable fretboard rendered as 6 string rows × 13 fret
 * columns (open + 12). Plucks notes through soundfont-player guitar samples,
 * with strum buttons that fire chord shapes top-to-bottom.
 */
import { midiToName, resumeIfSuspended, setMasterVolume, SampleVoice } from '../shared/audio.js';
import { setupMidi } from '../shared/midi.js';
import { makePrefs } from '../shared/prefs.js';

const Prefs = makePrefs('play.guitar.prefs.v1');

// Standard tuning, low E (string 6) at the bottom of the visual stack so it
// matches a guitar held in playing position. We render high-to-low though,
// since visually that's also intuitive (high strings on top).
const STRING_TUNING = [
  { name: 'E', midi: 64, thickness: 1.4 }, // 1 - high E
  { name: 'B', midi: 59, thickness: 1.6 }, // 2 - B
  { name: 'G', midi: 55, thickness: 1.8 }, // 3 - G
  { name: 'D', midi: 50, thickness: 2.2 }, // 4 - D
  { name: 'A', midi: 45, thickness: 2.6 }, // 5 - A
  { name: 'E', midi: 40, thickness: 3.0 } // 6 - low E
];

const FRET_COUNT = 12;
const SINGLE_DOT_FRETS = [3, 5, 7, 9];
const DOUBLE_DOT_FRETS = [12];

/**
 * Chord shape library — comprehensive enough to pick most common chords by
 * root + quality, with one or more voicings (open / barre / higher) per
 * shape. Each `frets` array is HIGH-E-FIRST (string index 0 → 5), where -1
 * means "muted" (don't strum) and 0 means "open".
 *
 * Keys are `${ROOT_PC}|${QUALITY}` where ROOT_PC is the pitch class index
 * (0=C, 1=C♯, …, 11=B) and QUALITY is one of: maj, min, 7, maj7, m7,
 * sus2, sus4. We use pitch class instead of letter names so enharmonic
 * spellings (C♯ vs D♭) collapse to the same entry.
 */
const ROOTS = [
  { name: 'C', pc: 0 },
  { name: 'C♯', pc: 1 },
  { name: 'D', pc: 2 },
  { name: 'D♯', pc: 3 },
  { name: 'E', pc: 4 },
  { name: 'F', pc: 5 },
  { name: 'F♯', pc: 6 },
  { name: 'G', pc: 7 },
  { name: 'G♯', pc: 8 },
  { name: 'A', pc: 9 },
  { name: 'A♯', pc: 10 },
  { name: 'B', pc: 11 }
];

const QUALITIES = [
  { id: 'maj', label: 'Major', suffix: '' },
  { id: 'min', label: 'Minor', suffix: 'm' },
  { id: '7', label: '7', suffix: '7' },
  { id: 'maj7', label: 'maj7', suffix: 'maj7' },
  { id: 'm7', label: 'm7', suffix: 'm7' },
  { id: 'sus2', label: 'sus2', suffix: 'sus2' },
  { id: 'sus4', label: 'sus4', suffix: 'sus4' }
];

/**
 * Pitch-class intervals from the root for each chord quality. Used to
 * (a) figure out which fretted note is the root for highlighting, and
 * (b) potentially derive shapes algorithmically in the future.
 */
const QUALITY_INTERVALS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7]
};

/**
 * Hand-curated voicings keyed by `pc|quality`. Order within each list
 * matters — first voicing is the default offered when the user picks a
 * Root + Quality. Where a quality has no curated shape we fall back to a
 * computed barre (see `barreShape` below).
 */
const CHORD_VOICINGS = {
  // C
  '0|maj': [
    { name: 'Open', frets: [0, 1, 0, 2, 3, -1] },
    { name: 'Barre 3', frets: [3, 5, 5, 5, 3, -1] },
    { name: 'Barre 8', frets: [8, 8, 9, 10, 10, 8] }
  ],
  '0|min': [
    { name: 'Barre 3', frets: [3, 4, 5, 5, 3, -1] },
    { name: 'Barre 8', frets: [8, 8, 8, 10, 10, 8] }
  ],
  '0|7': [{ name: 'Open', frets: [0, 1, 3, 2, 3, -1] }],
  '0|maj7': [{ name: 'Open', frets: [0, 0, 0, 2, 3, -1] }],
  '0|m7': [{ name: 'Barre 3', frets: [3, 4, 3, 5, 3, -1] }],
  '0|sus2': [{ name: 'Open', frets: [3, 3, 0, 2, 3, -1] }],
  '0|sus4': [{ name: 'Open', frets: [1, 1, 0, 2, 3, -1] }],

  // D
  '2|maj': [
    { name: 'Open', frets: [2, 3, 2, 0, -1, -1] },
    { name: 'Barre 5', frets: [5, 7, 7, 7, 5, -1] }
  ],
  '2|min': [
    { name: 'Open', frets: [1, 3, 2, 0, -1, -1] },
    { name: 'Barre 5', frets: [5, 6, 7, 7, 5, -1] }
  ],
  '2|7': [{ name: 'Open', frets: [2, 1, 2, 0, -1, -1] }],
  '2|maj7': [{ name: 'Open', frets: [2, 2, 2, 0, -1, -1] }],
  '2|m7': [{ name: 'Open', frets: [1, 1, 2, 0, -1, -1] }],
  '2|sus2': [{ name: 'Open', frets: [0, 3, 2, 0, -1, -1] }],
  '2|sus4': [{ name: 'Open', frets: [3, 3, 2, 0, -1, -1] }],

  // E
  '4|maj': [
    { name: 'Open', frets: [0, 0, 1, 2, 2, 0] },
    { name: 'Barre 7', frets: [7, 9, 9, 9, 7, -1] }
  ],
  '4|min': [
    { name: 'Open', frets: [0, 0, 0, 2, 2, 0] },
    { name: 'Barre 7', frets: [7, 8, 9, 9, 7, -1] }
  ],
  '4|7': [{ name: 'Open', frets: [0, 0, 1, 0, 2, 0] }],
  '4|maj7': [{ name: 'Open', frets: [0, 0, 1, 1, 2, 0] }],
  '4|m7': [{ name: 'Open', frets: [0, 0, 0, 0, 2, 0] }],
  '4|sus2': [{ name: 'Barre 2', frets: [2, 2, 4, 4, 2, -1] }],
  '4|sus4': [{ name: 'Open', frets: [0, 0, 2, 2, 2, 0] }],

  // F
  '5|maj': [
    { name: 'Barre 1', frets: [1, 1, 2, 3, 3, 1] },
    { name: 'Mini barre', frets: [1, 1, 2, 3, -1, -1] }
  ],
  '5|min': [{ name: 'Barre 1', frets: [1, 1, 1, 3, 3, 1] }],
  '5|7': [{ name: 'Barre 1', frets: [1, 1, 2, 1, 3, 1] }],
  '5|maj7': [{ name: 'Open', frets: [0, 1, 2, 3, -1, -1] }],
  '5|m7': [{ name: 'Barre 1', frets: [1, 1, 1, 1, 3, 1] }],
  '5|sus2': [{ name: 'Barre 1', frets: [1, 1, 3, 3, -1, -1] }],
  '5|sus4': [{ name: 'Barre 1', frets: [1, 1, 3, 3, 3, 1] }],

  // G
  '7|maj': [
    { name: 'Open', frets: [3, 0, 0, 0, 2, 3] },
    { name: 'Big G', frets: [3, 3, 0, 0, 2, 3] },
    { name: 'Barre 3', frets: [3, 3, 4, 5, 5, 3] }
  ],
  '7|min': [{ name: 'Barre 3', frets: [3, 3, 3, 5, 5, 3] }],
  '7|7': [{ name: 'Open', frets: [1, 0, 0, 0, 2, 3] }],
  '7|maj7': [{ name: 'Open', frets: [2, 0, 0, 0, 2, 3] }],
  '7|m7': [{ name: 'Barre 3', frets: [3, 3, 3, 3, 5, 3] }],
  '7|sus2': [{ name: 'Open', frets: [3, 3, 0, 0, -1, 3] }],
  '7|sus4': [{ name: 'Open', frets: [3, 1, 0, 0, 2, 3] }],

  // A
  '9|maj': [
    { name: 'Open', frets: [0, 2, 2, 2, 0, -1] },
    { name: 'Barre 5', frets: [5, 5, 6, 7, 7, 5] }
  ],
  '9|min': [
    { name: 'Open', frets: [0, 1, 2, 2, 0, -1] },
    { name: 'Barre 5', frets: [5, 5, 5, 7, 7, 5] }
  ],
  '9|7': [{ name: 'Open', frets: [0, 2, 0, 2, 0, -1] }],
  '9|maj7': [{ name: 'Open', frets: [0, 2, 1, 2, 0, -1] }],
  '9|m7': [{ name: 'Open', frets: [0, 1, 0, 2, 0, -1] }],
  '9|sus2': [{ name: 'Open', frets: [0, 0, 2, 2, 0, -1] }],
  '9|sus4': [{ name: 'Open', frets: [0, 3, 2, 2, 0, -1] }],

  // B
  // Barre 2 (A-shape) and Barre 7 (E-shape) both root the chord at B2 — an
  // A-shape at fret N and an E-shape at fret N+5 share the same bass on a
  // standard-tuned guitar. Barre 9 (D-shape) shifts the root onto the D
  // string at fret 9 so the whole chord sits an octave higher (bass B3).
  '11|maj': [
    { name: 'Barre 2', frets: [2, 4, 4, 4, 2, -1] },
    { name: 'Barre 7', frets: [7, 7, 8, 9, 9, 7] },
    { name: 'Barre 9 (high)', frets: [11, 12, 11, 9, -1, -1] }
  ],
  '11|min': [
    { name: 'Barre 2', frets: [2, 3, 4, 4, 2, -1] },
    { name: 'Barre 7', frets: [7, 7, 7, 9, 9, 7] },
    { name: 'Barre 9 (high)', frets: [10, 12, 11, 9, -1, -1] }
  ],
  '11|7': [{ name: 'Open', frets: [2, 0, 2, 1, 2, -1] }],
  '11|maj7': [{ name: 'Barre 2', frets: [2, 4, 3, 4, 2, -1] }],
  '11|m7': [{ name: 'Barre 2', frets: [2, 3, 2, 4, 2, -1] }]
};

/**
 * For sharp roots (C♯, D♯, F♯, G♯, A♯) we fall back to derived shapes
 * computed by sliding the relevant E-shape or A-shape barre up a semitone.
 * `referencePc` says which natural-root voicing list to derive from (B-shape
 * is the simplest: B-major barre 7 → C♯-major barre 9 by adding 2 frets,
 * etc.). We pick whichever neighbour is one fret away.
 */
const BARRE_SHIFTS = [
  { from: 0, to: 1, delta: 1 }, // C → C♯
  { from: 2, to: 3, delta: 1 }, // D → D♯
  { from: 5, to: 6, delta: 1 }, // F → F♯
  { from: 7, to: 8, delta: 1 }, // G → G♯
  { from: 9, to: 10, delta: 1 } // A → A♯
];

const shiftFrets = (frets, delta) => frets.map((f) => (f < 0 ? -1 : f + delta));

const isShapePlayable = (frets) => frets.every((f) => f < 0 || f <= 14);

const lookupVoicings = (pc, quality) => {
  const direct = CHORD_VOICINGS[`${pc}|${quality}`];
  if (direct) return direct;
  // Try to derive sharp/flat roots from a neighbour.
  const shift = BARRE_SHIFTS.find((s) => s.to === pc);
  if (shift) {
    const base = CHORD_VOICINGS[`${shift.from}|${quality}`];
    if (base) {
      const derived = base
        .filter((v) => /barre/i.test(v.name)) // only barre shapes shift cleanly
        .map((v) => ({
          name: v.name,
          frets: shiftFrets(v.frets, shift.delta)
        }))
        .filter((v) => isShapePlayable(v.frets));
      if (derived.length) return derived;
    }
  }
  return [];
};

class Guitar {
  constructor() {
    this.toneName = '';
    this.voice = null;
  }

  async setTone(name) {
    if (this.toneName === name && this.voice) return;
    if (this.voice) this.voice.allOff();
    this.toneName = name;
    this.voice = new SampleVoice(name);
    await this.voice.load();
  }

  isReady() {
    return !!this.voice?.isReady();
  }

  pluck(midi) {
    if (!this.voice || !this.voice.isReady()) return false;
    resumeIfSuspended();
    // Each pluck is its own one-shot; release the previous one for that note
    // so machine-gun strumming the same string doesn't blow up the mixer.
    this.voice.noteOff(midi);
    this.voice.noteOn(midi);
    return true;
  }

  strum(notes, direction = 'down') {
    if (!this.voice) return;
    const ordered = direction === 'down' ? [...notes] : [...notes].reverse();
    const stagger = 0.022; // seconds between adjacent strings
    let delay = 0;
    for (const midi of ordered) {
      if (midi == null) continue;
      setTimeout(() => this.pluck(midi), delay * 1000);
      delay += stagger;
    }
  }
}

// ---------- Page wiring ----------

const fretboardEl = document.getElementById('fretboard');
const rootOptionsEl = document.getElementById('root-options');
const qualityOptionsEl = document.getElementById('quality-options');
const voicingOptionsEl = document.getElementById('voicing-options');
const strumButton = document.getElementById('strum-button');
const clearShapeButton = document.getElementById('clear-shape');
const chordCurrentEl = document.getElementById('chord-current');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const toneEl = document.getElementById('tone');
const showNotesEl = document.getElementById('show-notes');
const toneStatus = document.getElementById('tone-status');
const midiStatusEl = document.getElementById('midi-status');

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.tone === 'string') {
  const opt = Array.from(toneEl.options).find((o) => o.value === prefs.tone);
  if (opt) toneEl.value = prefs.tone;
}
if (typeof prefs.showNotes === 'boolean') showNotesEl.checked = prefs.showNotes;

const guitar = new Guitar();
setMasterVolume(Number(volumeEl.value) / 100);

// Map cell elements by `string-fret` for quick visual flash lookup.
const cellEls = new Map();

function buildFretboard() {
  fretboardEl.innerHTML = '';
  fretboardEl.classList.toggle('hide-notes', !showNotesEl.checked);

  // Inlay overlay sits *behind* the strings (z-index: 0) so the position
  // dots show through the fretboard wood without colliding with note
  // labels. Painted first so it ends up first in source order; CSS handles
  // stacking explicitly.
  const inlays = document.createElement('div');
  inlays.className = 'fretboard-inlays';
  inlays.setAttribute('aria-hidden', 'true');
  const addInlay = (fret, isDouble) => {
    const slot = document.createElement('div');
    slot.className = isDouble ? 'inlay double' : 'inlay';
    slot.style.gridColumn = String(fret);
    inlays.appendChild(slot);
  };
  SINGLE_DOT_FRETS.forEach((f) => addInlay(f, false));
  DOUBLE_DOT_FRETS.forEach((f) => addInlay(f, true));
  fretboardEl.appendChild(inlays);

  STRING_TUNING.forEach((str, stringIdx) => {
    const row = document.createElement('div');
    row.className = 'fretboard-string';
    row.style.setProperty('--string-thickness', `${str.thickness}px`);

    for (let fret = 0; fret <= FRET_COUNT; fret++) {
      const midi = str.midi + fret;
      const cell = document.createElement('div');
      cell.className = 'fret-cell' + (fret === 0 ? ' open' : '');
      cell.dataset.midi = String(midi);
      cell.dataset.string = String(stringIdx);
      cell.dataset.fret = String(fret);

      const labelText = fret === 0 ? str.name : midiToName(midi).replace(/\d+$/, '');
      const labelSpan = document.createElement('span');
      labelSpan.className = 'note';
      labelSpan.textContent = labelText;
      cell.appendChild(labelSpan);

      row.appendChild(cell);
      cellEls.set(`${stringIdx}-${fret}`, cell);
    }

    fretboardEl.appendChild(row);
  });
}

let nowPlayingTimer = null;
const announceNote = (midi) => {
  nowPlaying.textContent = midiToName(midi);
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    nowPlaying.classList.remove('active');
  }, 350);
};

const flashCell = (stringIdx, fret) => {
  const el = cellEls.get(`${stringIdx}-${fret}`);
  if (!el) return;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 280);
};

const playFret = (stringIdx, fret) => {
  const midi = STRING_TUNING[stringIdx].midi + fret;
  if (!guitar.pluck(midi)) return;
  flashCell(stringIdx, fret);
  announceNote(midi);
};

// Pluck on press, then re-pluck whenever the pointer drags over a new
// cell — so a swipe across strings strums, and a swipe up a string runs
// the scale.
const lastCellByPointer = new Map();

const pluckFromCell = (cell, pointerId) => {
  if (!cell) return;
  if (lastCellByPointer.get(pointerId) === cell) return;
  lastCellByPointer.set(pointerId, cell);
  const stringIdx = Number(cell.dataset.string);
  const fret = Number(cell.dataset.fret);
  playFret(stringIdx, fret);
};

fretboardEl.addEventListener('pointerdown', (event) => {
  const cell = event.target.closest('.fret-cell');
  if (!cell) return;
  fretboardEl.setPointerCapture?.(event.pointerId);
  pluckFromCell(cell, event.pointerId);
  event.preventDefault();
});

fretboardEl.addEventListener('pointermove', (event) => {
  if (!lastCellByPointer.has(event.pointerId)) return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const cell = target && target.closest && target.closest('.fret-cell');
  if (cell) pluckFromCell(cell, event.pointerId);
});

const endGuitarPointer = (event) => {
  lastCellByPointer.delete(event.pointerId);
};
fretboardEl.addEventListener('pointerup', endGuitarPointer);
fretboardEl.addEventListener('pointercancel', endGuitarPointer);

// ---------- Chord builder ----------

const builderState = {
  rootPc: 0, // default to C
  qualityId: 'maj',
  voicingIdx: 0
};

// Track the currently-displayed chord shape so we can clear it before
// painting a new one.
const chordShapeCells = new Set();

const clearChordShape = () => {
  chordShapeCells.forEach((el) => {
    el.classList.remove('in-chord', 'in-chord-root', 'muted');
  });
  chordShapeCells.clear();
};

/**
 * Highlight the chord shape on the fretboard and leave it in place. Each
 * fretted note gets `.in-chord`; the lowest sounded note that matches the
 * root pitch class additionally gets `.in-chord-root`. Muted strings get
 * an "×" badge on their open-string label cell.
 */
const paintChordShape = (frets, rootPc) => {
  clearChordShape();
  const rootCellByString = new Map();
  let bestRootStringIdx = -1;
  let bestRootFret = Number.POSITIVE_INFINITY;

  frets.forEach((fret, stringIdx) => {
    if (fret < 0) {
      // Mute marker on the open-string cell (the leftmost cell of the row).
      const openCell = cellEls.get(`${stringIdx}-0`);
      if (openCell) {
        openCell.classList.add('muted');
        chordShapeCells.add(openCell);
      }
      return;
    }
    const cell = cellEls.get(`${stringIdx}-${fret}`);
    if (!cell) return;
    cell.classList.add('in-chord');
    chordShapeCells.add(cell);

    // Track the lowest-pitch sounding root note (= highest string index
    // wrt our high-first array, since string 5 is low E).
    const midi = STRING_TUNING[stringIdx].midi + fret;
    if (midi % 12 === rootPc) {
      if (
        stringIdx > bestRootStringIdx ||
        (stringIdx === bestRootStringIdx && fret < bestRootFret)
      ) {
        bestRootStringIdx = stringIdx;
        bestRootFret = fret;
      }
      rootCellByString.set(stringIdx, cell);
    }
  });

  // Promote the lowest root to `.in-chord-root`.
  if (bestRootStringIdx >= 0) {
    const rootCell = cellEls.get(`${bestRootStringIdx}-${bestRootFret}`);
    if (rootCell) {
      rootCell.classList.remove('in-chord');
      rootCell.classList.add('in-chord-root');
    }
  }
};

const chordDisplayName = () => {
  const root = ROOTS.find((r) => r.pc === builderState.rootPc);
  const q = QUALITIES.find((q) => q.id === builderState.qualityId);
  if (!root || !q) return '';
  return `${root.name}${q.suffix}`;
};

const refreshCurrentLabel = (voicingName) => {
  if (!chordCurrentEl) return;
  const name = chordDisplayName();
  if (!name) {
    chordCurrentEl.textContent = '';
    return;
  }
  chordCurrentEl.innerHTML = `<strong>${name}</strong>${voicingName ? ` · ${voicingName}` : ''}`;
};

const renderRoots = () => {
  rootOptionsEl.innerHTML = '';
  ROOTS.forEach((root) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.pc = String(root.pc);
    btn.textContent = root.name;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(root.pc === builderState.rootPc));
    if (root.pc === builderState.rootPc) btn.classList.add('selected');
    rootOptionsEl.appendChild(btn);
  });
};

const renderQualities = () => {
  qualityOptionsEl.innerHTML = '';
  QUALITIES.forEach((q) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.quality = q.id;
    btn.textContent = q.label;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(q.id === builderState.qualityId));
    if (q.id === builderState.qualityId) btn.classList.add('selected');
    qualityOptionsEl.appendChild(btn);
  });
};

const renderVoicings = () => {
  voicingOptionsEl.innerHTML = '';
  const voicings = lookupVoicings(builderState.rootPc, builderState.qualityId);
  if (!voicings.length) {
    const empty = document.createElement('span');
    empty.className = 'chord-options-empty';
    empty.textContent = 'No shape on file for this combo yet.';
    voicingOptionsEl.appendChild(empty);
    if (strumButton) strumButton.disabled = true;
    refreshCurrentLabel('');
    return;
  }
  if (strumButton) strumButton.disabled = false;
  if (builderState.voicingIdx >= voicings.length) builderState.voicingIdx = 0;
  voicings.forEach((v, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.voicingIdx = String(idx);
    btn.textContent = v.name;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(idx === builderState.voicingIdx));
    if (idx === builderState.voicingIdx) btn.classList.add('selected');
    voicingOptionsEl.appendChild(btn);
  });
  refreshCurrentLabel(voicings[builderState.voicingIdx]?.name || '');
};

const playSelectedVoicing = (autoStrum = true) => {
  const voicings = lookupVoicings(builderState.rootPc, builderState.qualityId);
  const v = voicings[builderState.voicingIdx];
  if (!v) return;
  paintChordShape(v.frets, builderState.rootPc);
  if (autoStrum) {
    // frets is high-string-first → for a "down strum" we go low→high.
    const notes = v.frets.map((f, i) => (f < 0 ? null : STRING_TUNING[i].midi + f)).reverse(); // low-E first, high-E last
    guitar.strum(notes, 'down');
    // Sequential flash on top of the persistent highlight.
    let delay = 0;
    [...v.frets]
      .map((f, i) => ({ stringIdx: i, fret: f }))
      .reverse()
      .forEach(({ stringIdx, fret }) => {
        if (fret < 0) return;
        setTimeout(() => flashCell(stringIdx, fret), delay);
        delay += 22;
      });
    // Announce the root note (lowest sounded copy).
    for (let s = 5; s >= 0; s--) {
      if (v.frets[s] < 0) continue;
      const midi = STRING_TUNING[s].midi + v.frets[s];
      if (midi % 12 === builderState.rootPc) {
        announceNote(midi);
        return;
      }
    }
    // Fallback: announce the lowest sounded note.
    for (let s = 5; s >= 0; s--) {
      if (v.frets[s] < 0) continue;
      announceNote(STRING_TUNING[s].midi + v.frets[s]);
      return;
    }
  }
  refreshCurrentLabel(v.name);
};

rootOptionsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  builderState.rootPc = Number(btn.dataset.pc);
  builderState.voicingIdx = 0;
  renderRoots();
  renderVoicings();
  playSelectedVoicing();
});

qualityOptionsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  builderState.qualityId = btn.dataset.quality;
  builderState.voicingIdx = 0;
  renderQualities();
  renderVoicings();
  playSelectedVoicing();
});

voicingOptionsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  builderState.voicingIdx = Number(btn.dataset.voicingIdx);
  renderVoicings();
  playSelectedVoicing();
});

strumButton?.addEventListener('click', () => playSelectedVoicing());

clearShapeButton?.addEventListener('click', () => {
  clearChordShape();
  refreshCurrentLabel('');
});

const updateToneStatus = () => {
  if (!toneStatus) return;
  toneStatus.textContent = guitar.isReady() ? '' : 'loading…';
};

const switchTone = (name) => {
  toneStatus.textContent = 'loading…';
  guitar.setTone(name).then(updateToneStatus);
};

// Pre-warm on first user interaction.
let warmed = false;
const warm = () => {
  if (warmed) return;
  warmed = true;
  switchTone(toneEl.value);
};
document.addEventListener('pointerdown', warm, { once: true });
document.addEventListener('keydown', warm, { once: true });

// Build UI
buildFretboard();
renderRoots();
renderQualities();
renderVoicings();
refreshCurrentLabel('');

// ---------- Controls ----------
volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  Prefs.save({
    volume: Number(volumeEl.value),
    tone: toneEl.value,
    showNotes: showNotesEl.checked
  });
});

toneEl.addEventListener('change', () => {
  switchTone(toneEl.value);
  Prefs.save({
    volume: Number(volumeEl.value),
    tone: toneEl.value,
    showNotes: showNotesEl.checked
  });
});

showNotesEl.addEventListener('change', () => {
  fretboardEl.classList.toggle('hide-notes', !showNotesEl.checked);
  Prefs.save({
    volume: Number(volumeEl.value),
    tone: toneEl.value,
    showNotes: showNotesEl.checked
  });
});

window.addEventListener('focus', () => resumeIfSuspended());

setupMidi({
  statusEl: midiStatusEl,
  onNoteOn: (note) => {
    // For MIDI input, just play the note on the closest fretted position.
    if (!guitar.pluck(note)) return;
    announceNote(note);
    // Find the highest string whose open is ≤ note and fret 0..12 reaches it.
    for (let s = STRING_TUNING.length - 1; s >= 0; s--) {
      const open = STRING_TUNING[s].midi;
      const fret = note - open;
      if (fret >= 0 && fret <= FRET_COUNT) {
        flashCell(s, fret);
        break;
      }
    }
  },
  onNoteOff: () => {
    /* guitar plucks decay naturally */
  }
});
