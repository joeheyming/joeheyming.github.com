// Per-song high-score persistence (localStorage).
//
// Storage layout (per scope, e.g. 'stepmania'):
//   sm:pb:v2:<scope>:<songKey>:<difficultyKey>       → best ever for this chart
//   sm:lastplay:v2:<scope>:<songKey>:<difficultyKey> → most recent finish
//
// A "difficultyKey" is `<index>:<name>` so that re-numbered charts (Zenius
// occasionally reorders difficulties between simfile revisions) don't
// silently collide. `recordPlay()` writes lastPlay unconditionally; the PB
// entry is only overwritten when the new percent is strictly greater.
//
// Version history:
//   v1 — initial schema, used DP weights 2/1/0.5/0/0 (max = totalNotes*2).
//   v2 — switched to SM-canonical 3/2/1/0/0 weights (max = totalNotes*3).
//        Old v1 percentages are not comparable to v2, so the prefix bump
//        cleanly orphans v1 entries instead of mixing two scoring epochs.

const PB_PREFIX = 'sm:pb:v2';
const LAST_PREFIX = 'sm:lastplay:v2';

/**
 * @typedef {Object} ScoreEntry
 * @property {number} percent - Dance-points percentage (0..100)
 * @property {string} grade   - Grade letter (AAAA, AA, A, B, C, D, F)
 * @property {number} score   - Arcade-style total score
 * @property {number} maxCombo
 * @property {number[]} judgments - [perfect, great, good, bad, miss, mine]
 * @property {number} totalNotes
 * @property {string} dateISO
 */

/**
 * @typedef {Object} RecordResult
 * @property {boolean} isNewPB
 * @property {ScoreEntry|null} previousPB
 * @property {ScoreEntry} current
 */

function defaultStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

/**
 * @param {string} scope
 * @param {string} songKey
 * @param {number} difficultyIndex
 * @param {string} [difficultyName='']
 * @returns {string}
 */
function difficultyKey(difficultyIndex, difficultyName = '') {
  // Name is allowed to be empty; we still include the index so two charts
  // with the same name (rare but possible) remain distinct.
  const safeName = String(difficultyName).replace(/:/g, '_');
  return `${difficultyIndex}:${safeName}`;
}

function pbKey(scope, songKey, diffKey) {
  return `${PB_PREFIX}:${scope}:${songKey}:${diffKey}`;
}

function lastKey(scope, songKey, diffKey) {
  return `${LAST_PREFIX}:${scope}:${songKey}:${diffKey}`;
}

function readEntry(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.percent !== 'number') return null;
    return /** @type {ScoreEntry} */ (parsed);
  } catch {
    return null;
  }
}

function writeEntry(storage, key, entry) {
  try {
    storage.setItem(key, JSON.stringify(entry));
    return true;
  } catch (e) {
    console.warn('scoreboard: write failed', e);
    return false;
  }
}

/**
 * Create a scoreboard bound to a given storage adapter. Useful for tests.
 * The default export (`scoreboard`) uses real `localStorage`.
 *
 * @param {Storage|null} [storage]
 */
export function createScoreboard(storage = defaultStorage()) {
  if (!storage) {
    // No-op fallback so callers don't need to null-check. All reads return
    // null; writes succeed-but-do-nothing. Keeps the call sites clean in
    // server-side test contexts where localStorage isn't polyfilled.
    return {
      getPB: () => null,
      getLastPlay: () => null,
      recordPlay: (_scope, _songKey, _diffIdx, _diffName, payload) => ({
        isNewPB: false,
        previousPB: null,
        current: payload
      }),
      listPBs: () => [],
      clear: () => {}
    };
  }

  return {
    /**
     * @param {string} scope
     * @param {string} songKey
     * @param {number} difficultyIndex
     * @param {string} [difficultyName]
     * @returns {ScoreEntry|null}
     */
    getPB(scope, songKey, difficultyIndex, difficultyName = '') {
      if (!songKey) return null;
      return readEntry(
        storage,
        pbKey(scope, songKey, difficultyKey(difficultyIndex, difficultyName))
      );
    },

    /**
     * @param {string} scope
     * @param {string} songKey
     * @param {number} difficultyIndex
     * @param {string} [difficultyName]
     * @returns {ScoreEntry|null}
     */
    getLastPlay(scope, songKey, difficultyIndex, difficultyName = '') {
      if (!songKey) return null;
      return readEntry(
        storage,
        lastKey(scope, songKey, difficultyKey(difficultyIndex, difficultyName))
      );
    },

    /**
     * Record a completed play. Always updates "last play"; only updates PB
     * when `payload.percent` is strictly greater than the existing PB.
     *
     * @param {string} scope
     * @param {string} songKey
     * @param {number} difficultyIndex
     * @param {string} difficultyName
     * @param {Omit<ScoreEntry, 'dateISO'> & { dateISO?: string }} payload
     * @returns {RecordResult}
     */
    recordPlay(scope, songKey, difficultyIndex, difficultyName, payload) {
      const entry = {
        percent: payload.percent,
        grade: payload.grade,
        score: payload.score,
        maxCombo: payload.maxCombo,
        judgments: payload.judgments,
        totalNotes: payload.totalNotes,
        dateISO: payload.dateISO || new Date().toISOString()
      };

      // No songKey → nothing to file under. Return without touching storage
      // so callers (e.g. game-over-modal during a no-song demo) still get
      // a sensible result.
      if (!songKey) {
        return { isNewPB: false, previousPB: null, current: entry };
      }

      const diffKey = difficultyKey(difficultyIndex, difficultyName);
      writeEntry(storage, lastKey(scope, songKey, diffKey), entry);

      const previousPB = readEntry(storage, pbKey(scope, songKey, diffKey));
      const beatsPrevious = !previousPB || entry.percent > previousPB.percent;
      if (beatsPrevious) {
        writeEntry(storage, pbKey(scope, songKey, diffKey), entry);
      }

      return {
        isNewPB: beatsPrevious,
        previousPB,
        current: entry
      };
    },

    /**
     * List every stored PB for a scope. Useful for a future "my scores"
     * screen; not currently called from anywhere.
     *
     * @param {string} scope
     * @returns {Array<{ songKey: string, difficultyKey: string, entry: ScoreEntry }>}
     */
    listPBs(scope) {
      const out = [];
      const prefix = `${PB_PREFIX}:${scope}:`;
      const length = typeof storage.length === 'number' ? storage.length : 0;
      for (let i = 0; i < length; i++) {
        const key = storage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        // rest = "<songKey>:<difficultyKey>" — songKey contains ':' for
        // Zenius keys (zenius_12345), so split from the right twice
        // (difficultyKey is "<index>:<name>").
        const parts = rest.split(':');
        if (parts.length < 3) continue;
        const difficultyKeyStr = parts.slice(-2).join(':');
        const songKey = parts.slice(0, -2).join(':');
        const entry = readEntry(storage, key);
        if (entry) out.push({ songKey, difficultyKey: difficultyKeyStr, entry });
      }
      return out;
    },

    /**
     * Remove all entries for a scope. Provided for tests and future
     * "reset my data" UI; not wired up to anything today.
     *
     * @param {string} scope
     */
    clear(scope) {
      const prefixes = [`${PB_PREFIX}:${scope}:`, `${LAST_PREFIX}:${scope}:`];
      const length = typeof storage.length === 'number' ? storage.length : 0;
      const toDelete = [];
      for (let i = 0; i < length; i++) {
        const key = storage.key(i);
        if (!key) continue;
        if (prefixes.some((p) => key.startsWith(p))) toDelete.push(key);
      }
      for (const key of toDelete) {
        try {
          storage.removeItem(key);
        } catch {
          /* ignore */
        }
      }
    }
  };
}

export const scoreboard = createScoreboard();
export default scoreboard;
