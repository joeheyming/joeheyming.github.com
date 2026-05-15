// User-facing copy for when AVI backgrounds can't be played in the current browser context.

const PUBLISH_URL = 'https://joeheyming.github.io/stepmania/';

/**
 * @returns {boolean} True for origins where the browser security context blocks AVI playback (typical for localhost dev servers).
 */
export function isLikelyLocalOrNonIsolatedHost() {
  if (typeof window === 'undefined' || !window.location) return false;
  const { hostname, protocol } = window.location;
  return (
    protocol === 'file:' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === ''
  );
}

/**
 * @param {'preloadOverlay' | 'ingameStatus'} use
 * @returns {string}
 */
export function videoContextStatusMessage(use) {
  const local = isLikelyLocalOrNonIsolatedHost();
  if (use === 'preloadOverlay') {
    if (local) {
      return `🎬 No AVI background here. Same song plays with video on the public site: ${PUBLISH_URL}`;
    }
    if (typeof globalThis !== 'undefined' && globalThis.crossOriginIsolated === false) {
      return `🎬 Can't play this AVI background here. Try a hard refresh, or open ${PUBLISH_URL}`;
    }
    return "🎬 This browser can't play AVI backgrounds. Try a recent Chrome/Edge, or the public site.";
  }
  if (use === 'ingameStatus') {
    if (local) {
      return `🎬 AVI background: use ${PUBLISH_URL}`;
    }
    return '🎬 AVI background not available here';
  }
  return '';
}
