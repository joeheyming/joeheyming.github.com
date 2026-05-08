// Shared IWAD fetcher used by both the moddb browser and the existing
// flavor=classic auto-launch path. Fetches doom.wad / doom2.wad once,
// caches them in localStorage as base64 (small enough — doom.wad is ~12 MB,
// doom2.wad ~14 MB; localStorage supports up to ~5-10 MB per origin in most
// browsers, so we use IndexedDB for the actual cache and localStorage only
// for the index).
//
// The engine itself uses IDBFS for /wads, but that mount only exists once
// the engine has booted — too late for us. Instead we keep our own raw
// IndexedDB cache (database "uzdoom-iwads") and feed bytes to
// UZDoomLoader.primeWith({ iwad: { name, data } }) at launch time. The
// loader then writes them to /wads/<name> via FS.writeFile, exactly the
// same path a manual upload would take.
//
// Bundled Freedoom Phase 1 is special — it's preloaded into the wasm via
// Emscripten's --preload-file, exposed at /freedoom1.wad, and selected by
// passing { name, bundled: 'freedoom1.wad' }. No fetch needed.

(function () {
  'use strict';

  const DB_NAME = 'uzdoom-iwads';
  const DB_VERSION = 1;
  const STORE = 'iwads';

  // doom.wad source: same Netlify-hosted shareware wad the existing
  // flavor=classic path uses (CLASSIC_WAD_URL in doom/index.html).
  // doom2.wad: hosted in the same place if the user has it. We default
  // to the same console-doom origin and let it 404 gracefully if not.
  const SOURCES = {
    doom: {
      name: 'doom.wad',
      url: 'https://console-doom.netlify.app/data/doom.wad'
    },
    doom2: {
      name: 'doom2.wad',
      url: 'https://console-doom.netlify.app/data/doom2.wad'
    }
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function dbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // In-memory cache so multiple resolve() calls in the same session don't
  // hit IDB (or the network) more than once.
  const memCache = new Map();

  /**
   * Resolve an IWAD descriptor for UZDoomLoader.primeWith.
   *
   * @param {'freedoom1'|'doom'|'doom2'} choice
   * @param {(msg: string) => void} [onProgress]
   * @returns {Promise<{ name: string, data: Uint8Array|null, bundled?: string }>}
   */
  async function resolve(choice, onProgress) {
    const log = (msg) => onProgress && onProgress(msg);

    if (choice === 'freedoom1' || choice === 'freedoom') {
      // Bundled into the wasm preload bundle. UZDoomLoader recognizes
      // `bundled` and skips the FS.writeFile step.
      return { name: 'freedoom1.wad (bundled)', data: null, bundled: 'freedoom1.wad' };
    }

    const src = SOURCES[choice];
    if (!src) throw new Error('unknown IWAD choice: ' + choice);

    if (memCache.has(choice)) {
      log('cached (memory)');
      return memCache.get(choice);
    }

    // Try IndexedDB first.
    try {
      const cached = await dbGet(choice);
      if (cached && cached.byteLength > 0) {
        log('cached (IndexedDB, ' + formatBytes(cached.byteLength) + ')');
        const data = cached instanceof Uint8Array ? cached : new Uint8Array(cached);
        const desc = { name: src.name, data };
        memCache.set(choice, desc);
        return desc;
      }
    } catch (e) {
      console.warn('[uzdoom-iwad] IDB read failed:', e);
    }

    // Fetch via the proxy service. doom.wad is ~12 MB, doom2.wad ~14 MB —
    // well below the proxy timeout for binary fetches.
    if (!window.proxyService) throw new Error('proxyService unavailable');
    log('fetching ' + src.name + '…');

    let buf;
    try {
      // Try direct first — console-doom.netlify.app does send permissive
      // CORS for these (the existing flavor=classic uses raw fetch).
      buf = await directFetchBinary(src.url);
    } catch (_e) {
      buf = await window.proxyService.fetchBinaryWithProxy(src.url, {
        skipDirect: true,
        headers: { Accept: 'application/octet-stream,*/*' },
        timeout: 60000,
        maxRetries: 2
      });
    }

    if (!buf || buf.length === 0) {
      throw new Error('Empty response fetching ' + src.name);
    }

    // Persist for next time. Failure is non-fatal — we still have the bytes.
    try {
      await dbPut(choice, buf);
      log('cached (' + formatBytes(buf.length) + ')');
    } catch (e) {
      console.warn('[uzdoom-iwad] IDB write failed:', e);
    }

    const desc = { name: src.name, data: buf };
    memCache.set(choice, desc);
    return desc;
  }

  async function directFetchBinary(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(url, { mode: 'cors', signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ab = await res.arrayBuffer();
      return new Uint8Array(ab);
    } finally {
      clearTimeout(t);
    }
  }

  function formatBytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  /**
   * Forget a cached IWAD (for "Reset saved data" parity).
   */
  async function forget(choice) {
    memCache.delete(choice);
    if (choice == null) {
      for (const k of Object.keys(SOURCES)) {
        try {
          await dbDelete(k);
        } catch (_) {}
      }
      return;
    }
    try {
      await dbDelete(choice);
    } catch (_) {}
  }

  /**
   * Inspect what's cached without touching network.
   */
  async function status() {
    const out = {};
    for (const k of Object.keys(SOURCES)) {
      try {
        const v = await dbGet(k);
        out[k] = {
          name: SOURCES[k].name,
          cached: !!(v && v.byteLength > 0),
          bytes: v ? v.byteLength : 0
        };
      } catch (_) {
        out[k] = { name: SOURCES[k].name, cached: false, bytes: 0 };
      }
    }
    return out;
  }

  window.UZDoomModdbIwad = {
    resolve,
    forget,
    status,
    SOURCES
  };
})();
