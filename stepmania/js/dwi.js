// DWI (Dance With Intensity) charts. Zenius still ships a few songs only as
// .dwi inside the pack. The character map, hold marker, and beat math follow
// StepMania's NotesLoaderDWI: default rows are 8ths, GAP is milliseconds of
// offset, and CHANGEBPM / FREEZE beats are stored in quarter-notes of a beat
// (the loader divides them by 4).

import { parseMsd } from './msd.js';

const BEATS_PER_MEASURE = 4;
const ROWS_PER_BEAT = 48;

/** Numpad arrows for one 4-panel pad: left, down, up, right. */
const PAD_COLUMNS = {
  1: [1, 0],
  2: [1],
  3: [1, 3],
  4: [0],
  6: [3],
  7: [2, 0],
  8: [2],
  9: [2, 3],
  A: [2, 1],
  B: [0, 3]
};

const DIFFICULTY = {
  beginner: 'Beginner',
  easy: 'Easy',
  basic: 'Easy',
  light: 'Easy',
  medium: 'Medium',
  another: 'Medium',
  trick: 'Medium',
  standard: 'Medium',
  difficult: 'Medium',
  hard: 'Hard',
  ssr: 'Hard',
  maniac: 'Hard',
  heavy: 'Hard',
  smaniac: 'Challenge',
  challenge: 'Challenge',
  expert: 'Challenge',
  oni: 'Challenge',
  edit: 'Edit'
};

/**
 * @param {string} ch
 * @param {number} offset
 * @returns {number[]}
 */
function columnsForChar(ch, offset) {
  const cols = PAD_COLUMNS[String(ch || '').toUpperCase()];
  if (!cols) return [];
  return cols.map((col) => col + offset);
}

/**
 * `<...>` is a 192nd run when a rest appears before the closer, and a jump
 * (several arrows on one row) otherwise.
 * @param {string} stepData
 * @param {number} pos
 */
function is192(stepData, pos) {
  for (let i = pos; i < stepData.length; i++) {
    if (stepData[i] === '>') return false;
    if (stepData[i] === '0') return true;
  }
  return false;
}

/**
 * @param {string} stepData
 * @param {number} columnOffset
 * @returns {Array<{ beat: number, taps: number[], holds: number[] }>}
 */
function walkPad(stepData, columnOffset) {
  const s = String(stepData || '').replace(/[\n\r\t ]/g, '');
  /** @type {Array<{ beat: number, taps: number[], holds: number[] }>} */
  const events = [];
  let beat = 0;
  let increment = 0.5;
  for (let i = 0; i < s.length; ) {
    const c = s[i++];
    if (c === '(') {
      increment = 0.25;
      continue;
    }
    if (c === '[') {
      increment = BEATS_PER_MEASURE / 24;
      continue;
    }
    if (c === '{') {
      increment = BEATS_PER_MEASURE / 64;
      continue;
    }
    if (c === '`') {
      increment = BEATS_PER_MEASURE / 192;
      continue;
    }
    if (c === ')' || c === ']' || c === '}' || c === "'" || c === '>') {
      increment = 0.5;
      continue;
    }
    if (c === '!') continue;

    let jump = false;
    if (c === '<') {
      if (is192(s, i)) {
        increment = BEATS_PER_MEASURE / 192;
        continue;
      }
      jump = true;
      i += 1;
    }
    i -= 1;
    /** @type {number[]} */
    const taps = [];
    /** @type {number[]} */
    const holds = [];
    do {
      if (i >= s.length) break;
      const note = s[i++];
      if (jump && note === '>') break;
      taps.push(...columnsForChar(note, columnOffset));
      if (s[i] === '!') {
        i += 1;
        const holdChar = s[i++] || '';
        holds.push(...columnsForChar(holdChar, columnOffset));
      }
    } while (jump && i < s.length);
    if (taps.length || holds.length) events.push({ beat, taps, holds });
    beat += increment;
  }
  return events;
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function splitDwiChart(value) {
  const parts = [];
  let current = '';
  let splits = 0;
  for (const ch of String(value || '')) {
    if (ch === ':' && splits < 3) {
      parts.push(current.trim());
      current = '';
      splits += 1;
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  while (parts.length < 4) parts.push('');
  return parts;
}

/**
 * @param {string} name
 */
function difficultyName(name) {
  const key = String(name || '')
    .trim()
    .toLowerCase();
  return DIFFICULTY[key] || name || 'Medium';
}

/**
 * @param {Array<{ beat: number, taps: number[], holds: number[] }>} events
 * @param {number} columns
 */
function renderNotes(events, columns) {
  /** @type {Map<number, { taps: Set<number>, holds: Set<number>, releases: Set<number> }>} */
  const byRow = new Map();
  const slot = (row) => {
    let found = byRow.get(row);
    if (!found) {
      found = { taps: new Set(), holds: new Set(), releases: new Set() };
      byRow.set(row, found);
    }
    return found;
  };
  for (const event of events) {
    const row = Math.round(event.beat * ROWS_PER_BEAT);
    const cell = slot(row);
    for (const col of event.taps) cell.taps.add(col);
    for (const col of event.holds) cell.holds.add(col);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  for (const row of rows) {
    const cell = byRow.get(row);
    if (!cell) continue;
    for (const col of [...cell.holds]) {
      cell.taps.delete(col);
      const tail = rows.find((later) => {
        if (later <= row) return false;
        const next = byRow.get(later);
        return next ? next.taps.has(col) || next.holds.has(col) : false;
      });
      if (tail == null) {
        cell.holds.delete(col);
        cell.taps.add(col);
        continue;
      }
      const next = byRow.get(tail);
      if (!next) continue;
      next.taps.delete(col);
      next.holds.delete(col);
      next.releases.add(col);
    }
  }

  const occupied = [...byRow.keys()];
  if (!occupied.length) return '0'.repeat(columns);
  const last = Math.max(...occupied);
  const measures = Math.floor(last / (ROWS_PER_BEAT * BEATS_PER_MEASURE)) + 1;
  /** @type {string[]} */
  const chunks = [];
  for (let measure = 0; measure < measures; measure++) {
    const start = measure * ROWS_PER_BEAT * BEATS_PER_MEASURE;
    /** @type {number[]} */
    const used = [];
    for (let row = 0; row < ROWS_PER_BEAT * BEATS_PER_MEASURE; row++) {
      const cell = byRow.get(start + row);
      if (cell && (cell.taps.size || cell.holds.size || cell.releases.size)) used.push(row);
    }
    if (!used.length) {
      chunks.push('0'.repeat(columns));
      continue;
    }
    let step = 1;
    for (const candidate of [48, 24, 16, 12, 8, 6, 4, 3, 2, 1]) {
      if (used.every((row) => row % candidate === 0)) {
        step = candidate;
        break;
      }
    }
    /** @type {string[]} */
    const lines = [];
    for (let row = 0; row < ROWS_PER_BEAT * BEATS_PER_MEASURE; row += step) {
      const cell = byRow.get(start + row);
      const chars = Array(columns).fill('0');
      if (cell) {
        for (const col of cell.taps) if (col >= 0 && col < columns) chars[col] = '1';
        for (const col of cell.holds) if (col >= 0 && col < columns) chars[col] = '2';
        for (const col of cell.releases) if (col >= 0 && col < columns) chars[col] = '3';
      }
      lines.push(chars.join(''));
    }
    chunks.push(lines.join('\n'));
  }
  return chunks.join('\n,\n');
}

/**
 * @param {string} pairs
 * @param {number} scaleBeat
 */
function scaledPairs(pairs, scaleBeat) {
  return String(pairs || '')
    .split(',')
    .map((pair) => {
      const [beatRaw, valueRaw] = pair.split('=');
      const beat = parseFloat(beatRaw);
      const value = parseFloat(valueRaw);
      if (!Number.isFinite(beat) || !Number.isFinite(value)) return null;
      return `${(beat / scaleBeat).toFixed(3)}=${value}`;
    })
    .filter((pair) => pair)
    .join(',');
}

/**
 * Convert a DWI file into an .sm document the simfile parser already understands.
 * Returns null when the file has no single or double chart.
 * @param {string} content
 * @returns {string|null}
 */
export function dwiToSm(content) {
  const tags = parseMsd(content);
  const charts = tags.filter(
    (tag) => tag.tag === 'SINGLE' || tag.tag === 'DOUBLE' || tag.tag === 'COUPLE'
  );
  if (!charts.length) return null;

  const valueOf = (name) => tags.find((tag) => tag.tag === name)?.value || '';
  const title = valueOf('TITLE') || 'Unknown';
  const artist = valueOf('ARTIST') || 'Unknown';
  const bpm = parseFloat(valueOf('BPM'));
  const gap = parseFloat(valueOf('GAP'));
  const offset = Number.isFinite(gap) ? -gap / 1000 : 0;
  /** @type {string[]} */
  const bpms = [`0.000=${Number.isFinite(bpm) && bpm > 0 ? bpm : 120}`];
  const changes = scaledPairs(valueOf('CHANGEBPM') || valueOf('BPMCHANGE'), 4);
  if (changes) bpms.push(changes);
  const stops = scaledPairs(valueOf('FREEZE'), 4)
    .split(',')
    .filter((pair) => pair)
    .map((pair) => {
      const [beat, ms] = pair.split('=');
      return `${beat}=${(parseFloat(ms) / 1000).toFixed(3)}`;
    })
    .join(',');

  /** @type {string[]} */
  const notes = [];
  for (const chart of charts) {
    const [description, feet, step1, step2] = splitDwiChart(chart.value);
    const doubled = chart.tag !== 'SINGLE';
    const columns = doubled ? 8 : 4;
    const events = walkPad(step1, 0);
    if (doubled && step2) events.push(...walkPad(step2, 4));
    const type =
      chart.tag === 'COUPLE' ? 'dance-couple' : doubled ? 'dance-double' : 'dance-single';
    notes.push(
      `#NOTES:\n     ${type}:\n     ${description}:\n     ${difficultyName(description)}:\n     ${
        parseInt(feet, 10) || 1
      }:\n     :\n${renderNotes(events, columns)}\n;`
    );
  }

  return [
    `#TITLE:${title};`,
    `#ARTIST:${artist};`,
    `#OFFSET:${offset.toFixed(3)};`,
    `#BPMS:${bpms.join(',')};`,
    stops ? `#STOPS:${stops};` : '',
    notes.join('\n')
  ]
    .filter(Boolean)
    .join('\n');
}
