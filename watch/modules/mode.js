/**
 * Device-class + input-modality detection for /watch/.
 *
 * The same web app runs in three shells: a desktop browser, a phone, and
 * a thin Android-TV WebView wrapper. The modules in this file are the
 * single source of truth for "which class of device am I on?" and "which
 * input modality is the user currently driving with?".
 *
 * Two attributes get written to `<html>`:
 *
 *   data-mode="tv" | "web"
 *     Device class. Sticky for the session. Driven by:
 *       1. `?tv=1` query param  — manual override (desktop preview)
 *       2. `window.__WATCH_TV__ === true` — set by the native WebView
 *          shell via `WebView.addJavascriptInterface`
 *       3. UA fingerprint of TV-class user agents (Bravia, Tizen,
 *          WebOS, HbbTV)
 *
 *   data-modality="key" | "pointer"
 *     Last input modality the user drove with. Flips dynamically — a
 *     TV viewer with a Bluetooth mouse plugged in is on a TV but
 *     pointing; a desktop user pressing arrow keys is keyboarding.
 *     CSS uses this to suppress focus rings during pointer use.
 *
 * Splitting them lets CSS write things like:
 *
 *   :root[data-mode="tv"]   .tv-show-card:focus-visible { ... big ring ... }
 *   :root[data-modality="pointer"] *:focus { outline: none; }
 *
 * which capture the two real concerns (device-class layout vs.
 * focus-ring etiquette) without coupling them.
 *
 * The detection logic is exported as a pure function so the test
 * runner can exercise every code path without spinning a JSDOM.
 */

/* eslint-env browser */

const TV_UA_RE = /BRAVIA|SmartTV|SMART-TV|Tizen|Web0S|HbbTV/i;

/**
 * Keys that count as directional / activation input. Pressing any of
 * these flips the modality flag to "key". `Tab` is in here too — a
 * desktop user reaching for the tab key is also a keyboard user.
 */
const KEY_NAVIGATION = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
  'Enter',
  ' ',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Backspace' // Android TV maps hardware Back to this
]);

/**
 * @typedef {Object} ModeEnv
 * @property {string} search       location.search-shaped string
 * @property {string} userAgent    navigator.userAgent
 * @property {boolean} nativeFlag  window.__WATCH_TV__ === true
 */

/**
 * @typedef {Object} ModeResult
 * @property {boolean} isTv
 * @property {'queryParam'|'nativeBridge'|'userAgent'|null} source
 *   Which signal triggered TV mode (handy for debugging "why did it
 *   pick TV?" reports). `null` when not TV.
 */

/**
 * Pure detector — no browser globals touched. Inputs come from the
 * caller so `mode.test.mjs` can drive every branch without JSDOM.
 *
 * @param {ModeEnv} env
 * @returns {ModeResult}
 */
export function detectMode(env) {
  const params = new URLSearchParams(env.search || '');
  if (params.get('tv') === '1') return { isTv: true, source: 'queryParam' };
  if (env.nativeFlag === true) return { isTv: true, source: 'nativeBridge' };
  if (TV_UA_RE.test(env.userAgent || '')) return { isTv: true, source: 'userAgent' };
  return { isTv: false, source: null };
}

/**
 * Resolved at module-load time. Stays constant for the rest of the
 * session — even if the user later edits the URL to add `?tv=1`,
 * we'd want a full reload to flip layouts cleanly anyway.
 *
 * @type {ModeResult}
 */
export const MODE =
  typeof window === 'undefined'
    ? { isTv: false, source: null }
    : detectMode({
        search: window.location?.search || '',
        userAgent: window.navigator?.userAgent || '',
        // eslint-disable-next-line no-undef
        nativeFlag: /** @type {any} */ (window).__WATCH_TV__ === true
      });

/** Convenience alias — most callers only care about the boolean. */
export const isTvMode = MODE.isTv;

/* ------------------------------------------------------------------ */
/* Side-effect: stamp <html> attributes so CSS can react.             */
/* ------------------------------------------------------------------ */

if (typeof document !== 'undefined') {
  document.documentElement.dataset.mode = MODE.isTv ? 'tv' : 'web';

  // Default to "key" on TV (remote is the boot input), "pointer"
  // elsewhere. The listeners below correct it on first real input.
  let modality = MODE.isTv ? 'key' : 'pointer';
  document.documentElement.dataset.modality = modality;

  /** @param {'key'|'pointer'} next */
  const setModality = (next) => {
    if (modality === next) return;
    modality = next;
    document.documentElement.dataset.modality = next;
  };

  window.addEventListener('keydown', (e) => {
    if (KEY_NAVIGATION.has(e.key)) setModality('key');
  });
  // Mouse + touch both flip to pointer modality.
  window.addEventListener('mousemove', () => setModality('pointer'), { passive: true });
  window.addEventListener('mousedown', () => setModality('pointer'), { passive: true });
  window.addEventListener('touchstart', () => setModality('pointer'), { passive: true });
}
