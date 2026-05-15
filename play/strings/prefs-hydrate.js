// Strings page — one-shot prefs hydration. Lifts the noisy boot block out of
// strings.js: load saved prefs, migrate the legacy per-instrument strumBars
// shape into the new (root × quality) bar + per-instrument voicing map, and
// surface a small set of constants the rest of the page reuses.

import { INSTRUMENTS, DEFAULT_INSTRUMENT_ID } from './instruments.js';
import { QUALITIES } from './chords.js';

// Capped at this many pads with LRU eviction so the row doesn't sprawl.
export const STRUM_BAR_MAX = 8;

export const chordKey = (rootPc, qualityId) => `${rootPc}:${qualityId}`;

export const sanitizeBarEntry = (e) => {
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
export const voicingPositionSuperscript = (voicing) => {
  if (!voicing || typeof voicing.name !== 'string') return '';
  const m = /^(?:Barre|Pos)\s*(\d+)/i.exec(voicing.name);
  return m ? m[1] : '';
};

/**
 * @param {{ load: () => any }} Prefs
 * @param {HTMLInputElement} volumeEl
 * @param {HTMLInputElement} showNotesEl
 */
export function hydratePrefs(Prefs, volumeEl, showNotesEl) {
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

  // Strum Bar palette — SHARED across all chord-capable instruments.
  // Migration from the old per-instrument `prefs.strumBars` shape:
  //   1. If new-shape `prefs.strumBar` exists, use it directly.
  //   2. Else fall back to the active instrument's old per-instrument
  //      bar — preserves the most-likely-relevant set of chords.
  //   3. Build voicingPrefs from EVERY instrument's old per-instrument
  //      bar so per-instrument shape preferences carry over.
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
  /** @type {{ url: string, title: string, artist: string } | null} */
  const loadedSong = (() => {
    const s = prefs.loadedSong;
    if (!s || typeof s !== 'object') return null;
    if (typeof s.url !== 'string' || !s.url) return null;
    return {
      url: s.url,
      title: typeof s.title === 'string' ? s.title : '',
      artist: typeof s.artist === 'string' ? s.artist : ''
    };
  })();

  return {
    prefs,
    initialInstrumentId,
    tonesPerInstrument,
    strumBar,
    voicingPrefs,
    loadedSong
  };
}
