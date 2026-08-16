// Live chat — Google Form / Sheet config.
//
// Writes — POST to a Google Form `formResponse` endpoint (CORS-blind).
// Reads  — Meta (enable cell) + Messages via public gviz JSON.
//
// Until placeholders are replaced, the client runs in demo mode
// (localStorage only) so the UI is testable without wiring.

export const CONFIG = {
  // Adaptive polling (ms).
  pollOpenMs: 3000,
  pollMinimizedMs: 30000,
  pollBurstMs: 1500,
  pollBurstForMs: 12000,
  metaPollEveryMs: 20000,

  // Soft client throttle (Script enforces for real).
  minSendGapMs: 3000,
  maxMessageChars: 200,
  minNickChars: 3,
  maxNickChars: 20,

  // Cap mirrored in Apps Script (per room).
  maxMessagesPerRoom: 300,

  // Google Form `formResponse` URL.
  // https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
  formActionUrl:
    'https://docs.google.com/forms/d/e/1FAIpQLScG9mZEHJygVNNY2M1pNwB22cxZw5EgJICWxZjThfI99IHMIg/formResponse',

  // entry.NNNNNNNN field IDs from the form's prefilled / viewform URL.
  entryIds: {
    uuid: 'entry.1151944615',
    room: 'entry.1922037678',
    name: 'entry.85102902',
    message: 'entry.135588964',
    honeypot: 'entry.1427346870',
    id: 'entry.918715344'
  },

  // Spreadsheet ID (between /spreadsheets/d/ and /edit).
  sheetId: '1LMcMcTaaCF6lXFpyAKWpBByGaOZbIld0nIpKCXFlbtQ',
  metaTab: 'Meta',
  messagesTab: 'Messages',

  // localStorage keys.
  nickKey: 'heyming-live-chat-nick',
  openKey: 'heyming-live-chat-open',
  // Prefer the same anonymous id as presence when available.
  uuidKey: 'heyming-presence-id',
  demoKeyPrefix: 'heyming-live-chat-demo:'
};

export function isConfigured(c = CONFIG) {
  return (
    !String(c.formActionUrl || '').includes('YOUR_FORM_ID') &&
    !String(c.sheetId || '').includes('YOUR_SHEET_ID') &&
    !String(c.entryIds?.uuid || '').includes('1111111111')
  );
}
