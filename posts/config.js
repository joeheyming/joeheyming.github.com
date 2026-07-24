// Configuration for Posts.
//
// Writes — POST to a Google Form `formResponse` endpoint (CORS-blind).
// Reads  — fetch the linked Sheet via the public gviz JSON endpoint.
// Attachments — tiny WebP/JPEG data URLs (or pasted https URLs) in the Sheet.
//
// Binding limit is Google Forms POST size (413 Content Too Large), not
// Sheets' 50k cell cap. Keep attachment payloads small.
//
// See SETUP.md for the one-time Google Form / Sheet wiring steps.

export const CONFIG = {
  pollIntervalMs: 12000,

  // Google Form `formResponse` URL.
  // https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
  formActionUrl:
    'https://docs.google.com/forms/d/e/1FAIpQLSelIs-pxwVanJixZqUM7SZcgEWfSS9D6e_T9b43Oswcv9GgaA/formResponse',

  // entry.NNNNNNNN field IDs from the form's prefilled / viewform URL.
  entryIds: {
    text: 'entry.1103329710',
    attachment: 'entry.54080658',
    email: 'entry.566184464',
    metadata: 'entry.1055123464',
    honeypot: 'entry.1513752823'
  },

  // Spreadsheet ID (between /spreadsheets/d/ and /edit).
  sheetId: '1-81osylEfyUTKwgrca2MfizCcmqnHCSG0MnVw5CbP-w',
  responsesTab: 'Form Responses 1',

  // Images are resized for the board, then split across Form rows when needed.
  maxAttachmentEdge: 1600,
  jpegQuality: 0.9,
  maxAttachmentsPerPost: 1,
  // Encoded attachment budgets; larger data URLs are split across Form responses.
  maxAttachmentFieldChars: 350000,
  maxAudioAttachmentFieldChars: 250000,
  maxAttachmentChunkChars: 10000,
  // Whole URL-encoded form body must stay under this (bytes).
  maxFormBodyBytes: 16000,

  // sessionStorage / IndexedDB draft key used by share-client.js
  draftKey: 'posts-draft-v1'
};

export function isConfigured(c = CONFIG) {
  return (
    !c.formActionUrl.includes('YOUR_FORM_ID') &&
    !c.sheetId.includes('YOUR_SHEET_ID') &&
    !c.entryIds.text.includes('1111111111')
  );
}
