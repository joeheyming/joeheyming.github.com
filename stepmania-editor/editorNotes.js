import { ROWS_PER_BEAT, beatToNoteRow } from '../stepmania/js/timingData.js';
import { quantizeBeat, noteCharFromProps } from '../stepmania/js/noteGrid.js';

const EPS_ROW = 0;

/**
 * @param {Array} noteData
 * @param {number} beat
 * @param {number} col
 */
export function findNoteIndex(noteData, beat, col) {
  const row = beatToNoteRow(beat);
  return (noteData || []).findIndex(
    (n) => n[1] === col && Math.abs(beatToNoteRow(n[0]) - row) <= EPS_ROW
  );
}

/**
 * @param {Array} noteData
 * @param {number} beat
 * @param {number} col
 * @param {Record<string, unknown>} props
 */
export function upsertNote(noteData, beat, col, props) {
  const next = (noteData || []).map((n) => n.slice());
  const i = findNoteIndex(next, beat, col);
  const entry = [beat, col, { ...props }];
  if (i >= 0) next[i] = entry;
  else next.push(entry);
  next.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return next;
}

/**
 * @param {Array} noteData
 * @param {number} beat
 * @param {number} col
 */
export function removeNote(noteData, beat, col) {
  const i = findNoteIndex(noteData, beat, col);
  if (i < 0) return noteData || [];
  return (noteData || []).filter((_, idx) => idx !== i);
}

/**
 * Toggle or replace a cell. Empty cell → place; same type → remove; other type → replace.
 * @param {Array} noteData
 * @param {number} beat
 * @param {number} col
 * @param {Record<string, unknown>} props
 */
export function toggleNote(noteData, beat, col, props) {
  const i = findNoteIndex(noteData, beat, col);
  if (i < 0) return upsertNote(noteData, beat, col, props);
  const existing = noteData[i][2] || {};
  if (noteCharFromProps(existing) === noteCharFromProps(props)) {
    return removeNote(noteData, beat, col);
  }
  return upsertNote(noteData, beat, col, props);
}

/**
 * Place a hold/roll from startBeat to endBeat in one column.
 * @param {Array} noteData
 * @param {number} startBeat
 * @param {number} endBeat
 * @param {number} col
 * @param {2|4} type
 */
export function placeHold(noteData, startBeat, endBeat, col, type) {
  const a = Math.min(startBeat, endBeat);
  const b = Math.max(startBeat, endBeat);
  const duration = Math.max(ROWS_PER_BEAT, beatToNoteRow(b) - beatToNoteRow(a));
  let next = removeNote(noteData, a, col);
  return upsertNote(next, a, col, { Type: type, SubType: 0, Duration: duration });
}

export function propsForTool(tool) {
  switch (tool) {
    case 'hold':
      return { Type: 2, SubType: 0, Duration: ROWS_PER_BEAT };
    case 'roll':
      return { Type: 4, SubType: 0, Duration: ROWS_PER_BEAT };
    case 'mine':
      return { Type: 'M' };
    case 'lift':
      return { Type: 'L' };
    case 'fake':
      return { Type: 'F' };
    default:
      return {};
  }
}

export { quantizeBeat };
