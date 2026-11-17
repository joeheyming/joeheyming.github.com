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
const PAINT_KEY = 'paint';
const IMAGINE_KEY = 'imagine';

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
 * @param {string} key
 * @param {Blob} blob
 * @param {string} fileName
 * @returns {Promise<void>}
 */
async function stageImage(key, blob, fileName) {
  const db = await openDb();
  try {
    /** @type {StagedImage} */
    const record = { blob, fileName, createdAt: Date.now() };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record, key);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Read and clear one slot. Returns null when nothing is staged or the
 * staged image has expired. The slot is always cleared.
 *
 * @param {string} key
 * @param {number} [now]
 * @returns {Promise<StagedImage | null>}
 */
async function takeImage(key, now = Date.now()) {
  const db = await openDb();
  try {
    /** @type {unknown} */
    let record = null;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        record = getReq.result ?? null;
        store.delete(key);
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

/**
 * Put a PNG where Paint will find it on its next boot.
 *
 * @param {Blob} blob
 * @param {string} fileName
 * @returns {Promise<void>}
 */
export function stageImageForPaint(blob, fileName) {
  return stageImage(PAINT_KEY, blob, fileName);
}

/**
 * Put a PNG where Imagine will use it as the SD-Turbo source.
 *
 * @param {Blob} blob
 * @param {string} fileName
 * @returns {Promise<void>}
 */
export function stageImageForImagine(blob, fileName) {
  return stageImage(IMAGINE_KEY, blob, fileName);
}

/**
 * Read and clear the image staged for Paint.
 *
 * @param {number} [now]
 * @returns {Promise<StagedImage | null>}
 */
export function takeStagedImage(now) {
  return takeImage(PAINT_KEY, now);
}

/**
 * Read and clear the image staged for Imagine.
 *
 * @param {number} [now]
 * @returns {Promise<StagedImage | null>}
 */
export function takeImagineImage(now) {
  return takeImage(IMAGINE_KEY, now);
}
