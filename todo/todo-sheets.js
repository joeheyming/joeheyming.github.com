/**
 * Todo rows backed by a {@link ../google-db/site-database.js} workbook table.
 */

import { a1ColumnLetter } from '../google-db/sheets-api.js';

/**
 * @typedef {import('../google-db/site-database.js').SiteDatabase} SiteDatabase
 */

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
 * @param {SiteDatabase} db
 * @param {string} sheetName
 * @param {string} id
 * @param {string} newTitle
 */
/**
 * @param {unknown} doneVal
 * @returns {boolean}
 */
export function isTodoDoneValue(doneVal) {
  const s = String(doneVal ?? '')
    .trim()
    .toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES';
}

async function updateTodoDoneById(db, sheetName, id, done) {
  const rows = await db.readRange(sheetName, 'A:D');
  if (!rows.length) {
    throw new Error('Sheet has no rows');
  }
  const { idI, doneI, firstDataRow } = resolveTodoColumnLayout(rows);
  if (doneI === -1) {
    throw new Error('No done column found');
  }
  const cell = done ? 'TRUE' : 'FALSE';
  for (let i = firstDataRow; i < rows.length; i++) {
    if (String(rows[i][idI] ?? '').trim() === id) {
      const sheetRow = i + 1;
      const col = a1ColumnLetter(doneI);
      await db.writeRange(sheetName, `${col}${sheetRow}`, [[cell]]);
      return;
    }
  }
  throw new Error('Todo not found');
}

async function updateTodoTitleById(db, sheetName, id, newTitle) {
  const rows = await db.readRange(sheetName, 'A:D');
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
      await db.writeRange(sheetName, `${col}${sheetRow}`, [[newTitle]]);
      return;
    }
  }
  throw new Error('Todo not found');
}

/**
 * @param {SiteDatabase} db
 * @param {string} sheetName
 * @param {string} id
 */
async function deleteRowById(db, sheetName, id) {
  const rows = await db.readRange(sheetName, 'A:D');
  if (!rows.length) {
    return;
  }
  const { idI: idCol, firstDataRow } = resolveTodoColumnLayout(rows);
  for (let i = firstDataRow; i < rows.length; i++) {
    if (String(rows[i][idCol] ?? '').trim() === id) {
      await db.deleteTableDataRow(sheetName, i + 1);
      return;
    }
  }
}

/**
 * @param {{ db: SiteDatabase, sheetName: string }} opts
 */
export function createGoogleSheetClient(opts) {
  const { db, sheetName } = opts;

  return {
    sheetName,

    /** @returns {Promise<{ id: string, title: string, done: string, createdAt: string }[]>} */
    async listTodos() {
      const rows = await db.readRange(sheetName, 'A:D');
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
      const row = [crypto.randomUUID(), title, 'FALSE', new Date().toISOString()];
      await db.appendTableRow(sheetName, 'A:D', row);
    },

    /** @param {string} id */
    async removeTodo(id) {
      await deleteRowById(db, sheetName, id);
    },

    /** @param {string} id @param {string} title */
    async updateTodoTitle(id, title) {
      await updateTodoTitleById(db, sheetName, id, title);
    },

    /** @param {string} id @param {boolean} done */
    async setTodoDone(id, done) {
      await updateTodoDoneById(db, sheetName, id, done);
    }
  };
}
