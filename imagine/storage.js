/**
 * Persistence for the imagine app.
 *
 * - Install flag (mirror of chat/storage.js): cheap pre-check so the
 *   page can decide between "silent re-init from cache" and "show the
 *   install card."
 * - Recent generations: prompt + seed + a tiny JPEG thumbnail (96px,
 *   quality 0.7) stored in localStorage so the user sees a strip of
 *   past images. The full-resolution PNG goes into Cache Storage
 *   (much larger budget — typically 60% of disk) keyed by the
 *   history entry id, so clicking a past item brings back the actual
 *   image at full quality. Trimmed in lockstep with the history list.
 */

const INSTALLED_KEY = 'heyming.imagine.modelInstalled.v1.sd-turbo';
/** Prefix for model-specific install flags. Append the model id. */
const INSTALLED_KEY_PREFIX = 'heyming.imagine.modelInstalled.v1.';
/** localStorage key for the user's last-selected model id. */
const SELECTED_MODEL_KEY = 'heyming.imagine.selectedModel.v1';
const HISTORY_KEY = 'heyming.imagine.history.v1';
const MAX_HISTORY = 24;
const THUMB_SIZE = 96;
const THUMB_QUALITY = 0.7;

/**
 * Cache Storage bucket for the full-resolution PNGs. Versioned so a
 * future schema change (different image format, different keying)
 * can ship a fresh bucket without colliding.
 */
const IMAGE_CACHE_NAME = 'heyming-imagine-images-v1';
/** Synthetic URL prefix used as Cache Storage keys; never actually fetched. */
const IMAGE_KEY_PREFIX = '/imagine/_/img/';

/**
 * @typedef {Object} HistoryEntry
 * @property {string} id  Random id for keying the DOM list.
 * @property {string} prompt
 * @property {number} seed
 * @property {string} thumbDataUrl  Tiny JPEG dataURL (~3–10 KB).
 * @property {number} createdAt  Unix ms.
 */

/** @returns {HistoryEntry[]} */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) =>
        e &&
        typeof e === 'object' &&
        typeof e.prompt === 'string' &&
        typeof e.seed === 'number' &&
        typeof e.thumbDataUrl === 'string'
    );
  } catch {
    return [];
  }
}

/**
 * Append an entry to history (newest first), trimming to MAX_HISTORY.
 * Trims the matching full-resolution images out of Cache Storage too
 * so we don't accumulate orphans.
 *
 * @param {HistoryEntry} entry
 * @returns {HistoryEntry[]} the updated list (caller can re-render)
 */
export function pushHistory(entry) {
  const existing = loadHistory();
  const combined = [entry, ...existing];
  const updated = combined.slice(0, MAX_HISTORY);
  const dropped = combined.slice(MAX_HISTORY);
  for (const e of dropped) {
    void deleteFullImage(e.id);
  }
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // Quota exceeded — likely the thumbs got too big. Drop the
    // oldest few and retry once. The Cache Storage entries for the
    // dropped tail go too.
    const reduced = updated.slice(0, Math.max(4, Math.floor(MAX_HISTORY / 2)));
    const droppedFromReduced = updated.slice(reduced.length);
    for (const e of droppedFromReduced) {
      void deleteFullImage(e.id);
    }
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(reduced));
      return reduced;
    } catch {
      /* give up — history is best-effort */
    }
  }
  return updated;
}

export function clearAllHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
  void clearAllImages();
}

/**
 * Drop a single entry from history (matched by id) and its cached
 * full-resolution image. Returns the updated list so the caller can
 * re-render without an extra read.
 *
 * @param {string} id
 * @returns {HistoryEntry[]}
 */
export function removeHistoryItem(id) {
  const existing = loadHistory();
  const updated = existing.filter((e) => e.id !== id);
  if (updated.length === existing.length) return existing;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    /* best-effort */
  }
  void deleteFullImage(id);
  return updated;
}

/**
 * Build a tiny JPEG thumbnail dataURL from a Blob. Used to keep
 * history entries small enough that 24 of them fit inside
 * localStorage's quota.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function blobToThumbDataUrl(blob) {
  const bitmap = await createImageBitmapSafe(blob);
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context for thumbnail.');
  // Cover-fit: SD-Turbo output is square (512×512) so this is a 1:1 fit,
  // but the math handles non-square sources too in case the model changes.
  const sw = bitmap.width;
  const sh = bitmap.height;
  const scale = Math.max(THUMB_SIZE / sw, THUMB_SIZE / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (THUMB_SIZE - dw) / 2;
  const dy = (THUMB_SIZE - dh) / 2;
  ctx.drawImage(bitmap, dx, dy, dw, dh);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', THUMB_QUALITY);
}

/**
 * Polyfill-ish wrapper for `createImageBitmap` that falls back to a
 * `<img>` round-trip on Safari ≤ 16 (where `createImageBitmap(blob)`
 * historically returned a useless 0×0 bitmap for some encodings).
 *
 * @param {Blob} blob
 * @returns {Promise<ImageBitmap>}
 */
async function createImageBitmapSafe(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      return await createImageBitmap(/** @type {HTMLImageElement} */ (img));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Has the SD-Turbo model been successfully loaded in this browser
 * before? Same role as chat/'s install flag.
 */
/**
 * Has the given image model been successfully loaded in this browser
 * before? Same role as chat/'s install flag, but parameterized by
 * `modelId` so each model maintains its own install state — flipping
 * between SD-Turbo and Janus-Pro should never trick one model into
 * thinking the other's weights are already cached.
 *
 * Backwards-compatible default: when `modelId` is omitted (callers
 * predating multi-model support), reads the legacy SD-Turbo flag.
 *
 * @param {string} [modelId]
 */
export function hasInstalledModel(modelId) {
  try {
    const key = modelId ? `${INSTALLED_KEY_PREFIX}${modelId}` : INSTALLED_KEY;
    if (localStorage.getItem(key) === '1') return true;
    // Legacy fallback: pre-multi-model installs only set the bare
    // INSTALLED_KEY. Treat that as "sd-turbo installed" so returning
    // visitors don't see a fresh install card.
    if (modelId === 'sd-turbo' && localStorage.getItem(INSTALLED_KEY) === '1') return true;
    return false;
  } catch {
    return false;
  }
}

/** @param {string} [modelId] */
export function markModelInstalled(modelId) {
  try {
    const key = modelId ? `${INSTALLED_KEY_PREFIX}${modelId}` : INSTALLED_KEY;
    localStorage.setItem(key, '1');
  } catch {
    /* quota / private mode — silent init will re-confirm next visit */
  }
}

/** @param {string} [modelId] */
export function clearModelInstalledFlag(modelId) {
  try {
    const key = modelId ? `${INSTALLED_KEY_PREFIX}${modelId}` : INSTALLED_KEY;
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Read the user's last-selected text-to-image model id from
 * localStorage. Returns null when nothing's saved (first visit) so
 * the caller can fall back to its default — keeps storage agnostic
 * about which models exist.
 *
 * @returns {string | null}
 */
export function loadSelectedModel() {
  try {
    const raw = localStorage.getItem(SELECTED_MODEL_KEY);
    return raw && typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

/** @param {string} modelId */
export function saveSelectedModel(modelId) {
  try {
    localStorage.setItem(SELECTED_MODEL_KEY, modelId);
  } catch {
    /* ignore */
  }
}

// -------------------- Full-resolution image cache --------------------
//
// Cache Storage holds the actual PNG output of generation, keyed by
// the history entry's `id`. Click a past history item → look up the
// blob here → display it at full 512×512. Falls back gracefully when
// `caches` isn't available (unlikely on a WebGPU-capable browser
// since both gate on secure contexts) or when the entry was created
// before this caching layer existed (pre-Cache history items).

/**
 * @param {string} id  The history entry's `id` field.
 * @returns {string}  The synthetic URL used as the Cache Storage key.
 */
function imageKey(id) {
  return `${IMAGE_KEY_PREFIX}${encodeURIComponent(id)}.png`;
}

/**
 * Stash the full-resolution PNG blob keyed by the history entry's id.
 * Best-effort: on quota errors or unavailable APIs we just drop the
 * write silently — the thumbnail in localStorage is still there.
 *
 * @param {string} id
 * @param {Blob} blob
 */
export async function cacheFullImage(id, blob) {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    await cache.put(
      imageKey(id),
      new Response(blob, { headers: { 'Content-Type': blob.type || 'image/png' } })
    );
  } catch (err) {
    console.warn('[imagine:cache] could not cache full-res image', err);
  }
}

/**
 * Look up a full-resolution PNG for a history entry. Returns null
 * when the entry predates this cache, the cache was cleared, or the
 * Cache API is unavailable.
 *
 * @param {string} id
 * @returns {Promise<Blob | null>}
 */
export async function loadFullImage(id) {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const response = await cache.match(imageKey(id));
    if (!response) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

/**
 * Drop one entry's full-res image. Called when the entry falls off
 * the end of the history list.
 *
 * @param {string} id
 */
export async function deleteFullImage(id) {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    await cache.delete(imageKey(id));
  } catch {
    /* ignore */
  }
}

/**
 * Wipe the entire Cache Storage bucket. Used when the user clears
 * their history.
 */
export async function clearAllImages() {
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete(IMAGE_CACHE_NAME);
  } catch {
    /* ignore */
  }
}
