const DB_NAME = 'heyming.books.docs';
const STORE = 'docs';

/**
 * @param {string} name
 * @param {number} size
 */
export function documentId(name, size) {
  return `file:${name}:${size}`;
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open documents'));
  });
}

/**
 * @param {{ id: string, title: string, blocks: { type: string, level?: number, text: string }[] }} doc
 */
export async function saveDocument(doc) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(doc);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error || new Error('Could not save the document'));
    });
  } finally {
    db.close();
  }
}

/**
 * @param {string} id
 */
export async function loadDocument(id) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not read the document'));
    });
  } finally {
    db.close();
  }
}

/**
 * @param {string} id
 */
export async function deleteDocument(id) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error || new Error('Could not delete the document'));
    });
  } finally {
    db.close();
  }
}
