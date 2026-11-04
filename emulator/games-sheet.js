// Game library for the /emulator/ shell, read from a Google Sheet the
// same way /watch/ reads its show registry.
//
// The sheet is the list: one row per game, with the file URL and the
// box-art URL already filled in. Play in browser still downloads that
// file URL through the Internet Archive client (CDN rewrite + proxy).
// Console records in consoles.js stay the source for cores, BIOS, and
// the Archive items `scripts/dump-emulator-games.mjs` reads.
//
// The live registry is
// https://docs.google.com/spreadsheets/d/1qLJ3-k50ZvMmpxeO9C-72G9uat9BnYYezZC-nKmFzaY
// It has to stay shared as "Anyone with the link → Viewer". A 401 or
// other gviz failure falls back to listing the Archive item live.
// Prefer a tab named
// `games`; if that tab is missing, the first worksheet is used.
// Regenerate the rows with scripts/dump-emulator-games.mjs.
//
// Columns: console, name, downloadUrl, thumbnailUrl, fileExtension, size.
// `console` is the id from consoles.js (`nes`, `snes`, `gba`, `flash`, …).
// One CSV, one tab.
// Sheet order is the order cards render. A bad row is skipped.
(function () {
  'use strict';

  const SHEET_ID = '1qLJ3-k50ZvMmpxeO9C-72G9uat9BnYYezZC-nKmFzaY';
  const TAB = 'games';

  /** @type {{ sheetId: string }} */
  const state = { sheetId: SHEET_ID };

  /** @type {Map<string, Promise<object[]>>} */
  const cache = new Map();

  function isConfigured() {
    const id = String(state.sheetId || '');
    return id.length > 0 && !id.includes('YOUR_SHEET_ID');
  }

  /**
   * @param {string} id
   */
  function setSheetId(id) {
    state.sheetId = String(id || '');
    cache.clear();
  }

  /**
   * @param {string} [consoleId]
   */
  function clearCache(consoleId) {
    if (consoleId) cache.delete(String(consoleId));
    else cache.clear();
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function httpsUrl(value) {
    const url = String(value == null ? '' : value).trim();
    return /^https:\/\//i.test(url) ? url : '';
  }

  // Small inline images (base64) fit in one sheet cell. Sheets caps a cell
  // at 50,000 characters, so the sheet keeps thumbnails at or under that.
  const IMAGE_DATA_URI = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function thumbnailOf(value) {
    const url = String(value == null ? '' : value).trim();
    if (IMAGE_DATA_URI.test(url)) return url;
    return httpsUrl(url);
  }

  /**
   * @param {unknown} explicit
   * @param {string} downloadUrl
   * @returns {string}
   */
  function fileExtensionOf(explicit, downloadUrl) {
    const given = String(explicit == null ? '' : explicit)
      .trim()
      .toLowerCase();
    if (/^\.[a-z0-9]{1,5}$/.test(given)) return given;
    const path = String(downloadUrl || '')
      .split('?')[0]
      .split('#')[0];
    const match = path.toLowerCase().match(/(\.[a-z0-9]{1,5})$/);
    return match ? match[1] : '.zip';
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function sizeLabel(value) {
    const label = String(value == null ? '' : value).trim();
    return label || 'Unknown';
  }

  /**
   * Turn one sheet row into the ROM shape `<rom-browser>` already paints.
   * Returns null for rows that cannot be played (missing name or a
   * non-https file URL) and for rows that belong to another console.
   *
   * @param {Record<string, unknown> | null | undefined} raw
   * @param {{ consoleId?: string, descriptionPrefix?: string }} [options]
   * @returns {object | null}
   */
  function gameFromRow(raw, options) {
    if (!raw || typeof raw !== 'object') return null;
    const opts = options || {};
    const name = String(raw.name == null ? '' : raw.name).trim();
    const downloadUrl = httpsUrl(raw.downloadUrl);
    if (!name || !downloadUrl) return null;
    const rowConsole = String(raw.console == null ? '' : raw.console).trim();
    if (opts.consoleId && rowConsole !== opts.consoleId) return null;
    const prefix = opts.descriptionPrefix ? String(opts.descriptionPrefix) : '';
    return {
      console: rowConsole,
      name,
      title: name,
      downloadUrl,
      thumbnailUrl: thumbnailOf(raw.thumbnailUrl),
      fileExtension: fileExtensionOf(raw.fileExtension, downloadUrl),
      size: sizeLabel(raw.size),
      description: prefix ? `${prefix}: ${name}` : name
    };
  }

  /**
   * Games for one console, in sheet order. One gviz round-trip per
   * console per page load; a second caller shares the in-flight promise.
   * A failed fetch is not cached, so Retry starts clean.
   *
   * @param {string} consoleId
   * @param {{ descriptionPrefix?: string }} [options]
   * @returns {Promise<object[]>}
   */
  function loadConsoleGames(consoleId, options) {
    const id = String(consoleId || '').trim();
    if (!id) return Promise.reject(new Error('games sheet: missing console id'));
    if (!isConfigured()) return Promise.reject(new Error('games sheet is not configured'));
    const existing = cache.get(id);
    if (existing) return existing;
    const pending = fetchConsoleGames(id, options).catch((err) => {
      cache.delete(id);
      throw err;
    });
    cache.set(id, pending);
    return pending;
  }

  /**
   * @param {unknown} err
   * @returns {boolean}
   */
  function isMissingTab(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return /HTTP 400\b/.test(msg) || /sheet\b.*\bnot found/i.test(msg);
  }

  /**
   * @param {string} consoleId
   * @param {{ descriptionPrefix?: string }} [options]
   * @returns {Promise<object[]>}
   */
  async function fetchConsoleGames(consoleId, options) {
    // gviz only accepts column letters in `where`; a header label such as
    // `console` returns status=error (NO_COLUMN), so column A is the filter.
    const sql = `select * where A = '${escapeSqlValue(consoleId)}'`;
    let rows;
    try {
      rows = await readSheet(TAB, sql);
    } catch (err) {
      // A CSV import often lands on "Sheet1" instead of a tab named games.
      if (!isMissingTab(err)) throw err;
      rows = await readSheet('', sql);
    }
    /** @type {object[]} */
    const games = [];
    for (const row of rows) {
      const game = gameFromRow(row, {
        consoleId,
        descriptionPrefix: options && options.descriptionPrefix
      });
      if (!game) {
        const label = row && row.name ? String(row.name) : '(no name)';
        console.error(`games sheet: skipping ${consoleId} row "${label}"`);
        continue;
      }
      games.push(game);
    }
    return games;
  }

  /**
   * @param {string} tab
   * @param {string} [sql]
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async function readSheet(tab, sql) {
    const url = buildGvizUrl(tab, sql);
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`gviz HTTP ${res.status} for ${tab}`);
    const text = await res.text();
    return rowsToObjects(parseGvizResponse(text));
  }

  /**
   * @param {string} tab
   * @param {string} [sql]
   * @returns {string}
   */
  function buildGvizUrl(tab, sql) {
    const params = new URLSearchParams({
      tqx: 'out:json',
      headers: '1'
    });
    if (tab) params.set('sheet', tab);
    if (sql) params.set('tq', sql);
    return `https://docs.google.com/spreadsheets/d/${state.sheetId}/gviz/tq?${params.toString()}`;
  }

  /**
   * @param {string} text
   * @returns {{ cols: Array<{label?: string, id?: string}>, rows: Array<{c: Array<{v: unknown}|null>}> }}
   */
  function parseGvizResponse(text) {
    const start = text.indexOf('(');
    const end = text.lastIndexOf(')');
    if (start < 0 || end < 0 || end <= start) {
      throw new Error('gviz response missing jsonp wrapper');
    }
    /** @type {{ status?: string, errors?: Array<{detailed_message?: string, message?: string}>, table?: unknown }} */
    const parsed = JSON.parse(text.slice(start + 1, end));
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
   * @param {{ cols: Array<{label?: string, id?: string}>, rows: Array<{c: Array<{v: unknown}|null>}> }} table
   * @returns {Array<Record<string, unknown>>}
   */
  function rowsToObjects(table) {
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
        const value = cell && cell.v !== undefined ? cell.v : null;
        obj[keys[i]] = value;
        if (value !== null && value !== '') anyValue = true;
      }
      if (anyValue) out.push(obj);
    }
    return out;
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function escapeSqlValue(value) {
    return String(value).replace(/'/g, "''");
  }

  window.emulatorGamesSheet = {
    isConfigured,
    loadConsoleGames,
    clearCache,
    gameFromRow,
    parseGvizResponse,
    rowsToObjects,
    buildGvizUrl,
    escapeSqlValue,
    __testing: { setSheetId, TAB, SHEET_ID }
  };
})();
