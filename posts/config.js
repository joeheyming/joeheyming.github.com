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

  // Newest published notes stay on the corkboard; older ones move to Archive.
  boardMaxNotes: 24,
  // Normalized distance under which a new random pin nudges away from neighbors.
  noteClearance: 0.09,

  // Figma-style canvas camera.
  minZoom: 0.4,
  maxZoom: 2.75,
  // World size as a multiple of the viewport (gives room to pan).
  worldScale: 1.85,

  // Google Form `formResponse` URL.
  // https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
  formActionUrl:
    'https://docs.google.com/forms/d/e/1FAIpQLSeNg3wkQ5sgF51BsHIIyLrLazyCkLLQEQPgGG8I3SAsd5fblg/formResponse',

  // entry.NNNNNNNN field IDs from the form's prefilled / viewform URL.
  entryIds: {
    text: 'entry.947783301',
    attachment: 'entry.103900252',
    email: 'entry.1401609934',
    // Sheet columns are honeypot then metadata; form display titles are swapped.
    // Map by where POSTs land in the linked Sheet (Apps Script quarantines by header).
    metadata: 'entry.53437001',
    honeypot: 'entry.2101642131'
  },

  // Spreadsheet ID (between /spreadsheets/d/ and /edit).
  sheetId: '12Jwsh6AMSOuozwjGAGinuSpfqJK02oYV0uorUNAZdRQ',
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
