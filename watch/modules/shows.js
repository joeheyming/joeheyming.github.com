/**
 * Show registry for the multi-show /watch/ player.
 *
 * Each entry pairs an Internet Archive item id with a filename parser
 * that turns IA file names into normalized `{ season, episode, title }`
 * tuples. The catalog builder is generic; everything show-specific
 * lives here.
 *
 * To add a new show:
 *   1. Find an IA item whose video files are H.264/AAC MP4 (no MKV,
 *      no E-AC-3 audio — the browser refuses to play those natively).
 *   2. Pick a TVMaze show id so we can pull episode summaries + stills.
 *   3. Write an inline `parser(filename)` that returns
 *      `{ season, episode, title }` or null. The runner walks the
 *      archive's file list and drops anything the parser rejects.
 *   4. (Optional) override `acceptFile(raw)` if the default mp4-only
 *      filter is wrong for this show (e.g. the only mp4s available are
 *      `.ia.mp4` derivatives, or there's an alternate container to
 *      ignore).
 *
 * Parsers and any per-show acceptFile / movieDetector live inline on
 * the entry — there's exactly one call site for each, so naming them
 * separately would just add indirection. Tests reach them through
 * `getShow(id).parser(...)`.
 */

/**
 * Canonical tag taxonomy used by the landing-page chip filter. Every
 * entry in {@link SHOWS} must carry tags drawn exclusively from this
 * set; the registry test (`shows.test.mjs`) asserts both inclusion
 * (every show has at least a format + an era) and exclusion (no
 * freeform tags slip in by typo). Keep the groups stable: the UI
 * renders chips in the order Format → Audience → Era → Genre.
 */
export const TAG_GROUPS = /** @type {const} */ ({
  format: ['animation', 'live-action', 'documentary'],
  audience: ['kids', 'adult'],
  era: ['60s', '70s', '80s', '90s', '2000s', '2010s', '2020s'],
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
 *   whose seasons are spread across separate uploads (TMNT 1987).
 *   When an array, the catalog builder fetches each in parallel and
 *   merges the seasons.
 * @property {number} tvmazeId        TVMaze numeric id (for descriptions + stills).
 * @property {string} [imdbId]        IMDb id (with "tt" prefix) used by the
 *                                    Stremio OpenSubtitles addon to find
 *                                    subtitles. Omit to disable CC for the show.
 * @property {(file: { name?: unknown, format?: unknown }) => boolean} [acceptFile]
 *   Filter applied to each raw file before parsing. Defaults to "mp4
 *   only, no .ia.mp4 derivative".
 * @property {(filename: string, itemId: string) => ({ season: number, episode: number, title: string } | null)} parser
 *   The second `itemId` argument is the archive.org item the file came
 *   from; single-item shows can ignore it. Multi-item shows whose
 *   per-item filenames overlap (G.I. Joe S1 and S2 both use plain
 *   `N. Title.mp4`) need it to disambiguate the season.
 * @property {(filename: string) => boolean} [movieDetector]
 *   When set, files matching this are surfaced as `catalog.movie`
 *   (season 0) without going through the regular parser.
 * @property {string} [movieTitle]    Display title for the movie row.
 */

/** Default file filter — plain `.mp4` only, skip auto-derived `.ia.mp4`. */
function defaultAcceptMp4(raw) {
  const name = typeof raw?.name === 'string' ? raw.name : '';
  if (!/\.mp4$/i.test(name)) return false;
  if (/\.ia\.mp4$/i.test(name)) return false;
  return true;
}

/** Helper: drop the directory component of a path. */
function basename(file) {
  const slash = file.lastIndexOf('/');
  return slash >= 0 ? file.slice(slash + 1) : file;
}

// Authored alphabetically by id, then re-sorted defensively at the
// bottom so a new entry dropped in the wrong spot still ends up in
// the right place — both in the source-of-truth array and on the
// landing-page grid (which renders SHOWS in order).
/** @type {ShowConfig[]} */
export const SHOWS = [
  {
    id: 'amazing-stories',
    name: 'Amazing Stories',
    shortName: 'Amazing Stories',
    emoji: '🎩',
    accent: '#c026d3',
    tags: ['live-action', 'anthology', 'sci-fi', 'fantasy', '80s'],
    tagline:
      'Spielberg\u2019s 1985 NBC anthology \u2014 ghost trains, mummified dads, time-travelling soldiers \u2014 with Eastwood, Scorsese, and Zemeckis behind various cameras',
    iaItem: 'amazing-stories-1985-1987-complete-series',
    tvmazeId: 1122,
    imdbId: 'tt0088478',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Amazing Stories (1985) - S01E01 - Ghost Train.mp4". The dump
      // also ships a `0 Amazing Stories.mp4` series-promo file that
      // sits before the numbered episodes; the anchored regex drops
      // it silently.
      const m = basename(file).match(/^Amazing Stories \(1985\) - S(\d{2})E(\d{2}) - (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'aqua-teen',
    name: 'Aqua Teen Hunger Force',
    shortName: 'ATHF',
    emoji: '🍟',
    accent: '#d4ae3a',
    tags: ['animation', 'adult', 'comedy', '2000s'],
    tagline:
      'Sentient fast-food roommates of South Jersey · all 11 seasons + the Aquadonk specials',
    iaItem: 'aqua-teen-hunger-force-2000-s-01e-01-rabbot',
    tvmazeId: 382,
    imdbId: 'tt0297494',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Aqua Teen Hunger Force (2000) - S06E02 - Shake Like Me (1080p
      // WEB-DL x265 r00t).mp4". Quality tag in trailing parens is
      // dropped from the title. The "(2000)" before the dash is the
      // year, not an annotation — it's literally part of the show
      // signature in every filename, so the regex anchors on it.
      // Some files use lowercase `s06e02` instead of `S06E02`; both
      // are accepted via the `i` flag.
      const m = basename(file).match(
        /^Aqua Teen Hunger Force \(2000\) - S(\d{1,2})E(\d{1,3}) - (.*?)(?:\s*\([^)]*\))?\.mp4$/i
      );
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'astro-boy',
    name: 'Astro Boy (1963)',
    shortName: 'Astro Boy',
    emoji: '🤖',
    accent: '#06b6d4',
    tags: ['animation', 'anime', 'kids', 'sci-fi', 'superhero', '60s'],
    tagline:
      'Tezuka\u2019s rocket-booted little robot in his original black-and-white 1963 run \u2014 the show that effectively invented TV anime, all 104 episodes English-dubbed',
    iaItem: 'astro-boy-1963',
    tvmazeId: 7788,
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Astro Boy (1963) R1/Astro Boy S1E001.mp4". The dump uses
      // three-digit episode numbers (E001..E104) and no titles \u2014
      // the original Japanese names map awkwardly to the English-dub
      // broadcast order, so the uploader skipped them. We seed
      // "Episode N" and let TVMaze fill in canonical titles on graft.
      const m = basename(file).match(/^Astro Boy S(\d)E(\d{3})\.mp4$/i);
      if (!m) return null;
      const episode = Number(m[2]);
      return { season: Number(m[1]), episode, title: `Episode ${episode}` };
    }
  },
  {
    id: 'avengers',
    name: 'The Avengers (1961)',
    shortName: 'The Avengers',
    emoji: '☂️',
    accent: '#0f172a',
    tags: ['live-action', 'spy', '60s'],
    tagline:
      'Steed, Mrs Peel, and Tara King · the original 1961–69 ITV spy-fi, colourized S4 + restored-HD S5',
    // Two sibling uploads share this show; each item's filenames
    // already carry the season number, so the parser doesn't need
    // itemId to disambiguate (unlike G.I. Joe).
    iaItem: [
      'the-avengers-s-4e-1', // S4 (1965–66, Diana Rigg as Emma Peel arrives — episodes 1..24)
      'the-avengers-s-5e-1-restored-720p-hd' // S5 (1967, first season filmed in colour — episodes 1..25)
    ],
    tvmazeId: 1929,
    imdbId: 'tt0054518',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // S4 ships as "the avengers s4e1.mp4" (space-separated) and S5
      // as "the avengers-s5e1-restored-720p-hd.mp4" (dash-separated
      // with a quality suffix). S5E12 specifically drops the dash
      // before "restored" ("s5e12restored-720p-hd"), so the suffix
      // group makes the leading hyphen optional. Neither dump
      // carries titles — we seed "Episode N" so TVMaze can graft on
      // "The Town of No Return" / "From Venus with Love" / etc.
      const m = basename(file).match(
        /^the avengers[ -]s(\d)e(\d{1,2})(?:-?restored-720p-hd)?\.mp4$/i
      );
      if (!m) return null;
      const episode = Number(m[2]);
      return { season: Number(m[1]), episode, title: `Episode ${episode}` };
    }
  },
  {
    id: 'beavis',
    name: 'Beavis and Butt-Head',
    shortName: 'Beavis',
    emoji: '🤘',
    accent: '#ff4b3a',
    tags: ['animation', 'adult', 'comedy', '90s'],
    tagline: 'Couch-bound music-video critics · seasons 4–8',
    iaItem: 's-7-ep-41-beavis-butthead-are-dead',
    tvmazeId: 910,
    imdbId: 'tt0105950',
    // Beavis archive includes some episodes only as .ia.mp4
    // derivatives; keep them since there's no plain-mp4 alternative.
    acceptFile: (raw) => {
      const name = typeof raw?.name === 'string' ? raw.name : '';
      return /\.mp4$/i.test(name);
    },
    parser: (file) => {
      // "S4/S4 EP 01 Wall Of Youth.mp4". S8 only has `.ia.mp4`
      // derivatives so the show-level acceptFile above keeps both.
      const m = basename(file).match(/^S(\d+)\s+EP\s+(\d+)\s+(.*?)(?:\.ia)?\.mp4$/i);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'boondocks',
    name: 'The Boondocks',
    shortName: 'Boondocks',
    emoji: '✊',
    accent: '#b91c1c',
    tags: ['animation', 'adult', 'comedy', 'satire', '2000s'],
    tagline:
      'Huey, Riley, and Granddad cause chaos in Woodcrest · all 4 seasons of Aaron McGruder’s adult animation',
    iaItem: 'the-boondocks_202410',
    tvmazeId: 912,
    imdbId: 'tt0373732',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "The Boondocks show/BOONDOCKS_S1_D1/S1 E1 The Boondocks The
      // Garden Party.mp4". The "The Boondocks" between the episode
      // number and the title is duplicated in every filename — strip
      // it from the title. The /Extras/ directory holds the unaired
      // pilot, behind-the-scenes featurettes, an Aaron McGruder HOPE
      // keynote, and animatic-to-screen comparisons; none of those
      // have S/E numbering, so we drop the whole subtree.
      if (file.includes('/Extras/')) return null;
      const m = basename(file).match(/^S(\d+)\s+E(\d+)\s+The Boondocks\s+(.+)\.mp4$/i);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'captain-planet',
    name: 'Captain Planet and the Planeteers',
    shortName: 'Captain Planet',
    emoji: '🌍',
    accent: '#15803d',
    tags: ['animation', 'kids', 'action', '90s'],
    tagline:
      'Five rings, five Planeteers, one eco-warrior · all 6 seasons (1990–96) of TBS/Hanna-Barbera environmentalism',
    iaItem: 'captain-planet-and-the-planeteers-480p',
    tvmazeId: 4416,
    imdbId: 'tt0098763',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      const base = basename(file);
      // Two filename shapes coexist in this dump. Season 1 ripped under
      // the original dotted "Captain.Planet.and.the.Planeteers.SxxExx.480p"
      // convention with no title in the file (we seed "Episode N" so
      // TVMaze can graft real titles like "A Hero for Earth" on top).
      // The `\.*` is for S01E05 which ships with a stray double-dot
      // ("...480p..mp4") that would otherwise fail the literal anchor.
      let m = base.match(
        /^Captain\.Planet\.and\.the\.Planeteers\.S(\d{2})E(\d{2})\.480p\.*\.mp4$/i
      );
      if (m) {
        return {
          season: Number(m[1]),
          episode: Number(m[2]),
          title: `Episode ${Number(m[2])}`
        };
      }
      // Seasons 2–6 use a different rip with a U+2219 BULLET OPERATOR
      // separating the SxEx token from the title ("S2.E1 ∙ Mind
      // Pollution.mp4"). Episode numbers are 1- or 2-digit.
      m = base.match(/^S(\d+)\.E(\d+) \u2219 (.+)\.mp4$/);
      if (m) {
        return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
      }
      return null;
    }
  },
  {
    id: 'cosmos',
    name: 'Cosmos: A Personal Voyage',
    shortName: 'Cosmos',
    emoji: '🌌',
    accent: '#6366f1',
    tags: ['documentary', '80s'],
    tagline: 'Carl Sagan walking the shores of the cosmic ocean · 13 episodes (PBS, 1980)',
    iaItem: 'CosmosAPersonalVoyage',
    tvmazeId: 1128,
    imdbId: 'tt2395695',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "1980 Cosmos (A Personal Voyage) - Ep 01 The Shores of the Cosmic Ocean.mp4"
      // Single-season documentary, all 13 episodes present, clean naming.
      // Episode numbers are zero-padded 01..13, titles can contain
      // anything (parens, apostrophes, etc.) and we keep them verbatim.
      const m = basename(file).match(
        /^1980 Cosmos \(A Personal Voyage\) - Ep (\d{1,2}) (.*)\.mp4$/i
      );
      if (!m) return null;
      return { season: 1, episode: Number(m[1]), title: m[2].trim() };
    }
  },
  {
    id: 'critic',
    name: 'The Critic',
    shortName: 'The Critic',
    emoji: '🎞️',
    accent: '#dc2626',
    tags: ['animation', 'comedy', '90s'],
    tagline:
      'Jay Sherman watches the worst movies so you don\u2019t have to · "It Stinks!" · both ABC + Fox seasons (1994\u201395), Reiss & Weinstein',
    iaItem: 'the-critic-1x-08-marathon-mensch',
    tvmazeId: 697,
    imdbId: 'tt0108734',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // The dump bundles ~6 promo/bonus files alongside the 23 canon
      // episodes ("Creating The Critic", "Promos 1", "Promos 2",
      // "Top Ten List", "Trailer Parodies", "The Critic Webseries").
      // The exact "NxNN - Title.mp4" anchor drops everything that
      // isn't a numbered slot, so they're silently skipped.
      const m = basename(file).match(/^The Critic - (\d)x(\d{2}) - (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'crystal-maze',
    name: 'The Crystal Maze',
    shortName: 'Crystal Maze',
    emoji: '🔮',
    accent: '#9333ea',
    tags: ['live-action', 'game-show', '90s'],
    tagline:
      "Richard O'Brien shepherds teams through Aztec, Medieval, Industrial, and Futuristic zones · Channel 4's 1990 game-show original, season 1 (13 episodes)",
    iaItem: 'the-crystal-maze-season-1-1990',
    tvmazeId: 4713,
    imdbId: 'tt0098774',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "The Crystal Maze - Season 1 [1990]/The.Crystal.Maze.S01E01.mp4".
      // No titles in the files (the show numbered episodes without
      // titling them); we seed "Episode N" so TVMaze episode summaries
      // can graft on later if the catalog wants them.
      const m = basename(file).match(/^The\.Crystal\.Maze\.S(\d{2})E(\d{2})\.mp4$/i);
      if (!m) return null;
      const episode = Number(m[2]);
      return { season: Number(m[1]), episode, title: `Episode ${episode}` };
    }
  },
  {
    id: 'dbz',
    name: 'Dragon Ball Z',
    shortName: 'DBZ',
    emoji: '🔥',
    accent: '#ff8c00',
    tags: ['animation', 'anime', 'action', '90s'],
    tagline: 'Saiyan saga through Buu saga · the Ocean dub, 276 episodes in absolute order',
    iaItem: 'dragon-ball-z-ocean-dub-mastered-complete',
    tvmazeId: 2103,
    imdbId: 'tt0121220',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "001 - The Arrival of Raditz.mp4". The archive numbers every
      // episode 001..276 in a single flat directory rather than
      // splitting by Funimation saga, and those absolute numbers
      // don't line up with TVMaze's 9-season layout — so we surface
      // the whole run as one long "Season 1" and episode titles come
      // from the filenames. TVMaze descriptions / stills won't match
      // (per-season numbering mismatch); that's intentional, the
      // player just falls back to the archive thumbnail.
      const m = basename(file).match(/^(\d{3,4})\s*-\s*(.*?)\.mp4$/);
      if (!m) return null;
      return { season: 1, episode: Number(m[1]), title: m[2].trim() };
    }
  },
  {
    id: 'dexters-lab',
    name: "Dexter's Laboratory",
    shortName: 'Dexter',
    emoji: '🧪',
    accent: '#22c55e',
    tags: ['animation', 'kids', 'comedy', '90s'],
    tagline:
      'Boy genius, secret lab, annoying sister · all 4 seasons (1996–2003) of the Cartoon Cartoon',
    iaItem: 'dexters-laboratory-the-complete-series',
    tvmazeId: 1953,
    imdbId: 'tt0115157',
    acceptFile: defaultAcceptMp4,
    // The standalone hour-long "Ego Trip" finale movie ships with
    // curly-apostrophe + underscore separators that the regular
    // parser regex deliberately doesn't accept; route it to the
    // movie row instead.
    movieDetector: (name) => /Dexter[’']s_Laboratory_-_Ego_Trip\.mp4$/i.test(basename(name)),
    movieTitle: "Dexter's Laboratory: Ego Trip (1999)",
    parser: (file) => {
      // "Dexter_s_Laboratory_S01E01.mp4". No episode titles in the
      // filenames — every regular episode is just SxxExx. We seed
      // "Episode N" so the catalog has something to show until
      // TVMaze descriptions graft in the real ("Dee Deemensional",
      // "Maternal Combat", etc.) titles.
      const m = basename(file).match(/^Dexter_s_Laboratory_S(\d{2})E(\d{2})\.mp4$/i);
      if (!m) return null;
      return {
        season: Number(m[1]),
        episode: Number(m[2]),
        title: `Episode ${Number(m[2])}`
      };
    }
  },
  {
    id: 'disenchantment',
    name: 'Disenchantment',
    shortName: 'Disenchantment',
    emoji: '🏰',
    accent: '#2563eb',
    tags: ['animation', 'comedy', 'fantasy', '2010s'],
    tagline:
      'Princess Bean of Dreamland, an elf, and a personal demon · season 1 of Groening’s Netflix fantasy (2018)',
    iaItem: 'SitCom-18',
    tvmazeId: 30715,
    imdbId: 'tt5363918',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "S01E01.mp4" — bare SxxExx, no show name or title in the
      // filename. The IA upload is season 1 only (10 episodes); the
      // four later parts that Netflix released as separate seasons
      // are not in this dump. Placeholder titles get overwritten by
      // TVMaze ("A Princess, an Elf, and a Demon Walk Into a Bar"…).
      const m = basename(file).match(/^S(\d{2})E(\d{2})\.mp4$/i);
      if (!m) return null;
      return {
        season: Number(m[1]),
        episode: Number(m[2]),
        title: `Episode ${Number(m[2])}`
      };
    }
  },
  {
    id: 'dnd',
    name: 'Dungeons & Dragons',
    shortName: 'D&D',
    emoji: '🐉',
    accent: '#c14b1d',
    tags: ['animation', 'kids', 'fantasy', '80s'],
    tagline:
      'Six kids stuck in a sword-and-sorcery world · all 27 episodes + the lost Requiem finale',
    iaItem: 'dungeons-and-dragons_202605',
    tvmazeId: 1129,
    imdbId: 'tt0085011',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Dungeons and Dragons - S01E01 (The Night of No Tomorrow).mp4".
      // The lost finale "Requiem" was reconstructed from the original
      // script and lives in the archive as S03E07a + S03E07b. We map
      // those to E07 + E08 so both halves are reachable in the grid
      // (they become "Requiem (Part 1)" / "Requiem (Part 2)") and
      // S03's canonical 6-episode run stays intact below them.
      const m = basename(file).match(
        /^Dungeons and Dragons - S(\d{1,2})E(\d{1,2})([a-z]?)\s*\(([^)]+)\)\.mp4$/i
      );
      if (!m) return null;
      const suffix = m[3].toLowerCase();
      const offset = suffix ? suffix.charCodeAt(0) - 'a'.charCodeAt(0) : 0;
      const baseTitle = m[4].trim();
      const title = suffix ? `${baseTitle} (Part ${offset + 1})` : baseTitle;
      return { season: Number(m[1]), episode: Number(m[2]) + offset, title };
    }
  },
  {
    id: 'doctor-who',
    name: 'Doctor Who (Classic)',
    shortName: 'Doctor Who',
    emoji: '📞',
    accent: '#1d4ed8',
    tags: ['live-action', 'sci-fi', '60s'],
    tagline:
      'The TARDIS, the Doctor, and 25 seasons of BBC sci-fi · the original 1963–1988 run, episode-by-episode',
    iaItem: 'doctor-who_202210',
    tvmazeId: 766,
    imdbId: 'tt0056751',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "S01E01 - An Unearthly Child.mp4". The classic series aired
      // each ~25-minute part of a serial as its own broadcast slot,
      // and both the IA dump and TVMaze use that same per-part
      // numbering (S01 = 42 parts, S25 = 14 parts). Descriptions and
      // titles graft cleanly. The dump ends at S25E14; S26 (1989,
      // Sylvester McCoy's final season) is genuinely absent here.
      const m = basename(file).match(/^S(\d{2})E(\d{2}) - (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'duckman',
    name: 'Duckman: Private Dick/Family Man',
    shortName: 'Duckman',
    emoji: '🦆',
    accent: '#9333ea',
    tags: ['animation', 'adult', 'comedy', '90s'],
    tagline:
      'Eric Duckman, P.I. — sleazy, indignant, and on USA · all 4 seasons (1994–97) of the Klasky-Csupo cult adult cartoon',
    iaItem: 'DuckmanComplete',
    tvmazeId: 414,
    imdbId: 'tt0108755',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Duckman/Season 1/Duckman S01E01 I, Duckman (Pilot).mp4". The
      // space between "Duckman" and "SxxExx" is missing on a chunk of
      // S1/S2 ("DuckmanS01E11"), and one S2 file has a trailing space
      // before the extension ("Papa Oom M.O.W. M.O.W. .mp4") — both
      // are handled by the optional `\s?` and trailing `\s*`.
      const m = basename(file).match(/^Duckman\s?S(\d{2})E(\d{2}) (.+?)\s*\.mp4$/i);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'ducktales',
    name: 'DuckTales (1987)',
    shortName: 'DuckTales',
    emoji: '💰',
    accent: '#eab308',
    tags: ['animation', 'kids', '80s'],
    tagline:
      'Scrooge McDuck, the nephews, and the bin of all bins · the original Disney Afternoon run, 75 episodes (1987–90)',
    iaItem: 'Ducktales-Complete-Series',
    tvmazeId: 4295,
    imdbId: 'tt0092345',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      const base = basename(file);
      // Two filename shapes in the dump. The bulk of S1 uses the
      // compact "DuckTales S01E01 Dont give up the ship.mp4" form
      // (note the missing apostrophe — the dump's typo, not ours;
      // TVMaze will overwrite it).
      let m = base.match(/^DuckTales S(\d{2})E(\d{2}) (.+)\.mp4$/);
      if (m) {
        return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
      }
      // The late-S1 tail and all of S2 ship under a verbose
      // "DuckTales Season 2 Episode 1 Time Is Money- Marking Time -
      // DuckTales 1987.mp4" shape; we strip the redundant trailing
      // " - DuckTales 1987" annotation. The "Time Is Money" and "Super
      // DuckTales" mini-arc subtitles stay (joined by a hyphen-no-space
      // separator, which is the dump's own convention).
      m = base.match(/^DuckTales Season (\d+) Episode (\d+) (.+?)(?: - DuckTales 1987)?\.mp4$/);
      if (m) {
        return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
      }
      return null;
    }
  },
  {
    id: 'fawlty-towers',
    name: 'Fawlty Towers',
    shortName: 'Fawlty Towers',
    emoji: '🏨',
    accent: '#ca8a04',
    tags: ['live-action', 'comedy', '70s'],
    tagline:
      'Basil Fawlty, Manuel, and a hotel held together with rage and string \u00b7 John Cleese & Connie Booth\u2019s 1975\u201379 BBC sitcom, all 12 episodes',
    iaItem: 'fawlty-towers-complete-series-1975',
    tvmazeId: 577,
    imdbId: 'tt0072500',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Fawlty Towers S01E01 - A touch of class.mp4". 6 episodes per
      // season across 2 seasons; titles are kept as the uploader
      // wrote them (capitalization is inconsistent: "A touch of
      // class" vs. "The Builders" \u2014 we leave them alone since the
      // catalog can graft TVMaze's canonical titles on later).
      const m = basename(file).match(/^Fawlty Towers S(\d{2})E(\d{2}) - (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'frankenhole',
    name: "Mary Shelley's Frankenhole",
    shortName: 'Frankenhole',
    emoji: '🧟',
    accent: '#84cc16',
    tags: ['animation', 'adult', 'comedy', '2010s'],
    tagline:
      "Dr. Frankenstein's portal cures Hitler, hosts JFK, vexes Dracula · Dino Stamatopoulos' Adult Swim stop-motion (2010–12)",
    iaItem: 'mary-shelleys-frankenhole-s-01-e-01-yawn-of-the-dead',
    tvmazeId: 15626,
    imdbId: 'tt1535715',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Mary Shelley's Frankenhole S01 E01 - Yawn of the Dead.mp4".
      // Titles include parenthesized prefixes ("(John) Thomas
      // Jefferson") which the greedy `.+` handles without trouble.
      // Allow both straight and curly apostrophe in "Shelley's" in
      // case a future re-derive normalizes to one or the other.
      const m = basename(file).match(
        /^Mary Shelley[\u2019']s Frankenhole S(\d{2}) E(\d{2}) - (.+)\.mp4$/i
      );
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'freakazoid',
    name: 'Freakazoid!',
    shortName: 'Freakazoid',
    emoji: '💥',
    accent: '#db2777',
    tags: ['animation', 'kids', 'superhero', 'comedy', '90s'],
    tagline:
      'Dexter Douglas, fourteen, a clean-cut kid — and Freakazoid! · all 2 seasons of the Spielberg/Ruegger WB toon',
    iaItem: 'freakazoid_202210',
    tvmazeId: 6838,
    imdbId: 'tt0111970',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Season 1/1x01. Five Day Forecast-Dance of Doom-Handman.mp4".
      // Each episode strings together 2–5 sketch titles separated by
      // single hyphens; we keep the whole concatenation as the title
      // (TVMaze's per-episode title is just the first one, so we
      // surface more info than the standard graft would). The leading
      // "NxNN. " uses a literal period + space separator.
      const m = basename(file).match(/^(\d+)x(\d{2})\. (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'gi-joe',
    name: 'G.I. Joe: A Real American Hero',
    shortName: 'G.I. Joe',
    emoji: '🪖',
    accent: '#16a34a',
    tags: ['animation', 'kids', 'action', '80s'],
    tagline:
      'Yo Joe! · 1983/84 mini-series + both Sunbow seasons + the 1987 movie · 96 entries total',
    // Three sibling Sunbow-era uploads by `scottharriman@hotmail.com`.
    // S1 (the 1985 regular run) and S2 (1986) both use plain
    // `N. Title.mp4` so the catalog builder can't tell them apart from
    // the filename alone — we use the `itemId` arg threaded through
    // `show.parser(name, itemId)` to disambiguate.
    iaItem: [
      'gi-joe-1', // 1983/84 mini-series: MASS Device + Revenge of Cobra (10 parts)
      'gi-joe-2', // 1985 Season 1 (55 episodes, opens with Pyramid of Darkness 5-parter)
      'gi-joe-3' //  1986 Season 2 (30 episodes) + G.I. Joe: The Movie
    ],
    tvmazeId: 6880,
    imdbId: 'tt0086719',
    acceptFile: defaultAcceptMp4,
    movieDetector: (file) => /^G\.I\. Joe The Movie\.mp4$/i.test(basename(file)),
    movieTitle: 'G.I. Joe: The Movie (1987)',
    parser: (file, itemId) => {
      const base = basename(file);
      if (itemId === 'gi-joe-1') {
        // "1-1. The M.A.S.S. Device Part 1.mp4" — M = mini number
        // (1 = MASS Device, 2 = Revenge of Cobra), N = part 1..5.
        // Both minis are pre-S1 specials; we collapse them into a
        // single "Season 0" with episodes 1..10 (E1-E5 = MASS Device,
        // E6-E10 = Revenge of Cobra) so they show up in the catalog's
        // specials/movie row alongside The Movie.
        const m = base.match(/^(\d+)-(\d+)\. (.*)\.mp4$/i);
        if (!m) return null;
        const mini = Number(m[1]);
        const part = Number(m[2]);
        return { season: 0, episode: (mini - 1) * 5 + part, title: m[3].trim() };
      }
      // gi-joe-2 = the 1985 regular series (season 1)
      // gi-joe-3 = the 1986 second season (the Movie is caught by
      //           movieDetector above and never reaches this parser).
      const season = itemId === 'gi-joe-3' ? 2 : 1;
      const m = base.match(/^(\d+)\. (.*)\.mp4$/i);
      if (!m) return null;
      return { season, episode: Number(m[1]), title: m[2].trim() };
    }
  },
  {
    id: 'harvey-birdman',
    name: 'Harvey Birdman, Attorney at Law',
    shortName: 'Harvey Birdman',
    emoji: '⚖️',
    accent: '#f97316',
    tags: ['animation', 'adult', 'comedy', 'superhero', '2000s'],
    tagline:
      'Birdman (the ex-superhero) sues Hanna-Barbera defendants for Sebben & Sebben · all 4 Adult Swim seasons (2000–07)',
    iaItem: 'harvey-birdman-attorney-general-information',
    tvmazeId: 1810,
    imdbId: 'tt0294097',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // The root-level "Harvey Birdman, Attorney General information"
      // is a behind-the-scenes promo segment, not an episode; reject
      // it explicitly so it doesn't bypass the regex by accident.
      const base = basename(file);
      if (/^Harvey Birdman, Attorney General information\.mp4$/i.test(base)) return null;
      // Path layout: ".../S 1/EP 1 BANNON CUSTODY BATTLE [PILOT].mp4"
      // for S1; ".../S 2/S2 EP 1 BLACKWATCH PLAID.mp4" for S2+. S1
      // omits the season prefix from the filename, so we read the
      // season from the path (`/S N/`) and treat the filename
      // prefix as optional. Titles are SCREAMING_CASE in the dump;
      // we leave them as-is — TVMaze re-titlecases on graft.
      const sm = file.match(/\/S\s(\d+)\//);
      if (!sm) return null;
      const m = base.match(/^(?:S\d+ )?EP (\d+) (.+)\.mp4$/i);
      if (!m) return null;
      return { season: Number(sm[1]), episode: Number(m[1]), title: m[2].trim() };
    }
  },
  {
    id: 'home-movies',
    name: 'Home Movies',
    shortName: 'Home Movies',
    emoji: '🎬',
    accent: '#06b6d4',
    tags: ['animation', 'comedy', '2000s'],
    tagline:
      'Brendon Small films Z-grade epics with Melissa and Jason · all 4 seasons (1999–2004) of the squigglevision Adult Swim staple',
    iaItem: 'home-movies',
    tvmazeId: 7760,
    imdbId: 'tt0197159',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Home.Movies-S01e01.Get.Away.From.My.Mom-1.mp4". Dots are
      // word separators (literal periods would be doubled), and the
      // trailing "-N" is the global episode counter across seasons
      // (1..52) which duplicates the in-season SxxExx and we drop
      // it. Title hyphens (e.g. "Parent-Teacher") are kept since the
      // separator we strip is the dot, not the hyphen.
      const m = basename(file).match(/^Home\.Movies-S(\d{2})e(\d{2})\.(.+)-\d+\.mp4$/i);
      if (!m) return null;
      const title = m[3].replace(/\./g, ' ').trim();
      return { season: Number(m[1]), episode: Number(m[2]), title };
    }
  },
  {
    id: 'inspector-gadget',
    name: 'Inspector Gadget',
    shortName: 'Gadget',
    emoji: '🕵️',
    accent: '#7fbf3f',
    tags: ['animation', 'kids', '80s'],
    tagline: 'Go-go-gadget Saturday mornings · seasons 1 & 2 (1983–86), 86 episodes',
    iaItem: 'inspector-gadget-go-go-gadget-series',
    tvmazeId: 4579,
    imdbId: 'tt0085033',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Inspector Gadget S01E01 Winter Olympics.mp4" — same general
      // shape as South Park, just without the "[R]" remaster tag.
      const m = basename(file).match(/^Inspector Gadget S(\d{1,2})E(\d{1,2})\s+(.*)\.mp4$/i);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'jem',
    name: 'Jem and the Holograms',
    shortName: 'Jem',
    emoji: '🎤',
    accent: '#ec4899',
    tags: ['animation', 'kids', '80s'],
    tagline: 'Showtime, Synergy · 65 truly outrageous episodes (1985–88)',
    iaItem: 'jem-1985_202604',
    tvmazeId: 4053,
    imdbId: 'tt0090461',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // Two naming variants in the same upload:
      //   "[HD] Jem Episode 01 - The Beginning.mp4"     (E1-E8 use a hyphen)
      //   "[HD] Jem Episode 09 The World Hunger Shindig.mp4"   (no hyphen)
      // Plus one outlier file that ships with a doubled extension:
      //   "[HD] Jem Episode 32 The Fan.mp4.mp4"
      // The regex allows either separator and tolerates an optional
      // trailing ".mp4". Single-season run, hardcode season 1; titles
      // get overwritten by TVMaze's canonical names when descriptions
      // are merged in.
      const m = basename(file).match(
        /^\[HD\] Jem Episode (\d{1,2})(?:\s*-\s*|\s+)(.*?)\.mp4(?:\.mp4)?$/i
      );
      if (!m) return null;
      return { season: 1, episode: Number(m[1]), title: m[2].trim() };
    }
  },
  {
    id: 'jonny-quest',
    name: 'The Real Adventures of Jonny Quest',
    shortName: 'Jonny Quest',
    emoji: '🧭',
    accent: '#ea580c',
    tags: ['animation', 'kids', 'action', 'sci-fi', '90s'],
    tagline:
      "Jonny, Hadji, Race Bannon, and Questworld VR \u00b7 Hanna-Barbera's 1996\u201397 reboot of the 1964 globe-trotting adventure cartoon, all 52 episodes",
    iaItem: 'real-adventures-of-jonny-quest',
    tvmazeId: 18175,
    imdbId: 'tt0115226',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "The Real Adventures of Jonny Quest - S01 E01 - The Darkest
      // Fathoms (480p - DVDRip).mp4". Note the SPACE between the
      // season and episode tokens ("S01 E01"), not "S01E01" \u2014 a
      // quirk of this particular DVDRip set. The trailing
      // "(480p - DVDRip)" quality tag is stripped from the title via
      // anchoring on it directly.
      const m = basename(file).match(
        /^The Real Adventures of Jonny Quest - S(\d{2}) E(\d{2}) - (.+) \(480p - DVDRip\)\.mp4$/
      );
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'liquid-television',
    name: 'Liquid Television',
    shortName: 'Liquid TV',
    emoji: '📺',
    accent: '#7c3aed',
    tags: ['animation', 'adult', 'anthology', '90s'],
    tagline:
      'MTV\u2019s 1991\u201395 animation anthology that spawned Beavis, \u00c6on Flux, and The Maxx · all 3 seasons, 22 episodes',
    iaItem: 'liquid-television-complete',
    tvmazeId: 39449,
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Liquid Television 304.mp4" — first digit is the season, last
      // two are the episode. Aired counts (S1=7, S2=6, S3=9 \u2192 22)
      // match what the dump carries. One S3 file ships under the typo
      // "Liqiud" with the i/u transposed, so the character class
      // accepts both spellings.
      const m = basename(file).match(/^Liq(?:ui|iu)d Television (\d)(\d{2})\.mp4$/i);
      if (!m) return null;
      const episode = Number(m[2]);
      return {
        season: Number(m[1]),
        episode,
        title: `Episode ${episode}`
      };
    }
  },
  {
    id: 'maxx',
    name: 'The Maxx',
    shortName: 'The Maxx',
    emoji: '🟣',
    accent: '#7c3aed',
    tags: ['animation', 'adult', 'superhero', '90s'],
    tagline:
      'Sam Kieth\u2019s Image-comics anti-hero, half-homeless, half-jungle-king · MTV\u2019s 1995 13-episode oddity',
    iaItem: 'the-maxx_202209',
    tvmazeId: 18163,
    imdbId: 'tt0112065',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "The Maxx - 1x01.mp4". One season, 13 episodes, no titles in
      // the filenames (MTV aired them as "Episode 1" through
      // "Episode 13" too). We seed "Episode N" so TVMaze descriptions
      // can graft cleanly when the title metadata isn't really used.
      const m = basename(file).match(/^The Maxx - (\d)x(\d{2})\.mp4$/);
      if (!m) return null;
      const episode = Number(m[2]);
      return { season: Number(m[1]), episode, title: `Episode ${episode}` };
    }
  },
  {
    id: 'monty-python',
    name: "Monty Python's Flying Circus",
    shortName: 'Monty Python',
    emoji: '🦶',
    accent: '#facc15',
    tags: ['live-action', 'comedy', '70s'],
    tagline:
      "And now for something completely different · all 4 BBC series of John Cleese & co's 1969–74 surrealist sketch",
    iaItem: 'mpfc-s-01-e-02-sex-and-violence',
    tvmazeId: 694,
    imdbId: 'tt0063929',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Series 1/MPFC S01E01 Whither Canada.mp4". Titles include
      // apostrophes ("Mr. And Mrs. Brian Norris' Ford Popular") and
      // periods ("Mr. Neutron"); both pass through the `.+` greedy
      // capture cleanly. Series 4 only has 6 episodes (the
      // post-Cleese run) — TVMaze matches per-series numbering.
      const m = basename(file).match(/^MPFC S(\d{2})E(\d{2}) (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'mst3k',
    name: 'Mystery Science Theater 3000',
    shortName: 'MST3K',
    emoji: '🤖',
    accent: '#cf353a',
    tags: ['live-action', 'comedy', '90s'],
    tagline:
      'Joel/Mike and the bots riff the worst movies ever made · KTMA pilot + S1–S12 (1988–2018)',
    iaItem: 'the-ultimate-mst3k',
    tvmazeId: 19499,
    imdbId: 'tt0094517',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "S01E01 - The Crawling Eye.mp4". KTMA pre-Comedy-Central
      // run is S00 (E00 = the unaired pilot "The Green Slime",
      // E01..E21 = the 1988 Minneapolis local-TV season). Files
      // outside the SxxExx shape — "SPF: ..." (Specials/Promo
      // Features), "Shorts (Volume N)", "The Last Dance RAW", "The
      // Making of MST3K", "This Is MST3K" — are intentionally
      // dropped; they have no episode slot and TVMaze can't graft
      // descriptions onto them anyway.
      const m = basename(file).match(/^S(\d{2})E(\d{2}) - (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'mutant-league',
    name: 'Mutant League',
    shortName: 'Mutant League',
    emoji: '🏈',
    accent: '#65a30d',
    tags: ['animation', 'kids', 'sports', 'action', '90s'],
    tagline:
      'Bones Justice, Razor Kid, and a sport that wins by killing the other team · 1994\u201395 syndicated cartoon based on the EA Genesis game',
    iaItem: 'mutant-league-complete-series',
    tvmazeId: 73091,
    imdbId: 'tt0179597',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Mutant.League.S01E01.Good.To.The.Bone.720p.CTV.WEB-DL.AAC2.0.H.264-STARBUCKS.mp4"
      // Dots are word separators in the title (everything between the
      // SxxExx token and the trailing source-quality tag). The
      // STARBUCKS-group naming convention always ends with
      // ".720p.CTV.WEB-DL.AAC2.0.H.264-STARBUCKS" — anchoring on it
      // lets us recover the canonical title cleanly. Apostrophes and
      // parens inside the title (e.g. "In.My.Father\u2019s.Name.(Part.2)")
      // survive the dot-to-space replacement intact.
      const m = basename(file).match(
        /^Mutant\.League\.S(\d{2})E(\d{2})\.(.+?)\.720p\.CTV\.WEB-DL\.AAC2\.0\.H\.264-STARBUCKS\.mp4$/i
      );
      if (!m) return null;
      const title = m[3].replace(/\./g, ' ').trim();
      return { season: Number(m[1]), episode: Number(m[2]), title };
    }
  },
  {
    id: 'pirates-dark-water',
    name: 'The Pirates of Dark Water',
    shortName: 'Dark Water',
    emoji: '🏴\u200d☠️',
    accent: '#0891b2',
    tags: ['animation', 'kids', 'fantasy', 'action', '90s'],
    tagline:
      'Ren and the crew of the Wraith hunt the Thirteen Treasures of Rule across an alien sea · Hanna-Barbera\u2019s short-lived 1991\u201393 fantasy cult favorite',
    iaItem: 'the-pirates-of-dark-water',
    tvmazeId: 19136,
    imdbId: 'tt0101169',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Season 01/S1.E01 \u2219 The Quest.mp4". The separator between
      // the SxEx token and the title is U+2219 (BULLET OPERATOR) \u2014 the
      // same glyph Captain Planet\u2019s S2-S6 dump uses, not a regular
      // middle dot. The regex anchors on it explicitly so a stray
      // U+00B7 (\u00b7) variant won\u2019t silently match.
      const m = basename(file).match(/^S(\d)\.E(\d{2}) \u2219 (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'real-ghostbusters',
    name: 'The Real Ghostbusters',
    shortName: 'Ghostbusters',
    emoji: '👻',
    accent: '#a855f7',
    tags: ['animation', 'kids', '80s'],
    tagline: "Who you gonna call · DiC's 1986 Saturday-morning Ghostbusters, 7 seasons",
    iaItem: 'the-real-ghostbusters',
    tvmazeId: 4299,
    imdbId: 'tt0090506',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "The Real Ghostbusters/Season 02/The Real Ghostbusters - S02E55 - The Old College Spirit DVD.mp4"
      // Files end with a source-quality tag (SDTV / DVD) that we strip
      // from the title. Season 5 also has paired-episode files like
      //   "S05E11-E12 - Trading Faces + Transcendental Tourists SDTV.mp4"
      // — the regex captures only the first episode number, so the
      // catalog has one entry per file. The second episode in each pair
      // (E12, E14, E16, E18, E20) is therefore unreachable individually;
      // playing the E11 slot plays both back-to-back. Pragmatic loss
      // we accept until we model "pair" episodes properly.
      const m = basename(file).match(
        /^The Real Ghostbusters - S(\d{1,2})E(\d{1,2})(?:-E\d{1,2})? - (.+)\.mp4$/i
      );
      if (!m) return null;
      const title = m[3].replace(/\s+(?:SDTV|DVD)$/i, '').trim();
      return { season: Number(m[1]), episode: Number(m[2]), title };
    }
  },
  {
    id: 'reboot',
    name: 'ReBoot',
    shortName: 'ReBoot',
    emoji: '💾',
    accent: '#22c55e',
    tags: ['animation', 'kids', 'sci-fi', 'action', '90s'],
    tagline:
      'Bob, Dot, and Enzo defend Mainframe from User-sent games and Megabyte\u2019s viruses · the first all-CGI half-hour TV series (1994\u201301), all 4 seasons + Daemon Rising',
    iaItem: 'Reboot-HD',
    tvmazeId: 1662,
    imdbId: 'tt0108903',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Reboot HD/ReBoot - Season 1 Episode 1 - The Tearing (4K
      // Upscale) (1080p_24fps_H264-128kbit_AAC).mp4". Three episodes
      // (S1E2, S1E11, S1E13) ship in both 1080p and 720p; we accept
      // only the 1080p variants so every (season, episode) has
      // exactly one playable file. Every episode has a 1080p version
      // so dropping 720p loses nothing.
      //
      // The dump also has a handful of inconsistent whitespace
      // glitches:
      //   - missing first hyphen ("ReBoot Season 1 Episode 12 - ...")
      //   - missing space after the title hyphen ("Episode 7 -The Crimson...")
      //   - doubled space before the hyphen ("Episode 8  - Gigabyte")
      //   - doubled space inside "(4K  Upscale)"
      // The regex tolerates all four by using `[ -]+` between
      // "ReBoot" and "Season", `\s*-\s*` around the title separator,
      // and `\s+` inside "(4K Upscale)".
      const m = basename(file).match(
        /^ReBoot[ -]+Season (\d) Episode (\d{1,2})\s*-\s*(.+) \(4K\s+Upscale\) \(1080p_24fps_H264[^)]*\)\.mp4$/
      );
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'recess',
    name: 'Recess',
    shortName: 'Recess',
    emoji: '🏫',
    accent: '#ef4444',
    tags: ['animation', 'kids', '90s'],
    tagline:
      'T.J. Detweiler and the Third Street School playground · all 6 seasons of Disney’s Saturday-morning canon',
    iaItem: 'recessfullseries',
    tvmazeId: 5935,
    imdbId: 'tt0126170',
    acceptFile: defaultAcceptMp4,
    // The 2001 theatrical "Recess: School's Out" lives in the
    // archive's /Movies/ folder alongside three made-for-TV movies
    // ("All Growed Down", "Miracle on Third Street", "Taking the
    // Fifth Grade"). Only the canon theatrical one is surfaced as
    // the movie row; the others would clutter season 0 with
    // duplicate-of-clip-show entries.
    movieDetector: (name) => /Recess Schools Out\.mp4$/i.test(basename(name)),
    movieTitle: "Recess: School's Out (2001)",
    parser: (file) => {
      // "Recess/Season 1/recess_-_s01e01_-_the_break_in_[jpv711].mp4".
      // The whole /Movies/ subtree (3 made-for-TV movies + the
      // theatrical) doesn't follow this shape; the theatrical is
      // caught by movieDetector and the rest are dropped.
      //
      // Some files are paired-episode rips named
      // `s05e11_&_s05e12_-_lawson_and_his_crew_part,_1_&_2`; we
      // capture only the first episode number (E11) and the file
      // plays both back-to-back, same pattern as Real Ghostbusters
      // S05 pairs. One file (`s04e31`) ships with a trailing `_(1)`
      // duplicate-download marker that's stripped before underscore
      // → space normalization.
      if (file.includes('/Movies/')) return null;
      const m = basename(file).match(
        /^recess_-_s(\d{2})e(\d{2})(?:_&_s\d{2}e\d{2})?_-_(.+?)_\[jpv711\](?:_\(\d+\))?\.mp4$/i
      );
      if (!m) return null;
      const title = m[3].replace(/_/g, ' ').trim();
      return { season: Number(m[1]), episode: Number(m[2]), title };
    }
  },
  {
    id: 'robotech',
    name: 'Robotech',
    shortName: 'Robotech',
    emoji: '🚀',
    accent: '#dc2626',
    tags: ['animation', 'anime', 'sci-fi', '80s'],
    tagline:
      'Three sagas, one war · all 85 broadcast episodes of Macross / Masters / New Generation',
    // Three sibling uploads by the same archivist — one per saga.
    // The Macross item is listed first so its `1x01 - Boobytrap`
    // wins the dedup race against the stray `1x01` sample that the
    // New Generation item ships as a teaser. (mergeCatalogs uses
    // first-seen-wins on duplicate (season, episode) slots.)
    iaItem: [
      'robotech-1x-28-reconstruction-blues_202411', // S1 — The Macross Saga (36 eps)
      'robotech-2x-02-false-start_20241118', //         S2 — The Masters     (24 eps)
      'robotech-2x-02-false-start_202411' //           S3 — The New Generation (25 eps)
    ],
    tvmazeId: 6278,
    imdbId: 'tt0088595',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Robotech - 1x01 - Boobytrap.mp4"
      // "Robotech - 2x24 - Catastrophe.mp4"
      // "Robotech - 3x25 - Symphony of Light.mp4"
      // All three items use the same `Robotech - SxxExx - Title.mp4`
      // shape with `x` (lowercase) between season and episode. The
      // cross-saga numbering (1x = Macross, 2x = Masters, 3x = New
      // Generation) lines up directly with TVMaze's 36/24/25 split, so
      // descriptions and stills graft cleanly. Filename titles are
      // close-enough placeholders; mergeDescriptions() overwrites with
      // TVMaze's canonical titles ("Booby Trap" vs "Boobytrap" etc.).
      const m = basename(file).match(/^Robotech - (\d{1,2})x(\d{1,2}) - (.*)\.mp4$/i);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'rocky-bullwinkle',
    name: 'The Rocky & Bullwinkle Show',
    shortName: 'Bullwinkle',
    emoji: '🐿️',
    accent: '#c0c4cc',
    tags: ['animation', 'kids', 'comedy', '60s'],
    tagline:
      'Frostbite Falls moose and squirrel vs. Boris & Natasha · 5 seasons of Cold War mischief',
    iaItem: 'RockyBullwinkleFriends',
    tvmazeId: 5658,
    imdbId: 'tt0052507',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // The archive uses three different prefixes — full title, no
      // spaces, or short — but the trailing "Sxx[Ee]xx.mp4" is stable
      // across all of them. None of the filenames embed episode
      // titles, so we generate a placeholder ("Episode N") and rely
      // on TVMaze to overwrite it with the real title at merge time.
      //
      // "/Extras/" files (puppet shorts, outtakes, commercials)
      // don't line up with a season/episode slot — drop them.
      if (file.includes('/Extras/')) return null;
      const m = basename(file).match(/S(\d{1,2})[Ee](\d{1,2})\.mp4$/);
      if (!m) return null;
      return {
        season: Number(m[1]),
        episode: Number(m[2]),
        title: `Episode ${Number(m[2])}`
      };
    }
  },
  {
    id: 'simpsons',
    name: 'The Simpsons',
    shortName: 'Simpsons',
    emoji: '🍩',
    accent: '#ffb800',
    tags: ['animation', 'comedy', '90s'],
    tagline: 'Yellow family of Springfield · 18 seasons + the movie',
    iaItem: 'doh_20240725',
    tvmazeId: 83,
    imdbId: 'tt0096697',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "The Simpsons S01, E01 - Bart the Genius.mp4" — tolerates
      // `S01,E01`, `S01 E01`, and a missing dash before the title.
      const m = basename(file).match(
        /^The\s+Simpsons\s+S(\d{1,2}),?\s*E(\d{1,2})\s*-?\s*(.*)\.mp4$/i
      );
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    },
    // Filename uses the anti-takedown spelling "Zhe Simpsons Movie".
    movieDetector: (name) => /Zhe\s+Simpsons\s+Movie/i.test(name),
    movieTitle: 'The Simpsons Movie (2007)'
  },
  {
    id: 'smurfs',
    name: 'The Smurfs',
    shortName: 'Smurfs',
    emoji: '🍄',
    accent: '#4a9eff',
    tags: ['animation', 'kids', '80s'],
    tagline: 'Tiny blue villagers of an enchanted forest · 9 seasons of NBC Saturday mornings',
    iaItem: 'smurfs-1981-complete-series-nbc',
    tvmazeId: 4583,
    imdbId: 'tt0081933',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "The Smurfs/S01/S01 E01 - The Astrosmurf.mp4". Some titles
      // end in a bracketed annotation like "[Supercut]"; strip it so
      // the chip is clean. The S07 "Wild Side" supercut also ships a
      // second-half "S07 E01b ..." file — that variant is
      // intentionally dropped (it has no spare slot in the season's
      // numbering and the supercut already covers it).
      //
      // The `\s+` after `E\d+` is load-bearing: it forces a space
      // between the episode number and the title, which rejects the
      // lone "E01b" suffix variant outright.
      const m = basename(file).match(
        /^S(\d{1,2})\s+E(\d{1,2})\s+-?\s*(.*?)(?:\s*\[[^\]]+\])?\.mp4$/i
      );
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'speed-racer',
    name: 'Speed Racer',
    shortName: 'Speed Racer',
    emoji: '🏎️',
    accent: '#e63946',
    tags: ['animation', 'anime', 'action', '60s'],
    tagline: 'Mach 5 vs. the world · all 52 episodes of the 1967 Trans-Lux Tatsunoko run',
    iaItem: 'Speed_Racer',
    tvmazeId: 14152,
    imdbId: 'tt0061300',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // Most files have a leftover "G:/Videos/Downloads/Speed Racer/"
      // path prefix from the uploader's Windows machine, but a few
      // (the last two episodes) don't. basename() strips either way.
      //   "G:/Videos/Downloads/Speed Racer/Speed Racer - S01E01 - The Great Plan (Pt. 1).mp4"
      //   "Speed Racer - S01E52 - The Race Around the World： (Pt. 2).mp4"
      // S01E52's title uses a fullwidth colon (`：`) where a normal
      // `:` would be illegal in a Windows filename — kept as-is.
      //
      // S01E20 ("The Fastest Car On Earth, Part 1") is genuinely
      // absent from the IA upload — the catalog will show 51 of 52
      // episodes with a hole between E19 and E21. Not a parser bug.
      const m = basename(file).match(/^Speed Racer - S(\d{1,2})E(\d{1,2}) - (.*)\.mp4$/i);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'spider-man',
    name: 'Spider-Man (1967)',
    shortName: 'Spider-Man',
    emoji: '🕷️',
    accent: '#ef4444',
    tags: ['animation', 'kids', 'superhero', '60s'],
    tagline:
      'Spider-Man, Spider-Man, does whatever a spider can · the original Krantz / Grantray-Lawrence animated series, all 3 ABC seasons (1967\u201370)',
    iaItem: 'Spider-Man-67-Collection',
    tvmazeId: 4107,
    imdbId: 'tt0061301',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // Path: "Season N (YYYY-YYYY)/<slot>[A|B] - Title.mp4". The
      // season comes from the directory; the basename carries the
      // broadcast-slot number plus an optional A/B suffix.
      //
      // The show aired in two formats simultaneously: S1 (1967\u201368)
      // and S3 (1970) split each 22-minute broadcast into two
      // independent 11-minute segments (A + B), while S2 (1968\u201369)
      // ran full 22-minute episodes with no segmentation. We give
      // A and B their own catalog entries by doubling the slot
      // number (slot*2-1 for A, slot*2 for B); S2's solo episodes
      // use the slot number directly. Solo segments in S1/S3 (a
      // handful of slots aired with only one segment, e.g. "3 - The
      // Menace Of Mysterio") map to the "A" position, leaving the
      // matching "B" slot empty \u2014 the resulting gap reflects the
      // original broadcast structure rather than papering over it.
      const pathSeason = file.match(/(?:^|\/)Season (\d) /i);
      if (!pathSeason) return null;
      const season = Number(pathSeason[1]);
      const m = basename(file).match(/^(\d{1,2})([AB])? - (.+)\.mp4$/i);
      if (!m) return null;
      const slot = Number(m[1]);
      const seg = (m[2] || '').toUpperCase();
      const title = m[3].trim();
      if (season === 2) {
        return { season, episode: slot, title };
      }
      const episode = seg === 'B' ? slot * 2 : slot * 2 - 1;
      return { season, episode, title };
    }
  },
  {
    id: 'tick',
    name: 'The Tick (1994)',
    shortName: 'The Tick',
    emoji: '🦟',
    accent: '#2563eb',
    tags: ['animation', 'kids', 'superhero', 'comedy', '90s'],
    tagline:
      'SPOON! \u00b7 Ben Edlund\u2019s nigh-invulnerable big-blue lummox + Arthur the moth-suit accountant \u00b7 all 3 Fox Kids seasons (1994\u201396)',
    iaItem: 'the-tick-full-series',
    tvmazeId: 1669,
    imdbId: 'tt0112196',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "S1E01 - The Tick vs. The Idea Men.mp4". The IA file ships
      // with the "MPEG4" format tag but the actual codec is H.264
      // inside an MP4 container (verified via ftyp/avc1 box), so
      // browser playback works despite the misleading label.
      const m = basename(file).match(/^S(\d)E(\d{2}) - (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'sonic-satam',
    name: 'Sonic the Hedgehog (SatAM)',
    shortName: 'Sonic SatAM',
    emoji: '💙',
    accent: '#1d4ed8',
    tags: ['animation', 'kids', 'action', 'sci-fi', '90s'],
    tagline:
      'Sonic, Sally, Bunnie, and Antoine\u2019s Freedom Fighters vs. Robotnik in dystopian Mobotropolis \u00b7 the 1993 ABC Saturday-morning cartoon, all 26 episodes (S1+S2)',
    iaItem: 'Sonic-the-Hedgehog-SatAM-The-Complete-Series-Restored',
    tvmazeId: 19092,
    imdbId: 'tt0106140',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "01. S1E13 Heads or Tails.mp4". The leading "NN." is a
      // playback-order prefix the uploader added so the pilot
      // ("Heads or Tails", broadcast as S1E13 but chronologically
      // first) plays before the rest of S1. We ignore that prefix
      // and use the SxEx token as the authoritative episode id.
      const m = basename(file).match(/^\d{2}\. S(\d)E(\d{1,2}) (.+)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'southpark',
    name: 'South Park',
    shortName: 'South Park',
    emoji: '⛰️',
    accent: '#ff7a00',
    tags: ['animation', 'adult', 'comedy', 'satire', '90s'],
    tagline: "Colorado's worst-behaved fourth-graders · S0–S20",
    iaItem: 'northplayground',
    tvmazeId: 112,
    imdbId: 'tt0121955',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      const base = basename(file);
      // Main episodes: "South Park S01E03 Volcano [R].mp4"
      // The "[R]" suffix marks the remastered re-rip; strip it from
      // titles.
      const main = base.match(/^South\s+Park\s+S(\d{1,2})E(\d{1,2})\s+(.*?)(?:\s*\[R\])?\.mp4$/i);
      if (main) {
        return { season: Number(main[1]), episode: Number(main[2]), title: main[3].trim() };
      }
      // Pre-broadcast shorts live under "South Park S00 The Spirit
      // of Christmas (...)/" and are filed as season 0.
      const special = base.match(/^The\s+Spirit\s+of\s+Christmas\s+E(\d{1,2})\s+(.*)\.mp4$/i);
      if (special) {
        return { season: 0, episode: Number(special[1]), title: special[2].trim() };
      }
      return null;
    }
  },
  {
    id: 'tmnt',
    name: 'Teenage Mutant Ninja Turtles (1987)',
    shortName: 'TMNT',
    emoji: '🐢',
    accent: '#3aa84a',
    tags: ['animation', 'kids', 'action', '80s'],
    tagline: 'Heroes in a half shell, 1080p AI upscale · S1–S2, S3 Part 2, S5, S9–S10',
    iaItem: ['tmnt-season-1-2', 'tmnt-season-3-2', 'tmnt-s05', 'tmnt-season-9-10'],
    tvmazeId: 4159,
    imdbId: 'tt0131613',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // Two filename styles ship side-by-side because the season
      // packs come from different uploads:
      //   "Teenage Mutant Ninja Turtles - 01x01 - Turtle Tracks.mp4"
      //   "05x01 - Donatello`s Badd Time.mp4"
      // The leading show-name prefix is therefore optional; the
      // season and episode live in the `NNxNN` token, not in SxxExx.
      const m = basename(file).match(
        /^(?:Teenage Mutant Ninja Turtles - )?(\d{1,2})x(\d{1,3})\s*-\s*(.*)\.mp4$/i
      );
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'twilight-zone',
    name: 'The Twilight Zone (1959)',
    shortName: 'Twilight Zone',
    emoji: '🌀',
    accent: '#0ea5e9',
    tags: ['live-action', 'sci-fi', 'anthology', '60s'],
    tagline:
      "Submitted for your approval · Rod Serling's 1959 B&W debut season + the original pilot",
    iaItem: 'the-twilight-zone-1959-s-01-e-00-original-pilot',
    tvmazeId: 787,
    imdbId: 'tt0052520',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "The Twilight Zone 1959 S01E00 Original Pilot.mp4"
      // "The Twilight Zone 1959 S01E18 The Last Flight.mp4"
      // Item ships the original 1959 black-and-white run only — pilot
      // (S01E00) plus all 36 regular S1 episodes. Seasons 2–5 exist on
      // IA but only as colorized 720p remasters by a different uploader,
      // which is a quality regression we don't bake into this entry.
      // The pilot lands at episode 0; TVMaze's S1 numbering starts at
      // 1 so its description graft skips the pilot — the filename
      // title carries through unchanged.
      const m = basename(file).match(/^The Twilight Zone 1959 S(\d{1,2})E(\d{1,2}) (.*)\.mp4$/i);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  },
  {
    id: 'voltron',
    name: 'Voltron - Vehicle Force',
    shortName: 'Voltron',
    emoji: '🤖',
    accent: '#2563eb',
    tags: ['animation', 'anime', 'action', '80s'],
    tagline: 'Fifteen vehicles, one defender · all 52 episodes of the 1984 Vehicle Force series',
    iaItem: 'voltron-the-defender-of-the-universe-vehicle-force-1984',
    tvmazeId: 18006,
    imdbId: 'tt0086824',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Voltron Vehicle Force - 01 - In Search Of New Worlds.mp4"
      // Single-season run, episodes 1..52, no S/E prefix in the
      // filenames so we hardcode season 1. The TVMaze entry
      // (id=18006, "Voltron: Defender of the Universe") is for the
      // Lion Force series — descriptions/stills won't line up with
      // Vehicle Force, same intentional tradeoff as DBZ. Episode
      // titles in the filenames are the real ones, and the player
      // falls back to the archive thumbnail.
      const m = basename(file).match(/^Voltron Vehicle Force - (\d{1,2}) - (.*)\.mp4$/i);
      if (!m) return null;
      return { season: 1, episode: Number(m[1]), title: m[2].trim() };
    }
  },
  {
    id: 'voyagers',
    name: 'Voyagers!',
    shortName: 'Voyagers',
    emoji: '⏳',
    accent: '#0ea5e9',
    tags: ['live-action', 'sci-fi', '80s'],
    tagline:
      "Phineas Bogg and Jeffrey Jones zip through history fixing the Omni's red-and-green readouts · NBC's 1982 single-season time-travel cult show",
    iaItem: 'voyagers-complete-series-1982',
    tvmazeId: 1507,
    imdbId: 'tt0083500',
    acceptFile: defaultAcceptMp4,
    parser: (file) => {
      // "Voyagers! - S01E01 (Pilot).mp4". Titles ship inside
      // parentheses; we keep the parens since they were the
      // dump's chosen convention (TVMaze stores them differently
      // and will overwrite on graft if descriptions are requested).
      const m = basename(file).match(/^Voyagers! - S(\d{2})E(\d{2}) \((.+)\)\.mp4$/);
      if (!m) return null;
      return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
    }
  }
].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Look up a show by id.
 *
 * @param {string} id
 * @returns {ShowConfig|null}
 */
export function getShow(id) {
  return SHOWS.find((s) => s.id === id) || null;
}
