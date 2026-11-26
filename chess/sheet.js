import { normalizeRow } from './sync.js';

/**
 * @param {string} value
 */
function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * @param {string} text
 */
function parseGviz(text) {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) throw new Error('gviz response missing jsonp wrapper');
  const parsed = JSON.parse(text.slice(start + 1, end));
  if (parsed.status !== 'ok') {
    const err = parsed.errors && parsed.errors[0];
    const detail = err ? err.detailed_message || err.message || 'unknown' : 'unknown';
    throw new Error(`gviz status=${parsed.status}: ${detail}`);
  }
  const cols = (parsed.table && parsed.table.cols) || [];
  const keys = cols.map((col, i) => col.label || col.id || `col${i}`);
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (const row of (parsed.table && parsed.table.rows) || []) {
    if (!row || !Array.isArray(row.c)) continue;
    /** @type {Record<string, unknown>} */
    const obj = {};
    let any = false;
    for (let i = 0; i < keys.length; i += 1) {
      const cell = row.c[i];
      const value = cell && cell.v !== undefined ? cell.v : null;
      obj[keys[i]] = value;
      if (value !== null && value !== '') any = true;
    }
    if (any) rows.push(obj);
  }
  return rows;
}

/**
 * @param {import('./config.js').CONFIG} config
 * @param {string} gameId
 */
export async function fetchGame(config, gameId) {
  const column = /^[A-Z]$/.test(config.gameIdColumn || '') ? config.gameIdColumn : 'B';
  const sql = `select * where ${column} = '${escapeSql(gameId)}' limit 300`;
  const params = new URLSearchParams({
    tqx: 'out:json',
    headers: '1',
    sheet: config.tab || 'Form Responses 1',
    tq: sql
  });
  const url = `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?${params}`;
  const text = await fetch(url, { cache: 'no-store', credentials: 'omit' }).then((res) => {
    if (!res.ok) throw new Error(`gviz HTTP ${res.status}`);
    return res.text();
  });
  return parseGviz(text)
    .map((row) => normalizeRow(row))
    .filter((row) => row && row.gameId === gameId);
}

/**
 * @param {import('./config.js').CONFIG} config
 * @param {{ gameId: string, ply: number, name: string, san: string, color: string }} row
 */
export function postRow(config, row) {
  const body = new URLSearchParams();
  body.set(config.entryIds.gameId, row.gameId);
  body.set(config.entryIds.ply, String(row.ply));
  body.set(config.entryIds.name, row.name);
  body.set(config.entryIds.san, row.san || '');
  body.set(config.entryIds.color, row.color);
  return fetch(config.formActionUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  }).catch(() => {});
}
