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
import { createFretboardController } from './fretboard.js';
import { createStrumPopovers } from './strum-popovers.js';
import { initStrumDrag } from './strum-drag.js';

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

// Strum Bar palette — SHARED across all chord-capable instruments
// (guitar / ukulele / mandolin / banjo). Each entry is `{ rootPc:
// 0..11, qualityId: 'maj'|'min'|'7'|… }` — voicing is intentionally
// NOT part of pad identity, because the same chord (e.g. Cm) has
// different shape options on different instruments. The user's
// preferred shape is tracked separately, per-instrument, in
// `voicingPrefs` below.
//
// Mental model: the bar is "the chords for the song you're playing
// right now". Switching instruments is a render mode change — the
// chords are the same, only the way they're voiced on the neck
// changes.
//
// Capped at STRUM_BAR_MAX with LRU eviction so the row doesn't sprawl.
const STRUM_BAR_MAX = 8;
const chordKey = (rootPc, qualityId) => `${rootPc}:${qualityId}`;

const sanitizeBarEntry = (e) => {
  if (!e || typeof e !== 'object') return null;
  const rootPc = Number(e.rootPc);
  if (!Number.isInteger(rootPc) || rootPc < 0 || rootPc > 11) return null;
  if (typeof e.qualityId !== 'string') return null;
  if (!QUALITIES.some((q) => q.id === e.qualityId)) return null;
  return { rootPc, qualityId: e.qualityId };
};

// Extracts the player-facing fret position for a voicing — used as
// the small superscript on each pad. We match the chord library's
// own naming convention (`Barre 3`, `Pos 5`, …); open voicings
// (`Open`, `Open+`, …) intentionally render with no superscript so
// they read as "the chord with no neck position needed".
const voicingPositionSuperscript = (voicing) => {
  if (!voicing || typeof voicing.name !== 'string') return '';
  const m = /^(?:Barre|Pos)\s*(\d+)/i.exec(voicing.name);
  return m ? m[1] : '';
};

// `strumBar` (singular) is the global chord palette. `voicingPrefs`
// is a per-instrument map of chord-key -> voicing index, so each
// instrument remembers its preferred shape for each chord (guitar
// might like Cm Barre 3, ukulele might like the open one).
//
// Migration from the old per-instrument `prefs.strumBars` shape:
//   1. If new-shape `prefs.strumBar` exists, use it directly.
//   2. Else fall back to the active instrument's old per-instrument
//      bar — preserves the most-likely-relevant set of chords.
//   3. Build voicingPrefs from EVERY instrument's old per-instrument
//      bar so per-instrument shape preferences carry over.
// Rationale for picking the active instrument's bar over a union:
// the user almost certainly built their bar on whichever instrument
// they were last playing; merging in stale chords from instruments
// they haven't touched would be surprising.
/** @type {{ rootPc: number, qualityId: string }[]} */
const strumBar = (() => {
  if (Array.isArray(prefs.strumBar)) {
    return prefs.strumBar.map(sanitizeBarEntry).filter(Boolean).slice(0, STRUM_BAR_MAX);
  }
  const legacy = prefs.strumBars && typeof prefs.strumBars === 'object' ? prefs.strumBars : null;
  if (!legacy) return [];
  const activeBar = Array.isArray(legacy[initialInstrumentId]) ? legacy[initialInstrumentId] : [];
  // Dedupe by (root, quality) — old bars allowed multiple shapes of
  // the same chord as separate pads; we collapse to one entry per
  // chord, keeping the FIRST occurrence (which is the most-recently
  // pinned one, since pins prepend).
  const seen = new Set();
  const out = [];
  for (const e of activeBar) {
    const sane = sanitizeBarEntry(e);
    if (!sane) continue;
    const key = chordKey(sane.rootPc, sane.qualityId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sane);
    if (out.length >= STRUM_BAR_MAX) break;
  }
  return out;
})();

/** @type {Record<string, Record<string, number>>} */
const voicingPrefs = (() => {
  const seed = {};
  if (prefs.voicingPrefs && typeof prefs.voicingPrefs === 'object') {
    for (const [iid, map] of Object.entries(prefs.voicingPrefs)) {
      if (!map || typeof map !== 'object') continue;
      const cleaned = {};
      for (const [k, v] of Object.entries(map)) {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0) cleaned[k] = n;
      }
      seed[iid] = cleaned;
    }
  }
  // Rescue per-instrument voicings from the old strumBars shape.
  if (prefs.strumBars && typeof prefs.strumBars === 'object') {
    for (const [iid, bar] of Object.entries(prefs.strumBars)) {
      if (!Array.isArray(bar)) continue;
      if (!seed[iid]) seed[iid] = {};
      for (const e of bar) {
        if (!e || typeof e !== 'object') continue;
        const rootPc = Number(e.rootPc);
        if (!Number.isInteger(rootPc)) continue;
        if (typeof e.qualityId !== 'string') continue;
        const v = Number(e.voicingIdx);
        if (!Number.isInteger(v) || v <= 0) continue; // 0 is the default; no need to store
        const key = chordKey(rootPc, e.qualityId);
        // First-occurrence wins (matches how the bar was deduped above).
        if (!(key in seed[iid])) seed[iid][key] = v;
      }
    }
  }
  return seed;
})();

// Track the song the player loaded most recently so we can surface a
// clickable link back to the source page in the strum-bar header.
// Cleared when the user hits Clear or loads a different song.
/** @type {{ url: string, title: string, artist: string } | null} */
let loadedSong = (() => {
  const s = prefs.loadedSong;
  if (!s || typeof s !== 'object') return null;
  if (typeof s.url !== 'string' || !s.url) return null;
  return {
    url: s.url,
    title: typeof s.title === 'string' ? s.title : '',
    artist: typeof s.artist === 'string' ? s.artist : ''
  };
})();

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
//
// `createFretboardController` owns the .fretboard-grid DOM (rebuild
// on instrument switch) AND the pointer events that turn a tap on a
// cell into a pluck. It populates the shared `cellEls` map so the
// chord builder can still highlight individual cells, and exposes
// flash / announce helpers for everything else that wants visual
// feedback for a note (chord strum, MIDI input, etc.).

const fretboard = createFretboardController({
  fretboardEl,
  showNotesEl,
  nowPlaying,
  engine,
  cellEls,
  chordShapeCells,
  getActiveInstrument: () => activeInstrument,
});
const { build: buildFretboard, playFret, flashCell, announceNote } = fretboard;

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
 * inside .fretboard-grid.
 *
 * The label is the actual ROOT NOTE NAME (e.g. "C", "F♯", "B♭") rather
 * than a generic "R" — non-musicians found "R" confusing, and showing
 * the note tells the player both "this is the root" (via the red
 * colour) AND "you're playing a C", which doubles as a sanity check
 * against the chord name. The fretting finger number sits as a small
 * superscript so the player still knows which finger to use.
 */
const drawRootOverlay = (rootCell, fingerNumber, rootName) => {
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
  const label = rootName || 'R';
  if (fingerNumber && fingerNumber > 0) {
    el.innerHTML = `<span class="chord-root-marker-label">${label}<small>${fingerNumber}</small></span>`;
  } else {
    el.innerHTML = `<span class="chord-root-marker-label">${label}</span>`;
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
      // Display name for the root note ("C", "F♯", "B♭", …) — the
      // ROOTS table already uses the prettier Unicode accidentals.
      const rootName = ROOTS.find((r) => r.pc === rootPc)?.name || '';
      if (isOpenRoot) {
        // Open (or drone-open) root sits on a sticky / drone-start
        // label cell. The cell already shows the open-string letter
        // (e.g. "E", "A") and now sports the red `.in-chord-root`
        // tint, which is enough to tell the player "this is the root"
        // — adding an extra "R" badge on top was the part that
        // confused non-musicians.
        const stale = rootCell.querySelector('.finger-badge');
        if (stale) stale.remove();
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
      if (!isOpenRoot) drawRootOverlay(rootCell, finger, rootName);
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

// Roots get rendered specially so the enharmonic-flat spelling can sit
// next to the sharp on the same button (e.g. `C♯ / D♭`). We can't use
// the generic `renderRadioGroup` here because that helper only knows
// how to read a single text key per item.
//
// The visual hierarchy keeps the canonical sharp on top (slightly
// larger) and the flat below as a smaller "also known as" hint.
// That way tapping is still about a single pitch class — the row
// just doesn't pretend flats don't exist. Naturals (C/D/E/F/G/A/B)
// render as a single name with no second line.
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
// Quality and Shape just *adjust the chord* without playing — so the
// player can preset "minor 7th, barre voicing" and play C-m7 → F-m7 →
// G-m7 by tapping roots, without an unwanted re-strum every time they
// tweak the chord type.
rootOptionsEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button');
  if (!btn) return;
  const newRootPc = Number(btn.dataset.pc);
  // Edit mode: rewrite the armed pad's root in place (Em → Am etc.).
  // applyEditToPad handles all the syncing + strum, so we just
  // return early.
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
//
// The Strum Bar is the primary play surface for live strumming. Each
// pad shows a complete chord name ("Em", "A", "Cmaj7") and tapping it
// strums that chord. The bar auto-fills from every chord the player
// plays — via the matrix above, via `+` name input, or via tapping a
// pad — so an "Em A Em A" progression becomes one tap per change once
// both chords have been played once.
//
// SHARED across all chord-capable instruments (guitar/uke/mando/banjo).
// Switching instruments keeps the same chord set; only the rendered
// shapes change. Per-instrument shape preferences live in
// `voicingPrefs`.

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
    // index — the pad still plays SOMETHING (voicingIdx clamps to 0
    // in `playSelectedVoicing`), it just won't claim a fret position.
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
// part of the pad identity. Re-pinning a chord with a different
// voicing therefore UPDATES the active instrument's preferred shape
// for that chord rather than creating a parallel pad.
//
// We only LRU-promote on FIRST add so a "Em A Em A" loop doesn't
// shuffle the pads on every tap (which is disorienting when you're
// trying to play in time). LRU eviction still kicks in when a NEW
// chord arrives and the bar is at capacity.
const pinChordToBar = (rootPc, qualityId, voicingIdx = 0) => {
  if (!activeInstrument.chords) return;
  const idx = strumBar.findIndex((e) => e.rootPc === rootPc && e.qualityId === qualityId);
  // Update the active instrument's preferred voicing for this chord.
  // This also handles "user just played C Barre 3 instead of C Open"
  // — the pad keeps its position, the shape preference updates.
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
// feedback that their tap registered (and matches the fretboard's
// cell-flash convention). Pads are uniquely identified by (root,
// quality) — voicing isn't part of pad identity in the global bar.
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
// taps and the `+` name input. The voicingIdx is restored from the
// pad's stored value so re-tapping a pad always plays the SAME
// shape the player originally pinned (e.g. tapping the `C³` pad
// always plays the Barre 3 voicing, not the default Open).
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
//
// "Edit target" tracks the pad the player most recently tapped, so
// they can switch its voicing by clicking a Shape button without
// having to remove the pad and re-add it. The flow:
//
//   1. Tap pinned pad        → editTarget = that pad's identity
//   2. Click a Shape button  → if editTarget matches the current
//                              (root, quality), update that pad's
//                              voicingIdx in place (no new pad).
//   3. Tap a Root / Quality  → editTarget cleared. Subsequent shape
//                              changes pin a new pad as before.
//   4. Tap another pinned    → editTarget moves to the new pad.
//      pad
//
// This stays out of the way of "explore freely with the matrix" use
// (the link only exists immediately after a pad tap), and keeps the
// "creates a new pad for each new shape" model intact for everything
// else.

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
// player's eyes already are. When edit mode exits, we restore the
// original empty-state hint HTML (kept in STRUM_BAR_HINT_DEFAULT).
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
// editing. Each axis (root / quality / voicing) is optional — pass
// only the field you want to change; the rest carry over from the
// pad's current identity.
//
// Special cases the caller doesn't need to know about:
//   - Changing quality resets voicing to the default (shapes vary by
//     quality, so a "Barre 5" of m7 doesn't carry meaning to a "Barre
//     5" of sus2 — and the chord-data lists are different lengths).
//   - voicingIdx is clamped to the available voicings for the
//     resolved (root, quality) so we never index past the end.
//   - If another pinned pad already represents the resolved tuple,
//     it's deduped (removed) so the bar never has two identical pads.
//
// Side effects: mutates the bar entry in place, updates editTarget
// to the new identity, syncs builderState so the matrix below stays
// in lockstep with the pad, re-renders, persists, and strums the
// chord so the player hears the change.
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
  //     quality, see comment in voicingPrefs hydration).
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
  if (!voicings.length) {
    // No voicings available for the resolved chord — bail without
    // mutating.
    return false;
  }
  if (newVoicingIdx < 0 || newVoicingIdx >= voicings.length) newVoicingIdx = 0;

  // Dedupe: if a different pad already represents the new (root,
  // quality) identity, drop it. Keep the EDITED pad's slot so the
  // player's spatial memory ("the third pad is the chorus chord")
  // is preserved across the edit.
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
  // for an already-pinned identity (just updates voicingPref + flash),
  // so it doubles as both "play the new sound" AND "flash the
  // edited pad" in one call.
  playSelectedVoicing();
  return true;
};

// ---------- Clear-all ----------
//
// Wipe every pad in one shot. Useful after loading a song with
// leftover chords from a previous one. Also clears the edit target
// (its pad is gone) and the loaded-song reference (the chords those
// were FOR are gone, so the link would be misleading).

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
// place, so a bar of `[Em, A, D, G]` shifted +2 becomes `[F♯m, B, E,
// A]`. Voicing prefs stay keyed by the NEW (root, quality) — the
// next render resolves each pad's preferred shape via the existing
// `getVoicingIdxFor`, falling back to voicing 0 for chords the
// player has never picked a shape for on this instrument. (Pre-
// existing prefs for the OLD roots are preserved, so re-transposing
// back to where you started restores your shapes.)
//
// Pitch-class shift is a bijection on Z₁₂, so we don't need to dedupe
// — distinct (root, quality) pads stay distinct after the rotation.
//
// Side effects:
//   - editTarget follows the chord it was armed for, so "edit C"
//     becomes "edit D" after +2 instead of pointing at a ghost.
//   - The chord builder's current selection (builderState) is shifted
//     too, since the player's conceptual "key" has moved — the matrix
//     should reflect that.
//   - On undefined / 0-shift the function is a no-op (no save, no
//     re-render).

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
  // Re-render in the right order so the highlighted selections in
  // each panel match the new builderState. Voicings depends on
  // (root, quality), so it re-resolves after roots/qualities have
  // updated their `.selected` highlights.
  renderRoots();
  renderQualities();
  renderVoicings();
  renderStrumBar();
};

strumTransposeDownBtn?.addEventListener('click', () => transposeStrumBar(-1));
strumTransposeUpBtn?.addEventListener('click', () => transposeStrumBar(+1));

// ---------- Tap-to-play vs. drag-to-reorder ----------
//
// All the pointer-event plumbing for reordering strum-bar pads (touch
// long-press → drag, mouse / pen → DRAG_THRESHOLD direction-gated
// drag) plus the strum-pad click handler (tap to play + arm edit
// target) lives in ./strum-drag.js. Wired here so the orchestrator
// stays the integration point for editTarget + strumBar state.

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
//
// Add-by-name ("+") and load-song ("↧") both live in
// ./strum-popovers.js — they share open/close state (mutually
// exclusive) and the click-outside-to-dismiss pattern, so keeping
// them in one module avoids a circular dep between two halves of
// the same UI surface.

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

