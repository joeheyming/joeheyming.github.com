// Recent plays and favorite simfiles (localStorage) for the Zenius song browser
const RECENT_KEY = 'stepmania_zenius_recent_v1';
const FAV_KEY = 'stepmania_zenius_favorites_v1';
const UNPLAYABLE_KEY = 'stepmania_zenius_unplayable_v1';
const MAX_RECENT = 20;

/**
 * @typedef {{ zeniusUrl: string, title: string, simfileId: string, at: number }} ZeniusRecentEntry
 * @typedef {{ simfileId: string, zeniusUrl: string, title: string, at: number }} ZeniusFavoriteEntry
 */

/**
 * @param {string} key
 * @param {unknown} fallback
 * @returns {unknown}
 */
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('zeniusLibraryStorage: save failed', e);
  }
}

/**
 * @returns {ZeniusRecentEntry[]}
 */
export function getRecentSongs() {
  const v = loadJson(RECENT_KEY, []);
  return Array.isArray(v) ? v : [];
}

/**
 * @param {{ zeniusUrl: string, title: string, simfileId: string }} play
 */
export function recordRecentPlay(play) {
  if (!play.zeniusUrl || !play.simfileId) return;
  const title = play.title && play.title.trim() ? play.title.trim() : 'Unknown song';
  const next = getRecentSongs().filter((r) => r.zeniusUrl !== play.zeniusUrl);
  next.unshift({
    zeniusUrl: play.zeniusUrl,
    title,
    simfileId: play.simfileId,
    at: Date.now()
  });
  const trimmed = next.slice(0, MAX_RECENT);
  saveJson(RECENT_KEY, trimmed);
}

/**
 * @returns {ZeniusFavoriteEntry[]}
 */
export function getFavorites() {
  const v = loadJson(FAV_KEY, []);
  return Array.isArray(v) ? v : [];
}

/**
 * @param {string} simfileId
 * @returns {boolean}
 */
export function isFavoriteSimfileId(simfileId) {
  if (!simfileId) return false;
  return getFavorites().some((f) => f.simfileId === simfileId);
}

/**
 * Remember a song the loader refused for a reason that will not change on
 * retry: doubles, a missing chart, a deleted simfile.
 * @param {string} simfileId
 * @param {string} reason
 */
export function rememberUnplayable(simfileId, reason) {
  const id = String(simfileId || '').replace(/[^\d]/g, '');
  const why = String(reason || '').trim();
  if (!id || !why) return;
  const current = loadJson(UNPLAYABLE_KEY, {});
  const map = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  map[id] = why.slice(0, 160);
  saveJson(UNPLAYABLE_KEY, map);
}

/**
 * @param {string} simfileId
 * @returns {string}
 */
export function unplayableReason(simfileId) {
  const id = String(simfileId || '').replace(/[^\d]/g, '');
  if (!id) return '';
  const current = loadJson(UNPLAYABLE_KEY, {});
  if (!current || typeof current !== 'object' || Array.isArray(current)) return '';
  const reason = current[id];
  return typeof reason === 'string' ? reason : '';
}

/**
 * Listing verdict first, then a refusal we learned by opening the file.
 * @param {{ simfileId?: string, playable?: boolean, unplayableReason?: string }} item
 * @returns {string}
 */
export function blockReasonForSong(item) {
  const stored = unplayableReason(item?.simfileId || '');
  if (stored) return stored;
  if (item?.playable === false) return item.unplayableReason || 'Not a 4-arrow chart';
  return '';
}

/**
 * @param {{ simfileId: string, zeniusUrl: string, title: string }} entry
 * @returns {boolean} new favorite state (true = now favorited)
 */
export function toggleFavorite(entry) {
  if (!entry.simfileId) return false;
  const list = getFavorites();
  const i = list.findIndex((f) => f.simfileId === entry.simfileId);
  if (i >= 0) {
    list.splice(i, 1);
  } else {
    const title = entry.title && entry.title.trim() ? entry.title.trim() : 'Unknown song';
    list.unshift({
      simfileId: entry.simfileId,
      zeniusUrl: entry.zeniusUrl,
      title,
      at: Date.now()
    });
  }
  saveJson(FAV_KEY, list);
  return i < 0;
}
