/**
 * PeriodicWave synth for the drawn wavetable.
 *
 * Split out of wave-draw.js because it touches no DOM: the page owns the
 * canvas, the keyboard, and prefs, this owns voices and the oscillator's
 * shape. `rebuildWave()` re-pushes the shape into every sounding voice, so
 * edits to the table are heard while a note is still held.
 */
import { getCtx, getMaster, midiToFreq, resumeIfSuspended } from '../shared/audio.js';
import { fillPreset, samplesToFourier } from './wave-table.js';

const KEY_PEAK = 0.55;
/** Audition sits under a played note — it is a monitor, not a performance. */
const AUDITION_PEAK = 0.35;

export class WavetableSynth {
  constructor() {
    this.samples = fillPreset('sine');
    this.voices = new Map();
    // Kept out of `voices` so a drag on the canvas cannot stop, or be
    // stopped by, a key the player is holding — one hand on a key and one on
    // the canvas is the natural way to hear what a shape does.
    this.audition = null;
    this.wave = null;
  }

  rebuildWave() {
    const ctx = getCtx();
    const { real, imag } = samplesToFourier(this.samples);
    this.wave = ctx.createPeriodicWave(real, imag);
    for (const voice of this.voices.values()) {
      voice.osc.setPeriodicWave(this.wave);
    }
    if (this.audition) this.audition.osc.setPeriodicWave(this.wave);
  }

  _startVoice(midi, peak) {
    const ctx = getCtx();
    resumeIfSuspended();
    if (!this.wave) this.rebuildWave();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.value = midiToFreq(midi);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(peak, now + 0.01);
    osc.connect(amp);
    amp.connect(getMaster());
    osc.start(now);
    return { osc, amp };
  }

  _stopVoice(voice, releaseTime) {
    const ctx = getCtx();
    const now = ctx.currentTime;
    try {
      voice.amp.gain.cancelScheduledValues(now);
      voice.amp.gain.setValueAtTime(Math.max(0.0001, voice.amp.gain.value), now);
      voice.amp.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
    } catch {
      /* ignore */
    }
    voice.osc.stop(now + releaseTime + 0.05);
  }

  noteOn(midi) {
    if (this.voices.has(midi)) this.noteOff(midi, true);
    this.voices.set(midi, this._startVoice(midi, KEY_PEAK));
  }

  noteOff(midi, instant = false) {
    const voice = this.voices.get(midi);
    if (!voice) return;
    this.voices.delete(midi);
    this._stopVoice(voice, instant ? 0.02 : 0.18);
  }

  /**
   * Hold a tone for the length of a canvas gesture. Drawing otherwise makes
   * no sound at all — the table is only audible through a voice — so a
   * first-time player gets no signal that the strip does anything.
   */
  auditionOn(midi) {
    if (this.audition) return;
    this.audition = this._startVoice(midi, AUDITION_PEAK);
  }

  auditionOff() {
    const voice = this.audition;
    if (!voice) return;
    this.audition = null;
    this._stopVoice(voice, 0.12);
  }

  allOff() {
    for (const midi of Array.from(this.voices.keys())) this.noteOff(midi, true);
    this.auditionOff();
  }
}
