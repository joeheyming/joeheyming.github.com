/**
 * Theremin / XY pad page entry. Wires DOM → prefs → audio voice →
 * input modes (touch + air). Each subsystem lives in its own file:
 *
 *   scale.js       — pitch/scale math (DOM-free, pure)
 *   voice.js       — Web Audio voice (osc / amp / vibrato chain)
 *   grid.js        — chromatic-step grid renderer
 *   touch-input.js — pointer / mouse / pen handlers
 *   air-input.js   — front-camera + MediaPipe Hands tracking
 *   paint.js       — fingertip rainbow trail (optional)
 *
 * This file owns only the cross-cutting concerns: control bindings
 * (volume, waveform, scale, root, range, glide, mode, paint), pref
 * persistence, the now-playing announcement, and mode switching.
 *
 * Mode switching: touch is always wired and gates itself on the
 * current mode at fire-time; air is enter()ed / exit()ed imperatively
 * when the mode changes so the camera + WASM aren't loaded for users
 * who never pick air mode.
 *
 * Tip routing: both inputs publish their primary fingertip via a
 * shared `setCurrentTip` callback so paint (and any future tip-
 * following effect) doesn't need to know which input mode is active.
 */
import { setMasterVolume, midiToName, resumeIfSuspended } from '../shared/audio.js';
import { makePrefs } from '../shared/prefs.js';
import { SCALES } from './scale.js';
import {
  setWaveform,
  onMidi,
  fadeOutVoice,
  clearVibrato
} from './voice.js';
import { renderGrid } from './grid.js';
import { initTouchInput } from './touch-input.js';
import { initAirInput } from './air-input.js';
import { initRecorder } from './recorder.js';
import { initPaint } from './paint.js';

const Prefs = makePrefs('play.theremin.prefs.v1');

// ---------- DOM refs ----------

const padEl = document.getElementById('theremin-pad');
const gridEl = document.getElementById('theremin-grid');
const hintEl = document.getElementById('theremin-hint');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const waveformEl = document.getElementById('waveform');
const scaleEl = document.getElementById('scale');
const rootEl = document.getElementById('root');
const rangeEl = document.getElementById('range');
const glideEl = document.getElementById('glide');
const paintEl = document.getElementById('paint');
const modeEl = document.getElementById('mode');
const videoEl = document.getElementById('theremin-video');
const overlayEl = document.getElementById('theremin-overlay');
const airCardEl = document.getElementById('theremin-air-card');
const airCardTitleEl = document.getElementById('theremin-air-card-title');
const airCardMessageEl = document.getElementById('theremin-air-card-message');
const airStartBtn = document.getElementById('theremin-air-start');
const record10Btn = document.getElementById('record-10');
const record30Btn = document.getElementById('record-30');
const recordMicEl = document.getElementById('record-mic');
const recordModalEl = document.getElementById('theremin-record-modal');
const recordModalBackdropEl = document.getElementById('theremin-record-modal-backdrop');
const recordPreviewEl = document.getElementById('theremin-record-preview');
const recordShareBtn = document.getElementById('theremin-record-share');
const recordPostBtn = document.getElementById('theremin-record-post');
const recordDownloadBtn = document.getElementById('theremin-record-download');
const recordDiscardBtn = document.getElementById('theremin-record-discard');
const recordStatusEl = document.getElementById('theremin-record-status');

// ---------- Restore prefs ----------

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.waveform === 'string') {
  const opt = Array.from(waveformEl.options).find((o) => o.value === prefs.waveform);
  if (opt) waveformEl.value = prefs.waveform;
}
if (typeof prefs.scale === 'string' && prefs.scale in SCALES) scaleEl.value = prefs.scale;
if (typeof prefs.root === 'string') {
  const opt = Array.from(rootEl.options).find((o) => o.value === prefs.root);
  if (opt) rootEl.value = prefs.root;
}
if (typeof prefs.range === 'string') {
  const opt = Array.from(rangeEl.options).find((o) => o.value === prefs.range);
  if (opt) rangeEl.value = prefs.range;
}
if (typeof prefs.glide === 'number') glideEl.value = String(prefs.glide);
if (typeof prefs.paint === 'boolean') paintEl.checked = prefs.paint;
// Voice/mic recording defaults ON for new users — recordings tend to
// feel flat without ambient narration. Existing users who turned it
// off see their saved choice respected. The actual mic permission
// is only requested on the first Record click with the box checked,
// not at page load.
if (typeof prefs.recordMic === 'boolean') recordMicEl.checked = prefs.recordMic;
// Mode is restored at the bottom of this file — *after* every
// subsystem (voice, inputs, recorder) is wired — so air-mode entry
// can prompt for camera permission against a fully-initialized page.

setMasterVolume(Number(volumeEl.value) / 100);
setWaveform(waveformEl.value);

const savePrefs = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    waveform: waveformEl.value,
    scale: scaleEl.value,
    root: rootEl.value,
    range: rangeEl.value,
    glide: Number(glideEl.value),
    paint: paintEl.checked,
    recordMic: recordMicEl.checked,
    mode: modeEl.value
  });
};

// ---------- Live config snapshot ----------
//
// Inputs call this on every move so live <select> changes apply
// without us having to plumb change events through every module.

const getCfg = () => ({
  scale: scaleEl.value,
  root: Number(rootEl.value),
  range: Number(rangeEl.value),
  glideMs: Number(glideEl.value)
});

// ---------- Now-playing announcer ----------
//
// Voice fires `onMidi` whenever applyPrimary runs, regardless of
// which input source triggered it. We render to the header here so
// the input modules don't need to know about UI elements.

let nowPlayingTimer = null;
onMidi((midi) => {
  nowPlaying.textContent = midiToName(Math.round(midi));
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    nowPlaying.classList.remove('active');
  }, 350);
});

// ---------- Grid ----------

const renderCurrentGrid = () =>
  renderGrid(gridEl, { root: Number(rootEl.value), range: Number(rangeEl.value) });

renderCurrentGrid();

// ---------- Inputs ----------

let mode = 'touch';
const getMode = () => mode;

// Shared "input gate" — flipped on by the recorder while its preview
// modal is open so the live theremin doesn't keep playing behind it
// (and double up against the preview <video>'s own audio). Touch input
// reads it on each pointer event; air input reads it once per detect
// frame and short-circuits both audio and overlay updates.
let inputsSuspended = false;
const getInputsSuspended = () => inputsSuspended;

// Active fingertip — whichever input is the active source publishes
// its primary tip here so pad-overlaying effects (paint trail today,
// potentially others later) can read it without caring about mode.
// Stays null when no input is held, when the modal is up, or when
// air-mode loses sight of the hand for more than the grace window.
let currentTip = null;
const getCurrentTip = () => currentTip;
const setCurrentTip = (tip) => {
  currentTip = tip;
};

const touchInput = initTouchInput({
  padEl,
  getCfg,
  getMode,
  getInputsSuspended,
  setTip: setCurrentTip
});
const airInput = initAirInput({
  padEl,
  videoEl,
  overlayEl,
  airCardEl,
  airCardTitleEl,
  airCardMessageEl,
  airStartBtn,
  getCfg,
  getInputsSuspended,
  setTip: setCurrentTip
});

// Paint trail — owns its own canvas inserted into the pad. Reads the
// current tip + checkbox state every frame; nothing to bind to a
// specific input mode.
const paint = initPaint({
  padEl,
  isEnabled: () => paintEl.checked,
  getTip: getCurrentTip
});

const setInputsSuspended = (v) => {
  if (inputsSuspended === v) return;
  inputsSuspended = v;
  if (v) {
    // Drop any held touch pointers + fade the voice the moment the
    // suspend flips on, so there's no held drone behind the modal.
    touchInput.releaseAll();
    fadeOutVoice();
    clearVibrato();
    // Also drop the tip so the paint trail stops drawing while the
    // preview modal is up — touchInput.releaseAll() already nulls
    // it for touch mode, but air mode publishes from its own loop.
    setCurrentTip(null);
  }
};

initRecorder({
  recordButtons: [
    { el: record10Btn, durationSec: 10 },
    { el: record30Btn, durationSec: 30 }
  ],
  modalEl: recordModalEl,
  videoPreviewEl: recordPreviewEl,
  shareBtn: recordShareBtn,
  postBtn: recordPostBtn,
  downloadBtn: recordDownloadBtn,
  discardBtn: recordDiscardBtn,
  backdropEl: recordModalBackdropEl,
  videoEl,
  overlayEl,
  paintEl: paint.canvas,
  micEl: recordMicEl,
  shareStatusEl: recordStatusEl,
  getCfg,
  onPreviewToggle: setInputsSuspended
});

const setMode = (next) => {
  if (next === mode) return;
  if (mode === 'air') airInput.exit();
  mode = next;
  modeEl.value = next;
  if (mode === 'air') {
    // Drop any held touch voice from the previous mode so the air-
    // mode camera owns the voice cleanly.
    touchInput.releaseAll();
    fadeOutVoice();
    clearVibrato();
    airInput.enter();
  }
  savePrefs();
};

// We intentionally leave the Air option enabled even when
// `navigator.mediaDevices` is missing — picking it routes through
// air-input's `unavailable` state, which renders an actionable
// diagnostic instead of silently disabling the option with no
// explanation.

modeEl.addEventListener('change', () => {
  setMode(modeEl.value);
});

// ---------- Controls ----------

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  savePrefs();
});

waveformEl.addEventListener('change', () => {
  setWaveform(waveformEl.value);
  savePrefs();
});

scaleEl.addEventListener('change', () => {
  // No re-render needed (grid is chromatic regardless), and live
  // moves re-snap immediately because applyPrimary reads cfg.scale
  // from getCfg() on every update.
  savePrefs();
});

rootEl.addEventListener('change', () => {
  renderCurrentGrid();
  savePrefs();
});

rangeEl.addEventListener('change', () => {
  renderCurrentGrid();
  savePrefs();
});

glideEl.addEventListener('input', () => {
  savePrefs();
});

paintEl.addEventListener('change', () => {
  // Toggling paint off doesn't clear the canvas — particles fade out
  // naturally over a few seconds. If the user wants an immediate wipe
  // they can just toggle off-and-on again, or wait. Keeps the UI
  // simple and rewards experimentation (turning paint off mid-stroke
  // freezes a snapshot of the trail until it fades).
  savePrefs();
});

recordMicEl.addEventListener('change', () => {
  // recorder.js owns the mic stream lifecycle; we just persist the
  // user's preference. Note: recorder.js also dispatches a synthetic
  // 'change' event after a permission denial to flip this off, which
  // is exactly what we want — denied state is saved like a manual
  // un-tick so reloads don't immediately re-prompt.
  savePrefs();
});

// ---------- Hint ----------
//
// Fade the centre hint after first activity for the rest of the
// session — no flicker on every release.

let hintHidden = false;
const observer = new MutationObserver(() => {
  if (hintHidden) return;
  if (padEl.classList.contains('is-active')) {
    hintEl.style.opacity = '0';
    hintHidden = true;
    observer.disconnect();
  }
});
observer.observe(padEl, { attributes: true, attributeFilter: ['class'] });

window.addEventListener('focus', () => resumeIfSuspended());

// Re-render the grid on resize so the percentage-based labels still
// align with crisp pixel positions on rotation.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCurrentGrid, 120);
});

// ---------- Mode boot ----------
//
// Restore the last-used mode now that every subsystem is wired. Air
// mode just routes through `enter()` → 'prompt' state, which paints
// the "Allow camera" card; if the browser already remembers the
// permission grant, one tap (or zero, on some platforms) gets the
// user back where they were last session. We deliberately drive this
// through `setMode` so the side-effects (fading any held voice,
// updating the <select>, persisting prefs) all run normally.
if (typeof prefs.mode === 'string' && prefs.mode !== mode) {
  modeEl.value = prefs.mode;
  setMode(prefs.mode);
}
