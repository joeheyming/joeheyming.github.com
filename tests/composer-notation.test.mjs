/**
 * Unit tests for composer notation segmenter, tie chains, and encode.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  flagCount,
  isBeamableDuration,
  segmentDurationAcrossMeasures,
  fitDurationToMeasure,
  beatPositions,
  DUR
} from '../play/composer/notation.js';
import {
  createEmptyScore,
  createDefaultNotes,
  clearNotes,
  addNote,
  moveChain,
  chainNotes,
  soundingDuration,
  voiceSpanClash,
  autoFillRests,
  spansOverlap,
  loadScore,
  letterIndexFromKey,
  stepNearestLetter,
  copySelectionPayload,
  pasteSelectionPayload,
  notesSoundingAt,
  replaceChainWithRest,
  removeChain,
  setSelectionDuration,
  slotBlocked
} from '../play/composer/model.js';
import {
  encodeScore,
  decodeScore,
  scoreToPayload,
  payloadToScore
} from '../play/composer/encode.js';

describe('blank default score', () => {
  it('createEmptyScore has no notes or rests', () => {
    const score = createEmptyScore();
    assert.equal(score.notes.length, 0);
  });

  it('loadScore empty notes does not reseed Twinkle or invent rests', () => {
    const score = loadScore({
      version: 2,
      bpm: 100,
      volume: 70,
      measures: 4,
      timeSig: { beats: 4, unit: 4 },
      keySig: 0,
      notes: []
    });
    assert.equal(score.notes.length, 0);
  });

  it('createDefaultNotes still builds Twinkle for examples', () => {
    assert.ok(createDefaultNotes().length > 0);
  });
});

describe('letter step-time helpers', () => {
  it('maps a-g keys to letter indices', () => {
    assert.equal(letterIndexFromKey('c'), 0);
    assert.equal(letterIndexFromKey('A'), 5);
    assert.equal(letterIndexFromKey('b'), 6);
    assert.equal(letterIndexFromKey('x'), null);
  });

  it('finds nearest step for a letter near preferStep', () => {
    assert.equal(stepNearestLetter('treble', 0, 2), 2); // C4
    assert.equal(stepNearestLetter('treble', 4, 2), 6); // G4 nearest to C4
  });
});

describe('copy/paste selection', () => {
  it('copies and pastes a note at a new start', () => {
    const score = createEmptyScore();
    clearNotes(score);
    const head = addNote(score, {
      staff: 'treble',
      start: 0,
      step: 8,
      intendedDuration: DUR.quarter
    });
    const payload = copySelectionPayload(score, head.id);
    assert.ok(payload);
    assert.equal(payload.intendedDuration, DUR.quarter);
    const pasted = pasteSelectionPayload(score, payload, 4);
    assert.ok(pasted);
    assert.equal(pasted.start, 4);
    assert.equal(soundingDuration(score, pasted), DUR.quarter);
  });
});

describe('notesSoundingAt', () => {
  it('reports a note inside its window and clears just past its end', () => {
    const score = createEmptyScore();
    clearNotes(score);
    const head = addNote(score, {
      staff: 'treble',
      start: 4,
      step: 8,
      intendedDuration: DUR.quarter
    });
    assert.deepEqual(notesSoundingAt(score, 4), [head.id]); // at onset
    assert.deepEqual(notesSoundingAt(score, 7.9), [head.id]); // inside window
    assert.deepEqual(notesSoundingAt(score, 8), []); // just past end (half-open)
    assert.deepEqual(notesSoundingAt(score, 3.9), []); // before onset
  });

  it('spans the full sounding length across a tie chain', () => {
    const score = createEmptyScore();
    clearNotes(score);
    const head = addNote(score, {
      staff: 'treble',
      start: 14,
      step: 8,
      intendedDuration: 4
    });
    // 14→18 crosses the barline, so it materializes as a tie chain of length 4
    assert.ok(chainNotes(score, head).length >= 2);
    assert.ok(notesSoundingAt(score, 17).includes(head.id));
    assert.equal(notesSoundingAt(score, 18).length, 0);
  });
});

describe('beatPositions', () => {
  it('lists every beat in a 4/4 x2 score with downbeat flags', () => {
    const beats = beatPositions({ beats: 4, unit: 4 }, 2);
    assert.equal(beats.length, 8);
    assert.deepEqual(
      beats.map((b) => b.start),
      [0, 4, 8, 12, 16, 20, 24, 28]
    );
    assert.deepEqual(
      beats.filter((b) => b.downbeat).map((b) => b.start),
      [0, 16]
    );
  });
});

describe('flagCount / beamable', () => {
  it('gives dotted eighth one flag', () => {
    assert.equal(flagCount(3), 1);
    assert.equal(flagCount(2), 1);
    assert.equal(flagCount(1), 2);
    assert.equal(flagCount(4), 0);
  });

  it('marks dotted eighth as beamable', () => {
    assert.equal(isBeamableDuration(3), true);
    assert.equal(isBeamableDuration(4), false);
  });
});

describe('segmentDurationAcrossMeasures', () => {
  const ts = { beats: 4, unit: 4 };

  it('keeps on-beat quarter intact', () => {
    const segs = segmentDurationAcrossMeasures(0, 4, ts, 4);
    assert.deepEqual(segs, [{ start: 0, duration: 4 }]);
  });

  it('splits off-beat quarter into tied eighths', () => {
    const segs = segmentDurationAcrossMeasures(2, 4, ts, 4);
    assert.deepEqual(segs, [
      { start: 2, duration: 2 },
      { start: 4, duration: 2 }
    ]);
  });

  it('splits across barline', () => {
    const segs = segmentDurationAcrossMeasures(14, 4, ts, 4);
    assert.equal(
      segs.reduce((a, s) => a + s.duration, 0),
      4
    );
    assert.ok(segs.every((s) => s.start < 16 || s.start >= 16));
    assert.ok(segs[0].start === 14);
  });
});

describe('tie chains', () => {
  it('preserves sounding length when moving near a barline', () => {
    const score = createEmptyScore();
    clearNotes(score);
    const head = addNote(score, {
      staff: 'treble',
      start: 0,
      step: 8,
      intendedDuration: DUR.quarter
    });
    const moved = moveChain(score, head.id, { start: 14, intendedDuration: 4 });
    assert.ok(moved);
    assert.equal(soundingDuration(score, moved.head), 4);
    assert.ok(chainNotes(score, moved.head).length >= 2);
  });

  it('detects same-voice span overlap', () => {
    const score = createEmptyScore();
    clearNotes(score);
    addNote(score, { staff: 'treble', start: 0, step: 8, intendedDuration: 4 });
    assert.ok(
      voiceSpanClash(score, {
        staff: 'treble',
        voice: 0,
        start: 2,
        duration: 4,
        ignoreIds: new Set()
      })
    );
    assert.equal(
      voiceSpanClash(score, {
        staff: 'treble',
        voice: 0,
        start: 0,
        duration: 4,
        ignoreIds: new Set()
      }),
      null
    );
  });

  it('spansOverlap works', () => {
    assert.equal(spansOverlap(0, 4, 2, 4), true);
    assert.equal(spansOverlap(0, 4, 4, 4), false);
  });

  it('slotBlocked flags an occupied slot and clears a free one', () => {
    const score = createEmptyScore();
    clearNotes(score);
    addNote(score, { staff: 'treble', start: 0, step: 8, intendedDuration: 4 });
    // A quarter starting at 2 overlaps the existing note with a different onset.
    const blocker = slotBlocked(score, { staff: 'treble', start: 2, voice: 0, duration: 4 });
    assert.ok(blocker);
    assert.equal(blocker.start, 0);
    // A slot right after the note is free.
    assert.equal(slotBlocked(score, { staff: 'treble', start: 4, voice: 0, duration: 4 }), null);
  });
});

describe('rest auto-fill', () => {
  it('fills gaps around a note', () => {
    const score = createEmptyScore();
    clearNotes(score);
    addNote(score, { staff: 'treble', start: 4, step: 8, intendedDuration: 4 });
    autoFillRests(score);
    const rests = score.notes.filter((n) => n.rest && n.staff === 'treble');
    assert.ok(rests.length > 0);
    assert.ok(rests.every((r) => r.start + r.duration <= 4 || r.start >= 8));
  });

  it('clips rest duration to measure', () => {
    assert.equal(fitDurationToMeasure(14, 16, { beats: 4, unit: 4 }, 4), 2);
  });

  it('placing a rest replaces overlapping rests instead of stacking', () => {
    const score = createEmptyScore();
    clearNotes(score);
    score.measures = 1;
    autoFillRests(score);
    assert.ok(score.notes.some((r) => r.rest && r.start === 0 && r.duration === 16));

    addNote(score, {
      staff: 'treble',
      start: 0,
      duration: DUR.quarter,
      rest: true
    });

    const rests = score.notes.filter((n) => n.rest && n.staff === 'treble');
    const atZero = rests.filter((r) => r.start === 0);
    assert.equal(atZero.length, 1);
    assert.equal(atZero[0].duration, DUR.quarter);
    // Explicit rest only — no auto-fill of the remaining beats
    assert.equal(rests.length, 1);
  });

  it('does not invent rests after placing a note', () => {
    const score = createEmptyScore();
    addNote(score, { staff: 'treble', start: 0, step: 8, intendedDuration: 4 });
    assert.equal(score.notes.filter((n) => n.rest).length, 0);
  });
});

describe('setSelectionDuration', () => {
  it('resizes a rest without inventing filler rests', () => {
    const score = createEmptyScore();
    const rest = addNote(score, {
      staff: 'treble',
      start: 0,
      duration: DUR.quarter,
      rest: true
    });
    const updated = setSelectionDuration(score, rest.id, DUR.half);
    assert.ok(updated);
    assert.equal(updated.duration, DUR.half);
    assert.equal(score.notes.filter((n) => n.rest).length, 1);
  });

  it('rewrites a pitched note chain duration', () => {
    const score = createEmptyScore();
    const head = addNote(score, {
      staff: 'treble',
      start: 0,
      step: 8,
      intendedDuration: DUR.quarter
    });
    const next = setSelectionDuration(score, head.id, DUR.half);
    assert.ok(next);
    assert.equal(soundingDuration(score, next), DUR.half);
  });
});

describe('rest delete and voice-1', () => {
  it('replaceChainWithRest turns a note into a same-length rest', () => {
    const score = createEmptyScore();
    clearNotes(score);
    const head = addNote(score, {
      staff: 'treble',
      start: 0,
      step: 8,
      intendedDuration: DUR.quarter
    });
    const rest = replaceChainWithRest(score, head.id);
    assert.ok(rest);
    assert.equal(rest.rest, true);
    assert.equal(rest.start, 0);
    assert.equal(rest.duration, DUR.quarter);
    assert.equal(score.notes.filter((n) => !n.rest && n.id === head.id).length, 0);
  });

  it('removeChain deletes a rest without refilling', () => {
    const score = createEmptyScore();
    const rest = addNote(score, {
      staff: 'treble',
      start: 0,
      duration: DUR.quarter,
      rest: true
    });
    assert.ok(rest);
    removeChain(score, rest.id);
    assert.equal(score.notes.filter((n) => n.rest).length, 0);
  });

  it('keeps a user-placed voice-1 rest before any pitched notes', () => {
    const score = createEmptyScore();
    clearNotes(score);
    const rest = addNote(score, {
      staff: 'treble',
      start: 0,
      duration: DUR.quarter,
      voice: 1,
      rest: true
    });
    assert.ok(rest);
    autoFillRests(score);
    assert.ok(score.notes.some((n) => n.id === rest.id && n.rest && n.voice === 1));
  });
});

describe('encode/decode', () => {
  it('round-trips a score through the hash payload', () => {
    const score = createEmptyScore();
    clearNotes(score);
    score.bpm = 128;
    score.keySig = 2;
    addNote(score, {
      staff: 'treble',
      start: 0,
      step: 10,
      intendedDuration: DUR.half,
      accidental: 'sharp'
    });
    const hash = encodeScore(score);
    assert.ok(hash.startsWith('m1.'));
    const back = decodeScore(hash);
    assert.equal(back.bpm, 128);
    assert.equal(back.keySig, 2);
    const notes = back.notes.filter((n) => !n.rest);
    assert.ok(notes.length >= 1);
    assert.equal(notes[0].accidental, 'sharp');
  });

  it('round-trips JSON payload', () => {
    const score = createEmptyScore();
    const payload = scoreToPayload(score);
    const back = payloadToScore(payload);
    assert.equal(back.measures, score.measures);
  });
});
