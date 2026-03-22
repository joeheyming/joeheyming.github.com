/** Google Sheets API v4 — generic REST helpers (fetch + Bearer token). */

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
