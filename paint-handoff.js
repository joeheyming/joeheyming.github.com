/**
 * Hand one image from a site app to Paint.
 *
 * The sender (Imagine) stages a PNG blob in IndexedDB. Paint reads and
 * clears the slot once on boot, then places the image as a new layer.
 * Both apps are same-origin, so this works for standalone tabs and for
 * HeymingOS iframes alike. A staged image expires after a short TTL so
 * an unrelated Paint session opened later does not pick it up.
 */

const DB_NAME = 'heyming-handoff';
const STORE = 'pending';
const KEY = 'paint';

/** A staged image older than this is ignored and discarded. */
export const HANDOFF_TTL_MS = 2 * 60 * 1000;

/**
 * @typedef {{ blob: Blob, fileName: string, createdAt: number }} StagedImage
 */

/**
 * @param {unknown} record
 * @param {number} [now]
 * @param {number} [ttlMs]
 * @returns {record is StagedImage}
 */
export function isFreshHandoff(record, now = Date.now(), ttlMs = HANDOFF_TTL_MS) {
  if (!record || typeof record !== 'object') return false;
  const r = /** @type {Partial<StagedImage>} */ (record);
  if (!(r.blob instanceof Blob)) return false;
  if (typeof r.createdAt !== 'number') return false;
  const age = now - r.createdAt;
  return age >= 0 && age <= ttlMs;
}

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Put a PNG where Paint will find it on its next boot.
 *
 * @param {Blob} blob
 * @param {string} fileName
 * @returns {Promise<void>}
 */
export async function stageImageForPaint(blob, fileName) {
  const db = await openDb();
  try {
    /** @type {StagedImage} */
    const record = { blob, fileName, createdAt: Date.now() };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record, KEY);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Read and clear the staged image. Returns null when nothing is staged
 * or the staged image has expired. The slot is always cleared.
 *
 * @param {number} [now]
 * @returns {Promise<StagedImage | null>}
 */
export async function takeStagedImage(now = Date.now()) {
  const db = await openDb();
  try {
    /** @type {unknown} */
    let record = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const getReq = store.get(KEY);
      getReq.onsuccess = () => {
        record = getReq.result ?? null;
        store.delete(KEY);
      };
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return isFreshHandoff(record, now) ? record : null;
  } finally {
    db.close();
  }
}
