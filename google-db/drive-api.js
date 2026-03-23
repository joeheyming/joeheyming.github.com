/** Google Drive API v3 — permissions (browser, Bearer token). */

const DRIVE = 'https://www.googleapis.com/drive/v3';

/**
 * Grant a user access to a file. Works for spreadsheets created by this app when using scope `drive.file`.
 *
 * @param {string} fileId
 * @param {string} emailAddress
 * @param {'reader' | 'writer' | 'commenter'} role
 * @param {string} accessToken
 */
export async function createUserPermission(fileId, emailAddress, role, accessToken) {
  const email = String(emailAddress || '').trim();
  if (!email) {
    throw new Error('Empty email address');
  }
  const url = `${DRIVE}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'user',
      role,
      emailAddress: email
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive permission failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Extract a spreadsheet id from a Google Sheets URL or return the string if it already looks like an id.
 * @param {string} raw
 * @returns {string | null}
 */
export function parseSpreadsheetIdFromInput(raw) {
  const s = String(raw || '').trim();
  if (!s) {
    return null;
  }
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(s);
  if (fromUrl) {
    return fromUrl[1];
  }
  if (/^[a-zA-Z0-9-_]+$/.test(s) && s.length >= 20) {
    return s;
  }
  return null;
}
