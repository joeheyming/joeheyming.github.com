/**
 * Shared PianoSynth: a hybrid synth with three back-ends, used by both
 * the free-play piano page (`/play/piano/`) and the rhythm-game piano-hero
 * page (`/piano-hero/`). Lifting this out of the piano page keeps the
 * timbre identical between the two — same multi-sampler anchors, same
 * fallback chain, same per-tone behavior.
 *
 *   1. **Multi-sampler** (`grand_piano_samples`): real piano samples from
 *      the public-domain `nbrosowsky/tonejs-instruments` catalog (CC-BY 3.0),
 *      streamed through proxy.js, decoded once, and detuned via
 *      `playbackRate` to fill the gaps between anchor notes. Highest
 *      realism and the page-level default.
 *   2. **Soundfont** (`acoustic_grand_piano`, `electric_piano_1`): the
 *      previous MusyngKite-backed engine via soundfont-player.
 *   3. **Oscillator** (`sine` / `square` / `triangle` / `sawtooth`): pure
 *      Web Audio for retro tones, no network.
 *
 * Switching tones is hot — held notes on the previous engine are released
 * cleanly. The synth falls through to the soundfont (or finally to the
 * oscillator) if a sample anchor fails to load, so a flaky network never
 * silences the keyboard.
 */
import {
  midiToFreq,
  midiToName,
  getCtx,
  getMaster,
  resumeIfSuspended,
  loadInstrument
} from './audio.js';
import { MultiSampler } from './samples.js';

export const SAMPLE_TONES = new Set(['acoustic_grand_piano', 'electric_piano_1']);
export const OSCILLATOR_TONES = new Set(['sine', 'square', 'triangle', 'sawtooth']);
export const MULTI_SAMPLE_TONE = 'grand_piano_samples';

/**
 * Anchor notes for the multi-sampler grand piano. Every 6 semitones
 * (tritone) across the playable piano range, balanced so the worst-case
 * pitch-shift is ±3 semitones (playback rate 0.84..1.19) — comfortably
 * within "you can't hear it" territory for piano.
 *
 * URL pattern: `https://.../tonejs-instruments/.../piano/<NoteName>.mp3`
 * with sharps spelled `s` (e.g. F#3 -> `Fs3.mp3`).
 */
const TONEJS_PIANO_BASE =
  'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/piano';

const GRAND_PIANO_ANCHORS = [
  // Note names in URL-friendly form (sharps as 's'). The MultiSampler note
  // parser accepts both `F#1` and `Fs1`, so we use the URL spelling
  // directly without rewriting.
  'C1',
  'Fs1',
  'C2',
  'Fs2',
  'C3',
  'Fs3',
  'C4',
  'Fs4',
  'C5',
  'Fs5',
  'C6',
  'Fs6',
  'C7',
  'Fs7',
  'C8'
];

function buildGrandPianoAnchors() {
  const map = {};
  for (const note of GRAND_PIANO_ANCHORS) {
    map[note] = `${TONEJS_PIANO_BASE}/${note}.mp3`;
  }
  return map;
}

export class PianoSynth {
  constructor() {
    this.tone = MULTI_SAMPLE_TONE;
    this.voices = new Map(); // midi -> { osc, osc2, gain } (oscillator-mode only)
    this.samplePlayers = new Map(); // tone -> { instrument, playing: Map<midi, node> }
    this.multiSampler = null;
    this.multiSamplerStatus = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'
  }

  isSampleTone(tone) {
    return SAMPLE_TONES.has(tone);
  }

  isMultiSampleTone(tone) {
    return tone === MULTI_SAMPLE_TONE;
  }

  setTone(tone) {
    this.tone = tone;
    if (this.isSampleTone(tone)) this.ensureSampleLoaded(tone);
    if (this.isMultiSampleTone(tone)) this.ensureMultiSamplerLoaded();
  }

  async ensureSampleLoaded(tone) {
    const player = this.getOrCreateSamplePlayer(tone);
    if (player.instrument) return player.instrument;
    if (player.loadingPromise) return player.loadingPromise;
    player.loadingPromise = loadInstrument(tone).then((inst) => {
      player.instrument = inst;
      player.loadingPromise = null;
      return inst;
    });
    return player.loadingPromise;
  }

  async ensureMultiSamplerLoaded() {
    if (this.multiSampler && this.multiSamplerStatus === 'ready') return this.multiSampler;
    if (!this.multiSampler) {
      this.multiSampler = MultiSampler.fromNotes(buildGrandPianoAnchors());
    }
    if (this.multiSamplerStatus === 'loading') return this.multiSampler;
    this.multiSamplerStatus = 'loading';
    try {
      await this.multiSampler.preload();
      this.multiSamplerStatus = this.multiSampler.isReady() ? 'ready' : 'error';
    } catch (_) {
      this.multiSamplerStatus = 'error';
    }
    return this.multiSampler;
  }

  getOrCreateSamplePlayer(tone) {
    let player = this.samplePlayers.get(tone);
    if (!player) {
      player = { instrument: null, loadingPromise: null, playing: new Map() };
      this.samplePlayers.set(tone, player);
    }
    return player;
  }

  isReady(tone = this.tone) {
    if (this.isMultiSampleTone(tone)) return this.multiSamplerStatus === 'ready';
    if (this.isSampleTone(tone)) return !!this.samplePlayers.get(tone)?.instrument;
    return true;
  }

  noteOn(midi, { gain = 0.85 } = {}) {
    getCtx();
    resumeIfSuspended();

    if (this.isMultiSampleTone(this.tone)) {
      if (this.multiSampler && this.multiSampler.isReady()) {
        this.multiSampler.noteOn(midi, { gain: Math.max(0.05, Math.min(1, gain)) });
        return;
      }
      // Sample not loaded yet: fall through to oscillator for instant feedback.
      this.ensureMultiSamplerLoaded();
      this.oscNoteOn(midi, gain);
      return;
    }

    if (this.isSampleTone(this.tone)) {
      const player = this.getOrCreateSamplePlayer(this.tone);
      if (player.instrument) {
        const prev = player.playing.get(midi);
        if (prev) {
          try {
            prev.stop();
          } catch (_) {
            /* ignore */
          }
        }
        const node = player.instrument.play(midiToName(midi));
        player.playing.set(midi, node);
        return;
      }
      // Sample not loaded yet: fall through to oscillator for instant feedback.
      this.ensureSampleLoaded(this.tone);
    }

    this.oscNoteOn(midi, gain);
  }

  noteOff(midi, instant = false) {
    if (this.multiSampler) {
      this.multiSampler.noteOff(midi, { release: instant ? 0.05 : 0.4 });
    }
    // Stop soundfont voice (if any) for this midi across any tone.
    for (const player of this.samplePlayers.values()) {
      const node = player.playing.get(midi);
      if (node) {
        player.playing.delete(midi);
        try {
          node.stop();
        } catch (_) {
          /* ignore */
        }
      }
    }
    this.oscNoteOff(midi, instant);
  }

  oscNoteOn(midi, gainScale = 0.85) {
    if (this.voices.has(midi)) this.oscNoteOff(midi, true);

    const ctx = getCtx();
    const master = getMaster();
    const now = ctx.currentTime;
    const freq = midiToFreq(midi);
    const peak = 0.6 * Math.max(0.05, Math.min(1, gainScale));
    const sustain = 0.35 * Math.max(0.05, Math.min(1, gainScale));

    const osc = ctx.createOscillator();
    osc.type = OSCILLATOR_TONES.has(this.tone) ? this.tone : 'triangle';
    osc.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.08;
    osc2.connect(osc2Gain);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, sustain), now + 0.25);

    osc.connect(gain);
    osc2Gain.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc2.start(now);

    this.voices.set(midi, { osc, osc2, gain });
  }

  oscNoteOff(midi, instant = false) {
    const voice = this.voices.get(midi);
    if (!voice) return;
    this.voices.delete(midi);
    const ctx = getCtx();
    const now = ctx.currentTime;
    const releaseTime = instant ? 0.02 : 0.35;

    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
    } catch (_) {
      /* ignore */
    }

    voice.osc.stop(now + releaseTime + 0.05);
    voice.osc2.stop(now + releaseTime + 0.05);
  }

  allOff() {
    if (this.multiSampler) this.multiSampler.allOff();
    for (const player of this.samplePlayers.values()) {
      for (const midi of Array.from(player.playing.keys())) {
        const node = player.playing.get(midi);
        player.playing.delete(midi);
        try {
          node.stop();
        } catch (_) {
          /* ignore */
        }
      }
    }
    for (const midi of Array.from(this.voices.keys())) {
      this.oscNoteOff(midi, true);
    }
  }
}
