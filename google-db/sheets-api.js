/** Google Sheets API v4 — generic REST helpers (fetch + Bearer token). */

import { SITE_SPREADSHEET_DOCUMENT_TITLE } from './site-config.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export async function fetchSpreadsheetMeta(spreadsheetId, accessToken) {
  const url = `${API}/${encodeURIComponent(
    spreadsheetId
  )}?fields=sheets(properties(sheetId,title))`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

/**
 * Like {@link fetchSpreadsheetMeta} but returns `{ ok }` instead of throwing (e.g. 403 before Picker).
 * @returns {Promise<{ ok: true } | { ok: false, status: number, text: string }>}
 */
export async function tryFetchSpreadsheetMeta(spreadsheetId, accessToken) {
  const url = `${API}/${encodeURIComponent(
    spreadsheetId
  )}?fields=sheets(properties(sheetId,title))`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const text = await res.text();
  if (res.ok) {
    return { ok: true };
  }
  return { ok: false, status: res.status, text };
}

/**
 * A1 range with a quoted sheet title (required when the name contains hyphens, spaces, etc.).
 * @param {string} sheetTitle
 * @param {string} rangeSuffix e.g. `A:D` or `A1:D1`
 */
export function a1Range(sheetTitle, rangeSuffix) {
  const escaped = String(sheetTitle).replace(/'/g, "''");
  return `'${escaped}'!${rangeSuffix}`;
}

/**
 * Create a new spreadsheet (works with OAuth scope `drive.file`).
 * Uses `SITE_SPREADSHEET_DOCUMENT_TITLE` from `site-config.js` unless `documentTitle` is passed.
 * @param {string} accessToken
 * @param {{ documentTitle?: string, sheetTitles?: string[] }} [opts] — pass `sheetTitles` for initial tabs (e.g. your app’s first table).
 * @returns {Promise<{ spreadsheetId: string }>}
 */
export async function createSpreadsheet(accessToken, opts = {}) {
  const { documentTitle = SITE_SPREADSHEET_DOCUMENT_TITLE, sheetTitles = ['Sheet1'] } = opts;
  const body = {
    properties: { title: documentTitle },
    sheets: sheetTitles.map((title) => ({ properties: { title } }))
  };
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = await res.json();
  const spreadsheetId = data.spreadsheetId;
  if (!spreadsheetId || typeof spreadsheetId !== 'string') {
    throw new Error('Could not read spreadsheetId from create response');
  }
  return { spreadsheetId };
}

export async function getSheetIdByTitle(spreadsheetId, title, accessToken) {
  const meta = await fetchSpreadsheetMeta(spreadsheetId, accessToken);
  const sheet = meta.sheets?.find((s) => s.properties?.title === title);
  if (!sheet) {
    throw new Error(`Sheet "${title}" not found`);
  }
  return sheet.properties.sheetId;
}

export async function listSheetTabs(spreadsheetId, accessToken) {
  const meta = await fetchSpreadsheetMeta(spreadsheetId, accessToken);
  return (meta.sheets || []).map((s) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title
  }));
}

export async function renameSheetTab(spreadsheetId, sheetId, newTitle, accessToken) {
  const body = {
    requests: [
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            title: newTitle
          },
          fields: 'title'
        }
      }
    ]
  };
  const url = `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function createSheetTab(spreadsheetId, title, accessToken) {
  const body = {
    requests: [
      {
        addSheet: {
          properties: { title }
        }
      }
    ]
  };
  const url = `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = await res.json();
  const props = data.replies?.[0]?.addSheet?.properties;
  if (!props?.sheetId) {
    throw new Error('Could not read new sheet from API response');
  }
  return { sheetId: props.sheetId, title: props.title ?? title };
}

/**
 * Deletes a sheet tab (cannot remove the last tab in a spreadsheet).
 * @param {string} spreadsheetId
 * @param {number} sheetId numeric sheet id
 * @param {string} accessToken
 */
export async function deleteSheetTab(spreadsheetId, sheetId, accessToken) {
  const body = {
    requests: [{ deleteSheet: { sheetId } }]
  };
  const url = `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function getValues(spreadsheetId, range, accessToken) {
  const enc = encodeURIComponent(range);
  const url = `${API}/${encodeURIComponent(spreadsheetId)}/values/${enc}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = await res.json();
  return data.values || [];
}

export async function appendRow(spreadsheetId, range, row, accessToken) {
  const enc = encodeURIComponent(range);
  const url = `${API}/${encodeURIComponent(
    spreadsheetId
  )}/values/${enc}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [row] })
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

/**
 * Like {@link appendRow} but writes many rows in a single API call. Prefer this
 * when you have buffered data (e.g. streamed GPS samples) so you don't blow
 * through the per-minute write quota.
 *
 * @param {string} spreadsheetId
 * @param {string} range
 * @param {unknown[][]} rows
 * @param {string} accessToken
 */
export async function appendRows(spreadsheetId, range, rows, accessToken) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  const enc = encodeURIComponent(range);
  const url = `${API}/${encodeURIComponent(
    spreadsheetId
  )}/values/${enc}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: rows })
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export function a1ColumnLetter(zeroBasedCol) {
  let n = zeroBasedCol + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function putValues(spreadsheetId, range, values, accessToken) {
  const enc = encodeURIComponent(range);
  const url = `${API}/${encodeURIComponent(
    spreadsheetId
  )}/values/${enc}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values })
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function deleteSheetRow(spreadsheetId, sheetId, rowIndex1Based, accessToken) {
  const startIndex = rowIndex1Based - 1;
  const body = {
    requests: [
      {
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex,
            endIndex: startIndex + 1
          }
        }
      }
    ]
  };
  const url = `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

/** @param {string} s */
function driveQueryLiteral(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Lists spreadsheets visible with OAuth scope `drive.file` (files the user opened or created with this app).
 * Results are ordered by `modifiedTime` descending when possible.
 *
 * @param {string} accessToken
 * @param {{ exactName?: string }} [opts] — if `exactName` is set, only files with that exact Drive title match
 * @returns {Promise<{ id: string, name: string }[]>}
 */
export async function listAccessibleSpreadsheets(accessToken, opts = {}) {
  const { exactName } = opts;
  let q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  if (exactName != null && String(exactName).trim() !== '') {
    q += ` and name='${driveQueryLiteral(String(exactName).trim())}'`;
  }
  const out = [];
  let pageToken = '';
  for (;;) {
    const params = new URLSearchParams({
      q,
      spaces: 'drive',
      fields: 'nextPageToken, files(id, name)',
      pageSize: '100',
      orderBy: 'modifiedTime desc'
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    const url = `${DRIVE_FILES}?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = await res.json();
    const files = Array.isArray(data.files) ? data.files : [];
    for (const f of files) {
      if (f?.id && f?.name) {
        out.push({ id: String(f.id), name: String(f.name) });
      }
    }
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
    if (!pageToken) {
      break;
    }
  }
  return out;
}
