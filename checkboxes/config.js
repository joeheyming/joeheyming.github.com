// Configuration for the shared checkbox grid.
//
// This app reads/writes shared state via Google Forms + Sheets:
//   • Writes  — POST to a Google Form's `formResponse` endpoint (CORS-blind, fire-and-forget).
//   • Reads   — fetch the linked Sheet via the public gviz JSON endpoint.
//
// =====================================================================
// SETUP (one-time, ~10 minutes)
// =====================================================================
//
// 1. CREATE THE FORM (https://forms.google.com)
//    Add four short-answer / multiple-choice questions, in this order:
//
//      Q1 "cellId"   — short answer, required, validate "Number → Whole number"
//      Q2 "value"    — multiple choice with two options: TRUE, FALSE  (required)
//      Q3 "clientId" — short answer (required)
//      Q4 "comments" — short answer (NOT required) — this is the spam honeypot.
//                       Real users never fill it; bots will. We drop those rows on read.
//
// 2. LINK A SPREADSHEET (Form → Responses tab → green Sheets icon)
//    The default tab will be named "Form Responses 1".
//    Add a second sheet/tab named exactly:  Snapshot
//    (the Apps Script will create it on first run if missing)
//
// 3. MAKE THE SHEET PUBLICLY READABLE (so gviz can serve it)
//    Sheet → Share → "Anyone with the link" → Viewer.
//    The form already accepts public submissions — that's the write path.
//
// 4. INSTALL THE APPS SCRIPT (compaction)
//    From the spreadsheet:  Extensions → Apps Script → paste in `apps-script.gs`
//    from this folder, save, then:
//      Triggers (clock icon) → Add Trigger → function: compactIfNeeded
//                              event source: Time-driven, hourly.
//
// 5. PASTE THE IDs BELOW
//    a. From the form's "Send" button, copy the "Get prefilled link" URL.
//       Fill the prefilled form with dummy values, copy the resulting URL.
//       The URL contains "entry.NNNNNNNN" tokens — paste them below.
//    b. The form's `formResponse` URL is:
//          https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
//       Copy <FORM_ID> from your form's edit URL (between /forms/d/ and /edit).
//    c. <SHEET_ID> is in the spreadsheet URL between /spreadsheets/d/ and /edit.
//
// You can also leave everything as-is — the app falls back to "demo mode"
// where clicks update locally only and a banner explains the setup.

export const CONFIG = {
  // Total cells. 1,000,000 — divides cleanly by 8 so the bitmap is
  // exactly 125,000 bytes with no partial-byte tail. The page renders
  // cells via tiled canvases (no DOM-per-cell at this scale) and the
  // snapshot tab stores the bitmap as base64 chunks (~170 KB total)
  // instead of one row per cellId, so neither the client nor Sheets
  // deals with a 1M-row payload. See apps-script.gs for the
  // chunked-snapshot schema.
  N: 1000000,

  // Polling interval for shared state, in ms. 7s feels live without
  // hammering the gviz endpoint or burning battery on idle tabs.
  pollIntervalMs: 7000,

  // Per-client write throttle. The form has no rate limit; this caps a
  // single tab to ~5 flips/sec so a runaway script in one user's
  // devtools can't unilaterally fill the sheet.
  minWriteIntervalMs: 200,

  // Google Form `formResponse` URL.
  formActionUrl:
    'https://docs.google.com/forms/d/e/1FAIpQLSdy1_mWY3SkfXhhelUZIp6Xa9NfVCENnUrirkYEdG0Ncfgjxg/formResponse',

  // entry.NNNNNNNN field IDs, extracted from the form's viewform HTML.
  entryIds: {
    cellId: 'entry.1624013032',
    value: 'entry.1256130769',
    clientId: 'entry.66245254',
    honeypot: 'entry.444578648'
  },

  // Spreadsheet ID and the two tab names.
  // gviz URL pattern:
  //   https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:json&sheet=<TAB>
  sheetId: '1sfibfkvwEQsB6uFcFZCg5EOCNUWssawb85xr464S-5k',
  responsesTab: 'Form Responses 1',
  snapshotTab: 'Snapshot'
};

// True when the file still has placeholder values. The app uses this to
// switch into demo mode so a fresh clone doesn't try to POST to a
// non-existent form or fetch from a non-existent sheet.
export function isConfigured(c) {
  return (
    !c.formActionUrl.includes('YOUR_FORM_ID') &&
    !c.sheetId.includes('YOUR_SHEET_ID') &&
    !c.entryIds.cellId.includes('111111111')
  );
}
