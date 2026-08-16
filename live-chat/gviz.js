import { CONFIG } from './config.js';

/**
 * @param {string} tab
 * @returns {Promise<{ cols: string[], rows: unknown[][] }>}
 */
export async function fetchTab(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${
    CONFIG.sheetId
  }/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
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
      return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/**
 * @param {string[]} cols
 * @param {string[]} names
 */
export function colIndex(cols, names) {
  const lower = cols.map((c) => String(c).toLowerCase());
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
 *   uuid: string,
 *   room: string,
 *   name: string,
 *   message: string
 * }} ChatMessage
 */

/**
 * @param {{ cols: string[], rows: unknown[][] }} table
 * @param {string} room
 * @returns {ChatMessage[]}
 */
export function parseMessages(table, room) {
  const { cols, rows } = table;
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
    const id =
      iId >= 0 && row[iId] != null && String(row[iId]).trim()
        ? String(row[iId]).trim()
        : `${uuid}-${parseTs(iTs >= 0 ? row[iTs] : null)}-${message.slice(0, 12)}`;

    out.push({
      id,
      ts: parseTs(iTs >= 0 ? row[iTs] : null) || Date.now(),
      uuid,
      room: roomVal || room,
      name: name || 'Anon',
      message
    });
  }

  out.sort((a, b) => a.ts - b.ts);
  return out;
}
