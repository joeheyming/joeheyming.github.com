/**
 * Browser steel drum / handpan ("Hang"). Pure Web Audio synthesis — no
 * samples — driven by a tap-the-tongue surface arranged in a circle.
 *
 * Voice: each tap instantiates a small graph modeled after the
 * `cowbell` voice in `drums/drums.js`, but with sine partials at
 * steelpan-tuned ratios (fundamental + octave + twelfth) plus a faint
 * inharmonic shimmer for bell character. Everything runs through a
 * bandpass filter centred near the tongue's pitch — that band-pass is
 * what shapes the cowbell's "metal" timbre, and what shapes ours into
 * "tongue". A short noise transient adds the mallet/finger strike.
 *
 * Layout: 1 ding (root, an octave below the rim notes) at the centre,
 * with 8 tongues evenly spaced around the rim. Tongues are positioned
 * by setting `--angle` and `--ring` CSS custom properties; the bowl
 * scales fluidly with viewport. Strikes go through PointerSurface
 * (strike-on-enter) so mouse, touch, pen, and multi-touch share one
 * path; sliding between tongues retriggers the new one.
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
import { createPointerSurface } from '../shared/pointer-surface.js';

const Prefs = makePrefs('play.steeldrum.prefs.v1');

/**
 * Hang/handpan scales as 9 ascending semitone offsets from the ding —
 * the first entry is always 0 (the ding itself), and the remaining 8
 * land on the rim tongues. Each scale is a real tuning that handpan
 * makers use; the comments give the conventional note names when
 * rooted on D (the iconic handpan key).
 */
const HANG_SCALES = {
  // Ding D3, then A3 Bb3 C4 D4 E4 F4 G4 A4 — the most common handpan.
  kurd: [0, 7, 8, 10, 12, 14, 15, 17, 19],
  // Ding D3, then A3 C4 D4 E4 F4 G4 A4 C5 — D Aeolian with raised 7.
  'celtic-minor': [0, 7, 10, 12, 14, 15, 17, 19, 22],
  // Ding D3, then A3 Bb3 D4 E4 F4 A4 Bb4 D5 — Japanese akebono pentatonic.
  akebono: [0, 7, 8, 12, 14, 15, 19, 20, 24],
  // Ding D3, then A3 B3 C4 D4 E4 F4 G4 A4 — natural minor / Aeolian.
  integral: [0, 7, 9, 10, 12, 14, 15, 17, 19],
  // Ding D3, then G3 A3 Bb3 D4 F4 G4 A4 D5 — bluesy/exotic.
  pygmy: [0, 5, 7, 8, 12, 15, 17, 19, 24],
  // Ding D3, then A3 B3 D4 E4 F#4 A4 B4 D5 — major pentatonic.
  'major-pentatonic': [0, 7, 9, 12, 14, 16, 19, 21, 24],
  // Ding D3, then Eb3 F#3 G3 A3 Bb3 C#4 D4 F4 — Middle-Eastern Hijaz.
  hijaz: [0, 1, 4, 5, 7, 8, 11, 12, 15]
};

/**
 * Build the list of MIDI numbers for the configured scale + root.
 * Returns 9 entries: [ding, ...8 rim tongues].
 */
function buildTongueMidis(scaleName, rootPc, dingOctave) {
  const offsets = HANG_SCALES[scaleName] || HANG_SCALES.kurd;
  // dingOctave 3 + rootPc 2 → D3 (MIDI 50, the iconic handpan ding).
  // The MIDI scheme treats C-1 as 0, so an "octave 3" pitch starts at
  // (octave + 1) * 12 — that's why we add 1 here.
  const dingMidi = (dingOctave + 1) * 12 + rootPc;
  return offsets.map((semis) => dingMidi + semis);
}

/**
 * Strike a single tongue at the given MIDI pitch. Self-disposing graph,
 * polyphonic — multiple strikes happily overlap because each call
 * spawns a fresh chain.
 */
function strike(midi) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') resumeIfSuspended();
  const master = getMaster();
  const t = ctx.currentTime;
  const freq = midiToFreq(midi);

  // Decay scales with pitch — the low ding can ring for ~2.6s, top rim
  // tongues fade in ~1s. Tuned by ear; exponential ramps make it feel
  // natural even though the partials decay at their own rates below.
  const decay = Math.max(0.9, 2.8 - midi / 36);

  // Sum bus for the tonal partials. Each partial gets its own envelope;
  // higher partials decay faster, mirroring how a real hammered metal
  // tongue loses its overtones first while the fundamental sustains.
  const sum = ctx.createGain();
  sum.gain.value = 1;

  /** Steelpan-style partial stack: fundamental + octave + twelfth + a
   *  faint inharmonic shimmer near 2.756× to make it bell-ish without
   *  dominating the pitch. */
  const partials = [
    { ratio: 1, gain: 0.5, decayMul: 1.0 },
    { ratio: 2, gain: 0.3, decayMul: 0.7 },
    { ratio: 3, gain: 0.12, decayMul: 0.45 },
    { ratio: 2.756, gain: 0.06, decayMul: 0.3 }
  ];

  for (const p of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * p.ratio;

    const g = ctx.createGain();
    const partialDecay = decay * p.decayMul;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(p.gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, t + partialDecay);

    osc.connect(g);
    g.connect(sum);
    osc.start(t);
    osc.stop(t + partialDecay + 0.05);
  }

  // Bandpass filter centred between the fundamental and octave gives
  // the tongue its focused, "metal-bowl" character — same trick the
  // cowbell voice uses with squares-through-bandpass, just with sines.
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * 1.6;
  bp.Q.value = 0.9;

  // Strike transient: short noise burst high-passed above the
  // fundamental. This is the "pluck/click" of a finger or mallet hitting
  // metal; without it the tone reads as a soft pad rather than a struck
  // bell.
  const noiseLen = 0.04;
  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * noiseLen));
  const buf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  const noiseHp = ctx.createBiquadFilter();
  noiseHp.type = 'highpass';
  noiseHp.frequency.value = Math.min(freq * 4, 6000);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.16, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

  noise.connect(noiseHp);
  noiseHp.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(t);

  // Final tonal envelope — a gentle taper on the whole bus so we never
  // accidentally clip when many tongues ring at once.
  const masterEnv = ctx.createGain();
  masterEnv.gain.value = 0.7;

  sum.connect(bp);
  bp.connect(masterEnv);
  masterEnv.connect(master);
}

// ---------- Page wiring ------------------------------------------------

const bowl = document.getElementById('hang-bowl');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const scaleEl = document.getElementById('scale');
const rootEl = document.getElementById('root');
const showLabelsEl = document.getElementById('show-labels');

const DING_OCTAVE = 3;

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.scale === 'string' && HANG_SCALES[prefs.scale]) scaleEl.value = prefs.scale;
if (typeof prefs.root === 'string') {
  const opt = Array.from(rootEl.options).find((o) => o.value === prefs.root);
  if (opt) rootEl.value = prefs.root;
}
if (typeof prefs.showLabels === 'boolean') showLabelsEl.checked = prefs.showLabels;

setMasterVolume(Number(volumeEl.value) / 100);

const savePrefs = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    scale: scaleEl.value,
    root: rootEl.value,
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

/** Created after strike helpers below; releaseAll on re-render drops
 *  pointers whose targets were just detached. */
let surface = null;

/** Index-aligned with the current MIDI list (ding at [0]). */
const tongueEls = [];

const renderTongues = () => {
  const scaleName = scaleEl.value;
  const rootPc = Number(rootEl.value);
  const midis = buildTongueMidis(scaleName, rootPc, DING_OCTAVE);

  bowl.innerHTML = '';
  tongueEls.length = 0;

  // The 8 rim tongues are evenly spaced around the dome, starting at
  // the top (12 o'clock) and ascending clockwise. The user discovers
  // the scale by going around the rim — simpler than the alternating
  // "zigzag" arrangement real handpans use, and easier to read at a
  // glance.
  const rimCount = midis.length - 1; // 8
  const angleStep = 360 / rimCount;
  // Distance from the bowl centre to each rim tongue's anchor, as a
  // percentage of the bowl's half-width. 34% leaves enough breathing
  // room around the centre ding (28% wide) and tucks rim tongues
  // (24% wide) just inside the rim.
  const RIM_RADIUS_PCT = 34;

  for (let i = 0; i < midis.length; i++) {
    const midi = midis[i];
    const isDing = i === 0;
    const isRoot = midi % 12 === rootPc;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hang-tongue';
    if (isDing) btn.classList.add('hang-ding');
    if (isRoot) btn.classList.add('hang-root');
    btn.dataset.midi = String(midi);
    const noteName = midiToName(midi);
    btn.setAttribute('aria-label', isDing ? `Ding ${noteName}` : `Tongue ${noteName}`);

    let angle = 0;
    if (!isDing) {
      angle = (i - 1) * angleStep; // 0° at top, clockwise
      // Convert to math-style angle (0° on +x axis). At 12 o'clock we
      // want (0, -radius), which is angle -90° in standard trig.
      const rad = ((angle - 90) * Math.PI) / 180;
      const cx = 50 + Math.cos(rad) * RIM_RADIUS_PCT;
      const cy = 50 + Math.sin(rad) * RIM_RADIUS_PCT;
      btn.style.setProperty('--cx', `${cx}%`);
      btn.style.setProperty('--cy', `${cy}%`);
      btn.style.setProperty('--angle', `${angle}deg`);
    }

    const face = document.createElement('span');
    face.className = 'hang-tongue-face';
    face.setAttribute('aria-hidden', 'true');
    btn.appendChild(face);

    const label = document.createElement('span');
    label.className = 'hang-tongue-label';
    if (isDing) {
      label.textContent = noteName;
    } else {
      const pc = midi % 12;
      // Strip trailing octave from non-C labels so dense rim labels stay
      // readable; keep the octave for C so the player can orient.
      label.textContent = pc === 0 ? noteName : NOTE_NAMES[pc].replace(/\d+$/, '');
      // Counter-rotate so the label sits upright regardless of where
      // the tongue lives on the rim.
      label.style.setProperty('--label-rotate', `${-angle}deg`);
    }
    btn.appendChild(label);

    bowl.appendChild(btn);
    tongueEls.push(btn);
  }

  bowl.classList.toggle('hide-labels', !showLabelsEl.checked);
  surface?.releaseAll();
};

// ---------- Pointer handling ----------
//
// Tap-to-strike: pointerdown triggers the tongue under the pointer, and
// pointermove retriggers when the pointer crosses into a different
// tongue (same model the harp uses for cross-string strums). This makes
// dragging a finger across the dome ring out a roll, matching how real
// handpan players "glissando" with rolling fingers.

const struckTimers = new WeakMap();

const triggerStrike = (tongueEl) => {
  if (!tongueEl) return;
  const midi = Number(tongueEl.dataset.midi);
  if (!Number.isFinite(midi)) return;

  // Restart the keyframe animation even on rapid retriggers — without
  // the void offsetWidth read the browser coalesces the class toggle
  // and the second strike doesn't re-animate.
  tongueEl.classList.remove('struck');
  // eslint-disable-next-line no-unused-expressions
  tongueEl.offsetWidth;
  tongueEl.classList.add('struck');

  strike(midi);
  window.heymingAchievements?.unlockForCurrentApp('first-action');
  announceNote(midi);

  const prevTimer = struckTimers.get(tongueEl);
  if (prevTimer) clearTimeout(prevTimer);
  const timer = setTimeout(() => {
    tongueEl.classList.remove('struck');
    struckTimers.delete(tongueEl);
  }, 620);
  struckTimers.set(tongueEl, timer);
};

// Strike-on-enter: tap and drag-across both hit via onEnter. Custom
// hitTest keeps polar geometry honest when elementFromPoint lands on
// the bowl chrome between tongues.
surface = createPointerSurface(bowl, {
  targetSelector: '.hang-tongue',
  hitTest: (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest('.hang-tongue') : null;
  },
  onEnter: (tongue) => {
    triggerStrike(tongue);
  }
});

renderTongues();

// ---------- Controls ----------

scaleEl.addEventListener('change', () => {
  renderTongues();
  savePrefs();
});
rootEl.addEventListener('change', () => {
  renderTongues();
  savePrefs();
});
showLabelsEl.addEventListener('change', () => {
  bowl.classList.toggle('hide-labels', !showLabelsEl.checked);
  savePrefs();
});
volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  savePrefs();
});

// ---------- Optional keyboard play ----------
//
// Steel drum is touch-first, but a desktop user with a keyboard
// shouldn't be locked out. Map digits 1-8 to the rim tongues (in the
// order they're rendered, ascending clockwise from the top) and 0 to
// the ding. This lines up with the visual order so the player can
// pick out a melody without needing a printed key map.
const KEYBOARD_BINDINGS = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];
const heldKeys = new Set();

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const target = event.target;
  if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return;
  }
  const idx = KEYBOARD_BINDINGS.indexOf(event.key);
  if (idx === -1) return;
  if (heldKeys.has(event.key)) return;
  heldKeys.add(event.key);
  const el = tongueEls[idx];
  if (el) {
    triggerStrike(el);
    event.preventDefault();
  }
});

document.addEventListener('keyup', (event) => {
  heldKeys.delete(event.key);
});

window.addEventListener('focus', () => resumeIfSuspended());
