/**
 * Piano page: free-play instrument page. The synth itself (multi-sampler
 * + soundfont + oscillator fallback) lives in `play/shared/piano-synth.js`
 * so the same code powers `/piano-hero/`.
 */
import { midiToName, setMasterVolume } from '../shared/audio.js';
import { Keyboard } from '../shared/keyboard.js';
import { setupMidi } from '../shared/midi.js';
import { makePrefs } from '../shared/prefs.js';
import { attachKeyboardInput } from '../shared/input.js';
import { PianoSynth } from '../shared/piano-synth.js';

// ---------- Page wiring ----------

const Prefs = makePrefs('play.piano.prefs.v1');

const keyboardEl = document.getElementById('piano-keyboard');
const stageEl = document.querySelector('.piano-stage');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const waveformEl = document.getElementById('waveform');
const sustainEl = document.getElementById('sustain');
const showNotesEl = document.getElementById('show-notes');
const showKbdEl = document.getElementById('show-kbd');
const layoutEl = document.getElementById('layout');
const toneStatus = document.getElementById('tone-status');
const midiStatusEl = document.getElementById('midi-status');
const octaveDownBtn = document.getElementById('octave-down');
const octaveUpBtn = document.getElementById('octave-up');
const octaveDisplay = document.getElementById('octave-display');

// Phone-class viewports get a smaller default layout. Stuffing 49 keys
// into 390 px crushes each white key to ~10 px wide — well below tap-
// target guidelines. 37 keys (C3–C6) covers the playable melodic range
// at a reasonable density and is what users likely want on their first
// visit. Saved prefs always win so this only kicks in for fresh users.
const isPhoneViewport = () => window.matchMedia('(max-width: 480px), (max-height: 480px)').matches;

// Tag the body so CSS can hide desktop-only affordances (e.g. the
// "(hold space)" hint next to Sustain) when the user is on a touch
// device with no physical keyboard.
const isTouchDevice = () => 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
if (isTouchDevice()) document.body.classList.add('is-touch');

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.tone === 'string') {
  const opt = Array.from(waveformEl.options).find((o) => o.value === prefs.tone);
  if (opt) waveformEl.value = prefs.tone;
}
if (typeof prefs.layout === 'string') {
  const opt = Array.from(layoutEl.options).find((o) => o.value === prefs.layout);
  if (opt) layoutEl.value = prefs.layout;
} else if (isPhoneViewport()) {
  layoutEl.value = '37';
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
let { startMidi: baseStartMidi, whiteKeyCount } = layoutFor();

// Octave shift: a user-controlled offset (in semitones, multiples of 12)
// applied on top of the layout's default startMidi. Lets touch users
// pick a small layout for big tap targets and still reach the full
// piano range via the +/- buttons. Resets to 0 whenever the layout
// changes (a new layout is treated as a fresh window). Restored from
// prefs on load so refresh keeps you in the same octave.
let octaveOffset = Number.isInteger(prefs.octaveOffset) ? prefs.octaveOffset : 0;

const layoutEndMidi = () => baseStartMidi + Math.ceil(whiteKeyCount * (12 / 7)) - 1;
const clampOctaveOffset = (offset) => {
  // Keep the visible window inside the standard MIDI range (0..127).
  const minOffset = Math.ceil((0 - baseStartMidi) / 12);
  const maxOffset = Math.floor((127 - layoutEndMidi()) / 12);
  return Math.max(minOffset, Math.min(maxOffset, offset));
};
octaveOffset = clampOctaveOffset(octaveOffset);
let startMidi = baseStartMidi + octaveOffset * 12;

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
    octaveOffset,
    showNotes: showNotesEl.checked,
    showKbd: showKbdEl.checked
  });
};

const updateOctaveDisplay = () => {
  if (!octaveDisplay) return;
  octaveDisplay.textContent = midiToName(startMidi);
  if (octaveDownBtn) octaveDownBtn.disabled = clampOctaveOffset(octaveOffset - 1) === octaveOffset;
  if (octaveUpBtn) octaveUpBtn.disabled = clampOctaveOffset(octaveOffset + 1) === octaveOffset;
};
updateOctaveDisplay();

const shiftOctave = (direction) => {
  const next = clampOctaveOffset(octaveOffset + direction);
  if (next === octaveOffset) return;
  octaveOffset = next;
  startMidi = baseStartMidi + octaveOffset * 12;
  piano.setStartMidi(startMidi);
  updateOctaveDisplay();
  // Reset horizontal scroll so the new visible window starts at the
  // left edge — without this, switching octaves on a horizontally-
  // scrolled phone keyboard leaves the user looking at the wrong notes.
  if (stageEl) stageEl.scrollLeft = 0;
  persist();
};

if (octaveDownBtn) octaveDownBtn.addEventListener('click', () => shiftOctave(-1));
if (octaveUpBtn) octaveUpBtn.addEventListener('click', () => shiftOctave(+1));

const updateToneStatus = () => {
  if (!toneStatus) return;
  if (synth.isMultiSampleTone(waveformEl.value)) {
    if (synth.multiSamplerStatus === 'error') toneStatus.textContent = 'offline · synth fallback';
    else if (synth.multiSamplerStatus === 'ready') toneStatus.textContent = '';
    else toneStatus.textContent = 'loading…';
    return;
  }
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
  if (synth.isMultiSampleTone(waveformEl.value)) {
    synth.ensureMultiSamplerLoaded().then(updateToneStatus);
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
  baseStartMidi = cfg.startMidi;
  whiteKeyCount = cfg.whiteKeyCount;
  octaveOffset = 0;
  startMidi = baseStartMidi;
  piano.setStartMidi(startMidi);
  piano.setWhiteKeyCount(whiteKeyCount);
  updateOctaveDisplay();
  if (stageEl) stageEl.scrollLeft = 0;
  persist();
});

// Pre-warm sample instrument on first user interaction.
if (synth.isSampleTone(waveformEl.value) || synth.isMultiSampleTone(waveformEl.value)) {
  const warm = () => {
    if (synth.isSampleTone(waveformEl.value)) {
      synth.ensureSampleLoaded(waveformEl.value).then(updateToneStatus);
    }
    if (synth.isMultiSampleTone(waveformEl.value)) {
      synth.ensureMultiSamplerLoaded().then(updateToneStatus);
    }
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
  shiftOctave
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
