// Trivia — Google Form / Sheet config (classic script; load before app JS).
//
// Writes — POST to a Google Form `formResponse` endpoint (CORS-blind).
// Reads  — fetch Round / Current / Tallies via the public gviz JSON endpoint.
//
// Until placeholders are replaced, the client should no-op / demo-mode.
// See SETUP.local.md for Form + Apps Script + Questions CSV wiring.

(function () {
  'use strict';

  window.HEYMING_TRIVIA_CONFIG = {
    // Live feel without websockets: poll the Sheet often while playing.
    pollIntervalMs: 3000,
    // Slower when sitting on the Start gate (no session yet).
    pollIdleMs: 30000,
    // After an answer, burst-poll so tallies catch up quickly.
    pollBurstMs: 1500,
    pollBurstForMs: 12000,
    // Questions published per half-hour window (must match Apps Script).
    questionsPerRound: 3,

    // Google Form `formResponse` URL.
    // https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
    formActionUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSdxL1D2fXXCi1QPfShEzuq5-cqkBPQ6vnP-Y6ztu5nYOWGxog/formResponse',

    // entry.NNNNNNNN field IDs from the form's prefilled / viewform URL.
    entryIds: {
      uuid: 'entry.202174729',
      roundId: 'entry.592575599',
      questionId: 'entry.1045156848',
      answer: 'entry.1253726073',
      honeypot: 'entry.379357624'
    },

    // Spreadsheet ID (between /spreadsheets/d/ and /edit).
    // gviz: https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:json&sheet=Round
    sheetId: '1kd7GB02tEtLxpAIx_W6cSC7RIt1kM1GLgUnZtY2jK8k',
    roundTab: 'Round',
    currentTab: 'Current',
    talliesTab: 'Tallies'
  };

  window.heymingTriviaIsConfigured = function (c) {
    const cfg = c || window.HEYMING_TRIVIA_CONFIG;
    if (!cfg) return false;
    return (
      !String(cfg.formActionUrl || '').includes('YOUR_FORM_ID') &&
      !String(cfg.sheetId || '').includes('YOUR_SHEET_ID') &&
      !String(cfg.entryIds && cfg.entryIds.uuid).includes('111111111')
    );
  };
})();
