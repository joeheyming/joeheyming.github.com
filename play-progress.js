/**
 * Distinct plays this browser has started, used to unlock achievements.
 * The sheet counts everyone. This counts only the ids on this device.
 */

const KEY = 'heyming.play-progress.v1';
const BUCKETS = new Set(['doom', 'stepmania', 'emulator']);
const LIMIT = 40;

/**
 * @param {unknown} id
 * @returns {string}
 */
export function playId(id) {
  const text = String(id || '')
    .trim()
    .slice(0, 120);
  return text;
}

/**
 * @param {{ getItem?: (key: string) => string | null } | null | undefined} storage
 * @returns {Record<string, string[]>}
 */
export function readProgress(storage) {
  /** @type {Record<string, string[]>} */
  const empty = { doom: [], stepmania: [], emulator: [] };
  if (!storage || typeof storage.getItem !== 'function') return empty;
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || '');
    if (!parsed || parsed.version !== 1 || typeof parsed.buckets !== 'object') return empty;
    for (const bucket of BUCKETS) {
      const list = parsed.buckets[bucket];
      empty[bucket] = Array.isArray(list) ? list.map(playId).filter(Boolean).slice(0, LIMIT) : [];
    }
    return empty;
  } catch {
    return empty;
  }
}

/**
 * @param {{ getItem?: (key: string) => string | null, setItem?: (key: string, value: string) => void } | null | undefined} storage
 * @param {string} bucket
 * @param {unknown} id
 * @returns {number}
 */
export function note(storage, bucket, id) {
  if (!BUCKETS.has(bucket)) return 0;
  const progress = readProgress(storage);
  const value = playId(id);
  if (value && !progress[bucket].includes(value)) {
    progress[bucket].unshift(value);
    progress[bucket] = progress[bucket].slice(0, LIMIT);
    writeProgress(storage, progress);
  }
  return progress[bucket].length;
}

/**
 * @param {{ getItem?: (key: string) => string | null } | null | undefined} storage
 * @param {string} bucket
 * @returns {number}
 */
export function count(storage, bucket) {
  if (!BUCKETS.has(bucket)) return 0;
  return readProgress(storage)[bucket].length;
}

/**
 * @param {{ setItem?: (key: string, value: string) => void } | null | undefined} storage
 * @param {Record<string, string[]>} progress
 */
function writeProgress(storage, progress) {
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(KEY, JSON.stringify({ version: 1, buckets: progress }));
  } catch {
    /* private mode */
  }
}
