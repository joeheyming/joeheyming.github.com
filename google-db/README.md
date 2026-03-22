# google-db (shared modules)

Vanilla ES modules for **Google Identity Services** (OAuth access token in the browser) and **Google Sheets API v4** (generic `fetch` helpers).

This folder has **no UI** and **no app config**. Apps (e.g. [`../todo/`](../todo/)) import from here with relative paths, e.g. `../google-db/google-auth.js`.

## Files

| File              | Purpose                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google-auth.js`  | GIS token client; OAuth scope **`drive.file`** (not full Sheets). Token in `localStorage`: `google-db.oauthAccessToken` / `google-db.oauthExpiresAt` |
| `sheets-api.js`   | Spreadsheet metadata, tab list/rename/create/**delete**, `getValues` / `appendRow` / `putValues`, data row delete, `tryFetchSpreadsheetMeta`         |
| `drive-picker.js` | Load Picker + `openSpreadsheetPicker` so the user grants access to one spreadsheet                                                                   |

## Requirements

- Load `https://accounts.google.com/gsi/client` before calling `initGoogleAuth`.
- Serve the site so **module URLs resolve** (e.g. run `python3 -m http.server` from the **repository root**, then open `/todo/`).
