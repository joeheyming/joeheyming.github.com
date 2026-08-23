/**
 * Chip synth + look-ahead transport scheduler.
 */

import {
  getCtx,
  getMaster,
  midiToFreq,
  resumeIfSuspended,
  setMasterVolume
} from '../shared/audio.js';
import { channelAudible } from './model.js';

const LOOKAHEAD_S = 0.12;
const SCHEDULE_AHEAD_S = 0.25;

export class ChipTransport {
  /**
   * @param {{
   *   getSong: () => import('./model.js').Song,
   *   onStep?: (step: number, arrangementIndex: number) => void,
   *   onPause?: () => void,
   *   onStop?: () => void
   * }} opts
   */
  constructor(opts) {
    this.getSong = opts.getSong;
    this.onStep = opts.onStep || (() => {});
    this.onPause = opts.onPause || (() => {});
    this.onStop = opts.onStop || (() => {});
    this.playing = false;
    this.loopSong = true;
    this.currentStep = 0;
    this.currentArrIndex = 0;
    this._timer = 0;
    this._nextStepTime = 0;
    this._step = 0;
    this._arrIndex = 0;
    this._noiseBuffer = null;
    /** @type {Set<AudioNode>} */
    this._live = new Set();
  }

  setVolume(v) {
    setMasterVolume(v);
  }

  play() {
    resumeIfSuspended();
    const ctx = getCtx();
    if (this.playing) return;
    this.playing = true;
    this._nextStepTime = ctx.currentTime + 0.05;
    this._tick();
  }

  _halt() {
    this.playing = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = 0;
    }
    this._stopAll();
  }

  pause() {
    if (!this.playing) return;
    this._halt();
    this.onPause();
  }

  stop() {
    this._halt();
    this._step = 0;
    this._arrIndex = 0;
    this.onStop();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  _tick() {
    if (!this.playing) return;
    const ctx = getCtx();
    const song = this.getSong();
    const stepDur = 60 / song.tempo / 4; // 16th notes

    while (this._nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      this._scheduleStep(song, this._step, this._arrIndex, this._nextStepTime);
      this.currentStep = this._step;
      this.currentArrIndex = this._arrIndex;
      this.onStep(this._step, this._arrIndex);
      this._nextStepTime += stepDur;
      this._step += 1;
      if (this._step >= song.steps) {
        this._step = 0;
        this._arrIndex += 1;
        if (this._arrIndex >= song.arrangement.length) {
          if (this.loopSong) this._arrIndex = 0;
          else {
            this.stop();
            return;
          }
        }
      }
    }

    this._timer = window.setTimeout(() => this._tick(), LOOKAHEAD_S * 1000);
  }

  /**
   * @param {import('./model.js').Song} song
   * @param {number} step
   * @param {number} arrIndex
   * @param {number} when
   */
  _scheduleStep(song, step, arrIndex, when) {
    const patternIndex = song.arrangement[arrIndex] ?? song.activePattern;
    const pattern = song.patterns[patternIndex];
    if (!pattern) return;
    const stepDur = 60 / song.tempo / 4;

    for (let ci = 0; ci < song.channels.length; ci++) {
      if (!channelAudible(song, ci)) continue;
      const ch = song.channels[ci];
      const notes = pattern.tracks[ci] || [];
      for (const note of notes) {
        if (note.s !== step) continue;
        this._playNote(ch, note.p, when, note.l * stepDur);
      }
    }
  }

  /**
   * Preview a single pitch immediately (paint feedback).
   * @param {import('./model.js').Channel} ch
   * @param {number} midi
   */
  preview(ch, midi) {
    resumeIfSuspended();
    this._playNote(ch, midi, getCtx().currentTime, 0.12);
  }

  /**
   * @param {import('./model.js').Channel} ch
   * @param {number} midi
   * @param {number} when
   * @param {number} dur
   */
  _playNote(ch, midi, when, dur) {
    const ctx = getCtx();
    const master = getMaster();
    const attack = Math.max(0.005, ch.attack);
    const release = Math.max(0.02, ch.release);
    const noteDur = Math.max(0.04, dur);
    const stopAt = when + noteDur;
    const gain = ctx.createGain();
    const vol = Math.max(0.0001, ch.volume * 0.22);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(vol, when + attack);
    gain.gain.setValueAtTime(vol, Math.max(when + attack, stopAt - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    gain.connect(master);

    /** @type {AudioScheduledSourceNode[]} */
    const sources = [];

    if (ch.wave === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this._getNoiseBuffer();
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = midiToFreq(midi);
      filter.Q.value = 1.2;
      src.connect(filter);
      filter.connect(gain);
      sources.push(src);
    } else if (ch.wave === 'pulse25' || ch.wave === 'pulse50') {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(this._pulseWave(ch.wave === 'pulse25' ? 0.25 : 0.5));
      osc.frequency.value = midiToFreq(midi);
      osc.connect(gain);
      sources.push(osc);
    } else {
      const osc = ctx.createOscillator();
      osc.type = ch.wave === 'saw' ? 'sawtooth' : ch.wave === 'triangle' ? 'triangle' : 'square';
      osc.frequency.value = midiToFreq(midi);
      osc.connect(gain);
      sources.push(osc);
    }

    for (const src of sources) {
      src.start(when);
      src.stop(stopAt + 0.02);
      this._live.add(src);
      src.onended = () => this._live.delete(src);
    }
  }

  _getNoiseBuffer() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const ctx = getCtx();
    const len = ctx.sampleRate * 1;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
    return buf;
  }

  /** @param {number} duty 0..1 */
  _pulseWave(duty) {
    const ctx = getCtx();
    const harmonics = 32;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let n = 1; n < harmonics; n++) {
      imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  _stopAll() {
    for (const src of [...this._live]) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      this._live.delete(src);
    }
  }
}
