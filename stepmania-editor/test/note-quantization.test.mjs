import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROWS_PER_BEAT,
  NOTE_TYPES,
  QUANT_COLORS,
  getNoteType,
  quantColorForBeat
} from '../noteQuantization.js';

describe('getNoteType', () => {
  it('buckets each subdivision the way GetNoteType() does', () => {
    // Row indices at 48 rows/beat, 192 rows/measure.
    assert.equal(getNoteType(0), '4th');
    assert.equal(getNoteType(48), '4th');
    assert.equal(getNoteType(24), '8th');
    assert.equal(getNoteType(16), '12th');
    assert.equal(getNoteType(12), '16th');
    assert.equal(getNoteType(8), '24th');
    assert.equal(getNoteType(6), '32nd');
    assert.equal(getNoteType(4), '48th');
    assert.equal(getNoteType(3), '64th');
    assert.equal(getNoteType(1), '192nd');
  });

  it('reports the coarsest subdivision a row lands on', () => {
    // Row 96 is halfway through a measure: divisible by 8th and 16th spacing,
    // but a whole beat, so it is a 4th.
    assert.equal(getNoteType(96), '4th');
    // Row 72 is beat 1.5 — an 8th, not a 16th.
    assert.equal(getNoteType(72), '8th');
  });

  it('covers every row in a measure with a known type', () => {
    for (let row = 0; row < 192; row += 1) {
      assert.ok(NOTE_TYPES.includes(getNoteType(row)), `row ${row}`);
    }
  });
});

describe('quantColorForBeat', () => {
  it('colours by subdivision rather than column', () => {
    assert.equal(quantColorForBeat(0), QUANT_COLORS['4th']);
    assert.equal(quantColorForBeat(1), QUANT_COLORS['4th']);
    assert.equal(quantColorForBeat(0.5), QUANT_COLORS['8th']);
    assert.equal(quantColorForBeat(0.25), QUANT_COLORS['16th']);
    assert.equal(quantColorForBeat(1 / 3), QUANT_COLORS['12th']);
  });

  it('tolerates float drift in beat positions', () => {
    // 0.1 + 0.2 style accumulation must still land on a real colour.
    let beat = 0;
    for (let i = 0; i < 8; i += 1) beat += 0.25;
    assert.equal(quantColorForBeat(beat), QUANT_COLORS['4th']);
  });

  it('exposes a colour for every note type', () => {
    for (const type of NOTE_TYPES) assert.match(QUANT_COLORS[type], /^#[0-9a-f]{6}$/i);
  });

  it('uses StepMania row resolution', () => {
    assert.equal(ROWS_PER_BEAT, 48);
  });
});
