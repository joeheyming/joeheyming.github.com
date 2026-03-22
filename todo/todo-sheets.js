/**
 * Todo rows backed by Google Sheets (uses `../google-db/sheets-api.js`).
 * Re-exports tab helpers for the UI layer.
 */

export {
  createSheetTab,
  deleteSheetTab,
  listSheetTabs,
  renameSheetTab
} from '../google-db/sheets-api.js';

import {
  appendRow,
  a1ColumnLetter,
  deleteSheetRow,
  getSheetIdByTitle,
  getValues,
  putValues
} from '../google-db/sheets-api.js';

/**
 * Normalize a header cell for matching: trim, lowercase, collapse spaces, drop underscores.
 * @param {unknown} cell
 */
function normalizeHeaderLabel(cell) {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '');
}

/**
 * @param {string[]} headerRow
 * @param {...string} canonicalNames
 */
function findColumnIndexAny(headerRow, ...canonicalNames) {
  const targets = canonicalNames.map((c) => normalizeHeaderLabel(c));
  for (let i = 0; i < headerRow.length; i++) {
    const norm = normalizeHeaderLabel(headerRow[i]);
    if (targets.includes(norm)) {
      return i;
    }
  }
  return -1;
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string[] | undefined} cells
 */
function looksLikeTodoDataRow(cells) {
  if (!cells || cells.length < 2) {
    return false;
  }
  const id = String(cells[0] ?? '').trim();
  return UUID_LIKE.test(id);
}

/**
 * @param {string[][]} rows non-empty
 * @returns {{ idI: number, titleI: number, doneI: number, createdI: number, firstDataRow: number }}
 */
function resolveTodoColumnLayout(rows) {
  const header = rows[0];
  const idI = findColumnIndexAny(header, 'id');
  const titleI = findColumnIndexAny(header, 'title', 'todo', 'task', 'name');
  const doneI = findColumnIndexAny(header, 'done', 'complete', 'completed');
  const createdI = findColumnIndexAny(header, 'createdat', 'created', 'date');

  if (idI !== -1 && titleI !== -1) {
    return { idI, titleI, doneI, createdI, firstDataRow: 1 };
  }

  if (looksLikeTodoDataRow(header)) {
    return {
      idI: 0,
      titleI: 1,
      doneI: header.length > 2 ? 2 : -1,
      createdI: header.length > 3 ? 3 : -1,
      firstDataRow: 0
    };
  }

  throw new Error(
    `Row 1 should be headers (id, title, …) or a data row with a UUID in column A. Your row 1: ${JSON.stringify(
      header
    )}`
  );
}

/**
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {string} id
 * @param {string} newTitle
 * @param {string} accessToken
 */
async function updateTodoTitleById(spreadsheetId, sheetName, id, newTitle, accessToken) {
  const range = `${sheetName}!A:D`;
  const rows = await getValues(spreadsheetId, range, accessToken);
  if (!rows.length) {
    throw new Error('Sheet has no rows');
  }
  const { idI, titleI, firstDataRow } = resolveTodoColumnLayout(rows);
  if (titleI === -1) {
    throw new Error('No title column found');
  }
  for (let i = firstDataRow; i < rows.length; i++) {
    if (String(rows[i][idI] ?? '').trim() === id) {
      const sheetRow = i + 1;
      const col = a1ColumnLetter(titleI);
      const cellRange = `${sheetName}!${col}${sheetRow}`;
      await putValues(spreadsheetId, cellRange, [[newTitle]], accessToken);
      return;
    }
  }
  throw new Error('Todo not found');
}

/**
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {string} id
 * @param {string} accessToken
 */
async function deleteRowById(spreadsheetId, sheetName, id, accessToken) {
  const range = `${sheetName}!A:D`;
  const rows = await getValues(spreadsheetId, range, accessToken);
  if (!rows.length) {
    return;
  }
  const { idI: idCol, firstDataRow } = resolveTodoColumnLayout(rows);
  const sheetId = await getSheetIdByTitle(spreadsheetId, sheetName, accessToken);
  for (let i = firstDataRow; i < rows.length; i++) {
    if (String(rows[i][idCol] ?? '').trim() === id) {
      await deleteSheetRow(spreadsheetId, sheetId, i + 1, accessToken);
      return;
    }
  }
}

/**
 * @param {{ spreadsheetId: string, sheetName: string, getAccessToken: () => Promise<string> }} opts
 */
export function createGoogleSheetClient(opts) {
  const { spreadsheetId, sheetName, getAccessToken } = opts;

  async function token() {
    return getAccessToken();
  }

  return {
    sheetName,

    /** @returns {Promise<{ id: string, title: string, done: string, createdAt: string }[]>} */
    async listTodos() {
      const t = await token();
      const range = `${sheetName}!A:D`;
      const rows = await getValues(spreadsheetId, range, t);
      if (!rows.length) {
        return [];
      }
      const { idI, titleI, doneI, createdI, firstDataRow } = resolveTodoColumnLayout(rows);
      const out = [];
      for (let r = firstDataRow; r < rows.length; r++) {
        const row = rows[r];
        out.push({
          id: row[idI] ?? '',
          title: row[titleI] ?? '',
          done: doneI === -1 ? '' : row[doneI] ?? '',
          createdAt: createdI === -1 ? '' : row[createdI] ?? ''
        });
      }
      return out;
    },

    /** @param {string} title */
    async addTodo(title) {
      const t = await token();
      const row = [crypto.randomUUID(), title, 'FALSE', new Date().toISOString()];
      await appendRow(spreadsheetId, `${sheetName}!A:D`, row, t);
    },

    /** @param {string} id */
    async removeTodo(id) {
      const t = await token();
      await deleteRowById(spreadsheetId, sheetName, id, t);
    },

    /** @param {string} id @param {string} title */
    async updateTodoTitle(id, title) {
      const t = await token();
      await updateTodoTitleById(spreadsheetId, sheetName, id, title, t);
    }
  };
}
