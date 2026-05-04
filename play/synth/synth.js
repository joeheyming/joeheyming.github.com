/**
 * Subtractive synth: per-voice oscillator → low-pass filter → amp envelope.
 * Adds detune (two oscillators slightly offset) and an LFO for vibrato.
 *
 * Each voice owns its own filter so per-note "filter envelope" effects could
 * be added later without affecting other notes.
 */
import { midiToFreq, midiToName, getCtx, getMaster, setMasterVolume } from '../shared/audio.js';
import { Keyboard } from '../shared/keyboard.js';
import { setupMidi } from '../shared/midi.js';
import { makePrefs } from '../shared/prefs.js';
import { attachKeyboardInput } from '../shared/input.js';

const Prefs = makePrefs('play.synth.prefs.v1');

class SubtractiveSynth {
  constructor() {
    this.params = {
      waveform: 'sawtooth',
      cutoff: 4000,
      resonance: 1,
      attack: 0.02,
      release: 0.4,
      detune: 6, // cents
      vibrato: 0 // cents
    };
    this.voices = new Map(); // midi -> voice
    this.lfo = null;
    this.lfoGain = null;
  }

  ensureLfo() {
    if (this.lfo) return;
    const ctx = getCtx();
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 5.5; // Hz
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = this.params.vibrato;
    this.lfo.connect(this.lfoGain);
    this.lfo.start();
  }

  setParam(name, value) {
    this.params[name] = value;
    if (name === 'vibrato' && this.lfoGain) {
      this.lfoGain.gain.setTargetAtTime(value, getCtx().currentTime, 0.05);
    }
    if (name === 'cutoff') {
      const now = getCtx().currentTime;
      for (const voice of this.voices.values()) {
        voice.filter.frequency.setTargetAtTime(value, now, 0.02);
      }
    }
    if (name === 'resonance') {
      const now = getCtx().currentTime;
      for (const voice of this.voices.values()) {
        voice.filter.Q.setTargetAtTime(value, now, 0.02);
      }
    }
  }

  noteOn(midi) {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (this.voices.has(midi)) this.noteOff(midi, true);
    this.ensureLfo();

    const now = ctx.currentTime;
    const freq = midiToFreq(midi);
    const { waveform, cutoff, resonance, attack, detune } = this.params;

    const oscA = ctx.createOscillator();
    oscA.type = waveform;
    oscA.frequency.value = freq;
    oscA.detune.value = -detune;

    const oscB = ctx.createOscillator();
    oscB.type = waveform;
    oscB.frequency.value = freq;
    oscB.detune.value = +detune;

    // Vibrato LFO modulates both oscillator detunes.
    this.lfoGain.connect(oscA.detune);
    this.lfoGain.connect(oscB.detune);

    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    oscA.connect(mix);
    oscB.connect(mix);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = resonance;
    mix.connect(filter);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(0.7, now + Math.max(0.001, attack));
    filter.connect(amp);
    amp.connect(getMaster());

    oscA.start(now);
    oscB.start(now);

    this.voices.set(midi, { oscA, oscB, filter, amp });
  }

  noteOff(midi, instant = false) {
    const voice = this.voices.get(midi);
    if (!voice) return;
    this.voices.delete(midi);
    const ctx = getCtx();
    const now = ctx.currentTime;
    const releaseTime = instant ? 0.02 : Math.max(0.05, this.params.release);

    try {
      voice.amp.gain.cancelScheduledValues(now);
      voice.amp.gain.setValueAtTime(voice.amp.gain.value, now);
      voice.amp.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
    } catch (_) {
      /* ignore */
    }

    voice.oscA.stop(now + releaseTime + 0.05);
    voice.oscB.stop(now + releaseTime + 0.05);
  }

  allOff() {
    for (const midi of Array.from(this.voices.keys())) this.noteOff(midi, true);
  }
}

const PRESETS = {
  lead: {
    waveform: 'sawtooth',
    cutoff: 4500,
    resonance: 4,
    attack: 0.01,
    release: 0.35,
    detune: 8,
    vibrato: 4
  },
  bass: {
    waveform: 'square',
    cutoff: 1100,
    resonance: 6,
    attack: 0.005,
    release: 0.25,
    detune: 0,
    vibrato: 0
  },
  pad: {
    waveform: 'sawtooth',
    cutoff: 2200,
    resonance: 1,
    attack: 0.6,
    release: 1.6,
    detune: 12,
    vibrato: 2
  },
  pluck: {
    waveform: 'triangle',
    cutoff: 6000,
    resonance: 8,
    attack: 0.001,
    release: 0.15,
    detune: 2,
    vibrato: 0
  }
};

// ---------- Page wiring ----------

const keyboardEl = document.getElementById('piano-keyboard');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const waveformEl = document.getElementById('waveform');
const sustainEl = document.getElementById('sustain');
const octaveDownBtn = document.getElementById('octave-down');
const octaveUpBtn = document.getElementById('octave-up');
const octaveDisplay = document.getElementById('octave-display');
const rangeEl = document.getElementById('range');
const midiStatusEl = document.getElementById('midi-status');

const cutoffEl = document.getElementById('cutoff');
const cutoffVal = document.getElementById('cutoff-val');
const resoEl = document.getElementById('resonance');
const resoVal = document.getElementById('resonance-val');
const attackEl = document.getElementById('attack');
const attackVal = document.getElementById('attack-val');
const releaseEl = document.getElementById('release');
const releaseVal = document.getElementById('release-val');
const detuneEl = document.getElementById('detune');
const detuneVal = document.getElementById('detune-val');
const vibratoEl = document.getElementById('vibrato');
const vibratoVal = document.getElementById('vibrato-val');

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.waveform === 'string') {
  const opt = Array.from(waveformEl.options).find((o) => o.value === prefs.waveform);
  if (opt) waveformEl.value = prefs.waveform;
}
if (typeof prefs.range === 'number') {
  const opt = Array.from(rangeEl.options).find((o) => Number(o.value) === prefs.range);
  if (opt) rangeEl.value = String(prefs.range);
}
const knobInputs = {
  cutoff: cutoffEl,
  resonance: resoEl,
  attack: attackEl,
  release: releaseEl,
  detune: detuneEl,
  vibrato: vibratoEl
};
for (const [name, el] of Object.entries(knobInputs)) {
  if (typeof prefs[name] === 'number') el.value = String(prefs[name]);
}

const synth = new SubtractiveSynth();
setMasterVolume(Number(volumeEl.value) / 100);

let startMidi = 60;
if (
  typeof prefs.startMidi === 'number' &&
  Number.isFinite(prefs.startMidi) &&
  prefs.startMidi >= 24 &&
  prefs.startMidi <= 96 &&
  prefs.startMidi % 12 === 0
) {
  startMidi = prefs.startMidi;
}
let whiteKeyCount = Number(rangeEl.value) * 7;

const updateOctaveDisplay = () => {
  octaveDisplay.textContent = midiToName(startMidi);
};

let nowPlayingTimer = null;
const announceNote = (midi) => {
  nowPlaying.textContent = midiToName(midi);
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    nowPlaying.classList.remove('active');
  }, 350);
};

const keyboard = new Keyboard(keyboardEl, {
  startMidi,
  whiteKeyCount,
  synth,
  onActivity: announceNote
});
updateOctaveDisplay();

const persist = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    waveform: waveformEl.value,
    range: Number(rangeEl.value),
    startMidi,
    cutoff: Number(cutoffEl.value),
    resonance: Number(resoEl.value),
    attack: Number(attackEl.value),
    release: Number(releaseEl.value),
    detune: Number(detuneEl.value),
    vibrato: Number(vibratoEl.value)
  });
};

const refreshKnobValues = () => {
  cutoffVal.textContent = `${Math.round(Number(cutoffEl.value))}`;
  resoVal.textContent = Number(resoEl.value).toFixed(1);
  attackVal.textContent = `${Number(attackEl.value).toFixed(2)}s`;
  releaseVal.textContent = `${Number(releaseEl.value).toFixed(2)}s`;
  detuneVal.textContent = `${Number(detuneEl.value).toFixed(1)}¢`;
  vibratoVal.textContent = `${Number(vibratoEl.value).toFixed(1)}¢`;
};

const pushAllParams = () => {
  synth.setParam('waveform', waveformEl.value);
  synth.setParam('cutoff', Number(cutoffEl.value));
  synth.setParam('resonance', Number(resoEl.value));
  synth.setParam('attack', Number(attackEl.value));
  synth.setParam('release', Number(releaseEl.value));
  synth.setParam('detune', Number(detuneEl.value));
  synth.setParam('vibrato', Number(vibratoEl.value));
  refreshKnobValues();
};

pushAllParams();

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  persist();
});

waveformEl.addEventListener('change', () => {
  synth.setParam('waveform', waveformEl.value);
  persist();
});

const knobChanged = () => {
  pushAllParams();
  persist();
};

[cutoffEl, resoEl, attackEl, releaseEl, detuneEl, vibratoEl].forEach((el) => {
  el.addEventListener('input', knobChanged);
});

document.querySelectorAll('.preset-buttons button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    waveformEl.value = preset.waveform;
    cutoffEl.value = String(preset.cutoff);
    resoEl.value = String(preset.resonance);
    attackEl.value = String(preset.attack);
    releaseEl.value = String(preset.release);
    detuneEl.value = String(preset.detune);
    vibratoEl.value = String(preset.vibrato);
    pushAllParams();
    document
      .querySelectorAll('.preset-buttons button')
      .forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    persist();
  });
});

sustainEl.addEventListener('change', () => {
  keyboard.setSustain(sustainEl.checked);
});

rangeEl.addEventListener('change', () => {
  whiteKeyCount = Number(rangeEl.value) * 7;
  keyboard.setWhiteKeyCount(whiteKeyCount);
  persist();
});

const shiftOctave = (direction) => {
  const next = startMidi + direction * 12;
  if (next < 24 || next > 96) return;
  startMidi = next;
  keyboard.setStartMidi(startMidi);
  updateOctaveDisplay();
  persist();
};

octaveDownBtn.addEventListener('click', () => shiftOctave(-1));
octaveUpBtn.addEventListener('click', () => shiftOctave(+1));

attachKeyboardInput({
  keyboard,
  synth,
  sustainEl,
  announceNote,
  shiftOctave
});

setupMidi({
  statusEl: midiStatusEl,
  onNoteOn: (note) => {
    synth.noteOn(note);
    keyboard.pressVisual(note, true);
    announceNote(note);
  },
  onNoteOff: (note) => {
    synth.noteOff(note);
    keyboard.pressVisual(note, false);
  }
});
