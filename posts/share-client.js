// Cross-app share helper. Other apps call Posts.share({ text, attachments })
// to stash a draft and open the Posts compose UI.
//
// Load with: <script type="module" src="/posts/share-client.js"></script>
// Or: import { share } from '/posts/share-client.js'

import { CONFIG } from './config.js';
import { blobToDataUrl, compressAttachment } from './upload.js';

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
 * Stash a draft and navigate to Posts compose.
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

  const attachments = [];
  for (const item of raw.slice(0, CONFIG.maxAttachmentsPerPost)) {
    if (typeof item === 'string' && /^https?:\/\//i.test(item.trim())) {
      attachments.push(item.trim());
      continue;
    }
    if (item instanceof Blob && item.type.startsWith('audio/')) {
      const encoded = await blobToDataUrl(item);
      if (encoded.length <= CONFIG.maxAudioAttachmentFieldChars) {
        attachments.push(encoded);
      } else {
        console.warn('[Posts] skipping oversized audio attachment');
      }
      continue;
    }
    if (typeof item === 'string' && item.startsWith('data:audio/')) {
      if (item.length <= CONFIG.maxAudioAttachmentFieldChars) attachments.push(item);
      continue;
    }
    if (
      typeof item === 'string' &&
      item.startsWith('data:image/') &&
      item.length <= CONFIG.maxAttachmentFieldChars
    ) {
      attachments.push(item);
      continue;
    }
    if (typeof item === 'string' && item.startsWith('data:')) {
      // Don't stash huge drafts — compress first.
      try {
        const compressed = await compressAttachment(item, {
          maxEdge: CONFIG.maxAttachmentEdge,
          quality: CONFIG.jpegQuality
        });
        attachments.push(await blobToDataUrl(compressed));
      } catch (err) {
        console.warn('[Posts] skipping attachment', err);
      }
      continue;
    }
    if (item instanceof Blob && item.type.startsWith('image/')) {
      const original = await blobToDataUrl(item);
      if (original.length <= CONFIG.maxAttachmentFieldChars) {
        attachments.push(original);
        continue;
      }
    }
    try {
      const compressed = await compressAttachment(item, {
        maxEdge: CONFIG.maxAttachmentEdge,
        quality: CONFIG.jpegQuality
      });
      attachments.push(await blobToDataUrl(compressed));
    } catch (err) {
      console.warn('[Posts] skipping attachment', err);
    }
  }

  const draft = {
    text,
    email,
    attachments,
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
    const fromIdb = await idbGet(key);
    if (fromIdb) {
      await idbDelete(key);
      return fromIdb;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function persistDraft(draft) {
  const key = CONFIG.draftKey;
  const json = JSON.stringify(draft);
  try {
    sessionStorage.setItem(key, json);
    return;
  } catch {
    /* quota — use IndexedDB */
  }
  await idbSet(key, draft);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const api = { share, loadDraft };
window.Posts = api;

export default api;
