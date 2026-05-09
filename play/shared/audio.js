/**
 * Shared audio helpers for /play/* instruments.
 *
 * Owns a single AudioContext + master gain so multiple instruments can share
 * a sound chain (and one master volume slider). Wraps soundfont-player with
 * a per-instrument cache so the same patch is only loaded once.
 *
 * The soundfont-player library is loaded as a classic <script> tag in each
 * page that needs samples; it sets `window.Soundfont`, which we read here.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_OFFSETS = new Set([1, 3, 6, 8, 10]);

export function midiToName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function isBlackKey(midi) {
  return BLACK_OFFSETS.has(midi % 12);
}

export function isC(midi) {
  return midi % 12 === 0;
}

let ctx = null;
let master = null;
let masterVolume = 0.65;

export function getCtx() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  ctx = new Ctx();
  master = ctx.createGain();
  master.gain.value = masterVolume;
  master.connect(ctx.destination);
  return ctx;
}

export function getMaster() {
  getCtx();
  return master;
}

export function resumeIfSuspended() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function setMasterVolume(v) {
  masterVolume = v;
  if (!master) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(v, now, 0.02);
}

/**
 * Cached soundfont loader. Returns a Promise that resolves to the
 * soundfont-player instrument object (with `.play(noteName)` etc.) or null
 * if the library isn't available / the load fails.
 *
 * The destination is wired at instrument-load time and **cannot** be
 * overridden per-note — soundfont-player connects each note's gain node
 * to a single fixed output and silently ignores the per-`play()`
 * `destination` option. So callers that need a custom routing stage
 * (e.g. the accordion's BreathBus) must pass `destination` here, and
 * we cache one instrument instance per (name, destination) pair.
 *
 * Most callers leave `destination` unset and share the default
 * shared-master cache; the accordion is the only consumer that needs
 * its own instrument instance routed into the BreathBus gain node.
 */
const instrumentCache = new Map(); // name -> Map<AudioNode, Promise<instrument>>

export function loadInstrument(name, destination = null) {
  const dest = destination || getMaster();
  let perDest = instrumentCache.get(name);
  if (perDest && perDest.has(dest)) return perDest.get(dest);
  if (!perDest) {
    perDest = new Map();
    instrumentCache.set(name, perDest);
  }
  if (!window.Soundfont) {
    const p = Promise.resolve(null);
    perDest.set(dest, p);
    return p;
  }
  const promise = window.Soundfont.instrument(getCtx(), name, {
    destination: dest
  }).catch((err) => {
    console.warn('Soundfont load failed for', name, err);
    perDest.delete(dest);
    return null;
  });
  perDest.set(dest, promise);
  return promise;
}

/**
 * SampleVoice: wraps a single soundfont instrument with note tracking.
 * Used by piano/accordion/guitar where we just want clean note-on/off.
 *
 * `playOptions` is forwarded to soundfont-player's `instrument.play()` on
 * every note-on. Most callers leave it empty (default piano-style ADSR);
 * the accordion passes `{ loop: true }` so held notes sustain forever
 * (the MusyngKite samples are only a few seconds long, but soundfont-
 * player loops them seamlessly via the embedded sample loop points).
 *
 * Pass `{ destination }` (an AudioNode) to route the voice into a custom
 * gain stage instead of the master output — used by accordion to send
 * voices through its BreathBus. Defaults to the shared master gain.
 * Note: soundfont-player wires destination at *instrument-load* time and
 * ignores any per-play `destination`, so we must load a dedicated
 * instrument instance per destination (handled by `loadInstrument`).
 */
export class SampleVoice {
  constructor(instrumentName, playOptions = {}) {
    this.instrumentName = instrumentName;
    this.instrument = null;
    const { destination = null, ...rest } = playOptions;
    this.destination = destination;
    this.playOptions = rest;
    this.playing = new Map(); // midi -> player node
  }

  async load() {
    if (this.instrument) return this.instrument;
    this.instrument = await loadInstrument(this.instrumentName, this.destination);
    return this.instrument;
  }

  isReady() {
    return !!this.instrument;
  }

  noteOn(midi) {
    if (!this.instrument) return false;
    const prev = this.playing.get(midi);
    if (prev) {
      try {
        prev.stop();
      } catch (_) {
        /* ignore */
      }
    }

    const node = this.instrument.play(midiToName(midi), undefined, this.playOptions);

    // When looping, trim the loop region to skip the sample's natural
    // attack and release. Without this we'd loop the entire 3s buffer,
    // which produces an audible "pulse" every loop boundary as the
    // recorded decay restarts at full attack volume. By looping only the
    // sustained middle, sustained held notes stay smooth.
    if (this.playOptions.loop && node && node.source && node.source.buffer) {
      const dur = node.source.buffer.duration;
      if (dur > 0.5) {
        const trim = Math.min(0.25, dur * 0.1);
        node.source.loopStart = trim;
        node.source.loopEnd = Math.max(trim + 0.05, dur - trim);
      }
    }

    this.playing.set(midi, node);
    return true;
  }

  noteOff(midi) {
    const node = this.playing.get(midi);
    if (!node) return;
    this.playing.delete(midi);
    try {
      node.stop();
    } catch (_) {
      /* ignore */
    }
  }

  allOff() {
    for (const midi of Array.from(this.playing.keys())) this.noteOff(midi);
  }
}
