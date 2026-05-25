/**
 * Catalog module for Simpleton TV.
 *
 * Fetches the Internet Archive metadata for the `doh_20240725` item
 * ("The Yellowson's Collection") and groups its MP4 episodes into
 * seasons. The MP4s are H.264 video + AAC stereo audio (~138 MB
 * median), so they stream straight into HTML5 `<video>` with sound —
 * no sidecar, no proxy, no sync logic.
 *
 * Coverage: seasons 1–18 (337 episodes) plus the Simpsons Movie
 * (2007). The item also includes a Tracey Ullman shorts compilation
 * and a Family Guy crossover episode — both intentionally skipped
 * because they don't fit the episode-grid model.
 *
 * The metadata endpoint sends `Access-Control-Allow-Origin: *`, so we
 * can call it directly from the static site without a CORS proxy.
 */

const ARCHIVE_ITEM = 'doh_20240725';
const METADATA_URL = `https://archive.org/metadata/${ARCHIVE_ITEM}`;
const DOWNLOAD_BASE = `https://archive.org/download/${ARCHIVE_ITEM}`;
const ITEM_DETAILS_URL = `https://archive.org/details/${ARCHIVE_ITEM}`;
const THUMB_PREFIX = `${ARCHIVE_ITEM}.thumbs/`;

/**
 * @typedef {Object} Episode
 * @property {number} season         0 = movie, otherwise 1..18.
 * @property {number} episode        Episode number within the season.
 * @property {string} title          Human-readable title or "".
 * @property {string} file           File name inside the archive item.
 * @property {string} url            Direct MP4 download URL.
 * @property {string} archiveUrl     archive.org details URL for this file.
 * @property {string|null} thumbUrl  Preview JPG URL, if a thumb was found.
 * @property {number} sizeBytes
 * @property {number} durationSec
 * @property {number} width
 * @property {number} height
 * @property {string} [description]  TVMaze summary, grafted on at load time.
 * @property {string|null} [image]   TVMaze landscape still, preferred over thumbUrl.
 * @property {string|null} [airdate] Original airdate (ISO yyyy-mm-dd).
 */

/**
 * @typedef {Object} Season
 * @property {number} number         1..18 (the movie is surfaced via
 *                                    `Catalog.movie`, not as a season).
 * @property {string} label          "Season 3"
 * @property {Episode[]} episodes    Sorted by episode number.
 */

/**
 * @typedef {Object} Catalog
 * @property {Season[]} seasons      Sorted by season number.
 * @property {Episode|null} movie    The Simpsons Movie (2007), if present.
 * @property {number} total          Total number of episodes (incl. movie).
 */

/**
 * Fetch and build the season catalog. Throws on network or parse failure
 * so the entry script can render a friendly "No signal" overlay.
 *
 * @returns {Promise<Catalog>}
 */
export async function loadCatalog() {
  const res = await fetch(METADATA_URL, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Archive returned HTTP ${res.status}`);
  const data = await res.json();
  return buildCatalog(data);
}

/**
 * Build the in-memory catalog from a metadata JSON blob. Exposed for tests.
 *
 * @param {{ files?: Array<Record<string, unknown>> }} meta
 * @returns {Catalog}
 */
export function buildCatalog(meta) {
  const files = Array.isArray(meta?.files) ? meta.files : [];
  const thumbs = buildThumbIndex(files);

  /** @type {Map<number, Season>} */
  const seasonMap = new Map();
  /** @type {Episode|null} */
  let movie = null;

  for (const raw of files) {
    if (typeof raw !== 'object' || raw === null) continue;
    if (raw.format !== 'MPEG4') continue;

    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!name.toLowerCase().endsWith('.mp4')) continue;
    // archive.org auto-generates `.ia.mp4` derivatives — skip those so the
    // catalog doesn't end up with duplicate cards per episode.
    if (name.toLowerCase().endsWith('.ia.mp4')) continue;

    const baseProps = {
      file: name,
      url: buildDownloadUrl(name),
      archiveUrl: buildDetailsUrl(name),
      thumbUrl: thumbs.get(stripExt(name)) || null,
      sizeBytes: toNumber(raw.size),
      durationSec: toNumber(raw.length),
      width: toNumber(raw.width),
      height: toNumber(raw.height)
    };

    const parsed = parseEpisode(name);
    if (parsed) {
      /** @type {Episode} */
      const ep = {
        ...baseProps,
        season: parsed.season,
        episode: parsed.episode,
        title: parsed.title
      };
      const season = seasonMap.get(ep.season) || {
        number: ep.season,
        label: `Season ${ep.season}`,
        episodes: []
      };
      season.episodes.push(ep);
      seasonMap.set(ep.season, season);
      continue;
    }

    if (looksLikeMovie(name)) {
      movie = {
        ...baseProps,
        season: 0,
        episode: 0,
        title: 'The Simpsons Movie (2007)'
      };
      continue;
    }
    // Anything else (Tracey Ullman shorts compilation, Family Guy
    // crossover, D'ohtro intro) is silently dropped — none of them fit
    // the episode-grid model.
  }

  const seasons = Array.from(seasonMap.values()).sort((a, b) => a.number - b.number);
  for (const season of seasons) {
    season.episodes.sort((a, b) => a.episode - b.episode);
  }

  const total = seasons.reduce((sum, s) => sum + s.episodes.length, 0) + (movie ? 1 : 0);
  return { seasons, movie, total };
}

/**
 * Pull a season/episode tuple out of a `doh_20240725` filename.
 *
 * Main pattern: `The Simpsons S01, E01 - Title.mp4` — used for every
 * proper episode. Non-matching items (collection intro, Tracey Ullman
 * compilation, Family Guy crossover) return null and are dropped by
 * the catalog builder.
 *
 * @param {string} file
 * @returns {{ season: number, episode: number, title: string } | null}
 */
export function parseEpisode(file) {
  // "The Simpsons S01, E01 - Title.mp4" — also tolerates `S01,E01`,
  // `S01 E01`, and a missing dash before the title.
  const m = file.match(/^The\s+Simpsons\s+S(\d{1,2}),?\s*E(\d{1,2})\s*-?\s*(.*)\.mp4$/i);
  if (!m) return null;
  const season = Number(m[1]);
  const episode = Number(m[2]);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return { season, episode, title: m[3].trim() };
}

/** Movie filename uses the anti-takedown spelling "Zhe Simpsons Movie". */
function looksLikeMovie(file) {
  return /Zhe\s+Simpsons\s+Movie/i.test(file);
}

/**
 * Build a Map keyed by mp4-basename-without-extension → thumb URL.
 * Each episode has multiple thumbnails sampled at different offsets in
 * the file; we pick the earliest one so the card preview shows a frame
 * close to the cold-open.
 *
 * @param {Array<Record<string, unknown>>} files
 */
function buildThumbIndex(files) {
  /** @type {Map<string, { url: string, offset: number }>} */
  const best = new Map();
  for (const raw of files) {
    if (typeof raw !== 'object' || raw === null) continue;
    if (raw.format !== 'Thumbnail') continue;
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!name.startsWith(THUMB_PREFIX)) continue;
    const m = name.match(/^(.+)_(\d{4,8})\.jpg$/i);
    if (!m) continue;
    const baseInThumbs = m[1];
    const offset = Number(m[2]);
    const baseInDownload = baseInThumbs.slice(THUMB_PREFIX.length);
    const url = buildDownloadUrl(name);
    const existing = best.get(baseInDownload);
    if (!existing || offset < existing.offset) {
      best.set(baseInDownload, { url, offset });
    }
  }
  const flat = new Map();
  for (const [key, val] of best) flat.set(key, val.url);
  return flat;
}

/** Strip `.mp4` extension (the thumb index keys MP4-basenames). */
function stripExt(name) {
  return name.replace(/\.mp4$/i, '');
}

/** Build the direct download URL for a flat file in the archive item. */
function buildDownloadUrl(name) {
  return `${DOWNLOAD_BASE}/${encodePath(name)}`;
}

function buildDetailsUrl(name) {
  return `${ITEM_DETAILS_URL}/${encodePath(name)}`;
}

/** URI-encode every path segment but keep the '/' delimiter intact. */
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const __testing = { ARCHIVE_ITEM, METADATA_URL, DOWNLOAD_BASE, ITEM_DETAILS_URL };
