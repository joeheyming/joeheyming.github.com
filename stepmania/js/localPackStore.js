const DB_NAME = 'heyming-stepmania-packs';
const DB_VERSION = 1;
const STORE = 'drafts';

/**
 * @typedef {Object} PackDraft
 * @property {string} id
 * @property {string} title
 * @property {string} artist
 * @property {number} updatedAt
 * @property {Blob} zipBlob
 */

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

/**
 * @param {PackDraft} draft
 */
export async function saveDraft(draft) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(draft);
    tx.oncomplete = () => resolve(draft);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {string} id
 * @returns {Promise<PackDraft | null>}
 */
export async function loadDraft(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @returns {Promise<Array<{id: string, title: string, artist: string, updatedAt: number}>>}
 */
export async function listDrafts() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result || []).map((row) => ({
        id: row.id,
        title: row.title,
        artist: row.artist,
        updatedAt: row.updatedAt
      }));
      rows.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export function newDraftId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
