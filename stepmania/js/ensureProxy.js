// proxy.js is a classic script (~70 KB) that used to run before the song
// menu. Evaluating it on the phone's first tap was input delay. Load it
// once, when a fetch needs it or when the browser is idle.

/** @type {Promise<void> | null} */
let loading = null;

/**
 * Resolve when `window.proxyService` exists. A failed load clears the
 * memo so the next fetch can try again.
 * @returns {Promise<void>}
 */
export function ensureProxy() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.proxyService) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/proxy.js';
      script.onload = () => {
        if (window.proxyService) resolve();
        else {
          loading = null;
          reject(new Error('proxyService is not available'));
        }
      };
      script.onerror = () => {
        loading = null;
        reject(new Error('proxy.js did not load'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}
