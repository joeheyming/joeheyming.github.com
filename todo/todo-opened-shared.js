/**
 * Spreadsheets opened by collaborators (not the site main workbook): persisted in localStorage.
 */

export const LS_OPENED_SHARED = 'todo.openedSharedLists';

/**
 * @typedef {{ spreadsheetId: string, sheetTitle: string }} OpenedSharedEntry
 */

function entryKey(e) {
  return `${e.spreadsheetId}\0${e.sheetTitle}`;
}

/** @returns {OpenedSharedEntry[]} */
export function loadOpenedSharedEntries() {
  try {
    const raw = localStorage.getItem(LS_OPENED_SHARED);
    if (!raw) {
      return [];
    }
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) {
      return [];
    }
    /** @type {OpenedSharedEntry[]} */
    const out = [];
    for (const item of p) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const o = /** @type {Record<string, unknown>} */ (item);
      const spreadsheetId = String(o.spreadsheetId ?? '').trim();
      const sheetTitle = String(o.sheetTitle ?? '').trim();
      if (spreadsheetId && sheetTitle) {
        out.push({ spreadsheetId, sheetTitle });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** @param {OpenedSharedEntry[]} entries */
export function saveOpenedSharedEntries(entries) {
  try {
    localStorage.setItem(LS_OPENED_SHARED, JSON.stringify(entries));
  } catch {
    /* quota */
  }
}

/** @param {OpenedSharedEntry} entry */
export function addOpenedSharedEntry(entry) {
  const cur = loadOpenedSharedEntries();
  const k = entryKey(entry);
  if (cur.some((e) => entryKey(e) === k)) {
    return;
  }
  cur.push(entry);
  saveOpenedSharedEntries(cur);
}

/** @param {string} spreadsheetId @param {string} sheetTitle */
export function removeOpenedSharedEntry(spreadsheetId, sheetTitle) {
  const cur = loadOpenedSharedEntries().filter(
    (e) => !(e.spreadsheetId === spreadsheetId && e.sheetTitle === sheetTitle)
  );
  saveOpenedSharedEntries(cur);
}
