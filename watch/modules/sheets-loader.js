/**
 * Read the `Watch` Google Sheet — slim authoritative registry for the
 * /watch/ player. Sheet has one tab (`subjects`) with ~76 rows; per-
 * episode lists are derived at runtime by `catalog.js` from each
 * subject's archive.org item + parser (regex spec, generic
 * SxxExx matcher, or bespoke JS — see {@link subjectToShowConfig}).
 *
 * Why no `episodes` tab any more: storing the URL for every episode
 * is the recipe + its output side-by-side. The recipe (parser spec +
 * iaItem) already lives on the subject row, and catalog.js can
 * regenerate the episode list from archive.org on demand in <1
 * round-trip per show (heavily cached client-side). Removing the
 * episodes tab dropped the sheet from ~941 KB to ~28 KB and turned
 * "add a show" into a one-row edit.
 *
 * Sheet ID `117LmsqWtmBJ9Jo6RVs-AIfkosriMiPdP0riIl9XS-xE` is shared
 * "Anyone with the link → Viewer" so the gviz endpoint accepts
 * anonymous reads. Schema lives in {@link SubjectRow} below.
 *
 * No cross-session caching: every cold page load (fresh tab,
 * reload, navigation into /watch/ from elsewhere) hits gviz fresh.
 * `data-source.js` holds the resolved arrays in module-scope memory
 * so within a single page session the round-trip happens at most
 * once. This trades a ~500-1500ms cold-start cost for catching
 * sheet edits immediately — the previous 6h localStorage TTL made
 * authoring painful (edits invisible without `localStorage.clear()`)
 * and let a single bad row poison the page for hours after it was
 * fixed upstream. If gviz outages bite in practice we'll revisit
 * with stale-while-revalidate.
 */

import { compileSerialized } from './parser-specs.js';
import { getJsParser } from './parsers-js.js';

const SHEET_ID = '117LmsqWtmBJ9Jo6RVs-AIfkosriMiPdP0riIl9XS-xE';
const BASE_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`;

/**
 * One raw row from the `subjects` tab — gviz cell values straight
 * through, no coercion. Use {@link subjectToShowConfig} /
 * {@link subjectToMovieConfig} to turn one into the runtime-shaped
 * ShowConfig / MovieConfig that `catalog.js` expects.
 *
 * Only `id` and `type` are required — everything else is optional
 * because the sheet can ship empty cells, and the row→config
 * transformers (`subjectToShowConfig`, `subjectToMovieConfig`)
 * tolerate missing values with `||` fallbacks. The tests in
 * `sheets-loader.test.mjs` rely on being able to construct minimal
 * SubjectRow values for negative-path / parser-only assertions.
 *
 * @typedef {Object} SubjectRow
 * @property {string} id
 * @property {'show'|'movie'} type
 * @property {string} [name]
 * @property {string} [shortName]
 * @property {string} [emoji]
 * @property {string} [accent]
 * @property {string} [tags]                     Comma-separated; split when used.
 * @property {string} [tagline]
 * @property {string} [iaItem]                   Comma-separated for multi-item shows.
 * @property {number|null} [tvmazeId]
 * @property {string} [imdbId]
 * @property {string} [posterUrl]
 * @property {'generic'|'regex'|'js'|'movie-file'|'movie-first-mp4'} [parserKind]
 * @property {string} [parserSpec]               JSON {@link ParserSpec} when parserKind='regex'.
 * @property {''|'any-mp4'|'ia-mp4-only'} [acceptFile]
 * @property {string} [iaFile]                   Exact basename pick for movie-file.
 * @property {string} [language]
 *   Expected audio language of the IA upload, ISO 639-1 (`en`, `pt`,
 *   `ja`…) or 639-3 (`eng`, `por`, `jpn`…). Authoritative source for
 *   `scripts/verify-content.local.mjs --check-language`, which ffprobes
 *   one episode per show and warns when the actual audio doesn't match.
 *   Defaults to `en` for unset cells — the catalog is overwhelmingly
 *   English so the column only needs filling in for non-English uploads.
 *   Use `und` to explicitly silence the check for items whose audio
 *   stream has no `TAG:language=` tag and isn't worth re-tagging by
 *   hand. Bilingual uploads can list comma-separated values (`en, ja`).
 */

// ──────────── public API ────────────

/**
 * All subjects in the registry, in sheet order (alphabetical-by-id).
 * Callers (currently just `data-source.js`) split into shows and
 * movies by `row.type` and pipe each through
 * {@link subjectToShowConfig} / {@link subjectToMovieConfig}.
 *
 * @returns {Promise<SubjectRow[]>}
 */
export async function loadSubjects() {
  const rows = /** @type {Array<Record<string, unknown>>} */ (await readSheet('subjects'));
  return rows.map(normalizeSubjectRow);
}

/**
 * Turn one `type='show'` subject row into a runtime
 * {@link import('./shows.js').ShowConfig}. Synthesizes:
 *
 *   - `parser`: a `(file, itemId) => result|null` function based on
 *     `parserKind`. `'generic'` returns no parser (catalog.js falls
 *     back to `makeGenericParser(descriptions)`); `'regex'` compiles
 *     `parserSpec`; `'js'` looks up the bespoke parser by id.
 *   - `acceptFile`: a `(rawFile) => boolean` based on the enum in
 *     the `acceptFile` column. Empty = default (plain `.mp4`, skip
 *     `.ia.mp4`). The two non-default flavors (`any-mp4`, `ia-mp4-only`)
 *     cover Beavis and Robotech respectively.
 *
 * Throws if the row has `parserKind='regex'` but no `parserSpec`, or
 * `parserKind='js'` but no bespoke parser registered for `id` — both
 * are sheet authoring bugs and should fail loud rather than silent.
 *
 * @param {SubjectRow} row
 * @returns {import('./shows.js').ShowConfig}
 */
export function subjectToShowConfig(row) {
  if (row.type !== 'show') {
    throw new Error(`subjectToShowConfig: row ${row.id} has type=${row.type}, expected 'show'`);
  }
  return {
    id: row.id,
    name: row.name || '',
    shortName: row.shortName || row.name || '',
    emoji: row.emoji || '',
    accent: row.accent || '',
    tags: splitTags(row.tags),
    tagline: row.tagline || '',
    iaItem: parseIaItem(row.iaItem),
    tvmazeId: row.tvmazeId == null ? 0 : Number(row.tvmazeId),
    imdbId: row.imdbId || '',
    posterUrl: row.posterUrl || '',
    parser: makeShowParser(row),
    acceptFile: makeAcceptFile(row.acceptFile)
  };
}

/**
 * Turn one `type='movie'` subject row into a runtime
 * {@link import('./movies.js').MovieConfig}. `kind: 'movie'` is
 * stamped so downstream views can branch (the player hides
 * prev/next, the home grid swaps the badge, etc.).
 *
 * @param {SubjectRow} row
 * @returns {import('./movies.js').MovieConfig}
 */
export function subjectToMovieConfig(row) {
  if (row.type !== 'movie') {
    throw new Error(`subjectToMovieConfig: row ${row.id} has type=${row.type}, expected 'movie'`);
  }
  return {
    kind: /** @type {const} */ ('movie'),
    id: row.id,
    name: row.name || '',
    shortName: row.shortName || row.name || '',
    emoji: row.emoji || '',
    accent: row.accent || '',
    tags: splitTags(row.tags),
    tagline: row.tagline || '',
    iaItem: row.iaItem || '',
    iaFile: row.iaFile || '',
    tvmazeId: row.tvmazeId == null ? 0 : Number(row.tvmazeId),
    imdbId: row.imdbId || '',
    posterUrl: row.posterUrl || '',
    acceptFile: makeAcceptFile(row.acceptFile)
  };
}

// ──────────── helpers — exported for tests ────────────

/**
 * @internal
 * @param {Record<string, unknown>} raw
 * @returns {SubjectRow}
 */
export function normalizeSubjectRow(raw) {
  // gviz columns map directly to property names via the header row.
  // We pass everything through but normalise the few that need it:
  // tvmazeId stays numeric (gviz already returns it as a number);
  // null/undefined strings collapse to ''; tags/iaItem stay raw
  // strings until split by the caller.
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number') out[k] = v;
    else if (v == null) out[k] = '';
    else out[k] = String(v);
  }
  return /** @type {SubjectRow} */ (out);
}

/**
 * @internal
 * @param {string | undefined | null} raw
 * @returns {string[]}
 */
export function splitTags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Parse the iaItem cell. Multi-item shows (gi-joe with three Sunbow
 * uploads, the Avengers two-disk dump, etc.) write a comma-separated
 * list; single-item shows write a bare id. We return a string for
 * single items and an array for multi to match the historical
 * ShowConfig.iaItem shape catalog.js expects.
 *
 * @internal
 * @param {string | undefined | null} raw
 * @returns {string | string[]}
 */
export function parseIaItem(raw) {
  if (!raw) return '';
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length === 1 ? parts[0] : parts;
}

/**
 * Build the parser function for a show subject. Returns `null` for
 * `parserKind='generic'` so catalog.js's `getMergedCatalog` path
 * falls through to TVMaze + the generic SxxExx matcher (its
 * "no inline parser" branch).
 *
 * @internal
 * @param {SubjectRow} row
 */
export function makeShowParser(row) {
  switch (row.parserKind) {
    case 'generic':
      return null;
    case 'regex': {
      if (!row.parserSpec) {
        throw new Error(`subject ${row.id}: parserKind=regex but parserSpec is empty`);
      }
      let json;
      try {
        json = JSON.parse(row.parserSpec);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`subject ${row.id}: parserSpec is not valid JSON (${msg})`);
      }
      return compileSerialized(json);
    }
    case 'js': {
      const fn = getJsParser(row.id);
      if (!fn) {
        throw new Error(
          `subject ${row.id}: parserKind=js but no entry in watch/modules/parsers-js.js`
        );
      }
      return fn;
    }
    default:
      throw new Error(`subject ${row.id}: unknown parserKind=${row.parserKind}`);
  }
}

/**
 * Build an `acceptFile(raw)` function from the sheet's enum value.
 * `''` (the default) maps to the same predicate `catalog.js` uses
 * when a show omits `acceptFile`: plain `.mp4` only, skip `.ia.mp4`.
 *
 * @internal
 * @param {string | undefined} kind
 * @returns {(raw: { name?: unknown, format?: unknown }) => boolean}
 */
export function makeAcceptFile(kind) {
  switch (kind || '') {
    case '':
      return (raw) => {
        const name = typeof raw?.name === 'string' ? raw.name : '';
        return /\.mp4$/i.test(name) && !/\.ia\.mp4$/i.test(name);
      };
    case 'any-mp4':
      return (raw) => {
        const name = typeof raw?.name === 'string' ? raw.name : '';
        return /\.mp4$/i.test(name);
      };
    case 'ia-mp4-only':
      return (raw) => {
        const name = typeof raw?.name === 'string' ? raw.name : '';
        return /\.ia\.mp4$/i.test(name);
      };
    default:
      throw new Error(`unknown acceptFile kind: ${kind}`);
  }
}

// ──────────── gviz fetch ────────────

/**
 * Pull a tab (optionally filtered by a gviz SQL `tq` expression) and
 * return its rows as plain objects keyed by header. No caching here:
 * `data-source.js` holds the result in module-scope memory for the
 * lifetime of the page, but each fresh page load pays one round-trip
 * — the deliberate price for not serving stale catalog data after a
 * sheet edit. See the module header for the longer rationale.
 *
 * @internal
 * @param {string} tab
 * @param {string} [sql]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function readSheet(tab, sql) {
  const url = buildGvizUrl(tab, sql);
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`gviz HTTP ${res.status} for ${tab}`);
  const text = await res.text();
  const table = parseGvizResponse(text);
  return rowsToObjects(table);
}

/**
 * @internal
 * @param {string} tab
 * @param {string} [sql]
 */
export function buildGvizUrl(tab, sql) {
  const params = new URLSearchParams({
    tqx: 'out:json',
    sheet: tab,
    headers: '1'
  });
  if (sql) params.set('tq', sql);
  return `${BASE_URL}?${params.toString()}`;
}

/**
 * Strip the `/*O_o*\/google.visualization.Query.setResponse(...)` jsonp
 * wrapper gviz prefixes every response with, and return the inner
 * `table` object.
 *
 * @internal
 * @param {string} text
 * @returns {{ cols: Array<{label?: string, id?: string}>, rows: Array<{c: Array<{v: unknown}|null>}> }}
 */
export function parseGvizResponse(text) {
  // Two flavors of wrapper:
  //   /*O_o*/
  //   google.visualization.Query.setResponse({ ...json... });
  // …and a legacy form with just `setResponse({...})`. Anchor on the
  // first `(` and last `)` to be tolerant of both.
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('gviz response missing jsonp wrapper');
  }
  const json = text.slice(start + 1, end);
  /** @type {{ status?: string, errors?: Array<{detailed_message?: string, message?: string}>, table?: unknown }} */
  const parsed = JSON.parse(json);
  if (parsed.status !== 'ok') {
    const err = parsed.errors && parsed.errors[0];
    const detail = err ? err.detailed_message || err.message || 'unknown' : 'unknown';
    throw new Error(`gviz status=${parsed.status}: ${detail}`);
  }
  if (!parsed.table || typeof parsed.table !== 'object') {
    throw new Error('gviz response missing .table');
  }
  return /** @type {{ cols: Array<{label?: string, id?: string}>, rows: Array<{c: Array<{v: unknown}|null>}> }} */ (
    parsed.table
  );
}

/**
 * Convert gviz's `{cols, rows}` table shape to an array of plain
 * objects keyed by column header. Empty cells become `null`; empty
 * rows (every cell null) are filtered out — gviz sometimes returns
 * trailing phantom rows when the sheet has gaps.
 *
 * @internal
 * @param {{ cols: Array<{label?: string, id?: string}>, rows: Array<{c: Array<{v: unknown}|null>}> }} table
 * @returns {Array<Record<string, unknown>>}
 */
export function rowsToObjects(table) {
  const cols = Array.isArray(table.cols) ? table.cols : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const keys = cols.map((col, i) => col.label || col.id || `col${i}`);
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const row of rows) {
    if (!row || !Array.isArray(row.c)) continue;
    /** @type {Record<string, unknown>} */
    const obj = {};
    let anyValue = false;
    for (let i = 0; i < keys.length; i += 1) {
      const cell = row.c[i];
      const v = cell && cell.v !== undefined ? cell.v : null;
      obj[keys[i]] = v;
      if (v !== null && v !== '') anyValue = true;
    }
    if (anyValue) out.push(obj);
  }
  return out;
}

/**
 * Escape a string literal for inclusion in a gviz SQL `where A='…'`
 * filter. gviz uses single quotes for string literals, doubled to
 * escape: `'O''Brien'`. Cheap insurance even though our ids only
 * contain lowercase + hyphens.
 *
 * @internal
 * @param {unknown} v
 */
export function escapeSqlValue(v) {
  return String(v).replace(/'/g, "''");
}

export const __testing = { SHEET_ID, BASE_URL };
