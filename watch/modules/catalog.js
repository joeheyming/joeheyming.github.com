/**
 * Generic catalog builder for the /watch/ player.
 *
 * Fetches an Internet Archive item's metadata, then turns its file
 * listing into seasons + episodes by delegating to the show's parser
 * (see `shows.js`). The output shape is identical regardless of which
 * show it came from, so the UI can stay show-agnostic.
 *
 * `getMergedCatalog(show)` is the high-level entry point: it returns
 * an in-memory cached Catalog with TVMaze descriptions + stills already
 * grafted onto each episode. Views (episodes-view, watch-view) call
 * this and don't need to know the catalog vs. descriptions split.
 *
 * The metadata endpoint sends `Access-Control-Allow-Origin: *`, so we
 * call it directly from the static site without a CORS proxy.
 */

import { loadDescriptions, makeKey as descKey } from './descriptions.js';

/** @typedef {import('./shows.js').ShowConfig} ShowConfig */
/** @typedef {import('./descriptions.js').EpisodeInfo} EpisodeInfo */

/**
 * @typedef {Object} Episode
 * @property {number} season         0 = movie / specials, else 1..N.
 * @property {number} episode
 * @property {string} title
 * @property {string} file           File name inside the archive item.
 * @property {string} url            Direct download URL.
 * @property {string} archiveUrl     archive.org details URL for the file.
 * @property {string|null} thumbUrl  Auto-sampled preview JPG, if any.
 * @property {number} sizeBytes
 * @property {number} durationSec
 * @property {number} width
 * @property {number} height
 * @property {string} [description]  TVMaze summary, grafted at load time.
 * @property {string|null} [image]   TVMaze landscape still.
 * @property {string|null} [airdate] Original airdate (ISO yyyy-mm-dd).
 */

/**
 * @typedef {Object} Season
 * @property {number} number         1..N (the movie row uses `Catalog.movie`).
 * @property {string} label
 * @property {Episode[]} episodes
 */

/**
 * @typedef {Object} Catalog
 * @property {ShowConfig} show
 * @property {Season[]} seasons
 * @property {Episode|null} movie
 * @property {number} total
 */

/**
 * In-memory cache of fully merged catalogs (catalog + descriptions),
 * keyed by show id. Survives view switches within one tab session but
 * not page refresh — the underlying TVMaze fetch is already cached in
 * localStorage for 30 days, so cold-starts are still cheap.
 *
 * @type {Map<string, Catalog>}
 */
const mergedCache = new Map();

/**
 * In-flight `getMergedCatalog` promises, so concurrent callers share
 * one fetch. Without this, a fast user clicking from the show grid
 * straight into the watch view would kick off two parallel IA fetches.
 *
 * @type {Map<string, Promise<Catalog>>}
 */
const inflight = new Map();

/**
 * Get a Catalog with TVMaze descriptions + stills already merged in.
 * Cached per session; safe to call from any view.
 *
 * @param {ShowConfig} show
 * @returns {Promise<Catalog>}
 */
export async function getMergedCatalog(show) {
  const cached = mergedCache.get(show.id);
  if (cached) return cached;
  const pending = inflight.get(show.id);
  if (pending) return pending;

  const work = (async () => {
    const [catalog, descriptions] = await Promise.all([
      loadCatalog(show),
      loadDescriptions(show.tvmazeId)
    ]);
    mergeDescriptions(catalog, descriptions);
    mergedCache.set(show.id, catalog);
    return catalog;
  })().finally(() => inflight.delete(show.id));

  inflight.set(show.id, work);
  return work;
}

/**
 * Graft TVMaze descriptions + stills onto each episode in place.
 * Exposed for tests; views should generally call `getMergedCatalog`.
 *
 * @param {Catalog} catalog
 * @param {Map<string, EpisodeInfo>} descMap
 */
export function mergeDescriptions(catalog, descMap) {
  if (!descMap || descMap.size === 0) return;
  for (const season of catalog.seasons) {
    for (const ep of season.episodes) {
      const info = descMap.get(descKey(ep.season, ep.episode));
      if (!info) continue;
      ep.description = info.summary || '';
      ep.image = info.image || null;
      ep.airdate = info.airdate || null;
      // TVMaze titles preserve `?` / `:` / etc. that filesystem-safe
      // filenames had to mangle — prefer them when present.
      if (info.name) ep.title = info.name;
    }
  }
}

/**
 * Fetch + build a catalog for a show. Lower-level than `getMergedCatalog`;
 * does not consult the in-memory cache and does not merge descriptions.
 *
 * @param {ShowConfig} show
 * @returns {Promise<Catalog>}
 */
export async function loadCatalog(show) {
  const url = `https://archive.org/metadata/${show.iaItem}`;
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Archive returned HTTP ${res.status}`);
  const data = await res.json();
  return buildCatalog(show, data);
}

/**
 * Build the in-memory catalog from a metadata JSON blob. Exposed for tests.
 *
 * @param {ShowConfig} show
 * @param {{ files?: Array<Record<string, unknown>> }} meta
 * @returns {Catalog}
 */
export function buildCatalog(show, meta) {
  const files = Array.isArray(meta?.files) ? meta.files : [];
  const thumbs = buildThumbIndex(show.iaItem, files);
  const accept = show.acceptFile || defaultAccept;

  // When a show accepts both `.mp4` and the auto-generated `.ia.mp4`
  // derivative (Beavis is the canonical example), iterate the plain
  // `.mp4` files first so they win the dedup race for any slot that
  // has both. The `.ia.mp4` derivatives are a lower-bitrate fallback
  // we only want when they're the *only* file for that episode.
  const sortedFiles = [...files].sort((a, b) => {
    const an = typeof a?.name === 'string' ? a.name : '';
    const bn = typeof b?.name === 'string' ? b.name : '';
    const aIa = /\.ia\.mp4$/i.test(an);
    const bIa = /\.ia\.mp4$/i.test(bn);
    if (aIa && !bIa) return 1;
    if (!aIa && bIa) return -1;
    return 0;
  });

  /** @type {Map<number, Season>} */
  const seasonMap = new Map();
  /** @type {Episode|null} */
  let movie = null;
  /** @type {Set<string>} keyed `S-E` to dedupe when multiple files land on the same slot. */
  const seen = new Set();

  for (const raw of sortedFiles) {
    if (typeof raw !== 'object' || raw === null) continue;
    if (!accept(raw)) continue;
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!name) continue;

    const baseProps = {
      file: name,
      url: buildDownloadUrl(show.iaItem, name),
      archiveUrl: buildDetailsUrl(show.iaItem, name),
      thumbUrl: thumbs.get(stripVideoExt(name)) || null,
      sizeBytes: toNumber(raw.size),
      durationSec: toNumber(raw.length),
      width: toNumber(raw.width),
      height: toNumber(raw.height)
    };

    if (show.movieDetector && show.movieDetector(name)) {
      if (!movie) {
        movie = {
          ...baseProps,
          season: 0,
          episode: 0,
          title: show.movieTitle || show.name
        };
      }
      continue;
    }

    const parsed = show.parser(name);
    if (!parsed) continue;
    const slot = `${parsed.season}-${parsed.episode}`;
    if (seen.has(slot)) continue;
    seen.add(slot);

    /** @type {Episode} */
    const ep = {
      ...baseProps,
      season: parsed.season,
      episode: parsed.episode,
      title: parsed.title
    };
    const season = seasonMap.get(ep.season) || {
      number: ep.season,
      label: ep.season === 0 ? 'Specials' : `Season ${ep.season}`,
      episodes: []
    };
    season.episodes.push(ep);
    seasonMap.set(ep.season, season);
  }

  const seasons = Array.from(seasonMap.values()).sort((a, b) => a.number - b.number);
  for (const season of seasons) {
    season.episodes.sort((a, b) => a.episode - b.episode);
  }

  const total = seasons.reduce((sum, s) => sum + s.episodes.length, 0) + (movie ? 1 : 0);
  return { show, seasons, movie, total };
}

/** Fallback file filter when the show doesn't override one. */
function defaultAccept(raw) {
  const name = typeof raw?.name === 'string' ? raw.name : '';
  return /\.mp4$/i.test(name) && !/\.ia\.mp4$/i.test(name);
}

/**
 * Build a map from "filename without video extension" → preview thumbnail URL.
 * IA auto-samples a handful of JPGs per video into a sibling `<id>.thumbs/`
 * directory; we pick the earliest one so the episode card shows a frame
 * close to the cold open rather than the closing credits.
 *
 * @param {string} itemId
 * @param {Array<Record<string, unknown>>} files
 */
function buildThumbIndex(itemId, files) {
  const prefix = `${itemId}.thumbs/`;
  /** @type {Map<string, { url: string, offset: number }>} */
  const best = new Map();
  for (const raw of files) {
    if (typeof raw !== 'object' || raw === null) continue;
    if (raw.format !== 'Thumbnail') continue;
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!name.startsWith(prefix)) continue;
    const m = name.match(/^(.+)_(\d{4,8})\.jpg$/i);
    if (!m) continue;
    const baseInThumbs = m[1];
    const offset = Number(m[2]);
    // Strip the "<item>.thumbs/" prefix and any video extension so the
    // lookup key matches `stripVideoExt(filename)` from the caller.
    const baseInDownload = stripVideoExt(baseInThumbs.slice(prefix.length));
    const url = buildDownloadUrl(itemId, name);
    const existing = best.get(baseInDownload);
    if (!existing || offset < existing.offset) {
      best.set(baseInDownload, { url, offset });
    }
  }
  const flat = new Map();
  for (const [key, val] of best) flat.set(key, val.url);
  return flat;
}

/** Strip every video extension we know about. */
function stripVideoExt(name) {
  return name.replace(/\.(ia\.)?mp4$|\.m4v$|\.mkv$/i, '');
}

function buildDownloadUrl(itemId, name) {
  return `https://archive.org/download/${itemId}/${encodePath(name)}`;
}

function buildDetailsUrl(itemId, name) {
  return `https://archive.org/details/${itemId}/${encodePath(name)}`;
}

/** URI-encode every path segment, keep '/' delimiters intact. */
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
