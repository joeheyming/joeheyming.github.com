/**
 * Facade over the show + movie registry. Everything is sourced from
 * the `Watch` Google Sheet via {@link ../modules/sheets-loader.js} —
 * there is no in-bundle fallback. The facade exists so consumers
 * (`index.js`, `quicknav.js`, `shows-view.js`) can stay agnostic of
 * where the registry lives; swapping the sheet for a static JSON
 * snapshot or a different backend would touch only this file.
 *
 * One gviz round-trip on cold start, served from localStorage with a
 * 6h TTL thereafter (see `sheets-loader.js`). After the first call
 * resolves, `_data` holds the live arrays and every subsequent
 * `getShow(id)` / `getMovie(id)` is a Map lookup.
 *
 * `TAG_GROUPS` and `ALL_TAGS` stay synchronously re-exported from
 * `shows.js`: those are UI configuration (tag taxonomy + chip order),
 * not data, and don't belong in the sheet.
 */

import { loadSubjects, subjectToShowConfig, subjectToMovieConfig } from './sheets-loader.js';

export { TAG_GROUPS, ALL_TAGS } from './shows.js';

/** @typedef {import('./shows.js').ShowConfig} ShowConfig */
/** @typedef {import('./movies.js').MovieConfig} MovieConfig */

/** @type {{ shows: ShowConfig[], movies: MovieConfig[], byId: Map<string, ShowConfig | MovieConfig> } | null} */
let _data = null;
/** @type {Promise<{ shows: ShowConfig[], movies: MovieConfig[], byId: Map<string, ShowConfig | MovieConfig> }> | null} */
let _dataPromise = null;

/**
 * Single in-flight loader; subsequent callers share the same promise
 * so a fast user clicking from the home grid into a show's episodes
 * view doesn't kick off two parallel sheet fetches.
 */
async function loadAll() {
  if (_data) return _data;
  if (_dataPromise) return _dataPromise;
  _dataPromise = (async () => {
    const subjects = await loadSubjects();
    const shows = subjects
      .filter((s) => s.type === 'show')
      .map((s) => /** @type {ShowConfig} */ (subjectToShowConfig(s)));
    const movies = subjects
      .filter((s) => s.type === 'movie')
      .map((s) => /** @type {MovieConfig} */ (subjectToMovieConfig(s)));
    /** @type {Map<string, ShowConfig | MovieConfig>} */
    const byId = new Map();
    for (const s of shows) byId.set(s.id, s);
    for (const m of movies) byId.set(m.id, m);
    _data = { shows, movies, byId };
    return _data;
  })();
  return _dataPromise;
}

/**
 * Force-discard the cached data. Useful from devtools when the sheet
 * was just edited and you don't want to wait out the 6h TTL on the
 * downstream localStorage cache too — call `sheets-loader.clearCache()`
 * first, then this.
 */
export function resetDataSource() {
  _data = null;
  _dataPromise = null;
}

/** @returns {Promise<ShowConfig[]>} */
export async function getShows() {
  return (await loadAll()).shows;
}

/** @returns {Promise<MovieConfig[]>} */
export async function getMovies() {
  return (await loadAll()).movies;
}

/**
 * Look up a single show by id. Returns `null` for unknown ids; movies
 * are filtered out so a movie id won't accidentally satisfy a "find
 * the show" lookup (the two registries are id-disjoint by convention
 * but the check is cheap insurance).
 *
 * @param {string} id
 * @returns {Promise<ShowConfig | null>}
 */
export async function getShow(id) {
  const data = await loadAll();
  const x = data.byId.get(id);
  if (!x) return null;
  // MovieConfig is the only registry shape that carries a `kind`
  // property; ShowConfig leaves it undefined.
  return /** @type {any} */ (x).kind ? null : /** @type {ShowConfig} */ (x);
}

/**
 * Look up a single movie by id. Returns `null` for unknown ids and
 * for show ids (see {@link getShow} for the mirror behaviour).
 *
 * @param {string} id
 * @returns {Promise<MovieConfig | null>}
 */
export async function getMovie(id) {
  const data = await loadAll();
  const x = data.byId.get(id);
  if (!x) return null;
  return /** @type {any} */ (x).kind === 'movie' ? /** @type {MovieConfig} */ (x) : null;
}
