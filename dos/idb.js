// dos/idb.js — IndexedDB store for cached game bundles and per-game saves.
//
// Two object stores live in the same database:
//
//   `bundles`  — the original or repacked .jsdos/.zip blob, keyed by a
//                stable game id (derived from the source URL or file
//                fingerprint). One entry per game; lets us skip the
//                download on subsequent launches.
//
//   `saves`    — the DOSBox in-memory filesystem snapshot produced by
//                `ci.fsTree()` / `ci.persist()`. One entry per game.
//                On launch we re-mount this before handing control to
//                the user, so save files (e.g. SAV/CFG inside the game
//                directory) survive across sessions.
//
// We deliberately store ArrayBuffer / Uint8Array blobs directly — IDB
// supports them natively, no base64 needed, and the storage cost is
// roughly the raw byte count. Modern browsers give IDB at least several
// hundred MB without prompting; large game collections live happily here.

const DB_NAME = 'heyming.dos.v1';
const DB_VERSION = 1;
const STORE_BUNDLES = 'bundles';
const STORE_SAVES = 'saves';

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BUNDLES)) {
        db.createObjectStore(STORE_BUNDLES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SAVES)) {
        db.createObjectStore(STORE_SAVES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB open failed'));
  });
  return dbPromise;
}

/** Promisify an IDBRequest. */
function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB request failed'));
  });
}

/**
 * Game metadata + bundle bytes, stored together so a single get() call
 * gives us everything we need to launch.
 *
 * @typedef {Object} BundleEntry
 * @property {string} id
 * @property {string} name           User-facing display name.
 * @property {string} [source]       Original URL the bundle came from.
 * @property {string} [sourceLabel]  e.g. "archive.org: msdos_…".
 * @property {string} [bootCommand]  Auto-detected launch command (informational).
 * @property {number} size           Byte length of `bytes`.
 * @property {number} addedAt        ms epoch.
 * @property {number} lastPlayedAt   ms epoch.
 * @property {Uint8Array} bytes      The repacked .jsdos bundle.
 */

/** @returns {Promise<BundleEntry[]>} */
export async function listBundles() {
  const db = await openDb();
  const tx = db.transaction(STORE_BUNDLES, 'readonly');
  const all = await reqAsPromise(tx.objectStore(STORE_BUNDLES).getAll());
  return /** @type {BundleEntry[]} */ (all).sort(
    (a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0)
  );
}

/** @returns {Promise<BundleEntry | undefined>} */
export async function getBundle(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_BUNDLES, 'readonly');
  return reqAsPromise(tx.objectStore(STORE_BUNDLES).get(id));
}

/** @param {BundleEntry} entry */
export async function putBundle(entry) {
  const db = await openDb();
  const tx = db.transaction(STORE_BUNDLES, 'readwrite');
  await reqAsPromise(tx.objectStore(STORE_BUNDLES).put(entry));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error || new Error('IDB tx failed'));
  });
}

export async function deleteBundle(id) {
  const db = await openDb();
  const tx = db.transaction([STORE_BUNDLES, STORE_SAVES], 'readwrite');
  await Promise.all([
    reqAsPromise(tx.objectStore(STORE_BUNDLES).delete(id)),
    reqAsPromise(tx.objectStore(STORE_SAVES).delete(id))
  ]);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error || new Error('IDB tx failed'));
  });
}

export async function touchBundle(id) {
  const existing = await getBundle(id);
  if (!existing) return;
  existing.lastPlayedAt = Date.now();
  await putBundle(existing);
}

/**
 * @typedef {Object} SaveEntry
 * @property {string} id          Matches the bundle id.
 * @property {number} savedAt     ms epoch.
 * @property {Uint8Array} bytes   js-dos FS snapshot (a zip of changed files).
 */

/** @returns {Promise<SaveEntry | undefined>} */
export async function getSave(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_SAVES, 'readonly');
  return reqAsPromise(tx.objectStore(STORE_SAVES).get(id));
}

/** @param {string} id @param {Uint8Array} bytes */
export async function putSave(id, bytes) {
  const db = await openDb();
  const tx = db.transaction(STORE_SAVES, 'readwrite');
  await reqAsPromise(tx.objectStore(STORE_SAVES).put({ id, bytes, savedAt: Date.now() }));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error || new Error('IDB tx failed'));
  });
}

/**
 * Stable id derived from a source URL. Plain hash of the URL string;
 * collisions are essentially impossible in practice and we avoid the
 * dependency cost of importing a real digest just for keying IDB.
 */
export function idFromUrl(url) {
  const norm = String(url || '')
    .trim()
    .toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'url-' + h.toString(16).padStart(8, '0');
}

/**
 * Stable id derived from a File object — size + name + a quick hash of
 * the first 64 KiB. Avoids hashing the whole multi-MB file just to key
 * IDB, while still being collision-resistant for the per-user library.
 *
 * @param {File} file
 */
export async function idFromFile(file) {
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  let h = 0x811c9dc5;
  for (let i = 0; i < head.length; i++) {
    h ^= head[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const sizeHex = file.size.toString(16);
  return 'file-' + sizeHex + '-' + h.toString(16).padStart(8, '0');
}
