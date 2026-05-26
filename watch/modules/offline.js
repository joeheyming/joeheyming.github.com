/**
 * Offline-cache layer for /watch/.
 *
 * Each "saved" episode is fetched in full from archive.org with
 * progress tracking, stored as a `Blob` inside an IndexedDB object
 * store, and replayed via `URL.createObjectURL`. Modern browsers keep
 * IDB Blobs on disk (Chrome / Safari / Firefox), so storing a 300 MB
 * MP4 doesn't pull the file into memory; we just pay a one-time
 * download.
 *
 * Why IDB rather than the Cache API + a service worker:
 *   - The site is a static GitHub Pages deploy; bringing in a service
 *     worker would need careful scope + update plumbing on top of the
 *     plain HTML the rest of the site assumes.
 *   - Range requests against cached opaque responses are flaky in
 *     practice — video seek silently breaks in some browsers.
 *   - A Blob URL handed to `<video>` Just Works for seek + play.
 *
 * archive.org's file URLs (`/download/<item>/<file>`) 302-redirect to
 * a regional CDN (`dn710203.ca.archive.org`, `ia801604.us`, etc.) that
 * doesn't set `Access-Control-Allow-Origin`, so a plain `fetch()` from
 * the browser fails the CORS preflight after the redirect. The
 * download path therefore goes through `window.proxyService.fetchBinaryStream`
 * (from `/proxy.js`), which streams the response chunk-by-chunk via
 * `getReader()` so we still get accurate per-chunk progress, but
 * through a CORS-friendly relay.
 *
 * Storage durability: `navigator.storage.persist()` asks the browser
 * to exempt our origin from automatic eviction. Some browsers prompt
 * the user; most auto-grant once the site has any engagement signal.
 * It's best-effort — saved episodes can still be evicted under
 * extreme disk pressure on an unprompted device, which the UI calls
 * out in the persistent-storage warning copy.
 */

const DB_NAME = 'heyming.watch.offline';
const DB_VERSION = 1;
const STORE_NAME = 'episodes';

/**
 * @typedef {Object} SavedEpisodeMeta
 * @property {string} key            `${showId}|${season}|${episode}`
 * @property {string} showId
 * @property {string} showName
 * @property {string} showEmoji
 * @property {string} showAccent
 * @property {number} season         0 = movie / specials.
 * @property {number} episode
 * @property {string} title
 * @property {string} description
 * @property {string|null} thumbUrl   TVMaze episode still URL (used for
 *                                    the home page card); null when the
 *                                    show isn't covered by TVMaze.
 * @property {string} archiveUrl     archive.org details URL — used by the
 *                                   error banner when playback fails.
 * @property {number} sizeBytes
 * @property {number} savedAt        ms epoch.
 */

/**
 * @typedef {SavedEpisodeMeta & { blob: Blob }} SavedEpisode
 */

/**
 * @typedef {Object} SaveProgress
 * @property {number} received       Bytes received so far.
 * @property {number} total          Total bytes (0 if unknown).
 * @property {number} ratio          received / total, or 0 when total unknown.
 */

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

/** Lazy IDB open. Re-uses the promise so concurrent callers share one connection. */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // `key` is the primary key — string of `showId|season|episode`.
        // The `savedAt` index lets `listSaved` sort by recency at the
        // DB layer; `showId` is handy for future per-show queries.
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('savedAt', 'savedAt');
        store.createIndex('showId', 'showId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  }).catch((err) => {
    // Failed opens shouldn't poison the next call — drop the cached
    // promise so a retry can succeed if the underlying issue clears.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

/** @param {IDBTransactionMode} mode */
async function txStore(mode) {
  const db = await openDb();
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

/** @param {string} showId @param {number} season @param {number} episode */
export function makeKey(showId, season, episode) {
  return `${showId}|${season}|${episode}`;
}

/**
 * Promise wrapper for an IDBRequest. Almost every IDB call needs this
 * boilerplate; the cleaner abstractions (`idb`, `dexie`) would add a
 * runtime dependency we deliberately avoid on the static site.
 *
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function awaitRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {string} showId
 * @param {number} season
 * @param {number} episode
 * @returns {Promise<boolean>}
 */
export async function isSaved(showId, season, episode) {
  try {
    const store = await txStore('readonly');
    const count = await awaitRequest(store.count(makeKey(showId, season, episode)));
    return count > 0;
  } catch {
    return false;
  }
}

/**
 * Full record including the blob — use when you actually need the
 * bytes (e.g. constructing a Blob URL for playback).
 *
 * @param {string} showId
 * @param {number} season
 * @param {number} episode
 * @returns {Promise<SavedEpisode | null>}
 */
export async function getSaved(showId, season, episode) {
  try {
    const store = await txStore('readonly');
    const rec = await awaitRequest(store.get(makeKey(showId, season, episode)));
    return rec || null;
  } catch {
    return null;
  }
}

/**
 * Listing for the home page. Blob is stripped to keep memory tiny —
 * a row with a 300 MB blob would otherwise sit in JS heap until GC.
 *
 * @returns {Promise<SavedEpisodeMeta[]>}
 */
export async function listSaved() {
  try {
    const store = await txStore('readonly');
    const rows = /** @type {SavedEpisode[]} */ (await awaitRequest(store.getAll()));
    rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    return rows.map(({ blob: _blob, ...rest }) => rest);
  } catch {
    return [];
  }
}

/**
 * @param {string} showId
 * @param {number} season
 * @param {number} episode
 */
export async function deleteSavedEpisode(showId, season, episode) {
  try {
    const store = await txStore('readwrite');
    await awaitRequest(store.delete(makeKey(showId, season, episode)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Bytes used by this origin (across all storage backends) and the
 * total quota the browser will hand out. Both are advisory — quota in
 * particular can grow under storage pressure, and `usage` includes
 * non-IDB things (Cache API, localStorage, …).
 *
 * @returns {Promise<{ usage: number, quota: number }>}
 */
export async function getStorageEstimate() {
  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const e = await navigator.storage.estimate();
      return { usage: Number(e.usage) || 0, quota: Number(e.quota) || 0 };
    }
  } catch {
    /* ignore */
  }
  return { usage: 0, quota: 0 };
}

/**
 * Ask the browser to mark this origin's storage as "persistent" so
 * saved episodes survive eviction. Some browsers prompt; others
 * auto-grant. Best-effort.
 *
 * @returns {Promise<boolean>}
 */
export async function ensurePersistent() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Stream-download an episode and persist its blob.
 *
 * Delegates the actual byte-pump to `window.proxyService.fetchBinaryStream`
 * so we get the proxy fallback chain plus per-chunk progress. The proxy
 * is required (not optional) because archive.org's CDN redirect lands on
 * an origin without CORS headers — a direct `fetch()` from the browser
 * always fails. Cancelling the AbortSignal aborts the in-flight transfer
 * AND skips the IDB write, so a half-downloaded file never ends up in
 * storage.
 *
 * @param {import('./shows.js').ShowConfig} show
 * @param {import('./catalog.js').Episode} ep
 * @param {{ onProgress?: (p: SaveProgress) => void, signal?: AbortSignal }} [opts]
 * @returns {Promise<SavedEpisodeMeta>}
 */
export async function saveEpisode(show, ep, opts = {}) {
  const { onProgress, signal } = opts;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const proxy = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis)
    .proxyService;
  if (!proxy || typeof proxy.fetchBinaryStream !== 'function') {
    throw new Error('proxy.js is not loaded — cannot download episode');
  }

  const blob = await proxy.fetchBinaryStream(ep.url, {
    signal,
    onProgress,
    contentType: 'video/mp4'
  });

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const record = /** @type {SavedEpisode} */ ({
    key: makeKey(show.id, ep.season, ep.episode),
    showId: show.id,
    showName: show.name,
    showEmoji: show.emoji,
    showAccent: show.accent,
    season: ep.season,
    episode: ep.episode,
    title: ep.title || '',
    description: ep.description || '',
    thumbUrl: ep.image || null,
    archiveUrl: ep.archiveUrl,
    sizeBytes: blob.size,
    savedAt: Date.now(),
    blob
  });

  const store = await txStore('readwrite');
  await awaitRequest(store.put(record));

  // Return the meta (without the blob) — callers only ever need the
  // metadata after a save; the blob is fetched on-demand by `getSaved`.
  const { blob: _, ...meta } = record;
  return meta;
}

/**
 * Human-readable byte size, using SI units (decimal) because that's
 * how content lengths are reported by archive.org and what most users
 * read as "the size of the file". Returns "—" for invalid input.
 *
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  const v = bytes / 1000 ** i;
  // Show one decimal for sub-10 GB/TB values so "2.3 GB" doesn't
  // round to a clumsy "2 GB"; bigger units stay whole-number. Drop a
  // trailing ".0" so round values render as "1 MB" instead of "1.0 MB".
  const decimals = i >= 2 && v < 10 ? 1 : 0;
  const str = v.toFixed(decimals);
  const trimmed = decimals > 0 && str.endsWith('.0') ? str.slice(0, -2) : str;
  return `${trimmed} ${units[i]}`;
}

export const __testing = { makeKey, DB_NAME, STORE_NAME };
