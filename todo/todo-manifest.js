/**
 * Linked todo lists: stored in main workbook `site-db-manifest` as JSON under `todo.externalLists`.
 * Each entry points at a separate Drive spreadsheet (shared collaborators) with the same tab layout.
 */

import { SITE_DB_MANIFEST_TABLE } from '../google-db/site-database.js';

/** Manifest key — value is JSON array of {@link TodoExternalListEntry}. */
export const TODO_EXTERNAL_LISTS_KEY = 'todo.externalLists';

/**
 * @typedef {{
 *   fullTabTitle: string,
 *   spreadsheetId: string,
 *   sheetTitle: string
 * }} TodoExternalListEntry
 */

/**
 * @param {import('../google-db/site-database.js').SiteDatabase} mainDb
 * @returns {Promise<TodoExternalListEntry[]>}
 */
export async function readExternalListEntries(mainDb) {
  const rows = await mainDb.readRange(SITE_DB_MANIFEST_TABLE, 'A:B');
  if (!rows.length) {
    return [];
  }
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i]?.[0] ?? '').trim();
    if (key === TODO_EXTERNAL_LISTS_KEY) {
      const raw = rows[i][1];
      try {
        const parsed = JSON.parse(String(raw ?? '[]'));
        return Array.isArray(parsed) ? normalizeEntries(parsed) : [];
      } catch {
        return [];
      }
    }
  }
  return [];
}

/** @param {unknown[]} arr */
function normalizeEntries(arr) {
  /** @type {TodoExternalListEntry[]} */
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const o = /** @type {Record<string, unknown>} */ (item);
    const fullTabTitle = String(o.fullTabTitle ?? '').trim();
    const spreadsheetId = String(o.spreadsheetId ?? '').trim();
    const sheetTitle = String(o.sheetTitle ?? fullTabTitle).trim();
    if (fullTabTitle && spreadsheetId && sheetTitle) {
      out.push({ fullTabTitle, spreadsheetId, sheetTitle });
    }
  }
  return out;
}

/**
 * Replace the external-lists manifest row (append key if missing). Preserves other manifest rows.
 *
 * @param {import('../google-db/site-database.js').SiteDatabase} mainDb
 * @param {TodoExternalListEntry[]} entries
 */
export async function writeExternalListEntries(mainDb, entries) {
  const rows = await mainDb.readRange(SITE_DB_MANIFEST_TABLE, 'A:B');
  const header = rows[0]?.[0] === 'key' ? rows[0] : ['key', 'value'];
  /** @type {string[][]} */
  const body = [];
  let found = false;
  const json = JSON.stringify(entries);
  const start = rows[0]?.[0] === 'key' ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const k = String(rows[i]?.[0] ?? '').trim();
    const v = rows[i]?.[1];
    if (k === TODO_EXTERNAL_LISTS_KEY) {
      body.push([TODO_EXTERNAL_LISTS_KEY, json]);
      found = true;
    } else if (k) {
      body.push([k, v == null ? '' : String(v)]);
    }
  }
  if (!found) {
    body.push([TODO_EXTERNAL_LISTS_KEY, json]);
  }
  const out = [header, ...body];
  await mainDb.writeRange(SITE_DB_MANIFEST_TABLE, `A1:B${out.length}`, out);
}

/**
 * @param {TodoExternalListEntry[]} entries
 * @param {string} fullTabTitle
 * @returns {TodoExternalListEntry | undefined}
 */
export function findExternalEntry(entries, fullTabTitle) {
  return entries.find((e) => e.fullTabTitle === fullTabTitle);
}

/**
 * @param {TodoExternalListEntry[]} entries
 * @param {string} fullTabTitle
 * @param {TodoExternalListEntry} next
 * @returns {TodoExternalListEntry[]}
 */
export function upsertExternalEntry(entries, fullTabTitle, next) {
  const rest = entries.filter((e) => e.fullTabTitle !== fullTabTitle);
  rest.push(next);
  return rest;
}

/**
 * @param {TodoExternalListEntry[]} entries
 * @param {string} fullTabTitle
 * @returns {TodoExternalListEntry[]}
 */
export function removeExternalEntry(entries, fullTabTitle) {
  return entries.filter((e) => e.fullTabTitle !== fullTabTitle);
}
