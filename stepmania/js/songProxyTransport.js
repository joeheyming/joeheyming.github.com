// Zenius / proxy fetch seam — one place for timeouts, size checks, and default window.proxyService wiring

/** Fail fast when binary audio fetch stalls */
export const AUDIO_PROXY_TIMEOUT = 10000;

export const AUDIO_PROXY_MAX_RETRIES = 1;

/** Minimum bytes to treat a binary response as real audio (error pages are tiny) */
export const MIN_VALID_AUDIO_SIZE = 1000;

export const ZIP_DOWNLOAD_TIMEOUT = 60000;

export const ZIP_MAX_RETRIES = 2;

/**
 * Container sniff so a mislabeled download is still handed to the audio
 * element as a type it can decode. Null means the bytes are not audio.
 * @param {ArrayBuffer|Uint8Array|null|undefined} data
 * @returns {'audio/ogg' | 'audio/mpeg' | 'audio/wav' | null}
 */
export function sniffAudioMime(data) {
  if (data == null) return null;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return 'audio/ogg';
  }
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'audio/mpeg';
  }
  // MPEG frame sync. Require the next bits to look like a frame so a random
  // 0xFF does not get treated as an mp3.
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return 'audio/wav';
  }
  return null;
}

/** @param {ArrayBuffer|Uint8Array|{ byteLength?: number, length?: number }} data */
export function binaryPayloadByteLength(data) {
  if (data == null) return 0;
  if (typeof data.byteLength === 'number') return data.byteLength;
  if (typeof data.length === 'number') return data.length;
  return 0;
}

/**
 * Mime type when the payload is large enough and sniffs as audio.
 * HTML error pages and empty proxy bodies return null so callers can try another file.
 * @param {ArrayBuffer|Uint8Array|null|undefined} data
 * @returns {'audio/ogg' | 'audio/mpeg' | 'audio/wav' | null}
 */
export function playableAudioMime(data) {
  if (binaryPayloadByteLength(data) <= MIN_VALID_AUDIO_SIZE) return null;
  return sniffAudioMime(data);
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
