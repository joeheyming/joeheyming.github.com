/** Tab prefix, storage keys, and list-name helpers for the todo app. */

export const TW_BTN_EMOJI =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg shadow-sm transition hover:border-violet-400 hover:bg-violet-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-violet-500 dark:hover:bg-violet-950/50';
export const TW_BTN_EMOJI_DANGER =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg shadow-sm transition hover:border-rose-400 hover:bg-rose-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-rose-500 dark:hover:bg-rose-950/40';

export const TODO_TAB_PREFIX = 'todo-app-';
export const DEFAULT_LIST_DISPLAY_NAME = 'Tasks';
export const DEFAULT_FULL_SHEET_TITLE = `${TODO_TAB_PREFIX}${DEFAULT_LIST_DISPLAY_NAME}`;

export const LS_SHEET_NAME = 'todo.sheetName';

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
  return DEFAULT_FULL_SHEET_TITLE;
}
