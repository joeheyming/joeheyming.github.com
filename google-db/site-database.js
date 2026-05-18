/**
 * Site “database” facade over a single stored Google workbook (`LS_SPREADSHEET_ID`).
 * Callers work with tables and ranges; Sheets is an implementation detail.
 */

import { LS_SPREADSHEET_ID } from './google-auth.js';
import { SITE_SPREADSHEET_DOCUMENT_TITLE } from './site-config.js';
import {
  a1Range,
  appendRow as apiAppendRow,
  appendRows as apiAppendRows,
  createSheetTab,
  createSpreadsheet,
  deleteSheetRow,
  deleteSheetTab,
  getSheetIdByTitle,
  getValues,
  listAccessibleSpreadsheets,
  listSheetTabs,
  putValues,
  renameSheetTab,
  tryFetchSpreadsheetMeta
} from './sheets-api.js';

/** Reserved table name for workbook metadata (key/value). Apps should not use this name for app data. */
export const SITE_DB_MANIFEST_TABLE = 'site-db-manifest';

const MANIFEST_SCHEMA_VERSION = '1';

const ACCESS_ERROR =
  'Could not open your saved data. Use the same Google account that created it, or remove the localStorage key google-db.spreadsheetId and sign in again to start fresh.';

function loadStoredWorkbookId() {
  try {
    return (localStorage.getItem(LS_SPREADSHEET_ID) || '').trim();
  } catch {
    return '';
  }
}

function saveStoredWorkbookId(id) {
  try {
    localStorage.setItem(LS_SPREADSHEET_ID, id.trim());
  } catch {
    /* quota / private mode */
  }
}

/**
 * @param {{ createdAt: string, migrated?: boolean }} opts
 * @returns {string[][]}
 */
function buildManifestRows(opts) {
  const { createdAt, migrated = false } = opts;
  const rows = [
    ['key', 'value'],
    ['schemaVersion', MANIFEST_SCHEMA_VERSION],
    ['createdAt', createdAt],
    ['documentTitle', SITE_SPREADSHEET_DOCUMENT_TITLE],
    [
      'description',
      'Reserved google-db manifest (admin / tooling). Do not rename or delete this table.'
    ]
  ];
  const origin = typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : '';
  if (origin) {
    rows.push(['siteOrigin', origin]);
  }
  if (migrated) {
    rows.push(['manifestAddedAt', new Date().toISOString()]);
  }
  return rows;
}

/**
 * @param {SiteDatabase} db
 * @param {{ createdAt: string, migrated?: boolean }} opts
 */
async function writeManifestSheet(db, opts) {
  const rows = buildManifestRows(opts);
  const endRow = rows.length;
  await db.writeRange(SITE_DB_MANIFEST_TABLE, `A1:B${endRow}`, rows);
}

/**
 * Ensures the manifest table exists and is seeded (new workbooks or legacy without it).
 * @param {SiteDatabase} db
 * @param {boolean} workbookJustCreated
 */
async function ensureManifestTable(db, workbookJustCreated) {
  const tables = await db.listTables();
  const hasManifest = tables.some((t) => t.title === SITE_DB_MANIFEST_TABLE);
  const now = new Date().toISOString();

  if (!hasManifest) {
    await db.createTable(SITE_DB_MANIFEST_TABLE);
    await writeManifestSheet(db, { createdAt: now, migrated: true });
    return;
  }

  if (workbookJustCreated) {
    await writeManifestSheet(db, { createdAt: now, migrated: false });
  }
}

export class SiteDatabase {
  /**
   * @param {string} workbookId Backend workbook key (opaque to most callers).
   * @param {() => Promise<string>} getAccessToken
   */
  constructor(workbookId, getAccessToken) {
    this._workbookId = workbookId;
    this._getAccessToken = getAccessToken;
  }

  /**
   * Backend workbook key (e.g. for debugging). Prefer `readRange` / `writeRange` / `appendTableRow` on this object.
   * @returns {string}
   */
  get workbookId() {
    return this._workbookId;
  }

  async #token() {
    return this._getAccessToken();
  }

  async verifyReadable() {
    const t = await this.#token();
    const check = await tryFetchSpreadsheetMeta(this._workbookId, t);
    if (!check.ok) {
      throw new Error(ACCESS_ERROR);
    }
  }

  /** @returns {Promise<{ sheetId: number, title: string }[]>} */
  async listTables() {
    return listSheetTabs(this._workbookId, await this.#token());
  }

  /** @returns {Promise<{ sheetId: number, title: string }>} */
  async createTable(title) {
    return createSheetTab(this._workbookId, title, await this.#token());
  }

  async renameTable(sheetId, newTitle) {
    await renameSheetTab(this._workbookId, sheetId, newTitle, await this.#token());
  }

  async deleteTable(sheetId) {
    await deleteSheetTab(this._workbookId, sheetId, await this.#token());
  }

  /**
   * @param {string} tableName
   * @param {string} rangeSuffix A1 suffix, e.g. `A1:D1` or `B5`
   * @param {string[][]} values
   */
  async writeRange(tableName, rangeSuffix, values) {
    const range = a1Range(tableName, rangeSuffix);
    await putValues(this._workbookId, range, values, await this.#token());
  }

  /**
   * @param {string} tableName
   * @param {string} rangeSuffix e.g. `A:D`
   * @returns {Promise<string[][]>}
   */
  async readRange(tableName, rangeSuffix) {
    const range = a1Range(tableName, rangeSuffix);
    const rows = await getValues(this._workbookId, range, await this.#token());
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * @param {string} tableName
   * @param {string} rangeSuffix e.g. `A:D` (append target)
   * @param {unknown[]} row
   */
  async appendTableRow(tableName, rangeSuffix, row) {
    const range = a1Range(tableName, rangeSuffix);
    await apiAppendRow(this._workbookId, range, row, await this.#token());
  }

  /**
   * Batched variant of {@link appendTableRow}. No-op for empty input.
   * @param {string} tableName
   * @param {string} rangeSuffix e.g. `A:H`
   * @param {unknown[][]} rows
   */
  async appendTableRows(tableName, rangeSuffix, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return;
    }
    const range = a1Range(tableName, rangeSuffix);
    await apiAppendRows(this._workbookId, range, rows, await this.#token());
  }

  /**
   * Deletes one row in a table by 1-based sheet row index (includes header row if present).
   * @param {string} tableName
   * @param {number} rowIndex1Based
   */
  async deleteTableDataRow(tableName, rowIndex1Based) {
    const t = await this.#token();
    const sheetId = await getSheetIdByTitle(this._workbookId, tableName, t);
    await deleteSheetRow(this._workbookId, sheetId, rowIndex1Based, t);
  }
}

/**
 * Opens or creates the site workbook, persists its id, and verifies the token can read it.
 *
 * @param {{
 *   getAccessToken: () => Promise<string>,
 *   initialTables?: string[],
 *   silent?: boolean,
 *   onWillCreateWorkbook?: () => void,
 *   resolveUncachedWorkbook?: (candidates: { id: string, name: string }[]) => Promise<'create' | string>
 * }} opts
 * @returns {Promise<{ db: SiteDatabase, created: boolean } | null>} `null` if `silent` and no workbook id yet
 */
export async function openSiteDatabase(opts) {
  const {
    getAccessToken,
    initialTables = ['Sheet1'],
    silent = false,
    onWillCreateWorkbook,
    resolveUncachedWorkbook
  } = opts;

  const appTables = initialTables.filter((t) => t !== SITE_DB_MANIFEST_TABLE);
  const sheetTitlesForCreate = [SITE_DB_MANIFEST_TABLE, ...appTables];

  let id = loadStoredWorkbookId();
  let created = false;

  if (!id) {
    if (silent) {
      return null;
    }
    const token = await getAccessToken();
    let candidates = [];
    try {
      candidates = await listAccessibleSpreadsheets(token, {
        exactName: SITE_SPREADSHEET_DOCUMENT_TITLE
      });
    } catch (e) {
      console.warn('[google-db] listAccessibleSpreadsheets', e);
    }

    if (candidates.length > 0) {
      let picked = '';
      if (typeof resolveUncachedWorkbook === 'function') {
        const choice = await resolveUncachedWorkbook(candidates);
        if (typeof choice === 'string' && choice !== 'create') {
          const trimmed = choice.trim();
          if (trimmed) {
            picked = trimmed;
          }
        }
      } else if (candidates.length === 1) {
        picked = candidates[0].id;
      } else {
        picked = candidates[0].id;
        console.warn(
          '[google-db] Multiple spreadsheets match the default title; using most recently modified. Pass resolveUncachedWorkbook to choose.'
        );
      }
      if (picked) {
        saveStoredWorkbookId(picked);
        id = picked;
        created = false;
      }
    }

    if (!id) {
      onWillCreateWorkbook?.();
      const { spreadsheetId } = await createSpreadsheet(token, {
        sheetTitles: sheetTitlesForCreate
      });
      saveStoredWorkbookId(spreadsheetId);
      id = spreadsheetId;
      created = true;
    }
  }

  const db = new SiteDatabase(id, getAccessToken);
  await db.verifyReadable();
  await ensureManifestTable(db, created);
  return { db, created };
}
