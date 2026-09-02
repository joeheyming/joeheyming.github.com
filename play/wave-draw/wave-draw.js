import {
  midiToFreq,
  midiToName,
  getCtx,
  getMaster,
  setMasterVolume,
  resumeIfSuspended
} from '../shared/audio.js';
import { Keyboard } from '../shared/keyboard.js';
import { setupMidi } from '../shared/midi.js';
import { makePrefs } from '../shared/prefs.js';
import { attachKeyboardInput } from '../shared/input.js';
import { fillPreset, paintLine, samplesToFourier, TABLE_SIZE } from './wave-table.js';

const Prefs = makePrefs('play.wave-draw.prefs.v1');

class WavetableSynth {
  constructor() {
    this.samples = fillPreset('sine');
    this.voices = new Map();
    this.wave = null;
  }

  rebuildWave() {
    const ctx = getCtx();
    const { real, imag } = samplesToFourier(this.samples);
    this.wave = ctx.createPeriodicWave(real, imag);
    for (const voice of this.voices.values()) {
      voice.osc.setPeriodicWave(this.wave);
    }
  }

  noteOn(midi) {
    const ctx = getCtx();
    resumeIfSuspended();
    if (this.voices.has(midi)) this.noteOff(midi, true);
    if (!this.wave) this.rebuildWave();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.value = midiToFreq(midi);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(0.55, now + 0.01);
    osc.connect(amp);
    amp.connect(getMaster());
    osc.start(now);
    this.voices.set(midi, { osc, amp });
  }

  noteOff(midi, instant = false) {
    const voice = this.voices.get(midi);
    if (!voice) return;
    this.voices.delete(midi);
    const ctx = getCtx();
    const now = ctx.currentTime;
    const releaseTime = instant ? 0.02 : 0.18;
    try {
      voice.amp.gain.cancelScheduledValues(now);
      voice.amp.gain.setValueAtTime(Math.max(0.0001, voice.amp.gain.value), now);
      voice.amp.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
    } catch {
      /* ignore */
    }
    voice.osc.stop(now + releaseTime + 0.05);
  }

  allOff() {
    for (const midi of Array.from(this.voices.keys())) this.noteOff(midi, true);
  }
}

const canvas = document.getElementById('wave-canvas');
const keyboardEl = document.getElementById('piano-keyboard');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const sustainEl = document.getElementById('sustain');
const octaveDownBtn = document.getElementById('octave-down');
const octaveUpBtn = document.getElementById('octave-up');
const octaveDisplay = document.getElementById('octave-display');
const midiStatusEl = document.getElementById('midi-status');

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);

const synth = new WavetableSynth();
if (Array.isArray(prefs.samples) && prefs.samples.length === TABLE_SIZE) {
  synth.samples = Float32Array.from(prefs.samples);
}
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
  whiteKeyCount: 14,
  synth,
  onActivity: announceNote
});
updateOctaveDisplay();

const persist = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    startMidi,
    samples: Array.from(synth.samples)
  });
};

const ctx2d = canvas.getContext('2d');

function sizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function drawTable() {
  const width = canvas.width;
  const height = canvas.height;
  ctx2d.clearRect(0, 0, width, height);
  ctx2d.fillStyle =
    getComputedStyle(document.documentElement).getPropertyValue('--pure-black').trim() || '#111';
  ctx2d.fillRect(0, 0, width, height);

  ctx2d.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(0, height / 2);
  ctx2d.lineTo(width, height / 2);
  ctx2d.stroke();

  const n = synth.samples.length;
  ctx2d.beginPath();
  ctx2d.strokeStyle =
    getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() ||
    '#34a853';
  ctx2d.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * width;
    const y = ((1 - synth.samples[i]) / 2) * height;
    if (i === 0) ctx2d.moveTo(x, y);
    else ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();
}

function pointerToTable(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = 1 - (event.clientY - rect.top) / rect.height;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y * 2 - 1))
  };
}

let drawing = false;
let lastPt = null;

function applyDraw(event) {
  const pt = pointerToTable(event);
  if (lastPt) paintLine(synth.samples, lastPt.x, lastPt.y, pt.x, pt.y);
  else paintLine(synth.samples, pt.x, pt.y, pt.x, pt.y);
  lastPt = pt;
  synth.rebuildWave();
  drawTable();
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  drawing = true;
  lastPt = null;
  applyDraw(event);
});
canvas.addEventListener('pointermove', (event) => {
  if (!drawing) return;
  applyDraw(event);
});
const endDraw = (event) => {
  if (!drawing) return;
  drawing = false;
  lastPt = null;
  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
  persist();
};
canvas.addEventListener('pointerup', endDraw);
canvas.addEventListener('pointercancel', endDraw);

document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    synth.samples = fillPreset(btn.dataset.preset);
    synth.rebuildWave();
    drawTable();
    persist();
  });
});

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  persist();
});

sustainEl.addEventListener('change', () => {
  keyboard.setSustain(sustainEl.checked);
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

sizeCanvas();
drawTable();
window.addEventListener('resize', () => {
  sizeCanvas();
  drawTable();
});
