/**
 * Show-side type definitions + the shared tag taxonomy used by the
 * landing-page chip filter.
 *
 * As of the move to a Google-Sheet-backed registry (see
 * `sheets-loader.js` + `data-source.js`), the actual list of shows
 * and their per-show metadata, parser specs, and IA item ids all
 * live in the sheet — not in this file. This module keeps only the
 * pieces that aren't data:
 *
 *   - The {@link ShowConfig} typedef, which both the sheet loader
 *     (when it hydrates a sheet row into a runtime config) and the
 *     catalog builder (which consumes the result) refer to via
 *     `@typedef {import('./shows.js').ShowConfig} ShowConfig`.
 *   - {@link TAG_GROUPS} and {@link ALL_TAGS}, which are UI taxonomy
 *     (ordering + grouping for the chip row) and don't belong in the
 *     sheet — adding a tag is a code change that ships fresh CSS, an
 *     emoji-palette tweak, and at least one new SEO-keyword pass.
 */

/**
 * Canonical tag taxonomy used by the landing-page chip filter. Every
 * subject row in the sheet must carry tags drawn exclusively from this
 * set; consumers (`shows-view.js` chip row, search index, share
 * widget) read the groups in the declared order so the chip rail
 * renders Format → Audience → Era → Genre.
 */
export const TAG_GROUPS = /** @type {const} */ ({
  format: ['animation', 'live-action', 'documentary'],
  audience: ['kids', 'adult'],
  era: ['20s', '30s', '40s', '50s', '60s', '70s', '80s', '90s', '2000s', '2010s', '2020s'],
  genre: [
    'action',
    'anime',
    'anthology',
    'comedy',
    'fantasy',
    'game-show',
    'satire',
    'sci-fi',
    'spy',
    'sports',
    'superhero'
  ]
});

/** Flat set of every canonical tag (~22 values). */
export const ALL_TAGS = new Set(/** @type {string[]} */ (Object.values(TAG_GROUPS).flat()));

/**
 * Runtime shape of a show in the catalog. The sheet loader produces
 * objects of this shape via `subjectToShowConfig`; the catalog builder
 * consumes them via `loadCatalog`. Most fields come straight from a
 * sheet column; `parser` and `acceptFile` are synthesised at load
 * time from the row's `parserKind` / `parserSpec` / `acceptFile`
 * columns (regex spec compiled with `parser-specs.js#compileSpec`,
 * a bespoke function looked up by id in `parsers-js.js`, or `null`
 * to fall back to the generic SxxExx matcher in `shows-dynamic.js`).
 *
 * @typedef {Object} ShowConfig
 * @property {string} id              Slug used in URLs (?show=ID) + storage keys.
 * @property {string} name            Full display name ("The Simpsons").
 * @property {string} shortName       Compact label ("Simpsons").
 * @property {string} emoji
 * @property {string} accent          Hex color used in chip/highlight gradients.
 * @property {string[]} tags
 *   Category tags from {@link TAG_GROUPS}; powers the landing-page
 *   chip filter. Must include exactly one format tag and exactly one
 *   era tag; audience + genre tags are optional and can repeat.
 * @property {string} tagline         One-line description for the show card.
 * @property {string | string[]} iaItem
 *   archive.org item identifier, or an array of identifiers for shows
 *   whose seasons are spread across separate uploads (TMNT 1987 is
 *   the canonical example). When an array, the catalog builder
 *   fetches each in parallel and merges the seasons.
 * @property {number} tvmazeId        TVMaze numeric id (for descriptions + stills).
 * @property {string} [imdbId]        IMDb id (with "tt" prefix) used by the
 *                                    Stremio OpenSubtitles addon to find
 *                                    subtitles. Omit to disable CC for the show.
 * @property {string} [posterUrl]
 *   Optional `https://` URL to a poster image. When absent the card
 *   falls back to the emoji + accent-gradient placeholder.
 * @property {(file: { name?: unknown, format?: unknown }) => boolean} [acceptFile]
 *   Filter applied to each raw IA file before parsing. Defaults to
 *   "plain `.mp4`, skip `.ia.mp4`"; the sheet's `acceptFile` column
 *   enum (`''` | `'any-mp4'` | `'ia-mp4-only'`) covers the handful of
 *   shows whose dumps shape differently.
 * @property {((filename: string, itemId: string) => ({ season: number, episode: number, title: string } | null)) | null} [parser]
 *   Filename → (season, episode, title) extractor. Synthesised from
 *   the sheet's `parserKind` column: `'regex'` compiles `parserSpec`,
 *   `'js'` looks up a bespoke parser by id in `parsers-js.js`,
 *   `'generic'` returns `null` so the catalog builder swaps in the
 *   TVMaze-driven generic matcher (`makeGenericParser` in
 *   `shows-dynamic.js`).
 */
