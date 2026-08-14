/**
 * Facade over the show + movie registry. Everything is sourced from
 * the `Watch` Google Sheet via {@link ../modules/sheets-loader.js} —
 * there is no in-bundle fallback for real users. The facade exists so
 * consumers (`index.js`, `quicknav.js`, `shows-view.js`) can stay
 * agnostic of where the registry lives.
 *
 * Exception: search crawlers (Googlebot, Bingbot, …) and `?preview=1`
 * get the fictional catalog from {@link ./preview-catalog.js} so OG /
 * Search Console renders don't show real show posters.
 *
 * One gviz round-trip per page load, deduped via a single in-flight
 * promise. After the first call resolves, `_data` holds the live
 * arrays and every subsequent `getShow(id)` / `getMovie(id)` is a
 * Map lookup. There is no cross-session cache: every fresh tab or
 * reload re-fetches the sheet, so an authoring edit is visible on
 * the next page load (see `sheets-loader.js` for the longer story).
 *
 * `TAG_GROUPS` and `ALL_TAGS` stay synchronously re-exported from
 * `shows.js`: those are UI configuration (tag taxonomy + chip order),
 * not data, and don't belong in the sheet.
 */

import { loadSubjects, subjectToShowConfig, subjectToMovieConfig } from './sheets-loader.js';
import { getPreviewCatalog, shouldUsePreviewCatalog } from './preview-catalog.js';

export { TAG_GROUPS, ALL_TAGS } from './shows.js';

/** @typedef {import('./shows.js').ShowConfig} ShowConfig */
/** @typedef {import('./movies.js').MovieConfig} MovieConfig */

/** @type {{ shows: ShowConfig[], movies: MovieConfig[], byId: Map<string, ShowConfig | MovieConfig> } | null} */
let _data = null;
/** @type {Promise<{ shows: ShowConfig[], movies: MovieConfig[], byId: Map<string, ShowConfig | MovieConfig> }> | null} */
let _dataPromise = null;

/**
 * Hydrate one row of the given `type` through `convert`, swallowing
 * per-row throws so a single malformed sheet row (parserKind=regex with
 * empty parserSpec, parserKind=js with no entry in parsers-js.js, bad
 * JSON in parserSpec, …) doesn't take down the whole grid. Errors are
 * logged once per row so an authoring mistake is still visible in the
 * console — but the surviving rows render normally.
 *
 * @template T
 * @param {ReadonlyArray<{ id?: string, type?: string }>} subjects
 * @param {'show' | 'movie'} typeWanted
 * @param {(s: any) => T} convert
 * @returns {T[]}
 */
function hydrateRows(subjects, typeWanted, convert) {
  /** @type {T[]} */
  const out = [];
  for (const s of subjects) {
    if (s.type !== typeWanted) continue;
    try {
      out.push(convert(s));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`data-source: skipping ${typeWanted} "${s.id || '(no id)'}": ${msg}`);
    }
  }
  return out;
}

/**
 * Single in-flight loader; subsequent callers share the same promise
 * so a fast user clicking from the home grid into a show's episodes
 * view doesn't kick off two parallel sheet fetches.
 */
async function loadAll() {
  if (_data) return _data;
  if (_dataPromise) return _dataPromise;
  _dataPromise = (async () => {
    if (shouldUsePreviewCatalog()) {
      _data = getPreviewCatalog();
      return _data;
    }
    const subjects = await loadSubjects();
    const shows = hydrateRows(subjects, 'show', subjectToShowConfig);
    const movies = hydrateRows(subjects, 'movie', subjectToMovieConfig);
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
 * Discard the in-memory snapshot so the next `getShows()` / `getMovies()`
 * re-fetches from gviz. Useful from devtools when poking at the sheet
 * without reloading the page.
 */
export function resetDataSource() {
  _data = null;
  _dataPromise = null;
}

// Eagerly kick off the registry fetch at module-import time so the
// gviz round-trip runs in parallel with the rest of the JS bundle
// being parsed and the router wiring itself up. Every entry point of
// /watch/ (router, quicknav, shows-view) imports this module
// synchronously, so importing here means the fetch starts ~200-500ms
// before any view's mount() reaches its first `await getShows()`.
// The fetch is idempotent (single in-flight promise, shared with
// subsequent callers via `_dataPromise`), so this just warms the
// in-memory snapshot — it doesn't add network load. `void` discards
// the promise rejection in the rare case of a startup-time network
// failure; the next `getShows()` caller will see a fresh attempt
// because `_data` and `_dataPromise` are both null after a rejection,
// and the surfacing error path stays unchanged.
void loadAll().catch(() => {
  // Reset so a later call retries instead of returning the rejected
  // promise. The next getShows()/getMovies() will start fresh.
  _dataPromise = null;
});

/**
 * Internals exposed for unit tests. Not part of the module's public
 * contract — anything reaching for these from production code should
 * import the dedicated facade method instead.
 */
export const __testing = { hydrateRows, shouldUsePreviewCatalog };

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
