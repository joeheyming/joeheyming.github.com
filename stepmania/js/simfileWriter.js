import { formatTimingPairs } from './msd.js';
import { encodeNoteField, DANCE_SINGLE_COLS } from './noteGrid.js';
import { buildTimingData } from './timingData.js';

export const SSC_VERSION = '0.83';

const SONG_STRING_TAGS = [
  'TITLE',
  'SUBTITLE',
  'ARTIST',
  'TITLETRANSLIT',
  'SUBTITLETRANSLIT',
  'ARTISTTRANSLIT',
  'GENRE',
  'CREDIT',
  'BANNER',
  'BACKGROUND',
  'LYRICSPATH',
  'CDTITLE',
  'MUSIC',
  'ORIGIN',
  'JACKET',
  'CDIMAGE',
  'DISCIMAGE',
  'PREVIEWVID',
  'PREVIEW',
  'SELECTABLE',
  'DISPLAYBPM',
  'SAMPLESTART',
  'SAMPLELENGTH'
];

function escapeMsd(value) {
  return String(value ?? '').replace(/;/g, '');
}

function tag(name, value) {
  if (value == null || value === '') return '';
  return `#${name}:${escapeMsd(value)};\n`;
}

function columnCountForType(type) {
  if (type === 'dance-double' || type === 'dance-couple') return 8;
  return DANCE_SINGLE_COLS;
}

function formatBgChanges(bgChanges) {
  return (bgChanges || [])
    .map((bg) => {
      const beat = Number(bg.beat).toFixed(3);
      const file = bg.file || '';
      const effect = bg.effect || '1.000';
      const x = Number.isFinite(bg.x) ? bg.x : 0;
      const y = Number.isFinite(bg.y) ? bg.y : 0;
      return `${beat}=${file}=${effect}=${x}=${y}`;
    })
    .join(',');
}

function timingBlock(timingTags, timingExtras, offset) {
  let out = '';
  if (Number.isFinite(offset)) out += tag('OFFSET', offset.toFixed(3));
  if (timingTags?.bpms?.length) out += tag('BPMS', formatTimingPairs(timingTags.bpms));
  if (timingTags?.stops?.length) out += tag('STOPS', formatTimingPairs(timingTags.stops));
  if (timingTags?.delays?.length) out += tag('DELAYS', formatTimingPairs(timingTags.delays));
  if (timingTags?.warps?.length) out += tag('WARPS', formatTimingPairs(timingTags.warps));
  for (const [name, value] of Object.entries(timingExtras || {})) {
    out += tag(name, value);
  }
  return out;
}

/**
 * @param {import('./simfileParser.js').ParsedSimfile} parsed
 */
export function chartHasSplitTiming(parsed) {
  return (parsed.charts || []).some((chart) => chart.hasSplitTiming);
}

/**
 * @param {Partial<import('./simfileParser.js').ParsedSimfile>} parsed
 */
export function writeSsc(parsed) {
  const metadata = { ...(parsed.metadata || {}) };
  metadata.TITLE = parsed.title ?? metadata.TITLE ?? 'New Song';
  metadata.ARTIST = parsed.artist ?? metadata.ARTIST ?? '';
  if (parsed.offset != null) metadata.OFFSET = Number(parsed.offset).toFixed(3);
  if (parsed.bpm != null && !metadata.DISPLAYBPM) metadata.DISPLAYBPM = String(parsed.bpm);

  let out = tag('VERSION', SSC_VERSION);
  for (const name of SONG_STRING_TAGS) {
    if (name === 'OFFSET') continue;
    out += tag(name, metadata[name]);
  }
  const timingTags = parsed.timingTags || {
    bpms: (parsed.bpmChanges || []).map((c) => ({ beat: c.beat, value: c.bpm })),
    stops: [],
    delays: [],
    warps: []
  };
  if (!timingTags.bpms?.length) {
    timingTags.bpms = [{ beat: 0, value: parsed.bpm || 120 }];
  }
  out += timingBlock(timingTags, parsed.timingExtras, parsed.offset);
  const bg = formatBgChanges(parsed.bgChanges);
  if (bg) out += tag('BGCHANGES', bg);

  for (const chart of parsed.charts || []) {
    const cols = columnCountForType(chart.type);
    out += `\n//---------------${chart.type} - ${
      chart.chartName || chart.difficulty
    }----------------\n`;
    out += '#NOTEDATA:;\n';
    out += tag('CHARTNAME', chart.chartName || chart.description || '');
    out += tag('STEPSTYPE', chart.type || 'dance-single');
    out += tag('DESCRIPTION', chart.description || '');
    out += tag('DIFFICULTY', chart.difficulty || 'Beginner');
    out += tag('METER', String(chart.rating ?? 1));
    out += tag('RADARVALUES', chart.radarValues || '0,0,0,0,0');
    out += tag('CREDIT', chart.credit || '');
    if (chart.hasSplitTiming) {
      out += timingBlock(chart.timingTags, chart.timingExtras, chart.offset);
    }
    out += `#NOTES:\n${encodeNoteField(chart.noteData || [], cols)}\n;\n`;
  }
  return out;
}

/**
 * Legacy .sm export. Throws if any chart uses split timing.
 * @param {import('./simfileParser.js').ParsedSimfile} parsed
 */
export function writeSm(parsed) {
  if (chartHasSplitTiming(parsed)) {
    throw new Error('Cannot write .sm when a chart uses split timing; export .ssc instead');
  }
  const metadata = { ...(parsed.metadata || {}) };
  metadata.TITLE = parsed.title ?? metadata.TITLE ?? 'New Song';
  metadata.ARTIST = parsed.artist ?? metadata.ARTIST ?? '';
  let out = '';
  for (const name of [
    'TITLE',
    'SUBTITLE',
    'ARTIST',
    'GENRE',
    'CREDIT',
    'BANNER',
    'BACKGROUND',
    'MUSIC',
    'SELECTABLE',
    'DISPLAYBPM',
    'SAMPLESTART',
    'SAMPLELENGTH'
  ]) {
    out += tag(name, metadata[name]);
  }
  const timingTags = parsed.timingTags || {
    bpms: (parsed.bpmChanges || []).map((c) => ({ beat: c.beat, value: c.bpm })),
    stops: [],
    delays: [],
    warps: []
  };
  if (!timingTags.bpms?.length) {
    timingTags.bpms = [{ beat: 0, value: parsed.bpm || 120 }];
  }
  out += timingBlock(timingTags, parsed.timingExtras, parsed.offset ?? 0);
  const bg = formatBgChanges(parsed.bgChanges);
  if (bg) out += tag('BGCHANGES', bg);

  for (const chart of parsed.charts || []) {
    const cols = columnCountForType(chart.type);
    out += `#NOTES:\n     ${chart.type}:\n     ${chart.description || ''}:\n     ${
      chart.difficulty || 'Beginner'
    }:\n     ${chart.rating ?? 1}:\n     ${chart.radarValues || ''}:\n${encodeNoteField(
      chart.noteData || [],
      cols
    )}\n;\n`;
  }
  return out;
}

/**
 * @param {object} [opts]
 * @returns {import('./simfileParser.js').ParsedSimfile}
 */
export function createEmptySimfile(opts = {}) {
  const title = opts.title || 'New Song';
  const artist = opts.artist || '';
  const bpm = Number(opts.bpm) || 120;
  const offset = Number(opts.offset) || 0;
  const timingTags = { bpms: [{ beat: 0, value: bpm }], stops: [], delays: [], warps: [] };
  return {
    title,
    artist,
    bpm,
    offset,
    charts: [
      {
        type: 'dance-single',
        description: '',
        difficulty: 'Beginner',
        rating: 1,
        radarValues: '0,0,0,0,0',
        noteData: [],
        chartName: '',
        credit: '',
        hasSplitTiming: false
      }
    ],
    bgChanges: [],
    bpmChanges: [{ beat: 0, bpm }],
    timing: buildTimingData(timingTags),
    timingTags,
    timingExtras: {},
    metadata: {
      TITLE: title,
      ARTIST: artist,
      MUSIC: opts.music || '',
      BANNER: opts.banner || '',
      BACKGROUND: opts.background || '',
      JACKET: opts.jacket || '',
      PREVIEWVID: opts.previewVid || '',
      SELECTABLE: 'YES',
      DISPLAYBPM: String(bpm)
    }
  };
}
