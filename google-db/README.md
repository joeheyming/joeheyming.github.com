# google-db (shared modules)

Vanilla ES modules for **Google Identity Services** (OAuth access token in the browser) and **Google Sheets API v4** (generic `fetch` helpers).

This folder has **no UI**. Apps import modules with relative paths, e.g. `../google-db/google-auth.js`. Shared **OAuth client id** for the site is in **`site-config.js`**. Modules are **app-agnostic**: no app-specific tables, columns, or workflows—callers own sheet names and data shapes.

## Files

| File              | Purpose                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site-config.js`  | **`clientId`** (GIS), **`SITE_SPREADSHEET_DOCUMENT_TITLE`** (default Drive file title; used inside `createSpreadsheet`)                |
| `google-auth.js`  | GIS token client; imports **`site-config.js`**. OAuth scope **`drive.file`**. `localStorage`: `google-db.oauthAccessToken` / `google-db.oauthExpiresAt`; **`LS_SPREADSHEET_ID`**, **`initGoogleAuth()`** |
| `sheets-api.js`   | `createSpreadsheet`, `a1Range`, spreadsheet metadata, tab list/rename/create/**delete**, `getValues` / `appendRow` / `putValues`, data row delete, `tryFetchSpreadsheetMeta`                                      |
| `site-database.js`| `openSiteDatabase`, **`SiteDatabase`** (`listTables`, `readRange`, `writeRange`, `appendTableRow`, `deleteTableDataRow`, …), **`SITE_DB_MANIFEST_TABLE`**                                                                 |
| `drive-picker.js` | Optional: load Picker + `openSpreadsheetPicker` (needs `https://apis.google.com/js/api.js` + a browser API key on the page)            |

## Requirements

- Load `https://accounts.google.com/gsi/client` before calling `initGoogleAuth()` (no arguments; reads **`clientId`** from `site-config.js`).
- Serve the site so **module URLs resolve** (e.g. run `python3 -m http.server` from the **repository root**, then open a page that imports from `google-db/`).
