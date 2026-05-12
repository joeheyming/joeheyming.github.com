/**
 * Chord library + algorithmic finder for the Strings page.
 *
 * Guitar and ukulele voicings come from `chord-data.js`, a build-time
 * filter of the MIT-licensed tombatossals/chords-db dataset. Each
 * voicing carries an explicit `fingers` array (1=index .. 4=pinky, 0
 * for none) so the player sees a textbook-vetted fingering rather than
 * something derived by a heuristic.
 *
 * Banjo and mandolin aren't in chords-db, so they fall through to the
 * algorithmic finder (`deriveChordVoicings`) which brute-force searches
 * playable shapes for any tuning. Same fallback covers the few keys
 * (uke C♯ / F♯) where chords-db has no positions on file.
 *
 * Frets are HIGH-string-first (array index 0 → highest pitch in the
 * instrument's tuning), -1 = muted, 0 = open. Voicing keys are
 * `${ROOT_PC}|${QUALITY}` where ROOT_PC is 0-11 and QUALITY is one of
 * maj/min/7/maj7/m7/sus2/sus4. Pitch class collapses enharmonic
 * spellings (C♯ and D♭ share key `1|*`).
 */

import { CHORD_DATA } from './chord-data.js';

// `name` is the canonical (sharp-spelled) display used in chord names
// (e.g. "C♯maj7"), pad labels, and the fretboard root overlay. `flat`
// is the enharmonic-equivalent flat spelling shown ALONGSIDE `name`
// in the root-picker buttons (e.g. the C♯/D♭ button) so players see
// at a glance that flats are supported and don't conclude the app
// "forgot" them. Naturals (C, D, E, F, G, A, B) have no `flat`.
export const ROOTS = [
  { name: 'C', pc: 0 },
  { name: 'C♯', flat: 'D♭', pc: 1 },
  { name: 'D', pc: 2 },
  { name: 'D♯', flat: 'E♭', pc: 3 },
  { name: 'E', pc: 4 },
  { name: 'F', pc: 5 },
  { name: 'F♯', flat: 'G♭', pc: 6 },
  { name: 'G', pc: 7 },
  { name: 'G♯', flat: 'A♭', pc: 8 },
  { name: 'A', pc: 9 },
  { name: 'A♯', flat: 'B♭', pc: 10 },
  { name: 'B', pc: 11 }
];

// Quality order matters for the chord-builder UI: triads first
// (maj/min/sus2/sus4/aug/dim), then sevenths (7 / maj7 / m7 / mMaj7
// / dim7 / m7b5), then sixths (6 / m6). This keeps related families
// grouped so the player can scan visually instead of hunting.
//
// `suffix` is the lead-sheet symbol appended to the root (e.g.
// `Cm7b5`, `Edim7`) and `label` is the short button text.
export const QUALITIES = [
  { id: 'maj', label: 'Major', suffix: '' },
  { id: 'min', label: 'Minor', suffix: 'm' },
  { id: 'sus2', label: 'sus2', suffix: 'sus2' },
  { id: 'sus4', label: 'sus4', suffix: 'sus4' },
  { id: 'aug', label: 'aug', suffix: 'aug' },
  { id: 'dim', label: 'dim', suffix: 'dim' },
  { id: '7', label: '7', suffix: '7' },
  { id: 'maj7', label: 'maj7', suffix: 'maj7' },
  { id: 'm7', label: 'm7', suffix: 'm7' },
  { id: 'mMaj7', label: 'mMaj7', suffix: 'mMaj7' },
  { id: 'dim7', label: 'dim7', suffix: 'dim7' },
  { id: 'm7b5', label: 'm7♭5', suffix: 'm7♭5' },
  { id: '6', label: '6', suffix: '6' },
  { id: 'm6', label: 'm6', suffix: 'm6' }
];

/**
 * Pitch-class intervals from the root for each chord quality. Used to
 * (a) figure out which fretted note is the root for highlighting, and
 * (b) feed the algorithmic chord-shape finder for instruments /
 *     qualities not covered by the curated chord-data.js dataset.
 *
 * Adding a new quality here makes it playable on banjo / mandolin
 * immediately (algorithmic finder) and on guitar / ukulele as soon as
 * a voicing is available (or via the algorithmic fallback when not).
 */
export const QUALITY_INTERVALS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  aug: [0, 4, 8],
  dim: [0, 3, 6],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mMaj7: [0, 3, 7, 11],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9]
};

/**
 * Look up textbook voicings (with fingerings) from chord-data.js for an
 * instrument that has a database entry. Returns `[]` for any
 * (instrument, root, quality) combo not covered — the caller falls
 * through to `deriveChordVoicings` when this happens.
 *
 * Ukulele's database is missing C♯ and F♯ entirely (every quality);
 * the caller fills those gaps with the algorithmic finder.
 */
export function lookupVoicings(instrumentId, pc, quality) {
  const inst = CHORD_DATA[instrumentId];
  if (!inst) return [];
  return inst[`${pc}|${quality}`] || [];
}

/**
 * Algorithmic chord-voicing finder for any tuning. Brute-force searches
 * every combination of (chord-tone fret OR muted) per string within the
 * first 7 frets, then scores each combination and picks the best.
 *
 * The scoring rewards low fret position, compact hand reach, fewer
 * mutes, and open-string chord tones. Required constraints: every
 * chord pitch class is sounded by at least one string, and the
 * fretted-note span is ≤ 4 frets (so a single hand can reach).
 *
 * The brute-force search matters: a per-string greedy (pick lowest
 * matching fret independently) misses chord tones whenever an open
 * string already plays a different chord tone. For example, on uke
 * {GCEA} for Cm = {C, Eb, G}, a greedy pick gives [3,3,0,0] — C and G
 * doubled, no Eb — instead of the standard [3,3,3,0] = `0333`.
 *
 * Drone strings (banjo's 5th, with `startFret > 0`) can only sound at
 * their fixed open pitch, so their option list is `[mute, startFret]`.
 * The 5th-string fret is excluded from the "fretted span" calculation
 * since the player doesn't actually finger it (it's a thumb drone).
 *
 * Returns a single-voicing array shaped like `lookupVoicings()` so the
 * page wiring can swap between curated and derived without branching.
 */
export function deriveChordVoicings(tuning, fretCount, rootPc, qualityId) {
  const intervals = QUALITY_INTERVALS[qualityId];
  if (!intervals) return [];
  const chordPCs = new Set(intervals.map((i) => (rootPc + i) % 12));
  const stringCount = tuning.length;

  // Search three position windows so the user gets a real choice of
  // shapes (open + mid + high), Ultimate-Guitar-style. Without this the
  // player only ever sees one voicing per chord on uke/banjo/mandolin.
  // Windows overlap at fret 5 / 8 so a chord whose best mid voicing
  // happens to start at fret 5 still wins both windows; we dedupe at
  // the end.
  const positions = [
    { name: 'Open', minFret: 0, maxFret: Math.min(4, fretCount) },
    { name: 'Mid', minFret: 3, maxFret: Math.min(8, fretCount) },
    { name: 'High', minFret: 7, maxFret: Math.min(12, fretCount) }
  ];

  const findBest = (window) => {
    // Per-string options: muted, plus every fret inside the window
    // whose pitch is a chord tone. Drone strings (banjo 5th) only ring
    // at their fixed startFret regardless of the window.
    const stringOptions = tuning.map((str) => {
      const startFret = str.startFret || 0;
      const opts = [-1];
      if (startFret > 0) {
        if (chordPCs.has(str.midi % 12)) opts.push(startFret);
        return opts;
      }
      // Allow open strings even outside the window — open chord tones
      // on barre/high voicings are normal (e.g. low E ringing under a
      // mid-position D shape).
      if (chordPCs.has(str.midi % 12)) opts.push(0);
      for (let f = Math.max(1, window.minFret); f <= window.maxFret; f++) {
        if (chordPCs.has((str.midi + f) % 12)) opts.push(f);
      }
      return opts;
    });

    let best = null;
    const candidate = new Array(stringCount);
    const recurse = (i) => {
      if (i === stringCount) {
        const sc = scoreVoicing(candidate, tuning, chordPCs, window);
        if (sc != null && (best == null || sc < best.score)) {
          best = { score: sc, frets: [...candidate] };
        }
        return;
      }
      for (const f of stringOptions[i]) {
        candidate[i] = f;
        recurse(i + 1);
      }
    };
    recurse(0);
    return best;
  };

  const results = [];
  const seen = new Set();
  for (const window of positions) {
    if (window.minFret > fretCount) continue;
    const best = findBest(window);
    if (!best) continue;
    // Dedupe identical voicings across overlapping windows.
    const key = best.frets.join(',');
    if (seen.has(key)) continue;
    seen.add(key);

    const nonDroneFretted = best.frets.filter((f, i) => f > 0 && (tuning[i].startFret || 0) === 0);
    const minF = nonDroneFretted.length ? Math.min(...nonDroneFretted) : 0;
    // Label by actual hand position rather than the search window — a
    // "Mid" search that found an all-open shape should still read as
    // "Open" to the player.
    let name;
    if (minF === 0) name = 'Open';
    else if (minF <= 3) name = 'Open';
    else name = `Pos ${minF}`;
    results.push({ name, frets: best.frets });
  }

  // If two voicings ended up with the same display name (e.g. "Pos 5"
  // from both Mid and High windows when only one was findable), suffix
  // them ("Pos 5", "Pos 5+") so the radios remain distinct.
  const nameCounts = {};
  return results.map((v) => {
    const n = nameCounts[v.name] || 0;
    nameCounts[v.name] = n + 1;
    return n === 0 ? v : { ...v, name: `${v.name}${'+'.repeat(n)}` };
  });
}

/**
 * Score a complete voicing for the brute-force chord finder. Lower
 * scores are better; `null` means the voicing is invalid (missing a
 * chord tone or unreachable hand span).
 *
 * Open strings (`f === startFret`) don't count toward the fretted span
 * since they don't need a finger. Drone strings (banjo 5th, with
 * `startFret > 0`) are also excluded — the player's thumb handles them
 * independently of the fretting hand.
 */
function scoreVoicing(frets, tuning, chordPCs, window) {
  const sounded = new Set();
  let maxFretted = 0;
  let minFretted = Infinity;
  let muted = 0;
  let openCount = 0;
  for (let s = 0; s < tuning.length; s++) {
    const f = frets[s];
    const startFret = tuning[s].startFret || 0;
    if (f < 0) {
      muted++;
      continue;
    }
    if (f === startFret) openCount++;
    if (f > startFret && startFret === 0) {
      if (f > maxFretted) maxFretted = f;
      if (f < minFretted) minFretted = f;
    }
    sounded.add((tuning[s].midi + (f - startFret)) % 12);
  }
  for (const pc of chordPCs) if (!sounded.has(pc)) return null;
  if (sounded.size === 0) return null;
  const range = maxFretted > 0 ? maxFretted - minFretted : 0;
  if (range > 4) return null;

  // For non-Open windows, penalise voicings whose lowest fretted note
  // sits below the window's floor — otherwise every higher window
  // collapses back onto the open shape and we never get distinct
  // mid/high voicings to show the player.
  const windowFloorPenalty = window && window.minFret > 0 && minFretted < window.minFret ? 50 : 0;

  return maxFretted * 5 + range * 4 + muted * 30 - openCount + windowFloorPenalty;
}

/**
 * Compute a sensible left-hand fingering for a voicing.
 *
 * Conventions: 1=index, 2=middle, 3=ring, 4=pinky; 0 means "no finger
 * needed" (open or muted). Returns an array the same length as `frets`.
 *
 * `tuning` is optional — when provided, drone strings (those with
 * `startFret > 0`) are treated as open at their `startFret`, so
 * banjo's 5th-string at fret 5 doesn't get a phantom finger number
 * (it's plucked by the thumb, not fingered). Without a tuning the
 * algorithm degrades to "any non-zero fret = fretted", which is fine
 * for guitar / uke / mandolin where startFret is uniformly 0.
 *
 * Heuristic:
 *   - Group fretted strings by their fret value, lowest first.
 *   - If the lowest-fret group has ≥2 strings AND there are notes at
 *     higher frets above it, treat that group as a barre (all those
 *     strings get finger 1).
 *   - Each subsequent unique fret value gets the next finger (2, 3, 4),
 *     with all strings at that fret sharing the finger (mini-barre).
 *
 * This isn't always the textbook fingering for advanced shapes, but it
 * gives the player a clear, unambiguous starting point: lowest finger
 * on lowest fret, ascend from there. That's how chord books teach it.
 */
export function assignFingers(frets, tuning) {
  const fingers = frets.map(() => 0);
  const fretted = [];
  frets.forEach((f, i) => {
    const startFret = tuning ? tuning[i]?.startFret || 0 : 0;
    // A fret equal to startFret is the string's "open" position even
    // when startFret > 0 (drone strings); skip it.
    if (f > 0 && f > startFret) fretted.push({ stringIdx: i, fret: f });
  });
  if (!fretted.length) return fingers;

  const uniqFrets = [...new Set(fretted.map((x) => x.fret))].sort((a, b) => a - b);
  const lowFret = uniqFrets[0];
  const lowFretStrings = fretted.filter((x) => x.fret === lowFret);
  const isBarre = lowFretStrings.length >= 2 && uniqFrets.length > 1;

  let nextFinger = 1;
  uniqFrets.forEach((fret, idx) => {
    const stringsHere = fretted.filter((x) => x.fret === fret);
    if (idx === 0 && isBarre) {
      stringsHere.forEach(({ stringIdx }) => {
        fingers[stringIdx] = 1;
      });
      nextFinger = 2;
    } else {
      stringsHere.forEach(({ stringIdx }) => {
        fingers[stringIdx] = nextFinger;
      });
      // Cap at 4 so unusually wide shapes (5+ unique frets) keep the
      // pinky on the highest fret rather than running out of fingers.
      nextFinger = Math.min(nextFinger + 1, 4);
    }
  });

  return fingers;
}

/**
 * Detect a barre in a voicing — multiple strings pressed by the same
 * finger at the same fret. Returns `{ fret, finger, fromString,
 * toString }` (string indices span the bar) or `null`.
 *
 * Two modes:
 *
 *   1. Explicit `fingers` (chord-data voicings). Group fretted strings
 *      by `(fret, finger)`; any group with ≥ 2 members is a barre by
 *      that finger. We pick the lowest-fret barre and break ties on
 *      the lowest finger number (so a barre 1 across fret 1 wins over
 *      a barre 3 across fret 2). This correctly handles A major
 *      `[0,2,2,2,0,-1]` with fingers `[0,3,2,1,0,0]` — three separate
 *      fingers at fret 2, NOT a barre.
 *
 *   2. No fingers provided (algorithmic voicings for banjo/mandolin).
 *      Fall back to the heuristic: lowest fretted note, ≥ 2 strings
 *      sounding it, finger 1 by convention.
 *
 * "Contiguous span": we extend the bar from the lowest-indexed barred
 * string to the highest. Strings inside the span that are muted or
 * fretted higher still get the bar drawn under them — the finger
 * physically lays across all strings inside that span, even if some
 * are pressed down further by other fingers on top of the bar.
 */
export function detectBarre(frets, tuning, fingers) {
  if (fingers && fingers.length === frets.length) {
    const groups = new Map();
    frets.forEach((f, i) => {
      const finger = fingers[i];
      if (f > 0 && finger > 0) {
        const key = `${f}|${finger}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }
    });
    let best = null;
    for (const [key, strings] of groups) {
      if (strings.length < 2) continue;
      const [fret, finger] = key.split('|').map(Number);
      if (!best || fret < best.fret || (fret === best.fret && finger < best.finger)) {
        best = {
          fret,
          finger,
          fromString: Math.min(...strings),
          toString: Math.max(...strings)
        };
      }
    }
    return best;
  }

  const fretted = [];
  frets.forEach((f, i) => {
    const startFret = tuning ? tuning[i]?.startFret || 0 : 0;
    if (f > 0 && f > startFret) fretted.push({ stringIdx: i, fret: f });
  });
  if (fretted.length < 2) return null;

  const lowFret = Math.min(...fretted.map((x) => x.fret));
  const lowFretStrings = fretted.filter((x) => x.fret === lowFret).map((x) => x.stringIdx);
  if (lowFretStrings.length < 2) return null;

  return {
    fret: lowFret,
    finger: 1,
    fromString: Math.min(...lowFretStrings),
    toString: Math.max(...lowFretStrings)
  };
}

/**
 * Parse a chord name like `"Em"`, `"C#m7"`, `"Bb"`, `"Csus2"`,
 * `"f#sus4"` into `{ rootPc, qualityId }`. Returns `null` for anything
 * we can't handle (e.g. dim, aug, 9, add4, slash chords).
 *
 * Notation rules we honour:
 *   - Root letter: A–G or a–g (case-insensitive).
 *   - Accidental: `#` / `♯` raise, `b` / `♭` lower. Only single
 *     accidentals (no double-sharps / double-flats).
 *   - Quality suffix is case-sensitive for the m/M ambiguity:
 *       (empty)              → maj
 *       `m`, `min`           → min
 *       `M`, `maj`, `Maj`    → maj
 *       `7`                  → 7   (dominant 7th)
 *       `m7`, `min7`         → m7
 *       `maj7`, `Maj7`, `M7` → maj7
 *       `Δ`, `Δ7`            → maj7  (jazz lead-sheet shorthand)
 *       `sus2`               → sus2
 *       `sus4`, `sus`        → sus4
 *
 * The shorthand here intentionally mirrors what most chord apps,
 * songbooks, and lead sheets use; it isn't a full Roman-numeral parser.
 */
export function parseChordName(input) {
  if (!input || typeof input !== 'string') return null;
  // Normalize Unicode accidentals + lead-sheet symbols to ASCII so the
  // quality-suffix table below only has to think about plain text:
  //   Δ / Δ7  → maj7   (jazz "delta" = major seventh)
  //   °       → dim    (degree sign = diminished triad)
  //   °7      → dim7   (degree-seven = fully diminished seventh)
  //   ø / Ø   → m7b5   (slashed-O = half-diminished seventh)
  //   +       → aug    (plus = augmented triad)
  // Order matters: replace `°7` and `Δ7` before `°` and `Δ`.
  const s = input
    .trim()
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/Δ7/g, 'maj7')
    .replace(/Δ/g, 'maj7')
    .replace(/°7/g, 'dim7')
    .replace(/°/g, 'dim')
    .replace(/[øØ]/g, 'm7b5')
    .replace(/\+/g, 'aug');
  if (!s) return null;
  const m = /^([A-Ga-g])([#b])?(.*)$/.exec(s);
  if (!m) return null;
  const [, letter, accidental, rest] = m;
  const letterPc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[letter.toLowerCase()];
  if (letterPc == null) return null;
  let pc = letterPc;
  if (accidental === '#') pc = (pc + 1) % 12;
  else if (accidental === 'b') pc = (pc + 11) % 12;

  // Case-sensitive on m/M because Cm7 (minor 7th) ≠ CM7 (major 7th).
  // Whitespace and parentheses inside the quality string are stripped
  // so `m(maj7)` and `m maj7` both land on `mMaj7`.
  const tail = rest.replace(/[\s()]/g, '');
  const qualityMap = {
    '': 'maj',
    M: 'maj',
    maj: 'maj',
    Maj: 'maj',
    m: 'min',
    min: 'min',
    7: '7',
    m7: 'm7',
    min7: 'm7',
    maj7: 'maj7',
    Maj7: 'maj7',
    M7: 'maj7',
    mMaj7: 'mMaj7',
    mmaj7: 'mMaj7',
    minMaj7: 'mMaj7',
    mM7: 'mMaj7',
    sus2: 'sus2',
    sus4: 'sus4',
    sus: 'sus4',
    aug: 'aug',
    Aug: 'aug',
    dim: 'dim',
    Dim: 'dim',
    dim7: 'dim7',
    Dim7: 'dim7',
    m7b5: 'm7b5',
    'min7b5': 'm7b5',
    halfdim: 'm7b5',
    halfdim7: 'm7b5',
    6: '6',
    maj6: '6',
    M6: '6',
    m6: 'm6',
    min6: 'm6'
  };
  const qualityId = qualityMap[tail];
  if (!qualityId) return null;
  return { rootPc: pc, qualityId };
}

/**
 * Render a `(rootPc, qualityId)` pair as a display chord name like
 * `"Em"`, `"C♯maj7"`, `"B♭7"`. Uses Unicode `♯` / `♭` for the
 * accidentals (prettier than ASCII `#`/`b`); the ROOTS table already
 * uses `♯`. Returns an empty string for unknown qualities.
 */
export function formatChordName(rootPc, qualityId) {
  const root = ROOTS.find((r) => r.pc === rootPc);
  const q = QUALITIES.find((qq) => qq.id === qualityId);
  if (!root || !q) return '';
  return `${root.name}${q.suffix}`;
}

/**
 * Voicing dispatcher used by the page. Returns an array of
 * `{ name, frets, fingers? }` voicings for the given instrument and
 * chord. `fingers` is present whenever the chord came from chord-data
 * (guitar / most uke chords); the algorithmic fallback omits it and
 * relies on `assignFingers` at render time.
 *
 * Lookup order:
 *   1. chord-data.js (textbook fingerings from chords-db) — guitar +
 *      most ukulele chords land here.
 *   2. `deriveChordVoicings` — banjo, mandolin, and the few uke combos
 *      missing from chord-data (C♯ and F♯ in every quality).
 */
export function getChordVoicings(instrument, rootPc, qualityId) {
  const fromDb = lookupVoicings(instrument.id, rootPc, qualityId);
  if (fromDb.length) return fromDb;
  return deriveChordVoicings(instrument.tuning, instrument.fretCount, rootPc, qualityId);
}
