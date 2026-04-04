/** Google Identity Services — OAuth access token (browser, no backend). */

import { clientId as siteClientId } from './site-config.js';

/**
 * Per-file access: spreadsheets the user creates or opens through this app.
 * Does not grant access to all Sheets in the account (unlike `.../auth/spreadsheets`).
 * Also used to add Drive collaborators (`permissions.create`) on files this app created.
 * Enable the Google **Drive API** in the same Cloud project as Sheets.
 */
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Site-wide personal spreadsheet file id (shared by apps on the same origin). */
export const LS_SPREADSHEET_ID = 'google-db.spreadsheetId';

/** @returns {string} Trimmed workbook id from `localStorage`, or `''` if missing/unreadable. */
export function getStoredSpreadsheetId() {
  try {
    return (localStorage.getItem(LS_SPREADSHEET_ID) || '').trim();
  } catch {
    return '';
  }
}

/**
 * Resolves when `https://accounts.google.com/gsi/client` has exposed the OAuth2 token client
 * (`google.accounts.oauth2`). Call before `initGoogleAuth()` if GIS is loaded with `defer`.
 * @returns {Promise<void>}
 */
export function waitForGoogle() {
  return new Promise((resolve) => {
    if (globalThis.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const id = setInterval(() => {
      if (globalThis.google?.accounts?.oauth2) {
        clearInterval(id);
        resolve();
      }
    }, 30);
  });
}

/** Closed popup or denied consent — not an application error. */
export class OAuthUserCancelledError extends Error {
  constructor(message = 'Sign-in was cancelled.') {
    super(message);
    this.name = 'OAuthUserCancelledError';
    /** Stable marker when `instanceof` breaks (e.g. some devtools / proxies). */
    this.code = 'OAUTH_USER_CANCELLED';
  }
}

/** @param {unknown} e */
export function isOAuthUserCancelledError(e) {
  if (e instanceof OAuthUserCancelledError) {
    return true;
  }
  if (
    e &&
    typeof e === 'object' &&
    'code' in e &&
    /** @type {{ code?: unknown }} */ (e).code === 'OAUTH_USER_CANCELLED'
  ) {
    return true;
  }
  return e instanceof Error && e.name === 'OAuthUserCancelledError';
}

const LS_ACCESS = 'google-db.oauthAccessToken';
const LS_EXPIRES = 'google-db.oauthExpiresAt';
const EXPIRY_SKEW_MS = 120_000;

let tokenClient = null;
let initedClientId = null;
let accessToken = null;

/** @type {{ resolve: (v: string) => void, reject: (e: Error) => void, prompt: string } | null} */
let pendingToken = null;

function debugOAuthTokenReceived(resp, flowLabel) {
  const scopeStr = resp.scope != null ? String(resp.scope) : '';
  const scopes = scopeStr.split(/\s+/).filter(Boolean);
  console.log('[google-db/auth] OAuth token received', {
    flow: flowLabel,
    expiresIn: resp.expires_in,
    tokenType: resp.token_type,
    scopes,
    accessTokenLength: typeof resp.access_token === 'string' ? resp.access_token.length : 0
  });
}

function clearPending() {
  pendingToken = null;
}

function clearPersistedAccessToken() {
  try {
    localStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_EXPIRES);
  } catch {
    /* private mode / quota */
  }
}

function readValidPersistedAccessToken() {
  try {
    const t = localStorage.getItem(LS_ACCESS);
    const expRaw = localStorage.getItem(LS_EXPIRES);
    if (!t || !expRaw) {
      return null;
    }
    const expiresAt = Number(expRaw);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt - EXPIRY_SKEW_MS) {
      clearPersistedAccessToken();
      accessToken = null;
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

function persistAccessToken(token, expiresInSec) {
  const sec = Number(expiresInSec);
  const lifetime = Number.isFinite(sec) && sec > 0 ? sec : 3600;
  const expiresAt = Date.now() + lifetime * 1000;
  try {
    localStorage.setItem(LS_ACCESS, token);
    localStorage.setItem(LS_EXPIRES, String(expiresAt));
  } catch {
    /* still usable in-memory this session */
  }
}

/**
 * Call after GIS script is loaded. Uses `clientId` from `site-config.js`.
 * @param {{ force?: boolean }} [opts] Pass `force: false` to reuse a cached
 *   token client. Defaults to `true` — always recreates the client to avoid
 *   stale GIS callbacks after long idle periods or bfcache restoration.
 */
export function initGoogleAuth(opts = {}) {
  const { force = true } = opts;
  const clientId = (siteClientId || '').trim();
  if (!clientId) {
    throw new Error('Set clientId in google-db/site-config.js.');
  }
  if (!globalThis.google?.accounts?.oauth2) {
    throw new Error('Google GIS script not loaded yet');
  }
  if (!force && initedClientId === clientId && tokenClient) {
    return;
  }
  clearPending();
  initedClientId = clientId;
  tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: OAUTH_SCOPE,
    callback: (resp) => {
      if (!pendingToken) {
        return;
      }
      const { resolve, reject, prompt } = pendingToken;
      clearPending();
      if (resp.error !== undefined) {
        const code = String(resp.error);
        if (code === 'access_denied') {
          reject(new OAuthUserCancelledError());
          return;
        }
        const detail = resp.error_description
          ? `${resp.error}: ${resp.error_description}`
          : String(resp.error);
        reject(new Error(detail));
        return;
      }
      accessToken = resp.access_token;
      persistAccessToken(accessToken, resp.expires_in);
      debugOAuthTokenReceived(resp, prompt === 'consent' ? 'sign-in' : 'token');
      resolve(accessToken);
    },
    error_callback: (err) => {
      if (!pendingToken) {
        return;
      }
      const { reject } = pendingToken;
      clearPending();
      const type = err && typeof err === 'object' && 'type' in err ? String(err.type) : 'unknown';
      if (type === 'popup_closed') {
        reject(new OAuthUserCancelledError('Sign-in window was closed before finishing.'));
        return;
      }
      if (type === 'popup_failed_to_open') {
        reject(
          new Error(
            'Google sign-in could not open a popup (often blocked on automatic load). Allow popups for this site, or click “Sign in with Google”.'
          )
        );
        return;
      }
      console.error('[google-db/auth] GIS error_callback', err);
      reject(new Error(`Google sign-in failed (${type}).`));
    }
  });
}

export function requestAccessToken(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error('initGoogleAuth() not called'));
      return;
    }
    const { prompt = '' } = opts;
    clearPending();
    pendingToken = { resolve, reject, prompt };
    try {
      tokenClient.requestAccessToken({ prompt });
    } catch (e) {
      clearPending();
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export function getCachedAccessToken() {
  const fromLs = readValidPersistedAccessToken();
  if (fromLs) {
    accessToken = fromLs;
    return fromLs;
  }
  // OAuth callback sets `accessToken` before persist; if localStorage fails (private mode,
  // quota, SecurityError), the next call here used to wipe memory and break sign-in.
  if (typeof accessToken === 'string' && accessToken.length > 0) {
    return accessToken;
  }
  accessToken = null;
  return null;
}

export function clearAccessToken() {
  accessToken = null;
  clearPending();
  clearPersistedAccessToken();
}
