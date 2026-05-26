/**
 * Episode descriptions and stills, sourced from the TVMaze API.
 *
 * For each show we make one network call: `GET /shows/<id>/episodes`.
 * The response is keyed by `(season, episode)`, which lines up 1:1
 * with the IA-derived catalog. Results are cached per-show in
 * localStorage for ~30 days because back catalogs don't move.
 *
 * Failure modes are swallowed: if TVMaze is offline or returns
 * garbage, callers get an empty Map and the player falls back to the
 * archive.org thumbnails and the canned subtitle. Descriptions are a
 * nice-to-have, never a hard dependency.
 */

const CACHE_PREFIX = 'heyming.watch.tvmaze.';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} EpisodeInfo
 * @property {string} summary       Plain-text, tags stripped.
 * @property {string|null} image    Medium-sized landscape still (~250 wide).
 * @property {string|null} imageHd  Original high-res still.
 * @property {string|null} airdate  ISO date string ("1989-12-17") or null.
 * @property {string|null} name     TVMaze title — useful as a fallback.
 */

/**
 * Fetch (or return cached) episode info for a show, keyed by "SxxEyy".
 *
 * @param {number} tvmazeId
 * @returns {Promise<Map<string, EpisodeInfo>>}
 */
export async function loadDescriptions(tvmazeId) {
  if (!Number.isFinite(tvmazeId)) return new Map();
  const cached = readCache(tvmazeId);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/episodes`, {
      credentials: 'omit'
    });
    if (!res.ok) return new Map();
    const data = await res.json();
    if (!Array.isArray(data)) return new Map();
    const map = buildMap(data);
    writeCache(tvmazeId, map);
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Build a `SxxEyy -> EpisodeInfo` map. Exposed for tests / debugging.
 *
 * @param {Array<Record<string, unknown>>} episodes
 * @returns {Map<string, EpisodeInfo>}
 */
export function buildMap(episodes) {
  /** @type {Map<string, EpisodeInfo>} */
  const map = new Map();
  for (const raw of episodes) {
    if (typeof raw !== 'object' || raw === null) continue;
    const season = Number(raw.season);
    const number = Number(raw.number);
    if (!Number.isFinite(season) || !Number.isFinite(number)) continue;
    const img = isImageObject(raw.image) ? raw.image : null;
    map.set(makeKey(season, number), {
      summary: plainText(typeof raw.summary === 'string' ? raw.summary : ''),
      image: (img && typeof img.medium === 'string' && img.medium) || null,
      imageHd: (img && typeof img.original === 'string' && img.original) || null,
      airdate: typeof raw.airdate === 'string' && raw.airdate ? raw.airdate : null,
      name: typeof raw.name === 'string' && raw.name ? raw.name : null
    });
  }
  return map;
}

/** @param {number} season @param {number} episode */
export function makeKey(season, episode) {
  return `S${pad(season)}E${pad(episode)}`;
}

/** Strip every HTML tag, collapse whitespace. TVMaze wraps in `<p>`. */
function plainText(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function isImageObject(v) {
  return typeof v === 'object' && v !== null;
}

function readCache(tvmazeId) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + tvmazeId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.entries)) return null;
    return new Map(parsed.entries);
  } catch {
    return null;
  }
}

function writeCache(tvmazeId, map) {
  try {
    localStorage.setItem(
      CACHE_PREFIX + tvmazeId,
      JSON.stringify({ ts: Date.now(), entries: Array.from(map.entries()) })
    );
  } catch {
    // Quota exceeded or private-mode storage; the next visit just refetches.
  }
}

export const __testing = { CACHE_PREFIX, CACHE_TTL_MS };
