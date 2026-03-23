/**
 * Shared Google Cloud + site spreadsheet settings for apps on this origin.
 * OAuth client ID is public; do not put client secrets here.
 */
export const clientId = '911064323002-dl27g98mp6kbia2hicvi8sknen43so9u.apps.googleusercontent.com';
/**
 * Default Drive **file** title for new site workbooks (`google-db.spreadsheetId`). Used by
 * `sheets-api.js` `createSpreadsheet` unless callers pass `documentTitle`. Apps only supply
 * `sheetTitles` for their tabs; each app can use its own naming scheme (e.g. prefixed table names).
 */
export const SITE_SPREADSHEET_DOCUMENT_TITLE = 'joeheyming.github.io-db';
