// Piano Hero — boot entry point.
//
// Order matters:
//   1. Register every custom element (their files self-register on import).
//   2. Initialize the keyboard component (reused from /play/shared/).
//   3. Initialize the engine (canvas + synth).
//   4. Wire drag-drop, file-picker, play-along input, and song-browser.
//   5. Wire MidiManager events → loading-overlay UI.
//   6. Wire engine events → score-panel / game-over-modal.
//   7. Wire toolbar controls → game-state mutators.
//   8. Restore persisted prefs.

import { setMasterVolume } from '/play/shared/audio.js';
import { Keyboard } from '/play/shared/keyboard.js';
import { makePrefs } from '/play/shared/prefs.js';
import { PianoSynth } from '/play/shared/piano-synth.js';

import gameState from './game-state.js';
import clock from './clock.js';
import midiManager from './midi-manager.js';
import engine from './engine.js';
import { attachDropTarget, attachFilePicker } from './file-loader.js';
import { attachPlayAlongInput } from './play-along-input.js';

// Custom elements — importing for side-effects (customElements.define).
import './loading-overlay.js';
import './score-panel.js';
import './game-over-modal.js';
import './ia-browser.js';

const Prefs = makePrefs('piano-hero.prefs.v1');

// ---------- DOM lookups ---------------------------------------------------

const keyboardEl = document.getElementById('piano-keyboard');
const canvasEl = document.getElementById('note-stage');
const nowPlaying = document.getElementById('now-playing');
const midiStatusEl = document.getElementById('midi-status');

const openSongBrowserBtn = document.getElementById('open-song-browser');
const modeSelect = document.getElementById('mode');
const tempoSlider = document.getElementById('tempo');
const tempoDisplay = document.getElementById('tempo-display');
const handLeftEl = document.getElementById('hand-left');
const handRightEl = document.getElementById('hand-right');
const playPauseBtn = document.getElementById('play-pause');
const playPauseLabel = document.getElementById('play-pause-label');
const restartBtn = document.getElementById('restart');
const volumeEl = document.getElementById('volume');

const filePickerInput = document.getElementById('file-picker-input');

const loadingOverlay = document.getElementById('loading-overlay');
const scorePanel = document.getElementById('score-panel');
const gameOverModal = document.getElementById('game-over');
const songBrowser = document.getElementById('song-browser');

// ---------- Keyboard --------------------------------------------------------

// 61-key C2..C7 layout — the standard "Yamaha PSR-E / Keystation 61"
// range, wide enough that virtually every classical piano MIDI's notes
// land somewhere on the visible keyboard (Rondo alla Turca's A6, the
// high treble of Fantaisie-Impromptu, etc.). Crucially, `kbdBase`
// decouples the QWERTY anchor from the leftmost visible key: the
// keyboard *shows* C2..C7, but pressing `z` plays C3 (so the bottom-row
// QWERTY whites land on the C3 octave where most melodies live). The
// on-key QWERTY labels (rendered because we toggle `.show-kbd` below)
// follow the kbdBase, so the letters appear on the exact keys they
// trigger — no hidden mapping for the player to memorize.
const KEYBOARD_START_MIDI = 36; // C2 — leftmost visible key
const KEYBOARD_WHITE_KEYS = 36; // C2..C7 (5 octaves, 36 white keys)
const KEYBOARD_KBD_BASE = 48; // C3 — QWERTY `z` plays this note

// Free-play synth that the on-screen keyboard mouse/touch input drives.
// Separate from the engine's synth so a stray click doesn't fight the
// auto-play scheduler — but uses the same PianoSynth class so timbre is
// identical.
const playSynth = new PianoSynth();
playSynth.setTone('grand_piano_samples');

const keyboard = new Keyboard(keyboardEl, {
  startMidi: KEYBOARD_START_MIDI,
  whiteKeyCount: KEYBOARD_WHITE_KEYS,
  kbdBase: KEYBOARD_KBD_BASE,
  synth: playSynth,
  onActivity: (midi) => {
    if (gameState.mode === 'play-along' && gameState.status === 'playing') {
      // Free-play taps in play-along mode also count as input — judge them.
      const t = clock.now();
      engine.reportInput(midi, t);
    }
  }
});

// Always show the QWERTY letters on each key so first-time players can
// see the mapping at a glance — the wider visible range (C2..C6) makes
// muscle-memory hard otherwise.
keyboardEl.classList.add('show-kbd');

// ---------- Engine init -----------------------------------------------------

engine.init({ canvas: canvasEl, keyEls: keyboard.keyEls });

// ---------- File-loading entry points ---------------------------------------

const showError = (msg) => {
  loadingOverlay.setState('error', { title: 'Could not load MIDI', message: msg });
};

attachDropTarget({ onError: showError });
attachFilePicker(filePickerInput, { onError: showError });

// ---------- Play-along input ------------------------------------------------

attachPlayAlongInput({
  onPress: (midi, songTime) => engine.reportInput(midi, songTime),
  midiStatusEl,
  synth: playSynth,
  // Pass the Keyboard so QWERTY / Web MIDI presses light up the matching
  // on-screen key — same affordance as the free-play /play/piano page.
  keyboard
});

// ---------- Song browser ----------------------------------------------------

if (typeof songBrowser.setOnError === 'function') {
  songBrowser.setOnError(showError);
}
openSongBrowserBtn.addEventListener('click', () => songBrowser.open());

// ---------- MidiManager → loading overlay ----------------------------------

midiManager.on('loadStart', ({ label }) => {
  loadingOverlay.setState('loading', {
    title: 'Loading MIDI',
    message: label || '',
    progress: 0
  });
});
midiManager.on('loadProgress', ({ fraction }) => {
  loadingOverlay.setProgress(fraction);
});
midiManager.on('loadError', ({ error }) => {
  loadingOverlay.setState('error', {
    title: 'Could not load MIDI',
    message: (error && error.message) || 'Unknown error'
  });
});
midiManager.on('songChanged', ({ chart }) => {
  loadingOverlay.setState('ready', { title: 'Loaded', message: chart.title });
  gameState.setChart(chart, midiManager.getCurrent().key, chart.title);
  engine.loadChart();
  engine.applyTempo();
  updateNowPlaying();
  updateTransportButtons();
  // Auto-play a freshly loaded song so dropping a file is satisfying.
  engine.play();
  updateTransportButtons();
});

// ---------- Engine events → HUD --------------------------------------------

engine.on('judgment', () => {
  if (gameState.mode === 'play-along') updateScorePanel();
});

engine.on('gameOver', ({ tapNoteScores, totalNotes, maxCombo, mode }) => {
  if (mode !== 'play-along') return; // No score in Watch mode
  gameOverModal.setHandlers({
    onRetry: () => engine.restart(),
    onPickAnother: () => songBrowser.open()
  });
  gameOverModal.show({
    tapNoteScores,
    totalNotes,
    maxCombo,
    songLabel: gameState.currentSongLabel
  });
});

// ---------- GameState changes → UI bindings --------------------------------

gameState.on(() => {
  updateNowPlaying();
  updateTransportButtons();
  updateScorePanel();
  updateScorePanelVisibility();
});

function updateNowPlaying() {
  if (!gameState.chart) {
    nowPlaying.textContent = 'No song';
    nowPlaying.classList.remove('active');
    return;
  }
  nowPlaying.textContent = gameState.currentSongLabel || gameState.chart.title || 'Untitled';
  nowPlaying.classList.toggle('active', gameState.status === 'playing');
}

function updateTransportButtons() {
  const hasChart = !!gameState.chart;
  playPauseBtn.disabled = !hasChart;
  restartBtn.disabled = !hasChart;
  if (gameState.status === 'playing') {
    playPauseLabel.textContent = 'Pause';
  } else if (gameState.status === 'finished') {
    playPauseLabel.textContent = 'Play again';
  } else {
    playPauseLabel.textContent = 'Play';
  }
}

function updateScorePanelVisibility() {
  // Show during play-along, regardless of running/paused — players want
  // to see their tally between attempts.
  scorePanel.hidden = gameState.mode !== 'play-along' || !gameState.chart;
}

function updateScorePanel() {
  if (scorePanel.hidden) return;
  const totalNotes = (gameState.chart && gameState.chart.notes.length) || 0;
  scorePanel.update({
    tapNoteScores: gameState.tapNoteScores,
    totalNotes,
    combo: gameState.combo,
    maxCombo: gameState.maxCombo
  });
}

// ---------- Toolbar controls ------------------------------------------------

modeSelect.addEventListener('change', () => {
  gameState.setMode(modeSelect.value);
  engine.loadChart();
  if (gameState.chart) engine.play();
  persist();
});

tempoSlider.addEventListener('input', () => {
  const pct = Number(tempoSlider.value);
  gameState.setTempo(pct / 100);
  engine.applyTempo();
  tempoDisplay.textContent = `${pct}%`;
  persist();
});

const refreshHandsAndPlay = () => {
  gameState.setHandActive('left', handLeftEl.checked);
  gameState.setHandActive('right', handRightEl.checked);
  engine.refreshHandsFilter();
  persist();
};
handLeftEl.addEventListener('change', refreshHandsAndPlay);
handRightEl.addEventListener('change', refreshHandsAndPlay);

playPauseBtn.addEventListener('click', () => {
  if (!gameState.chart) return;
  if (gameState.status === 'playing') {
    engine.pause();
  } else {
    engine.play();
  }
});

restartBtn.addEventListener('click', () => {
  if (!gameState.chart) return;
  engine.restart();
});

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  persist();
});

// ---------- Prefs -----------------------------------------------------------

function persist() {
  Prefs.save({
    volume: Number(volumeEl.value),
    mode: modeSelect.value,
    tempo: Number(tempoSlider.value),
    handLeft: handLeftEl.checked,
    handRight: handRightEl.checked
  });
}

(function applyPrefs() {
  const prefs = Prefs.load() || {};
  if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
  if (typeof prefs.tempo === 'number') {
    tempoSlider.value = String(prefs.tempo);
    tempoDisplay.textContent = `${prefs.tempo}%`;
  }
  if (typeof prefs.mode === 'string') modeSelect.value = prefs.mode;
  if (typeof prefs.handLeft === 'boolean') handLeftEl.checked = prefs.handLeft;
  if (typeof prefs.handRight === 'boolean') handRightEl.checked = prefs.handRight;
  setMasterVolume(Number(volumeEl.value) / 100);
  gameState.setMode(modeSelect.value);
  gameState.setTempo(Number(tempoSlider.value) / 100);
  gameState.setHandActive('left', handLeftEl.checked);
  gameState.setHandActive('right', handRightEl.checked);
  engine.applyTempo();
})();

// Initial UI sync.
updateNowPlaying();
updateTransportButtons();
updateScorePanelVisibility();

// Pre-warm the multi-sampler on first user interaction. Same pattern as
// /play/piano/piano.js so the first note doesn't fall through to the
// oscillator fallback.
const warm = () => {
  playSynth.ensureMultiSamplerLoaded();
  document.removeEventListener('pointerdown', warm);
  document.removeEventListener('keydown', warm);
};
document.addEventListener('pointerdown', warm, { once: true });
document.addEventListener('keydown', warm, { once: true });
