// Presence — Google Form / Sheet config (classic script; loaded before /presence.js).
//
// Writes — POST to a Google Form `formResponse` endpoint (CORS-blind).
// Reads  — fetch the Presence tab via the public gviz JSON endpoint.
//
// Until placeholders are replaced, presence.js no-ops (no POSTs, no badges).
// See presence/SETUP.md for the one-time Form + Apps Script wiring.

(function () {
  'use strict';

  window.HEYMING_PRESENCE_CONFIG = {
    // Heartbeat while the tab is visible.
    heartbeatMs: 60000,
    // Client-side active window (must match product decision: 3 min).
    activeWindowMs: 180000,

    // Google Form `formResponse` URL.
    // https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
    formActionUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSemGs2Xiri6tPcjiyMAex9gzhtNTQY6JUxxm_BtaoJuZ3YkgA/formResponse',

    // entry.NNNNNNNN field IDs from the form's prefilled / viewform URL.
    entryIds: {
      uuid: 'entry.557403110',
      page: 'entry.1467466193',
      honeypot: 'entry.1849045856'
    },

    // Spreadsheet ID (between /spreadsheets/d/ and /edit) and Presence tab name.
    // gviz: https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:json&sheet=Presence
    sheetId: '1_-qPON0DxlzskNV5dJsKN5uLS2AyjL6VOg9wkLyD3DM',
    presenceTab: 'Presence'
  };

  window.heymingPresenceIsConfigured = function (c) {
    const cfg = c || window.HEYMING_PRESENCE_CONFIG;
    if (!cfg) return false;
    return (
      !String(cfg.formActionUrl || '').includes('YOUR_FORM_ID') &&
      !String(cfg.sheetId || '').includes('YOUR_SHEET_ID') &&
      !String(cfg.entryIds && cfg.entryIds.uuid).includes('111111111')
    );
  };
})();
