// Remember ROM bytes in this browser so the next launch skips the network.
// A direct archive fetch is tried first; CORS failures return null and the
// caller falls back to the proxy. The cache is capped and drops the oldest
// files when a new one will not fit.
(function () {
  'use strict';

  const DB_NAME = 'heyming-emulator-roms';
  const DB_VERSION = 1;
  const STORE = 'roms';
  const CAP = 256 * 1024 * 1024;
  const DIRECT_HEADER_MS = 4000;

  /**
   * @param {Array<{ key: string, size: number, savedAt: number }>} entries
   * @param {number} incomingSize
   * @param {number} [cap]
   * @returns {{ store: boolean, drop: string[] }}
   */
  function planEviction(entries, incomingSize, cap) {
    const limit = cap == null ? CAP : cap;
    if (!Number.isFinite(incomingSize) || incomingSize <= 0 || incomingSize > limit) {
      return { store: false, drop: [] };
    }
    const sorted = (entries || [])
      .slice()
      .sort((a, b) => a.savedAt - b.savedAt || String(a.key).localeCompare(String(b.key)));
    let used = 0;
    for (const entry of sorted) used += entry.size || 0;
    /** @type {string[]} */
    const drop = [];
    let i = 0;
    while (used + incomingSize > limit && i < sorted.length) {
      drop.push(sorted[i].key);
      used -= sorted[i].size || 0;
      i += 1;
    }
    return { store: used + incomingSize <= limit, drop };
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'url' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * @param {IDBDatabase} db
   * @param {string} mode
   */
  function storeOf(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  /**
   * @param {IDBRequest} req
   */
  function requestDone(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * @param {string} url
   * @returns {Promise<Uint8Array | null>}
   */
  async function read(url) {
    const key = String(url || '');
    if (!key) return null;
    let db;
    try {
      db = await openDb();
      const row = await requestDone(storeOf(db, 'readonly').get(key));
      if (!row || !row.bytes) return null;
      const bytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes);
      return bytes.byteLength ? bytes : null;
    } catch (err) {
      console.warn('ROM cache read failed', err);
      return null;
    } finally {
      if (db) db.close();
    }
  }

  /**
   * @param {string} url
   * @param {Uint8Array} bytes
   */
  async function write(url, bytes) {
    const key = String(url || '');
    if (!key || !bytes || !bytes.byteLength) return false;
    let db;
    try {
      db = await openDb();
      const existing = await requestDone(storeOf(db, 'readonly').getAll());
      const entries = (existing || [])
        .filter((row) => row && row.url && row.url !== key)
        .map((row) => ({
          key: row.url,
          size: row.size || (row.bytes && row.bytes.byteLength) || 0,
          savedAt: row.savedAt || 0
        }));
      const plan = planEviction(entries, bytes.byteLength, CAP);
      if (!plan.store) return false;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const dropKey of plan.drop) store.delete(dropKey);
      store.put({
        url: key,
        bytes,
        size: bytes.byteLength,
        savedAt: Date.now()
      });
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('ROM cache write aborted'));
      });
      return true;
    } catch (err) {
      console.warn('ROM cache write failed', err);
      return false;
    } finally {
      if (db) db.close();
    }
  }

  /**
   * Direct download with byte progress. Returns null when CORS or the
   * network refuses, so the caller can use the proxy. A caller abort throws.
   * @param {string} url
   * @param {{ signal?: AbortSignal, onProgress?: (p: { received: number, total: number, ratio: number }) => void }} [opts]
   * @returns {Promise<Uint8Array | null>}
   */
  async function fetchDirect(url, opts) {
    const options = opts || {};
    const user = options.signal;
    if (user && user.aborted) throw new DOMException('ROM download cancelled', 'AbortError');
    const headerAbort = new AbortController();
    const headerTimer = setTimeout(() => headerAbort.abort(), DIRECT_HEADER_MS);
    const onUserAbort = () => headerAbort.abort();
    if (user) user.addEventListener('abort', onUserAbort, { once: true });
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: headerAbort.signal
      });
      clearTimeout(headerTimer);
      if (!response.ok || !response.body || typeof response.body.getReader !== 'function') {
        return null;
      }
      const total = Number(response.headers.get('content-length')) || 0;
      const reader = response.body.getReader();
      /** @type {Uint8Array[]} */
      const chunks = [];
      let received = 0;
      for (;;) {
        if (user && user.aborted) {
          try {
            await reader.cancel();
          } catch {
            /* already closed */
          }
          throw new DOMException('ROM download cancelled', 'AbortError');
        }
        const step = await reader.read();
        if (step.done) break;
        if (!step.value) continue;
        chunks.push(step.value);
        received += step.value.byteLength;
        if (options.onProgress) {
          options.onProgress({
            received,
            total,
            ratio: total > 0 ? received / total : 0
          });
        }
      }
      if (!received) return null;
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    } catch (err) {
      if (user && user.aborted) throw new DOMException('ROM download cancelled', 'AbortError');
      return null;
    } finally {
      clearTimeout(headerTimer);
      if (user) user.removeEventListener('abort', onUserAbort);
    }
  }

  /**
   * @param {ParentNode | null | undefined} root
   * @param {{ received?: number, total?: number, ratio?: number }} progress
   */
  function paintProgress(root, progress) {
    if (!root || !progress) return;
    const meter = root.querySelector('.rom-crt-meter');
    const status = root.querySelector('.rom-crt-status');
    const total = Number(progress.total) || 0;
    const received = Number(progress.received) || 0;
    if (meter && total > 0) {
      meter.classList.add('is-measured');
      const ratio = Math.max(0, Math.min(1, Number(progress.ratio) || received / total));
      meter.style.setProperty('--rom-progress', String(ratio));
    }
    if (!status || received <= 0) return;
    if (total > 0) {
      const pct = Math.min(100, Math.round((received / total) * 100));
      status.textContent = `Reading cartridge… ${pct}%`;
    } else {
      const kb = Math.max(1, Math.round(received / 1024));
      status.textContent = `Reading cartridge… ${kb} KB`;
    }
  }

  /**
   * Cache, then a direct fetch of the download URL, then the proxy path.
   * `deps` stays in internet-archive.js so the magic-byte checks and the
   * CDN rewrite are not copied here.
   * @param {{ downloadUrl?: string }} rom
   * @param {{ signal?: AbortSignal, skipDirect?: boolean, onProgress?: (p: { received: number, total: number, ratio: number }) => void }} opts
   * @param {{
   *   looksLikeRomPayload: (ext: string, bytes: Uint8Array) => boolean,
   *   extensionOfUrl: (url: string) => string,
   *   resolveUrl: (url: string) => Promise<string>,
   *   fetchProxied: (url: string, opts: { signal?: AbortSignal }) => Promise<Uint8Array>,
   *   ensureProxy: () => Promise<void>
   * }} deps
   */
  async function loadThroughCache(rom, opts, deps) {
    const options = opts || {};
    const key = String((rom && rom.downloadUrl) || '');
    const ext = deps.extensionOfUrl(key);
    const current = () => window.emulatorRomCache || {};
    if (key && typeof current().read === 'function') {
      const hit = await current().read(key);
      if (hit && deps.looksLikeRomPayload(ext, hit)) return hit;
    }
    await deps.ensureProxy();
    if (!window.proxyService) throw new Error('Proxy service not available');
    if (options.signal && options.signal.aborted) {
      throw new DOMException('ROM download cancelled', 'AbortError');
    }
    let bytes = null;
    if (!options.skipDirect && key && typeof current().fetchDirect === 'function') {
      const direct = await current().fetchDirect(key, {
        signal: options.signal,
        onProgress: options.onProgress
      });
      if (direct && deps.looksLikeRomPayload(ext, direct)) bytes = direct;
    }
    if (!bytes) {
      const url = await deps.resolveUrl(key);
      if (options.signal && options.signal.aborted) {
        throw new DOMException('ROM download cancelled', 'AbortError');
      }
      bytes = await deps.fetchProxied(url, { signal: options.signal });
    }
    if (key && bytes && typeof current().write === 'function') {
      Promise.resolve(current().write(key, bytes)).catch((err) =>
        console.warn('ROM cache write failed', err)
      );
    }
    return bytes;
  }

  window.emulatorRomCache = {
    CAP,
    planEviction,
    read,
    write,
    fetchDirect,
    paintProgress,
    loadThroughCache
  };
})();
