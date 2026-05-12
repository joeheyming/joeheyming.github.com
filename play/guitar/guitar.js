/**
 * Strings page — fretboard renderer + chord builder + audio dispatch.
 *
 * The instrument catalog (Guitar / Bass / Ukulele / Banjo / Mandolin)
 * lives in `instruments.js`. The audio engine that hides the
 * sample-vs-soundfont distinction lives in `engine.js`. The
 * EADGBE-tuned chord library lives in `chords.js`. This file is just
 * page wiring: render the fretboard for the active instrument, handle
 * pointer plucks, drive the chord builder (guitar-only), persist prefs,
 * and route MIDI input.
 */
import { midiToName, resumeIfSuspended, setMasterVolume } from '../shared/audio.js';
import { setupMidi } from '../shared/midi.js';
import { makePrefs } from '../shared/prefs.js';
import { createScrollGesture } from '../shared/scroll-gesture.js';
import { INSTRUMENTS, DEFAULT_INSTRUMENT_ID, getInstrument, midiAtCell } from './instruments.js';
import {
  ROOTS,
  QUALITIES,
  getChordVoicings,
  assignFingers,
  detectBarre,
  parseChordName,
  formatChordName
} from './chords.js';
import { StringEngine } from './engine.js';

const Prefs = makePrefs('play.guitar.prefs.v1');

// ---------- DOM refs ----------

const fretboardEl = document.getElementById('fretboard');
const rootOptionsEl = document.getElementById('root-options');
const qualityOptionsEl = document.getElementById('quality-options');
const voicingOptionsEl = document.getElementById('voicing-options');
const strumButton = document.getElementById('strum-button');
const clearShapeButton = document.getElementById('clear-shape');
const chordBuilderEl = document.querySelector('.chord-builder');
const chordCurrentEl = document.getElementById('chord-current');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const instrumentEl = document.getElementById('instrument');
const toneEl = document.getElementById('tone');
const showNotesEl = document.getElementById('show-notes');
const toneStatus = document.getElementById('tone-status');
const helpStringsEl = document.getElementById('help-strings');
const midiStatusEl = document.getElementById('midi-status');

// Strum Bar — primary one-tap play surface above the chord matrix.
const strumBarEl = document.getElementById('strum-bar');
const strumPadsEl = document.getElementById('strum-bar-pads');
const strumAddBtn = document.getElementById('strum-bar-add');
const strumPopoverEl = document.getElementById('strum-bar-add-popover');
const strumInputEl = document.getElementById('strum-bar-add-input');
const strumSuggestionsEl = document.getElementById('strum-bar-suggestions');

// ---------- Prefs hydration + per-instrument tone memory ----------

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.showNotes === 'boolean') showNotesEl.checked = prefs.showNotes;

// Older saved prefs only have a single `tone` field (back when this page
// was guitar-only); honour it as a guitar-tone hint and migrate it into
// the per-instrument map below.
const initialInstrumentId =
  typeof prefs.instrument === 'string' && INSTRUMENTS[prefs.instrument]
    ? prefs.instrument
    : DEFAULT_INSTRUMENT_ID;

let activeInstrument = getInstrument(initialInstrumentId);

// `tonesPerInstrument` remembers each instrument's last-picked tone so a
// player who hops Guitar → Bass → Guitar comes back to the same overdriven
// voice they had before, not the default acoustic.
const tonesPerInstrument =
  prefs.tonesPerInstrument && typeof prefs.tonesPerInstrument === 'object'
    ? { ...prefs.tonesPerInstrument }
    : {};
if (!tonesPerInstrument.guitar && typeof prefs.tone === 'string') {
  tonesPerInstrument.guitar = prefs.tone;
}

// Strum Bar palette per-instrument. Each entry is `{ rootPc: 0..11,
// qualityId: 'maj'|'min'|'7'|… }`. Voicing isn't stored — pads always
// strum the default voicing (`getChordVoicings()[0]`); the matrix
// below stays the place to pick a non-default shape.
//
// Capped at STRUM_BAR_MAX with LRU eviction so the row doesn't sprawl.
const STRUM_BAR_MAX = 8;

const sanitizeBarEntry = (e) => {
  if (!e || typeof e !== 'object') return null;
  const rootPc = Number(e.rootPc);
  if (!Number.isInteger(rootPc) || rootPc < 0 || rootPc > 11) return null;
  if (typeof e.qualityId !== 'string') return null;
  if (!QUALITIES.some((q) => q.id === e.qualityId)) return null;
  return { rootPc, qualityId: e.qualityId };
};

const strumBars =
  prefs.strumBars && typeof prefs.strumBars === 'object' ? { ...prefs.strumBars } : {};
for (const key of Object.keys(strumBars)) {
  strumBars[key] = Array.isArray(strumBars[key])
    ? strumBars[key].map(sanitizeBarEntry).filter(Boolean).slice(0, STRUM_BAR_MAX)
    : [];
}

const savePrefs = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    instrument: activeInstrument.id,
    tonesPerInstrument,
    strumBars,
    showNotes: showNotesEl.checked
  });
};

// ---------- Engine + state ----------

const engine = new StringEngine();
setMasterVolume(Number(volumeEl.value) / 100);

// Map cell elements by `string-fret` for quick visual flash + chord-shape lookup.
const cellEls = new Map();

// Chord builder state (guitar-only). Persisted across instrument
// switches so coming back to Guitar restores the last selected chord.
const builderState = {
  rootPc: 0,
  qualityId: 'maj',
  voicingIdx: 0
};
const chordShapeCells = new Set();

// ---------- Fretboard rendering ----------

function buildFretboard() {
  fretboardEl.innerHTML = '';
  cellEls.clear();
  chordShapeCells.clear();
  fretboardEl.classList.toggle('hide-notes', !showNotesEl.checked);

  const { tuning, fretCount, singleDots, doubleDots, paired } = activeInstrument;

  // Expose the fret count to CSS so the grid columns and the neck
  // min-width can scale with it (used by the horizontal-scroll layout
  // on narrow screens).
  fretboardEl.style.setProperty('--fret-count', String(fretCount));

  // Inner wrapper: holds the inlay overlay + string rows and owns the
  // `min-width` that drives horizontal scrolling. Putting both children
  // in the same containing block keeps the absolutely-positioned inlay
  // aligned with the string rows when the neck is wider than the viewport.
  const grid = document.createElement('div');
  grid.className = 'fretboard-grid';
  fretboardEl.appendChild(grid);

  // Inlay overlay sits *behind* the strings (z-index: 0) so the position
  // dots show through the fretboard wood without colliding with note
  // labels.
  const inlays = document.createElement('div');
  inlays.className = 'fretboard-inlays';
  inlays.setAttribute('aria-hidden', 'true');
  const addInlay = (fret, isDouble) => {
    const slot = document.createElement('div');
    slot.className = isDouble ? 'inlay double' : 'inlay';
    slot.style.gridColumn = String(fret);
    inlays.appendChild(slot);
  };
  singleDots.forEach((f) => addInlay(f, false));
  doubleDots.forEach((f) => addInlay(f, true));
  grid.appendChild(inlays);

  tuning.forEach((str, stringIdx) => {
    const row = document.createElement('div');
    row.className = 'fretboard-string' + (paired ? ' paired' : '');
    row.style.setProperty('--string-thickness', `${str.thickness}px`);
    const startFret = str.startFret || 0;
    // `--start-offset` shifts the string line right by N fret columns so
    // banjo's drone string doesn't render its line through the
    // unavailable cells (frets 0..startFret-1).
    if (startFret > 0) row.style.setProperty('--start-offset', String(startFret));

    for (let fret = 0; fret <= fretCount; fret++) {
      const cell = document.createElement('div');
      const isUnavailable = fret < startFret;
      const isStartOfDrone = fret === startFret && startFret > 0;
      // For "short" drone strings (banjo 5th), we don't render the
      // leftmost cells as `.open` — they get `.unavailable` instead so
      // the standard nut bar + open-string label don't appear above
      // unplayable cells. The drone's actual start cell (fret 5) gets
      // its own `.drone-start` adornment.
      const isOpen = fret === 0 && !isUnavailable;
      cell.className = 'fret-cell';
      if (isOpen) cell.classList.add('open');
      if (isUnavailable) cell.classList.add('unavailable');
      if (isStartOfDrone) cell.classList.add('drone-start');
      cell.dataset.string = String(stringIdx);
      cell.dataset.fret = String(fret);

      if (!isUnavailable) {
        const midi = str.midi + (fret - startFret);
        cell.dataset.midi = String(midi);
        const labelText =
          isOpen || isStartOfDrone ? str.name : midiToName(midi).replace(/\d+$/, '');
        const labelSpan = document.createElement('span');
        labelSpan.className = 'note';
        labelSpan.textContent = labelText;
        cell.appendChild(labelSpan);
      }

      row.appendChild(cell);
      cellEls.set(`${stringIdx}-${fret}`, cell);
    }

    grid.appendChild(row);
  });
}

// ---------- Pointer playback ----------

let nowPlayingTimer = null;
const announceNote = (midi) => {
  nowPlaying.textContent = midiToName(midi);
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => nowPlaying.classList.remove('active'), 350);
};

const flashCell = (stringIdx, fret) => {
  const el = cellEls.get(`${stringIdx}-${fret}`);
  if (!el) return;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 280);
};

const playFret = (stringIdx, fret) => {
  const midi = midiAtCell(activeInstrument, stringIdx, fret);
  if (midi == null) return;
  if (!engine.pluck(midi)) return;
  flashCell(stringIdx, fret);
  announceNote(midi);
};

const lastCellByPointer = new Map();

const pluckFromCell = (cell, pointerId) => {
  if (!cell || cell.classList.contains('unavailable')) return;
  if (lastCellByPointer.get(pointerId) === cell) return;
  lastCellByPointer.set(pointerId, cell);
  const stringIdx = Number(cell.dataset.string);
  const fret = Number(cell.dataset.fret);
  playFret(stringIdx, fret);
};

// Tap-deferral helper for touch input. The fretboard's `touch-action:
// pan-x` lets the browser handle horizontal scroll natively (with
// momentum). The util defers our pluck by ~80ms so a horizontal swipe
// — which the browser commits to as a scroll within ~10-20ms and then
// sends `pointercancel` to us — never accidentally fires a note.
const fretboardScrollGesture = createScrollGesture();

fretboardEl.addEventListener('pointerdown', (event) => {
  const cell = event.target.closest('.fret-cell');
  if (!cell || cell.classList.contains('unavailable')) return;
  try {
    fretboardEl.setPointerCapture?.(event.pointerId);
  } catch (_) {
    /* synthetic events may have no registered pointer */
  }
  fretboardScrollGesture.start(event, {
    play: () => pluckFromCell(cell, event.pointerId)
  });
  if (event.pointerType !== 'touch') event.preventDefault();
});

fretboardEl.addEventListener('pointermove', (event) => {
  if (!lastCellByPointer.has(event.pointerId)) return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const cell = target && target.closest && target.closest('.fret-cell');
  if (cell) pluckFromCell(cell, event.pointerId);
});

fretboardEl.addEventListener('pointerup', (event) => {
  fretboardScrollGesture.end(event.pointerId);
  lastCellByPointer.delete(event.pointerId);
});
fretboardEl.addEventListener('pointercancel', (event) => {
  fretboardScrollGesture.cancel(event.pointerId);
  lastCellByPointer.delete(event.pointerId);
});

// ---------- Chord builder (guitar-only) ----------

// Overlays for the barre (amber pill across barred strings) and the
// root cell (red disc, on top of the barre). Both live as siblings of
// the .fret-cell elements inside .fretboard-grid so they can fight a
// shared z-index battle (the strings row has its own z-index that's
// strictly below these — that's why we can't render either one as a
// pseudo-element of the cell itself).
let barreOverlayEl = null;
let rootOverlayEl = null;

const removeBarreOverlay = () => {
  if (barreOverlayEl && barreOverlayEl.parentNode) {
    barreOverlayEl.parentNode.removeChild(barreOverlayEl);
  }
  barreOverlayEl = null;
};

const removeRootOverlay = () => {
  if (rootOverlayEl && rootOverlayEl.parentNode) {
    rootOverlayEl.parentNode.removeChild(rootOverlayEl);
  }
  rootOverlayEl = null;
};

const clearChordShape = () => {
  chordShapeCells.forEach((el) => {
    el.classList.remove('in-chord', 'in-chord-root', 'in-chord-open', 'muted');
    delete el.dataset.finger;
    const badge = el.querySelector('.finger-badge');
    if (badge) badge.remove();
  });
  chordShapeCells.clear();
  removeBarreOverlay();
  removeRootOverlay();
};

/**
 * Position the barre overlay across the cells the index finger covers.
 *
 * The overlay lives inside `.fretboard-grid` (which absolutely-positions
 * its inlay layer the same way) so we can use the cell DOM rects to
 * compute the bar's geometry without re-implementing the grid maths in
 * CSS. Re-derived on every paint so window resizes / orientation
 * changes naturally re-place it on the next paint pass.
 */
const drawBarreOverlay = (barre) => {
  removeBarreOverlay();
  if (!barre) return;
  const grid = fretboardEl.querySelector('.fretboard-grid');
  if (!grid) return;
  const fromCell = cellEls.get(`${barre.fromString}-${barre.fret}`);
  const toCell = cellEls.get(`${barre.toString}-${barre.fret}`);
  if (!fromCell || !toCell) return;
  const gridRect = grid.getBoundingClientRect();
  const fromRect = fromCell.getBoundingClientRect();
  const toRect = toCell.getBoundingClientRect();
  // The bar spans from the higher string row's top (smaller stringIdx
  // = top of the array but visually lower? No — string 0 = highest
  // pitch = top row of the fretboard since we render high-first).
  // fromString < toString in our array, so fromCell is visually above
  // toCell, hence we span fromCell.top → toCell.bottom.
  const top = Math.min(fromRect.top, toRect.top) - gridRect.top;
  const bottom = Math.max(fromRect.bottom, toRect.bottom) - gridRect.top;
  const left = fromRect.left - gridRect.left;
  const width = fromRect.width;

  const el = document.createElement('div');
  el.className = 'chord-barre';
  el.style.top = `${top + 4}px`;
  el.style.height = `${bottom - top - 8}px`;
  el.style.left = `${left + 6}px`;
  el.style.width = `${width - 12}px`;
  el.setAttribute('aria-hidden', 'true');
  // The "1" label sits on the left end so it doesn't collide with finger
  // badges on cells that aren't part of the barre. Label uses the
  // actual barring finger (usually 1, but chord-data has finger 3 / 4
  // mini-barres for some open shapes like Am add9 or "open Am+").
  const fingerLabel = barre.finger || 1;
  el.innerHTML = `<span class="chord-barre-label">${fingerLabel}</span>`;
  grid.appendChild(el);
  barreOverlayEl = el;
};

const setFingerBadge = (cell, label) => {
  let badge = cell.querySelector('.finger-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'finger-badge';
    cell.appendChild(badge);
  }
  badge.textContent = label;
};

/**
 * Render the root marker on top of the barre overlay (and on top of
 * any cell-level chord-tone disc). Same DOM-rect approach as the
 * barre — read the cell's bounding rect, position an overlay element
 * inside .fretboard-grid. Finger number, when present, sits as a
 * superscript next to the "R" label so the player still knows which
 * finger to use without losing the root identification.
 */
const drawRootOverlay = (rootCell, fingerNumber) => {
  removeRootOverlay();
  if (!rootCell) return;
  const grid = fretboardEl.querySelector('.fretboard-grid');
  if (!grid) return;
  const gridRect = grid.getBoundingClientRect();
  const rect = rootCell.getBoundingClientRect();
  const top = rect.top - gridRect.top + 3;
  const left = rect.left - gridRect.left + 5;
  const width = rect.width - 10;
  const height = rect.height - 6;

  const el = document.createElement('div');
  el.className = 'chord-root-marker';
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.setAttribute('aria-hidden', 'true');
  // Show "R" prominently. If the player would press this with a finger
  // (fretted root), append the finger number as a small superscript
  // so they still know which finger to use.
  if (fingerNumber && fingerNumber > 0) {
    el.innerHTML = `<span class="chord-root-marker-label">R<small>${fingerNumber}</small></span>`;
  } else {
    el.innerHTML = '<span class="chord-root-marker-label">R</span>';
  }
  grid.appendChild(el);
  rootOverlayEl = el;
};

/**
 * Highlight the chord shape on the fretboard and leave it in place.
 *
 * - Fretted cells get `.in-chord` (purple disc) plus a finger-number
 *   badge (1-4). The lowest-pitch root copy also gets `.in-chord-root`
 *   (amber disc) and an `R` label so the tonal centre pops visually.
 * - Open chord-tone cells get `.in-chord-open` (just a small ○ marker
 *   on the label cell — no full-cell tint, since the player isn't
 *   fingering anything).
 * - Muted strings get `.muted` (big × on the label cell).
 * - If the shape is a barre, draw a horizontal pill across the index
 *   finger's strings via `drawBarreOverlay`.
 */
const paintChordShape = (frets, rootPc, providedFingers) => {
  clearChordShape();
  // Prefer chord-data fingers (textbook-vetted) when the voicing
  // carries them; only fall back to the heuristic for algorithmic
  // voicings (banjo / mandolin / uke C♯ / F♯).
  const fingers = providedFingers || assignFingers(frets, activeInstrument.tuning);
  const barre = detectBarre(frets, activeInstrument.tuning, providedFingers);

  // Track the lowest-pitch sounding root (the bass-voice copy that
  // anchors the chord). We use actual MIDI pitch rather than array
  // index because banjo's 5th-string drone is a HIGH-pitched g4
  // appended to the end of the tuning array — the array-index
  // heuristic would mistakenly mark the drone as the bass root.
  let bestRootMidi = Number.POSITIVE_INFINITY;
  let bestRootStringIdx = -1;
  let bestRootFret = -1;

  frets.forEach((fret, stringIdx) => {
    const startFret = activeInstrument.tuning[stringIdx].startFret || 0;
    if (fret < 0) {
      // Muted: × goes on the open-string label cell (or the
      // drone's startFret cell, since that's where the string label
      // lives for drones).
      const labelCell = cellEls.get(`${stringIdx}-${startFret}`);
      if (labelCell) {
        labelCell.classList.add('muted');
        chordShapeCells.add(labelCell);
      }
      return;
    }
    if (fret === startFret) {
      // Open chord tone — covers regular open strings (fret 0) AND
      // drone strings ringing at their startFret (e.g. banjo's 5th
      // string at fret 5). Either way: no finger, just a small ○
      // marker on the label/drone-start cell.
      const openCell = cellEls.get(`${stringIdx}-${startFret}`);
      if (openCell) {
        openCell.classList.add('in-chord-open');
        chordShapeCells.add(openCell);
      }
    } else {
      const cell = cellEls.get(`${stringIdx}-${fret}`);
      if (!cell) return;
      cell.classList.add('in-chord');
      chordShapeCells.add(cell);
      const finger = fingers[stringIdx];
      if (finger > 0) setFingerBadge(cell, String(finger));
    }

    const midi = midiAtCell(activeInstrument, stringIdx, fret);
    if (midi != null && midi % 12 === rootPc && midi < bestRootMidi) {
      bestRootMidi = midi;
      bestRootStringIdx = stringIdx;
      bestRootFret = fret;
    }
  });

  if (bestRootStringIdx >= 0) {
    const rootCell = cellEls.get(`${bestRootStringIdx}-${bestRootFret}`);
    if (rootCell) {
      rootCell.classList.remove('in-chord', 'in-chord-open');
      rootCell.classList.add('in-chord-root');
      const finger = fingers[bestRootStringIdx];
      const rootStartFret = activeInstrument.tuning[bestRootStringIdx].startFret || 0;
      const isOpenRoot = bestRootFret === rootStartFret;
      if (isOpenRoot) {
        // Open (or drone-open) root sits on a sticky / drone-start
        // label cell — an absolutely-positioned overlay would slide
        // off as the player scrolls the upper register, so we keep
        // the small "R" pill anchored to the cell itself.
        setFingerBadge(rootCell, 'R');
      } else {
        // Remove any finger-number badge that may have been added when
        // the cell was first painted as `.in-chord` — the overlay
        // takes over visual responsibility now.
        const stale = rootCell.querySelector('.finger-badge');
        if (stale) stale.remove();
      }
      // Order matters: barre first, then root on top, so the red
      // disc visibly punches through the amber bar.
      drawBarreOverlay(barre);
      if (!isOpenRoot) drawRootOverlay(rootCell, finger);
      return;
    }
  }

  drawBarreOverlay(barre);
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

const renderRadioGroup = (containerEl, items, selectedId, idKey, labelKey, dataAttr) => {
  containerEl.innerHTML = '';
  items.forEach((item) => {
    const id = item[idKey];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset[dataAttr] = String(id);
    btn.textContent = item[labelKey];
    btn.setAttribute('role', 'radio');
    const isSelected = id === selectedId;
    btn.setAttribute('aria-checked', String(isSelected));
    if (isSelected) btn.classList.add('selected');
    containerEl.appendChild(btn);
  });
};

const renderRoots = () =>
  renderRadioGroup(rootOptionsEl, ROOTS, builderState.rootPc, 'pc', 'name', 'pc');
const renderQualities = () =>
  renderRadioGroup(qualityOptionsEl, QUALITIES, builderState.qualityId, 'id', 'label', 'quality');

// Hide the Shape label + options when there's only one voicing on
// offer — a single "Open" button in its own labelled row is just visual
// noise. The Strum / Clear buttons live as siblings in the same row, so
// they stay visible (they re-home to the right via `margin-left: auto`).
const voicingLabelEl = document.getElementById('voicing-label');

const renderVoicings = () => {
  voicingOptionsEl.innerHTML = '';
  const voicings = getChordVoicings(activeInstrument, builderState.rootPc, builderState.qualityId);
  if (!voicings.length) {
    const empty = document.createElement('span');
    empty.className = 'chord-options-empty';
    empty.textContent = 'No shape on file for this combo yet.';
    voicingOptionsEl.appendChild(empty);
    if (strumButton) strumButton.disabled = true;
    if (voicingLabelEl) voicingLabelEl.hidden = false;
    voicingOptionsEl.hidden = false;
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
    const isSelected = idx === builderState.voicingIdx;
    btn.setAttribute('aria-checked', String(isSelected));
    if (isSelected) btn.classList.add('selected');
    voicingOptionsEl.appendChild(btn);
  });
  const collapse = voicings.length <= 1;
  if (voicingLabelEl) voicingLabelEl.hidden = collapse;
  voicingOptionsEl.hidden = collapse;
  refreshCurrentLabel(voicings[builderState.voicingIdx]?.name || '');
};

const playSelectedVoicing = (autoStrum = true) => {
  const voicings = getChordVoicings(activeInstrument, builderState.rootPc, builderState.qualityId);
  const v = voicings[builderState.voicingIdx];
  if (!v) return;
  paintChordShape(v.frets, builderState.rootPc, v.fingers);
  if (!autoStrum) {
    refreshCurrentLabel(v.name);
    return;
  }
  // Auto-pin to the Strum Bar so the player can recall this chord with
  // one tap later. Done BEFORE the strum so the pad exists and can
  // flash in sync with the audio.
  pinChordToBar(builderState.rootPc, builderState.qualityId);

  // frets is high-string-first → for a "down strum" we go low→high.
  // `midiAtCell` honours banjo's drone-string startFret (so its open
  // sounds at fret 5, not 0).
  const notes = v.frets
    .map((f, i) => (f < 0 ? null : midiAtCell(activeInstrument, i, f)))
    .reverse();
  engine.strum(notes, 'down');

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

  // Announce the root note (lowest sounded copy), or fallback to lowest sounded note.
  const lastIdx = v.frets.length - 1;
  for (let s = lastIdx; s >= 0; s--) {
    if (v.frets[s] < 0) continue;
    const midi = midiAtCell(activeInstrument, s, v.frets[s]);
    if (midi != null && midi % 12 === builderState.rootPc) {
      announceNote(midi);
      refreshCurrentLabel(v.name);
      return;
    }
  }
  for (let s = lastIdx; s >= 0; s--) {
    if (v.frets[s] < 0) continue;
    const midi = midiAtCell(activeInstrument, s, v.frets[s]);
    if (midi != null) {
      announceNote(midi);
      break;
    }
  }
  refreshCurrentLabel(v.name);
};

// Root buttons are the "play" surface for song mode: tap a root to
// strum the chord with whatever Quality + Shape is currently configured.
// Quality and Shape just *adjust the chord* without playing — so the
// player can preset "minor 7th, barre voicing" and play C-m7 → F-m7 →
// G-m7 by tapping roots, without an unwanted re-strum every time they
// tweak the chord type.
rootOptionsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  builderState.rootPc = Number(btn.dataset.pc);
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
  playSelectedVoicing(false);
});

voicingOptionsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  builderState.voicingIdx = Number(btn.dataset.voicingIdx);
  renderVoicings();
  playSelectedVoicing(false);
});

strumButton?.addEventListener('click', () => playSelectedVoicing());

clearShapeButton?.addEventListener('click', () => {
  clearChordShape();
  refreshCurrentLabel('');
});

// ---------- Strum Bar (one-tap chord pads) ----------
//
// The Strum Bar is the primary play surface for live strumming. Each
// pad shows a complete chord name ("Em", "A", "Cmaj7") and tapping it
// strums that chord. The bar auto-fills from every chord the player
// plays — via the matrix above, via `+` name input, or via tapping a
// pad — so an "Em A Em A" progression becomes one tap per change once
// both chords have been played once.
//
// Per-instrument storage so guitar's palette doesn't pollute uke's.
// Voicing is intentionally NOT stored per pad: pads always use the
// default voicing (index 0), and the matrix below remains the place
// to pick a non-default shape.

const getBarForActive = () => {
  if (!strumBars[activeInstrument.id]) strumBars[activeInstrument.id] = [];
  return strumBars[activeInstrument.id];
};

const renderStrumBar = () => {
  if (!strumPadsEl) return;
  // Hide the whole bar for non-chord instruments (bass).
  if (strumBarEl) strumBarEl.hidden = !activeInstrument.chords;
  strumPadsEl.innerHTML = '';
  if (!activeInstrument.chords) return;
  const bar = getBarForActive();
  bar.forEach((entry, idx) => {
    const pad = document.createElement('button');
    pad.type = 'button';
    pad.className = 'strum-pad';
    pad.dataset.rootPc = String(entry.rootPc);
    pad.dataset.quality = entry.qualityId;
    pad.dataset.idx = String(idx);
    const name = formatChordName(entry.rootPc, entry.qualityId);
    pad.setAttribute('aria-label', `Play ${name}`);
    pad.title = `Tap to strum ${name}`;
    const label = document.createElement('span');
    label.className = 'strum-pad-name';
    label.textContent = name;
    pad.appendChild(label);
    const remove = document.createElement('span');
    remove.className = 'strum-pad-remove';
    remove.setAttribute('role', 'button');
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.title = `Remove ${name} from the bar`;
    remove.tabIndex = 0;
    remove.textContent = '×';
    pad.appendChild(remove);
    strumPadsEl.appendChild(pad);
  });
};

// Pin a chord to the Strum Bar. If the chord is already on the bar,
// don't reorder it — just flash the pad. We only LRU-promote on FIRST
// add so a "Em A Em A" loop doesn't shuffle the pads' positions on
// every tap (which is disorienting when you're trying to play in time).
//
// LRU eviction still kicks in when a NEW chord arrives and the bar is
// at capacity — the oldest pad falls off the right end.
const pinChordToBar = (rootPc, qualityId) => {
  if (!activeInstrument.chords) return;
  const bar = getBarForActive();
  const idx = bar.findIndex((e) => e.rootPc === rootPc && e.qualityId === qualityId);
  if (idx >= 0) {
    // Already pinned — no reorder, just visual feedback.
    flashPad(rootPc, qualityId);
    return;
  }
  bar.unshift({ rootPc, qualityId });
  if (bar.length > STRUM_BAR_MAX) bar.length = STRUM_BAR_MAX;
  savePrefs();
  renderStrumBar();
  flashPad(rootPc, qualityId);
};

const removeChordFromBar = (rootPc, qualityId) => {
  const bar = getBarForActive();
  const idx = bar.findIndex((e) => e.rootPc === rootPc && e.qualityId === qualityId);
  if (idx < 0) return;
  bar.splice(idx, 1);
  savePrefs();
  renderStrumBar();
};

// Brief flash on whichever pad just played, so the player gets visual
// feedback that their tap registered (and matches the fretboard's
// cell-flash convention).
const flashPad = (rootPc, qualityId) => {
  const sel = `.strum-pad[data-root-pc="${rootPc}"][data-quality="${qualityId}"]`;
  const pad = strumPadsEl?.querySelector(sel);
  if (!pad) return;
  pad.classList.remove('playing');
  // Force reflow so re-adding the class restarts the animation.
  void pad.offsetWidth;
  pad.classList.add('playing');
  setTimeout(() => pad.classList.remove('playing'), 400);
};

// Set the matrix selection to a chord and strum it. Used by both pad
// taps and the `+` name input. Resets voicing to 0 (the curated /
// algorithmic default) so a pad always sounds the same shape; the
// player can still pick a non-default voicing in the matrix below
// after the pad strums.
const playChordAtPad = (rootPc, qualityId) => {
  builderState.rootPc = rootPc;
  builderState.qualityId = qualityId;
  builderState.voicingIdx = 0;
  renderRoots();
  renderQualities();
  renderVoicings();
  playSelectedVoicing();
};

// ---------- Tap-to-play vs. drag-to-reorder ----------
//
// Pointer-driven: pointerdown starts a "potential" tap; if the cursor
// moves more than DRAG_THRESHOLD before pointerup, we promote it to a
// drag (cancelling the tap-to-strum). On drop we persist the new order.
//
// A floating ghost clone follows the finger so the pad visibly tracks
// the cursor, and the bar's data is reordered live as the ghost
// crosses other pads. The original pad stays in place but is dimmed
// (`drag-source` class) until drop.

const DRAG_THRESHOLD = 8; // px before a tap promotes to a drag
let dragState = null;
let justDragged = false; // briefly true after a drag so the trailing
// `click` event doesn't accidentally re-strum the dropped chord.

const findPadByChord = (chord) =>
  strumPadsEl?.querySelector(
    `.strum-pad[data-root-pc="${chord.rootPc}"][data-quality="${chord.qualityId}"]`
  );

const startDrag = (event) => {
  if (!dragState) return;
  const sourcePad = findPadByChord(dragState.chord);
  if (!sourcePad) return;
  dragState.dragging = true;
  sourcePad.classList.add('drag-source');
  // Floating clone that the cursor literally drags around — no DOM
  // reflow needed for the visual bit; the underlying pad order is
  // updated independently.
  const rect = sourcePad.getBoundingClientRect();
  const ghost = sourcePad.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.classList.remove('drag-source');
  ghost.querySelector('.strum-pad-remove')?.remove();
  ghost.style.position = 'fixed';
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '9999';
  ghost.style.transform = 'scale(1.05)';
  ghost.style.transition = 'none';
  document.body.appendChild(ghost);
  dragState.ghostEl = ghost;
  // Pointer offset within the source pad — the ghost stays anchored
  // to that same offset for the life of the drag, so the chord name
  // doesn't snap-jump under the finger when the drag begins.
  dragState.ghostOffsetX = event.clientX - rect.left;
  dragState.ghostOffsetY = event.clientY - rect.top;
  document.body.classList.add('strum-dragging');
};

const onStrumPointerDown = (event) => {
  if (event.button !== undefined && event.button !== 0) return; // primary button only
  if (event.target.closest('.strum-pad-remove')) return; // X button uses click
  const pad = event.target.closest('.strum-pad');
  if (!pad) return;
  dragState = {
    pointerId: event.pointerId,
    chord: { rootPc: Number(pad.dataset.rootPc), qualityId: pad.dataset.quality },
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
    ghostEl: null
  };
};

const onStrumPointerMove = (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (!dragState.dragging) {
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    startDrag(event);
    if (!dragState.dragging) return;
  }
  // Move the ghost.
  dragState.ghostEl.style.left = `${event.clientX - dragState.ghostOffsetX}px`;
  dragState.ghostEl.style.top = `${event.clientY - dragState.ghostOffsetY}px`;
  // Look beneath the cursor for any pad that ISN'T the source. Use
  // elementsFromPoint so the ghost (which is on top) doesn't shadow
  // the result.
  const els = document.elementsFromPoint(event.clientX, event.clientY);
  const targetPad = els.find(
    (el) => el.classList?.contains('strum-pad') && !el.classList.contains('drag-source')
  );
  if (!targetPad) return;
  const bar = getBarForActive();
  const sourceIdx = bar.findIndex(
    (e) => e.rootPc === dragState.chord.rootPc && e.qualityId === dragState.chord.qualityId
  );
  const targetIdx = Number(targetPad.dataset.idx);
  if (sourceIdx < 0 || Number.isNaN(targetIdx)) return;
  // Insert the source before or after the target depending on which
  // half of the target the cursor is over — gives a predictable feel
  // regardless of approach direction.
  const r = targetPad.getBoundingClientRect();
  const insertBefore = event.clientX < r.left + r.width / 2;
  let newIdx = insertBefore ? targetIdx : targetIdx + 1;
  if (newIdx > sourceIdx) newIdx -= 1;
  if (newIdx === sourceIdx) return;
  const [moved] = bar.splice(sourceIdx, 1);
  bar.splice(newIdx, 0, moved);
  renderStrumBar();
  // renderStrumBar wiped + rebuilt DOM, so re-mark the new source pad.
  findPadByChord(dragState.chord)?.classList.add('drag-source');
  event.preventDefault();
};

const endStrumDrag = (event) => {
  if (!dragState) return;
  if (event && event.pointerId !== dragState.pointerId) return;
  if (dragState.dragging) {
    findPadByChord(dragState.chord)?.classList.remove('drag-source');
    dragState.ghostEl?.remove();
    document.body.classList.remove('strum-dragging');
    savePrefs();
    // Suppress the trailing `click` that fires on touch/mouse after
    // pointerup (otherwise the dropped pad would also strum).
    justDragged = true;
    setTimeout(() => {
      justDragged = false;
    }, 80);
  }
  dragState = null;
};

strumPadsEl?.addEventListener('pointerdown', onStrumPointerDown);
// Listen on document so a fast drag that exits the bar doesn't lose
// the pointerup event (capture-style behaviour without explicit
// setPointerCapture, which was buggy in Safari for cloned ghosts).
document.addEventListener('pointermove', onStrumPointerMove);
document.addEventListener('pointerup', endStrumDrag);
document.addEventListener('pointercancel', endStrumDrag);

strumPadsEl?.addEventListener('click', (event) => {
  if (justDragged) {
    event.stopPropagation();
    event.preventDefault();
    return;
  }
  const removeBtn = event.target.closest('.strum-pad-remove');
  if (removeBtn) {
    event.stopPropagation();
    const pad = removeBtn.closest('.strum-pad');
    if (!pad) return;
    removeChordFromBar(Number(pad.dataset.rootPc), pad.dataset.quality);
    return;
  }
  const pad = event.target.closest('.strum-pad');
  if (!pad) return;
  playChordAtPad(Number(pad.dataset.rootPc), pad.dataset.quality);
});

// ---------- "+" inline chord-name input + autocomplete ----------
//
// The popover lets the player type any supported chord name to add a
// pad. Suggestions are computed live as they type — prefix-match on
// the displayed chord name (with both `#` and `♯` accepted) — and
// ENTER tries to parse the raw input first so power users can blast
// through "em ↵ a ↵ d ↵ g ↵" without ever clicking a suggestion.

// Pre-compute the full set of displayable chord names ONCE — 12 roots
// × 7 qualities = 84 entries, used for both autocomplete suggestions
// and the parsed-name fast path.
const ALL_CHORDS = [];
for (const r of ROOTS) {
  for (const q of QUALITIES) {
    ALL_CHORDS.push({
      name: formatChordName(r.pc, q.id),
      rootPc: r.pc,
      qualityId: q.id
    });
  }
}

let suggestionIdx = -1; // keyboard-highlighted suggestion (-1 = none)

const setStrumPopover = (open) => {
  if (!strumPopoverEl || !strumAddBtn) return;
  strumPopoverEl.hidden = !open;
  strumAddBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    strumInputEl.value = '';
    refreshSuggestions();
    // Defer focus a tick so iOS Safari opens the keyboard reliably.
    setTimeout(() => strumInputEl?.focus(), 0);
  } else {
    suggestionIdx = -1;
  }
};

const normalizeForMatch = (s) => s.toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b');

const refreshSuggestions = () => {
  if (!strumSuggestionsEl) return;
  const raw = (strumInputEl?.value || '').trim();
  const needle = normalizeForMatch(raw);
  const matches = needle
    ? // Prefix match, then prefer shorter names so "c" surfaces
      // C / Cm / C7 above C♯ / C♯m / C♯7 (typed "c" usually means
      // the natural C, not C-sharp).
      ALL_CHORDS.filter((c) => normalizeForMatch(c.name).startsWith(needle))
        .sort((a, b) => a.name.length - b.name.length)
        .slice(0, 12)
    : // No input yet: surface a handful of common starter chords so
      // the popover isn't a wall of nothing.
      ['C', 'G', 'D', 'A', 'E', 'F', 'Em', 'Am', 'Dm']
        .map((n) => ALL_CHORDS.find((c) => c.name === n))
        .filter(Boolean);
  strumSuggestionsEl.innerHTML = '';
  matches.forEach((m, i) => {
    const li = document.createElement('li');
    li.className = 'strum-bar-suggestion';
    li.dataset.rootPc = String(m.rootPc);
    li.dataset.quality = m.qualityId;
    li.textContent = m.name;
    li.setAttribute('role', 'option');
    if (i === suggestionIdx) li.setAttribute('aria-selected', 'true');
    strumSuggestionsEl.appendChild(li);
  });
};

const commitTypedChord = () => {
  // Prefer the keyboard-highlighted suggestion when one is selected;
  // otherwise parse whatever the player typed and add that. Pin first
  // (so the pad exists), then play it.
  let target = null;
  if (suggestionIdx >= 0) {
    const li = strumSuggestionsEl?.children[suggestionIdx];
    if (li) {
      target = { rootPc: Number(li.dataset.rootPc), qualityId: li.dataset.quality };
    }
  }
  if (!target) {
    const parsed = parseChordName(strumInputEl?.value || '');
    if (parsed) target = parsed;
  }
  if (!target) {
    // Soft visual error: shake the input briefly so the player knows
    // the typed name didn't parse, without nagging modal dialogs.
    strumInputEl?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' }
      ],
      { duration: 220 }
    );
    return;
  }
  setStrumPopover(false);
  playChordAtPad(target.rootPc, target.qualityId);
};

strumAddBtn?.addEventListener('click', () => {
  const open = strumAddBtn.getAttribute('aria-expanded') === 'true';
  setStrumPopover(!open);
});

strumInputEl?.addEventListener('input', () => {
  suggestionIdx = -1;
  refreshSuggestions();
});

strumInputEl?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitTypedChord();
  } else if (event.key === 'Escape') {
    setStrumPopover(false);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = strumSuggestionsEl?.children.length || 0;
    if (!count) return;
    suggestionIdx =
      event.key === 'ArrowDown'
        ? (suggestionIdx + 1) % count
        : (suggestionIdx - 1 + count) % count;
    refreshSuggestions();
  }
});

strumSuggestionsEl?.addEventListener('click', (event) => {
  const li = event.target.closest('.strum-bar-suggestion');
  if (!li) return;
  setStrumPopover(false);
  playChordAtPad(Number(li.dataset.rootPc), li.dataset.quality);
});

// Click-outside-to-dismiss. Also covers the "tapped on the pads while
// the popover was open" case which felt fiddly without it.
document.addEventListener('pointerdown', (event) => {
  if (strumPopoverEl?.hidden) return;
  if (strumPopoverEl.contains(event.target)) return;
  if (strumAddBtn?.contains(event.target)) return;
  setStrumPopover(false);
});

// ---------- Tone + instrument switching ----------

const updateToneStatus = () => {
  if (!toneStatus) return;
  if (engine.isMultiSampleTone(engine.toneName) && engine.multiSamplerStatus === 'error') {
    toneStatus.textContent = 'offline · pick a soundfont tone';
    return;
  }
  toneStatus.textContent = engine.isReady() ? '' : 'loading…';
};

const switchTone = (name) => {
  toneStatus.textContent = 'loading…';
  engine.setTone(name).then(updateToneStatus).catch(updateToneStatus);
};

const populateToneOptions = () => {
  toneEl.innerHTML = '';
  for (const tone of activeInstrument.tones) {
    const opt = document.createElement('option');
    opt.value = tone.value;
    opt.textContent = tone.label;
    toneEl.appendChild(opt);
  }
  const remembered = tonesPerInstrument[activeInstrument.id];
  const initial =
    remembered && activeInstrument.tones.some((t) => t.value === remembered)
      ? remembered
      : activeInstrument.defaultTone;
  toneEl.value = initial;
};

const applyInstrument = (instrumentId, { warm: warmAudio = false } = {}) => {
  const next = getInstrument(instrumentId);
  activeInstrument = next;
  engine.paired = !!next.paired;
  populateToneOptions();
  buildFretboard();
  // Chord builder is EADGBE-only for now; hide it for the other instruments.
  if (chordBuilderEl) chordBuilderEl.hidden = !next.chords;
  if (helpStringsEl) helpStringsEl.textContent = next.helpStrings;
  // Sync the instrument dropdown's value (in case applyInstrument was
  // called from prefs hydration rather than a user change event).
  if (instrumentEl && instrumentEl.value !== next.id) instrumentEl.value = next.id;
  // Re-paint the current chord shape if the builder is still visible.
  if (next.chords) {
    renderRoots();
    renderQualities();
    renderVoicings();
  } else {
    clearChordShape();
    refreshCurrentLabel('');
  }
  // Strum Bar contents are per-instrument, so re-render whenever the
  // active instrument changes (and hide for non-chord instruments).
  renderStrumBar();
  if (warmAudio) switchTone(toneEl.value);
};

// ---------- Wire up controls ----------

instrumentEl?.addEventListener('change', () => {
  applyInstrument(instrumentEl.value, { warm: warmed });
  savePrefs();
});

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  savePrefs();
});

toneEl.addEventListener('change', () => {
  tonesPerInstrument[activeInstrument.id] = toneEl.value;
  switchTone(toneEl.value);
  savePrefs();
});

showNotesEl.addEventListener('change', () => {
  fretboardEl.classList.toggle('hide-notes', !showNotesEl.checked);
  savePrefs();
});

window.addEventListener('focus', () => resumeIfSuspended());

// Pre-warm on first user interaction. AudioContext won't resume until a
// gesture happens, so loading samples eagerly would just waste bytes
// for visitors who land on the page and bounce.
let warmed = false;
const warm = () => {
  if (warmed) return;
  warmed = true;
  switchTone(toneEl.value);
};
document.addEventListener('pointerdown', warm, { once: true });
document.addEventListener('keydown', warm, { once: true });

// ---------- Build initial UI ----------

applyInstrument(initialInstrumentId);
refreshCurrentLabel('');

// ---------- MIDI input ----------

setupMidi({
  statusEl: midiStatusEl,
  onNoteOn: (note) => {
    if (!engine.pluck(note)) return;
    announceNote(note);
    // Find the highest string whose open is ≤ note and visible fret reaches it.
    const tuning = activeInstrument.tuning;
    for (let s = tuning.length - 1; s >= 0; s--) {
      const startFret = tuning[s].startFret || 0;
      const open = tuning[s].midi;
      const fret = note - open + startFret;
      if (fret >= startFret && fret <= activeInstrument.fretCount) {
        flashCell(s, fret);
        break;
      }
    }
  },
  onNoteOff: () => {
    /* string plucks decay naturally */
  }
});
