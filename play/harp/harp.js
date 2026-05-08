/**
 * Browser harp. Pure Web Audio plucked-string synthesis plus a swipe-strum
 * pointer surface.
 *
 * Voice: each pluck instantiates a small audio graph — triangle fundamental
 * mixed with a quieter octave-up sine for harp shimmer, fed through a
 * lowpass and an exponential decay envelope whose duration scales with
 * pitch (low strings ring longer, high strings decay quickly). The graph
 * is short-lived and self-disposes; no per-string state is kept across
 * plucks, which mirrors how a real harp behaves (strings ring out
 * naturally; the player doesn't damp them).
 *
 * Strum: pointers tracked with the same drag-to-play pattern used by the
 * shared keyboard. On `pointerdown` we pluck the string under the pointer
 * and remember it. On `pointermove` we resolve the new string via
 * `document.elementFromPoint` and pluck it only if it's a different
 * string than the previous one for that pointer — so a slow drag inside
 * one string doesn't retrigger, but a sweep across the strings plucks
 * each one as the pointer crosses it.
 */
import {
  getCtx,
  getMaster,
  resumeIfSuspended,
  setMasterVolume,
  midiToFreq,
  midiToName,
  NOTE_NAMES
} from '../shared/audio.js';
import { makePrefs } from '../shared/prefs.js';

const Prefs = makePrefs('play.harp.prefs.v1');

/**
 * Scale definitions as semitone offsets from the root, repeated up the
 * register. Pentatonic and whole-tone scales naturally space the strings
 * further apart; chromatic packs all twelve.
 */
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'pentatonic-major': [0, 2, 4, 7, 9],
  'pentatonic-minor': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  'whole-tone': [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

/** Build the list of MIDI numbers for the configured scale + range. */
function buildStrings(scaleName, root, octaves, startOctave) {
  const intervals = SCALES[scaleName] || SCALES.major;
  const startMidi = (startOctave + 1) * 12 + root;
  const out = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const interval of intervals) {
      out.push(startMidi + oct * 12 + interval);
    }
  }
  // Top tonic — close the register on the root for a satisfying high string.
  out.push(startMidi + octaves * 12);
  return out;
}

/** Pluck a single string at the given MIDI pitch. */
function pluck(midi) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') resumeIfSuspended();
  const master = getMaster();
  const t = ctx.currentTime;
  const freq = midiToFreq(midi);

  // Decay scales with pitch — low strings ring 4-5s, top strings ~1s. Tuned
  // by ear; the exponential makes it feel natural.
  const decay = Math.max(0.9, 6.5 - midi / 18);

  // Fundamental — triangle has a moderate harmonic stack, harp-ish.
  const osc1 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.value = freq;

  // Octave up sine for shimmer. Quieter so it sits beneath the fundamental.
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  const osc2Gain = ctx.createGain();
  osc2Gain.gain.value = 0.18;

  // Sub-octave at very low pitches gives extra body without muddying highs.
  let osc3, osc3Gain;
  if (midi < 60) {
    osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = freq * 0.5;
    osc3Gain = ctx.createGain();
    osc3Gain.gain.value = 0.22;
  }

  // Mellow high end — a gentle low-pass keeps it from sounding sawtooth-y.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(8000, freq * 8);
  lp.Q.value = 0.6;

  // Sharp pluck attack, exponential decay. The attack is what makes it read
  // as plucked rather than bowed.
  const env = ctx.createGain();
  const peak = 0.45;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0008, t + decay);

  osc1.connect(lp);
  osc2.connect(osc2Gain);
  osc2Gain.connect(lp);
  if (osc3 && osc3Gain) {
    osc3.connect(osc3Gain);
    osc3Gain.connect(lp);
  }
  lp.connect(env);
  env.connect(master);

  osc1.start(t);
  osc2.start(t);
  osc1.stop(t + decay + 0.1);
  osc2.stop(t + decay + 0.1);
  if (osc3) {
    osc3.start(t);
    osc3.stop(t + decay + 0.1);
  }
}

// ---------- Page wiring ------------------------------------------------

const stringsContainer = document.getElementById('harp-strings');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const scaleEl = document.getElementById('scale');
const rootEl = document.getElementById('root');
const octavesEl = document.getElementById('octaves');
const showLabelsEl = document.getElementById('show-labels');

const START_OCTAVE = 3; // C3 root by default — middle of harp range.

// Restore prefs.
const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.scale === 'string' && SCALES[prefs.scale]) scaleEl.value = prefs.scale;
if (typeof prefs.root === 'string') {
  const opt = Array.from(rootEl.options).find((o) => o.value === prefs.root);
  if (opt) rootEl.value = prefs.root;
}
if (typeof prefs.octaves === 'string') {
  const opt = Array.from(octavesEl.options).find((o) => o.value === prefs.octaves);
  if (opt) octavesEl.value = prefs.octaves;
}
if (typeof prefs.showLabels === 'boolean') showLabelsEl.checked = prefs.showLabels;

setMasterVolume(Number(volumeEl.value) / 100);

const savePrefs = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    scale: scaleEl.value,
    root: rootEl.value,
    octaves: octavesEl.value,
    showLabels: showLabelsEl.checked
  });
};

let nowPlayingTimer = null;
const announceNote = (midi) => {
  nowPlaying.textContent = midiToName(midi);
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    nowPlaying.classList.remove('active');
  }, 500);
};

const stringEls = []; // index-aligned with current MIDI list

/** Map of pointerId → currently-tracked string element. Hoisted above
 *  renderStrings so the renderer can clear it on re-render without
 *  hitting a TDZ ReferenceError on the very first call. */
const trackedString = new Map();

const renderStrings = () => {
  const scaleName = scaleEl.value;
  const root = Number(rootEl.value);
  const octaves = Number(octavesEl.value);
  const midis = buildStrings(scaleName, root, octaves, START_OCTAVE);

  stringsContainer.innerHTML = '';
  stringsContainer.style.setProperty('--strings', String(midis.length));
  stringEls.length = 0;

  for (const midi of midis) {
    const pitchClass = midi % 12;
    const isRoot = pitchClass === root;
    // Mark the perfect-fourth above the root in blue (concert-harp F string
    // convention) — only meaningful when the scale contains it.
    const isFourth = pitchClass === (root + 5) % 12;

    const el = document.createElement('div');
    el.className = 'harp-string';
    if (isRoot) el.classList.add('root');
    if (isFourth) el.classList.add('fourth');
    el.dataset.midi = String(midi);
    el.setAttribute('role', 'button');
    const noteName = midiToName(midi);
    el.setAttribute('aria-label', `Pluck ${noteName}`);

    if (isRoot) {
      el.style.setProperty('--string-color', 'rgba(248, 113, 113, 0.95)');
    } else if (isFourth) {
      el.style.setProperty('--string-color', 'rgba(96, 165, 250, 0.85)');
    }

    const label = document.createElement('span');
    label.className = 'harp-string-label';
    // C strings keep the octave number; everything else shows just the
    // pitch letter so high-density scales stay readable.
    label.textContent =
      pitchClass === 0 ? noteName : NOTE_NAMES[pitchClass].replace(/\d+$/, '');
    el.appendChild(label);

    stringsContainer.appendChild(el);
    stringEls.push(el);
  }

  stringsContainer.classList.toggle('hide-labels', !showLabelsEl.checked);

  // After a re-render any pointers we were tracking now reference detached
  // elements — drop them so the next gesture starts clean.
  trackedString.clear();
};

renderStrings();

// ---------- Pointer (touch + mouse) tracking ----------
//
// Real-harp interaction model: the finger pushes a string sideways while
// it's in contact, then *releases* it (by either lifting off or sliding
// off to the next string). The pluck — both audio and the snap-back
// wobble — fires on release, not on first touch. This is what makes a
// drag-strum feel right: each string deflects under the finger, snaps
// back as the finger crosses to the next one, and the next string takes
// over the deflection.

/** Maximum sideways deflection ratio of the column width. */
const DEFLECT_RATIO = 0.7;

/**
 * Compute how far sideways to pull the string under a given pointer X,
 * clamped to a fraction of the string's column so the visual stays
 * inside its lane.
 */
const computeDeflect = (stringEl, clientX) => {
  const rect = stringEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const halfWidth = rect.width / 2;
  const limit = halfWidth * DEFLECT_RATIO;
  const dx = clientX - centerX;
  return Math.max(-limit, Math.min(limit, dx));
};

const setDeflect = (stringEl, deflectPx) => {
  if (!stringEl) return;
  stringEl.style.setProperty('--deflect', `${deflectPx}px`);
};

/**
 * Release the string: capture its current deflection into --from so the
 * snap-back wobble starts there, clear --deflect, and trigger the pluck
 * (sound + animation + announcement).
 */
const pluckString = (stringEl) => {
  if (!stringEl) return;
  const midi = Number(stringEl.dataset.midi);
  if (!Number.isFinite(midi)) return;

  const fromValue = stringEl.style.getPropertyValue('--deflect') || '0px';
  stringEl.style.setProperty('--from', fromValue);
  stringEl.style.removeProperty('--deflect');

  // Restart the keyframe animation even on rapid retriggers.
  stringEl.classList.remove('plucked');
  // eslint-disable-next-line no-unused-expressions
  stringEl.offsetWidth;
  stringEl.classList.add('plucked');

  pluck(midi);
  announceNote(midi);

  setTimeout(() => {
    stringEl.classList.remove('plucked');
    stringEl.style.removeProperty('--from');
  }, 560);
};

const updatePointer = (clientX, clientY, pointerId) => {
  const target = document.elementFromPoint(clientX, clientY);
  const stringEl = target && target.closest && target.closest('.harp-string');
  const previous = trackedString.get(pointerId);

  if (stringEl !== previous) {
    // Crossed a string boundary: previous string releases and plucks.
    if (previous) pluckString(previous);
    trackedString.set(pointerId, stringEl || null);
  }

  if (stringEl) setDeflect(stringEl, computeDeflect(stringEl, clientX));
};

stringsContainer.addEventListener('pointerdown', (event) => {
  const stringEl = event.target.closest('.harp-string');
  if (!stringEl) return;
  stringsContainer.setPointerCapture?.(event.pointerId);
  trackedString.set(event.pointerId, stringEl);
  // Start deflecting right away so the user sees instant feedback even
  // before they begin moving.
  setDeflect(stringEl, computeDeflect(stringEl, event.clientX));
  event.preventDefault();
});

stringsContainer.addEventListener('pointermove', (event) => {
  if (!trackedString.has(event.pointerId)) return;
  updatePointer(event.clientX, event.clientY, event.pointerId);
});

const endPointer = (event) => {
  if (!trackedString.has(event.pointerId)) return;
  const stringEl = trackedString.get(event.pointerId);
  trackedString.delete(event.pointerId);
  if (stringEl) pluckString(stringEl);
};
stringsContainer.addEventListener('pointerup', endPointer);
stringsContainer.addEventListener('pointercancel', endPointer);
stringsContainer.addEventListener('lostpointercapture', endPointer);

// ---------- Controls ----------

scaleEl.addEventListener('change', () => {
  renderStrings();
  savePrefs();
});
rootEl.addEventListener('change', () => {
  renderStrings();
  savePrefs();
});
octavesEl.addEventListener('change', () => {
  renderStrings();
  savePrefs();
});
showLabelsEl.addEventListener('change', () => {
  stringsContainer.classList.toggle('hide-labels', !showLabelsEl.checked);
  savePrefs();
});

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  savePrefs();
});

// ---------- Optional keyboard play ----------
//
// Map digits 1-9 + 0 + - to the first 11 strings as a desktop convenience.
// The harp is touch-first; this is purely a bonus.
const KEYBOARD_BINDINGS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

const heldKeys = new Set();
document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  ) {
    return;
  }
  const idx = KEYBOARD_BINDINGS.indexOf(event.key);
  if (idx === -1) return;
  if (heldKeys.has(event.key)) return;
  heldKeys.add(event.key);
  const el = stringEls[idx];
  if (el) {
    pluckString(el);
    event.preventDefault();
  }
});

document.addEventListener('keyup', (event) => {
  heldKeys.delete(event.key);
});

window.addEventListener('focus', () => resumeIfSuspended());
