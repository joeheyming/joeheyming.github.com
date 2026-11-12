// Just-in-time loading without a bundler. Every file is already its own
// chunk; this module decides when one arrives. Classic scripts are
// injected once each, in order when asked. Modules go through once(() =>
// import(...)). A failed load is forgotten so the next call retries.
//
// Classic scripts can use this too: import('/shared/lazy.js') works from
// a non-module script.

/** @type {Map<string, Promise<void>>} */
const scripts = new Map();

/**
 * @param {string} src
 * @returns {string}
 */
function absolute(src) {
  return new URL(src, document.baseURI).href;
}

/**
 * True when the parser already ran this script from the page's own tags.
 * Parser-inserted classic scripts have executed by the time any gesture
 * reaches a loader, so injecting a second copy would run it twice.
 * @param {string} href
 * @returns {boolean}
 */
function inPage(href) {
  for (const el of document.querySelectorAll('script[src]')) {
    if (el.dataset.lazy !== undefined) continue;
    if (/** @type {HTMLScriptElement} */ (el).src === href) return true;
  }
  return false;
}

/**
 * Inject a classic (or module) script once. Later calls share the promise.
 * @param {string} src resolved against the page, like a <script src>
 * @param {{ type?: string }} [opts]
 * @returns {Promise<void>}
 */
export function loadScript(src, opts = {}) {
  const href = absolute(src);
  const known = scripts.get(href);
  if (known) return known;
  if (inPage(href)) {
    const done = Promise.resolve();
    scripts.set(href, done);
    return done;
  }
  const loading = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = href;
    el.async = false;
    el.dataset.lazy = '';
    if (opts.type) el.type = opts.type;
    el.onload = () => resolve();
    el.onerror = () => {
      scripts.delete(href);
      el.remove();
      reject(new Error(src + ' failed to load'));
    };
    document.head.appendChild(el);
  });
  scripts.set(href, loading);
  return loading;
}

/**
 * Load classic scripts one after another, each after the last has run.
 * @param {string[]} srcs
 * @returns {Promise<void>}
 */
export async function loadScriptsInOrder(srcs) {
  for (const src of srcs) await loadScript(src);
}

/**
 * Memoize an async loader. Concurrent and later calls share one promise;
 * a rejection clears it so the next call starts over.
 * @template T
 * @param {() => Promise<T>} load
 * @returns {() => Promise<T>}
 */
export function once(load) {
  /** @type {Promise<T> | null} */
  let pending = null;
  return function ensure() {
    if (!pending) {
      pending = load().catch((err) => {
        pending = null;
        throw err;
      });
    }
    return pending;
  };
}

/** @type {Set<string>} */
const hinted = new Set();

/**
 * Ask the browser to fetch files without running them. Module URLs get
 * modulepreload, which also parses them; everything else gets preload.
 * @param {string[]} urls
 * @param {{ module?: boolean }} [opts]
 */
export function preload(urls, opts = {}) {
  for (const url of urls) {
    const href = absolute(url);
    if (hinted.has(href) || scripts.has(href)) continue;
    hinted.add(href);
    const link = document.createElement('link');
    if (opts.module) {
      link.rel = 'modulepreload';
    } else {
      link.rel = 'preload';
      link.as = 'script';
    }
    link.href = href;
    document.head.appendChild(link);
  }
}

/**
 * Preload once the visitor points at or presses a key inside `target`.
 * Focus is not intent: pages move focus themselves (initial focus, TV
 * roving), and a script's focus() looks the same as the visitor's.
 * Returns a function that removes the listeners.
 * @param {EventTarget} target
 * @param {string[]} urls
 * @param {{ module?: boolean }} [opts]
 * @returns {() => void}
 */
export function preloadOnIntent(target, urls, opts = {}) {
  const fire = () => {
    stop();
    preload(urls, opts);
  };
  const stop = () => {
    target.removeEventListener('pointerover', fire);
    target.removeEventListener('keydown', fire);
  };
  target.addEventListener('pointerover', fire, { passive: true });
  target.addEventListener('keydown', fire);
  return stop;
}
