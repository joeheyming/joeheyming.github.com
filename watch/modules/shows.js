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
 * @typedef {Object} ShowConfig
 * @property {string} id              Slug used in URLs (?show=ID) + storage keys.
 * @property {string} name            Full display name ("The Simpsons").
 * @property {string} shortName       Compact label ("Simpsons").
 * @property {string} emoji
 * @property {string} accent          Hex color used in chip/highlight gradients.
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
 * @property {(filename: string) => ({ season: number, episode: number, title: string } | null)} parser
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
    id: 'aqua-teen',
    name: 'Aqua Teen Hunger Force',
    shortName: 'ATHF',
    emoji: '🍟',
    accent: '#d4ae3a',
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
    id: 'beavis',
    name: 'Beavis and Butt-Head',
    shortName: 'Beavis',
    emoji: '🤘',
    accent: '#ff4b3a',
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
    id: 'dbz',
    name: 'Dragon Ball Z',
    shortName: 'DBZ',
    emoji: '🔥',
    accent: '#ff8c00',
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
    id: 'dnd',
    name: 'Dungeons & Dragons',
    shortName: 'D&D',
    emoji: '🐉',
    accent: '#c14b1d',
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
    id: 'inspector-gadget',
    name: 'Inspector Gadget',
    shortName: 'Gadget',
    emoji: '🕵️',
    accent: '#7fbf3f',
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
    id: 'robotech',
    name: 'Robotech',
    shortName: 'Robotech',
    emoji: '🚀',
    accent: '#dc2626',
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
    id: 'southpark',
    name: 'South Park',
    shortName: 'South Park',
    emoji: '⛰️',
    accent: '#ff7a00',
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
    id: 'voltron',
    name: 'Voltron - Vehicle Force',
    shortName: 'Voltron',
    emoji: '🤖',
    accent: '#2563eb',
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
