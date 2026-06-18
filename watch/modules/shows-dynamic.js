/**
 * Dynamic show discovery (experimental, not wired into the runtime yet).
 *
 * Given a free-text query ("simpsons", "the tick"), try to assemble a
 * ShowConfig on the fly by pairing two external services:
 *
 *   1. TVMaze — `/singlesearch/shows?q=<query>&embed=episodes` gives us
 *      the canonical episode list, poster, IMDB id, premiere date,
 *      genres. This is the "what does this show look like" half.
 *
 *   2. Internet Archive — `/advancedsearch.php` finds candidate IA
 *      items, then `/metadata/<id>` returns each item's file list and
 *      access flags. This is the "where do we play it from" half.
 *
 * Given both, the pure logic in this file picks the best candidate and
 * tries to map IA filenames to TVMaze episodes using a small menu of
 * extractor strategies (SxxExx, NxNN, title-substring). Whichever
 * strategy covers the most episodes wins.
 *
 * This module is parallel to the sheet-backed registry: the discovery
 * path knows nothing about the curated entries in the sheet. The
 * idea is that if the dynamic path can independently rediscover the
 * curated subjects' iaItem + season/episode mapping for a meaningful
 * fraction of the registry, then the curated registry can shrink to
 * just the long tail and editorial flavor (emoji, accent, tagline).
 *
 * Known weak points:
 *   - Multi-segment shows (Spider-Man A/B halves) collapse to one
 *     episode entry per `SxxExx` match.
 *   - Compilation rips with one giant MP4 score as `episode_count_mismatch`.
 *   - Per-uploader filename quirks the strategy menu doesn't know about
 *     (Histeria's `D11` numbering, Beavis S8's `.ia.mp4` extension)
 *     fall through to "no playable upload" instead of helping.
 *
 * Public surface:
 *   - {@link discoverShow}      orchestrator (async, hits live APIs)
 *   - {@link buildParser}       pure matcher (testable without fetch)
 *   - {@link scoreCandidate}    pure IA-item gate (testable without fetch)
 *   - {@link synthesizeShowConfig} ShowConfig assembler (pure)
 */

/**
 * @typedef {object} TvmazeEpisode
 * @property {number} season
 * @property {number} number       TVMaze's episode field is `number`, not `episode`.
 * @property {string} name
 * @property {string} [airdate]
 */

/**
 * @typedef {object} TvmazeShow
 * @property {number} id
 * @property {string} name
 * @property {string} [premiered]  ISO date, "YYYY-MM-DD".
 * @property {{ medium?: string, original?: string } | null} [image]
 * @property {{ imdb?: string | null } | null} [externals]
 * @property {string[]} [genres]
 * @property {string} [summary]   HTML.
 * @property {TvmazeEpisode[]} episodes
 */

/** @typedef {{ name: string, format?: string, size?: string }} IaFile */

/** @typedef {{ identifier: string, title: string, downloads?: number }} IaCandidate */

/**
 * @typedef {object} IaMetadata
 * @property {Record<string, unknown>} metadata
 * @property {IaFile[]} files
 */

/**
 * @typedef {object} CandidateScore
 * @property {boolean} usable
 * @property {number} mp4Count
 * @property {boolean} accessRestricted
 * @property {string} [reason]    Set when `usable === false`.
 */

/**
 * @typedef {object} EpisodeMapping
 * @property {string} filename    Basename.
 * @property {number} season
 * @property {number} episode
 * @property {string} title
 */

/**
 * @typedef {object} ParserResult
 * @property {string} strategy    Name of the extractor that produced this mapping.
 * @property {number} coverage    0..1; matched files / TVMaze episode count.
 * @property {Map<string, EpisodeMapping>} byFilename
 * @property {(filename: string) => ({ season: number, episode: number, title: string } | null)} parse
 */

/**
 * @typedef {object} DiscoveryFetchers
 * @property {(query: string) => Promise<TvmazeShow | null>} tvmazeSearch
 * @property {(name: string, year: number | null) => Promise<IaCandidate[]>} iaSearch
 * @property {(identifier: string) => Promise<IaMetadata | null>} iaMetadata
 */

/**
 * @typedef {object} DiscoveryResult
 * @property {boolean} ok
 * @property {string} [reason]               Set when `ok === false`.
 * @property {TvmazeShow} [tvmaze]
 * @property {IaCandidate} [iaCandidate]
 * @property {IaFile[]} [iaFiles]            File list from the winning candidate.
 *                                           Useful for debugging and for the
 *                                           calibration script.
 * @property {CandidateScore} [score]
 * @property {{ strategy: string, coverage: number }} [parser]
 * @property {import('./shows.js').ShowConfig & { _dynamic: { strategy: string, coverage: number } }} [show]
 */

// Coverage threshold below which we treat a strategy as "didn't work."
// Tuned loose for now: half the episodes is enough signal that we
// picked the right item, the rest can be edge-case fallbacks.
const MIN_COVERAGE = 0.5;

// Sanity bounds on (file count / episode count) when filtering candidate
// items. Below 0.1 we're probably looking at a compilation rip; above 5
// we're probably looking at a giant "every uploaded clip" dump.
const FILE_RATIO_MIN = 0.1;
const FILE_RATIO_MAX = 5;

// =========================================================================
// Pure logic — filename matchers
// =========================================================================

/**
 * Default strategy menu used by {@link buildParser} and
 * {@link makeGenericParser}. Order matters — earlier entries win
 * coverage ties. `title` is deliberately excluded: the parser-only
 * calibration (`scripts/calibrate-matcher.mjs`) showed it
 * confidently mismaps when IA filenames use a different episode
 * ordering than TVMaze (DBZ: 100% wrong, Smurfs/Recess: 50%+
 * wrong, etc.). It remains exported below for the discovery path,
 * which has fewer signals to work with and can add it back as a
 * last-resort fallback once cross-validation is in place.
 */
const STRATEGIES = [
  { name: 'sxxexx', match: matchSxxExx },
  { name: 'nxnn', match: matchNxNN },
  { name: 'season_episode', match: matchSeasonEpisode }
];

// Shared "Season N Episode NN" pattern. Tight — both words must
// appear with whitespace between them and the digits — so it
// won't fire on e.g. "Episode 5 of Season 1: ...". This is the
// verbose form used by some IA uploaders (notably the Billy
// Shultz Star Trek: The Next Generation dump) where the compact
// SxxExx token never appears in any filename.
const SEASON_EPISODE_REGEX = /Season\s+(\d{1,2})\s+Episode\s+(\d{1,3})/i;

/** Exposed so discovery / experimentation can opt back in deliberately. */
export const TITLE_STRATEGY = { name: 'title', match: matchTitleSubstring };

/**
 * Pick the highest-coverage strategy for mapping IA filenames to TVMaze
 * episodes. Returns null if no strategy clears {@link MIN_COVERAGE}.
 *
 * @param {TvmazeEpisode[]} tvmazeEpisodes
 * @param {IaFile[]} iaFiles
 * @returns {ParserResult | null}
 */
export function buildParser(tvmazeEpisodes, iaFiles) {
  if (!Array.isArray(tvmazeEpisodes) || tvmazeEpisodes.length === 0) return null;
  const playable = (iaFiles ?? []).filter(isPlayableMp4);
  if (playable.length === 0) return null;

  const scored = STRATEGIES.map(({ name, match }) => ({
    strategy: name,
    ...match(tvmazeEpisodes, playable)
  }));

  // Strong preference: when SxxExx fires on enough files, trust it
  // unconditionally. The uploader who put `S01E03` in the filename
  // saw the episode in broadcast context; title-substring matching
  // trusts TVMaze's separate (and sometimes airing-vs-DVD-order)
  // numbering and silently mismaps when they disagree. Without this
  // override, Recess + Smurfs both pick `title` and play the wrong
  // episode.
  const sxxexxResult = scored.find((r) => r.strategy === 'sxxexx');
  const best =
    sxxexxResult && sxxexxResult.coverage >= MIN_COVERAGE
      ? sxxexxResult
      : scored.reduce(
          (acc, cur) => (acc == null || cur.coverage > acc.coverage ? cur : acc),
          /** @type {typeof scored[number] | null} */ (null)
        );

  if (!best || best.coverage < MIN_COVERAGE) return null;

  const byFilename = best.byFilename;
  return {
    strategy: best.strategy,
    coverage: best.coverage,
    byFilename,
    parse(filename) {
      const hit = byFilename.get(basename(filename));
      return hit ? { season: hit.season, episode: hit.episode, title: hit.title } : null;
    }
  };
}

/**
 * Per-file parser intended for the catalog builder. Unlike
 * {@link buildParser} (which scans all files to pick a strategy),
 * this returns a parser that works one filename at a time, validating
 * each extraction against the descriptions map that the catalog
 * builder already has on hand. Tries SxxExx, then NxNN.
 *
 * Format compatibility: the `descriptions` map key format must match
 * `descriptions.js#makeKey` — `S{season:02}E{episode:02}`. This is
 * deliberately inlined (not imported from descriptions.js) to keep
 * this module independent of the rest of the watch graph.
 *
 * Degraded mode: if `descriptions` is empty (TVMaze unreachable, cold
 * cache miss), the parser accepts SxxExx / NxNN extractions
 * unvalidated. The catalog still builds; titles will be empty until
 * the next visit when TVMaze comes back online and `mergeDescriptions`
 * fills them in.
 *
 * @param {Map<string, { name?: string | null }> | null | undefined} descriptions
 * @returns {(filename: string) => ({ season: number, episode: number, title: string } | null)}
 */
export function makeGenericParser(descriptions) {
  const hasDescriptions = !!(descriptions && descriptions.size > 0);
  return (filename) => {
    const base = basename(filename);
    const sxx = base.match(/[Ss](\d{1,2})[Ee](\d{1,3})/);
    if (sxx) {
      const hit = resolveEpisode(descriptions, hasDescriptions, Number(sxx[1]), Number(sxx[2]));
      if (hit) return hit;
    }
    const nxx = base.match(/\b(\d{1,2})x(\d{1,3})\b/);
    if (nxx) {
      const hit = resolveEpisode(descriptions, hasDescriptions, Number(nxx[1]), Number(nxx[2]));
      if (hit) return hit;
    }
    const sep = base.match(SEASON_EPISODE_REGEX);
    if (sep) {
      const hit = resolveEpisode(descriptions, hasDescriptions, Number(sep[1]), Number(sep[2]));
      if (hit) return hit;
    }
    return null;
  };
}

function resolveEpisode(descriptions, hasDescriptions, season, episode) {
  if (hasDescriptions) {
    const info = descriptions.get(descriptionsKey(season, episode));
    if (info) return { season, episode, title: info.name ?? '' };
    return null;
  }
  return { season, episode, title: '' };
}

function descriptionsKey(season, episode) {
  return `S${pad2(season)}E${pad2(episode)}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Match `S01E02` / `s1e2` substrings against TVMaze (season, number). */
function matchSxxExx(episodes, files) {
  const byFilename = new Map();
  const lookup = indexEpisodesBy(episodes, (ep) => `S${ep.season}E${ep.number}`);
  for (const file of files) {
    const m = basename(file.name).match(/[Ss](\d{1,2})[Ee](\d{1,3})/);
    if (!m) continue;
    const ep = lookup.get(`S${Number(m[1])}E${Number(m[2])}`);
    if (!ep) continue;
    setMapping(byFilename, file, ep);
  }
  return { byFilename, coverage: coverage(byFilename.size, files.length) };
}

/** Match `1x02` / `12x103` style substrings. */
function matchNxNN(episodes, files) {
  const byFilename = new Map();
  const lookup = indexEpisodesBy(episodes, (ep) => `${ep.season}x${ep.number}`);
  for (const file of files) {
    const m = basename(file.name).match(/\b(\d{1,2})x(\d{1,3})\b/);
    if (!m) continue;
    const ep = lookup.get(`${Number(m[1])}x${Number(m[2])}`);
    if (!ep) continue;
    setMapping(byFilename, file, ep);
  }
  return { byFilename, coverage: coverage(byFilename.size, files.length) };
}

/** Match `Season N Episode NN` substrings. */
function matchSeasonEpisode(episodes, files) {
  const byFilename = new Map();
  const lookup = indexEpisodesBy(episodes, (ep) => `S${ep.season}E${ep.number}`);
  for (const file of files) {
    const m = basename(file.name).match(SEASON_EPISODE_REGEX);
    if (!m) continue;
    const ep = lookup.get(`S${Number(m[1])}E${Number(m[2])}`);
    if (!ep) continue;
    setMapping(byFilename, file, ep);
  }
  return { byFilename, coverage: coverage(byFilename.size, files.length) };
}

/**
 * Match each filename to the episode whose normalized title appears as
 * a substring of the normalized filename. Greedy — longer titles win,
 * so "Pilot Part 1" beats a bare "Pilot" when both could fit.
 */
function matchTitleSubstring(episodes, files) {
  const byFilename = new Map();
  const normEpisodes = episodes
    .map((ep) => ({ ep, normTitle: normalizeForMatch(ep.name ?? '') }))
    .filter((entry) => entry.normTitle.length >= 4)
    .sort((a, b) => b.normTitle.length - a.normTitle.length);

  for (const file of files) {
    const stem = basename(file.name).replace(/\.[a-z0-9]+$/i, '');
    const normFile = normalizeForMatch(stem);
    for (const { ep, normTitle } of normEpisodes) {
      if (normFile.includes(normTitle)) {
        setMapping(byFilename, file, ep);
        break;
      }
    }
  }
  return { byFilename, coverage: coverage(byFilename.size, files.length) };
}

/**
 * Coverage = fraction of input files the strategy mapped. Bounded
 * `[0, 1]`. Using files (not episodes) as the denominator means a
 * 500-clip junk dump where only 22 files match scores low (22/500),
 * which is what we want for the score gate. The previous metric
 * (matched / episode count) could exceed 1.0 when IA had more files
 * than TVMaze had episodes, which let the title strategy win
 * tiebreaks against SxxExx for shows with airing-order/DVD-order
 * mismatches (Recess, Smurfs).
 */
function coverage(matched, total) {
  return total > 0 ? matched / total : 0;
}

/**
 * @param {TvmazeEpisode[]} episodes
 * @param {(ep: TvmazeEpisode) => string} key
 */
function indexEpisodesBy(episodes, key) {
  const out = new Map();
  for (const ep of episodes) {
    if (!Number.isFinite(ep?.season) || !Number.isFinite(ep?.number)) continue;
    out.set(key(ep), ep);
  }
  return out;
}

/**
 * @param {Map<string, EpisodeMapping>} byFilename
 * @param {IaFile} file
 * @param {TvmazeEpisode} ep
 */
function setMapping(byFilename, file, ep) {
  const base = basename(file.name);
  byFilename.set(base, {
    filename: base,
    season: ep.season,
    episode: ep.number,
    title: ep.name ?? ''
  });
}

function normalizeForMatch(s) {
  // Apostrophes get stripped (not spaced) so "Homer's" matches IA's "Homers".
  // Everything else non-alphanumeric becomes whitespace so "Spider-Man" and
  // "Spider Man" both normalize the same.
  return String(s)
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function basename(p) {
  const s = String(p ?? '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

function isPlayableMp4(file) {
  const name = file?.name;
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  if (!lower.endsWith('.mp4')) return false;
  if (lower.endsWith('.ia.mp4')) return false;
  if (lower.includes('thumb') || lower.includes('trailer')) return false;
  return true;
}

// =========================================================================
// Pure logic — IA item scoring
// =========================================================================

/**
 * Decide whether an IA item is even worth running the matcher against.
 * Cheap checks only — we want to reject obvious non-starters (access
 * restricted, no MP4s, single-file compilation) before doing the
 * relatively expensive filename matching.
 *
 * @param {IaMetadata | null | undefined} metadata
 * @param {TvmazeEpisode[]} tvmazeEpisodes
 * @returns {CandidateScore}
 */
export function scoreCandidate(metadata, tvmazeEpisodes) {
  const meta = metadata?.metadata ?? {};
  const files = metadata?.files ?? [];

  const access = meta['access-restricted-item'];
  if (access === true || access === 'true') {
    return { usable: false, mp4Count: 0, accessRestricted: true, reason: 'access_restricted' };
  }

  const mp4s = files.filter(isPlayableMp4);
  if (mp4s.length === 0) {
    return { usable: false, mp4Count: 0, accessRestricted: false, reason: 'no_mp4s' };
  }

  if (Array.isArray(tvmazeEpisodes) && tvmazeEpisodes.length >= 5) {
    const ratio = mp4s.length / tvmazeEpisodes.length;
    if (ratio < FILE_RATIO_MIN || ratio > FILE_RATIO_MAX) {
      return {
        usable: false,
        mp4Count: mp4s.length,
        accessRestricted: false,
        reason: 'episode_count_mismatch'
      };
    }
  }

  return { usable: true, mp4Count: mp4s.length, accessRestricted: false };
}

// =========================================================================
// Pure logic — ShowConfig synthesis
// =========================================================================

/**
 * Assemble a `ShowConfig`-shaped object from the dynamic discovery
 * pieces. The `_dynamic` field is a debug marker so consumers can tell
 * curated entries apart from auto-discovered ones (and so the UI can
 * paint an "auto-discovered, episode metadata may be incomplete" badge
 * if we ever surface this).
 *
 * @param {object} args
 * @param {TvmazeShow} args.tvmaze
 * @param {string} args.iaItem
 * @param {ParserResult} args.parser
 */
export function synthesizeShowConfig({ tvmaze, iaItem, parser }) {
  const summary = stripHtml(tvmaze.summary ?? '').slice(0, 200);
  const accept = (file) => isPlayableMp4(file);

  return {
    id: slugify(tvmaze.name),
    name: tvmaze.name,
    shortName: tvmaze.name,
    emoji: '📺',
    accent: 'rgba(150, 150, 170, 0.45)',
    tags: deriveTags(tvmaze),
    tagline: summary,
    iaItem,
    tvmazeId: tvmaze.id,
    imdbId: tvmaze.externals?.imdb ?? undefined,
    acceptFile: accept,
    parser: parser.parse,
    _dynamic: { strategy: parser.strategy, coverage: parser.coverage }
  };
}

function deriveTags(tvmaze) {
  /** @type {string[]} */
  const tags = [];
  const era = eraFromYear(yearFromPremiered(tvmaze.premiered));
  if (era) tags.push(era);

  const genres = Array.isArray(tvmaze.genres) ? tvmaze.genres : [];
  if (genres.includes('Animation')) tags.push('animation');
  else tags.push('live-action');
  if (genres.includes('Comedy')) tags.push('comedy');
  if (genres.includes('Action')) tags.push('action');
  if (genres.includes('Science-Fiction')) tags.push('sci-fi');
  if (genres.includes('Anime')) tags.push('anime');
  return tags;
}

function yearFromPremiered(premiered) {
  if (typeof premiered !== 'string') return null;
  const m = premiered.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

function eraFromYear(year) {
  if (!Number.isFinite(year)) return null;
  if (year < 1970) return '60s';
  if (year < 1980) return '70s';
  if (year < 1990) return '80s';
  if (year < 2000) return '90s';
  if (year < 2010) return '2000s';
  if (year < 2020) return '2010s';
  return '2020s';
}

function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripHtml(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// =========================================================================
// Orchestrator
// =========================================================================

/**
 * High-level discovery entry point. Pass `fetchers` to swap out the
 * external API calls in tests; the default implementation hits TVMaze
 * and IA directly.
 *
 * @param {string} query
 * @param {Partial<DiscoveryFetchers>} [fetchers]
 * @returns {Promise<DiscoveryResult>}
 */
export async function discoverShow(query, fetchers) {
  const f = { ...DEFAULT_FETCHERS, ...(fetchers ?? {}) };

  const tvmaze = await f.tvmazeSearch(query);
  if (!tvmaze) return { ok: false, reason: 'tvmaze_not_found' };

  const year = yearFromPremiered(tvmaze.premiered);
  const candidates = await f.iaSearch(tvmaze.name, year);
  if (!candidates.length) return { ok: false, reason: 'no_ia_candidates', tvmaze };

  for (const candidate of candidates.slice(0, 5)) {
    const metadata = await f.iaMetadata(candidate.identifier);
    if (!metadata) continue;

    const score = scoreCandidate(metadata, tvmaze.episodes);
    if (!score.usable) continue;

    const parser = buildParser(tvmaze.episodes, metadata.files);
    if (!parser) continue;

    return {
      ok: true,
      tvmaze,
      iaCandidate: candidate,
      iaFiles: metadata.files,
      score,
      parser: { strategy: parser.strategy, coverage: parser.coverage },
      show: synthesizeShowConfig({ tvmaze, iaItem: candidate.identifier, parser })
    };
  }

  return { ok: false, reason: 'no_playable_upload', tvmaze };
}

// =========================================================================
// Live fetchers (browser default — tests inject their own)
// =========================================================================

/** @type {DiscoveryFetchers} */
const DEFAULT_FETCHERS = {
  tvmazeSearch: liveTvmazeSearch,
  iaSearch: liveIaSearch,
  iaMetadata: liveIaMetadata
};

async function liveTvmazeSearch(query) {
  if (typeof fetch !== 'function') return null;
  try {
    const url = `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(
      query
    )}&embed=episodes`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const episodes = Array.isArray(data?._embedded?.episodes) ? data._embedded.episodes : [];
    return {
      id: data.id,
      name: data.name,
      premiered: data.premiered,
      image: data.image,
      externals: data.externals,
      genres: data.genres,
      summary: data.summary,
      episodes
    };
  } catch {
    return null;
  }
}

async function liveIaSearch(name, year) {
  if (typeof fetch !== 'function') return [];
  try {
    const q = year ? `${name} ${year}` : name;
    const params = new URLSearchParams({
      q: `${q} AND mediatype:movies`,
      'fl[]': 'identifier',
      output: 'json',
      rows: '10',
      sort: 'downloads desc'
    });
    params.append('fl[]', 'title');
    params.append('fl[]', 'downloads');
    const url = `https://archive.org/advancedsearch.php?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];
    return docs.map((d) => ({
      identifier: String(d.identifier),
      title: String(d.title ?? d.identifier),
      downloads: typeof d.downloads === 'number' ? d.downloads : undefined
    }));
  } catch {
    return [];
  }
}

async function liveIaMetadata(identifier) {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return {
      metadata: data.metadata ?? {},
      files: Array.isArray(data.files) ? data.files : []
    };
  } catch {
    return null;
  }
}
