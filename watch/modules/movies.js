/**
 * Movie-side type definitions.
 *
 * As of the move to a Google-Sheet-backed registry (see
 * `sheets-loader.js` + `data-source.js`), the actual list of movies
 * and their per-movie metadata lives in the sheet's `subjects` tab
 * (rows with `type === 'movie'`). This module keeps only:
 *
 *   - The {@link MovieConfig} typedef, which both the sheet loader
 *     (via `subjectToMovieConfig`) and the runtime callers refer to
 *     via `@typedef {import('./movies.js').MovieConfig} MovieConfig`.
 *   - Re-exports of {@link TAG_GROUPS} and {@link ALL_TAGS} from
 *     `shows.js` so consumers that want "every tag a registry entry
 *     could carry" can ignore the shows-vs-movies split.
 *
 * Why a separate `MovieConfig` instead of a `kind: 'movie'` flavour
 * on `ShowConfig`:
 *
 *   - A movie has no parser, no seasons, no TVMaze episode list, and
 *     no Prev/Next/Shuffle semantics. Folding those absences into
 *     `ShowConfig` would mean "field X is required for shows but
 *     forbidden for movies" qualifiers on most fields.
 *   - Slug-collision is impossible by construction when the lookup
 *     paths split (`getShow` / `getMovie` in `data-source.js`).
 *   - The router gets two URL shapes (`?show=` vs `?movie=`) instead
 *     of one polymorphic one, which reads more honestly in the URL
 *     bar and in share links.
 */

export { ALL_TAGS, TAG_GROUPS } from './shows.js';

/**
 * Runtime shape of a movie in the catalog. Produced by the sheet
 * loader (`subjectToMovieConfig`) from a `subjects` row whose
 * `type` column is `'movie'`. Consumers branch movie behaviour off
 * `subject.kind === 'movie'`; the discriminator is stamped by the
 * loader so callers never have to set it themselves.
 *
 * @typedef {Object} MovieConfig
 * @property {'movie'} kind
 *   Discriminator. Always the literal string `'movie'`. Stamped by
 *   `subjectToMovieConfig` so consumers (the watch view, the catalog
 *   builder, ui.js, etc.) can branch movie behaviour off the shared
 *   `CatalogSubject = ShowConfig | MovieConfig` type. `ShowConfig`
 *   leaves `kind` unset, so the check is unambiguous.
 * @property {string} id              Slug used in the `?movie=ID` URL + storage keys.
 *                                    Must not collide with any show id.
 * @property {string} name            Full display title ("Spirited Away (2001)").
 * @property {string} shortName       Compact label for poster captions.
 * @property {string} emoji
 * @property {string} accent          `#RRGGBB` for the poster gradient + player accent.
 * @property {string[]} tags
 *   Category tags from {@link TAG_GROUPS}. Powers the shared
 *   landing-page chip filter. Must include exactly one format tag
 *   and exactly one era tag; audience + genre tags are optional.
 * @property {string} tagline         One-line description for the poster card.
 * @property {string} iaItem          archive.org item identifier (single — movies
 *                                    don't get split across uploads the way some
 *                                    multi-season shows do).
 * @property {string} [iaFile]
 *   Exact basename (NOT full path) of the file inside the item to play.
 *   Optional — when omitted the first `.mp4` the `acceptFile` filter
 *   accepts wins. Use it when the item contains bonus material that
 *   would otherwise be picked up (trailers, behind-the-scenes, etc.).
 * @property {number} [tvmazeId]
 *   Optional — drives poster lookup if present. Most movies aren't
 *   in TVMaze (TVMaze is series-only), so this is rarely set; the
 *   poster instead comes from `posterUrl` (preferred) or falls back
 *   to the emoji + accent gradient.
 * @property {string} [posterUrl]
 *   Optional — fully-qualified `https://` URL to a poster image.
 *   Wikipedia's commons URLs work directly; the rendering layer
 *   passes the value through to `<img src>` as-is.
 * @property {string} [imdbId]        IMDb id (with "tt" prefix) used by the
 *                                    Stremio OpenSubtitles addon to find
 *                                    subtitles. Omit to disable CC for the movie.
 * @property {(file: { name?: unknown, format?: unknown }) => boolean} [acceptFile]
 *   Filter applied to each raw IA file before picking the playable
 *   one. Defaults to "plain `.mp4`, skip `.ia.mp4`"; the sheet's
 *   `acceptFile` column enum (`''` | `'any-mp4'` | `'ia-mp4-only'`)
 *   covers the handful of movies whose item dumps shape differently.
 */
