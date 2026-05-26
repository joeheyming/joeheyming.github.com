/**
 * Persistent prefs for /watch/.
 *
 * Two stores:
 *   - `heyming.watch.prefs`            — global toggles (e.g. autoplay).
 *   - `heyming.watch.last.<showId>`    — per-show "where I left off".
 *
 * All accessors swallow JSON / quota errors. The user can play the
 * site happily even in private-mode storage; prefs just won't persist.
 */

const PREFS_KEY = 'heyming.watch.prefs';
const LAST_KEY_PREFIX = 'heyming.watch.last.';

/**
 * @typedef {Object} Prefs
 * @property {boolean} autoplayNext
 */

/** @type {Prefs} */
const defaultPrefs = { autoplayNext: true };

/** @returns {Prefs} */
export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      autoplayNext:
        typeof raw.autoplayNext === 'boolean' ? raw.autoplayNext : defaultPrefs.autoplayNext
    };
  } catch {
    return { ...defaultPrefs };
  }
}

/** @param {Prefs} prefs */
export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota; skip */
  }
}

/**
 * @typedef {Object} LastWatched
 * @property {number} lastSeason
 * @property {number} lastEpisode
 */

/**
 * @param {string} showId
 * @returns {LastWatched|null}
 */
export function loadLastEpisode(showId) {
  try {
    const raw = localStorage.getItem(LAST_KEY_PREFIX + showId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const s = Number(parsed?.lastSeason);
    const e = Number(parsed?.lastEpisode);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
    return { lastSeason: s, lastEpisode: e };
  } catch {
    return null;
  }
}

/**
 * @param {string} showId
 * @param {number} season
 * @param {number} episode
 */
export function saveLastEpisode(showId, season, episode) {
  try {
    localStorage.setItem(
      LAST_KEY_PREFIX + showId,
      JSON.stringify({ lastSeason: season, lastEpisode: episode })
    );
  } catch {
    /* skip */
  }
}
