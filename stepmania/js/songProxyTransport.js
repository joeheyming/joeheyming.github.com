// Zenius / proxy fetch seam — one place for timeouts, size checks, and default window.proxyService wiring

/** Fail fast when binary audio fetch stalls */
export const AUDIO_PROXY_TIMEOUT = 10000;

export const AUDIO_PROXY_MAX_RETRIES = 1;

/** Minimum bytes to treat a binary response as real audio (error pages are tiny) */
export const MIN_VALID_AUDIO_SIZE = 1000;

export const ZIP_DOWNLOAD_TIMEOUT = 60000;

export const ZIP_MAX_RETRIES = 2;

/** @param {ArrayBuffer|Uint8Array|{ byteLength?: number, length?: number }} data */
export function binaryPayloadByteLength(data) {
  if (data == null) return 0;
  if (typeof data.byteLength === 'number') return data.byteLength;
  if (typeof data.length === 'number') return data.length;
  return 0;
}

/**
 * @typedef {Object} SongProxyTransport
 * @property {(url: string, options?: object) => Promise<string>} fetchText
 * @property {(url: string, options?: object) => Promise<ArrayBuffer>} fetchBinary
 */

/**
 * Default transport: site `window.proxyService` (present on GitHub Pages build).
 * @returns {SongProxyTransport}
 */
export function createDefaultSongProxyTransport() {
  const ps = window.proxyService;
  if (!ps) {
    throw new Error('proxyService is not available');
  }
  return {
    fetchText(url, options) {
      return ps.fetchWithProxy(url, options);
    },
    fetchBinary(url, options) {
      return ps.fetchBinaryWithProxy(url, options);
    }
  };
}
