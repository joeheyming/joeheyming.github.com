/**
 * Declarative parser specs + a compiler that turns one into a
 * `(file, itemId?) => { season, episode, title } | null` function.
 *
 * Why this module exists: the original /watch/ shipped one bespoke
 * JavaScript function per show that extracted (season, episode, title)
 * from archive.org filenames. Once we moved the show registry into a
 * Google Sheet, those parsers had to become *data* — a few small
 * fields a sheet row can carry. Most parsers (30 of the 33 we had)
 * fit the {@link ParserSpec} schema below and now live as JSON in
 * each row's `parserSpec` column. The 3 holdouts (`dnd`, `gi-joe`,
 * `spider-man`) keep their bespoke JS in `parsers-js.js` and are
 * dispatched by `parserKind='js'` in the sheet.
 *
 * Sheet round-trip:
 *   1. Author / encode: a ParserSpec lives in JS as a plain object
 *      with RegExp literals.
 *   2. {@link serializeSpec} flattens the RegExps to
 *      `{source, flags}` POJOs and JSON.stringifys the result so it
 *      fits in one sheet cell.
 *   3. {@link parseSpec} reverses step 2 at runtime — rehydrates the
 *      RegExps from the stored JSON.
 *   4. {@link compileSpec} turns a hydrated ParserSpec into a parser
 *      function with the same signature the catalog builder calls
 *      (`(filename, itemId) => {season, episode, title} | null`).
 */

/**
 * @typedef {Object} RegexAttempt
 * @property {RegExp} regex
 * @property {boolean} [matchPath]
 *   Run regex against the full file path, not just the basename. The
 *   default (basename-only) is right for almost every show; set this
 *   when the path itself encodes information you need.
 * @property {number} [seasonGroup]   1-based capture group for season.
 * @property {number} [constantSeason]
 *   Used when the filename doesn't carry a season number (e.g. show
 *   is single-season; emit `constantSeason: 1`). Mutually exclusive
 *   with `seasonGroup` and `seasonFromPath`.
 * @property {number} [seasonFromPath]
 *   Look up the season from a separate `pathSeasonRegex` match on the
 *   full path — used by shows that put the season in a directory
 *   name but not in the filename (e.g. Harvey Birdman's `/S 1/EP 01 ...`).
 *   The value is the capture-group index in `pathSeasonRegex`.
 * @property {number} episodeGroup    1-based capture group for episode (required).
 * @property {number} [titleGroup]    1-based capture group for the title text.
 * @property {string} [titleTemplate]
 *   Template used when the filename doesn't carry a title. `{episode}`
 *   and `{season}` are substituted. Used when `titleGroup` is omitted.
 * @property {Array<'trim'|'underscores_to_spaces'|'dots_to_spaces'>} [titleTransforms]
 *   Post-processing applied to the captured title in order. `trim` is
 *   always applied after these as a finishing pass.
 */

/**
 * @typedef {Object} ParserSpec
 * @property {RegExp} [pathReject]
 *   If the full path matches, the file is rejected before any attempt.
 *   Used to skip /Extras/ folders, behind-the-scenes content, etc.
 * @property {RegExp} [basenameReject]
 *   Same as pathReject but applied to the basename. Used to skip a
 *   single named promo or info file inside an otherwise-clean dump.
 * @property {RegExp} [pathSeasonRegex]
 *   Captures a season number from the full file path. Match runs
 *   before any attempt; if it fails the whole file is rejected.
 *   Attempts may then reference its capture via `seasonFromPath`.
 * @property {number} [pathSeasonGroup]
 *   Capture group index in `pathSeasonRegex` (default 1).
 * @property {RegexAttempt[]} attempts
 *   Tried in order; the first one whose `regex` matches wins. Lets a
 *   show whose dump has two filename shapes (e.g. Captain Planet S1
 *   vs S2-6) describe both without branching JS.
 */

/**
 * Strip the directory component of a file path.
 * @param {string} file
 */
function basename(file) {
  const i = file.lastIndexOf('/');
  return i >= 0 ? file.slice(i + 1) : file;
}

/**
 * @param {string} title
 * @param {Array<'underscores_to_spaces'|'dots_to_spaces'|'trim'>} [transforms]
 */
function applyTitleTransforms(title, transforms) {
  let t = title;
  if (transforms) {
    for (const transform of transforms) {
      if (transform === 'underscores_to_spaces') t = t.replace(/_/g, ' ');
      else if (transform === 'dots_to_spaces') t = t.replace(/\./g, ' ');
      else if (transform === 'trim') t = t.trim();
    }
  }
  return t.trim();
}

/**
 * Compile a hydrated ParserSpec into a parser function matching the
 * signature the catalog builder expects:
 * `(file, itemId?) => { season, episode, title } | null`.
 *
 * The compiled function returns `null` on no match (the catalog
 * builder treats that as "skip this file"); on match it returns the
 * three numeric/string fields the rest of the pipeline expects.
 *
 * @param {ParserSpec} spec
 * @returns {(file: string, itemId?: string) => ({season: number, episode: number, title: string}|null)}
 */
export function compileSpec(spec) {
  return (file) => {
    if (spec.pathReject && spec.pathReject.test(file)) return null;
    const base = basename(file);
    if (spec.basenameReject && spec.basenameReject.test(base)) return null;

    let pathSeason = null;
    if (spec.pathSeasonRegex) {
      const pm = file.match(spec.pathSeasonRegex);
      if (!pm) return null;
      pathSeason = Number(pm[spec.pathSeasonGroup ?? 1]);
    }

    for (const attempt of spec.attempts) {
      const target = attempt.matchPath ? file : base;
      const m = target.match(attempt.regex);
      if (!m) continue;

      const season =
        attempt.seasonFromPath != null
          ? pathSeason
          : attempt.seasonGroup != null
          ? Number(m[attempt.seasonGroup])
          : attempt.constantSeason;
      if (season == null || Number.isNaN(season)) continue;

      const episode = Number(m[attempt.episodeGroup]);
      if (Number.isNaN(episode)) continue;

      let title;
      if (attempt.titleGroup != null) {
        title = applyTitleTransforms(m[attempt.titleGroup] ?? '', attempt.titleTransforms);
      } else if (attempt.titleTemplate) {
        title = attempt.titleTemplate
          .replace('{episode}', String(episode))
          .replace('{season}', String(season));
      } else {
        title = '';
      }

      return { season, episode, title };
    }

    return null;
  };
}

/**
 * Convert a ParserSpec to a JSON-safe shape so it can be stored in a
 * single Google Sheet cell. RegExps become `{source, flags}` POJOs;
 * all other fields are passed through.
 *
 * Round-trips with {@link parseSpec}:
 *   `parseSpec(JSON.parse(JSON.stringify(serializeSpec(spec))))`
 *   produces a spec that behaves identically to the original (modulo
 *   `lastIndex` state, which we never depend on).
 *
 * @param {ParserSpec} spec
 * @returns {Record<string, unknown>}
 */
export function serializeSpec(spec) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (spec.pathReject) out.pathReject = regexToJson(spec.pathReject);
  if (spec.basenameReject) out.basenameReject = regexToJson(spec.basenameReject);
  if (spec.pathSeasonRegex) out.pathSeasonRegex = regexToJson(spec.pathSeasonRegex);
  if (spec.pathSeasonGroup != null) out.pathSeasonGroup = spec.pathSeasonGroup;
  out.attempts = spec.attempts.map((a) => {
    /** @type {Record<string, unknown>} */
    const oa = { regex: regexToJson(a.regex), episodeGroup: a.episodeGroup };
    if (a.matchPath) oa.matchPath = a.matchPath;
    if (a.seasonGroup != null) oa.seasonGroup = a.seasonGroup;
    if (a.constantSeason != null) oa.constantSeason = a.constantSeason;
    if (a.seasonFromPath != null) oa.seasonFromPath = a.seasonFromPath;
    if (a.titleGroup != null) oa.titleGroup = a.titleGroup;
    if (a.titleTemplate) oa.titleTemplate = a.titleTemplate;
    if (a.titleTransforms && a.titleTransforms.length) oa.titleTransforms = a.titleTransforms;
    return oa;
  });
  return out;
}

/**
 * Reverse of {@link serializeSpec}: take a JSON-decoded value and
 * rehydrate the RegExp fields. Accepts an already-hydrated spec
 * unchanged (idempotent), so callers don't have to track whether a
 * spec came from the sheet or was built inline.
 *
 * @param {unknown} json
 * @returns {ParserSpec}
 */
export function parseSpec(json) {
  if (!json || typeof json !== 'object') {
    throw new TypeError('parseSpec: expected an object');
  }
  const raw = /** @type {Record<string, unknown>} */ (json);
  /** @type {ParserSpec} */
  const spec = { attempts: [] };
  if (raw.pathReject) spec.pathReject = jsonToRegex(raw.pathReject);
  if (raw.basenameReject) spec.basenameReject = jsonToRegex(raw.basenameReject);
  if (raw.pathSeasonRegex) spec.pathSeasonRegex = jsonToRegex(raw.pathSeasonRegex);
  if (raw.pathSeasonGroup != null) spec.pathSeasonGroup = Number(raw.pathSeasonGroup);

  const attempts = Array.isArray(raw.attempts) ? raw.attempts : [];
  spec.attempts = attempts.map((a) => {
    if (!a || typeof a !== 'object') throw new TypeError('parseSpec: attempt is not an object');
    const ra = /** @type {Record<string, unknown>} */ (a);
    /** @type {RegexAttempt} */
    const attempt = {
      regex: jsonToRegex(ra.regex),
      episodeGroup: Number(ra.episodeGroup)
    };
    if (ra.matchPath) attempt.matchPath = Boolean(ra.matchPath);
    if (ra.seasonGroup != null) attempt.seasonGroup = Number(ra.seasonGroup);
    if (ra.constantSeason != null) attempt.constantSeason = Number(ra.constantSeason);
    if (ra.seasonFromPath != null) attempt.seasonFromPath = Number(ra.seasonFromPath);
    if (ra.titleGroup != null) attempt.titleGroup = Number(ra.titleGroup);
    if (typeof ra.titleTemplate === 'string') attempt.titleTemplate = ra.titleTemplate;
    if (Array.isArray(ra.titleTransforms)) {
      attempt.titleTransforms = /** @type {RegexAttempt['titleTransforms']} */ (
        ra.titleTransforms.filter((t) => typeof t === 'string')
      );
    }
    return attempt;
  });
  return spec;
}

/**
 * Convenience: parseSpec + compileSpec.
 * @param {unknown} json
 */
export function compileSerialized(json) {
  return compileSpec(parseSpec(json));
}

// ──────────── RegExp <-> JSON helpers ────────────

/**
 * @param {unknown} r
 * @returns {{ source: string, flags: string }}
 */
function regexToJson(r) {
  if (r instanceof RegExp) return { source: r.source, flags: r.flags };
  // Already JSON-shaped — pass through. Lets serializeSpec be idempotent.
  if (r && typeof r === 'object' && 'source' in r && typeof r.source === 'string') {
    const flags = 'flags' in r && typeof r.flags === 'string' ? r.flags : '';
    return { source: r.source, flags };
  }
  throw new TypeError('regexToJson: expected RegExp or {source, flags}');
}

/**
 * @param {unknown} j
 * @returns {RegExp}
 */
function jsonToRegex(j) {
  if (j instanceof RegExp) return j;
  if (j && typeof j === 'object' && 'source' in j && typeof j.source === 'string') {
    const flags = 'flags' in j && typeof j.flags === 'string' ? j.flags : '';
    return new RegExp(j.source, flags);
  }
  throw new TypeError('jsonToRegex: expected {source, flags} or RegExp');
}
