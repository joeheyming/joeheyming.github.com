import { count, note } from '/play-progress.js';

/**
 * Remember a started song and unlock Five Songs once this browser
 * has started five different ones. Calling it again with no key
 * retries the unlock after Chart Started is recorded.
 *
 * @param {string} [key]
 */
export function syncStepmaniaSongs(key) {
  if (key) note(localStorage, 'stepmania', key);
  const started = count(localStorage, 'stepmania');
  if (started >= 5) window.heymingAchievements?.unlockForCurrentApp('five-songs');
}
