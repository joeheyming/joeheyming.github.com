# Posts — Google Form / Sheet setup

One-time wiring so Posts can accept submissions from the static page (and from other apps via `Posts.share`).

## 1. Create the Form

1. Open [Google Forms](https://forms.google.com) → blank form.
2. Title it **Posts** (name is cosmetic).
3. Add these questions, in order:

| #   | Title (exact-ish) | Type         | Required | Notes                                                  |
| --- | ----------------- | ------------ | -------- | ------------------------------------------------------ |
| 1   | `text`            | Paragraph    | No       | Markdown body                                          |
| 2   | `attachment`      | Paragraph    | No       | Newline-separated JPEG data URLs (or https URLs)       |
| 3   | `name`            | Short answer | No       | Optional name or email                                 |
| 4   | `metadata`        | Paragraph    | No       | Client-managed ID, position, move, and removal actions |
| 5   | `honeypot`        | Short answer | No       | Spam trap — real clients leave empty                   |

If you already created the form with a question titled `images`, either rename that question to `attachment` or leave it — the feed still accepts both column names.

Turn **off** “Collect email addresses” in Form settings (we use the optional `name` field instead).

## 2. Link a Spreadsheet

Form → **Responses** → green Sheets icon → create a new spreadsheet.

Confirm the first tab is named **`Form Responses 1`** (default).

## 3. Make the Sheet publicly readable

Sheet → **Share** → **Anyone with the link** → **Viewer**.

Writes still go through the Form (public submissions). The Sheet is only for reads via gviz.

## 4. Copy IDs into `config.js`

### Form action URL

From the form’s edit URL:

`https://docs.google.com/forms/d/<EDIT_ID>/edit`

Open the live form (Preview), or use **Get prefilled link**:

`https://docs.google.com/forms/d/e/<FORM_ID>/formResponse`

Paste that into `CONFIG.formActionUrl`.

### Entry IDs

1. Form → **Send** → link icon → **Get prefilled link**
2. Fill dummy values → **Get link**
3. The URL contains `entry.NNNNNNNN=…` tokens — map them to `text`, `attachment`, `email` (the Form’s `name` field), `metadata`, and `honeypot` in `CONFIG.entryIds`

### Sheet ID

From the spreadsheet URL:

`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`

Paste into `CONFIG.sheetId`.

Until these placeholders are replaced, the page runs in **demo mode** (localStorage only) and shows a setup banner.

## 5. Optional Apps Script (quarantine + compaction)

1. Spreadsheet → **Extensions** → **Apps Script**
2. Paste [`apps-script.local.gs`](apps-script.local.gs)
3. Run `installTriggers` once and authorize

On Form submit:

- **Honeypot** — non-empty honeypot rows move to a **Quarantine** tab
- **Compaction** — only when the new row is a `remove` or `move` (chunked image/audio uploads skip it)

Hourly (and when you run `runMaintenance`):

- **Moves** — latest `move` metadata is folded into the post’s own metadata; move rows are deleted
- **Removes** — the post, its attachment chunk rows, related moves, and the remove tombstone are archived to a **Deleted** tab, then removed from **Form Responses 1**

Maintenance takes a script lock so overlapping triggers cannot delete by stale row numbers. The board still works without this script (client-side soft-delete). Compaction is what keeps the live Sheet lean as traffic scales. Re-run `runMaintenance` anytime from the Apps Script editor for a one-shot cleanup.

## 6. Smoke test

1. Open `/posts/` — banner should be gone once configured.
2. Drop an attachment and post some text.
3. Wait ~10–15s (or hit Refresh); the post should appear for everyone.
4. From a connected app, use **Make a Post** and confirm a prefilled draft note appears on the board.

## Attachments (no external host)

Image attachments are resized/compressed in the browser (WebP/JPEG). Audio attachments are
recorded at low bitrate. Both are stored as data URLs split across Sheet `attachment` cells.

**Binding limit — Google Forms 413:** Forms rejects oversized POSTs (`Content Too Large`). That
limit is much tighter than Sheets’ 50k cell cap. The client preserves original PNG/JPEG images
when they fit; oversized images use a high-quality fallback up to 1600px. Each Form body stays
under ~16 KB, with larger image and audio data URLs split across several Form responses and
reassembled by the feed.

Practical result: **one image around 250 KB or an audio clip up to ~180 KB per post**, or paste
an `https://…` URL instead for larger media.
