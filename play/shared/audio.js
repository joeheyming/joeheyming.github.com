/**
 * Shared audio helpers for /play/* instruments.
 *
 * Owns a single AudioContext + master gain so multiple instruments can share
 * a sound chain (and one master volume slider). Wraps soundfont-player with
 * a per-instrument cache so the same patch is only loaded once.
 *
 * The soundfont-player library is loaded as a classic <script> tag in each
 * page that needs samples; it sets `window.Soundfont`, which we read here.
 *
 * Every instrument routes through getCtx() / resumeIfSuspended(), so the
 * WebKit unlock handling below is shared by Safari and other WebKit engines
 * that actually expose the Web Audio API. This module also owns the page's
 * iOS audio session, which is a document-level mode rather than a per-node
 * setting — pages that capture audio must release it via beginAudioCapture().
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
let outputUnlocked = false;
let gestureUnlockArmed = false;

/**
 * A maxed volume slider is unity gain, so the only way to get louder than
 * "as loud as the samples were recorded" is to go over it. Touch devices
 * need that headroom: a phone speaker is quieter than any desktop output
 * for the same gain. The output stage below ends in a limiter because of
 * this.
 *
 * The factor is in amplitude, where the ear is not linear: +20% is only
 * +1.6 dB, which is around the threshold of noticeable and would not have
 * fixed the report this came from. 1.6x is ~+4 dB, audible without being
 * the kind of gain that leans on the limiter for ordinary playing. It is
 * one number to turn if a phone still comes out quiet.
 *
 * Detection matches the accordion's: `(any-pointer: coarse)` catches phones
 * and tablets (including an iPad with a trackpad attached, where
 * `hover: none` would not), and `maxTouchPoints` is the UA-side backstop.
 * A touchscreen laptop gets the boost too — under a limiter, that is not
 * worth a more brittle check.
 */
const TOUCH_OUTPUT_BOOST = 1.6;

const outputBoost = (() => {
  if (typeof window === 'undefined') return 1;
  const coarse = !!(window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches);
  const touch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0;
  return coarse || touch ? TOUCH_OUTPUT_BOOST : 1;
})();

/**
 * Anything over 1.0 hard-clips at the destination, and the boost above puts
 * a maxed slider with several voices stacked on it there. A fast,
 * high-ratio compressor just below unity catches those peaks instead.
 * Returns the node instruments should feed; the destination itself on
 * engines without a compressor.
 */
function createOutputStage(target) {
  try {
    const limiter = target.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(target.destination);
    return limiter;
  } catch (_) {
    return target.destination;
  }
}

/**
 * iOS starts every page in the `ambient` audio session. Ambient is the
 * category the ringer switch governs and it tracks the ringer volume, not
 * the media volume — which is why an instrument can be quiet, or silent
 * outright, on a phone whose media volume is maxed. `playback` is the
 * output-only category the switch does not touch. Safari is the only engine
 * that implements `navigator.audioSession`; everywhere else this is a no-op.
 *
 * The cost is that `playback` is exclusive: claiming it interrupts whatever
 * the user was listening to and does not resume it afterwards. For an
 * instrument the sound is the entire point, so we claim it.
 *
 * It is also incompatible with mic capture — WebKit rejects
 * `getUserMedia({ audio })` with InvalidStateError while a page holds
 * `playback`, and ends a capture track that is already live. The tuner and
 * the theremin's recorder therefore hand the session back through
 * beginAudioCapture() *before* requesting a stream; a release placed after
 * the `await` would never run on the path that needs it. The count is there
 * because two things on one page can each need the exemption.
 */
let liveCaptures = 0;

function setSessionType(type) {
  const session = typeof navigator !== 'undefined' ? navigator.audioSession : null;
  if (!session) return;
  try {
    session.type = type;
  } catch (_) {
    /* engine without this session type — keep the default */
  }
}

/** Call before `getUserMedia({ audio })`, never after. */
export function beginAudioCapture() {
  liveCaptures += 1;
  setSessionType('auto');
}

/** Call once per beginAudioCapture(), when the capture is torn down. */
export function endAudioCapture() {
  liveCaptures = Math.max(0, liveCaptures - 1);
  if (liveCaptures === 0 && ctx) setSessionType('playback');
}

/**
 * WebKit parks a context in `interrupted` (not `suspended`) when the audio
 * session is taken away — another app grabs output or the page is
 * backgrounded. `resume()` is what brings it back, so treat both states the
 * same everywhere we check.
 */
function needsResume(target) {
  return target.state === 'suspended' || target.state === 'interrupted';
}

/**
 * WebKit keeps a context's output silent until at least one buffer has
 * started from inside a user gesture — `resume()` alone reports `running`
 * while producing nothing. Playing a single silent frame is the standard
 * unlock, and it's a no-op on engines that don't need it.
 */
function unlockOutput(target) {
  if (outputUnlocked) return;
  try {
    const src = target.createBufferSource();
    src.buffer = target.createBuffer(1, 1, target.sampleRate);
    src.connect(target.destination);
    src.start(0);
    outputUnlocked = true;
  } catch (_) {
    /* retry on the next gesture */
  }
}

/**
 * Safety net for pages that build their graph at load time (metronome,
 * chiptune) instead of on the first note: unlock from the first real gesture
 * anywhere on the page, whatever the instrument's own handlers do.
 */
function armGestureUnlock() {
  if (gestureUnlockArmed || typeof window === 'undefined') return;
  gestureUnlockArmed = true;
  const events = ['pointerdown', 'touchend', 'mousedown', 'keydown'];
  const onGesture = () => {
    if (!ctx) return;
    if (needsResume(ctx)) ctx.resume().catch(() => {});
    unlockOutput(ctx);
    if (outputUnlocked) {
      for (const type of events) window.removeEventListener(type, onGesture, true);
    }
  };
  for (const type of events) {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  }
}

export function getCtx() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  ctx = new Ctx();
  if (liveCaptures === 0) setSessionType('playback');
  master = ctx.createGain();
  master.gain.value = masterVolume * outputBoost;
  master.connect(createOutputStage(ctx));
  armGestureUnlock();
  return ctx;
}

export function getMaster() {
  getCtx();
  return master;
}

export function resumeIfSuspended() {
  if (ctx && needsResume(ctx)) ctx.resume().catch(() => {});
  // Every note-on funnels through here, so this is also the reliable
  // in-gesture moment to unlock WebKit output.
  if (ctx) unlockOutput(ctx);
}

export function setMasterVolume(v) {
  masterVolume = v;
  if (!master) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(v * outputBoost, now, 0.02);
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
    // Keyed by `${midi}|${detune}` so the same MIDI note can be played
    // simultaneously at multiple cent-detunes (e.g. the accordion's
    // musette stops, which stack a +0c M reed and a +8c M reed at the
    // same logical midi to produce the characteristic beating). Without
    // a compound key, the second noteOn on the same midi would stop
    // the first (see the `prev` guard below).
    this.playing = new Map(); // `${midi}|${detune}` -> player node
  }

  async load() {
    if (this.instrument) return this.instrument;
    this.instrument = await loadInstrument(this.instrumentName, this.destination);
    return this.instrument;
  }

  isReady() {
    return !!this.instrument;
  }

  /**
   * Trigger one voice. `detune` is in cents (¢) — used by the accordion
   * to synthesize a musette MM reed pair (one voice at +0¢, one at
   * ~+8¢). Defaults to 0 so non-accordion callers keep working.
   */
  noteOn(midi, { detune = 0 } = {}) {
    if (!this.instrument) return false;
    const key = `${midi}|${detune}`;
    const prev = this.playing.get(key);
    if (prev) {
      try {
        prev.stop();
      } catch (_) {
        /* ignore */
      }
    }

    const node = this.instrument.play(midiToName(midi), undefined, this.playOptions);

    // Apply cent-level detune via the AudioBufferSourceNode's `detune`
    // AudioParam. soundfont-player exposes the source on node.source.
    // 0¢ is a no-op so the param stays at its default for the common
    // case (every non-musette caller).
    if (detune !== 0 && node && node.source && node.source.detune) {
      try {
        node.source.detune.value = detune;
      } catch (_) {
        /* older WebAudio without detune support — fail silently */
      }
    }

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

    this.playing.set(key, node);
    return true;
  }

  noteOff(midi, { detune = 0 } = {}) {
    const key = `${midi}|${detune}`;
    const node = this.playing.get(key);
    if (!node) return;
    this.playing.delete(key);
    try {
      node.stop();
    } catch (_) {
      /* ignore */
    }
  }

  allOff() {
    for (const key of Array.from(this.playing.keys())) {
      const node = this.playing.get(key);
      this.playing.delete(key);
      try {
        node.stop();
      } catch (_) {
        /* ignore */
      }
    }
  }
}
