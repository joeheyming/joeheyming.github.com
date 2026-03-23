import { createUserPermission } from '../google-db/drive-api.js';
import { a1Range, createSpreadsheet, putValues } from '../google-db/sheets-api.js';
import {
  readExternalListEntries,
  writeExternalListEntries,
  upsertExternalEntry
} from './todo-manifest.js';

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function parseEmailList(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} email
 * @returns {boolean}
 */
function looksLikeEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Grant writer access to each email for an existing spreadsheet.
 *
 * @param {string} spreadsheetId
 * @param {string[]} emails
 * @param {string} accessToken
 */
export async function grantSpreadsheetAccess(spreadsheetId, emails, accessToken) {
  const bad = emails.filter((e) => !looksLikeEmail(e));
  if (bad.length) {
    throw new Error(`Invalid email(s): ${bad.join(', ')}`);
  }
  for (const email of emails) {
    await createUserPermission(spreadsheetId, email, 'writer', accessToken);
  }
}

/**
 * Copy a tab from the main workbook into a new spreadsheet, grant access, record manifest, delete the old tab.
 *
 * @param {{
 *   mainDb: import('../google-db/site-database.js').SiteDatabase,
 *   sheetId: number,
 *   fullTabTitle: string,
 *   displayName: string,
 *   emails: string[],
 *   accessToken: string,
 *   documentTitle?: string
 * }} opts
 * @returns {Promise<{ spreadsheetId: string }>}
 */
export async function migrateTabToSharedWorkbook(opts) {
  const { mainDb, sheetId, fullTabTitle, displayName, emails, accessToken, documentTitle } = opts;
  if (!emails.length) {
    throw new Error('Add at least one email to share with.');
  }
  const bad = emails.filter((e) => !looksLikeEmail(e));
  if (bad.length) {
    throw new Error(`Invalid email(s): ${bad.join(', ')}`);
  }

  let rows = await mainDb.readRange(fullTabTitle, 'A:D');
  if (!rows.length) {
    rows = [['id', 'title', 'done', 'createdAt']];
  }

  const title = (documentTitle || `Shared: ${displayName}`).trim() || `Shared: ${displayName}`;
  const { spreadsheetId } = await createSpreadsheet(accessToken, {
    documentTitle: title,
    sheetTitles: [fullTabTitle]
  });

  const range = a1Range(fullTabTitle, `A1:D${rows.length}`);
  await putValues(spreadsheetId, range, rows, accessToken);

  for (const email of emails) {
    await createUserPermission(spreadsheetId, email, 'writer', accessToken);
  }

  const prev = await readExternalListEntries(mainDb);
  const next = upsertExternalEntry(prev, fullTabTitle, {
    fullTabTitle,
    spreadsheetId,
    sheetTitle: fullTabTitle
  });
  await writeExternalListEntries(mainDb, next);

  await mainDb.deleteTable(sheetId);

  return { spreadsheetId };
}
