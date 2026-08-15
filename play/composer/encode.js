/**
 * Compact URL-hash encode/decode for composer scores.
 * Format: #m1.<url-safe-base64-json>
 */
import { createEmptyScore, loadScore, serializeScore } from './model.js';
import { clamp } from './notation.js';

/**
 * @param {object} score
 * @returns {object}
 */
export function scoreToPayload(score) {
  const raw = serializeScore(score);
  return {
    v: 1,
    bpm: raw.bpm,
    vol: raw.volume,
    m: raw.measures,
    ts: [raw.timeSig.beats, raw.timeSig.unit],
    ks: raw.keySig,
    n: raw.notes.map((note) => [
      note.staff === 'bass' ? 1 : 0,
      note.voice || 0,
      note.start,
      note.duration,
      note.step,
      note.accidental === 'sharp'
        ? 1
        : note.accidental === 'flat'
        ? -1
        : note.accidental === 'natural'
        ? 0
        : null,
      note.tieTo || null,
      note.dynamic || null,
      note.rest ? 1 : 0,
      note.id
    ])
  };
}

/**
 * @param {object} score
 * @returns {string} hash without leading #
 */
export function encodeScore(score) {
  const json = JSON.stringify(scoreToPayload(score));
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `m1.${b64}`;
}

/**
 * @param {unknown} data
 * @returns {object}
 */
export function payloadToScore(data) {
  if (!data || typeof data !== 'object' || /** @type {{v?: unknown}} */ (data).v !== 1) {
    return createEmptyScore();
  }
  const d = /** @type {Record<string, unknown>} */ (data);
  const ts = Array.isArray(d.ts) ? d.ts : [4, 4];
  const notes = Array.isArray(d.n)
    ? d.n
        .filter((row) => Array.isArray(row) && row.length >= 5)
        .map((row) => {
          const acc =
            row[5] === 1 ? 'sharp' : row[5] === -1 ? 'flat' : row[5] === 0 ? 'natural' : null;
          return {
            id: typeof row[9] === 'string' ? row[9] : undefined,
            staff: row[0] === 1 ? 'bass' : 'treble',
            voice: row[1] === 1 ? 1 : 0,
            start: Number(row[2]) || 0,
            duration: Number(row[3]) || 4,
            step: Number(row[4]) || 0,
            accidental: acc,
            tieTo: typeof row[6] === 'string' ? row[6] : null,
            dynamic: typeof row[7] === 'string' ? row[7] : null,
            rest: row[8] === 1
          };
        })
    : [];

  return loadScore({
    version: 2,
    bpm: clamp(Number(d.bpm) || 100, 40, 280),
    volume: clamp(Number(d.vol) || 70, 0, 100),
    measures: clamp(Number(d.m) || 4, 1, 16),
    timeSig: { beats: Number(ts[0]) || 4, unit: Number(ts[1]) || 4 },
    keySig: clamp(Number(d.ks) || 0, -7, 7),
    notes
  });
}

/**
 * @param {string} raw hash or full URL hash
 * @returns {object}
 */
/**
 * @param {string|object} raw hash, JSON string, or payload object
 * @returns {object}
 */
export function decodeScore(raw) {
  try {
    if (raw && typeof raw === 'object') return payloadToScore(raw);
    let s = String(raw || '')
      .replace(/^#/, '')
      .trim();
    if (s.startsWith('{')) return payloadToScore(JSON.parse(s));
    if (!s.startsWith('m1.')) return createEmptyScore();
    let b64 = s.slice(3).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    return payloadToScore(JSON.parse(json));
  } catch (_) {
    return createEmptyScore();
  }
}

export function scoreUrlFromHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  return `${location.origin}${location.pathname}#${h}`;
}

/**
 * @param {object} score
 * @param {string} [filename]
 */
export function downloadScoreJson(score, filename = 'composer-score.json') {
  const blob = new Blob([JSON.stringify(scoreToPayload(score), null, 2)], {
    type: 'application/json'
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
