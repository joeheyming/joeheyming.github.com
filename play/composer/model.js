/**
 * Score model v2 — notes with start/duration on a 16th-note grid.
 */
import {
  DUR,
  applyDot,
  clamp,
  fitDurationToMeasure,
  measureSixteenths,
  parseTimeSig,
  roomInMeasure,
  segmentDurationAcrossMeasures,
  spellDurationChunk,
  totalSixteenths
} from './notation.js';

let _idSeq = 1;
export function nextId() {
  return `n${_idSeq++}`;
}

/** Treble natural MIDI steps: A3..C6 (white keys). */
export const TREBLE_NATURAL = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
/** Bass natural MIDI steps: C2..E4. */
export const BASS_NATURAL = [36, 38, 40, 41, 43, 45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64];

export function naturalsForStaff(staff) {
  return staff === 'bass' ? BASS_NATURAL : TREBLE_NATURAL;
}

/** Letter index 0=C .. 6=B from MIDI natural. */
export function letterIndexFromMidi(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const map = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
  return map[pc] ?? 0;
}

/** Nearest staff step whose white-key letter matches `letterIndex` (0=C..6=B). */
export function stepNearestLetter(staff, letterIndex, preferStep = 0) {
  const naturals = naturalsForStaff(staff);
  let best = Math.max(0, Math.min(naturals.length - 1, preferStep));
  let bestDist = Infinity;
  for (let i = 0; i < naturals.length; i++) {
    if (letterIndexFromMidi(naturals[i]) !== letterIndex) continue;
    const dist = Math.abs(i - preferStep);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

const LETTER_KEY_INDEX = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

/** Map key character a–g to letter index, or null. */
export function letterIndexFromKey(key) {
  if (!key || key.length !== 1) return null;
  const idx = LETTER_KEY_INDEX[key.toLowerCase()];
  return idx === undefined ? null : idx;
}

/** Demo Twinkle phrase — used only by Examples / tests, not the blank default. */
/** Demo Twinkle phrase — Examples / tests only; not the blank default. */
export function createDefaultNotes() {
  const steps = TREBLE_NATURAL;
  const idx = (midi) => steps.indexOf(midi);
  const seq = [72, 72, 79, 79, 81, 81, 79, null, 77, 77, 76, 76, 74, 74, 72];
  const notes = [];
  seq.forEach((midi, i) => {
    if (midi == null) return;
    notes.push(
      createNote({
        staff: 'treble',
        start: i * 4,
        duration: 4,
        step: idx(midi)
      })
    );
  });
  return notes;
}

export function createNote(partial = {}) {
  return {
    id: partial.id || nextId(),
    staff: partial.staff === 'bass' ? 'bass' : 'treble',
    voice: partial.voice === 1 ? 1 : 0,
    start: Number.isFinite(partial.start) ? partial.start : 0,
    duration: Number.isFinite(partial.duration) ? partial.duration : DUR.quarter,
    step: Number.isFinite(partial.step) ? partial.step : 0,
    accidental: partial.accidental || null,
    tieTo: partial.tieTo || null,
    dynamic: partial.dynamic || null,
    rest: !!partial.rest
  };
}

export function createEmptyScore() {
  return {
    version: 2,
    bpm: 100,
    volume: 70,
    measures: 4,
    timeSig: { beats: 4, unit: 4 },
    keySig: 0,
    notes: []
  };
}

function migrateV1(raw) {
  const score = createEmptyScore();
  if (typeof raw.bpm === 'number') score.bpm = clamp(raw.bpm, 40, 280);
  if (typeof raw.measures === 'number') score.measures = clamp(raw.measures, 1, 16);
  if (typeof raw.volume === 'number') score.volume = clamp(raw.volume, 0, 100);
  const OLD_NATURAL = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81];
  if (Array.isArray(raw.notes) && raw.notes.length) {
    score.notes = raw.notes
      .filter((n) => n && Number.isFinite(n.beat) && Number.isFinite(n.step))
      .map((n) => {
        const midi = OLD_NATURAL[clamp(Math.round(n.step), 0, OLD_NATURAL.length - 1)];
        let step = TREBLE_NATURAL.indexOf(midi);
        if (step < 0) step = 9;
        return createNote({
          staff: 'treble',
          voice: 0,
          start: Math.round(n.beat) * 4,
          duration: 4,
          step
        });
      });
  }
  return score;
}

function sanitizeNote(n) {
  if (!n || typeof n !== 'object') return null;
  const staff = n.staff === 'bass' ? 'bass' : 'treble';
  const maxStep = naturalsForStaff(staff).length - 1;
  return createNote({
    id: typeof n.id === 'string' ? n.id : nextId(),
    staff,
    voice: n.voice === 1 ? 1 : 0,
    start: clamp(Math.round(Number(n.start) || 0), 0, 16 * 16 * 16),
    duration: clamp(Math.round(Number(n.duration) || 4), 1, 24),
    step: clamp(Math.round(Number(n.step) || 0), 0, maxStep),
    accidental: ['sharp', 'flat', 'natural'].includes(n.accidental) ? n.accidental : null,
    tieTo: typeof n.tieTo === 'string' ? n.tieTo : null,
    dynamic: ['p', 'mp', 'mf', 'f'].includes(n.dynamic) ? n.dynamic : null,
    rest: !!n.rest
  });
}

export function loadScore(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyScore();
  if (
    Array.isArray(raw.notes) &&
    raw.notes[0] &&
    'beat' in raw.notes[0] &&
    !('start' in raw.notes[0])
  ) {
    return migrateV1(raw);
  }
  if (raw.version !== 2 && !Array.isArray(raw.notes)) return createEmptyScore();

  const score = createEmptyScore();
  if (typeof raw.bpm === 'number') score.bpm = clamp(raw.bpm, 40, 280);
  if (typeof raw.volume === 'number') score.volume = clamp(raw.volume, 0, 100);
  if (typeof raw.measures === 'number') score.measures = clamp(raw.measures, 1, 16);
  if (typeof raw.keySig === 'number') score.keySig = clamp(Math.round(raw.keySig), -7, 7);
  if (raw.timeSig && typeof raw.timeSig === 'object') {
    score.timeSig = {
      beats: clamp(Math.round(raw.timeSig.beats) || 4, 1, 16),
      unit: [2, 4, 8, 16].includes(raw.timeSig.unit) ? raw.timeSig.unit : 4
    };
  } else if (typeof raw.timeSig === 'string') {
    score.timeSig = parseTimeSig(raw.timeSig);
  }
  if (Array.isArray(raw.notes)) {
    score.notes = raw.notes.map(sanitizeNote).filter(Boolean);
    for (const n of score.notes) {
      const m = /^n(\d+)$/.exec(n.id);
      if (m) _idSeq = Math.max(_idSeq, Number(m[1]) + 1);
    }
  }
  trimNotes(score);
  return score;
}

export function serializeScore(score) {
  return {
    version: 2,
    bpm: score.bpm,
    volume: score.volume,
    measures: score.measures,
    timeSig: { ...score.timeSig },
    keySig: score.keySig,
    notes: score.notes.map((n) => ({ ...n }))
  };
}

export function cloneScore(score) {
  return loadScore(serializeScore(score));
}

export function snapshot(score) {
  return serializeScore(score);
}

export function trimNotes(score) {
  const max = totalSixteenths(score.measures, score.timeSig);
  const kept = score.notes.filter((n) => n.start < max);
  const keptIds = new Set(kept.map((n) => n.id));
  for (const n of kept) {
    if (n.tieTo && !keptIds.has(n.tieTo)) n.tieTo = null;
  }
  score.notes = kept;
}

export function findNote(score, id) {
  return score.notes.find((n) => n.id === id) || null;
}

export function findNoteIndex(score, id) {
  return score.notes.findIndex((n) => n.id === id);
}

export function noteAt(score, { staff, start, step, voice, rest }) {
  return (
    score.notes.find(
      (n) =>
        n.staff === staff &&
        n.start === start &&
        n.step === step &&
        n.voice === (voice || 0) &&
        !!n.rest === !!rest
    ) || null
  );
}

/** True when two half-open [start, start+dur) spans overlap. */
export function spansOverlap(aStart, aDur, bStart, bDur) {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

/**
 * Same-voice rhythmic clash: overlapping time with a different onset
 * (same-onset chord tones are allowed).
 * @returns {object|null} conflicting note
 */
export function voiceSpanClash(score, { staff, voice, start, duration, ignoreIds }) {
  const ignore = ignoreIds || new Set();
  for (const n of score.notes) {
    if (n.rest) continue;
    if (n.staff !== staff || n.voice !== (voice || 0)) continue;
    if (ignore.has(n.id)) continue;
    if (n.start === start) continue;
    if (spansOverlap(start, duration, n.start, n.duration)) return n;
  }
  return null;
}

/**
 * Would placing a note of `duration` at {staff, start, voice} be rejected by a
 * same-voice clash? Returns the conflicting note (overlapping time, different
 * onset) or null. Mirrors the placement check in materializeTiedChain — same-onset
 * chord tones are allowed, so an occupied exact slot returns null there but a
 * true rhythmic clash returns the blocker.
 */
export function slotBlocked(score, { staff, start, voice, duration }) {
  const st = staff === 'bass' ? 'bass' : 'treble';
  const v = voice === 1 ? 1 : 0;
  const at = Math.round(Number.isFinite(start) ? start : 0);
  const intended = Math.max(1, Math.round(duration || DUR.quarter));
  const segments = segmentDurationAcrossMeasures(at, intended, score.timeSig, score.measures);
  const end = segments.reduce((sum, seg) => sum + seg.duration, 0) || intended;
  return voiceSpanClash(score, { staff: st, voice: v, start: at, duration: end });
}

export function sortedNotes(score) {
  return [...score.notes].sort(
    (a, b) => a.start - b.start || a.staff.localeCompare(b.staff) || a.step - b.step
  );
}

export function soundingDuration(score, note) {
  if (!note) return 0;
  if (note.rest) return note.duration;
  let dur = note.duration;
  let cur = note;
  const seen = new Set([cur.id]);
  while (cur.tieTo) {
    const next = findNote(score, cur.tieTo);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    dur += next.duration;
    cur = next;
  }
  return dur;
}

export function isTieContinue(score, note) {
  return score.notes.some((n) => n.tieTo === note.id);
}

/**
 * Ids of non-rest notes sounding at grid position `pos`.
 * A note sounds while `pos` is in its half-open window [start, start+soundingDuration).
 */
export function notesSoundingAt(score, pos) {
  if (!score || !Array.isArray(score.notes)) return [];
  const ids = [];
  for (const n of score.notes) {
    if (n.rest) continue;
    const end = n.start + soundingDuration(score, n);
    if (pos >= n.start && pos < end) ids.push(n.id);
  }
  return ids;
}

/** Walk backward to the head of a tie chain. */
export function chainHead(score, note) {
  if (!note) return null;
  let head = note;
  const seen = new Set([head.id]);
  let guard = 0;
  while (guard++ < 64) {
    const prev = score.notes.find((n) => n.tieTo === head.id);
    if (!prev || seen.has(prev.id)) break;
    seen.add(prev.id);
    head = prev;
  }
  return head;
}

/** Ordered list of notes in the tie chain containing `note`. */
export function chainNotes(score, note) {
  const head = chainHead(score, note);
  if (!head) return [];
  const out = [head];
  const seen = new Set([head.id]);
  let cur = head;
  while (cur.tieTo) {
    const next = findNote(score, cur.tieTo);
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    out.push(next);
    cur = next;
  }
  return out;
}

/** Remove every note in the chain containing `noteId`. */
export function removeChain(score, noteId) {
  const note = findNote(score, noteId);
  if (!note) return false;
  const chain = chainNotes(score, note);
  const ids = new Set(chain.map((n) => n.id));
  score.notes = score.notes.filter((n) => !ids.has(n.id));
  for (const n of score.notes) {
    if (n.tieTo && ids.has(n.tieTo)) n.tieTo = null;
  }
  return true;
}

/**
 * Delete: pitched note → rest of same sounding length.
 * Returns the new rest, or null if the selection was already a rest / missing.
 */
export function replaceChainWithRest(score, noteId) {
  const note = findNote(score, noteId);
  if (!note || note.rest) return null;
  const head = chainHead(score, note);
  const staff = head.staff;
  const voice = head.voice;
  const start = head.start;
  const intended = soundingDuration(score, head);
  const chain = chainNotes(score, head);
  const ids = new Set(chain.map((n) => n.id));
  score.notes = score.notes.filter((n) => !ids.has(n.id));
  for (const n of score.notes) {
    if (n.tieTo && ids.has(n.tieTo)) n.tieTo = null;
  }
  const placed = addNote(score, {
    staff,
    voice,
    start,
    duration: intended,
    rest: true
  });
  return placed;
}

/**
 * Create or rewrite a tied chain for a non-rest note.
 * Applies changes atomically: if any continuation slot clashes, the score is left unchanged.
 * @returns {{ head: object, notes: object[] }|null}
 */
export function materializeTiedChain(score, partial) {
  const intended = Math.max(
    1,
    Math.round(partial.intendedDuration || partial.duration || DUR.quarter)
  );
  const start = Math.round(Number.isFinite(partial.start) ? partial.start : 0);
  const segments = segmentDurationAcrossMeasures(start, intended, score.timeSig, score.measures);
  if (!segments.length) return null;

  const staff = partial.staff === 'bass' ? 'bass' : 'treble';
  const voice = partial.voice === 1 ? 1 : 0;
  const step = clamp(Math.round(partial.step || 0), 0, naturalsForStaff(staff).length - 1);

  let headId = partial.id || null;
  let oldChainIds = new Set();
  if (headId) {
    const existing = findNote(score, headId);
    if (existing) {
      const head = chainHead(score, existing);
      headId = head.id;
      oldChainIds = new Set(chainNotes(score, head).map((n) => n.id));
    }
  }

  // Clash check before mutating — ignore slots owned by the chain being rewritten
  const intendedEnd = segments.reduce((sum, seg) => sum + seg.duration, 0);
  if (
    voiceSpanClash(score, {
      staff,
      voice,
      start,
      duration: intendedEnd,
      ignoreIds: oldChainIds
    })
  ) {
    return null;
  }
  for (const seg of segments) {
    const clash = noteAt(score, {
      staff,
      start: seg.start,
      step,
      voice,
      rest: false
    });
    if (clash && !oldChainIds.has(clash.id) && clash.id !== headId) {
      return null;
    }
  }

  // Notes displace overlapping rests in this voice
  score.notes = score.notes.filter((n) => {
    if (!n.rest || n.staff !== staff || n.voice !== voice) return true;
    if (oldChainIds.has(n.id)) return true;
    return !spansOverlap(start, intendedEnd, n.start, n.duration);
  });

  if (headId && oldChainIds.size) {
    for (const id of oldChainIds) {
      if (id === headId) continue;
      const idx = findNoteIndex(score, id);
      if (idx >= 0) score.notes.splice(idx, 1);
    }
  }

  const created = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isHead = i === 0;

    let note;
    if (isHead && headId) {
      note = findNote(score, headId);
      if (note) {
        Object.assign(note, {
          staff,
          voice,
          start: seg.start,
          duration: seg.duration,
          step,
          accidental: partial.accidental || null,
          dynamic: partial.dynamic || null,
          rest: false,
          tieTo: null
        });
      } else {
        note = createNote({
          id: headId,
          staff,
          voice,
          start: seg.start,
          duration: seg.duration,
          step,
          accidental: partial.accidental || null,
          dynamic: partial.dynamic || null,
          rest: false
        });
        score.notes.push(note);
      }
    } else {
      note = createNote({
        staff,
        voice,
        start: seg.start,
        duration: seg.duration,
        step,
        accidental: isHead ? partial.accidental || null : null,
        dynamic: isHead ? partial.dynamic || null : null,
        rest: false
      });
      score.notes.push(note);
      if (isHead) headId = note.id;
    }
    created.push(note);
  }

  for (let i = 0; i < created.length; i++) {
    created[i].tieTo = i < created.length - 1 ? created[i + 1].id : null;
    if (i > 0) {
      created[i].accidental = null;
      created[i].dynamic = null;
    }
  }

  return { head: created[0], notes: created };
}

/** Move a tie chain to a new start (and optional step), preserving sounding length. */
export function moveChain(score, noteId, { start, step, intendedDuration } = {}) {
  const note = findNote(score, noteId);
  if (!note || note.rest) return null;
  const head = chainHead(score, note);
  const intended = Number.isFinite(intendedDuration)
    ? intendedDuration
    : soundingDuration(score, head);
  const nextStart = Number.isFinite(start) ? start : head.start;
  const nextStep = Number.isFinite(step) ? step : head.step;
  return materializeTiedChain(score, {
    id: head.id,
    staff: head.staff,
    voice: head.voice,
    step: nextStep,
    start: nextStart,
    intendedDuration: intended,
    accidental: head.accidental,
    dynamic: head.dynamic
  });
}

/** Rewrite the chain containing `noteId` to a new intended duration. */
export function rewriteChainDuration(score, noteId, intendedDuration) {
  const note = findNote(score, noteId);
  if (!note || note.rest) return null;
  const head = chainHead(score, note);
  return materializeTiedChain(score, {
    id: head.id,
    staff: head.staff,
    voice: head.voice,
    step: head.step,
    start: head.start,
    intendedDuration,
    accidental: head.accidental,
    dynamic: head.dynamic
  });
}

/**
 * Set duration of a selected note or rest (one policy for palette + keyboard).
 * Notes rewrite the tied chain; rests clip to the measure and displace overlaps.
 * @returns {object|null} head note or rest after the change
 */
export function setSelectionDuration(score, noteId, intendedDuration) {
  const note = findNote(score, noteId);
  if (!note) return null;
  const dur = Math.max(1, Math.round(intendedDuration));
  if (note.rest) {
    const clipped = fitDurationToMeasure(note.start, dur, score.timeSig, score.measures);
    score.notes = score.notes.filter(
      (o) =>
        o.id === note.id ||
        !(
          o.rest &&
          o.staff === note.staff &&
          o.voice === note.voice &&
          spansOverlap(note.start, clipped, o.start, o.duration)
        )
    );
    updateNote(score, note.id, { duration: clipped });
    return findNote(score, note.id);
  }
  const result = rewriteChainDuration(score, noteId, dur);
  return result ? result.head : null;
}

export function addNote(score, partial) {
  if (partial.rest) {
    const start = Math.round(partial.start || 0);
    const preferred = Math.round(partial.duration || DUR.quarter);
    const duration = fitDurationToMeasure(start, preferred, score.timeSig, score.measures);
    const staff = partial.staff === 'bass' ? 'bass' : 'treble';
    const voice = partial.voice === 1 ? 1 : 0;
    const max = totalSixteenths(score.measures, score.timeSig);
    if (start >= max) return null;

    // Replace any overlapping rests in this voice (avoid stacked glyphs)
    score.notes = score.notes.filter(
      (n) =>
        !(
          n.rest &&
          n.staff === staff &&
          n.voice === voice &&
          spansOverlap(start, duration, n.start, n.duration)
        )
    );

    const n = createNote({
      ...partial,
      staff,
      voice,
      duration,
      start,
      rest: true,
      tieTo: null,
      step: Math.floor(naturalsForStaff(staff).length / 2)
    });
    score.notes.push(n);
    return findNote(score, n.id) || n;
  }

  const intended = Math.round(partial.intendedDuration || partial.duration || DUR.quarter);
  const result = materializeTiedChain(score, {
    ...partial,
    intendedDuration: intended,
    rest: false
  });
  return result ? result.head : null;
}

export function removeNote(score, id) {
  return removeChain(score, id);
}

export function updateNote(score, id, patch) {
  const n = findNote(score, id);
  if (!n) return null;
  Object.assign(n, patch);
  const maxStep = naturalsForStaff(n.staff).length - 1;
  n.step = clamp(n.step, 0, maxStep);
  return n;
}

/** Move a rest horizontally; displaces overlapping rests at the destination. */
export function moveRest(score, id, nextStart) {
  const n = findNote(score, id);
  if (!n || !n.rest) return null;
  const start = Math.round(nextStart);
  const duration = fitDurationToMeasure(start, n.duration, score.timeSig, score.measures);
  const max = totalSixteenths(score.measures, score.timeSig);
  if (start < 0 || start >= max) return null;

  score.notes = score.notes.filter(
    (o) =>
      o.id === n.id ||
      !(
        o.rest &&
        o.staff === n.staff &&
        o.voice === n.voice &&
        spansOverlap(start, duration, o.start, o.duration)
      )
  );
  n.start = start;
  n.duration = duration;
  return findNote(score, n.id) || n;
}

export function clearNotes(score) {
  score.notes = [];
}

export function setMeasures(score, measures) {
  score.measures = clamp(measures, 1, 16);
  trimNotes(score);
}

const MAX_MEASURES = 16;

/** Insert an empty measure at `index` (0…measures), shifting later notes. */
export function insertMeasure(score, index) {
  if (score.measures >= MAX_MEASURES) return false;
  const mLen = measureSixteenths(score.timeSig);
  const at = clamp(Math.round(index), 0, score.measures);
  const cut = at * mLen;
  for (const n of score.notes) {
    if (n.start >= cut) n.start += mLen;
  }
  score.measures += 1;
  return true;
}

/** Remove measure at `index` (0…measures-1); notes in that bar are deleted. */
export function removeMeasure(score, index) {
  if (score.measures <= 1) return false;
  const mLen = measureSixteenths(score.timeSig);
  const at = clamp(Math.round(index), 0, score.measures - 1);
  const lo = at * mLen;
  const hi = lo + mLen;
  score.notes = score.notes.filter((n) => n.start < lo || n.start >= hi);
  for (const n of score.notes) {
    if (n.start >= hi) n.start -= mLen;
  }
  const ids = new Set(score.notes.map((n) => n.id));
  for (const n of score.notes) {
    if (n.tieTo && !ids.has(n.tieTo)) n.tieTo = null;
  }
  score.measures -= 1;
  return true;
}

/**
 * Fill empty spans in each staff/voice with rests (notes win over rests).
 * Optional helper — not called on normal edits (rests are explicit).
 * Voice 1 is only auto-filled when it already has pitched notes (no orphan voice).
 * User-placed voice-1 rests are kept even before the first pitched note.
 */
export function autoFillRests(score) {
  for (const staff of ['treble', 'bass']) {
    for (const voice of [0, 1]) {
      const hasNotes = score.notes.some((n) => !n.rest && n.staff === staff && n.voice === voice);
      if (voice === 1 && !hasNotes) {
        // Keep any user rests; do not invent a full empty voice-1 timeline
        continue;
      }
      fillVoiceGaps(score, staff, voice);
    }
  }
}

function fillVoiceGaps(score, staff, voice) {
  const total = totalSixteenths(score.measures, score.timeSig);
  if (total <= 0) return;

  const occupied = score.notes
    .filter((n) => !n.rest && n.staff === staff && n.voice === voice)
    .map((n) => ({ start: n.start, end: n.start + n.duration }))
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const iv of occupied) {
    if (!merged.length || iv.start > merged[merged.length - 1].end) {
      merged.push({ start: iv.start, end: iv.end });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end);
    }
  }

  // Drop rests that overlap sounding notes
  score.notes = score.notes.filter((n) => {
    if (!(n.rest && n.staff === staff && n.voice === voice)) return true;
    return !merged.some((m) => spansOverlap(n.start, n.duration, m.start, m.end - m.start));
  });

  // Collapse rest–rest overlaps (keep earliest, longest)
  const rests = score.notes
    .filter((n) => n.rest && n.staff === staff && n.voice === voice)
    .sort((a, b) => a.start - b.start || b.duration - a.duration || a.id.localeCompare(b.id));
  const keepRest = new Set();
  for (const r of rests) {
    const clash = rests.some(
      (o) => keepRest.has(o.id) && spansOverlap(r.start, r.duration, o.start, o.duration)
    );
    if (!clash) keepRest.add(r.id);
  }
  score.notes = score.notes.filter(
    (n) => !(n.rest && n.staff === staff && n.voice === voice) || keepRest.has(n.id)
  );

  const restCover = score.notes
    .filter((n) => n.rest && n.staff === staff && n.voice === voice)
    .map((n) => ({ start: n.start, end: n.start + n.duration }));

  const covered = (t) =>
    merged.some((m) => t >= m.start && t < m.end) ||
    restCover.some((m) => t >= m.start && t < m.end);

  const midStep = Math.floor(naturalsForStaff(staff).length / 2);
  let t = 0;
  while (t < total) {
    if (covered(t)) {
      t += 1;
      continue;
    }
    let end = t + 1;
    while (end < total && !covered(end)) end += 1;
    let pos = t;
    let left = end - t;
    while (left > 0 && pos < total) {
      const room = Math.min(roomInMeasure(pos, score.timeSig), left, total - pos);
      if (room <= 0) break;
      const chunks = spellDurationChunk(room);
      for (const dur of chunks) {
        if (dur <= 0) continue;
        score.notes.push(
          createNote({
            staff,
            voice,
            start: pos,
            duration: dur,
            step: midStep,
            rest: true,
            tieTo: null
          })
        );
        restCover.push({ start: pos, end: pos + dur });
        pos += dur;
        left -= dur;
        if (left <= 0 || pos >= total) break;
      }
    }
    t = end;
  }
}

export function setTimeSig(score, timeSig) {
  score.timeSig = { beats: timeSig.beats, unit: timeSig.unit };
  trimNotes(score);
}

export function paletteDuration(tool) {
  return applyDot(tool.baseDur, tool.dotted);
}

/** Snapshot selected note/chain for clipboard paste. */
export function copySelectionPayload(score, selectedId) {
  const n = findNote(score, selectedId);
  if (!n) return null;
  if (n.rest) {
    return {
      rest: true,
      staff: n.staff,
      voice: n.voice,
      duration: n.duration,
      step: n.step
    };
  }
  const head = chainHead(score, n);
  return {
    rest: false,
    staff: head.staff,
    voice: head.voice,
    step: head.step,
    accidental: head.accidental,
    dynamic: head.dynamic,
    intendedDuration: soundingDuration(score, head)
  };
}

/** Paste clipboard payload at `start`; returns placed head note or null. */
export function pasteSelectionPayload(score, payload, start) {
  if (!payload) return null;
  const at = Math.round(start);
  if (payload.rest) {
    return addNote(score, {
      staff: payload.staff,
      voice: payload.voice,
      start: at,
      duration: payload.duration,
      step: payload.step,
      rest: true
    });
  }
  return addNote(score, {
    staff: payload.staff,
    voice: payload.voice,
    start: at,
    step: payload.step,
    accidental: payload.accidental,
    dynamic: payload.dynamic,
    intendedDuration: payload.intendedDuration,
    duration: payload.intendedDuration
  });
}

export { measureSixteenths, totalSixteenths, DUR, applyDot, fitDurationToMeasure };
