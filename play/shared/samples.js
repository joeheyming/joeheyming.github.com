/**
 * Shared sample-loading utilities for /play/* instruments.
 *
 * Pipeline:
 *   url -> ArrayBuffer (proxy.js with direct-first fallback)
 *       -> ArrayBuffer cached in IndexedDB (so a return visit skips the network)
 *       -> AudioBuffer decoded once via AudioContext.decodeAudioData
 *       -> AudioBuffer kept in memory for the rest of the session
 *
 * Triggering is just a fresh AudioBufferSourceNode -> Gain -> master so we get
 * unlimited polyphony for one-shots (drums, percussion) and pitch-shifted
 * playback for melodic samples (Salamander piano, VSCO 2 guitar) without
 * needing a heavy library.
 *
 * Everything degrades gracefully: if window.proxyService is missing, the
 * decode fails, or the buffer never resolves, callers receive a rejected
 * promise and are expected to fall back to their existing synth voice.
 */

import { getCtx, getMaster, midiToFreq } from './audio.js';

const RAW_BYTE_DB = 'play.samples.v1';
const RAW_BYTE_STORE = 'rawBytes';

let dbPromise = null;

function openRawByteDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(RAW_BYTE_DB, 1);
    } catch (_) {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      try {
        req.result.createObjectStore(RAW_BYTE_STORE);
      } catch (_) {
        /* already exists, fine */
      }
    };
    req.onsuccess = () => resolve(req.result);
    // Private mode / quota / blocked: silently fall back to memory-only.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function readRawBytes(url) {
  const db = await openRawByteDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(RAW_BYTE_STORE, 'readonly');
    } catch (_) {
      resolve(null);
      return;
    }
    const store = tx.objectStore(RAW_BYTE_STORE);
    const req = store.get(url);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function writeRawBytes(url, bytes) {
  const db = await openRawByteDb();
  if (!db) return;
  await new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(RAW_BYTE_STORE, 'readwrite');
    } catch (_) {
      resolve();
      return;
    }
    const store = tx.objectStore(RAW_BYTE_STORE);
    try {
      store.put(bytes, url);
    } catch (_) {
      /* quota exceeded — drop silently */
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

const memCache = new Map(); // url -> Promise<AudioBuffer>

async function fetchRawBytes(url, options) {
  const cached = await readRawBytes(url);
  if (cached) {
    // IndexedDB stored as ArrayBuffer; copy so decode never gets a detached buffer.
    return cached.slice(0);
  }
  if (!window.proxyService || typeof window.proxyService.fetchBinaryWithProxy !== 'function') {
    throw new Error('proxyService.fetchBinaryWithProxy unavailable');
  }
  const result = await window.proxyService.fetchBinaryWithProxy(url, {
    headers: { Accept: 'audio/ogg,audio/mpeg,audio/wav,audio/mp4,*/*' },
    timeout: options.timeout || 30000,
    maxRetries: options.maxRetries || 2
  });
  // Older callers see Uint8Array, newer see ArrayBuffer. Normalise to ArrayBuffer.
  const buf =
    result instanceof ArrayBuffer
      ? result
      : result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  // Persist for next visit. Don't await — decoding can start in parallel.
  writeRawBytes(url, buf.slice(0)).catch(() => {});
  return buf;
}

/**
 * Fetch + decode a single sample URL. Returns a Promise<AudioBuffer> that is
 * cached forever; concurrent callers share the same in-flight promise.
 */
export function loadSample(url, options = {}) {
  if (memCache.has(url)) return memCache.get(url);
  const promise = (async () => {
    const arrayBuffer = await fetchRawBytes(url, options);
    // decodeAudioData mutates / consumes the buffer in some implementations;
    // give it a fresh copy so a future re-decode (e.g. after cache eviction)
    // can still work.
    return await getCtx().decodeAudioData(arrayBuffer.slice(0));
  })().catch((err) => {
    memCache.delete(url);
    throw err;
  });
  memCache.set(url, promise);
  return promise;
}

/**
 * Try several candidate URLs in order and return the first one that decodes.
 * Useful when an upstream might serve different formats (`.ogg` vs `.m4a`)
 * or when we want to fall back to a mirror if the primary host is down.
 */
export async function loadSampleWithFallback(urls, options = {}) {
  let lastErr = null;
  for (const url of urls) {
    try {
      return await loadSample(url, options);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No sample URLs provided');
}

/**
 * Trigger a one-shot for a pre-loaded AudioBuffer. Returns the source node
 * so the caller can stop it early (e.g. choke groups for closed/open hat).
 */
export function playBuffer(buffer, { gain = 1, rate = 1, when, destination } = {}) {
  const ctx = getCtx();
  const dest = destination || getMaster();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(dest);
  src.start(when ?? ctx.currentTime);
  return src;
}

/**
 * SampleKit: a named collection of one-shot samples (drum hits, percussion,
 * metronome clicks). Each sample maps to one or more URL candidates; the
 * kit pre-loads them in parallel and exposes a synchronous `.play(name)`.
 *
 * Usage:
 *   const kit = new SampleKit({
 *     kick:  ['https://.../kick.ogg'],
 *     snare: ['https://.../snare.ogg', 'https://.../snare.m4a']
 *   });
 *   await kit.preload();
 *   kit.play('kick', { gain: 0.9 });
 */
export class SampleKit {
  constructor(catalog = {}) {
    this.catalog = catalog;
    this.buffers = new Map(); // name -> AudioBuffer
    this.failures = new Set(); // names that have permanently failed
    this._loadPromise = null;
  }

  has(name) {
    return this.buffers.has(name);
  }

  isReady(name) {
    if (name == null) return this.buffers.size > 0;
    return this.buffers.has(name);
  }

  async preload() {
    if (this._loadPromise) return this._loadPromise;
    const entries = Object.entries(this.catalog);
    this._loadPromise = Promise.all(
      entries.map(async ([name, urls]) => {
        const list = Array.isArray(urls) ? urls : [urls];
        try {
          const buf = await loadSampleWithFallback(list);
          this.buffers.set(name, buf);
        } catch (err) {
          this.failures.add(name);
          console.warn('Sample load failed for', name, err && err.message);
        }
      })
    );
    return this._loadPromise;
  }

  play(name, options = {}) {
    const buf = this.buffers.get(name);
    if (!buf) return null;
    return playBuffer(buf, options);
  }
}

/**
 * MultiSampler: pitched playback of a sparse set of anchor samples. We pick
 * the closest anchor by MIDI distance and detune via `playbackRate`. Large
 * detunes (more than ~7 semitones) start sounding chipmunk-y, so callers
 * should provide anchors at least every minor third.
 *
 * `anchors` is `{ midi: urls[] }` (or `{ midi: url }`). Names like 'C4' are
 * accepted by MultiSampler.fromNotes() below.
 *
 * Pass `{ loop: true }` to the constructor for sustained-tone instruments
 * (accordion, harmonium, organ) — held notes loop the sustained middle of
 * each sample so a key can be held indefinitely. The default is one-shot
 * playback (piano, guitar pluck) where the sample just decays naturally.
 */
export class MultiSampler {
  constructor(anchors = {}, options = {}) {
    this.anchorMidis = Object.keys(anchors)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    this.anchorUrls = anchors;
    this.loop = !!options.loop;
    // Default destination for noteOn(); per-noteOn destination overrides
    // this. Used by accordion to route voices into its BreathBus instead
    // of the shared master gain.
    this.destination = options.destination || null;
    this.buffers = new Map(); // midi -> AudioBuffer
    this.activeNotes = new Map(); // midi -> { src, gain }
    this._loadPromise = null;
  }

  static fromNotes(notes, options = {}) {
    const out = {};
    for (const [name, urls] of Object.entries(notes)) {
      const midi = noteNameToMidi(name);
      if (midi != null) out[midi] = urls;
    }
    return new MultiSampler(out, options);
  }

  isReady() {
    return this.buffers.size > 0;
  }

  async preload() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = Promise.all(
      this.anchorMidis.map(async (midi) => {
        const urls = this.anchorUrls[midi];
        const list = Array.isArray(urls) ? urls : [urls];
        try {
          const buf = await loadSampleWithFallback(list);
          this.buffers.set(midi, buf);
        } catch (err) {
          console.warn('MultiSampler anchor failed at midi', midi, err && err.message);
        }
      })
    );
    return this._loadPromise;
  }

  _closestAnchor(midi) {
    let best = null;
    let bestDist = Infinity;
    for (const m of this.buffers.keys()) {
      const d = Math.abs(m - midi);
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
    return best;
  }

  /**
   * Trigger one voice. `detune` is in cents (¢) and is applied via the
   * source's native `detune` AudioParam, on top of the playbackRate
   * pitch-shift used to reach the target MIDI from the closest anchor.
   * The accordion's musette stops use this to stack two M voices at
   * different detunes on the same logical midi (e.g. +0¢ and +8¢) and
   * get the characteristic beating without needing a separately-recorded
   * MM sample pack. Defaults to 0 so non-accordion callers keep working.
   */
  noteOn(midi, { gain = 1, attack = 0.005, destination, loop, detune = 0 } = {}) {
    const anchor = this._closestAnchor(midi);
    if (anchor == null) return false;
    const buf = this.buffers.get(anchor);
    if (!buf) return false;
    // Compound key so the same midi can sound at multiple detunes
    // simultaneously (musette MM is the motivating case). Stop only the
    // prior voice at this exact (midi, detune) so re-triggers don't
    // pile up but a +0¢ noteOn doesn't kill an already-ringing +8¢
    // voice on the same midi.
    const key = `${midi}|${detune}`;
    this.noteOff(midi, { release: 0.02, detune });

    const ctx = getCtx();
    const dest = destination || this.destination || getMaster();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = midiToFreq(midi) / midiToFreq(anchor);
    if (detune !== 0 && src.detune) {
      try {
        src.detune.value = detune;
      } catch (_) {
        /* older WebAudio without detune — fail silently */
      }
    }

    // Looped playback for sustained instruments. We loop the sustained
    // middle of the buffer (skipping the recorded attack and release) so
    // a held note rings forever without an audible "thump" at each loop
    // boundary. Same trick the SampleVoice in shared/audio.js uses.
    const shouldLoop = loop != null ? loop : this.loop;
    if (shouldLoop) {
      const dur = buf.duration;
      src.loop = true;
      if (dur > 0.5) {
        const trim = Math.min(0.25, dur * 0.1);
        src.loopStart = trim;
        src.loopEnd = Math.max(trim + 0.05, dur - trim);
      }
    }

    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + Math.max(0.001, attack));
    src.connect(g);
    g.connect(dest);
    src.start(now);
    this.activeNotes.set(key, { src, gain: g });
    return true;
  }

  noteOff(midi, { release = 0.25, detune = 0 } = {}) {
    const key = `${midi}|${detune}`;
    const voice = this.activeNotes.get(key);
    if (!voice) return;
    this.activeNotes.delete(key);
    const ctx = getCtx();
    const now = ctx.currentTime;
    const r = Math.max(0.01, release);
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + r);
    } catch (_) {
      /* ignore */
    }
    try {
      voice.src.stop(now + r + 0.05);
    } catch (_) {
      /* already stopped */
    }
  }

  allOff() {
    // Iterate over a snapshot of keys; noteOff mutates activeNotes.
    // Each key is `${midi}|${detune}` — parse out the components so
    // noteOff finds the right entry (it re-keys internally).
    for (const key of Array.from(this.activeNotes.keys())) {
      const sep = key.indexOf('|');
      const midi = sep >= 0 ? Number(key.slice(0, sep)) : Number(key);
      const detune = sep >= 0 ? Number(key.slice(sep + 1)) : 0;
      this.noteOff(midi, { release: 0.05, detune });
    }
  }
}

const NOTE_LETTER_TO_SEMITONE = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

/**
 * Parse a note name like 'C4', 'A#3', or 'Bb2' to its MIDI number.
 * Returns null for invalid names. Used so callers can pass note-name
 * keys to MultiSampler.fromNotes() instead of raw MIDI numbers.
 */
export function noteNameToMidi(name) {
  if (typeof name !== 'string') return null;
  const m = /^([A-Ga-g])([#bs]?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const octave = parseInt(m[3], 10);
  let semitone = NOTE_LETTER_TO_SEMITONE[letter];
  if (accidental === '#' || accidental === 's') semitone += 1;
  else if (accidental === 'b') semitone -= 1;
  return (octave + 1) * 12 + semitone;
}
