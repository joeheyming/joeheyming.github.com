/**
 * Permissive chord-voicing judge.
 *
 * The chart specifies a target chord per beat. The player can press any
 * combination of Stradella buttons inside the hit window — the judge
 * scores what they actually pressed against the target chord's pitch-
 * class set and returns a multiplier tier:
 *
 *   full     — every pressed note fits in the target chord's scale,
 *              and the target root pitch class is present. Fancier
 *              voicings (D6, Dmaj7, D9 for a `D` target) all qualify.
 *              Multiplier 1.0×.
 *
 *   sub      — pressed notes form a different chord that **shares ≥ 3
 *              pitch classes** with the target. Mostly catches
 *              extension subs like Am7 ↔ C (both contain C, E, G).
 *              Multiplier 0.85×.
 *
 *   partial  — pressed shares ≥ 2 pitch classes with the target.
 *              Relative-minor / mediant substitutions land here.
 *              Multiplier 0.7×.
 *
 *   wrong    — 0–1 shared pitch classes, or nothing pressed. MISS.
 *              Multiplier 0×.
 *
 * The judge is a **pure function** of the pressed pitch-class set + the
 * target chord. It does not look at MIDI octaves and does not know about
 * timing. Timing judgment is done separately in `lane-engine.js` and
 * the two are multiplied for the final score.
 */

import { SHARP_NAMES, chordPitchClassSet } from '../play/accordion/stradella-chords.js';

export const VOICING_TIERS = {
  full: { multiplier: 1.0, label: 'PERFECT VOICING' },
  sub: { multiplier: 0.85, label: 'SMOOTH SUB' },
  partial: { multiplier: 0.7, label: 'CLOSE' },
  wrong: { multiplier: 0, label: 'OFF' }
};

/**
 * Identify the most likely chord the player actually played from their
 * pressed pitch-class set. Tries a small fixed list of common Stradella
 * voicings and picks the best match (root-present + most overlap).
 * Returns `null` if nothing reasonable matches.
 */
const QUALITIES = [
  { kind: 'maj7', intervals: [0, 4, 7, 11] },
  { kind: '9', intervals: [0, 4, 7, 10, 2] },
  { kind: '7', intervals: [0, 4, 7, 10] },
  { kind: '6', intervals: [0, 4, 7, 9] },
  { kind: 'm7', intervals: [0, 3, 7, 10] },
  { kind: 'm6', intervals: [0, 3, 7, 9] },
  { kind: 'dim7', intervals: [0, 3, 6, 9] },
  { kind: 'aug', intervals: [0, 4, 8] },
  { kind: 'maj', intervals: [0, 4, 7] },
  { kind: 'min', intervals: [0, 3, 7] },
  { kind: 'dim', intervals: [0, 3, 6] }
];

const KIND_SUFFIX = {
  maj: '',
  min: 'm',
  7: '7',
  6: '6',
  m6: 'm6',
  m7: 'm7',
  maj7: 'maj7',
  9: '9',
  dim: 'dim',
  dim7: 'dim7',
  aug: 'aug'
};

function nameChord(rootPc, kind) {
  return SHARP_NAMES[rootPc] + (KIND_SUFFIX[kind] ?? '');
}

/**
 * Best-fit chord name for what the player pressed. Iterates over every
 * (rootPc, quality) pair; picks the one whose interval set is the
 * largest subset of the pressed set, breaking ties by fewer extra
 * pitch classes outside the chord. Returns `null` if no chord matches.
 *
 * @param {Set<number>} pressedSet — pitch classes (0..11) the player held in the window.
 */
export function identifyChord(pressedSet) {
  if (!pressedSet || pressedSet.size === 0) return null;
  let best = null;
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const q of QUALITIES) {
      const chordPcs = new Set(q.intervals.map((iv) => (rootPc + iv) % 12));
      let overlap = 0;
      for (const pc of chordPcs) if (pressedSet.has(pc)) overlap += 1;
      if (overlap !== chordPcs.size) continue;
      // chord fully ⊆ pressed: every chord note is held.
      let extras = 0;
      for (const pc of pressedSet) if (!chordPcs.has(pc)) extras += 1;
      const score = overlap * 100 - extras * 5 - q.intervals.length;
      if (!best || score > best.score) {
        best = { rootPc, kind: q.kind, score, extras };
      }
    }
  }
  if (!best) return null;
  return {
    rootPc: best.rootPc,
    kind: best.kind,
    name: nameChord(best.rootPc, best.kind)
  };
}

/**
 * Judge what the player pressed against the chart's target chord.
 *
 * @param {Set<number>|number[]} pressed — pitch classes the player held.
 * @param {{rootPc:number, kind:string}|string} target — target chord (parsed shape or chord-name string).
 * @returns {{tier:string, multiplier:number, label:string, sharedCount:number, playedName:string|null}}
 */
export function judgeVoicing(pressed, target) {
  const pressedSet = pressed instanceof Set ? pressed : new Set(pressed || []);
  if (pressedSet.size === 0) {
    return {
      tier: 'wrong',
      multiplier: 0,
      label: 'EMPTY',
      sharedCount: 0,
      playedName: null
    };
  }

  // Build target pitch-class set.
  const targetSet =
    typeof target === 'string'
      ? chordPitchClassSet(target)
      : target && target.rootPc != null
        ? chordPitchClassSet(target)
        : null;
  if (!targetSet) {
    return {
      tier: 'wrong',
      multiplier: 0,
      label: 'NO TARGET',
      sharedCount: 0,
      playedName: null
    };
  }

  // Count overlap.
  let shared = 0;
  for (const pc of pressedSet) if (targetSet.has(pc)) shared += 1;
  const rootPc = typeof target === 'string' ? null : target.rootPc;
  const rootHeld = rootPc != null ? pressedSet.has(rootPc) : true;

  const played = identifyChord(pressedSet);

  // Full match: every pressed note ⊆ target scale AND root is present.
  // Allow any voicing of the target including extensions (Dmaj7, D6, D9
  // are all valid voicings of `D` as long as their notes are inside
  // the scale of D major — chordPitchClassSet returns the chord's
  // chord-tone set, not the full diatonic scale, so we widen here.)
  const extendedSet = expandToChordScale(target);
  let allInside = true;
  for (const pc of pressedSet) {
    if (!extendedSet.has(pc)) {
      allInside = false;
      break;
    }
  }
  if (allInside && (rootPc == null || rootHeld)) {
    return {
      tier: 'full',
      multiplier: VOICING_TIERS.full.multiplier,
      label: VOICING_TIERS.full.label,
      sharedCount: shared,
      playedName: played?.name ?? null
    };
  }

  if (shared >= 3) {
    return {
      tier: 'sub',
      multiplier: VOICING_TIERS.sub.multiplier,
      label: VOICING_TIERS.sub.label,
      sharedCount: shared,
      playedName: played?.name ?? null
    };
  }
  if (shared >= 2) {
    return {
      tier: 'partial',
      multiplier: VOICING_TIERS.partial.multiplier,
      label: VOICING_TIERS.partial.label,
      sharedCount: shared,
      playedName: played?.name ?? null
    };
  }
  return {
    tier: 'wrong',
    multiplier: 0,
    label: VOICING_TIERS.wrong.label,
    sharedCount: shared,
    playedName: played?.name ?? null
  };
}

/**
 * Pitch-class set that fully matches the target chord OR any reasonable
 * extension of it. For a `maj` target we accept the major-6 / maj7 / 9
 * extensions; for a `min` target the m6 / m7 extensions; for a `7`
 * target the 9 extension. This widens "full match" beyond strict
 * triad-only matching so the player can substitute fancier voicings.
 */
function expandToChordScale(target) {
  const parsed = typeof target === 'string' ? null : target;
  if (!parsed) {
    const s = chordPitchClassSet(target);
    return s || new Set();
  }
  const { rootPc, kind } = parsed;
  const intervals = (function intervalsFor(kindId) {
    switch (kindId) {
      case 'maj':
        return [0, 4, 7, 9, 11, 2]; // root + 3 + 5 + 6 + maj7 + 9
      case 'min':
        return [0, 3, 7, 9, 10, 2]; // root + b3 + 5 + 6 + b7 + 9
      case '7':
        return [0, 4, 7, 10, 2]; // root + 3 + 5 + b7 + 9
      case '6':
        return [0, 4, 7, 9];
      case 'm6':
        return [0, 3, 7, 9];
      case 'm7':
        return [0, 3, 7, 10];
      case 'maj7':
        return [0, 4, 7, 11];
      case '9':
        return [0, 4, 7, 10, 2];
      case 'dim':
        return [0, 3, 6];
      case 'dim7':
        return [0, 3, 6, 9];
      case 'sus4':
        return [0, 5, 7];
      case 'sus2':
        return [0, 2, 7];
      case 'aug':
        return [0, 4, 8];
      default:
        return [0, 4, 7];
    }
  })(kind);
  return new Set(intervals.map((iv) => (rootPc + iv) % 12));
}
