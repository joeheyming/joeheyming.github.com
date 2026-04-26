// User-facing copy for when AVI/FFmpeg is gated by cross-origin isolation (not a bad video file)

const PUBLISH_URL = 'https://joeheyming.github.io/stepmania/';

/**
 * @returns {boolean} True for origins where COOP+COEP usually cannot be set (unlike the public GitHub Pages build).
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
      return `🎬 No AVI background here: this origin is not cross-origin isolated (typical for localhost). Same song works with video on the public site: ${PUBLISH_URL}`;
    }
    if (typeof globalThis !== 'undefined' && globalThis.crossOriginIsolated === false) {
      return `🎬 Need a cross-origin isolated page to convert this AVI. Try a hard refresh, or open ${PUBLISH_URL}`;
    }
    return '🎬 This browser context cannot run FFmpeg for AVI. Try a recent Chrome/Edge, or the public site.';
  }
  if (use === 'ingameStatus') {
    if (local) {
      return `🎬 AVI background: use ${PUBLISH_URL} (localhost is not isolated)`;
    }
    return '🎬 AVI background not available in this context';
  }
  return '';
}
