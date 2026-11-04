// JSZip is only needed to open a song pack. The menu must not wait on it.

const JSZIP_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const JSZIP_INTEGRITY =
  'sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==';

/** @type {Promise<NonNullable<typeof globalThis.JSZip>> | null} */
let loading = null;

/**
 * Resolve the JSZip constructor, injecting its script the first time.
 * The library assigns `globalThis.JSZip` from a classic script, which a
 * module cannot see as a bare name.
 * @returns {Promise<NonNullable<typeof globalThis.JSZip>>}
 */
export function loadJSZip() {
  if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        reject(new Error('JSZip is not loaded'));
        return;
      }
      const script = document.createElement('script');
      script.src = JSZIP_SRC;
      script.integrity = JSZIP_INTEGRITY;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => {
        if (globalThis.JSZip) resolve(globalThis.JSZip);
        else reject(new Error('JSZip is not loaded'));
      };
      script.onerror = () => reject(new Error('Could not load JSZip'));
      document.head.appendChild(script);
    }).catch((error) => {
      loading = null;
      throw error;
    });
  }
  return loading;
}
