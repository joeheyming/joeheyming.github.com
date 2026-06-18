/**
 * Bespoke JS parsers for the three shows whose filename-to-episode
 * mapping cannot be expressed as a {@link ParserSpec} in the sheet.
 *
 * A parser is "unencodable" (i.e. needs to live here rather than in
 * the sheet) when it needs runtime logic beyond regex + capture-group
 * plumbing. These three qualify:
 *
 *   - `dnd`        — alphabetic-suffix → episode offset arithmetic
 *                    (`S03E07a` and `S03E07b` map to E07 + E08, and
 *                    their titles get `(Part 1)` / `(Part 2)` tacked on).
 *   - `gi-joe`     — branches on `itemId` because three sibling IA
 *                    items (`gi-joe-1/2/3`) share an unqualified
 *                    `N. Title.mp4` shape; one branch also assigns
 *                    season 0 + a multi-mini arithmetic episode index.
 *   - `spider-man` — A/B segment doubling on S1 + S3 with S2's solo
 *                    episodes using slot-as-episode directly.
 *
 * The sheet row stores `parserKind='js'` for these shows; the runtime
 * loader looks them up by id here. Adding a fourth bespoke parser is
 * a deliberate act: prefer a {@link ParserSpec} in the sheet whenever
 * the show fits the regex schema.
 */

/** @param {string} file */
function basename(file) {
  const i = file.lastIndexOf('/');
  return i >= 0 ? file.slice(i + 1) : file;
}

/** @type {Record<string, (file: string, itemId?: string) => ({season: number, episode: number, title: string}|null)>} */
export const JS_PARSERS = {
  dnd(file) {
    // "Dungeons and Dragons - S01E01 (The Night of No Tomorrow).mp4".
    // The lost finale "Requiem" exists in the archive as S03E07a +
    // S03E07b; we map those to E07 + E08 so both halves are reachable
    // and S03's canonical 6-episode run stays intact.
    const m = basename(file).match(
      /^Dungeons and Dragons - S(\d{1,2})E(\d{1,2})([a-z]?)\s*\(([^)]+)\)\.mp4$/i
    );
    if (!m) return null;
    const suffix = m[3].toLowerCase();
    const offset = suffix ? suffix.charCodeAt(0) - 'a'.charCodeAt(0) : 0;
    const baseTitle = m[4].trim();
    const title = suffix ? `${baseTitle} (Part ${offset + 1})` : baseTitle;
    return { season: Number(m[1]), episode: Number(m[2]) + offset, title };
  },

  'gi-joe'(file, itemId) {
    const base = basename(file);
    if (itemId === 'gi-joe-1') {
      // "1-1. The M.A.S.S. Device Part 1.mp4" — `M-N. Title.mp4`
      // where M is the mini number (1 = MASS Device, 2 = Revenge of
      // Cobra) and N is part 1..5. Both minis are pre-S1 specials;
      // we collapse them into "Season 0" with episodes 1..10.
      const m = base.match(/^(\d+)-(\d+)\. (.*)\.mp4$/i);
      if (!m) return null;
      const mini = Number(m[1]);
      const part = Number(m[2]);
      return { season: 0, episode: (mini - 1) * 5 + part, title: m[3].trim() };
    }
    // gi-joe-2 = 1985 S1; gi-joe-3 = 1986 S2 (plus the 1987 movie
    // file, which doesn't match this regex and falls through as null
    // — the movie lives as a separate `type='movie'` sheet row).
    const season = itemId === 'gi-joe-3' ? 2 : 1;
    const m = base.match(/^(\d+)\. (.*)\.mp4$/i);
    if (!m) return null;
    return { season, episode: Number(m[1]), title: m[2].trim() };
  },

  'spider-man'(file) {
    // Path: "Season N (YYYY-YYYY)/<slot>[A|B] - Title.mp4". The show
    // aired in two formats simultaneously: S1 (1967–68) and S3 (1970)
    // split each 22-minute broadcast into two 11-minute segments (A
    // + B); S2 (1968–69) ran full 22-minute episodes with no segments.
    // We give A and B their own catalog entries (slot*2-1 / slot*2);
    // S2 uses the slot number directly. Solo segments in S1/S3 land
    // in the "A" slot, leaving the matching "B" slot empty — that
    // gap reflects the original broadcast structure.
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
};

/**
 * Look up a bespoke JS parser by show id. Returns `null` for ids
 * that don't need a JS parser (`parserKind` is `regex`/`generic`/etc).
 * @param {string} id
 */
export function getJsParser(id) {
  return JS_PARSERS[id] || null;
}
