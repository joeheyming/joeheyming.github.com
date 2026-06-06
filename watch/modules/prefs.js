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
// Per-episode resume points. Keyed by `<showId>.s<n>e<n>` so each
// episode of a show keeps its own scrub position — Plex/Netflix style.
// `last.<showId>` only tracks "which episode was most recent"; the
// actual playback time comes from this namespace.
const POS_KEY_PREFIX = 'heyming.watch.pos.';

/**
 * @typedef {Object} Prefs
 * @property {boolean} autoplayNext
 * @property {boolean} shuffle
 *   Shuffle is a *mode*, not an action — when true, Next/Prev and the
 *   end-of-episode autoplay path pick a random episode from the show's
 *   numbered seasons instead of stepping sequentially. Modeled after
 *   the toggle on every consumer mp3 player; the user expects clicking
 *   "shuffle" to change behavior, not advance the track.
 * @property {string | null} subtitleLang
 *   Preferred subtitle language as an ISO 639-2/B code ("eng", "spa",
 *   …). `null` means "subtitles off". Persists across episodes so the
 *   user only has to pick a language once.
 */

/** @type {Prefs} */
const defaultPrefs = { autoplayNext: true, shuffle: false, subtitleLang: null };

/** @returns {Prefs} */
export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      autoplayNext:
        typeof raw.autoplayNext === 'boolean' ? raw.autoplayNext : defaultPrefs.autoplayNext,
      shuffle: typeof raw.shuffle === 'boolean' ? raw.shuffle : defaultPrefs.shuffle,
      subtitleLang:
        typeof raw.subtitleLang === 'string' && raw.subtitleLang
          ? raw.subtitleLang.toLowerCase()
          : defaultPrefs.subtitleLang
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
 * @property {number} [updatedAt]   ms epoch — added 2026; older entries
 *                                  written before this field omit it.
 */

/**
 * Per-show resume info. Used by the episodes view to pick the initial
 * season chip and by the home page to render the "Continue watching"
 * row.
 *
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
    const out = /** @type {LastWatched} */ ({ lastSeason: s, lastEpisode: e });
    const t = Number(parsed?.updatedAt);
    if (Number.isFinite(t)) out.updatedAt = t;
    return out;
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
      JSON.stringify({ lastSeason: season, lastEpisode: episode, updatedAt: Date.now() })
    );
  } catch {
    /* skip */
  }
}

/**
 * Drop the resume entry for a show. Used by the "✕" button on the
 * home page's Continue Watching row.
 *
 * @param {string} showId
 */
export function clearLastEpisode(showId) {
  try {
    localStorage.removeItem(LAST_KEY_PREFIX + showId);
  } catch {
    /* skip */
  }
}

/**
 * @typedef {Object} ContinueEntry
 * @property {string} showId
 * @property {number} season
 * @property {number} episode
 * @property {number|null} updatedAt   null for legacy entries written
 *                                     before timestamps were tracked.
 */

/**
 * Every saved "where I left off" entry, most-recently-watched first.
 * Legacy entries (written before `updatedAt` was tracked) sort to the
 * bottom but in stable order so they don't shuffle on every render.
 *
 * Storage iteration is wrapped in try/catch — Safari private mode and
 * some embedded WebViews throw on `localStorage.length` / `.key()`.
 *
 * @returns {ContinueEntry[]}
 */
export function listContinueWatching() {
  /** @type {ContinueEntry[]} */
  const entries = [];
  try {
    const len = localStorage.length;
    for (let i = 0; i < len; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LAST_KEY_PREFIX)) continue;
      const showId = key.slice(LAST_KEY_PREFIX.length);
      if (!showId) continue;
      let parsed;
      try {
        parsed = JSON.parse(localStorage.getItem(key) || 'null');
      } catch {
        continue;
      }
      const s = Number(parsed?.lastSeason);
      const e = Number(parsed?.lastEpisode);
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      const t = Number(parsed?.updatedAt);
      entries.push({
        showId,
        season: s,
        episode: e,
        updatedAt: Number.isFinite(t) ? t : null
      });
    }
  } catch {
    /* storage unavailable; return whatever we've collected so far */
  }
  entries.sort((a, b) => {
    // Entries with timestamps win; among them newest-first. Entries
    // without timestamps keep their original (storage-order) position.
    if (a.updatedAt != null && b.updatedAt != null) return b.updatedAt - a.updatedAt;
    if (a.updatedAt != null) return -1;
    if (b.updatedAt != null) return 1;
    return 0;
  });
  return entries;
}

/** @param {string} showId @param {number} season @param {number} episode */
function posKey(showId, season, episode) {
  return `${POS_KEY_PREFIX}${showId}.s${season}e${episode}`;
}

/**
 * @typedef {Object} ResumePosition
 * @property {number} position  Seconds into the video.
 * @property {number} duration  Total duration in seconds (best-known).
 * @property {number|null} updatedAt   ms epoch.
 */

/**
 * Read the saved resume point for one episode. Returns `null` if there
 * is no entry, the entry is malformed, or the saved position falls
 * outside the "worth resuming" band (too close to the start or to the
 * end). Callers don't need to filter again.
 *
 * @param {string} showId
 * @param {number} season
 * @param {number} episode
 * @returns {ResumePosition|null}
 */
export function loadResumePosition(showId, season, episode) {
  try {
    const raw = localStorage.getItem(posKey(showId, season, episode));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const position = Number(parsed?.position);
    const duration = Number(parsed?.duration);
    if (!Number.isFinite(position) || position <= 0) return null;
    if (!Number.isFinite(duration) || duration <= 0) return null;
    // Don't bother resuming the first 15s (probably a quick exit) or
    // the last 60s (basically watched the episode — let it start over).
    if (position < 15) return null;
    if (duration - position < 60) return null;
    return {
      position,
      duration,
      updatedAt: Number.isFinite(Number(parsed?.updatedAt)) ? Number(parsed.updatedAt) : null
    };
  } catch {
    return null;
  }
}

/**
 * Persist a scrub position. No-op for invalid inputs or for trivial
 * positions — saving "1.4s into the episode" pollutes storage and
 * triggers spurious resume prompts on the next visit.
 *
 * @param {string} showId
 * @param {number} season
 * @param {number} episode
 * @param {number} position
 * @param {number} duration
 */
export function saveResumePosition(showId, season, episode, position, duration) {
  if (!Number.isFinite(position) || position < 15) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  // If we're within a minute of the end, treat the watch as finished
  // — clear instead of saving so the next visit starts from zero.
  if (duration - position < 60) {
    clearResumePosition(showId, season, episode);
    return;
  }
  try {
    localStorage.setItem(
      posKey(showId, season, episode),
      JSON.stringify({ position, duration, updatedAt: Date.now() })
    );
  } catch {
    /* quota; skip */
  }
}

/**
 * @param {string} showId
 * @param {number} season
 * @param {number} episode
 */
export function clearResumePosition(showId, season, episode) {
  try {
    localStorage.removeItem(posKey(showId, season, episode));
  } catch {
    /* skip */
  }
}

export const __testing = { PREFS_KEY, LAST_KEY_PREFIX, POS_KEY_PREFIX };
