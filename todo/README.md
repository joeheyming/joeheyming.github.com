# todo

Vanilla ES modules: a small **todo** demo that uses shared Google helpers in [`../google-db/`](../google-db/) (GIS + Sheets API). Each browser profile gets its **own** Google Sheet (created on first sign-in) stored under **`google-db.spreadsheetId`** in `localStorage`. Access control is still your Google account, OAuth test users, and Cloud project publishing state.

## Limitations

- A spreadsheet is not a real database: no transactions, concurrent edits are last-write-wins, and [API quotas](https://developers.google.com/sheets/api/limits) apply.
- Row identity uses a stable **`id` column** (UUID); row numbers change when rows are deleted.
- The workbook id is **per browser profile**, not synced across devices unless you use the same profile or the same `localStorage`.

## Spreadsheet vs tabs

- The **workbook** is opened via [`openSiteDatabase`](../google-db/site-database.js): first sign-in **creates** it (file title from [`site-config.js`](../google-db/site-config.js)), persists **`google-db.spreadsheetId`**, then the app uses **tables** (`listTables`, `createTable`, …) and a row client for todo rows. Other pages can share the same workbook with their own tab prefixes.
- The workbook includes a reserved **`site-db-manifest`** table (see [`site-database.js`](../google-db/site-database.js)) with key/value metadata. The todo app stores **`todo.externalLists`** there (JSON): shared lists that were **moved** into separate Drive files still appear in the list menu, pointing at those spreadsheets.
- Todo **lists** are tabs whose titles start with **`todo-app-`**. The UI shows the suffix (e.g. `todo-app-Tasks` → “Tasks”). Tabs without that prefix are ignored so other apps can use the same workbook with their own prefixes.
- The last-used list is stored in **`todo.sheetName`** (and **`todo.listSpreadsheetId`** when the list lives in another spreadsheet). You can **rename**, **add**, or **remove** lists. You cannot remove your last entry in the list menu. Your main workbook always keeps at least one `todo-app-*` tab when needed (and always keeps **`site-db-manifest`**).

## Sharing a list

- **Share (👥)** on a list in your **main** workbook: copies that tab into a **new** Google spreadsheet, invites the emails you enter as **editors** (Drive `permissions.create`), removes the tab from your main file, and records the new file in **`todo.externalLists`** in the manifest. Collaborators use **Open shared (🔗)** and paste the spreadsheet link or id; matching `todo-app-*` tabs are added to the menu for this browser (`todo.openedSharedLists`).
- **Share** on a list that is **already** in a shared file only sends new invites for that same spreadsheet (no second copy).
- **Remove** on a manifest-linked list only removes the pointer from your app; the Drive file is unchanged. **Remove** on an “opened” list only forgets the link in this browser.

## Google Cloud setup

This app uses OAuth scope **`https://www.googleapis.com/auth/drive.file`**: access to **files created by this app**, not all spreadsheets in Drive.

1. Create or pick a GCP project; enable **Google Sheets API** and **Google Drive API** (Drive is required for sharing invites).
2. Configure the **OAuth consent screen** (for personal use, **User type: External** is fine). Under **Scopes**, add **`.../auth/drive.file`** (and remove **`.../auth/spreadsheets`** if you added it earlier). While in **Testing**, add accounts under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins** (local and production): e.g. `http://localhost:8000`, `https://joeheyming.github.io`
4. Copy the **Client ID** into **`clientId`** in [`../google-db/site-config.js`](../google-db/site-config.js).

**First sign-in:** OAuth runs, then the app **creates** your spreadsheet. If a stored id can no longer be read (wrong account, revoked access), remove **`google-db.spreadsheetId`** from `localStorage` and sign in again to create a new file, or sign in with the Google account that owns that spreadsheet.

## Sheet layout (each `todo-app-*` tab)

Use either:

1. **Header row** (flexible casing/spacing): row **1** is `id`, `title`, optional `done`, `createdAt` — data from row **2**, or
2. **No header**: row **1** is already data with a **UUID** in column **A** (same shape the app appends: id, title, done, createdAt).

New todos append `id` (UUID), `title`, `done` (`FALSE`), and `createdAt` (ISO timestamp).

## Troubleshooting

### “Access blocked: … has not completed the Google verification process”

Same as before: **Testing** mode + **Test users**, or verification for production + sensitive scopes. See older troubleshooting in git history if needed.

### HTTP 500 on OAuth consent

If production + sensitive scopes broke sign-in, revert to **Testing** and test users.

## Config

Shared Google credentials live in [`../google-db/site-config.js`](../google-db/site-config.js) (used by this app and any other tool on the site):

- `clientId` — Web client ID.
- `SITE_SPREADSHEET_DOCUMENT_TITLE` — Optional to change: default Drive file name when **`createSpreadsheet`** creates the workbook (apps only pass **`sheetTitles`**).

**`localStorage` keys:** `google-db.spreadsheetId` (main workbook), `google-db.oauthAccessToken` / `google-db.oauthExpiresAt` (token), `todo.sheetName` (last list selection), `todo.listSpreadsheetId` (when that list is in another spreadsheet), `todo.openedSharedLists` (collaborator-opened files). **Sign out** clears the OAuth token and `todo.listSpreadsheetId`; it does not clear the main spreadsheet id or opened-shared list entries.

The OAuth **client ID** is public by design. Do not put a client **secret** in this repo.

## Run locally

From the **repository root**:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/todo/`.

## GitHub Pages

Commit [`site-config.js`](../google-db/site-config.js) with **`clientId`** set.

## Files

| File                                                                  | Purpose                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `index.html`                                                          | [Tailwind Play CDN](https://tailwindcss.com/docs/installation/play-cdn) + fonts + GIS / `app.js` |
| `app.js`                                                              | Todo UI; lists, share/open-shared, rename/remove                                                 |
| `todo-sheets.js`                                                      | Todo row layout + `createGoogleSheetClient`                                                      |
| `todo-workbook.js`                                                    | Connect main workbook; merge manifest + opened lists; `createListClient`                         |
| `todo-manifest.js`                                                    | Read/write `todo.externalLists` in `site-db-manifest`                                            |
| `todo-share.js`                                                       | Migrate tab to new file + Drive invites; parse emails                                            |
| `todo-opened-shared.js`                                               | `localStorage` for collaborator-opened spreadsheet ids                                           |
| (shared) [`../google-db/site-config.js`](../google-db/site-config.js) | `clientId`, `SITE_SPREADSHEET_DOCUMENT_TITLE`                                                    |
| [`../google-db/`](../google-db/)                                      | `google-auth.js`, `site-database.js`, `sheets-api.js`, `drive-api.js`                            |
