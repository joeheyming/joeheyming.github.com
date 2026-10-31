/**
 * Pure helpers for the countdown YouTube embed.
 * Kept out of the web component so tests can run them without a DOM.
 */

const LEANBACK_UA =
  /BRAVIA|SonyDTV|Android TV|GoogleTV|SMART-TV|SmartTV|Smart-TV|Tizen|Web0S|WebOS|HbbTV|CrKey|AFT[A-Z]|Fire TV|Apple ?TV/i;

/**
 * TVs and other leanback browsers. Their remotes often cannot enter a
 * cross-origin iframe, and their WebViews frequently drop the Referer
 * YouTube now requires.
 * @param {string} userAgent
 * @returns {boolean}
 */
export function isLeanbackBrowser(userAgent) {
  return LEANBACK_UA.test(userAgent || '');
}

/**
 * @param {string} videoId
 * @returns {string}
 */
export function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * `origin` is YouTube's documented stand-in for the HTTP Referer on
 * WebViews that cannot send one (embed error 153). `enablejsapi` lets
 * the page hear playback errors.
 * @param {string} videoId
 * @param {{ autoplay?: boolean, start?: number, origin?: string }} [options]
 * @returns {string}
 */
export function buildYouTubeEmbedUrl(videoId, options = {}) {
  const params = new URLSearchParams({
    rel: '0',
    autoplay: options.autoplay ? '1' : '0',
    playsinline: '1',
    enablejsapi: '1'
  });
  if (options.origin) params.set('origin', options.origin);
  if (options.start && options.start > 0) params.set('start', String(options.start));
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}
