// Cross-app share helper. Other apps call Posts.share({ text })
// to stash a draft and open the Posts compose UI.
//
// Load with: <script type="module" src="/posts/share-client.js"></script>
// Or: import { share } from '/posts/share-client.js'

import { CONFIG } from './config.js';

const IDB_NAME = 'posts-share';
const IDB_STORE = 'drafts';

/**
 * @typedef {{
 *   text?: string,
 *   attachments?: Array<Blob|File|string>,
 *   images?: Array<Blob|File|string>,
 *   email?: string
 * }} PostSharePayload
 */

/**
 * Stash a text draft and navigate to Posts compose.
 * Image/audio payloads are ignored (the board is text-only).
 * @param {PostSharePayload} payload
 * @returns {Promise<void>}
 */
export async function share(payload = {}) {
  const text = typeof payload.text === 'string' ? payload.text : '';
  const email = typeof payload.email === 'string' ? payload.email : '';
  const raw =
    (Array.isArray(payload.attachments) && payload.attachments) ||
    (Array.isArray(payload.images) && payload.images) ||
    [];

  const draft = {
    text,
    email,
    attachments: [],
    mediaDropped: raw.length > 0,
    createdAt: Date.now()
  };

  await persistDraft(draft);

  const base = new URL('/posts/', window.location.origin);
  base.searchParams.set('compose', '1');
  window.location.assign(base.href);
}

/**
 * @returns {Promise<object|null>}
 */
export async function loadDraft() {
  const key = CONFIG.draftKey;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      sessionStorage.removeItem(key);
      return JSON.parse(raw);
    }
  } catch {
    /* fall through */
  }

  try {
    const db = await openDb();
    const rec = await idbGet(db, key);
    if (rec) await idbDelete(db, key);
    db.close();
    return rec || null;
  } catch {
    return null;
  }
}

/**
 * @param {object} draft
 */
async function persistDraft(draft) {
  const key = CONFIG.draftKey;
  const json = JSON.stringify(draft);
  try {
    sessionStorage.setItem(key, json);
    return;
  } catch {
    /* quota / private mode — IndexedDB next */
  }
  try {
    const db = await openDb();
    await idbPut(db, key, draft);
    db.close();
  } catch (err) {
    console.warn('[Posts] could not persist share draft', err);
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} key
 */
function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} key
 * @param {object} value
 */
function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} key
 */
function idbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
