/**
 * Theremin / XY pad. Continuous pitch + volume controlled by a single
 * pointer; second (or further) pointers add vibrato.
 *
 * Audio model — single-voice drone:
 *
 *   osc → ampGain → master
 *   vibratoLfo → vibratoDepth(gain) → osc.detune (in cents)
 *
 *   X (pad horizontal)  → osc.frequency  (logarithmic; midi over an
 *                                         N-octave range starting from
 *                                         the chosen root)
 *   Y (pad vertical)    → ampGain         (0..0.6 with smoothed setTarget)
 *   Glide slider        → exponentialRamp time on freq when X jumps
 *
 * Vibrato (any 2nd+ pointer):
 *   X (rate, 2..10 Hz)  → vibratoLfo.frequency
 *   Y (depth, 0..120¢)  → vibratoDepth.gain
 *
 * The amp envelope idles at 0; pointerdown ramps it to the Y-derived
 * level over a short fade-in (so we don't get a click on first press),
 * pointerup ramps it back to 0 over a slightly longer fade-out (so the
 * note tail is audible). The oscillator runs continuously while any
 * primary pointer is down — pitch jumps within a single touch are
 * smoothed by the Glide setting, which is what gives a real theremin
 * its "sliding" feel.
 *
 * The hint text in the middle of the pad fades on first activity and
 * stays faded for the session — no flicker on every release.
 *
 * Multi-touch: the first pointer to land is the "primary" voice and
 * every other concurrent pointer drives vibrato. If the primary lifts
 * while another pointer is still down, that secondary pointer is
 * promoted to primary so the drone keeps going (the player never has
 * to think about "which finger landed first").
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

const Prefs = makePrefs('play.theremin.prefs.v1');

const SCALES = {
  continuous: null, // sentinel — no snapping
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'pentatonic-major': [0, 2, 4, 7, 9],
  'pentatonic-minor': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

// Pad spans `RANGE_OCTAVES` starting at `START_OCTAVE` shifted by the
// chosen root. e.g. root=C, start=2 → C2..(C2 + N*12).
const START_OCTAVE = 3;

// Vibrato range constants — chosen by ear so a midway 2nd-finger position
// gives an obvious-but-musical wobble.
const VIBRATO_MIN_HZ = 2;
const VIBRATO_MAX_HZ = 10;
const VIBRATO_MAX_CENTS = 120;

// Amp envelope timing — short attack so the surface feels responsive,
// slightly longer release so the note doesn't click off.
const AMP_ATTACK = 0.025;
const AMP_RELEASE = 0.12;

// Y → amplitude curve. Linear feels weak; a gentle squared curve gives the
// bottom half of the pad real headroom and the top half a steady push.
const yToAmp = (yNorm) => {
  // yNorm: 0 at top, 1 at bottom — flip to "0 silent, 1 loud".
  const v = Math.max(0, Math.min(1, 1 - yNorm));
  return v * v * 0.6;
};

// ---------- Page wiring ------------------------------------------------

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
const modeEl = document.getElementById('mode');
const videoEl = document.getElementById('theremin-video');
const overlayEl = document.getElementById('theremin-overlay');
const airCardEl = document.getElementById('theremin-air-card');
const airCardTitleEl = document.getElementById('theremin-air-card-title');
const airCardMessageEl = document.getElementById('theremin-air-card-message');
const airStartBtn = document.getElementById('theremin-air-start');

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
// Mode is restored separately on page boot at the bottom — we want the
// touch UI fully wired before potentially flipping into air mode (which
// can prompt for camera permission).

setMasterVolume(Number(volumeEl.value) / 100);

const savePrefs = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    waveform: waveformEl.value,
    scale: scaleEl.value,
    root: rootEl.value,
    range: rangeEl.value,
    glide: Number(glideEl.value),
    mode: modeEl.value
  });
};

// ---------- Audio voice ----------

let osc = null;
let amp = null;
let vibratoLfo = null;
let vibratoDepth = null;

const ensureVoice = () => {
  if (osc) return;
  const ctx = getCtx();
  if (ctx.state === 'suspended') resumeIfSuspended();

  amp = ctx.createGain();
  amp.gain.value = 0;
  amp.connect(getMaster());

  osc = ctx.createOscillator();
  osc.type = waveformEl.value;
  // Initial freq is the pad's left edge — picked when the voice is built.
  osc.frequency.value = midiToFreq(getMidiAtX(0));
  osc.connect(amp);
  osc.start();

  vibratoLfo = ctx.createOscillator();
  vibratoLfo.type = 'sine';
  vibratoLfo.frequency.value = VIBRATO_MIN_HZ;
  vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = 0;
  vibratoLfo.connect(vibratoDepth);
  vibratoDepth.connect(osc.detune);
  vibratoLfo.start();
};

const setWaveform = (type) => {
  if (osc) osc.type = type;
};

// ---------- Pitch math ----------

const getMidiRange = () => {
  const root = Number(rootEl.value);
  const range = Number(rangeEl.value);
  const startMidi = (START_OCTAVE + 1) * 12 + root;
  return { startMidi, endMidi: startMidi + range * 12 };
};

/**
 * Snap a real-valued midi number to the nearest in-scale midi. For
 * `continuous`, returns the input unchanged (true theremin glide).
 */
const snapToScale = (midi) => {
  const intervals = SCALES[scaleEl.value];
  if (!intervals) return midi;
  const root = Number(rootEl.value);
  // Build the set of allowed pitch classes once per snap call. Cheap and
  // re-evaluated on every move so scale changes apply immediately.
  let best = midi;
  let bestDist = Infinity;
  // Search nearest in-scale midi within ±1 octave of `midi` — that's
  // always more than enough to find the closest match.
  const baseMidi = Math.round(midi);
  for (let m = baseMidi - 12; m <= baseMidi + 12; m++) {
    const pc = ((m - root) % 12 + 12) % 12;
    if (!intervals.includes(pc)) continue;
    const d = Math.abs(midi - m);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
};

/**
 * Map a normalized X (0 left, 1 right) to a midi number across the
 * configured range. With snapping, the result is rounded to the nearest
 * in-scale step; with `continuous`, returns a fractional midi for true
 * glide.
 */
const xToMidi = (xNorm) => {
  const { startMidi, endMidi } = getMidiRange();
  const span = endMidi - startMidi;
  const raw = startMidi + xNorm * span;
  return snapToScale(raw);
};

const getMidiAtX = (xNorm) => xToMidi(Math.max(0, Math.min(1, xNorm)));

// ---------- Grid rendering ----------

const renderGrid = () => {
  gridEl.innerHTML = '';
  const root = Number(rootEl.value);
  const range = Number(rangeEl.value);
  const { startMidi, endMidi } = getMidiRange();
  const span = endMidi - startMidi;

  // Vertical lines at every chromatic step. Highlight the root and any C.
  for (let m = startMidi; m <= endMidi; m++) {
    const xNorm = (m - startMidi) / span;
    const line = document.createElement('div');
    line.className = 'theremin-grid-line vertical';
    if (m % 12 === root) line.classList.add('is-root');
    else if (m % 12 === 0) line.classList.add('is-c');
    line.style.left = `${(xNorm * 100).toFixed(3)}%`;
    gridEl.appendChild(line);

    // Label only at root or octave boundaries — labelling every semitone
    // is unreadable, especially on phones.
    const isRoot = m % 12 === root;
    const isC = m % 12 === 0;
    if (isRoot || (isC && range <= 4)) {
      const label = document.createElement('div');
      label.className = 'theremin-grid-label';
      if (isRoot) label.classList.add('is-root');
      label.textContent = isRoot ? `${NOTE_NAMES[root]}${Math.floor(m / 12) - 1}` : midiToName(m);
      label.style.left = `${(xNorm * 100).toFixed(3)}%`;
      // Edge labels would normally bleed off the pad with the default
      // -50% centring transform — pin them to their respective edge
      // instead so the leftmost C is left-aligned and the rightmost C
      // is right-aligned.
      if (m === startMidi) label.classList.add('is-edge-left');
      else if (m === endMidi) label.classList.add('is-edge-right');
      gridEl.appendChild(label);
    }
  }

  // Horizontal lines at quarter intervals — visual anchors for volume.
  for (let i = 1; i < 4; i++) {
    const line = document.createElement('div');
    line.className = 'theremin-grid-line horizontal';
    line.style.top = `${(i * 25).toFixed(0)}%`;
    gridEl.appendChild(line);
  }
};

renderGrid();

// ---------- Touch markers + crosshair ----------

const touchEls = new Map(); // pointerId -> div.theremin-touch

let crosshair = document.createElement('div');
crosshair.className = 'theremin-crosshair';
const crosshairV = document.createElement('div');
crosshairV.className = 'theremin-crosshair-line vertical';
const crosshairH = document.createElement('div');
crosshairH.className = 'theremin-crosshair-line horizontal';
crosshair.appendChild(crosshairV);
crosshair.appendChild(crosshairH);
crosshair.hidden = true;
padEl.appendChild(crosshair);

const setCrosshair = (xPx, yPx, visible) => {
  crosshair.hidden = !visible;
  if (!visible) return;
  crosshairV.style.setProperty('--cx', `${xPx.toFixed(2)}px`);
  crosshairH.style.setProperty('--cy', `${yPx.toFixed(2)}px`);
};

const ensureTouchEl = (ptrId, isVibrato) => {
  let el = touchEls.get(ptrId);
  if (!el) {
    el = document.createElement('div');
    el.className = 'theremin-touch';
    padEl.appendChild(el);
    touchEls.set(ptrId, el);
  }
  el.classList.toggle('vibrato', !!isVibrato);
  return el;
};

const removeTouchEl = (ptrId) => {
  const el = touchEls.get(ptrId);
  if (!el) return;
  el.remove();
  touchEls.delete(ptrId);
};

// ---------- Pointer state ----------

/** pointerId -> { xNorm, yNorm } */
const pointers = new Map();
/** pointerId of the current primary voice (or null). */
let primaryId = null;

let nowPlayingTimer = null;
const announceMidi = (midi) => {
  nowPlaying.textContent = midiToName(Math.round(midi));
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    nowPlaying.classList.remove('active');
  }, 350);
};

const localCoords = (event) => {
  const rect = padEl.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  return {
    xNorm: Math.max(0, Math.min(1, x)),
    yNorm: Math.max(0, Math.min(1, y)),
    xPx: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    yPx: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
  };
};

// ---------- Voice updates ----------

const applyPrimary = (xNorm, yNorm) => {
  if (!osc) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const midi = xToMidi(xNorm);
  const freq = midiToFreq(midi);

  // Glide: 0 → effectively snap; 200 → ~0.5s lyric slide. The slider's
  // actual unit is "ms of glide between any two updates", not the full
  // pad-edge-to-pad-edge glide. setTargetAtTime with a tiny tau gives a
  // good compromise: aggressive enough to track fast drags, smooth
  // enough to round off jagged updates.
  const glideMs = Number(glideEl.value);
  const tau = Math.max(0.001, glideMs / 1000);
  osc.frequency.cancelScheduledValues(now);
  osc.frequency.setTargetAtTime(freq, now, tau);

  // Amp follows Y immediately (no glide) so the player can articulate.
  const amplitude = yToAmp(yNorm);
  amp.gain.cancelScheduledValues(now);
  amp.gain.setTargetAtTime(amplitude, now, 0.012);

  announceMidi(midi);
};

const applyVibrato = (xNorm, yNorm) => {
  if (!vibratoLfo || !vibratoDepth) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  // X = rate (left = slow, right = fast).
  const rate = VIBRATO_MIN_HZ + xNorm * (VIBRATO_MAX_HZ - VIBRATO_MIN_HZ);
  // Y inverted = depth (top = max, bottom = none) so "raise the second
  // finger" means "more wobble" — matches volume convention.
  const depth = (1 - yNorm) * VIBRATO_MAX_CENTS;
  vibratoLfo.frequency.setTargetAtTime(rate, now, 0.05);
  vibratoDepth.gain.setTargetAtTime(depth, now, 0.05);
};

const clearVibrato = () => {
  if (!vibratoDepth) return;
  const ctx = getCtx();
  vibratoDepth.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
};

const fadeOutVoice = () => {
  if (!amp) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  amp.gain.cancelScheduledValues(now);
  amp.gain.setValueAtTime(amp.gain.value, now);
  amp.gain.linearRampToValueAtTime(0, now + AMP_RELEASE);
};

const fadeInVoice = (yNorm) => {
  if (!amp) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const target = yToAmp(yNorm);
  amp.gain.cancelScheduledValues(now);
  amp.gain.setValueAtTime(amp.gain.value, now);
  amp.gain.linearRampToValueAtTime(target, now + AMP_ATTACK);
};

// ---------- Pointer handlers ----------

const reassignPrimary = () => {
  // Pick the oldest still-active pointer as primary. Map iteration order
  // is insertion order, so the first key is the longest-held pointer.
  primaryId = null;
  for (const id of pointers.keys()) {
    primaryId = id;
    break;
  }
};

const refreshTouchClassOrders = () => {
  // After a primary swap, repaint each touch element's class so the
  // newly-primary pointer drops the `vibrato` style and any newly-
  // secondary pointer picks it up.
  for (const id of pointers.keys()) {
    const el = ensureTouchEl(id, id !== primaryId);
    const p = pointers.get(id);
    el.style.setProperty('--tx', `${p.xPx.toFixed(2)}px`);
    el.style.setProperty('--ty', `${p.yPx.toFixed(2)}px`);
  }
};

const onPointerDown = (event) => {
  // In air mode the camera drives the audio; pointer input on the pad
  // would conflict with the hand-tracking voice, so we ignore it.
  if (mode === 'air') return;

  ensureVoice();
  resumeIfSuspended();
  // setPointerCapture throws InvalidPointerId for pointer-ids that
  // aren't actively held (e.g. synthetic test events). Treat it as
  // best-effort — it's only here so a finger that briefly drags off
  // the pad still routes its move events back to us.
  try {
    padEl.setPointerCapture?.(event.pointerId);
  } catch (_) {
    /* ignore */
  }

  const c = localCoords(event);
  pointers.set(event.pointerId, c);

  const isFirst = pointers.size === 1;
  if (isFirst) {
    primaryId = event.pointerId;
    fadeInVoice(c.yNorm);
    applyPrimary(c.xNorm, c.yNorm);
    setCrosshair(c.xPx, c.yPx, true);
  } else {
    applyVibrato(c.xNorm, c.yNorm);
  }

  const el = ensureTouchEl(event.pointerId, !isFirst);
  el.style.setProperty('--tx', `${c.xPx.toFixed(2)}px`);
  el.style.setProperty('--ty', `${c.yPx.toFixed(2)}px`);

  padEl.classList.add('is-active');
  event.preventDefault();
};

const onPointerMove = (event) => {
  if (!pointers.has(event.pointerId)) return;
  const c = localCoords(event);
  pointers.set(event.pointerId, c);

  const el = touchEls.get(event.pointerId);
  if (el) {
    el.style.setProperty('--tx', `${c.xPx.toFixed(2)}px`);
    el.style.setProperty('--ty', `${c.yPx.toFixed(2)}px`);
  }

  if (event.pointerId === primaryId) {
    applyPrimary(c.xNorm, c.yNorm);
    setCrosshair(c.xPx, c.yPx, true);
  } else {
    applyVibrato(c.xNorm, c.yNorm);
  }
};

const endPointer = (event) => {
  if (!pointers.has(event.pointerId)) return;
  const wasPrimary = event.pointerId === primaryId;
  pointers.delete(event.pointerId);
  removeTouchEl(event.pointerId);

  if (pointers.size === 0) {
    primaryId = null;
    fadeOutVoice();
    clearVibrato();
    setCrosshair(0, 0, false);
    padEl.classList.remove('is-active');
    return;
  }

  if (wasPrimary) {
    // Promote whichever pointer is still down to primary so the drone
    // keeps going without a gap.
    reassignPrimary();
    refreshTouchClassOrders();
    const next = pointers.get(primaryId);
    if (next) {
      applyPrimary(next.xNorm, next.yNorm);
      setCrosshair(next.xPx, next.yPx, true);
    }
    // With one finger left, there's no vibrato source — collapse it.
    if (pointers.size === 1) clearVibrato();
  } else if (pointers.size === 1) {
    // Last secondary lifted; flatten vibrato.
    clearVibrato();
  }
};

padEl.addEventListener('pointerdown', onPointerDown);
padEl.addEventListener('pointermove', onPointerMove);
padEl.addEventListener('pointerup', endPointer);
padEl.addEventListener('pointercancel', endPointer);
padEl.addEventListener('lostpointercapture', endPointer);

// ---------- Air mode (front camera + MediaPipe Hands) ----------
//
// Loads MediaPipe Tasks Vision lazily — only when the user explicitly
// switches to air mode. WASM + model are ~7 MB combined; touch-mode
// users never download any of it.
//
// Once running, a `requestAnimationFrame` loop feeds the live <video>
// to `HandLandmarker.detectForVideo`. Detected hand(s) drive the same
// audio voice as touch mode via `applyPrimary` / `applyVibrato`, so
// scale snapping, glide, and volume curves all carry over for free.
//
// Coordinate convention:
//   - MediaPipe returns landmarks with x ∈ [0..1] left→right of the raw
//     (un-mirrored) frame, y ∈ [0..1] top→bottom.
//   - We display the video mirrored horizontally (CSS scaleX(-1)) so
//     the user feels like they're looking in a mirror — that means
//     the user's right hand appears on the right side of the screen.
//   - To map to pad-style "X = pitch (left=low, right=high)", we
//     compute padX = 1 - landmark.x.
//   - Y maps directly: hand-up is small landmark.y is loud (matches
//     the touch pad).
//   - MediaPipe's handedness output assumes a *mirrored* input frame.
//     We feed it un-mirrored, so its "Right" label corresponds to the
//     user's left hand and vice versa — we flip the labels on read.
//
// State machine:
//   idle      → mode is 'touch' (or first paint)
//   prompt    → air mode requested, awaiting "Allow camera" tap
//   loading   → tapped Allow; downloading MediaPipe + opening camera
//   running   → detection loop active, audio bound to hands
//   denied    → permission refused; retry button offered
//   error     → MediaPipe / camera failed; retry button offered

let mode = 'touch';
let airState = 'idle';

let handLandmarker = null;
let mediaStream = null;
let rafId = null;
let lastDetectMs = 0;
// Set false when no hand has been visible for a few frames so the voice
// can fade out cleanly; flipped back true on the next detection.
let airVoiceOn = false;
// Track frames-without-hand so a single dropped detection doesn't kill
// the voice. ~6 frames at 30 fps ≈ 200 ms grace period.
const NO_HAND_GRACE_FRAMES = 6;
let noHandFrames = 0;

const overlayCtx = overlayEl.getContext('2d');

// MediaPipe Hand-landmark connection list (21 landmarks per hand).
// Source: github.com/google-ai-edge/mediapipe spec.
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17] // palm closure
];
const TIP_LANDMARK = 8; // index fingertip — drives pitch/volume

/**
 * Render the air-mode status card. `messageHTML` is *trusted markup*
 * built only from string literals in this file — never user input —
 * so writing it via innerHTML is safe and lets us include clickable
 * help links (e.g. the dev-CA install URL).
 */
const showAirCard = ({ title, message, messageHTML, buttonLabel, busy = false }) => {
  airCardTitleEl.textContent = title;
  if (messageHTML) {
    airCardMessageEl.innerHTML = messageHTML;
  } else {
    airCardMessageEl.textContent = message ?? '';
  }
  if (buttonLabel) {
    airStartBtn.textContent = buttonLabel;
    airStartBtn.disabled = busy;
    airStartBtn.hidden = false;
  } else {
    airStartBtn.hidden = true;
  }
  airCardEl.hidden = false;
};

/**
 * Diagnostic card content for "camera API not available" — by far the
 * most common reason air mode fails on a phone. Detects the two cases
 * we can usefully steer the user out of:
 *
 *   1. The page is on the local mkcert dev server (port 8443, LAN IP)
 *      AND the phone hasn't installed the mkcert root CA. The dev
 *      origin therefore looks insecure to Android Chrome, which blanks
 *      `navigator.mediaDevices`. We surface a one-tap link to
 *      `/dev-ca.pem` (served by `scripts/dev-server.py`) so the user
 *      can install the cert without leaving their phone.
 *   2. The page is on a regular insecure origin (http://, file://,
 *      etc.). We just say "needs HTTPS".
 *
 * If `isSecureContext` is true but the API still missing, the browser
 * itself doesn't expose camera access (rare on modern phones; in-app
 * webviews are the usual offender).
 */
const buildCameraUnavailableCard = () => {
  const isLocalHostLike =
    /^(localhost|127\.|::1$|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/.test(
      location.hostname
    );
  const insecure = !window.isSecureContext;

  if (insecure && isLocalHostLike) {
    return {
      title: 'Air mode needs a trusted dev cert',
      messageHTML:
        "Your phone doesn't yet trust this dev server's certificate, so " +
        'Chrome blocks camera access. ' +
        '<a href="/dev-ca.pem" download="dev-ca.pem" style="color:#a5b4fc;">' +
        'Tap here to download the dev CA</a>, ' +
        'then install it under <em>Settings → Security → Encryption ' +
        '&amp; credentials → Install a certificate → CA certificate</em>. ' +
        'Reload this page after installing.'
    };
  }
  if (insecure) {
    return {
      title: 'Air mode needs HTTPS',
      message:
        'Camera access is only allowed from a secure (https://) origin. Open this page over HTTPS and try again.'
    };
  }
  return {
    title: "Camera API isn't available here",
    message:
      'This browser blocks the camera API. Try Chrome on Android, Safari on iOS, or a desktop Chrome / Firefox.'
  };
};

const hideAirCard = () => {
  airCardEl.hidden = true;
};

const setAirState = (next) => {
  airState = next;
  switch (next) {
    case 'prompt':
      showAirCard({
        title: 'Air mode',
        message:
          "Wave your hand in front of the camera to play. We'll need camera access — nothing leaves your device.",
        buttonLabel: 'Allow camera'
      });
      break;
    case 'loading':
      showAirCard({
        title: 'Starting camera…',
        message: 'Loading hand-tracking model.',
        buttonLabel: 'Loading…',
        busy: true
      });
      break;
    case 'running':
      hideAirCard();
      break;
    case 'denied':
      showAirCard({
        title: 'Camera blocked',
        message:
          "Air mode needs camera access. Allow it in your browser's site settings, then tap Retry.",
        buttonLabel: 'Retry'
      });
      break;
    case 'error':
      showAirCard({
        title: "Couldn't start air mode",
        message: 'Hand-tracking failed to load. Check your connection and tap Retry.',
        buttonLabel: 'Retry'
      });
      break;
    case 'unavailable': {
      const card = buildCameraUnavailableCard();
      showAirCard({ ...card });
      break;
    }
    default:
      hideAirCard();
  }
};

const stopAirMode = () => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
    mediaStream = null;
  }
  videoEl.srcObject = null;
  overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  if (airVoiceOn) {
    fadeOutVoice();
    clearVibrato();
    airVoiceOn = false;
  }
  airState = 'idle';
};

/**
 * Lazy-load MediaPipe Tasks Vision and instantiate the hand landmarker.
 * Cached: subsequent enters into air mode reuse the same detector.
 */
const ensureHandLandmarker = async () => {
  if (handLandmarker) return handLandmarker;
  // Dynamic ESM import from jsdelivr's automatic ESM build. Pinning to
  // 0.10.20 — newer versions (0.10.22, 0.10.30) have intermittently
  // failed to publish to jsdelivr; 0.10.34/0.10.35 work but are too
  // recent to trust without integration testing. 0.10.20 has been
  // stable in the wild since 2024.
  const visionModule = await import(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm'
  );
  const { HandLandmarker, FilesetResolver } = visionModule;
  const fileset = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm'
  );
  handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numHands: 2
  });
  return handLandmarker;
};

const startCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API not available in this browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  videoEl.srcObject = stream;
  // iOS Safari refuses to autoplay an inline <video> until play() is
  // called explicitly; this resolves once the first frame is decoded.
  await videoEl.play();
  // Wait for the dimensions to be known so the canvas can size itself.
  if (!videoEl.videoWidth) {
    await new Promise((res) => {
      const onMeta = () => {
        videoEl.removeEventListener('loadedmetadata', onMeta);
        res();
      };
      videoEl.addEventListener('loadedmetadata', onMeta);
    });
  }
  return stream;
};

const sizeOverlayCanvas = () => {
  const rect = padEl.getBoundingClientRect();
  // Render at device pixel density for crisp landmark dots; cap at 2 to
  // keep the canvas affordable even on retina phones.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlayEl.width = Math.max(1, Math.round(rect.width * dpr));
  overlayEl.height = Math.max(1, Math.round(rect.height * dpr));
  overlayEl.style.width = `${rect.width}px`;
  overlayEl.style.height = `${rect.height}px`;
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return rect;
};

const drawHands = (hands, padW, padH) => {
  overlayCtx.clearRect(0, 0, padW, padH);
  for (const hand of hands) {
    const isPrimary = hand.userHand === 'Right';
    const color = isPrimary ? 'rgba(129, 140, 248, 1)' : 'rgba(244, 114, 182, 1)';
    overlayCtx.save();
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = 3;
    overlayCtx.lineCap = 'round';
    overlayCtx.shadowColor = color;
    overlayCtx.shadowBlur = 12;

    overlayCtx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const A = hand.landmarks[a];
      const B = hand.landmarks[b];
      // (1 - x) handles the horizontal mirror so the skeleton aligns
      // with the mirrored video underneath.
      overlayCtx.moveTo((1 - A.x) * padW, A.y * padH);
      overlayCtx.lineTo((1 - B.x) * padW, B.y * padH);
    }
    overlayCtx.stroke();

    overlayCtx.fillStyle = color;
    for (const lm of hand.landmarks) {
      overlayCtx.beginPath();
      overlayCtx.arc((1 - lm.x) * padW, lm.y * padH, 3, 0, Math.PI * 2);
      overlayCtx.fill();
    }

    // Highlight the index fingertip — the active "pointer" landmark.
    const tip = hand.landmarks[TIP_LANDMARK];
    overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    overlayCtx.shadowBlur = 18;
    overlayCtx.beginPath();
    overlayCtx.arc((1 - tip.x) * padW, tip.y * padH, 8, 0, Math.PI * 2);
    overlayCtx.fill();
    overlayCtx.restore();
  }
};

const detectLoop = () => {
  if (mode !== 'air') return;
  rafId = requestAnimationFrame(detectLoop);
  if (!handLandmarker || !videoEl.videoWidth) return;

  // detectForVideo wants a strictly increasing timestamp in ms.
  const now = performance.now();
  if (now <= lastDetectMs) return;
  lastDetectMs = now;

  let result;
  try {
    result = handLandmarker.detectForVideo(videoEl, now);
  } catch (err) {
    console.warn('Hand detection failed', err);
    return;
  }

  const rect = sizeOverlayCanvas();
  const padW = rect.width;
  const padH = rect.height;

  const rawLandmarks = result?.landmarks || [];
  if (rawLandmarks.length === 0) {
    noHandFrames += 1;
    if (noHandFrames > NO_HAND_GRACE_FRAMES && airVoiceOn) {
      fadeOutVoice();
      clearVibrato();
      airVoiceOn = false;
    }
    drawHands([], padW, padH);
    return;
  }
  noHandFrames = 0;

  // Tag each detected hand with the user's actual handedness (flipped
  // because we feed un-mirrored frames; see comment at top of section).
  const hands = rawLandmarks.map((landmarks, i) => {
    const raw = result.handedness?.[i]?.[0]?.categoryName;
    const userHand = raw === 'Right' ? 'Left' : 'Right';
    return { landmarks, userHand };
  });

  // Pick primary = user's right hand if present, otherwise the first
  // detected hand. Secondary (vibrato) = the other hand if any.
  const right = hands.find((h) => h.userHand === 'Right');
  const left = hands.find((h) => h.userHand === 'Left');
  const primary = right || hands[0];
  const secondary = right ? left : hands[1] || null;

  ensureVoice();
  if (!airVoiceOn) {
    // Use the primary's current Y as the fade-in target so we ramp to
    // an appropriate amplitude rather than always max.
    fadeInVoice(primary.landmarks[TIP_LANDMARK].y);
    airVoiceOn = true;
  }

  const tip = primary.landmarks[TIP_LANDMARK];
  applyPrimary(1 - tip.x, tip.y);

  if (secondary) {
    const tip2 = secondary.landmarks[TIP_LANDMARK];
    applyVibrato(1 - tip2.x, tip2.y);
  } else {
    clearVibrato();
  }

  drawHands(hands, padW, padH);
};

const enterAirMode = async () => {
  // Drop any held touch voice from the previous mode.
  for (const ptrId of Array.from(pointers.keys())) {
    pointers.delete(ptrId);
    removeTouchEl(ptrId);
  }
  primaryId = null;
  setCrosshair(0, 0, false);
  padEl.classList.remove('is-active');
  fadeOutVoice();
  clearVibrato();

  padEl.classList.add('is-air-mode');
  // If the camera API is missing for this origin, show the diagnostic
  // card (with a dev-CA install hint when applicable) instead of the
  // generic "Allow camera" prompt — tapping the button there would
  // throw a confusing error.
  if (!navigator.mediaDevices?.getUserMedia) {
    setAirState('unavailable');
    return;
  }
  setAirState('prompt');
};

const startAirRunning = async () => {
  setAirState('loading');
  try {
    await ensureHandLandmarker();
    await startCamera();
    sizeOverlayCanvas();
    setAirState('running');
    noHandFrames = 0;
    airVoiceOn = false;
    lastDetectMs = 0;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(detectLoop);
  } catch (err) {
    console.warn('Air mode start failed', err);
    if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
      setAirState('denied');
    } else {
      setAirState('error');
    }
  }
};

const exitAirMode = () => {
  padEl.classList.remove('is-air-mode');
  stopAirMode();
};

airStartBtn.addEventListener('click', () => {
  if (airState === 'loading') return;
  startAirRunning();
});

const setMode = (next) => {
  if (next === mode) return;
  if (mode === 'air') exitAirMode();
  mode = next;
  modeEl.value = next;
  if (mode === 'air') {
    enterAirMode();
  }
  savePrefs();
};

// We intentionally leave the Air option enabled even when
// `navigator.mediaDevices` is missing — picking it routes through the
// `unavailable` state, which renders an actionable diagnostic
// (insecure-context vs. dev-cert vs. browser-unsupported) instead of
// silently disabling the option with no explanation.

modeEl.addEventListener('change', () => {
  setMode(modeEl.value);
});

// Keep the overlay canvas sized when the pad reflows.
window.addEventListener('resize', () => {
  if (mode === 'air') sizeOverlayCanvas();
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
  // No re-render needed (grid is chromatic regardless), but if the player
  // is mid-touch we re-snap immediately on the next move.
  savePrefs();
});

rootEl.addEventListener('change', () => {
  renderGrid();
  savePrefs();
});

rangeEl.addEventListener('change', () => {
  renderGrid();
  savePrefs();
});

glideEl.addEventListener('input', () => {
  savePrefs();
});

// Hide the hint after first activity for the rest of the session.
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

// Re-render the grid on resize so the percentage-based labels still align
// with crisp pixel positions on rotation.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderGrid, 120);
});
