// The songs people actually start on this site, ready to play.
// Names that are still "zenius 26360" are looked up and left out until
// the simfile page has a title. A bare id is not a song you can choose.

import {
  isZeniusPlaceholder,
  lookupZeniusTitles,
  zeniusSimfileId,
  zeniusSimfilePageUrl
} from '../../analytics/zenius-titles.mjs';

/**
 * @typedef {{ whenReady: () => Promise<void>, top: (filter: { app?: string, kind?: string, limit?: number }) => Array<{ id?: string, name?: string }> }} PopularCounts
 */

/**
 * @returns {Promise<PopularCounts | null>}
 */
async function defaultEnable() {
  const analytics = typeof window !== 'undefined' ? window.heymingAnalytics : null;
  if (!analytics || typeof analytics.enable !== 'function') return null;
  await analytics.enable('play-counts');
  const counts = window.heymingCounts;
  if (!counts || typeof counts.whenReady !== 'function' || typeof counts.top !== 'function') {
    return null;
  }
  return counts;
}

/**
 * @param {Array<{ id?: string, name?: string }>} rows
 * @param {Map<string, string>} titles
 * @returns {{ zeniusUrl: string, title: string, simfileId: string }[]}
 */
export function popularSongEntries(rows, titles) {
  /** @type {{ zeniusUrl: string, title: string, simfileId: string }[]} */
  const entries = [];
  for (const row of rows || []) {
    const simfileId = zeniusSimfileId(row.id) || zeniusSimfileId(row.name);
    if (!simfileId) continue;
    const placeholder = isZeniusPlaceholder(row.name || '', row.id || '');
    const title = placeholder ? titles.get(placeholder) || '' : String(row.name || '').trim();
    if (!title || isZeniusPlaceholder(title, row.id || '')) continue;
    entries.push({
      simfileId,
      title,
      zeniusUrl: zeniusSimfilePageUrl(simfileId)
    });
  }
  return entries;
}

/**
 * @param {number} limit
 * @param {{
 *   enable?: () => Promise<PopularCounts | null>,
 *   lookup?: (ids: string[]) => Promise<Map<string, string>>
 * }} deps
 */
async function resolvePopularSongs(limit, deps) {
  const counts = await deps.enable();
  if (!counts) return [];
  await counts.whenReady();
  const rows = counts.top({ app: 'stepmania', kind: 'song', limit }).slice(0, limit);
  /** @type {string[]} */
  const ids = [];
  for (const row of rows) {
    const placeholder = isZeniusPlaceholder(row.name || '', row.id || '');
    if (placeholder) ids.push(placeholder);
  }
  const titles = ids.length ? await deps.lookup(ids) : new Map();
  return popularSongEntries(rows, titles);
}

/** @type {Promise<{ zeniusUrl: string, title: string, simfileId: string }[]> | null} */
let pending = null;
let pendingLimit = 0;

export function clearPopularSongsCache() {
  pending = null;
  pendingLimit = 0;
}

/**
 * @param {number} [limit]
 * @param {{
 *   enable?: () => Promise<PopularCounts | null>,
 *   lookup?: (ids: string[]) => Promise<Map<string, string>>
 * }} [deps]
 * @returns {Promise<{ zeniusUrl: string, title: string, simfileId: string }[]>}
 */
export function loadPopularSongs(limit = 5, deps) {
  const options = deps || {
    enable: defaultEnable,
    lookup: (ids) => lookupZeniusTitles(ids)
  };
  if (deps) return resolvePopularSongs(limit, options);
  if (!pending || pendingLimit < limit) {
    const requestLimit = limit;
    pendingLimit = requestLimit;
    const request = resolvePopularSongs(requestLimit, options).catch(() => {
      if (pending === request) clearPopularSongsCache();
      return [];
    });
    pending = request;
  }
  return pending.then((entries) => entries.slice(0, limit));
}
