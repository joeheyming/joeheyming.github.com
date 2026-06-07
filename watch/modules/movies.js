/**
 * Movie registry for the /watch/ player.
 *
 * Standalone movies — distinct from `shows.js`. A movie is a single
 * playable file on archive.org, surfaced on the landing page in its
 * own "Movies" section and routed via `?movie=<id>` URLs.
 *
 * Why a separate registry and not a `kind: 'movie'` discriminant on
 * SHOWS:
 *
 *   - A movie has no parser, no seasons, no TVMaze episode list, and
 *     no Prev/Next/Shuffle semantics. Folding those absences into the
 *     ShowConfig typedef would mean "field X is required for shows
 *     but forbidden for movies" qualifiers on most fields.
 *   - Slug-collision is impossible by construction when the lookup
 *     paths split (`getShow` / `getMovie`).
 *   - The router gets two URL shapes (`?show=` vs `?movie=`) instead
 *     of one polymorphic one, which reads more honestly in the URL
 *     bar and in share links.
 *
 * To add a new movie, see the "Adding a new movie" checklist in
 * `watch/AGENTS.local.md`. The short version is:
 *
 *   1. Find an IA item whose video file is H.264/AAC MP4. Verify
 *      `access-restricted-item` is unset and the file streams 200
 *      anonymously (same checklist as shows; the byte-pump path is
 *      identical).
 *   2. Append a {@link MovieConfig} entry to {@link MOVIES} below.
 *   3. (Optional) Add an `imdbId` if you want OpenSubtitles for the
 *      movie — the Stremio addon answers movie-shaped queries when
 *      called without S/E.
 *
 * The MovieConfig tag taxonomy is shared with shows — both grids on
 * the landing page filter through the same chip row driven by the
 * `TAG_GROUPS` constant exported from `shows.js`.
 */

import { ALL_TAGS } from './shows.js';

// Re-export so consumers that want "every tag a registry entry could
// carry" can ignore the shows-vs-movies split.
export { ALL_TAGS, TAG_GROUPS } from './shows.js';

/**
 * @typedef {Object} MovieConfig
 * @property {'movie'} kind
 *   Discriminator. Always the literal string `'movie'`. Stamped
 *   automatically by the `MOVIES.map(...)` at the bottom of this
 *   file so registry authors don't have to repeat it on every entry
 *   — consumers (the watch view, the catalog builder, ui.js, etc.)
 *   rely on `subject.kind === 'movie'` to branch movie behaviour
 *   off the shared `CatalogSubject = ShowConfig | MovieConfig` type.
 *   ShowConfig never sets `kind`, so the check is unambiguous.
 * @property {string} id              Slug used in the `?movie=ID` URL + storage keys.
 *                                    Must not collide with any show id.
 * @property {string} name            Full display title ("Spirited Away (2001)").
 * @property {string} shortName       Compact label for poster captions.
 * @property {string} emoji
 * @property {string} accent          `#RRGGBB` for the poster gradient + player accent.
 * @property {string[]} tags
 *   Category tags from {@link TAG_GROUPS} in `shows.js`. Powers the
 *   shared landing-page chip filter. Must include exactly one format
 *   tag and exactly one era tag; audience + genre tags are optional.
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
 *   Optional — drives poster lookup if present. Most movies aren't in
 *   TVMaze (TVMaze is series-only), so this is rarely set; the poster
 *   instead comes from `posterUrl` (preferred) or falls back to the
 *   emoji + accent gradient.
 * @property {string} [posterUrl]
 *   Optional — fully-qualified `https://` URL to a poster image (JPEG
 *   / PNG / WebP). Used directly as the card's `<img src>`. Wikipedia's
 *   `upload.wikimedia.org` works well: it serves the article infobox
 *   image with open CORS, no key, no rate-limit hassle. Movie pages
 *   reliably ship an infobox poster; pull the URL from the page's
 *   summary endpoint and paste it in. When absent, the card falls
 *   back to the same emoji-on-gradient placeholder the show grid
 *   uses for TVMaze misses.
 * @property {string} [imdbId]
 *   IMDb id with the `tt` prefix. Enables OpenSubtitles for the movie
 *   via the Stremio addon — the addon accepts movie-shaped queries
 *   (no season/episode) when given a movie IMDb id.
 * @property {(file: { name?: unknown }) => boolean} [acceptFile]
 *   File-list filter. Defaults to "plain `.mp4`, no `.ia.mp4`".
 *   Override only when the item ships unusual containers; e.g. a
 *   movie that's only available as the auto-generated `.ia.mp4`
 *   derivative would set this to also accept `.ia.mp4` (same shape
 *   as the Beavis-S8 override in the shows registry).
 */

/**
 * @type {MovieConfig[]}
 *
 * Authored alphabetically by id, then re-sorted defensively at the
 * bottom of the file so a new entry dropped in the wrong slot still
 * ends up in the right place — both in the source-of-truth array and
 * on the landing-page Movies grid (which renders MOVIES in order).
 */
export const MOVIES = [
  {
    id: 'dougs-1st-movie',
    name: "Doug's 1st Movie (1999)",
    shortName: "Doug's 1st Movie",
    emoji: '📓',
    accent: '#22d3ee',
    tags: ['animation', 'kids', 'comedy', '90s'],
    tagline:
      'Doug and Skeeter discover Herman Melville, the Bluffington lake monster · the 1999 Disney theatrical that bridged the Nickelodeon and ABC runs',
    // UK PAL DVD rip in `dougs-1st-movie-1999-uk-dvd`. Single
    // top-level `videoplayback.mp4` (~862 MB h.264). Bigger than the
    // other movie files but still well within streaming budget for a
    // wired connection — the streaming/seek experience is fine.
    iaItem: 'dougs-1st-movie-1999-uk-dvd',
    iaFile: 'videoplayback.mp4',
    imdbId: 'tt0187819',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/c/c5/Doug%27s_1st_Movie_Poster.jpg'
  },
  {
    id: 'dexters-lab-ego-trip',
    name: "Dexter's Laboratory: Ego Trip (1999)",
    shortName: 'Ego Trip',
    emoji: '🧪',
    accent: '#22c55e',
    tags: ['animation', 'kids', 'comedy', '90s'],
    tagline:
      'Four future Dexters and one Mandark · the hour-long 1999 finale movie that aired as a Cartoon Network special',
    // Lives in the same `dexters-laboratory-the-complete-series` IA
    // upload that backs the Dexter's Lab SHOW entry. The filename
    // uses a curly apostrophe (U+2019) — keep the iaFile string
    // exact or basename match misses.
    iaItem: 'dexters-laboratory-the-complete-series',
    iaFile: 'Dexter\u2019s_Laboratory_-_Ego_Trip.mp4',
    imdbId: 'tt0293092',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/6/67/Dexter_Ego_Trip_VHS.jpg'
  },
  {
    id: 'gi-joe-the-movie',
    name: 'G.I. Joe: The Movie (1987)',
    shortName: 'G.I. Joe: The Movie',
    emoji: '🪖',
    accent: '#16a34a',
    tags: ['animation', 'kids', 'action', '80s'],
    tagline:
      'Cobra-La, Serpentor, and the origin of Sergeant Slaughter’s Renegades · the 1987 Sunbow theatrical that closed out the original animated run',
    // Ships in `gi-joe-3` (the same IA item that holds the show's
    // 1986 Sunbow S2). The 1987 movie was the final Sunbow-era
    // production before the IDW/DiC continuations; surfaced
    // separately so it gets its own poster instead of the S0 "MOV"
    // chip the show previously used.
    iaItem: 'gi-joe-3',
    iaFile: 'G.I. Joe The Movie.mp4',
    imdbId: 'tt0093066',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/e/ef/250px-GIJoeMovie1987.jpg'
  },
  {
    id: 'mlp-the-movie-1986',
    name: 'My Little Pony: The Movie (1986)',
    shortName: 'My Little Pony: The Movie',
    emoji: '🦄',
    accent: '#ec4899',
    tags: ['animation', 'kids', '80s'],
    tagline:
      'Smooze, the Witches of the Volcano of Gloom, and the Flutter Ponies · the 1986 Sunbow theatrical from the same studio that did G.I. Joe',
    // Standalone IA upload (`my-little-pony-the-movie`) — not bundled
    // with a show. Ships two MP4s of the same feature (one IA-derived
    // `.ia.mp4`, one source `.mp4`); we pick the source one because
    // it tends to be the higher-bitrate original. Sister to the
    // gi-joe-the-movie entry: same Sunbow Productions, same 1986/87
    // toy-commercial era.
    iaItem: 'my-little-pony-the-movie',
    iaFile: 'My Little Pony - The Movie.mp4',
    imdbId: 'tt0091584',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/5/57/Mylittleponymovieposter.jpg'
  },
  {
    id: 'powerpuff-girls-movie',
    name: 'The Powerpuff Girls Movie (2002)',
    shortName: 'Powerpuff Girls Movie',
    emoji: '💗',
    accent: '#f472b6',
    tags: ['animation', 'kids', 'action', '2000s'],
    tagline:
      'Sugar, spice, everything nice, and Chemical X · the 2002 Cartoon Network theatrical that retells how Blossom, Bubbles, and Buttercup were born',
    // Standalone IA upload (`the-powerpuff-girls_20210326_1611`).
    // Single ~416 MB h.264 MP4 named `FullSizeRender.mp4` — generic
    // filename, but the upload only ships the one feature so the
    // basename match is unambiguous. Sister to the Dexter's Lab
    // movie: same Cartoon Network era, same Craig McCracken-adjacent
    // creative orbit.
    iaItem: 'the-powerpuff-girls_20210326_1611',
    iaFile: 'FullSizeRender.mp4',
    imdbId: 'tt0289408',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/7/78/Powerpuff_Girls_Movie_poster.jpg'
  },
  {
    id: 'recess-schools-out',
    name: "Recess: School's Out (2001)",
    shortName: "School's Out",
    emoji: '🏫',
    accent: '#ef4444',
    tags: ['animation', 'kids', 'comedy', '2000s'],
    tagline:
      'Dr. Phillium Benedict’s plot to abolish summer vacation · the 2001 Disney theatrical that graduated the Third Street School playground crew',
    // Lives under `Recess/Movies/` inside the show's
    // `recessfullseries` upload alongside three made-for-TV movies
    // ("All Growed Down", "Miracle on Third Street", "Taking the
    // Fifth Grade"). The IA item ships every video twice — Cinepak
    // .avi and h.264 .mp4 — and the buildMovieCatalog acceptor
    // takes the .mp4. The iaFile is a basename pick (the IA path
    // prefix `Recess/Movies/` is matched by basename, not full path).
    iaItem: 'recessfullseries',
    iaFile: 'Recess Schools Out.mp4',
    imdbId: 'tt0265632',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/0/0b/Recess_Schools_Out_film.jpg'
  },
  {
    id: 'simpsons-movie',
    name: 'The Simpsons Movie (2007)',
    shortName: 'Simpsons Movie',
    emoji: '🍩',
    accent: '#ffb800',
    tags: ['animation', 'comedy', '2000s'],
    tagline:
      'Spider-Pig, a glass dome over Springfield, and Homer’s redemption · the 2007 theatrical Simpsons feature',
    // The same `doh_20240725` upload that backs the Simpsons SHOW
    // entry ships the movie as a third top-level MP4 alongside
    // S04E06 and S08E19. `iaFile` is an exact-basename pick so the
    // builder doesn't have to guess which file is the feature.
    //
    // Filename uses "Zhe Simpsons Movie" (rather than "The Simpsons
    // Movie") as a deliberate anti-takedown spelling on the IA
    // uploader's part — keep the typo exact or the basename match
    // misses.
    iaItem: 'doh_20240725',
    iaFile: 'Zhe Simpsons Movie (2007).mp4',
    imdbId: 'tt0462538',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/d/d5/The_Simpsons_Movie_%282007%29.png'
  }
]
  .sort((a, b) => a.id.localeCompare(b.id))
  // Stamp `kind: 'movie'` on every entry so the watch view (and
  // every other consumer that branches on subject type) can rely on
  // `subject.kind === 'movie'` without each registry author having
  // to remember to add the field. Authoring is read-only / immutable
  // by convention; this map is the one place we mutate the shape.
  .map((m) => /** @type {MovieConfig} */ (/** @type {unknown} */ ({ ...m, kind: 'movie' })));

/**
 * Look up a movie by id.
 *
 * @param {string} id
 * @returns {MovieConfig | null}
 */
export function getMovie(id) {
  return MOVIES.find((m) => m.id === id) || null;
}

/**
 * Test-only / debugging helper. Returns true if every tag on the
 * movie is drawn from the canonical taxonomy in `shows.js`. The
 * registry test calls this on every entry; runtime callers shouldn't
 * need to.
 *
 * @param {MovieConfig} movie
 */
export function hasOnlyCanonicalTags(movie) {
  for (const t of movie.tags || []) {
    if (!ALL_TAGS.has(t)) return false;
  }
  return true;
}
