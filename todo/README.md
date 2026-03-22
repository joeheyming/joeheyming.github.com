# todo

Vanilla ES modules: a small **todo** demo that uses shared Google helpers in [`../google-db/`](../google-db/) (GIS + Sheets API). **Access control** is whatever you set in Google Drive on that spreadsheet (and the OAuth test users / publishing state of your Cloud project).

## Limitations

- A spreadsheet is not a real database: no transactions, concurrent edits are last-write-wins, and [API quotas](https://developers.google.com/sheets/api/limits) apply.
- Row identity uses a stable **`id` column** (UUID); row numbers change when rows are deleted.

## Spreadsheet vs tabs

- **`spreadsheetId`** in [`config.js`](config.js) pins the **file**. Users cannot switch files in the app.
- Each **tab** in that file is a separate **list**. The app lists tabs in a dropdown; the last-used tab is stored in **`localStorage`**. You can **rename**, **add**, or **remove** lists (add/remove updates tabs in Google Sheets). You cannot remove the last tab—Google requires at least one sheet per file.

## Sheet layout (each tab)

On each tab you use (default name **`Sheet1`**, or set `sheetName` in config for first visit), use either:

1. **Header row** (flexible casing/spacing): row **1** is `id`, `title`, optional `done`, `createdAt` — data from row **2**, or
2. **No header**: row **1** is already data with a **UUID** in column **A** (same shape the app appends: id, title, done, createdAt).

New todos append `id` (UUID), `title`, `done` (`FALSE`), and `createdAt` (ISO timestamp).

## Google Cloud setup

This app uses OAuth scope **`https://www.googleapis.com/auth/drive.file`**: the token can only access **files the user opens through this app** (via Google Picker), not every spreadsheet in their Drive. Your `spreadsheetId` in config must match the file they pick.

1. Create or pick a GCP project; enable **Google Sheets API** and **Google Drive API** (Drive is required for the Picker).
2. **APIs & Services → Credentials → Create credentials → API key** (for the Picker UI). Restrict the key to **HTTP referrers** (e.g. `https://joeheyming.github.io/*`, `http://localhost:8000/*`). Put the key in **`pickerApiKey`** in [`config.js`](config.js).
3. Configure the **OAuth consent screen** (for personal use, **User type: External** is fine). Under **Scopes**, add **`.../auth/drive.file`** (and remove **`.../auth/spreadsheets`** if you added it earlier—avoid requesting full Sheets access). For this demo, keep **Publishing status** on **Testing** unless you have completed Google’s full [app verification](https://support.google.com/cloud/answer/9110914) for production use with sensitive scopes. While in **Testing**, only accounts under **Test users** can sign in—add yours here: **OAuth consent screen → Audience → Test users → Add users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins** (add both local and production):
     - `http://localhost:8000` (or whatever port you use with `python3 -m http.server`)
     - `http://127.0.0.1:8000` (optional, if the browser uses it)
     - `https://joeheyming.github.io`
   - **Authorized redirect URIs:** add the same origins if the console requires them for your OAuth client type.
5. Copy the **Client ID** (ends with `.apps.googleusercontent.com`).

**First sign-in:** After OAuth, if the app cannot read the spreadsheet yet, a **file picker** opens—select the same spreadsheet whose ID is in `spreadsheetId`. That grants this app access to **only** that file (for this account/browser). Page-load auto-connect cannot open the picker; use **Sign in with Google** if you see a message about selecting the spreadsheet.

## Troubleshooting

### “Access blocked: … has not completed the Google verification process”

That text uses your **App name** from the OAuth consent screen. It usually means:

1. **Testing mode** — The app is not verified for the whole public internet. **Fix:** Add the Google account you’re signing in with under **OAuth consent screen → Test users** (see step 2 above). Each collaborator needs their own email added while you stay in Testing.
2. **Wrong account** — You’re signed into Chrome with a Google account that isn’t a test user. Switch accounts or add that address as a test user.
3. **Going beyond Testing** — If you set the app to **In production** and use **sensitive** scopes (Sheets access is sensitive for Google’s policy), Google may require a full [app verification](https://support.google.com/cloud/answer/9110914) for strangers to use it. For a personal demo, keep **Testing** and use **Test users** instead.

**Internal** user type (Google Workspace only) avoids public verification but limits sign-in to users in your organization.

### HTTP 500 (or broken flow) on `accounts.google.com/.../oauth/consent`

If sign-in worked in **Testing** and broke after you switched the app to **In production**, set **Publishing status** back to **Testing**, keep your accounts on **Test users**, and try again. Production + sensitive scopes (e.g. Google Sheets) generally requires verification before arbitrary Google users can use the app.

## Config

Edit [`config.js`](config.js):

- `clientId` — Web client ID from step 5.
- `pickerApiKey` — Browser API key from step 2 (**required** for the Picker).
- `spreadsheetId` — **required**; the spreadsheet file for everyone using this deployment (must match the file users pick).
- `sheetName` — default tab when there is no saved tab in `localStorage` yet (default `Sheet1`).

The app saves only the **selected tab name** in **`localStorage`** (`todo.sheetName`), not the spreadsheet ID.

After you sign in once, the **access token** and its **expiry** are stored in `localStorage` under **`google-db.oauthAccessToken`** / **`google-db.oauthExpiresAt`** (see [`../google-db/google-auth.js`](../google-db/google-auth.js)) — typically ~1 hour. Reloads use that token **without a popup** until it expires; then use **Sign in with Google** again. Google’s browser-only flow does **not** expose a long-lived refresh token, so “remember forever” isn’t available without your own backend. Treat stored tokens like a password for your sheet: anyone with this browser profile could use them until expiry or **Sign out** (which clears them).

The OAuth **client ID** is public by design. Do not put a client **secret** in this repo.

## Run locally

From the **repository root** (so the URL matches GitHub Pages):

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/todo/`.

## GitHub Pages

Commit `config.js` with at least `clientId` set for the live site to work. Empty `clientId` shows a message in the UI until you fill it in.

## Files

| File                             | Purpose                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `index.html`                     | [Tailwind Play CDN](https://tailwindcss.com/docs/installation/play-cdn) + fonts + GIS / `app.js`      |
| `app.js`                         | Todo UI (Tailwind class strings for dialogs & list rows)                                              |
| `todo-sheets.js`                 | Todo row layout + `createGoogleSheetClient`; re-exports tab helpers from `../google-db/sheets-api.js` |
| `config.js`                      | `clientId`, `spreadsheetId`, `sheetName`                                                              |
| [`../google-db/`](../google-db/) | Shared `google-auth.js` + `sheets-api.js` (no app config)                                             |
