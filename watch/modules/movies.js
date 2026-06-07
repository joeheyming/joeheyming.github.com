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
    id: 'dracula-dead-and-loving-it',
    name: 'Dracula: Dead and Loving It (1995)',
    shortName: 'Dracula: Dead and Loving It',
    emoji: '🧛',
    accent: '#991b1b',
    tags: ['live-action', 'adult', 'comedy', 'satire', 'fantasy', '90s'],
    tagline:
      'Leslie Nielsen as Count Dracula, Mel Brooks as Van Helsing · the 1995 ZAZ-meets-Brooks vampire parody and Brooks’ final theatrical feature as director',
    iaItem: 'dracula.-dead.-and.-loving.-it.-1995.1080p.-blu-ray.x-264.-aac-yts.-mx',
    iaFile: 'Dracula.Dead.And.Loving.It.1995.1080p.BluRay.x264.AAC-[YTS.MX].mp4',
    imdbId: 'tt0112896',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/5/54/Drac_dead_and_loving_it.jpg'
  },
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
    id: 'blazing-saddles',
    name: 'Blazing Saddles (1974)',
    shortName: 'Blazing Saddles',
    emoji: '🤠',
    accent: '#c2410c',
    tags: ['live-action', 'adult', 'comedy', 'satire', '70s'],
    tagline:
      'Sheriff Bart and the Waco Kid clean up Rock Ridge · Mel Brooks’ 1974 western whose racial-slur-laden satire famously couldn’t be made today',
    iaItem: 'blazing-saddles-1974_202210',
    // Filename has a double space before `(1974)`. Keep it exact.
    iaFile: 'BLAZING SADDLES  (1974).mp4',
    imdbId: 'tt0071230',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/7/7b/Blazing_saddles_movie_poster.jpg'
  },
  {
    id: 'caddyshack',
    name: 'Caddyshack (1980)',
    shortName: 'Caddyshack',
    emoji: '⛳',
    accent: '#65a30d',
    tags: ['live-action', 'adult', 'comedy', '80s'],
    tagline:
      'Bushwood Country Club vs. a gopher (and Bill Murray’s groundskeeper) · the 1980 Harold Ramis golf comedy with Chevy Chase, Rodney Dangerfield, and Ted Knight',
    iaItem: 'caddyshack.1980.1080p.brrip.x264.yify___65af351121b4c',
    iaFile: 'caddyshack.1980.1080p.brrip.x264.yify___65af351121b4c.mp4',
    imdbId: 'tt0080487',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/8/84/Caddyshack_poster.jpg'
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
    id: 'galaxy-quest',
    name: 'Galaxy Quest (1999)',
    shortName: 'Galaxy Quest',
    emoji: '🖖',
    accent: '#1d4ed8',
    tags: ['live-action', 'comedy', 'sci-fi', '90s'],
    tagline:
      'Never give up, never surrender · the 1999 Star Trek parody where the obsessive alien fans are real and the washed-up cast has to fly the actual ship',
    iaItem: 'title-01_20220430',
    iaFile: 'TITLE01.mp4',
    imdbId: 'tt0177789',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/1/1f/Galaxy_Quest_poster.jpg'
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
    id: 'history-of-the-world-part-i',
    name: 'History of the World, Part I (1981)',
    shortName: 'History of the World, Part I',
    emoji: '📜',
    accent: '#a16207',
    tags: ['live-action', 'adult', 'comedy', 'satire', 'anthology', '80s'],
    tagline:
      'Stone Age, Roman Empire, Spanish Inquisition (it’s a musical!), French Revolution · Mel Brooks’ 1981 anthology of historical sketches, narrated by Orson Welles',
    iaItem: 'HistoryOfTheWorldPartI',
    iaFile: 'History of the World Part I.mp4',
    imdbId: 'tt0082517',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/5/59/History_of_the_World_poster.jpg'
  },
  {
    id: 'monty-python-hollywood-bowl',
    name: 'Monty Python Live at the Hollywood Bowl (1982)',
    shortName: 'Monty Python: Hollywood Bowl',
    emoji: '🎤',
    accent: '#7c3aed',
    tags: ['live-action', 'adult', 'comedy', 'satire', '80s'],
    tagline:
      'Dead Parrot, Spanish Inquisition, Crunchy Frog, Argument Clinic, Lumberjack Song · the 1982 Python live concert film cut from four nights at the Hollywood Bowl',
    iaItem: 'monty-python-live-on-the-hollywood-bowl-full-show',
    iaFile: 'Monty Python Live On The Hollywood Bowl FULL SHOW.mp4',
    imdbId: 'tt0084352',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/d/d2/MontyPythonHollywoodBowlPoster.jpg'
  },
  {
    id: 'monty-python-holy-grail',
    name: 'Monty Python and the Holy Grail (1975)',
    shortName: 'Monty Python: Holy Grail',
    emoji: '🥥',
    accent: '#b91c1c',
    tags: ['live-action', 'comedy', 'satire', 'fantasy', '70s'],
    tagline:
      'King Arthur, the Knights of the Round Table, coconuts, the Black Knight, killer rabbits · the 1975 Python feature that defined British comedy export',
    iaItem: 'Monty.Python.And.The.Holy.Grail.1975.720p.BluRay.x264YTS.AM',
    iaFile: 'Monty.Python.And.The.Holy.Grail.1975.720p.BluRay.x264-[YTS.AM].mp4',
    imdbId: 'tt0071853',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/0/08/Monty-Python-1975-poster.png'
  },
  {
    id: 'monty-python-life-of-brian',
    name: "Monty Python's Life of Brian (1979)",
    shortName: 'Monty Python: Life of Brian',
    emoji: '👶',
    accent: '#d97706',
    tags: ['live-action', 'adult', 'comedy', 'satire', '70s'],
    tagline:
      'Brian Cohen, born in the stable next door to Jesus, mistaken for the messiah · the 1979 Python biblical satire (banned in several places on release)',
    // Item is titled "Definitely not the full monty python life of
    // brian movie" — that's the uploader's anti-takedown winking
    // misdirection. The .mp4 inside is plainly named `Life Of Brian.mp4`
    // and is the actual 93-minute feature.
    iaItem: '20230811_20230811_1910',
    iaFile: 'Life Of Brian.mp4',
    imdbId: 'tt0079470',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/1/18/Lifeofbrianfilmposter.jpg'
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
    id: 'princess-bride',
    name: 'The Princess Bride (1987)',
    shortName: 'The Princess Bride',
    emoji: '👰',
    accent: '#f9a8d4',
    tags: ['live-action', 'comedy', 'fantasy', '80s'],
    tagline:
      'As you wish · Rob Reiner’s 1987 storybook romance with sword fights, ROUS, the Cliffs of Insanity, and inconceivable miracle pills, from William Goldman’s novel',
    iaItem: 'the-princess-bride_202402',
    // The source `The Princess Bride.mp4` (3.3 GB) ships its audio
    // as E-AC-3 5.1 (Dolby Digital Plus) which Chrome's WebView
    // can't decode — the video plays but the audio is silent.
    // Switch to the IA-generated `.ia.mp4` derivative (3.2 GB) which
    // re-encodes to plain AAC stereo at 92 kbps, browser-safe. Same
    // h.264 720p video stream, same 98-min length. When iaFile is
    // set explicitly buildMovieCatalog does an exact basename match
    // and bypasses the default "no .ia.mp4" acceptor, so no
    // acceptFile override is needed.
    iaFile: 'The Princess Bride.ia.mp4',
    imdbId: 'tt0093779',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/d/db/Princess_bride.jpg'
  },
  {
    // The trilogy of Naked Gun movies and the 1982 Police Squad! TV
    // series they were spun off from all live in the same IA item
    // (`PoliceSquad`). Each movie picks its own basename out of that
    // shared upload via `iaFile`. The same upload also ships 6 episodes
    // of the TV series (~25 min each) as native h.264 MP4s — could be
    // a separate ShowConfig entry someday; the 6 episodes are too few
    // for the chip filter to matter much but the legacy is significant.
    //
    // Filename trap: the 1991 and 1994 entries have a DOUBLE SPACE
    // after the year-dash separator. The 1988 entry has a single
    // space. Keep these exact or the basename match fails silently.
    id: 'naked-gun-1',
    name: 'The Naked Gun: From the Files of Police Squad! (1988)',
    shortName: 'The Naked Gun',
    emoji: '🚓',
    accent: '#1d4ed8',
    tags: ['live-action', 'adult', 'comedy', 'satire', 'spy', '80s'],
    tagline:
      'Frank Drebin investigates an attempt on the Queen of England · the 1988 ZAZ-team Leslie Nielsen flagship that proved Police Squad! works at feature length',
    iaItem: 'PoliceSquad',
    iaFile: '1988 - The Naked Gun.mp4',
    imdbId: 'tt0095705',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/5/5f/The_Naked_Gun_Poster.jpg'
  },
  {
    id: 'naked-gun-2',
    name: 'The Naked Gun 2½: The Smell of Fear (1991)',
    shortName: 'The Naked Gun 2½',
    emoji: '🚓',
    accent: '#1e40af',
    tags: ['live-action', 'adult', 'comedy', 'satire', 'spy', '90s'],
    tagline:
      'Frank Drebin vs. the energy lobby and Robert Goulet · the 1991 sequel where Drebin gets reactivated to investigate Quentin Hapsburg',
    iaItem: 'PoliceSquad',
    // Note the DOUBLE SPACE between `-` and `The`.
    iaFile: '1991 -  The Naked Gun 2 The Smell Of Fear.mp4',
    imdbId: 'tt0102510',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/d/d1/Naked_Gun_2.jpg'
  },
  {
    id: 'naked-gun-3',
    name: 'Naked Gun 33⅓: The Final Insult (1994)',
    shortName: 'Naked Gun 33⅓',
    emoji: '🚓',
    accent: '#1e3a8a',
    tags: ['live-action', 'adult', 'comedy', 'satire', 'spy', '90s'],
    tagline:
      'Frank Drebin retired with Jane, then dragged back to infiltrate the Rocco Dillon gang · the 1994 trilogy finale with O.J. Simpson’s last theatrical role',
    iaItem: 'PoliceSquad',
    // Note the DOUBLE SPACE between `-` and `The`.
    iaFile: '1994 -  The Naked Gun 3 The Final Insult.mp4',
    imdbId: 'tt0110622',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/1/14/Naked_Gun_3_poster.jpg'
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
    id: 'robin-hood-men-in-tights',
    name: 'Robin Hood: Men in Tights (1993)',
    shortName: 'Robin Hood: Men in Tights',
    emoji: '🏹',
    accent: '#15803d',
    tags: ['live-action', 'adult', 'comedy', 'satire', '90s'],
    tagline:
      'We’re men, we’re men in tights · Mel Brooks’ 1993 Robin Hood parody starring Cary Elwes, Dave Chappelle’s screen debut, and Patrick Stewart cameo-ing as King Richard',
    iaItem: 'robin-hood-men-in-tights-1993',
    iaFile: 'Robin Hood Men In Tights 1993.mp4',
    imdbId: 'tt0107977',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/1/12/RobinHoodMeninTights_Poster.jpg'
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
    id: 'spaceballs',
    name: 'Spaceballs (1987)',
    shortName: 'Spaceballs',
    emoji: '🚀',
    accent: '#0891b2',
    tags: ['live-action', 'adult', 'comedy', 'satire', 'sci-fi', '80s'],
    tagline:
      'May the Schwartz be with you · Mel Brooks’ 1987 Star Wars parody starring Bill Pullman, John Candy as Barf, and Rick Moranis as Dark Helmet',
    iaItem: 'spaceballs1987',
    iaFile: 'Spaceballs.1987.1080p.BluRay.x264.mp4',
    imdbId: 'tt0094012',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/4/45/Spaceballs.jpg'
  },
  {
    id: 'spy-hard',
    name: 'Spy Hard (1996)',
    shortName: 'Spy Hard',
    emoji: '🕵️',
    accent: '#71717a',
    tags: ['live-action', 'adult', 'comedy', 'satire', 'spy', '90s'],
    tagline:
      'Agent WD-40 vs. General Rancor · the 1996 Leslie Nielsen Bond parody, complete with a Weird Al opening theme and Andy Griffith as the villain',
    iaItem: '564712573638',
    iaFile: '564712573638.mp4',
    imdbId: 'tt0117723',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/4/42/Spyhardposter.jpg'
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
  },
  {
    id: 'wrongfully-accused',
    name: 'Wrongfully Accused (1998)',
    shortName: 'Wrongfully Accused',
    emoji: '🚔',
    accent: '#f97316',
    tags: ['live-action', 'adult', 'comedy', 'satire', '90s'],
    tagline:
      'Ryan Harrison hunted by Marshal Fergus Falls · the 1998 Leslie Nielsen Fugitive parody from a Naked Gun co-writer (Pat Proft)',
    iaItem: '1014128183846',
    iaFile: '1014128183846.mp4',
    imdbId: 'tt0120901',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/f/f5/Wrongfully_Accused.jpg'
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
