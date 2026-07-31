/**
 * Generic catalog builder for the /watch/ player.
 *
 * Fetches an Internet Archive item's metadata, then turns its file
 * listing into seasons + episodes by delegating to the show's parser
 * (synthesised from the sheet's `parserKind` / `parserSpec` columns by
 * `sheets-loader.js#subjectToShowConfig`). The output shape is
 * identical regardless of which show it came from, so the UI can
 * stay show-agnostic.
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
import { buildDownloadUrl, extractIaLocation, iaDerivativeFileName } from './playback-urls.js';
import { makeGenericParser } from './shows-dynamic.js';

/** @typedef {import('./shows.js').ShowConfig} ShowConfig */
/** @typedef {import('./movies.js').MovieConfig} MovieConfig */
/** @typedef {import('./descriptions.js').EpisodeInfo} EpisodeInfo */

/**
 * Catalogs can be backed by either a ShowConfig (multi-season series)
 * or a MovieConfig (single playable file). The `Catalog.show` field
 * carries whichever shape the caller passed in; downstream views
 * branch on `subject.kind` (movies always set it; shows leave it
 * undefined) when behavior differs (e.g. hiding Prev/Next in the
 * player for movies). The field name stays `show` for backwards
 * compatibility with the existing call sites — it's an internal
 * field, not part of any public URL.
 *
 * @typedef {ShowConfig | MovieConfig} CatalogSubject
 */

/**
 * @typedef {Object} Episode
 * @property {number} season         0 = movie / specials, else 1..N.
 * @property {number} episode
 * @property {string} title
 * @property {string} file           File name inside the archive item.
 * @property {string} url            Direct download URL.
 * @property {string} archiveUrl     archive.org details URL for the file.
 * @property {string} [iaItem]       Source IA item id (CDN fallback key).
 * @property {string[]} [urlAlternates]
 *   Softer playback URLs (e.g. `.ia.mp4` sibling) tried after `url`.
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
 * @property {CatalogSubject} show
 *   Either a ShowConfig (regular series) or a MovieConfig (standalone
 *   movie). Field name is `show` for historical reasons — see
 *   {@link CatalogSubject}.
 * @property {Season[]} seasons      Empty for standalone-movie catalogs.
 * @property {Episode|null} movie
 *   Single-file playable. For ShowConfig-backed catalogs this is the
 *   show's optional bundled movie (Simpsons Movie, GI Joe Movie etc.,
 *   driven by `movieDetector`); for MovieConfig-backed catalogs it's
 *   the only Episode and `seasons` is empty.
 * @property {number} total
 * @property {Record<string, import('./playback-urls.js').IaLocation>} [iaLocations]
 *   Per-item CDN dir/servers from IA metadata, used only as playback
 *   fallbacks (see `buildPlaybackQueue`).
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
 * Get a Catalog with TVMaze descriptions + stills already merged in
 * for a regular show. Cached per session; safe to call from any
 * view. For standalone movies use {@link getMovieCatalog} instead —
 * movies aren't keyed by TVMaze's per-episode list so the description-
 * graft step doesn't apply.
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
    // Two paths depending on whether the show ships a bespoke parser:
    //   - With parser: original parallel fetch (catalog + descriptions)
    //     — neither depends on the other.
    //   - Without parser: descriptions MUST come first so we can build
    //     the generic parser from TVMaze's episode list before walking
    //     IA's files. TVMaze localStorage cache makes warm starts free;
    //     cold starts pay the extra ~300-500ms of serial fetching.
    let catalog;
    let descriptions;
    if (show.parser) {
      [catalog, descriptions] = await Promise.all([
        loadCatalog(show),
        loadDescriptions(show.tvmazeId)
      ]);
    } else {
      descriptions = await loadDescriptions(show.tvmazeId);
      const effective = { ...show, parser: makeGenericParser(descriptions) };
      catalog = await loadCatalog(effective);
    }
    mergeDescriptions(catalog, descriptions);
    mergedCache.set(show.id, catalog);
    return catalog;
  })().finally(() => inflight.delete(show.id));

  inflight.set(show.id, work);
  return work;
}

/**
 * Get a single-file Catalog for a standalone movie. Cached per session.
 *
 * Unlike `getMergedCatalog`, this skips the TVMaze description graft
 * — movies aren't keyed by per-episode summaries the way series are,
 * and the IA item description is shown directly on the watch view's
 * summary card via the Episode's `description` field (set from the
 * IA file's `description` if present, otherwise the MovieConfig's
 * `tagline`).
 *
 * @param {MovieConfig} movie
 * @returns {Promise<Catalog>}
 */
export async function getMovieCatalog(movie) {
  const cached = mergedCache.get(movie.id);
  if (cached) return cached;
  const pending = inflight.get(movie.id);
  if (pending) return pending;

  const work = (async () => {
    const meta = await fetchItem(movie.iaItem);
    const catalog = buildMovieCatalog(movie, meta);
    mergedCache.set(movie.id, catalog);
    return catalog;
  })().finally(() => inflight.delete(movie.id));

  inflight.set(movie.id, work);
  return work;
}

/**
 * Cross-season "next episode" lookup used by the watch view's
 * end-of-episode card. Advances within a season first, then jumps to
 * the first episode of the next numbered season when the current
 * season is exhausted. Returns `null` at the very end of the catalog
 * or for season-0 entries (movies / specials don't have a meaningful
 * "next"). Unlike the player's `stepEpisode` it does NOT wrap.
 *
 * @param {Catalog} catalog
 * @param {Episode} current
 * @returns {Episode | null}
 */
export function getNextEpisode(catalog, current) {
  if (!catalog || !current) return null;
  if (current.season === 0) return null;
  const season = catalog.seasons.find((s) => s.number === current.season);
  if (!season) return null;
  const idx = season.episodes.findIndex(
    (x) => x.episode === current.episode && x.season === current.season
  );
  if (idx >= 0 && idx + 1 < season.episodes.length) {
    return season.episodes[idx + 1];
  }
  const numbered = catalog.seasons.filter((s) => s.number > 0).sort((a, b) => a.number - b.number);
  const sIdx = numbered.findIndex((s) => s.number === current.season);
  for (let i = sIdx + 1; i < numbered.length; i += 1) {
    const cand = numbered[i];
    if (cand.episodes.length > 0) return cand.episodes[0];
  }
  return null;
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
 * `show.iaItem` may be a single archive.org item id or an array of ids.
 * The multi-item form exists for shows whose seasons are split across
 * separate uploads (TMNT 1987 is the canonical example); we fetch all
 * of them in parallel, build a per-item catalog, then merge the
 * seasons into one logical channel.
 *
 * @param {ShowConfig} show
 * @returns {Promise<Catalog>}
 */
export async function loadCatalog(show) {
  const items = normalizeItems(show.iaItem);
  if (items.length === 1) {
    return buildCatalog(show, await fetchItem(items[0]), items[0]);
  }
  const catalogs = await Promise.all(
    items.map(async (id) => buildCatalog(show, await fetchItem(id), id))
  );
  return mergeCatalogs(show, catalogs);
}

async function fetchItem(itemId) {
  const res = await fetch(`https://archive.org/metadata/${itemId}`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Archive returned HTTP ${res.status} for ${itemId}`);
  return res.json();
}

/** @param {string | string[]} iaItem */
function normalizeItems(iaItem) {
  if (Array.isArray(iaItem)) return iaItem.filter((id) => typeof id === 'string' && id);
  if (typeof iaItem === 'string' && iaItem) return [iaItem];
  return [];
}

/**
 * Merge several per-item catalogs into one. Seasons with the same
 * number are concatenated and re-sorted by episode; on a duplicate
 * (season, episode) slot the first-seen entry wins, matching the
 * single-item dedup behaviour. The first non-null `movie` wins.
 * Exposed for tests.
 *
 * @param {ShowConfig} show
 * @param {Catalog[]} catalogs
 * @returns {Catalog}
 */
export function mergeCatalogs(show, catalogs) {
  /** @type {Map<number, Season>} */
  const seasonMap = new Map();
  /** @type {Episode|null} */
  let movie = null;
  /** @type {Record<string, import('./playback-urls.js').IaLocation>} */
  const iaLocations = {};
  for (const cat of catalogs) {
    if (!cat) continue;
    if (cat.iaLocations) Object.assign(iaLocations, cat.iaLocations);
    for (const season of cat.seasons) {
      const existing = seasonMap.get(season.number);
      if (existing) {
        const seen = new Set(existing.episodes.map((e) => e.episode));
        for (const ep of season.episodes) {
          if (seen.has(ep.episode)) continue;
          existing.episodes.push(ep);
          seen.add(ep.episode);
        }
      } else {
        seasonMap.set(season.number, {
          number: season.number,
          label: season.label,
          episodes: [...season.episodes]
        });
      }
    }
    if (!movie && cat.movie) movie = cat.movie;
  }
  const seasons = Array.from(seasonMap.values()).sort((a, b) => a.number - b.number);
  for (const season of seasons) {
    season.episodes.sort((a, b) => a.episode - b.episode);
  }
  const total = seasons.reduce((sum, s) => sum + s.episodes.length, 0) + (movie ? 1 : 0);
  /** @type {Catalog} */
  const out = { show, seasons, movie, total };
  if (Object.keys(iaLocations).length) out.iaLocations = iaLocations;
  return out;
}

/**
 * Build the in-memory catalog from a metadata JSON blob. Exposed for tests.
 *
 * @param {ShowConfig} show
 * @param {{ files?: Array<Record<string, unknown>> }} meta
 * @param {string} [itemId]   archive.org item id to use for URL
 *   construction (defaults to the show's `iaItem`; required when
 *   `show.iaItem` is an array of items).
 * @returns {Catalog}
 */
export function buildCatalog(show, meta, itemId) {
  const useItem = itemId || normalizeItems(show.iaItem)[0] || '';
  const files = Array.isArray(meta?.files) ? meta.files : [];
  const accept = show.acceptFile || defaultAccept;
  const fileNames = new Set(
    files.map((f) => (typeof f?.name === 'string' ? f.name : '')).filter(Boolean)
  );

  // When a show accepts both `.mp4` and the auto-generated `.ia.mp4`
  // derivative (Beavis is the canonical example), iterate the plain
  // `.mp4` files first so they win the dedup race for any slot that
  // has both. The `.ia.mp4` derivatives are a lower-bitrate fallback
  // we only want when they're the *only* file for that episode —
  // but we still record the sibling URL on `urlAlternates` for
  // playback retry when the plain file's CDN is flaky.
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
  /** @type {Map<string, Episode>} slot → episode, for attaching .ia alternates after dedup. */
  const bySlot = new Map();

  for (const raw of sortedFiles) {
    if (typeof raw !== 'object' || raw === null) continue;
    if (!accept(raw)) continue;
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!name) continue;

    const baseProps = episodeBaseProps(useItem, name, raw, fileNames);

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

    // Pass the source itemId as a second arg so multi-item shows whose
    // per-item filenames overlap (G.I. Joe S1 and S2 both use plain
    // `N. Title.mp4`) can disambiguate which season a file belongs to.
    // Single-item shows ignore the extra arg — JavaScript is happy.
    const parsed = show.parser(name, useItem);
    if (!parsed) continue;
    const slot = `${parsed.season}-${parsed.episode}`;
    if (seen.has(slot)) {
      // Later file for the same slot (usually `.ia.mp4` after plain).
      // Prefer attaching it as an alternate rather than discarding.
      const existing = bySlot.get(slot);
      if (existing && /\.ia\.mp4$/i.test(name)) {
        const alt = buildDownloadUrl(useItem, name);
        if (!existing.urlAlternates) existing.urlAlternates = [];
        if (!existing.urlAlternates.includes(alt) && alt !== existing.url) {
          existing.urlAlternates.push(alt);
        }
      }
      continue;
    }
    seen.add(slot);

    /** @type {Episode} */
    const ep = {
      ...baseProps,
      season: parsed.season,
      episode: parsed.episode,
      title: parsed.title
    };
    bySlot.set(slot, ep);
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
  /** @type {Catalog} */
  const catalog = { show, seasons, movie, total };
  const loc = extractIaLocation(/** @type {Record<string, unknown>} */ (meta));
  if (loc && useItem) catalog.iaLocations = { [useItem]: loc };
  return catalog;
}

/**
 * Shared Episode fields from an IA file row.
 *
 * @param {string} useItem
 * @param {string} name
 * @param {Record<string, unknown>} raw
 * @param {Set<string>} fileNames
 */
function episodeBaseProps(useItem, name, raw, fileNames) {
  /** @type {Record<string, unknown>} */
  const base = {
    file: name,
    url: buildDownloadUrl(useItem, name),
    archiveUrl: buildDetailsUrl(useItem, name),
    iaItem: useItem,
    sizeBytes: toNumber(raw.size),
    durationSec: toNumber(raw.length),
    width: toNumber(raw.width),
    height: toNumber(raw.height)
  };
  // Even when acceptFile rejects `.ia.mp4` (Simpsons default), record
  // the sibling URL if the item ships one — playback retry can use it.
  const deriv = iaDerivativeFileName(name);
  if (deriv && fileNames.has(deriv)) {
    base.urlAlternates = [buildDownloadUrl(useItem, deriv)];
  }
  return base;
}

/** Fallback file filter when the show doesn't override one. */
function defaultAccept(raw) {
  const name = typeof raw?.name === 'string' ? raw.name : '';
  return /\.mp4$/i.test(name) && !/\.ia\.mp4$/i.test(name);
}

/**
 * Build a single-file movie Catalog from an archive.org metadata blob.
 * Exposed for tests; runtime callers should go through
 * {@link getMovieCatalog}.
 *
 * File-selection rules, in order:
 *
 *   1. If `movie.iaFile` is set, the file whose basename matches it
 *      exactly wins. Use this for items that bundle bonus material
 *      (trailers, alternate audio, "the making of") alongside the
 *      movie.
 *   2. Otherwise, the first file passing `movie.acceptFile` (default:
 *      plain `.mp4`, not `.ia.mp4`) wins. Suitable for items dedicated
 *      to one movie.
 *
 * Returns a Catalog with `seasons: []`, `movie: <Episode>`, `total: 1`
 * on success. Returns `seasons: []`, `movie: null`, `total: 0` when
 * no file matches — the watch view treats `total === 0` as a
 * "channel off the air" failure mode, the same as a show with zero
 * parseable files.
 *
 * @param {MovieConfig} movie
 * @param {{ files?: Array<Record<string, unknown>> }} meta
 * @param {string} [itemId]   archive.org item id used for URL
 *   construction; defaults to `movie.iaItem`. Kept for symmetry with
 *   `buildCatalog`'s signature even though movies always have a
 *   single iaItem.
 * @returns {Catalog}
 */
export function buildMovieCatalog(movie, meta, itemId) {
  const useItem = itemId || movie.iaItem || '';
  const files = Array.isArray(meta?.files) ? meta.files : [];
  const accept = movie.acceptFile || defaultAccept;

  /** @type {Record<string, unknown> | null} */
  let chosen = null;
  if (movie.iaFile) {
    // Exact basename match. Bonus material sitting in subdirectories
    // (e.g. "Extras/Trailer.mp4") doesn't collide because we only
    // compare the basename — the iaFile field stays
    // path-component-free by convention.
    for (const raw of files) {
      if (typeof raw !== 'object' || raw === null) continue;
      const name = typeof raw.name === 'string' ? raw.name : '';
      if (!name) continue;
      const base = basename(name);
      if (base === movie.iaFile) {
        chosen = raw;
        break;
      }
    }
  } else {
    // No explicit pick → first accepted file wins. The .ia.mp4
    // derivative loses to its plain-.mp4 sibling via the same
    // sort-then-iterate trick the show builder uses, so an item
    // shipping both flavours selects the plain one.
    const sortedFiles = [...files].sort((a, b) => {
      const an = typeof a?.name === 'string' ? a.name : '';
      const bn = typeof b?.name === 'string' ? b.name : '';
      const aIa = /\.ia\.mp4$/i.test(an);
      const bIa = /\.ia\.mp4$/i.test(bn);
      if (aIa && !bIa) return 1;
      if (!aIa && bIa) return -1;
      return 0;
    });
    for (const raw of sortedFiles) {
      if (typeof raw !== 'object' || raw === null) continue;
      if (!accept(raw)) continue;
      chosen = raw;
      break;
    }
  }

  if (!chosen) {
    return { show: movie, seasons: [], movie: null, total: 0 };
  }

  const name = typeof chosen.name === 'string' ? chosen.name : '';
  const fileNames = new Set(
    files.map((f) => (typeof f?.name === 'string' ? f.name : '')).filter(Boolean)
  );
  const base = episodeBaseProps(useItem, name, chosen, fileNames);
  /** @type {Episode} */
  const ep = {
    ...base,
    season: 0,
    episode: 0,
    title: movie.name,
    // The IA file's own description, when present, is usually a short
    // synopsis the uploader wrote. Fall back to the registry tagline
    // so the player's summary card always has something to render.
    description: typeof chosen.description === 'string' ? chosen.description : movie.tagline || ''
  };

  /** @type {Catalog} */
  const catalog = { show: movie, seasons: [], movie: ep, total: 1 };
  const loc = extractIaLocation(/** @type {Record<string, unknown>} */ (meta));
  if (loc && useItem) catalog.iaLocations = { [useItem]: loc };
  return catalog;
}

/** Strip the directory component of a path. */
function basename(p) {
  const slash = p.lastIndexOf('/');
  return slash >= 0 ? p.slice(slash + 1) : p;
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
