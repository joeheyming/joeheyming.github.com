// Bounded cache for isomorphic-git — prevents OOM by evicting old entries when
// total estimated byte size exceeds a configurable limit.
//
// isomorphic-git stores pack/index data on the cache object using Symbol
// properties. When a cache miss occurs it transparently re-reads from the fs
// layer (IndexedDB), so eviction is safe — just slower.

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Recursively estimate the retained byte size of a value.
 * Counts Uint8Array/ArrayBuffer payloads, string chars, and recurses into
 * plain objects, Maps, and Arrays.  Stops at depth 6 to avoid cycles.
 */
function estimateBytes(val, depth) {
  if (val == null || depth > 6) return 0;
  if (val instanceof Uint8Array) return val.byteLength;
  if (val instanceof ArrayBuffer) return val.byteLength;
  if (typeof val === 'string') return val.length * 2;
  if (typeof val === 'number' || typeof val === 'boolean') return 8;
  if (typeof val === 'function') return 64;
  if (val instanceof Map) {
    let s = 0;
    for (const [k, v] of val) {
      s += estimateBytes(k, depth + 1) + estimateBytes(v, depth + 1);
    }
    return s;
  }
  if (val instanceof Set) {
    let s = 0;
    for (const v of val) {
      s += estimateBytes(v, depth + 1);
    }
    return s;
  }
  if (Array.isArray(val)) {
    let s = 0;
    for (let i = 0; i < val.length; i++) {
      s += estimateBytes(val[i], depth + 1);
    }
    return s;
  }
  if (typeof val === 'object') {
    let s = 0;
    const keys = Object.keys(val);
    for (let i = 0; i < keys.length; i++) {
      s += estimateBytes(val[keys[i]], depth + 1);
    }
    const syms = Object.getOwnPropertySymbols(val);
    for (let i = 0; i < syms.length; i++) {
      s += estimateBytes(val[syms[i]], depth + 1);
    }
    return s;
  }
  return 0;
}

/**
 * Create a cache object compatible with isomorphic-git that evicts the
 * oldest Symbol-keyed entries when total estimated size exceeds maxBytes.
 *
 * @param {number} [maxBytes] - budget in bytes (default 50 MB)
 * @returns {object} - pass this as the `cache` parameter to isomorphic-git
 */
export function createBoundedGitCache(maxBytes) {
  const limit =
    maxBytes != null && Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;

  const target = {};
  let totalSize = 0;
  const tracked = new Map(); // key (string|symbol) -> estimated bytes

  function evictUntilUnder(budget) {
    if (totalSize <= budget) return;
    for (const [key, size] of tracked) {
      if (totalSize <= budget) break;
      try {
        delete target[key];
      } catch (_) {
        /* noop */
      }
      totalSize -= size;
      tracked.delete(key);
    }
  }

  return new Proxy(target, {
    set(obj, prop, value) {
      const newSize = estimateBytes(value, 0);
      const oldSize = tracked.get(prop) || 0;
      totalSize = totalSize - oldSize + newSize;
      tracked.set(prop, newSize);
      obj[prop] = value;
      evictUntilUnder(limit);
      return true;
    },

    deleteProperty(obj, prop) {
      const size = tracked.get(prop) || 0;
      totalSize -= size;
      tracked.delete(prop);
      delete obj[prop];
      return true;
    },

    get(obj, prop) {
      if (prop === '__boundedCacheSize') return totalSize;
      if (prop === '__boundedCacheLimit') return limit;
      return obj[prop];
    }
  });
}

/**
 * Thoroughly clear a git cache object — handles both Map instances (used by
 * the existing code) and plain objects with Symbol properties (isomorphic-git
 * cache format).
 */
export function clearGitCache(cache) {
  if (cache == null) return;
  if (typeof cache.clear === 'function') {
    cache.clear();
  }
  for (const sym of Object.getOwnPropertySymbols(cache)) {
    try {
      delete cache[sym];
    } catch (_) {
      /* noop */
    }
  }
  for (const key of Object.keys(cache)) {
    if (key.startsWith('__boundedCache')) continue;
    try {
      delete cache[key];
    } catch (_) {
      /* noop */
    }
  }
}
