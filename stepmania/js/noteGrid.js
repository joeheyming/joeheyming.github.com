import { ROWS_PER_BEAT, beatToNoteRow, noteRowToBeat } from './timingData.js';

export const DANCE_SINGLE_COLS = 4;
export const BEATS_PER_MEASURE = 4;

const LINE_COUNTS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 192];

/**
 * @param {unknown} props
 * @returns {string} MSD note character
 */
export function noteCharFromProps(props) {
  if (!props || typeof props !== 'object') return '1';
  const type = /** @type {{ Type?: unknown }} */ (props).Type;
  if (type === 2) return '2';
  if (type === 4) return '4';
  if (type === 'M' || type === 'L' || type === 'F' || type === 'K') return String(type);
  return '1';
}

/**
 * @param {string} ch
 * @returns {Record<string, unknown>}
 */
export function propsFromNoteChar(ch) {
  switch (ch) {
    case '2':
      return { Type: 2, SubType: 0 };
    case '4':
      return { Type: 4, SubType: 0 };
    case 'M':
      return { Type: 'M' };
    case 'L':
      return { Type: 'L' };
    case 'F':
      return { Type: 'F' };
    case 'K':
      return { Type: 'K' };
    default:
      return {};
  }
}

/**
 * @param {string} measure
 * @param {number} columnCount
 * @returns {string[]}
 */
export function measureLines(measure, columnCount = DANCE_SINGLE_COLS) {
  return measure.split(/\s+/).filter((line) => line.length === columnCount);
}

/**
 * Parse SM note field text into `[beat, column, props]` tuples.
 * Hold/roll heads (`2`/`4`) pair with the next `3` in the same column.
 *
 * @param {string} stepData
 * @param {number} [columnCount=4]
 * @returns {Array<[number, number, Record<string, unknown>]>}
 */
export function parseNoteField(stepData, columnCount = DANCE_SINGLE_COLS) {
  const notes = [];
  const measures = String(stepData || '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  const allLines = [];
  let beatOffset = 0;
  for (const measure of measures) {
    const lines = measureLines(measure, columnCount);
    if (lines.length === 0) {
      beatOffset += BEATS_PER_MEASURE;
      continue;
    }
    const beatsPerLine = BEATS_PER_MEASURE / lines.length;
    for (let i = 0; i < lines.length; i++) {
      allLines.push({
        line: lines[i],
        beat: beatOffset + i * beatsPerLine
      });
    }
    beatOffset += BEATS_PER_MEASURE;
  }

  for (let i = 0; i < allLines.length; i++) {
    const { line, beat } = allLines[i];
    for (let col = 0; col < columnCount; col++) {
      const ch = line[col];
      if (!ch || ch === '0' || ch === '3') continue;
      const props = propsFromNoteChar(ch);
      if (ch === '2' || ch === '4') {
        let endBeat = beat;
        for (let j = i + 1; j < allLines.length; j++) {
          if (allLines[j].line[col] === '3') {
            endBeat = allLines[j].beat;
            break;
          }
        }
        if (endBeat > beat) {
          props.Duration = Math.round((endBeat - beat) * ROWS_PER_BEAT);
        }
      }
      notes.push([beat, col, props]);
    }
  }

  return notes;
}

/**
 * @param {number} n
 * @param {number} d
 */
function gcd(n, d) {
  let a = Math.abs(n);
  let b = Math.abs(d);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1;
}

/**
 * @param {number[]} rows
 * @param {number} measureRows
 */
function linesForMeasure(rows, measureRows) {
  let g = measureRows;
  for (const row of rows) {
    g = gcd(g, row);
  }
  const lines = measureRows / g;
  for (const candidate of LINE_COUNTS) {
    if (candidate >= lines && measureRows % candidate === 0) return candidate;
  }
  return measureRows;
}

/**
 * Encode note tuples back to an SM `#NOTES` body (measures separated by commas).
 *
 * @param {Array<[number, number, Record<string, unknown>?]>} noteData
 * @param {number} [columnCount=4]
 * @returns {string}
 */
export function encodeNoteField(noteData, columnCount = DANCE_SINGLE_COLS) {
  /** @type {Map<string, string>} */
  const cells = new Map();
  let maxBeat = 0;

  for (const entry of noteData || []) {
    const beat = Number(entry[0]);
    const col = Number(entry[1]);
    const props = entry[2] || {};
    if (!Number.isFinite(beat) || col < 0 || col >= columnCount) continue;
    const row = beatToNoteRow(beat);
    const ch = noteCharFromProps(props);
    cells.set(`${row}:${col}`, ch);
    maxBeat = Math.max(maxBeat, beat);
    const duration = Number(props.Duration);
    if ((ch === '2' || ch === '4') && Number.isFinite(duration) && duration > 0) {
      const endRow = row + duration;
      cells.set(`${endRow}:${col}`, '3');
      maxBeat = Math.max(maxBeat, noteRowToBeat(endRow));
    }
  }

  const measureCount = Math.max(1, Math.ceil((maxBeat + 1e-9) / BEATS_PER_MEASURE));
  const measureRows = BEATS_PER_MEASURE * ROWS_PER_BEAT;
  const measures = [];

  for (let m = 0; m < measureCount; m++) {
    const startRow = m * measureRows;
    /** @type {number[]} */
    const occupied = [];
    for (const key of cells.keys()) {
      const row = Number(key.split(':')[0]);
      if (row >= startRow && row < startRow + measureRows) {
        occupied.push(row - startRow);
      }
    }
    const lineCount = occupied.length ? linesForMeasure(occupied, measureRows) : 4;
    const rowStep = measureRows / lineCount;
    const lines = [];
    for (let i = 0; i < lineCount; i++) {
      const row = startRow + i * rowStep;
      let line = '';
      for (let col = 0; col < columnCount; col++) {
        line += cells.get(`${row}:${col}`) || '0';
      }
      lines.push(line);
    }
    measures.push(lines.join('\n'));
  }

  return measures.join('\n,\n');
}

/**
 * @param {number} snapDenominator 4 | 8 | 16 | ...
 * @returns {number} rows between snap points
 */
export function snapToRows(snapDenominator) {
  const snap = Number(snapDenominator) || 16;
  return Math.max(1, Math.round((ROWS_PER_BEAT * 4) / snap));
}

/**
 * @param {number} beat
 * @param {number} snapDenominator
 */
export function quantizeBeat(beat, snapDenominator) {
  const rows = snapToRows(snapDenominator);
  const row = beatToNoteRow(beat);
  const snapped = Math.round(row / rows) * rows;
  return noteRowToBeat(snapped);
}
