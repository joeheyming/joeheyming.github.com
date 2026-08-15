/**
 * Notation helpers: durations (in 16th units), time/key signatures, beaming.
 */

/** Duration in 16th-note units for undotted values. */
export const DUR = {
  whole: 16,
  half: 8,
  quarter: 4,
  eighth: 2,
  sixteenth: 1
};

export const TIME_SIGS = [
  { beats: 2, unit: 4, label: '2/4' },
  { beats: 3, unit: 4, label: '3/4' },
  { beats: 4, unit: 4, label: '4/4' },
  { beats: 5, unit: 4, label: '5/4' },
  { beats: 6, unit: 8, label: '6/8' },
  { beats: 7, unit: 8, label: '7/8' },
  { beats: 9, unit: 8, label: '9/8' },
  { beats: 12, unit: 8, label: '12/8' }
];

/** Major key names by circle-of-fifths index (-7..+7). */
export const KEY_NAMES = {
  [-7]: 'C♭ major',
  [-6]: 'G♭ major',
  [-5]: 'D♭ major',
  [-4]: 'A♭ major',
  [-3]: 'E♭ major',
  [-2]: 'B♭ major',
  [-1]: 'F major',
  0: 'C major',
  1: 'G major',
  2: 'D major',
  3: 'A major',
  4: 'E major',
  5: 'B major',
  6: 'F♯ major',
  7: 'C♯ major'
};

/** Pitch-class offsets (0=C) that get sharps/flats from keySig fifths. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B as pc: F=5... wait use letter steps
/** Letter indices in C D E F G A B for sharp order F C G D A E B */
const SHARP_LETTERS = [3, 0, 4, 1, 5, 2, 6];
const FLAT_LETTERS = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function parseTimeSig(value) {
  const found = TIME_SIGS.find((t) => t.label === value);
  return found ? { beats: found.beats, unit: found.unit } : { beats: 4, unit: 4 };
}

export function timeSigLabel(ts) {
  return `${ts.beats}/${ts.unit}`;
}

/** Sixteenths in one written beat (denominator unit). */
export function sixteenthsPerUnit(unit) {
  return 16 / unit;
}

/** Total 16ths in one measure. */
export function measureSixteenths(timeSig) {
  return timeSig.beats * sixteenthsPerUnit(timeSig.unit);
}

export function totalSixteenths(measures, timeSig) {
  return measures * measureSixteenths(timeSig);
}

/**
 * 16th-grid start positions of every beat across the score. A beat is one
 * denominator unit; the first beat of each measure is flagged as a downbeat.
 * @returns {{ start: number, downbeat: boolean }[]}
 */
export function beatPositions(timeSig, measures) {
  const beatLen = sixteenthsPerUnit(timeSig.unit);
  const perMeasure = measureSixteenths(timeSig);
  const positions = [];
  for (let m = 0; m < measures; m++) {
    const measureStart = m * perMeasure;
    for (let b = 0; b < timeSig.beats; b++) {
      positions.push({ start: measureStart + b * beatLen, downbeat: b === 0 });
    }
  }
  return positions;
}

/** Sixteenths remaining from `start` until the next barline. */
export function roomInMeasure(start, timeSig) {
  const m = measureSixteenths(timeSig);
  if (m <= 0) return 1;
  const off = ((start % m) + m) % m;
  return m - off;
}

/** Sixteenths from `start` until the end of its beat/beam group. */
export function roomInBeatGroup(start, timeSig) {
  const off = offsetInMeasure(start, timeSig);
  const sizes = beamGroupSizes(timeSig);
  let acc = 0;
  for (const size of sizes) {
    if (off < acc + size) return acc + size - off;
    acc += size;
  }
  return Math.max(1, roomInMeasure(start, timeSig));
}

/** True when `start` falls on a beat/beam-group boundary (or barline). */
export function isBeatGroupStart(start, timeSig) {
  const off = offsetInMeasure(start, timeSig);
  return beamGroupStarts(timeSig).includes(off);
}

/**
 * Clip a preferred duration so the note does not cross a barline or
 * run past the end of the score. Always at least one 16th when there is room.
 * Prefer `segmentDurationAcrossMeasures` for place/drag.
 */
export function fitDurationToMeasure(start, preferredDuration, timeSig, measures) {
  const total = totalSixteenths(measures, timeSig);
  if (start >= total) return 1;
  const room = Math.min(roomInMeasure(start, timeSig), total - start);
  return clamp(Math.min(preferredDuration, room), 1, Math.max(1, preferredDuration));
}

const UNDOTTED_VALUES = [16, 8, 4, 2, 1];
const DOTTED_VALUES = [24, 12, 6, 3]; // dotted whole..dotted eighth (in 16ths)

/**
 * Greedy spelling of a span that must stay inside one measure chunk:
 * largest undotted DUR that fits, else a dotted value that fits exactly.
 */
export function spellDurationChunk(length) {
  if (length <= 0) return [];
  const parts = [];
  let left = length;
  while (left > 0) {
    let took = 0;
    for (const v of UNDOTTED_VALUES) {
      if (v <= left) {
        took = v;
        break;
      }
    }
    if (!took) {
      // left is somehow < 1 — shouldn't happen
      parts.push(1);
      break;
    }
    // Prefer a single dotted value when it exactly fills leftover
    if (took < left) {
      const exactDot = DOTTED_VALUES.find((d) => d === left);
      if (exactDot) {
        parts.push(exactDot);
        break;
      }
    }
    parts.push(took);
    left -= took;
  }
  return parts;
}

/**
 * Split an intended sounding duration starting at `start` into written
 * segments that respect beat groups and never cross a barline.
 * Off-beat starts only fill to the next beat (then tie); on-beat starts
 * may span multiple beats within the measure. Truncates only at score end.
 * @returns {{ start: number, duration: number }[]}
 */
export function segmentDurationAcrossMeasures(start, intended, timeSig, measures) {
  const total = totalSixteenths(measures, timeSig);
  const segments = [];
  let pos = clamp(Math.round(start), 0, Math.max(0, total - 1));
  let remaining = Math.max(0, Math.round(intended));
  if (remaining <= 0 || pos >= total) return segments;

  while (remaining > 0 && pos < total) {
    const barRoom = roomInMeasure(pos, timeSig);
    const beatRoom = roomInBeatGroup(pos, timeSig);
    // On the beat: fill through the measure (greedy spelling). Off-beat: only to next beat.
    const metricRoom = isBeatGroupStart(pos, timeSig) ? barRoom : beatRoom;
    const room = Math.min(metricRoom, total - pos, remaining);
    if (room <= 0) break;
    const chunks = spellDurationChunk(room);
    for (const dur of chunks) {
      if (dur <= 0) continue;
      segments.push({ start: pos, duration: dur });
      pos += dur;
      remaining -= dur;
      if (remaining <= 0 || pos >= total) break;
    }
  }
  return segments;
}

/** Apply dotted multiplier (×1.5), snap to integer 16ths when possible. */
export function applyDot(baseDur, dotted) {
  if (!dotted) return baseDur;
  const d = baseDur * 1.5;
  return Number.isInteger(d) ? d : Math.round(d);
}

export function baseDurationId(duration) {
  // Strip one dot if present
  for (const id of ['whole', 'half', 'quarter', 'eighth', 'sixteenth']) {
    const base = DUR[id];
    if (duration === base) return { id, dotted: false, base };
    if (duration === applyDot(base, true)) return { id, dotted: true, base };
  }
  // Fallback nearest
  let best = 'quarter';
  let bestDiff = Infinity;
  for (const id of Object.keys(DUR)) {
    const diff = Math.abs(DUR[id] - duration);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = id;
    }
  }
  return { id: best, dotted: false, base: DUR[best] };
}

export function isFilledHead(duration) {
  return duration < 8; // quarter and shorter
}

/** Stem flags for unbeamed notes (dotted eighth still gets one flag). */
export function flagCount(duration) {
  if (duration <= 1) return 2; // sixteenth
  if (duration <= 3) return 1; // eighth or dotted eighth
  return 0;
}

/** True when a written duration should participate in beams. */
export function isBeamableDuration(duration) {
  return duration > 0 && duration <= 3;
}

/**
 * Beat-group sizes in 16ths for beaming, based on time signature.
 * Simple duple/triple in quarters; compound in dotted-quarters.
 */
export function beamGroupSizes(timeSig) {
  const { beats, unit } = timeSig;
  if (unit === 8 && beats % 3 === 0) {
    // Compound: groups of dotted quarter = 6 sixteenths
    const groups = [];
    for (let i = 0; i < beats / 3; i++) groups.push(6);
    return groups;
  }
  if (unit === 4) {
    return Array.from({ length: beats }, () => 4);
  }
  if (unit === 8) {
    // Irregular like 7/8 — group as quarters then remainder
    const groups = [];
    let left = beats;
    while (left >= 3) {
      groups.push(6);
      left -= 3;
    }
    while (left > 0) {
      groups.push(2);
      left -= 1;
    }
    return groups;
  }
  return Array.from({ length: beats }, () => sixteenthsPerUnit(unit));
}

/** Absolute 16th positions where beam groups start within a measure (0-based). */
export function beamGroupStarts(timeSig) {
  const sizes = beamGroupSizes(timeSig);
  const starts = [0];
  let acc = 0;
  for (let i = 0; i < sizes.length - 1; i++) {
    acc += sizes[i];
    starts.push(acc);
  }
  return starts;
}

export function measureIndex(start, timeSig) {
  const m = measureSixteenths(timeSig);
  return Math.floor(start / m);
}

export function offsetInMeasure(start, timeSig) {
  const m = measureSixteenths(timeSig);
  return start % m;
}

/** Which beam-group index a start falls into within its measure. */
export function beamGroupIndex(start, timeSig) {
  const off = offsetInMeasure(start, timeSig);
  const sizes = beamGroupSizes(timeSig);
  let acc = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (off < acc + sizes[i]) return i;
    acc += sizes[i];
  }
  return sizes.length - 1;
}

/**
 * Key signature accidental for a diatonic letter index 0=C..6=B.
 * Returns 'sharp' | 'flat' | null (natural in key).
 */
export function keyAccidentalForLetter(keySig, letterIndex) {
  const k = clamp(keySig, -7, 7);
  if (k > 0) {
    const sharpened = new Set(SHARP_LETTERS.slice(0, k));
    return sharpened.has(letterIndex) ? 'sharp' : null;
  }
  if (k < 0) {
    const flattened = new Set(FLAT_LETTERS.slice(0, -k));
    return flattened.has(letterIndex) ? 'flat' : null;
  }
  return null;
}

/** Letters that get accidentals drawn in the key signature, in order. */
export function keySignatureLetters(keySig) {
  const k = clamp(keySig, -7, 7);
  if (k > 0) return SHARP_LETTERS.slice(0, k).map((L) => ({ letter: L, accidental: 'sharp' }));
  if (k < 0) return FLAT_LETTERS.slice(0, -k).map((L) => ({ letter: L, accidental: 'flat' }));
  return [];
}

/**
 * Resolve sounding MIDI from staff step + accidental + key.
 * `letterOfStep(step)` maps step → 0..6 letter; `midiOfNaturalStep` gives white-key MIDI.
 */
export function resolveMidi(naturalMidi, letterIndex, accidental, keySig) {
  let midi = naturalMidi;
  const keyAcc = keyAccidentalForLetter(keySig, letterIndex);
  let alter = 0;
  if (accidental === 'sharp') alter = 1;
  else if (accidental === 'flat') alter = -1;
  else if (accidental === 'natural') alter = 0;
  else if (keyAcc === 'sharp') alter = 1;
  else if (keyAcc === 'flat') alter = -1;
  return midi + alter;
}

export const DYNAMICS = ['p', 'mp', 'mf', 'f'];

export const DYNAMIC_GAIN = {
  p: 0.45,
  mp: 0.65,
  mf: 0.85,
  f: 1.0
};
