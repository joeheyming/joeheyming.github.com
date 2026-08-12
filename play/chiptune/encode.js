/**
 * Compact URL-hash encode/decode for chiptune songs.
 * Format: #c1.<url-safe-base64-json>
 * Files use the same JSON payload (versioned compact object).
 */

import {
  CHANNEL_COUNT,
  DEFAULT_STEPS,
  MAX_STEPS,
  STEPS_PER_BAR,
  createChannel,
  createSong
} from './model.js';

/**
 * @param {import('./model.js').Song} song
 * @returns {object}
 */
export function songToPayload(song) {
  return {
    v: 1,
    t: song.tempo,
    s: song.steps,
    c: song.channels.map((ch) => [
      ch.wave,
      Math.round(ch.volume * 100),
      Math.round(ch.attack * 1000),
      Math.round(ch.release * 1000),
      ch.mute ? 1 : 0,
      ch.solo ? 1 : 0
    ]),
    p: song.patterns.map((pat) => ({
      n: pat.name,
      t: pat.tracks.map((track) => track.map((note) => [note.p, note.s, note.l]))
    })),
    a: song.arrangement,
    ap: song.activePattern,
    ac: song.activeChannel
  };
}

/**
 * @param {import('./model.js').Song} song
 */
export function encodeSong(song) {
  const json = JSON.stringify(songToPayload(song));
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `c1.${b64}`;
}

/**
 * @param {unknown} data
 * @returns {import('./model.js').Song}
 */
export function payloadToSong(data) {
  if (!data || typeof data !== 'object' || /** @type {{v?: unknown}} */ (data).v !== 1) {
    return createSong();
  }
  const d = /** @type {Record<string, unknown>} */ (data);
  if (!Array.isArray(d.p)) return createSong();

  const song = createSong();
  song.tempo = clamp(Number(d.t) || 120, 40, 280);
  const rawSteps = Number(d.s) || DEFAULT_STEPS;
  const snapped =
    rawSteps % STEPS_PER_BAR === 0
      ? rawSteps
      : Math.round(rawSteps / STEPS_PER_BAR) * STEPS_PER_BAR;
  song.steps = clamp(snapped || DEFAULT_STEPS, STEPS_PER_BAR, MAX_STEPS);
  song.activePattern = clamp(Number(d.ap) || 0, 0, 64);
  song.activeChannel = clamp(Number(d.ac) || 0, 0, CHANNEL_COUNT - 1);

  if (Array.isArray(d.c)) {
    song.channels = d.c.slice(0, CHANNEL_COUNT).map((row) => {
      const base = createChannel(typeof row?.[0] === 'string' ? row[0] : 'square');
      if (!Array.isArray(row)) return base;
      return {
        wave: typeof row[0] === 'string' ? row[0] : base.wave,
        volume: clamp((Number(row[1]) || 65) / 100, 0, 1),
        attack: clamp((Number(row[2]) || 10) / 1000, 0.001, 1),
        release: clamp((Number(row[3]) || 60) / 1000, 0.001, 2),
        mute: Boolean(row[4]),
        solo: Boolean(row[5])
      };
    });
    while (song.channels.length < CHANNEL_COUNT) song.channels.push(createChannel());
  }

  song.patterns = d.p.map((pat) => {
    const tracks = Array.from({ length: CHANNEL_COUNT }, (_, ci) => {
      const src = Array.isArray(pat?.t) ? pat.t[ci] : [];
      if (!Array.isArray(src)) return [];
      return src
        .map((n) => {
          if (!Array.isArray(n) || n.length < 3) return null;
          return {
            p: clamp(Number(n[0]), 0, 127),
            s: clamp(Number(n[1]), 0, song.steps - 1),
            l: clamp(Number(n[2]), 1, song.steps)
          };
        })
        .filter(Boolean);
    });
    return {
      name: typeof pat?.n === 'string' ? pat.n.slice(0, 8) : 'A',
      tracks
    };
  });
  if (!song.patterns.length) return createSong();

  song.arrangement = Array.isArray(d.a)
    ? d.a.map((i) => clamp(Number(i) || 0, 0, song.patterns.length - 1))
    : [0];
  if (!song.arrangement.length) song.arrangement = [0];
  song.activePattern = clamp(song.activePattern, 0, song.patterns.length - 1);
  return song;
}

/**
 * Decode from `#c1.…` hash, bare `c1.…`, or JSON text/object.
 * @param {string|object} raw
 * @returns {import('./model.js').Song}
 */
export function decodeSong(raw) {
  if (raw && typeof raw === 'object') return payloadToSong(raw);
  const text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) return createSong();
  if (text.startsWith('{')) {
    try {
      return payloadToSong(JSON.parse(text));
    } catch {
      return createSong();
    }
  }
  const hash = text.replace(/^#/, '');
  if (!hash.startsWith('c1.')) return createSong();
  try {
    let b64 = hash.slice(3).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const json = decodeURIComponent(escape(atob(b64)));
    return payloadToSong(JSON.parse(json));
  } catch {
    return createSong();
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function songUrlFromHash(hash) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return hash ? `${base}#${hash.replace(/^#/, '')}` : base;
}

/**
 * Trigger a browser download of the song as JSON.
 * @param {import('./model.js').Song} song
 * @param {string} [filename]
 */
export function downloadSongJson(song, filename = 'chiptune-song.json') {
  const blob = new Blob([JSON.stringify(songToPayload(song), null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
