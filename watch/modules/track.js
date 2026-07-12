/**
 * Thin GA helpers for Watch — keeps call sites one-liners and labels consistent.
 */

/**
 * @param {string} name
 * @param {string} [label]
 * @param {number} [value]
 */
export function trackWatch(name, label, value) {
  if (typeof window.trackEvent !== 'function') return;
  window.trackEvent(name, 'Watch', label ?? name, value);
}

/**
 * @param {string} name
 * @param {number} [value]
 */
export function trackWatchConversion(name, value = 1) {
  if (typeof window.trackConversion === 'function') {
    window.trackConversion(name, value);
  }
}

/**
 * @param {'show' | 'movie'} kind
 * @param {string} id
 * @param {{ season?: number, episode?: number }} [ep]
 */
export function mediaLabel(kind, id, ep) {
  if (kind === 'movie' || ep == null || (ep.season === 0 && ep.episode === 0)) {
    return `movie:${id}`;
  }
  const s = String(ep.season ?? 0).padStart(2, '0');
  const e = String(ep.episode ?? 0).padStart(2, '0');
  return `show:${id}|S${s}E${e}`;
}
