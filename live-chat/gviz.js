import { CONFIG } from './config.js';

/**
 * @param {string} tab
 * @param {{ headers?: number }} [options]
 * @returns {Promise<{ cols: string[], rows: unknown[][] }>}
 */
export async function fetchTab(tab, options = {}) {
  const headerCount = Number(options.headers);
  const headerQuery =
    Number.isInteger(headerCount) && headerCount > 0 ? `&headers=${headerCount}` : '';
  const url = `https://docs.google.com/spreadsheets/d/${
    CONFIG.sheetId
  }/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}${headerQuery}`;
  const text = await fetch(url, { cache: 'no-store' }).then((r) => r.text());
  const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!m) throw new Error('gviz parse failed');
  const json = JSON.parse(m[1]);
  if (!json.table || !json.table.rows) return { cols: [], rows: [] };
  const cols = (json.table.cols || []).map((c) => (c && c.label) || '');
  const rows = json.table.rows.map((r) => (r.c || []).map((c) => (c == null ? null : c.v)));
  return { cols, rows };
}

/**
 * @param {unknown} v
 * @returns {number}
 */
export function parseTs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const m = v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
    if (m) {
      // Date(y,m,d) is a calendar day. Keep it on that day everywhere (UTC
      // midnight) so a viewer west of UTC does not see the previous date.
      if (m[4] == null) return Date.UTC(+m[1], +m[2], +m[3]);
      return new Date(+m[1], +m[2], +m[3], +m[4], +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/**
 * False when the cell is only a calendar day. gviz drops the clock if the
 * column's number format has no time, and a made-up midnight would be wrong.
 * @param {unknown} v
 * @returns {boolean}
 */
export function cellHasTime(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0;
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== 'string') return false;
  if (/^Date\(\d+,\d+,\d+\)$/.test(v)) return false;
  if (/^Date\(/.test(v)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return false;
  return v.trim() !== '';
}

/**
 * @param {string[]} cols
 * @param {string[]} names
 */
export function colIndex(cols, names) {
  const lower = cols.map((c) => String(c).toLowerCase().trim());
  for (const name of names) {
    const exact = lower.findIndex((c) => c === name);
    if (exact >= 0) return exact;
  }
  for (const name of names) {
    const i = lower.findIndex((c) => c.includes(name));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Meta!A1 — TRUE / ENABLED / 1 / YES enables chat.
 * @param {unknown} v
 */
export function isEnabledCell(v) {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'enabled' || s === 'yes' || s === '1' || s === 'on';
}

/**
 * @typedef {{
 *   id: string,
 *   ts: number,
 *   hasTime: boolean,
 *   uuid: string,
 *   room: string,
 *   name: string,
 *   message: string
 * }} ChatMessage
 */

/**
 * Plain-text timestamp columns make gviz return blank labels and keep the
 * header row as data. Promote that row when it is clearly the schema.
 * @param {{ cols: string[], rows: unknown[][] }} table
 */
export function normalizeTable(table) {
  const cols = table.cols || [];
  const rows = table.rows || [];
  if (cols.some((col) => String(col || '').trim())) return { cols, rows };
  const first = rows[0];
  if (!first) return { cols, rows };
  const head = first.map((cell) =>
    String(cell ?? '')
      .trim()
      .toLowerCase()
  );
  if (!head.includes('message') && !head.includes('timestamp') && !head.includes('room')) {
    return { cols, rows };
  }
  return {
    cols: first.map((cell) => String(cell ?? '').trim()),
    rows: rows.slice(1)
  };
}

/**
 * @param {{ cols: string[], rows: unknown[][] }} table
 * @param {string} room
 * @returns {ChatMessage[]}
 */
export function parseMessages(table, room) {
  const { cols, rows } = normalizeTable(table);
  const iTs = colIndex(cols, ['timestamp', 'ts', 'time']);
  const iUuid = colIndex(cols, ['uuid']);
  const iRoom = colIndex(cols, ['room']);
  const iName = colIndex(cols, ['name', 'nick']);
  const iMsg = colIndex(cols, ['message', 'text']);
  const iId = colIndex(cols, ['id', 'msgid']);

  /** @type {ChatMessage[]} */
  const out = [];
  for (const row of rows) {
    const roomVal = iRoom >= 0 ? String(row[iRoom] ?? '').trim() : '';
    if (roomVal && roomVal.toLowerCase() === 'room') continue;
    if (room && roomVal && roomVal !== room) continue;

    const message = iMsg >= 0 ? String(row[iMsg] ?? '').trim() : '';
    if (!message) continue;

    const name = iName >= 0 ? String(row[iName] ?? '').trim() : 'Anon';
    const uuid = iUuid >= 0 ? String(row[iUuid] ?? '').trim() : '';
    const rawTs = iTs >= 0 ? row[iTs] : null;
    const parsedTs = parseTs(rawTs);
    // A missing timestamp falls back to "now", which does have a clock.
    const hasTime = parsedTs ? cellHasTime(rawTs) : true;
    const storedId =
      iId >= 0 && row[iId] != null && String(row[iId]).trim() ? String(row[iId]).trim() : '';
    // Older Apps Script column detection matched "id" inside "uuid".
    const id =
      storedId && storedId !== uuid ? storedId : `${uuid}-${parsedTs}-${message.slice(0, 12)}`;

    out.push({
      id,
      ts: parsedTs || Date.now(),
      hasTime,
      uuid,
      room: roomVal || room,
      name: name || 'Anon',
      message
    });
  }

  out.sort((a, b) => a.ts - b.ts);
  return out;
}
