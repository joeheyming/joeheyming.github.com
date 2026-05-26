/**
 * Subtitles, sourced from the public Stremio OpenSubtitles v3 addon.
 *
 * The addon is keyless, CORS-friendly (both the JSON search endpoint
 * and the SRT downloads), and re-encodes everything to UTF-8 for us.
 * Those three properties make it the only viable third-party subtitle
 * source for a static GitHub Pages site — every other free option
 * (Wyzie, OpenSubtitles direct, Subdl) now requires an API key, which
 * a browser-only deploy can't safely hold.
 *
 * Flow:
 *   1. searchSubtitles(imdbId, season, episode)
 *      → list of { id, url, lang, encoding } candidates
 *   2. loadVttUrl(candidates)
 *      → fetches the first that responds, converts SRT → WebVTT,
 *        and returns a blob: URL ready to drop into <track src=…>
 *
 * Why blob URLs: HTMLTrackElement requires either same-origin sources
 * OR a video element with `crossorigin` and a CORS-compliant track
 * server. We can guarantee the first by hosting the converted VTT as
 * a same-origin blob, which side-steps the whole CORS dance.
 *
 * Search results cache in localStorage for ~24h (the addon itself
 * advertises 48h freshness via `cacheMaxAge`). Subtitle files are
 * NOT cached client-side — they're already heavily cached by the
 * Stremio CDN (`Cache-Control: max-age=31536000`).
 */

const SEARCH_BASE = 'https://opensubtitles-v3.strem.io/subtitles/series';
const SEARCH_CACHE_PREFIX = 'heyming.watch.subs.search.';
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} SubtitleCandidate
 * @property {string} id        OpenSubtitles file id, useful as a stable React-style key.
 * @property {string} url       Direct SRT download URL (UTF-8, CORS `*`).
 * @property {string} lang      ISO 639-2 language code: "eng", "spa", "fre", "ger", …
 * @property {string} encoding  Original on-disk encoding before Stremio re-encoded.
 */

/**
 * Look up subtitles for a series episode by IMDb id.
 *
 * Returns an empty array on any failure path — captions are a
 * nice-to-have, never a hard dependency. Callers must always
 * tolerate an empty result.
 *
 * @param {string} imdbId   With the "tt" prefix.
 * @param {number} season
 * @param {number} episode
 * @returns {Promise<SubtitleCandidate[]>}
 */
export async function searchSubtitles(imdbId, season, episode) {
  if (!imdbId || !Number.isFinite(season) || !Number.isFinite(episode)) return [];
  if (season <= 0) return []; // Movie / specials endpoint is different; skip for now.
  const key = `${imdbId}:${season}:${episode}`;
  const cached = readSearchCache(key);
  if (cached) return cached;
  try {
    const url = `${SEARCH_BASE}/${encodeURIComponent(imdbId)}:${season}:${episode}.json`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return [];
    const data = await res.json();
    const list = parseSearchResponse(data);
    writeSearchCache(key, list);
    return list;
  } catch {
    return [];
  }
}

/**
 * Pure validator/normalizer for the Stremio addon's JSON response.
 * Exposed for tests so we don't have to mock the network.
 *
 * @param {unknown} data
 * @returns {SubtitleCandidate[]}
 */
export function parseSearchResponse(data) {
  if (!data || typeof data !== 'object') return [];
  const arr = /** @type {{ subtitles?: unknown }} */ (data).subtitles;
  if (!Array.isArray(arr)) return [];
  /** @type {SubtitleCandidate[]} */
  const out = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const url = /** @type {{ url?: unknown }} */ (raw).url;
    const lang = /** @type {{ lang?: unknown }} */ (raw).lang;
    if (typeof url !== 'string' || typeof lang !== 'string') continue;
    out.push({
      id: String(/** @type {{ id?: unknown }} */ (raw).id || ''),
      url,
      lang: lang.toLowerCase(),
      encoding:
        typeof (/** @type {{ SubEncoding?: unknown }} */ (raw).SubEncoding) === 'string'
          ? String(/** @type {{ SubEncoding?: unknown }} */ (raw).SubEncoding)
          : ''
    });
  }
  return out;
}

/**
 * Group candidates by language code, preserving the order the addon
 * returned them (which is roughly relevance × download count).
 *
 * @param {SubtitleCandidate[]} candidates
 * @returns {Array<{ lang: string, candidates: SubtitleCandidate[] }>}
 */
export function groupByLanguage(candidates) {
  /** @type {Map<string, SubtitleCandidate[]>} */
  const grouped = new Map();
  for (const c of candidates) {
    const list = grouped.get(c.lang) || [];
    list.push(c);
    grouped.set(c.lang, list);
  }
  return Array.from(grouped, ([lang, list]) => ({ lang, candidates: list }));
}

/**
 * Try each candidate in turn; return a blob: URL pointing at a
 * converted WebVTT for the first one that succeeds. Returns null
 * if none of them load.
 *
 * @param {SubtitleCandidate[]} candidates
 * @returns {Promise<string | null>}
 */
export async function loadVttUrl(candidates) {
  for (const c of candidates) {
    try {
      const res = await fetch(c.url, { credentials: 'omit' });
      if (!res.ok) continue;
      const text = await res.text();
      // Empty or absurdly-short responses are usually 404 HTML pages
      // dressed as 200s — skip and try the next candidate.
      if (!text || text.length < 30) continue;
      const vtt = srtToVtt(text);
      const blob = new Blob([vtt], { type: 'text/vtt' });
      return URL.createObjectURL(blob);
    } catch {
      // network error — try the next candidate
    }
  }
  return null;
}

/**
 * Apply a manual sync offset (in seconds) to every cue in a
 * `TextTrackCueList`. The first call against a given cue caches its
 * pre-offset baseline on the cue object via `_baseStart` / `_baseEnd`
 * so subsequent calls aren't cumulative — passing `2.0` and then
 * `3.0` shifts cues by 3.0 from their original, not by 5.0.
 *
 * Negative offsets are clamped at zero so a cue can never have a
 * negative start time (browsers refuse to render those).
 *
 * Accepts the raw `TextTrackCueList` (or any array-like of cue-shaped
 * objects with `startTime` / `endTime`) so it's straightforward to
 * unit-test with plain objects — no `<track>` instance needed.
 *
 * Returns the number of cues actually adjusted.
 *
 * @param {ArrayLike<VTTCueLike>} cues
 * @param {number} offsetSec
 * @returns {number}
 *
 * @typedef {Object} VTTCueLike
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} [_baseStart]
 * @property {number} [_baseEnd]
 */
export function applyCueOffset(cues, offsetSec) {
  if (!cues || typeof cues.length !== 'number') return 0;
  let n = 0;
  for (let i = 0; i < cues.length; i += 1) {
    const c = cues[i];
    if (!c) continue;
    if (c._baseStart == null) {
      c._baseStart = c.startTime;
      c._baseEnd = c.endTime;
    }
    c.startTime = Math.max(0, c._baseStart + offsetSec);
    c.endTime = Math.max(0, c._baseEnd + offsetSec);
    n += 1;
  }
  return n;
}

/**
 * Convert a SubRip (.srt) document to WebVTT.
 *
 * The transformation is intentionally minimal:
 *  - prepend the `WEBVTT` header (mandatory for HTMLTrackElement)
 *  - normalize CRLF → LF
 *  - replace the comma in timecodes with a period:
 *    `00:00:01,500 --> 00:00:04,000` → `00:00:01.500 --> 00:00:04.000`
 *  - strip a leading BOM if present
 *
 * SRT cue indices ("1", "2", …) are left in place — WebVTT treats
 * them as optional cue identifiers and every browser handles that.
 *
 * Exposed for tests.
 *
 * @param {string} srt
 * @returns {string}
 */
export function srtToVtt(srt) {
  if (typeof srt !== 'string') return 'WEBVTT\n\n';
  const stripped = srt.replace(/^\uFEFF/, '');
  const normalized = stripped.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cued = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );
  return `WEBVTT\n\n${cued}`;
}

// Subset of ISO 639-2/B → human label. Stremio returns 639-2/B
// codes; "eng" instead of "en", "fre" instead of "fr", and so on.
// Unknown codes fall back to the raw code, uppercased.
const LANG_LABELS = {
  eng: 'English',
  spa: 'Spanish',
  fre: 'French',
  ger: 'German',
  ita: 'Italian',
  por: 'Portuguese',
  pob: 'Portuguese (BR)',
  dut: 'Dutch',
  nld: 'Dutch',
  pol: 'Polish',
  rus: 'Russian',
  swe: 'Swedish',
  dan: 'Danish',
  nor: 'Norwegian',
  fin: 'Finnish',
  ell: 'Greek',
  tur: 'Turkish',
  ara: 'Arabic',
  heb: 'Hebrew',
  jpn: 'Japanese',
  chi: 'Chinese',
  zho: 'Chinese',
  kor: 'Korean',
  ind: 'Indonesian',
  vie: 'Vietnamese',
  tha: 'Thai',
  hun: 'Hungarian',
  cze: 'Czech',
  slo: 'Slovak',
  slv: 'Slovenian',
  ron: 'Romanian',
  bul: 'Bulgarian',
  hrv: 'Croatian',
  srp: 'Serbian',
  bos: 'Bosnian',
  mac: 'Macedonian',
  ukr: 'Ukrainian',
  per: 'Persian',
  fas: 'Persian',
  hin: 'Hindi'
};

/**
 * Human-readable label for an ISO 639-2/B code. Unknown codes are
 * returned uppercased so the UI still surfaces *something*.
 *
 * @param {string} code
 * @returns {string}
 */
export function languageLabel(code) {
  if (!code) return '';
  const k = code.toLowerCase();
  return LANG_LABELS[k] || k.toUpperCase();
}

/**
 * Sort languages so that English (when present) leads and the rest
 * fall in alphabetical-by-label order. Keeps the picker predictable
 * across episodes / shows.
 *
 * @param {Array<{ lang: string, candidates: SubtitleCandidate[] }>} groups
 * @returns {Array<{ lang: string, candidates: SubtitleCandidate[] }>}
 */
export function sortLanguageGroups(groups) {
  return [...groups].sort((a, b) => {
    if (a.lang === 'eng' && b.lang !== 'eng') return -1;
    if (b.lang === 'eng' && a.lang !== 'eng') return 1;
    return languageLabel(a.lang).localeCompare(languageLabel(b.lang));
  });
}

function readSearchCache(key) {
  try {
    const raw = localStorage.getItem(SEARCH_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > SEARCH_CACHE_TTL_MS) return null;
    return Array.isArray(parsed.list) ? parsed.list : null;
  } catch {
    return null;
  }
}

function writeSearchCache(key, list) {
  try {
    localStorage.setItem(SEARCH_CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), list }));
  } catch {
    // Quota exceeded / private mode — the next visit just re-searches.
  }
}

export const __testing = { SEARCH_BASE, SEARCH_CACHE_PREFIX, SEARCH_CACHE_TTL_MS };
