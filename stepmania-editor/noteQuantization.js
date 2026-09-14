/**
 * Quantization ("rhythm") colouring, the way StepMania's editor draws notes.
 *
 * The classification mirrors GetNoteType() in StepMania's src/NoteTypes.cpp,
 * which buckets a row by the finest measure subdivision it lands on. The
 * editor renders through NoteSkins/common/_Editor, a rhythm-coloured skin, so
 * a note's colour reports its subdivision rather than its column.
 */

export const ROWS_PER_BEAT = 48;
const BEATS_PER_MEASURE = 4;
const ROWS_PER_MEASURE = ROWS_PER_BEAT * BEATS_PER_MEASURE;

/** Note types in StepMania's enum order, coarsest first. */
export const NOTE_TYPES = ['4th', '8th', '12th', '16th', '24th', '32nd', '48th', '64th', '192nd'];

/** Conventional StepMania rhythm palette, coarsest subdivision first. */
export const QUANT_COLORS = {
  '4th': '#ff3b3b',
  '8th': '#3b6bff',
  '12th': '#a855f7',
  '16th': '#ffd93b',
  '24th': '#ff6bd6',
  '32nd': '#ff9c3b',
  '48th': '#3be3ff',
  '64th': '#3bff7a',
  '192nd': '#aab4c8'
};

/**
 * Bucket a row into its note type.
 * @param {number} row - Row index at 48 rows per beat.
 * @returns {string} One of NOTE_TYPES.
 */
export function getNoteType(row) {
  const r = Math.round(row);
  if (r % (ROWS_PER_MEASURE / 4) === 0) return '4th';
  if (r % (ROWS_PER_MEASURE / 8) === 0) return '8th';
  if (r % (ROWS_PER_MEASURE / 12) === 0) return '12th';
  if (r % (ROWS_PER_MEASURE / 16) === 0) return '16th';
  if (r % (ROWS_PER_MEASURE / 24) === 0) return '24th';
  if (r % (ROWS_PER_MEASURE / 32) === 0) return '32nd';
  if (r % (ROWS_PER_MEASURE / 48) === 0) return '48th';
  if (r % (ROWS_PER_MEASURE / 64) === 0) return '64th';
  return '192nd';
}

/**
 * Colour a note by the subdivision its beat falls on.
 * @param {number} beat
 * @returns {string} CSS colour.
 */
export function quantColorForBeat(beat) {
  return QUANT_COLORS[getNoteType(beat * ROWS_PER_BEAT)];
}
