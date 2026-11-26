// Shared chess games use a Google Form the same way live chat does.
// Writes — POST to a formResponse endpoint (the browser cannot read the response).
// Reads  — the form's public response sheet, via gviz.
//
// A Form response sheet always starts with a Timestamp column, so gameId
// lands in column B when the questions are created in this order:
//   gameId, ply, name, san, color
// Title those questions exactly. Share the sheet as "Anyone with the link
// can view". Placeholder ids keep the page in pass-and-play.
// chess/apps-script.local.gs deletes idle games from the form and the sheet.

export const CONFIG = {
  pollMs: 3000,

  // https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
  formActionUrl:
    'https://docs.google.com/forms/d/e/1FAIpQLSfq07YCk9nx0ecLdCuu9pSLl7t3mILv3N4EkEfQG_NnRkINmw/formResponse',

  entryIds: {
    gameId: 'entry.1668823654',
    ply: 'entry.1345578038',
    name: 'entry.801277313',
    san: 'entry.1752462552',
    color: 'entry.512379644'
  },

  // Spreadsheet ID between /spreadsheets/d/ and /edit.
  sheetId: '16si8xcUZrJ44FT-qOe_q1ySJPghmXv5kLtcdMhfrUok',
  tab: 'Form Responses 1',
  // Column letter of the gameId question (B when Timestamp occupies A).
  gameIdColumn: 'B'
};

/**
 * @param {typeof CONFIG} [c]
 * @returns {boolean}
 */
export function isConfigured(c = CONFIG) {
  return (
    !String(c.formActionUrl || '').includes('YOUR_FORM_ID') &&
    !String(c.sheetId || '').includes('YOUR_SHEET_ID') &&
    !String(c.entryIds?.gameId || '').includes('1111111111')
  );
}
