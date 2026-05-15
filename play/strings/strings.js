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
import { resumeIfSuspended, setMasterVolume } from '../shared/audio.js';
import { setupMidi } from '../shared/midi.js';
import { makePrefs } from '../shared/prefs.js';
import { getInstrument, midiAtCell } from './instruments.js';
import {
  ROOTS,
  QUALITIES,
  getChordVoicings,
  formatChordName
} from './chords.js';
import { StringEngine } from './engine.js';
import { createFretboardController } from './fretboard.js';
import { createStrumPopovers } from './strum-popovers.js';
import { initStrumDrag } from './strum-drag.js';
import {
  STRUM_BAR_MAX,
  chordKey,
  voicingPositionSuperscript,
  hydratePrefs
} from './prefs-hydrate.js';
import { createChordShapePainter } from './chord-shape-render.js';
import { createToneControls } from './tone-controls.js';

// localStorage key is intentionally still `play.guitar.*` — the URL was
// renamed from /play/guitar/ to /play/strings/ in May 2026, but the
// stored prefs (tones-per-instrument, last instrument, voicing memory,
// strum-bar pads) all predate the rename and should survive it.
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
const strumLoadBtn = document.getElementById('strum-bar-load');
const strumLoadPopoverEl = document.getElementById('strum-bar-load-popover');
const strumLoadInputEl = document.getElementById('strum-bar-load-input');
const strumLoadResultsEl = document.getElementById('strum-bar-load-results');
const strumLoadStatusEl = document.getElementById('strum-bar-load-status');
const strumClearBtn = document.getElementById('strum-bar-clear');
// Transpose group — ♭ / ♯ buttons that shift every pinned chord by one
// semitone (capo-style). Group is hidden when the bar is empty; the
// buttons inside don't care about state, they just delegate to
// transposeStrumBar().
const strumTransposeEl = document.getElementById('strum-bar-transpose');
const strumTransposeDownBtn = document.getElementById('strum-bar-transpose-down');
const strumTransposeUpBtn = document.getElementById('strum-bar-transpose-up');
const strumBarHintEl = document.getElementById('strum-bar-hint');
// "♪ Title — Artist" link surfaced in the strum-bar header after a
// song load. Click opens the source page (e-chords) in a new tab so
// the player can read the original lyrics / structure / capo notes.
const strumSongLinkEl = document.getElementById('strum-bar-song');
// Captured at module load so we can restore it any time the
// hint-slot is briefly repurposed as the edit-mode status line.
const STRUM_BAR_HINT_DEFAULT = strumBarHintEl ? strumBarHintEl.innerHTML : '';

// ---------- Prefs hydration + per-instrument tone memory ----------

const {
  initialInstrumentId,
  tonesPerInstrument,
  strumBar,
  voicingPrefs,
  loadedSong: initialLoadedSong
} = hydratePrefs(Prefs, volumeEl, showNotesEl);

let activeInstrument = getInstrument(initialInstrumentId);

// Track the song the player loaded most recently so we can surface a
// clickable link back to the source page in the strum-bar header.
// Cleared when the user hits Clear or loads a different song.
/** @type {{ url: string, title: string, artist: string } | null} */
let loadedSong = initialLoadedSong;

// Update the loaded-song reference and refresh the link in the
// strum-bar header. Pass null to clear (e.g. on Clear button).
const setLoadedSong = (song) => {
  loadedSong = song;
  if (!strumSongLinkEl) return;
  if (!song || !song.url) {
    strumSongLinkEl.hidden = true;
    strumSongLinkEl.removeAttribute('href');
    strumSongLinkEl.textContent = '';
    return;
  }
  strumSongLinkEl.href = song.url;
  // Falls back to "Source" when we couldn't parse a title — at least
  // gives the player SOMETHING clickable, instead of an empty link.
  const label = song.title
    ? song.artist
      ? `${song.title} — ${song.artist}`
      : song.title
    : 'Source';
  strumSongLinkEl.textContent = `\u266A ${label}`;
  strumSongLinkEl.title = `Open original chord page${song.artist ? ` for ${song.artist}` : ''} in a new tab`;
  strumSongLinkEl.hidden = false;
};

// Look up the active instrument's preferred voicing for a chord.
// Defaults to 0 (the chord library's first voicing — usually Open).
// Clamped to the available voicings so we never index past the end
// when a chord library shrinks between releases.
const getVoicingIdxFor = (instrumentId, rootPc, qualityId) => {
  const map = voicingPrefs[instrumentId];
  const raw = map ? map[chordKey(rootPc, qualityId)] : undefined;
  const want = Number.isInteger(raw) ? raw : 0;
  const voicings = getChordVoicings(getInstrument(instrumentId), rootPc, qualityId);
  if (!voicings.length) return 0;
  return Math.min(Math.max(0, want), voicings.length - 1);
};

const setVoicingIdxFor = (instrumentId, rootPc, qualityId, voicingIdx) => {
  if (!Number.isInteger(voicingIdx) || voicingIdx < 0) return;
  if (!voicingPrefs[instrumentId]) voicingPrefs[instrumentId] = {};
  const key = chordKey(rootPc, qualityId);
  // Storing 0 (the default) is wasted bytes — drop it instead so
  // saved prefs stay minimal.
  if (voicingIdx === 0) {
    delete voicingPrefs[instrumentId][key];
  } else {
    voicingPrefs[instrumentId][key] = voicingIdx;
  }
};

const savePrefs = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    instrument: activeInstrument.id,
    tonesPerInstrument,
    // New shape — written every save so legacy `strumBars` is ignored on next boot.
    strumBar,
    voicingPrefs,
    loadedSong,
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

// ---------- Fretboard rendering + pointer playback ----------

const fretboard = createFretboardController({
  fretboardEl,
  showNotesEl,
  nowPlaying,
  engine,
  cellEls,
  chordShapeCells,
  getActiveInstrument: () => activeInstrument,
});
const { build: buildFretboard, flashCell, announceNote } = fretboard;

// ---------- Chord shape painter (./chord-shape-render.js) ----------

const { paintChordShape, clearChordShape } = createChordShapePainter({
  fretboardEl,
  cellEls,
  chordShapeCells,
  getActiveInstrument: () => activeInstrument,
});

// ---------- Chord builder UI ----------

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

// Roots get rendered specially so the enharmonic-flat spelling can sit
// next to the sharp on the same button (e.g. `C♯ / D♭`). We can't use
// the generic `renderRadioGroup` here because that helper only knows
// how to read a single text key per item.
const renderRoots = () => {
  rootOptionsEl.innerHTML = '';
  ROOTS.forEach((r) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.pc = String(r.pc);
    btn.classList.add('root-button');
    if (r.flat) btn.classList.add('root-button-enharmonic');
    btn.setAttribute('role', 'radio');
    const isSelected = r.pc === builderState.rootPc;
    btn.setAttribute('aria-checked', String(isSelected));
    if (isSelected) btn.classList.add('selected');
    const sharp = document.createElement('span');
    sharp.className = 'root-button-sharp';
    sharp.textContent = r.name;
    btn.appendChild(sharp);
    if (r.flat) {
      const flat = document.createElement('span');
      flat.className = 'root-button-flat';
      flat.textContent = r.flat;
      // Screen readers should announce "C-sharp or D-flat" rather than
      // running them together as one token.
      btn.setAttribute('aria-label', `${r.name} or ${r.flat}`);
      btn.appendChild(flat);
    }
    rootOptionsEl.appendChild(btn);
  });
};
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
  // Auto-pin to the Strum Bar so the player can recall this chord
  // (with this specific voicing) with one tap later. Done BEFORE
  // the strum so the pad exists and can flash in sync with the audio.
  pinChordToBar(builderState.rootPc, builderState.qualityId, builderState.voicingIdx);

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
rootOptionsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  const newRootPc = Number(btn.dataset.pc);
  // Edit mode: rewrite the armed pad's root in place (Em → Am etc.).
  if (editTarget && applyEditToPad({ rootPc: newRootPc })) return;
  builderState.rootPc = newRootPc;
  renderRoots();
  renderVoicings();
  playSelectedVoicing();
});

qualityOptionsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  const newQualityId = btn.dataset.quality;
  // Edit mode: rewrite the armed pad's quality (Em → Em7 etc.). The
  // helper resets voicingIdx to 0 internally because shape numbering
  // doesn't carry across qualities.
  if (editTarget && applyEditToPad({ qualityId: newQualityId })) return;
  builderState.qualityId = newQualityId;
  builderState.voicingIdx = 0;
  renderQualities();
  renderVoicings();
  playSelectedVoicing(false);
});

voicingOptionsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  const newIdx = Number(btn.dataset.voicingIdx);
  // Edit mode: rewrite the armed pad's voicing (Cm Open → Cm Barre 3).
  if (
    editTarget &&
    editTarget.rootPc === builderState.rootPc &&
    editTarget.qualityId === builderState.qualityId &&
    applyEditToPad({ voicingIdx: newIdx })
  ) {
    return;
  }
  builderState.voicingIdx = newIdx;
  renderVoicings();
  playSelectedVoicing(false);
});

strumButton?.addEventListener('click', () => playSelectedVoicing());

clearShapeButton?.addEventListener('click', () => {
  clearChordShape();
  refreshCurrentLabel('');
});

// ---------- Strum Bar (one-tap chord pads) ----------

const renderStrumBar = () => {
  if (!strumPadsEl) return;
  // Hide the whole bar for non-chord instruments (bass).
  if (strumBarEl) strumBarEl.hidden = !activeInstrument.chords;
  strumPadsEl.innerHTML = '';
  if (!activeInstrument.chords) return;
  // CSS `.has-pads` hides the verbose hint header once the bar isn't
  // empty — saves ~25 px of vertical space on phones, where every
  // pixel between fretboard and chord builder matters.
  strumBarEl?.classList.toggle('has-pads', strumBar.length > 0);
  // Mirror the same "is the bar non-empty?" signal onto the Clear
  // button so it appears the moment the first chord is pinned and
  // disappears the moment the bar is wiped.
  if (strumClearBtn) strumClearBtn.hidden = strumBar.length === 0;
  // Transpose buttons follow the same "show once a pad exists" rule —
  // there's nothing to shift when the bar is empty.
  if (strumTransposeEl) strumTransposeEl.hidden = strumBar.length === 0;
  strumBar.forEach((entry, idx) => {
    // Each render resolves the active instrument's preferred voicing
    // for this chord (per voicingPrefs). Same chord on uke vs guitar
    // can land on different shape indices.
    const voicingIdx = getVoicingIdxFor(activeInstrument.id, entry.rootPc, entry.qualityId);
    const pad = document.createElement('button');
    pad.type = 'button';
    pad.className = 'strum-pad';
    pad.dataset.rootPc = String(entry.rootPc);
    pad.dataset.quality = entry.qualityId;
    pad.dataset.voicingIdx = String(voicingIdx);
    pad.dataset.idx = String(idx);
    const name = formatChordName(entry.rootPc, entry.qualityId);
    // Resolve the actual voicing object so we can label the pad with
    // its fret position (e.g. "C³" for C Barre 3). Falls back to no
    // superscript if the chord library no longer has that voicing
    // index — the pad still plays SOMETHING, it just won't claim a
    // fret position.
    const voicings = getChordVoicings(activeInstrument, entry.rootPc, entry.qualityId);
    const voicing = voicings[voicingIdx] || voicings[0];
    const fret = voicingPositionSuperscript(voicing);
    const fullName = fret ? `${name} (${voicing.name})` : name;
    pad.setAttribute('aria-label', `Play ${fullName}`);
    pad.title = `Tap to strum ${fullName}`;
    const label = document.createElement('span');
    label.className = 'strum-pad-name';
    label.textContent = name;
    pad.appendChild(label);
    if (fret) {
      const sup = document.createElement('sup');
      sup.className = 'strum-pad-fret';
      sup.textContent = fret;
      pad.appendChild(sup);
    }
    const remove = document.createElement('span');
    remove.className = 'strum-pad-remove';
    remove.setAttribute('role', 'button');
    remove.setAttribute('aria-label', `Remove ${fullName}`);
    remove.title = `Remove ${fullName} from the bar`;
    remove.tabIndex = 0;
    remove.textContent = '×';
    pad.appendChild(remove);
    strumPadsEl.appendChild(pad);
  });
  // Re-apply the "this pad is being shape-edited" highlight (the DOM
  // was just rebuilt from scratch, so the class wouldn't survive).
  highlightEditPad();
};

// Pin a chord to the Strum Bar. The bar dedupes by (root, quality);
// the voicing rides as a per-instrument preference instead of being
// part of the pad identity.
const pinChordToBar = (rootPc, qualityId, voicingIdx = 0) => {
  if (!activeInstrument.chords) return;
  const idx = strumBar.findIndex((e) => e.rootPc === rootPc && e.qualityId === qualityId);
  // Update the active instrument's preferred voicing for this chord.
  setVoicingIdxFor(activeInstrument.id, rootPc, qualityId, voicingIdx);
  if (idx >= 0) {
    // Already pinned — re-render in case the voicing change shifted
    // the pad's superscript (e.g. C → C³), then flash.
    renderStrumBar();
    savePrefs();
    flashPad(rootPc, qualityId);
    return;
  }
  strumBar.unshift({ rootPc, qualityId });
  if (strumBar.length > STRUM_BAR_MAX) strumBar.length = STRUM_BAR_MAX;
  savePrefs();
  renderStrumBar();
  flashPad(rootPc, qualityId);
};

const removeChordFromBar = (rootPc, qualityId) => {
  const idx = strumBar.findIndex((e) => e.rootPc === rootPc && e.qualityId === qualityId);
  if (idx < 0) return;
  strumBar.splice(idx, 1);
  // If we just removed the pad the player was shape-editing, drop
  // the edit target so a later shape click doesn't try to mutate a
  // ghost.
  if (editTarget && editTarget.rootPc === rootPc && editTarget.qualityId === qualityId) {
    setEditTarget(null);
  }
  savePrefs();
  renderStrumBar();
};

// Brief flash on whichever pad just played, so the player gets visual
// feedback that their tap registered.
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

// Set the matrix selection to a chord and strum it.
const playChordAtPad = (rootPc, qualityId, voicingIdx = 0) => {
  builderState.rootPc = rootPc;
  builderState.qualityId = qualityId;
  builderState.voicingIdx = voicingIdx;
  renderRoots();
  renderQualities();
  renderVoicings();
  playSelectedVoicing();
};

// ---------- Edit-in-place: change a pad's voicing ----------

/** @type {{ rootPc: number, qualityId: string, voicingIdx: number } | null} */
let editTarget = null;

const setEditTarget = (target) => {
  editTarget = target;
  highlightEditPad();
  refreshEditHint();
};

// Borrow the strum-bar hint slot to surface "you're in edit mode"
// guidance — that slot is normally hidden once any pad is pinned, so
// it's free real estate, and it sits right above the pads where the
// player's eyes already are.
const refreshEditHint = () => {
  if (!strumBarHintEl || !strumBarEl) return;
  if (editTarget) {
    const name = formatChordName(editTarget.rootPc, editTarget.qualityId);
    strumBarHintEl.innerHTML =
      `Editing <strong>${name}</strong> · pick Root / Quality / Shape to update, ` +
      `or tap the pad again (Esc) to stop.`;
    strumBarEl.classList.add('editing');
  } else {
    strumBarHintEl.innerHTML = STRUM_BAR_HINT_DEFAULT;
    strumBarEl.classList.remove('editing');
  }
};

const highlightEditPad = () => {
  if (!strumPadsEl) return;
  Array.from(strumPadsEl.querySelectorAll('.strum-pad.editing')).forEach((el) =>
    el.classList.remove('editing')
  );
  if (!editTarget) return;
  const sel = `.strum-pad[data-root-pc="${editTarget.rootPc}"][data-quality="${editTarget.qualityId}"]`;
  strumPadsEl.querySelector(sel)?.classList.add('editing');
};

// Apply an in-place edit to whichever pad is currently armed for
// editing. Each axis (root / quality / voicing) is optional.
const applyEditToPad = (changes) => {
  if (!editTarget) return false;
  let idx = strumBar.findIndex(
    (e) => e.rootPc === editTarget.rootPc && e.qualityId === editTarget.qualityId
  );
  if (idx < 0) {
    // Pad got removed since we armed it (e.g. the × button). Bail.
    setEditTarget(null);
    return false;
  }
  const newRootPc = changes.rootPc != null ? changes.rootPc : editTarget.rootPc;
  const newQualityId =
    changes.qualityId != null ? changes.qualityId : editTarget.qualityId;
  // Resolve the voicing for the edit. Three cases:
  //   - Voicing was explicitly changed → use the new index.
  //   - Quality changed → reset to 0 (shape numbering differs per
  //     quality).
  //   - Otherwise carry the active instrument's existing voicing
  //     pref forward.
  let newVoicingIdx;
  if (changes.voicingIdx != null) {
    newVoicingIdx = changes.voicingIdx;
  } else if (changes.qualityId != null && changes.qualityId !== editTarget.qualityId) {
    newVoicingIdx = 0;
  } else {
    newVoicingIdx = getVoicingIdxFor(activeInstrument.id, newRootPc, newQualityId);
  }
  const voicings = getChordVoicings(activeInstrument, newRootPc, newQualityId);
  if (!voicings.length) return false;
  if (newVoicingIdx < 0 || newVoicingIdx >= voicings.length) newVoicingIdx = 0;

  // Dedupe: if a different pad already represents the new (root,
  // quality) identity, drop it. Keep the EDITED pad's slot so the
  // player's spatial memory is preserved across the edit.
  const dupIdx = strumBar.findIndex(
    (e, i) => i !== idx && e.rootPc === newRootPc && e.qualityId === newQualityId
  );
  if (dupIdx >= 0) {
    strumBar.splice(dupIdx, 1);
    if (dupIdx < idx) idx -= 1;
  }

  strumBar[idx] = { rootPc: newRootPc, qualityId: newQualityId };
  setVoicingIdxFor(activeInstrument.id, newRootPc, newQualityId, newVoicingIdx);

  // Sync the matrix below so the rendered selection matches the pad.
  builderState.rootPc = newRootPc;
  builderState.qualityId = newQualityId;
  builderState.voicingIdx = newVoicingIdx;

  setEditTarget({ rootPc: newRootPc, qualityId: newQualityId });
  savePrefs();
  renderRoots();
  renderQualities();
  renderVoicings();
  renderStrumBar();
  // playSelectedVoicing() also calls pinChordToBar — that's a no-op
  // for an already-pinned identity, so it doubles as both "play the
  // new sound" AND "flash the edited pad" in one call.
  playSelectedVoicing();
  return true;
};

// ---------- Clear-all ----------

const clearStrumBar = () => {
  if (!strumBar.length && !loadedSong) return;
  strumBar.length = 0;
  setEditTarget(null);
  setLoadedSong(null);
  savePrefs();
  renderStrumBar();
};

strumClearBtn?.addEventListener('click', clearStrumBar);

// ---------- Transpose ----------
//
// Shift every pinned chord up or down by N semitones (positive = up,
// negative = down). Capo-style: chord identities are rewritten in
// place, so a bar of `[Em, A, D, G]` shifted +2 becomes `[F♯m, B, E, A]`.

const transposeStrumBar = (semitones) => {
  if (!strumBar.length) return;
  const shift = (((semitones % 12) + 12) % 12);
  if (shift === 0) return;
  for (const entry of strumBar) {
    entry.rootPc = (entry.rootPc + shift) % 12;
  }
  if (editTarget) {
    editTarget = {
      rootPc: (editTarget.rootPc + shift) % 12,
      qualityId: editTarget.qualityId,
    };
  }
  builderState.rootPc = (builderState.rootPc + shift) % 12;
  savePrefs();
  renderRoots();
  renderQualities();
  renderVoicings();
  renderStrumBar();
};

strumTransposeDownBtn?.addEventListener('click', () => transposeStrumBar(-1));
strumTransposeUpBtn?.addEventListener('click', () => transposeStrumBar(+1));

// ---------- Tap-to-play vs. drag-to-reorder ----------

initStrumDrag({
  strumPadsEl,
  chordBuilderEl,
  strumBar,
  getEditTarget: () => editTarget,
  setEditTarget,
  renderStrumBar,
  savePrefs,
  playChordAtPad,
  removeChordFromBar,
});

// ---------- Strum-bar action popovers ----------

createStrumPopovers({
  strumPopoverEl,
  strumAddBtn,
  strumInputEl,
  strumSuggestionsEl,
  strumLoadPopoverEl,
  strumLoadBtn,
  strumLoadInputEl,
  strumLoadResultsEl,
  strumLoadStatusEl,
  strumBar,
  pinChordToBar,
  playChordAtPad,
  setEditTarget,
  setLoadedSong,
  savePrefs,
});


// ---------- Tone + instrument switching ----------

const { switchTone, populateToneOptions } = createToneControls({
  engine,
  toneEl,
  toneStatus,
  getActiveInstrument: () => activeInstrument,
  tonesPerInstrument,
});

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
  // Strum Bar contents are SHARED across chord-capable instruments;
  // each render resolves voicings against the new active instrument's
  // preferred shapes (per voicingPrefs). Hidden for bass.
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
// Render any persisted song link (loadedSong was hydrated from
// prefs above; the link element only exists once the DOM is ready,
// so rendering here ensures it shows up on cold-load).
setLoadedSong(loadedSong);

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
