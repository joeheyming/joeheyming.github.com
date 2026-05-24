/** Tab prefix, storage keys, and list-name helpers for the todo app. */

/* Brand-routed circular icon buttons used across the todo UI. The
 * surface, border, and hover state all read from /brand.css tokens —
 * a brand swap edits one file and these buttons follow. The `accent`
 * variant uses brand accent-primary for "default action" affordance,
 * the `danger` variant uses --danger for destructive actions. The
 * Tailwind `dark:` prefix pairs that used to live here are gone:
 * surfaces are theme-swappable via the cascade now, not via Tailwind
 * dark-mode classes. */
const TW_BTN_EMOJI_BASE =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-surface-1 text-lg shadow-sm transition border-hairline-strong';
export const TW_BTN_EMOJI = `${TW_BTN_EMOJI_BASE} hover:border-accent-primary hover:bg-accent-primary-soft`;
export const TW_BTN_EMOJI_DANGER = `${TW_BTN_EMOJI_BASE} hover:border-danger hover:bg-danger-soft`;

export const TODO_TAB_PREFIX = 'todo-app-';
export const DEFAULT_LIST_DISPLAY_NAME = 'Tasks';
export const DEFAULT_FULL_SHEET_TITLE = `${TODO_TAB_PREFIX}${DEFAULT_LIST_DISPLAY_NAME}`;

export const LS_SHEET_NAME = 'todo.sheetName';
/** When set, todo list reads/writes this spreadsheet instead of the main site workbook (manifest-linked or UI-only). */
export const LS_LIST_SPREADSHEET_ID = 'todo.listSpreadsheetId';

const MAX_LIST_DISPLAY_LEN = 100 - TODO_TAB_PREFIX.length;

const INVALID_LIST_NAME_CHARS = new Set(['[', ']', '\\', '/', '?', ':', '*']);

export function sanitizeListDisplayName(raw) {
  const trimmed = raw.trim();
  let out = '';
  for (let i = 0; i < trimmed.length && out.length < MAX_LIST_DISPLAY_LEN; i++) {
    const c = trimmed[i];
    if (!INVALID_LIST_NAME_CHARS.has(c)) {
      out += c;
    }
  }
  return out;
}

export function fullTitleFromUserListName(userInput) {
  const d = sanitizeListDisplayName(userInput);
  if (!d) {
    throw new Error('List name is invalid or empty.');
  }
  return TODO_TAB_PREFIX + d;
}

export function displayNameFromFullTitle(full) {
  if (!full.startsWith(TODO_TAB_PREFIX)) {
    return full;
  }
  const rest = full.slice(TODO_TAB_PREFIX.length);
  return rest || full;
}

export function loadStoredTabName() {
  try {
    return localStorage.getItem(LS_SHEET_NAME) || '';
  } catch {
    return '';
  }
}

export function saveStoredTabName(fullTitle) {
  try {
    localStorage.setItem(LS_SHEET_NAME, fullTitle || DEFAULT_FULL_SHEET_TITLE);
  } catch {
    /* quota / private mode */
  }
}

export function getEffectiveSheetName() {
  const fromLs = loadStoredTabName().trim();
  if (fromLs && fromLs.startsWith(TODO_TAB_PREFIX)) {
    return fromLs;
  }
  if (fromLs.startsWith('opened:')) {
    return fromLs;
  }
  return DEFAULT_FULL_SHEET_TITLE;
}

const OPENED_PREFIX = 'opened:';

/**
 * Sheet tab title for API calls (decodes synthetic `opened:…` select values).
 * @param {string} listValue
 * @returns {string}
 */
export function sheetTitleFromListValue(listValue) {
  const raw = String(listValue || '').trim();
  const parsed = parseOpenedListValue(raw);
  if (parsed) {
    return parsed.sheetTitle;
  }
  return raw;
}

/**
 * @param {string} spreadsheetId
 * @param {string} sheetTitle
 * @returns {string} Unique `<option>` value for collaborator-opened lists.
 */
export function openedListValue(spreadsheetId, sheetTitle) {
  return `${OPENED_PREFIX}${spreadsheetId}:${encodeURIComponent(sheetTitle)}`;
}

/**
 * @param {string} listValue
 * @returns {{ spreadsheetId: string, sheetTitle: string } | null}
 */
export function parseOpenedListValue(listValue) {
  const raw = String(listValue || '').trim();
  if (!raw.startsWith(OPENED_PREFIX)) {
    return null;
  }
  const rest = raw.slice(OPENED_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon === -1) {
    return null;
  }
  const spreadsheetId = rest.slice(0, colon);
  let sheetTitle = rest.slice(colon + 1);
  try {
    sheetTitle = decodeURIComponent(sheetTitle);
  } catch {
    /* keep encoded */
  }
  if (!spreadsheetId || !sheetTitle) {
    return null;
  }
  return { spreadsheetId, sheetTitle };
}

export function loadStoredListSpreadsheetId() {
  try {
    return (localStorage.getItem(LS_LIST_SPREADSHEET_ID) || '').trim();
  } catch {
    return '';
  }
}

/**
 * @param {string} id Spreadsheet id, or empty string to use main workbook
 */
export function saveStoredListSpreadsheetId(id) {
  try {
    const t = String(id || '').trim();
    if (!t) {
      localStorage.removeItem(LS_LIST_SPREADSHEET_ID);
    } else {
      localStorage.setItem(LS_LIST_SPREADSHEET_ID, t);
    }
  } catch {
    /* quota */
  }
}

/**
 * @param {string} mainWorkbookId
 * @returns {string}
 */
export function getEffectiveListSpreadsheetId(mainWorkbookId) {
  const s = loadStoredListSpreadsheetId();
  return s || mainWorkbookId;
}

export function clearStoredListSpreadsheetId() {
  saveStoredListSpreadsheetId('');
}
