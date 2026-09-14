// Simfile Parser - ES Module
// Parses StepMania .sm and .ssc simfile formats

/**
 * @typedef {Object} BPMChange
 * @property {number} beat
 * @property {number} bpm
 */

/**
 * @typedef {Object} BGChange
 * @property {number} beat
 * @property {string} file
 * @property {string} effect
 * @property {number} x
 * @property {number} y
 * @property {boolean} isVideo
 * @property {boolean} isNoBackground
 */

/**
 * @typedef {Object} Chart
 * @property {string} type
 * @property {string} description
 * @property {string} difficulty
 * @property {number} rating
 * @property {string} radarValues
 * @property {Array<Array>} noteData
 * @property {string} [chartName]
 * @property {string} [credit]
 * @property {boolean} [hasSplitTiming]
 * @property {number} [offset]
 * @property {import('./timingData.js').TimingData} [timing]
 * @property {object} [timingTags]
 * @property {Object<string, string>} [timingExtras]
 */

/**
 * @typedef {Object} ParsedSimfile
 * @property {string} title
 * @property {string} artist
 * @property {number} bpm
 * @property {number} offset
 * @property {Chart[]} charts
 * @property {BGChange[]} bgChanges
 * @property {BPMChange[]} bpmChanges
 * @property {import('./timingData.js').TimingData} timing
 * @property {Object<string, string>} metadata
 * @property {object} timingTags
 * @property {Object<string, string>} timingExtras
 */

import { buildTimingData } from './timingData.js';
import { parseMsd, parseTimingPairs, splitSmNotesValue } from './msd.js';
import { parseNoteField, DANCE_SINGLE_COLS } from './noteGrid.js';

const VIDEO_EXT = /\.(avi|mp4|webm|mov)$/i;
const SPLIT_TIMING_TAGS = [
  'OFFSET',
  'BPMS',
  'STOPS',
  'DELAYS',
  'WARPS',
  'SPEEDS',
  'SCROLLS',
  'FAKES',
  'LABELS',
  'TIMESIGNATURES',
  'TICKCOUNTS',
  'COMBOS'
];
const TIMING_EXTRA_TAGS = [
  'SPEEDS',
  'SCROLLS',
  'FAKES',
  'LABELS',
  'TIMESIGNATURES',
  'TICKCOUNTS',
  'COMBOS'
];

/**
 * @param {string} file
 */
export function isVideoFileName(file) {
  return VIDEO_EXT.test(String(file || ''));
}

/**
 * @param {Chart[]} charts
 */
export function danceSingleCharts(charts) {
  return (charts || []).filter((chart) => chart.type === 'dance-single');
}

/**
 * @param {string} value
 * @returns {BGChange[]}
 */
export function parseBgChangesValue(value) {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .split(',')
    .map((pair) => {
      const parts = pair.split('=').map((s) => s.trim());
      if (parts.length < 2 || !parts[1]) return null;
      const beat = parseFloat(parts[0]);
      const file = parts[1];
      if (!Number.isFinite(beat)) return null;
      return {
        beat,
        file,
        effect: parts[2] || '',
        x: parseFloat(parts[3]) || 0,
        y: parseFloat(parts[4]) || 0,
        isVideo: isVideoFileName(file),
        isNoBackground: file === '-nosongbg-'
      };
    })
    .filter((bg) => bg !== null)
    .sort((a, b) => a.beat - b.beat);
}

/**
 * @param {Object<string, string>} tags
 */
export function timingFromTags(tags) {
  const timingTags = {
    bpms: parseTimingPairs(tags.BPMS),
    stops: parseTimingPairs(tags.STOPS || tags.FREEZES),
    delays: parseTimingPairs(tags.DELAYS),
    warps: parseTimingPairs(tags.WARPS)
  };
  /** @type {Object<string, string>} */
  const timingExtras = {};
  for (const name of TIMING_EXTRA_TAGS) {
    if (tags[name]) timingExtras[name] = tags[name];
  }
  return { timingTags, timingExtras, timing: buildTimingData(timingTags) };
}

function columnCountForType(type) {
  if (type === 'dance-double' || type === 'dance-couple') return 8;
  return DANCE_SINGLE_COLS;
}

/**
 * Parser for StepMania .sm / .ssc simfile format
 */
export class SimfileParser {
  constructor() {
    this.reset();
  }

  reset() {
    /** @type {Object<string, string>} */
    this.metadata = {};
    /** @type {Chart[]} */
    this.charts = [];
    /** @type {BPMChange[]} */
    this.bpmChanges = [];
    /** @type {BGChange[]} */
    this.bgChanges = [];
    this.timingTags = { bpms: [], stops: [], delays: [], warps: [] };
    /** @type {Object<string, string>} */
    this.timingExtras = {};
  }

  /**
   * @param {string} simfileContent
   * @returns {ParsedSimfile}
   */
  parse(simfileContent) {
    this.reset();
    const tags = parseMsd(simfileContent);
    /** @type {Object<string, string>} */
    const songTags = {};

    for (let i = 0; i < tags.length; i++) {
      const { tag, value } = tags[i];
      if (tag === 'NOTEDATA') {
        /** @type {Object<string, string>} */
        const chartTags = {};
        i += 1;
        while (i < tags.length && tags[i].tag !== 'NOTEDATA') {
          chartTags[tags[i].tag] = tags[i].value;
          if (tags[i].tag === 'NOTES') {
            i += 1;
            break;
          }
          i += 1;
        }
        i -= 1;
        const chart = this.chartFromSsc(chartTags);
        if (chart) this.charts.push(chart);
        continue;
      }
      if (tag === 'NOTES') {
        const chart = this.chartFromSmNotes(value);
        if (chart) this.charts.push(chart);
        continue;
      }
      songTags[tag] = value;
      this.metadata[tag] = value;
    }

    const songTiming = timingFromTags(songTags);
    this.timingTags = songTiming.timingTags;
    this.timingExtras = songTiming.timingExtras;
    this.bpmChanges = this.timingTags.bpms
      .map(({ beat, value }) => ({ beat, bpm: value }))
      .sort((a, b) => a.beat - b.beat);
    this.bgChanges = parseBgChangesValue(songTags.BGCHANGES || '');

    this.charts.sort((a, b) => a.rating - b.rating);

    return {
      title: this.metadata.TITLE || 'Unknown',
      artist: this.metadata.ARTIST || 'Unknown',
      bpm: this.getDisplayBPM(),
      offset: this.parseOffset(),
      charts: this.charts,
      bgChanges: this.bgChanges,
      bpmChanges: this.bpmChanges,
      timing: songTiming.timing,
      timingTags: this.timingTags,
      timingExtras: this.timingExtras,
      metadata: this.metadata
    };
  }

  /**
   * @param {string} value
   * @returns {Chart | null}
   */
  chartFromSmNotes(value) {
    const [type, description, difficulty, ratingRaw, radarValues, stepData] =
      splitSmNotesValue(value);
    if (!type) return null;
    const columnCount = columnCountForType(type);
    return {
      type,
      description: description || '',
      difficulty: difficulty || 'Beginner',
      rating: parseInt(ratingRaw, 10) || 1,
      radarValues: radarValues || '',
      noteData: parseNoteField(stepData, columnCount),
      chartName: description || '',
      credit: '',
      hasSplitTiming: false
    };
  }

  /**
   * @param {Object<string, string>} chartTags
   * @returns {Chart | null}
   */
  chartFromSsc(chartTags) {
    const type = (chartTags.STEPSTYPE || '').trim();
    if (!type) return null;
    const columnCount = columnCountForType(type);
    const split = SPLIT_TIMING_TAGS.some(
      (name) => chartTags[name] != null && chartTags[name] !== ''
    );
    /** @type {Chart} */
    const chart = {
      type,
      description: chartTags.DESCRIPTION || '',
      difficulty: chartTags.DIFFICULTY || 'Beginner',
      rating: parseInt(chartTags.METER, 10) || 1,
      radarValues: chartTags.RADARVALUES || '',
      noteData: parseNoteField(chartTags.NOTES || '', columnCount),
      chartName: chartTags.CHARTNAME || chartTags.DESCRIPTION || '',
      credit: chartTags.CREDIT || '',
      hasSplitTiming: split
    };
    if (split) {
      const derived = timingFromTags(chartTags);
      chart.timingTags = derived.timingTags;
      chart.timingExtras = derived.timingExtras;
      chart.timing = derived.timing;
      const offset = parseFloat(chartTags.OFFSET);
      if (Number.isFinite(offset)) chart.offset = offset;
    }
    return chart;
  }

  /**
   * @param {string} stepData
   * @returns {Array<Array>}
   */
  parseStepData(stepData) {
    return parseNoteField(stepData, DANCE_SINGLE_COLS);
  }

  getDisplayBPM() {
    if (this.metadata.DISPLAYBPM) {
      const bpm = parseFloat(this.metadata.DISPLAYBPM);
      if (!isNaN(bpm) && bpm > 0) return bpm;
    }
    const firstPositive = this.bpmChanges.find((change) => change.bpm > 0);
    if (firstPositive) return firstPositive.bpm;
    return 120;
  }

  parseOffset() {
    const offset = parseFloat(this.metadata.OFFSET);
    return Number.isFinite(offset) ? offset : 0;
  }
}

export default SimfileParser;
