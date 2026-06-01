// MidiManager — singleton coordinator for loading, parsing, and caching
// MIDI charts. Modeled on stepmania/js/songManager.js.
//
// Every source (drag-drop, file picker, curated quick-pick, Internet
// Archive) funnels through here so:
//   1. The loading-overlay UI sees a single, predictable event stream.
//   2. Identical files (same key) are parsed only once.
//   3. Concurrent loads are guarded — clicking two songs in a row doesn't
//      race to set the current chart.
//
// Event names match stepmania for muscle memory:
//   loadStart      ({ key, label })       — a load began
//   loadProgress   ({ key, fraction })    — 0..1 download progress
//   loadComplete   ({ key, chart })       — parsed and ready
//   loadError      ({ key, error })       — load or parse failed
//   songChanged    ({ key, chart })       — current song swapped (post-load)

import { parseMidi } from './midi-parser.js';

// Hosts that don't send Access-Control-Allow-Origin. Hitting them with a
// direct fetch produces a noisy red CORS error in DevTools before we fall
// back to the proxy chain — bypass `fetch()` entirely for these and go
// straight to `proxyService.fetchBinaryWithProxy({ skipDirect: true })`.
const KNOWN_NO_CORS_HOSTS = ['archive.org'];

const MIDI_MAGIC_SMF = [0x4d, 0x54, 0x68, 0x64]; // "MThd"
const MIDI_MAGIC_RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF" (RMID variant)

function bytesStartWith(buf, magic) {
  if (!buf || buf.byteLength < magic.length) return false;
  const view = new Uint8Array(buf, 0, magic.length);
  for (let i = 0; i < magic.length; i++) {
    if (view[i] !== magic[i]) return false;
  }
  return true;
}

function looksLikeMidi(buf) {
  return bytesStartWith(buf, MIDI_MAGIC_SMF) || bytesStartWith(buf, MIDI_MAGIC_RIFF);
}

function hostMatches(url, hosts) {
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.href : undefined);
    return hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch (_) {
    return false;
  }
}

class MidiManager {
  constructor() {
    /** @type {Map<string, import('./midi-parser.js').ParsedMidi>} */
    this._cache = new Map();

    /** @type {{ key: string, chart: import('./midi-parser.js').ParsedMidi } | null} */
    this._current = null;

    /** Active load token — newer loads invalidate older ones. */
    this._activeToken = 0;

    /** @type {Record<string, Function[]>} */
    this._listeners = {
      loadStart: [],
      loadProgress: [],
      loadComplete: [],
      loadError: [],
      songChanged: []
    };
  }

  on(event, fn) {
    if (!this._listeners[event]) return () => {};
    this._listeners[event].push(fn);
    return () => {
      const arr = this._listeners[event];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  _emit(event, payload) {
    const arr = this._listeners[event];
    if (!arr) return;
    for (const fn of arr.slice()) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`MidiManager listener for ${event} threw`, err);
      }
    }
  }

  /** @returns {{ key: string, chart: import('./midi-parser.js').ParsedMidi } | null} */
  getCurrent() {
    return this._current;
  }

  /** @returns {import('./midi-parser.js').ParsedMidi | null} */
  getCurrentChart() {
    return this._current ? this._current.chart : null;
  }

  /**
   * Ingest a MIDI file from an ArrayBuffer. Single entry point — drop,
   * picker, IA browser, and curated picks all funnel here.
   *
   * @param {ArrayBuffer} buf
   * @param {string} key   Stable cache key (file hash, IA download URL, etc.)
   * @param {string} label Human-readable name shown in the loading overlay
   *                       and the now-playing strip.
   * @returns {Promise<import('./midi-parser.js').ParsedMidi>}
   */
  async loadFromArrayBuffer(buf, key, label) {
    const token = ++this._activeToken;
    this._emit('loadStart', { key, label });

    try {
      let chart = this._cache.get(key);
      if (!chart) {
        // The parser is synchronous (@tonejs/midi parses in a single
        // pass), but we still yield to the event loop so the loading
        // overlay's "loading" state has a chance to render before a
        // big file blocks the main thread for a few hundred ms.
        await new Promise((r) => setTimeout(r, 0));
        if (token !== this._activeToken) {
          throw new Error('Load cancelled by newer request');
        }
        chart = parseMidi(buf, { fallbackTitle: label });
        this._cache.set(key, chart);
      }

      if (token !== this._activeToken) {
        throw new Error('Load cancelled by newer request');
      }

      this._current = { key, chart };
      this._emit('loadComplete', { key, chart });
      this._emit('songChanged', { key, chart });
      return chart;
    } catch (err) {
      if (token === this._activeToken) {
        this._emit('loadError', { key, error: err });
      }
      throw err;
    }
  }

  /**
   * Ingest a MIDI file directly from a `File` (drag-drop / picker).
   * @param {File} file
   * @returns {Promise<import('./midi-parser.js').ParsedMidi>}
   */
  async loadFromFile(file) {
    const key = `file:${file.name}:${file.size}:${file.lastModified || 0}`;
    const buf = await file.arrayBuffer();
    return this.loadFromArrayBuffer(buf, key, file.name);
  }

  /**
   * Ingest a MIDI file from a URL. Used by the IA browser and curated
   * quick-picks. Will try a direct fetch first, then fall back to the
   * site-wide proxy chain (mirrors emulator/internet-archive.js).
   *
   * @param {string} url
   * @param {string} label
   * @returns {Promise<import('./midi-parser.js').ParsedMidi>}
   */
  async loadFromUrl(url, label) {
    const token = ++this._activeToken;
    const key = `url:${url}`;
    this._emit('loadStart', { key, label });
    this._emit('loadProgress', { key, fraction: 0.05 });

    try {
      const cached = this._cache.get(key);
      if (cached) {
        if (token !== this._activeToken) throw new Error('Load cancelled by newer request');
        this._current = { key, chart: cached };
        this._emit('loadComplete', { key, chart: cached });
        this._emit('songChanged', { key, chart: cached });
        return cached;
      }

      const buf = await this._fetchBinary(url, (fraction) => {
        if (token === this._activeToken) {
          this._emit('loadProgress', { key, fraction });
        }
      });
      if (token !== this._activeToken) throw new Error('Load cancelled by newer request');

      this._emit('loadProgress', { key, fraction: 0.95 });

      // Reuse loadFromArrayBuffer's cache + parse path. We already used
      // up `_activeToken` for the URL fetch; the inner call re-bumps it,
      // which is fine — the inner emits are still attributed to the
      // same key, and the outer try/catch handles cancellation.
      const chart = await this.loadFromArrayBuffer(buf, key, label);
      return chart;
    } catch (err) {
      if (token === this._activeToken) {
        this._emit('loadError', { key, error: err });
      }
      throw err;
    }
  }

  /**
   * Fetch a binary URL with progress reporting. Tries direct fetch first
   * (most archive.org URLs are CORS-friendly); on failure falls back to
   * window.proxyService.fetchBinaryWithProxy if available.
   *
   * @param {string} url
   * @param {(fraction: number) => void} onProgress
   * @returns {Promise<ArrayBuffer>}
   * @private
   */
  async _fetchBinary(url, onProgress) {
    const skipDirect = hostMatches(url, KNOWN_NO_CORS_HOSTS);

    if (!skipDirect) {
      try {
        const buf = await this._directFetch(url, onProgress);
        if (!looksLikeMidi(buf)) {
          throw new Error('Direct response was not a MIDI file');
        }
        return buf;
      } catch (directErr) {
        // Fall through to proxy. Suppressing here keeps the console
        // clean for the more interesting proxy-chain logging.
      }
    }

    if (typeof window === 'undefined' || !window.proxyService) {
      throw new Error('Cross-origin MIDI requires window.proxyService (proxy.js not loaded?)');
    }

    const result = await window.proxyService.fetchBinaryWithProxy(url, {
      headers: { Accept: 'audio/midi,*/*' },
      timeout: 30000,
      maxRetries: 2,
      skipDirect: true
    });

    let buf;
    if (result instanceof ArrayBuffer) {
      buf = result;
    } else if (result && result.data instanceof ArrayBuffer) {
      buf = result.data;
    } else if (result && ArrayBuffer.isView(result)) {
      // Uint8Array (typical) — slice() returns a fresh ArrayBuffer
      // covering exactly the view's bytes, so we don't accidentally
      // hand the parser an oversized backing buffer.
      buf = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
    } else {
      throw new Error('Proxy returned no usable binary data');
    }

    if (!looksLikeMidi(buf)) {
      // A proxy can return HTTP 200 but with HTML (rate-limit page,
      // 404 from the upstream, etc.). Catch this here so the @tonejs/midi
      // parser doesn't blow up with an inscrutable byte-level error.
      throw new Error(
        'Proxy returned data that is not a MIDI file. The upstream URL may be wrong, missing, or rate-limited.'
      );
    }
    return buf;
  }

  async _directFetch(url, onProgress) {
    const resp = await fetch(url, { headers: { Accept: 'audio/midi,*/*' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const totalHeader = resp.headers.get('Content-Length');
    const total = totalHeader ? parseInt(totalHeader, 10) : 0;
    if (resp.body && total > 0) {
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress(Math.min(0.9, received / total));
      }
      const merged = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      return merged.buffer;
    }
    return await resp.arrayBuffer();
  }

  clearCache() {
    this._cache.clear();
  }
}

// Singleton — one MidiManager per page-load.
const midiManager = new MidiManager();
export default midiManager;
