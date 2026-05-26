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
 *   3. Write a `parser(filename)` that returns
 *      `{ season, episode, title }` or null. The runner walks the
 *      archive's file list and drops anything the parser rejects.
 *   4. (Optional) override `acceptFile(raw)` if the default mp4-only
 *      filter is wrong for this show (e.g. the only mp4s available are
 *      `.ia.mp4` derivatives, or there's an alternate container to
 *      ignore).
 */

/**
 * @typedef {Object} ShowConfig
 * @property {string} id              Slug used in URLs (?show=ID) + storage keys.
 * @property {string} name            Full display name ("The Simpsons").
 * @property {string} shortName       Compact label ("Simpsons").
 * @property {string} emoji
 * @property {string} accent          Hex color used in chip/highlight gradients.
 * @property {string} tagline         One-line description for the show card.
 * @property {string} iaItem          archive.org item identifier.
 * @property {number} tvmazeId        TVMaze numeric id (for descriptions + stills).
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

/* ---------- The Simpsons (doh_20240725) -------------------------- */

function parseSimpsons(file) {
  // "The Simpsons S01, E01 - Bart the Genius.mp4" — tolerates `S01,E01`,
  // `S01 E01`, and a missing dash before the title.
  const m = basename(file).match(/^The\s+Simpsons\s+S(\d{1,2}),?\s*E(\d{1,2})\s*-?\s*(.*)\.mp4$/i);
  if (!m) return null;
  return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
}

function isSimpsonsMovie(name) {
  // Filename uses the anti-takedown spelling "Zhe Simpsons Movie".
  return /Zhe\s+Simpsons\s+Movie/i.test(name);
}

/* ---------- South Park (northplayground) ------------------------- */

function parseSouthPark(file) {
  const base = basename(file);
  // Main episodes: "South Park S01E03 Volcano [R].mp4"
  // The "[R]" suffix marks the remastered re-rip; strip it from titles.
  const main = base.match(/^South\s+Park\s+S(\d{1,2})E(\d{1,2})\s+(.*?)(?:\s*\[R\])?\.mp4$/i);
  if (main) {
    return { season: Number(main[1]), episode: Number(main[2]), title: main[3].trim() };
  }
  // Pre-broadcast shorts live under "South Park S00 The Spirit of
  // Christmas (...)/" and are filed as season 0.
  const special = base.match(/^The\s+Spirit\s+of\s+Christmas\s+E(\d{1,2})\s+(.*)\.mp4$/i);
  if (special) {
    return { season: 0, episode: Number(special[1]), title: special[2].trim() };
  }
  return null;
}

/* ---------- Beavis and Butt-Head -------------------------------- */

function parseBeavis(file) {
  // Filenames look like "S4/S4 EP 01 Wall Of Youth.mp4". S8 only has
  // `.ia.mp4` derivatives so the show-level acceptFile keeps both.
  const base = basename(file);
  const m = base.match(/^S(\d+)\s+EP\s+(\d+)\s+(.*?)(?:\.ia)?\.mp4$/i);
  if (!m) return null;
  return { season: Number(m[1]), episode: Number(m[2]), title: m[3].trim() };
}

function acceptBeavis(raw) {
  // Beavis archive includes some episodes only as .ia.mp4 derivatives;
  // we keep them since there's no plain-mp4 alternative.
  const name = typeof raw?.name === 'string' ? raw.name : '';
  return /\.mp4$/i.test(name);
}

/* ---------- Registry -------------------------------------------- */

/** @type {ShowConfig[]} */
export const SHOWS = [
  {
    id: 'simpsons',
    name: 'The Simpsons',
    shortName: 'Simpsons',
    emoji: '🍩',
    accent: '#ffb800',
    tagline: 'Yellow family of Springfield · 18 seasons + the movie',
    iaItem: 'doh_20240725',
    tvmazeId: 83,
    acceptFile: defaultAcceptMp4,
    parser: parseSimpsons,
    movieDetector: isSimpsonsMovie,
    movieTitle: 'The Simpsons Movie (2007)'
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
    acceptFile: defaultAcceptMp4,
    parser: parseSouthPark
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
    acceptFile: acceptBeavis,
    parser: parseBeavis
  }
];

/**
 * Look up a show by id.
 *
 * @param {string} id
 * @returns {ShowConfig|null}
 */
export function getShow(id) {
  return SHOWS.find((s) => s.id === id) || null;
}

export const __testing = {
  defaultAcceptMp4,
  parseSimpsons,
  parseSouthPark,
  parseBeavis,
  isSimpsonsMovie
};
