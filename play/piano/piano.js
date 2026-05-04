/**
 * Piano page: a hybrid synth that uses sample-based soundfont instruments
 * (acoustic / electric piano) by default, with a built-in oscillator engine
 * for retro waveform tones. Wraps the shared `Keyboard` renderer.
 */
import {
  midiToFreq,
  midiToName,
  getCtx,
  getMaster,
  resumeIfSuspended,
  setMasterVolume,
  loadInstrument
} from '../shared/audio.js';
import { Keyboard } from '../shared/keyboard.js';
import { setupMidi } from '../shared/midi.js';
import { makePrefs } from '../shared/prefs.js';
import { attachKeyboardInput } from '../shared/input.js';

const SAMPLE_TONES = new Set(['acoustic_grand_piano', 'electric_piano_1']);
const OSCILLATOR_TONES = new Set(['sine', 'square', 'triangle', 'sawtooth']);

class PianoSynth {
  constructor() {
    this.tone = 'acoustic_grand_piano';
    this.voices = new Map(); // midi -> { osc, osc2, gain } (oscillator-mode only)
    this.samplePlayers = new Map(); // tone -> { instrument, playing: Map<midi, node> }
  }

  isSampleTone(tone) {
    return SAMPLE_TONES.has(tone);
  }

  setTone(tone) {
    this.tone = tone;
    if (this.isSampleTone(tone)) {
      this.ensureSampleLoaded(tone);
    }
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

  getOrCreateSamplePlayer(tone) {
    let player = this.samplePlayers.get(tone);
    if (!player) {
      player = { instrument: null, loadingPromise: null, playing: new Map() };
      this.samplePlayers.set(tone, player);
    }
    return player;
  }

  isReady(tone = this.tone) {
    if (!this.isSampleTone(tone)) return true;
    return !!this.samplePlayers.get(tone)?.instrument;
  }

  noteOn(midi) {
    getCtx();
    resumeIfSuspended();

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

    this.oscNoteOn(midi);
  }

  noteOff(midi, instant = false) {
    // Stop sample voice (if any) for this midi across any tone.
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

  oscNoteOn(midi) {
    if (this.voices.has(midi)) this.oscNoteOff(midi, true);

    const ctx = getCtx();
    const master = getMaster();
    const now = ctx.currentTime;
    const freq = midiToFreq(midi);

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
    gain.gain.linearRampToValueAtTime(0.6, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.25);

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

// ---------- Page wiring ----------

const Prefs = makePrefs('play.piano.prefs.v1');

const keyboardEl = document.getElementById('piano-keyboard');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const waveformEl = document.getElementById('waveform');
const sustainEl = document.getElementById('sustain');
const showNotesEl = document.getElementById('show-notes');
const showKbdEl = document.getElementById('show-kbd');
const layoutEl = document.getElementById('layout');
const toneStatus = document.getElementById('tone-status');
const midiStatusEl = document.getElementById('midi-status');

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.tone === 'string') {
  const opt = Array.from(waveformEl.options).find((o) => o.value === prefs.tone);
  if (opt) waveformEl.value = prefs.tone;
}
if (typeof prefs.layout === 'string') {
  const opt = Array.from(layoutEl.options).find((o) => o.value === prefs.layout);
  if (opt) layoutEl.value = prefs.layout;
}
// Default: pitch letters on, QWERTY off. Honour previously-stored prefs;
// fall back to the legacy `showLabels` flag for users with old saved state
// (it used to drive both at once).
if (typeof prefs.showNotes === 'boolean') {
  showNotesEl.checked = prefs.showNotes;
} else if (typeof prefs.showLabels === 'boolean') {
  showNotesEl.checked = prefs.showLabels;
}
if (typeof prefs.showKbd === 'boolean') showKbdEl.checked = prefs.showKbd;

const synth = new PianoSynth();
setMasterVolume(Number(volumeEl.value) / 100);
synth.setTone(waveformEl.value);

/**
 * Standard MIDI-controller and acoustic-piano sizes. Each entry pins a
 * specific note range and white-key count to a real instrument so the
 * Layout select snaps to authentic configurations rather than free-form
 * octave windows.
 *
 *   25-key C3–C5  (15 whites)  e.g. M-Audio Keystation Mini
 *   37-key C3–C6  (22 whites)  e.g. Akai LPK37
 *   49-key C2–C6  (29 whites)  e.g. Casio CT-S1, M-Audio Keystation 49
 *   61-key C2–C7  (36 whites)  e.g. Yamaha PSR-E series, MIDIPLUS X6
 *   76-key E1–G7  (45 whites)  e.g. Yamaha P-121
 *   88-key A0–C8  (52 whites)  full acoustic grand
 */
const PIANO_LAYOUTS = {
  25: { startMidi: 48, whiteKeyCount: 15 },
  37: { startMidi: 48, whiteKeyCount: 22 },
  49: { startMidi: 36, whiteKeyCount: 29 },
  61: { startMidi: 36, whiteKeyCount: 36 },
  76: { startMidi: 28, whiteKeyCount: 45 },
  88: { startMidi: 21, whiteKeyCount: 52 }
};

const layoutFor = () => PIANO_LAYOUTS[layoutEl.value] || PIANO_LAYOUTS[49];
let { startMidi, whiteKeyCount } = layoutFor();

const applyLabelClasses = () => {
  keyboardEl.classList.toggle('hide-notes', !showNotesEl.checked);
  keyboardEl.classList.toggle('show-kbd', showKbdEl.checked);
};
applyLabelClasses();

let nowPlayingTimer = null;
const announceNote = (midi) => {
  nowPlaying.textContent = midiToName(midi);
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    nowPlaying.classList.remove('active');
  }, 350);
};

const piano = new Keyboard(keyboardEl, {
  startMidi,
  whiteKeyCount,
  synth,
  onActivity: announceNote
});

const persist = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    tone: waveformEl.value,
    layout: layoutEl.value,
    showNotes: showNotesEl.checked,
    showKbd: showKbdEl.checked
  });
};

const updateToneStatus = () => {
  if (!toneStatus) return;
  if (!synth.isSampleTone(waveformEl.value)) {
    toneStatus.textContent = '';
    return;
  }
  toneStatus.textContent = synth.isReady() ? '' : 'loading…';
};

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  persist();
});

waveformEl.addEventListener('change', () => {
  synth.setTone(waveformEl.value);
  updateToneStatus();
  if (synth.isSampleTone(waveformEl.value)) {
    synth.ensureSampleLoaded(waveformEl.value).then(updateToneStatus);
  }
  persist();
});

sustainEl.addEventListener('change', () => {
  piano.setSustain(sustainEl.checked);
});

showNotesEl.addEventListener('change', () => {
  applyLabelClasses();
  persist();
});

showKbdEl.addEventListener('change', () => {
  applyLabelClasses();
  persist();
});

layoutEl.addEventListener('change', () => {
  const cfg = layoutFor();
  startMidi = cfg.startMidi;
  whiteKeyCount = cfg.whiteKeyCount;
  piano.setStartMidi(startMidi);
  piano.setWhiteKeyCount(whiteKeyCount);
  persist();
});

// Pre-warm sample instrument on first user interaction.
if (synth.isSampleTone(waveformEl.value)) {
  const warm = () => {
    synth.ensureSampleLoaded(waveformEl.value).then(updateToneStatus);
    document.removeEventListener('pointerdown', warm);
    document.removeEventListener('keydown', warm);
  };
  document.addEventListener('pointerdown', warm, { once: true });
  document.addEventListener('keydown', warm, { once: true });
  updateToneStatus();
}

attachKeyboardInput({
  keyboard: piano,
  synth,
  sustainEl,
  announceNote,
  shiftOctave: null
});

setupMidi({
  statusEl: midiStatusEl,
  onNoteOn: (note) => {
    synth.noteOn(note);
    piano.pressVisual(note, true);
    announceNote(note);
  },
  onNoteOff: (note) => {
    synth.noteOff(note);
    piano.pressVisual(note, false);
  }
});
