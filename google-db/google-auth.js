/** Google Identity Services — OAuth access token (browser, no backend). */

/**
 * Per-file access: only spreadsheets the user opens via this app (e.g. Google Picker).
 * Does not grant access to all Sheets in the account (unlike `.../auth/spreadsheets`).
 */
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.file';

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

export function initGoogleAuth(clientId) {
  if (!globalThis.google?.accounts?.oauth2) {
    throw new Error('Google GIS script not loaded yet');
  }
  if (initedClientId === clientId && tokenClient) {
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
  accessToken = null;
  return null;
}

export function clearAccessToken() {
  accessToken = null;
  clearPending();
  clearPersistedAccessToken();
}
