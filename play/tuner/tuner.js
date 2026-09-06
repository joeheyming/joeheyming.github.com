/**
 * Chromatic / preset tuner page.
 *
 * Two coexisting input modes:
 *   1. Mic-driven detection: getUserMedia → MediaStreamSource →
 *      PitchDetector (autocorrelation) → animation-frame loop that
 *      renders the carousel + dial + readout. The mic feeds the
 *      analyser only — never `ctx.destination` — so reference tones
 *      below don't loop back through it.
 *   2. Tap-to-hear reference pitches: 12 chromatic note buttons + an
 *      octave selector trigger a sustained sine via the shared master
 *      gain. Optional "clamp to speaker octave" forces playback into
 *      the C5–B5 range so phone speakers can actually reproduce it.
 *
 * Two coexisting target modes:
 *   - AUTO: cents-off measured against the nearest equal-tempered note
 *     (modulo the chosen temperament's per-pc offset). The carousel
 *     tracks the detected note.
 *   - LOCKED: cents-off measured against a single fixed MIDI target
 *     (chosen via the string-tab row). The carousel freezes on that
 *     target so the user sees what they're aiming for; the dial shows
 *     how far the detected pitch is from it (can swing wildly).
 *
 * The two are crossed: AUTO carousel + AUTO dial, or LOCKED carousel +
 * LOCKED dial. State changes re-render the affected pieces only.
 */
import {
  beginAudioCapture,
  endAudioCapture,
  getCtx,
  getMaster,
  resumeIfSuspended,
  setMasterVolume
} from '../shared/audio.js';
import { makePrefs } from '../shared/prefs.js';
import {
  PitchDetector,
  freqToNoteInfo,
  midiToFreq,
  midiToDisplayName,
  midiFromPcOctave,
  TEMPERAMENTS,
  NOTE_NAMINGS
} from '../shared/pitch-detector.js';

const Prefs = makePrefs('play.tuner.prefs.v2');

const IN_TUNE_CENTS = 5;
const IN_TUNE_HOLD_MS = 1200; // sustained inside IN_TUNE_CENTS before it counts
const NEEDLE_RANGE_CENTS = 100; // dial spans ±100 ¢
const SMOOTHING_FRAMES = 5;
const STALE_DETECTION_MS = 250;

const REF_OCTAVE_MIN = 2;
const REF_OCTAVE_MAX = 5;
const CLAMP_OCTAVE = 5; // when "clamp to speaker octave" is on, all refs play here

// ---------- Instrument presets ----------------------------------------
//
// `strings` lists open-string MIDI numbers, ordered as the player
// usually thinks of them (low → high for guitar/bass/cello/violin;
// re-entrant high G first for ukulele; 5-string drone first for banjo).
// MIDI reference points: C1=24, C2=36, C3=48, C4=60, C5=72, A4=69.

const INSTRUMENTS = {
  chromatic: { label: 'Chromatic', strings: null },
  guitar: {
    // EADGBE — 6-string standard.
    label: 'Guitar',
    strings: [40, 45, 50, 55, 59, 64]
  },
  bass: {
    // EADG — 4-string standard. 5-string low B (~31 Hz) is below the
    // pitch detector's MIN_FREQ_HZ floor and intentionally not offered.
    label: 'Bass',
    strings: [28, 33, 38, 43]
  },
  ukulele: {
    // gCEA — re-entrant: 4th string is a *high* G above middle C.
    label: 'Ukulele',
    strings: [67, 60, 64, 69]
  },
  violin: {
    // GDAE — open strings at perfect fifths.
    label: 'Violin',
    strings: [55, 62, 69, 76]
  },
  viola: {
    // CGDA — same shape as violin, transposed a fifth lower.
    label: 'Viola',
    strings: [48, 55, 62, 69]
  },
  cello: {
    // CGDA — viola transposed an octave lower.
    label: 'Cello',
    strings: [36, 43, 50, 57]
  },
  mandolin: {
    // GDAE — same pitches as violin (4 paired courses).
    label: 'Mandolin',
    strings: [55, 62, 69, 76]
  },
  banjo: {
    // gDGBD — 5-string open-G, the 5th string is a high drone above
    // the others (so it's listed first in playing order).
    label: 'Banjo',
    strings: [67, 50, 55, 59, 62]
  }
};

// ---------- DOM lookups -----------------------------------------------

const cardEl = document.getElementById('tuner-card');
const stringTabsEl = document.getElementById('string-tabs');
const stringTabRowEl = document.getElementById('string-tab-row');
const autoToggleEl = document.getElementById('auto-toggle');
const carouselEl = document.getElementById('note-carousel');
const carouselSlots = Array.from(carouselEl.querySelectorAll('.carousel-note'));
const carouselNameEl = document.getElementById('carousel-note-name');
const carouselOctaveEl = document.getElementById('carousel-note-octave');
const armEl = document.getElementById('tuner-arm');
const dialTargetEl = document.getElementById('dial-target');
const centsEl = document.getElementById('tuner-cents');
const freqEl = document.getElementById('tuner-freq');
const statusPillEl = document.getElementById('tuner-status-pill');
const micBtn = document.getElementById('mic-toggle');
const micBtnLabel = micBtn.querySelector('.btn-label');
const micBtnIcon = micBtn.querySelector('.btn-icon');
const fallbackEl = document.getElementById('tuner-fallback');
const fallbackTitleEl = document.getElementById('fallback-title');
const fallbackMsgEl = document.getElementById('fallback-message');
const fallbackRetryEl = document.getElementById('fallback-retry');
const referenceSectionEl = document.getElementById('reference-section');
const refGridEl = document.getElementById('reference-grid');
const refOctDisplayEl = document.getElementById('ref-oct-display');
const refOctDownEl = document.getElementById('ref-oct-down');
const refOctUpEl = document.getElementById('ref-oct-up');
const refClampEl = document.getElementById('ref-clamp');
const instrumentSelectEl = document.getElementById('instrument-select');
const temperamentSelectEl = document.getElementById('temperament-select');
const namingSelectEl = document.getElementById('naming-select');
const a4El = document.getElementById('a4-ref');
const volumeEl = document.getElementById('volume');
const nowPlayingEl = document.getElementById('now-playing');

// ---------- State -----------------------------------------------------

const prefs = Prefs.load();
let instrumentKey = INSTRUMENTS[prefs.instrument] ? prefs.instrument : 'chromatic';
let lockedMidi = typeof prefs.lockedMidi === 'number' ? prefs.lockedMidi : null;
let temperament = TEMPERAMENTS[prefs.temperament] ? prefs.temperament : 'equal';
let naming = NOTE_NAMINGS[prefs.naming] ? prefs.naming : 'english';
let a4Ref = clampA4(prefs.a4 ?? 440);
let refOctave = clampOctave(prefs.refOctave ?? 4);
let volume = typeof prefs.volume === 'number' ? prefs.volume : 55;
let clampReference = !!prefs.clampReference;

// If the saved locked-string isn't in the saved instrument's tuning,
// drop the lock to avoid showing a target the user can't see.
if (lockedMidi != null && !instrumentHasMidi(instrumentKey, lockedMidi)) {
  lockedMidi = null;
}

setMasterVolume(volume / 100);

function clampA4(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 440;
  return Math.min(466, Math.max(415, Math.round(n)));
}

function clampOctave(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 4;
  return Math.min(REF_OCTAVE_MAX, Math.max(REF_OCTAVE_MIN, Math.round(n)));
}

function instrumentHasMidi(key, midi) {
  const strings = INSTRUMENTS[key]?.strings;
  return Array.isArray(strings) && strings.includes(midi);
}

function savePrefs() {
  Prefs.save({
    instrument: instrumentKey,
    lockedMidi,
    temperament,
    naming,
    a4: a4Ref,
    refOctave,
    volume,
    clampReference
  });
}

// ---------- Mic detection ---------------------------------------------

let mediaStream = null;
let sourceNode = null;
let detector = null;
let rafId = null;
let listening = false;
// Tracks the beginAudioCapture() claim so it is released exactly once,
// whether the mic request fails or the user stops listening.
let captureHeld = false;
let lastDetectionAt = 0;
let lastRenderedMidi = null;
// Tracked as a timestamp rather than a timeout: the render loop already
// ticks every frame, and a pitch that drifts out of tolerance has to
// restart the hold from zero.
let inTuneSince = 0;
let inTuneAwarded = false;
let detectionAwarded = false;
const recentFreqs = [];

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function updateMicButton() {
  micBtn.setAttribute('aria-pressed', listening ? 'true' : 'false');
  micBtnLabel.textContent = listening ? 'Stop listening' : 'Start listening';
  micBtnIcon.textContent = listening ? '■' : '🎤';
}

function showFallback({ title, message, html, retry = false }) {
  fallbackTitleEl.textContent = title;
  if (html) fallbackMsgEl.innerHTML = html;
  else fallbackMsgEl.textContent = message ?? '';
  fallbackRetryEl.hidden = !retry;
  fallbackEl.hidden = false;
}

function hideFallback() {
  fallbackEl.hidden = true;
}

function buildMicUnavailableCard() {
  const isLocalHostLike =
    /^(localhost|127\.|::1$|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/.test(
      location.hostname
    );
  const insecure = !window.isSecureContext;
  if (insecure && isLocalHostLike) {
    return {
      title: 'Tuner needs a trusted dev cert',
      html:
        "Your phone doesn't trust this dev server's certificate yet, so the browser blocks microphone access. " +
        '<a href="/dev-ca.pem" download="dev-ca.pem">Download the dev CA</a>, ' +
        'install it under <em>Settings → Security → Install a certificate → CA</em>, then reload.'
    };
  }
  if (insecure) {
    return {
      title: 'Tuner needs HTTPS',
      message:
        'Microphone access is only allowed from a secure (https://) origin. Open this page over HTTPS and try again.'
    };
  }
  return {
    title: "Microphone API isn't available here",
    message:
      'This browser blocks the mic API. Try Chrome on Android, Safari on iOS, or a desktop browser.'
  };
}

function releaseCapture() {
  if (!captureHeld) return;
  captureHeld = false;
  endAudioCapture();
}

async function startListening() {
  if (listening) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showFallback(buildMicUnavailableCard());
    return;
  }
  hideFallback();
  micBtn.disabled = true;
  micBtnLabel.textContent = 'Starting…';
  try {
    resumeIfSuspended();
    const ctx = getCtx();
    // Hand back the `playback` audio session first: iOS rejects mic capture
    // outright while the page holds it, and the rejection surfaces as a
    // permission error the user cannot fix. Reference tones are muted by the
    // ringer switch while we listen, which is the documented trade.
    beginAudioCapture();
    captureHeld = true;
    // Disable browser voice-call DSP — those flatten transients and shift
    // pitch; a tuner cannot tolerate them.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    mediaStream = stream;
    sourceNode = ctx.createMediaStreamSource(stream);
    detector = new PitchDetector({ ctx, source: sourceNode });
    listening = true;
    lastDetectionAt = performance.now();
    recentFreqs.length = 0;
    cardEl.dataset.state = 'listening';
    statusPillEl.dataset.status = 'listening';
    statusPillEl.textContent = 'Listening';
    nowPlayingEl.textContent = 'Listening';
    nowPlayingEl.classList.add('active');
    updateMicButton();
    micBtn.disabled = false;
    rafId = requestAnimationFrame(loop);
  } catch (err) {
    releaseCapture();
    micBtn.disabled = false;
    updateMicButton();
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      showFallback({
        title: 'Microphone blocked',
        message:
          "The tuner needs mic access. Allow it in your browser's site settings, then tap Retry.",
        retry: true
      });
    } else if (err && err.name === 'NotFoundError') {
      showFallback({
        title: 'No microphone found',
        message:
          "We couldn't find a microphone on this device. Reference pitches still work below.",
        retry: true
      });
    } else {
      showFallback({
        title: "Couldn't start the mic",
        message: err && err.message ? err.message : 'An unknown error occurred.',
        retry: true
      });
    }
  }
}

function stopListening() {
  if (!listening && !mediaStream) return;
  listening = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (detector) {
    detector.dispose();
    detector = null;
  }
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (_) {
      /* ignore */
    }
    sourceNode = null;
  }
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
    mediaStream = null;
  }
  releaseCapture();
  cardEl.dataset.state = 'idle';
  statusPillEl.dataset.status = 'idle';
  statusPillEl.textContent = 'Idle';
  centsEl.textContent = '— ¢';
  freqEl.textContent = 'Tap Start to listen';
  armEl.style.setProperty('--needle', '0');
  nowPlayingEl.textContent = '—';
  nowPlayingEl.classList.remove('active');
  recentFreqs.length = 0;
  lastRenderedMidi = null;
  inTuneSince = 0;
  renderInitialCarousel();
  renderTargetText(null);
  micBtn.disabled = false;
  updateMicButton();
}

function loop() {
  if (!listening || !detector) return;
  const result = detector.read();
  const now = performance.now();
  if (result) {
    recentFreqs.push(result.frequency);
    if (recentFreqs.length > SMOOTHING_FRAMES) recentFreqs.shift();
    lastDetectionAt = now;
    renderDetection(median(recentFreqs));
  } else if (now - lastDetectionAt > STALE_DETECTION_MS) {
    if (recentFreqs.length) recentFreqs.length = 0;
    renderListeningIdle();
  }
  rafId = requestAnimationFrame(loop);
}

function renderListeningIdle() {
  inTuneSince = 0;
  centsEl.textContent = '— ¢';
  freqEl.textContent = 'Play a single sustained note';
  armEl.style.setProperty('--needle', '0');
  cardEl.dataset.state = 'listening';
  statusPillEl.dataset.status = 'listening';
  statusPillEl.textContent = 'Listening';
  // In auto mode, blank the carousel until the next detection. In
  // locked mode the carousel stays pinned to the target — nothing to
  // do.
  if (lockedMidi == null) {
    lastRenderedMidi = null;
    renderInitialCarousel();
    renderTargetText(null);
  }
}

function renderDetection(freq) {
  if (freq == null || !Number.isFinite(freq)) return;
  const targetMidi = lockedMidi != null ? lockedMidi : null;
  const info = freqToNoteInfo(freq, { a4: a4Ref, temperament, targetMidi });
  if (!info) return;

  // Tuning by ear off the reference tone is optional, so a mic-only session
  // has to be able to earn level 1 or the in-tune unlock stays gated.
  if (!detectionAwarded) {
    detectionAwarded = true;
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  }

  // Carousel: AUTO tracks detected note; LOCKED stays pinned to target.
  const carouselMidi = lockedMidi != null ? lockedMidi : info.midi;
  if (carouselMidi !== lastRenderedMidi) {
    renderCarousel(carouselMidi, /* flash */ lastRenderedMidi != null);
    lastRenderedMidi = carouselMidi;
  }

  const cents = info.cents;
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
  centsEl.textContent = `${sign}${Math.abs(cents)} ¢`;
  freqEl.textContent = `${freq.toFixed(1)} Hz`;
  renderTargetText(info.targetFreq);

  const needle = Math.max(-1, Math.min(1, cents / NEEDLE_RANGE_CENTS));
  armEl.style.setProperty('--needle', needle.toFixed(3));

  if (Math.abs(cents) <= IN_TUNE_CENTS) {
    cardEl.dataset.state = 'in-tune';
    statusPillEl.dataset.status = 'in-tune';
    statusPillEl.textContent = 'In tune';
    const now = performance.now();
    if (!inTuneSince) inTuneSince = now;
    if (!inTuneAwarded && now - inTuneSince >= IN_TUNE_HOLD_MS) {
      inTuneAwarded = true;
      window.heymingAchievements?.unlockForCurrentApp('in-tune');
    }
  } else {
    inTuneSince = 0;
    cardEl.dataset.state = 'listening';
    if (cents < 0) {
      statusPillEl.dataset.status = 'flat';
      statusPillEl.textContent = 'Flat ◀';
    } else {
      statusPillEl.dataset.status = 'sharp';
      statusPillEl.textContent = '▶ Sharp';
    }
  }

  const display = midiToDisplayName(info.midi, naming);
  nowPlayingEl.textContent = `${display.name}${display.octave} · ${sign}${Math.abs(cents)}¢`;
}

// ---------- Carousel rendering ----------------------------------------

function renderCarousel(centerMidi, flash = false) {
  for (const slot of carouselSlots) {
    const offset = Number(slot.dataset.slot);
    const midi = centerMidi + offset;
    if (offset === 0) {
      const display = midiToDisplayName(midi, naming);
      carouselNameEl.textContent = display.name;
      carouselOctaveEl.textContent = String(display.octave);
      if (flash) {
        slot.classList.remove('flash');
        // Force reflow so re-adding the class restarts the animation.
        void slot.offsetWidth;
        slot.classList.add('flash');
      }
    } else {
      const display = midiToDisplayName(midi, naming);
      slot.textContent = display.name;
    }
  }
}

function renderInitialCarousel() {
  if (lockedMidi != null) {
    renderCarousel(lockedMidi);
  } else {
    for (const slot of carouselSlots) {
      if (slot.dataset.slot === '0') {
        carouselNameEl.textContent = '—';
        carouselOctaveEl.textContent = '';
      } else {
        slot.textContent = '—';
      }
    }
  }
}

function renderTargetText(targetFreq) {
  if (targetFreq == null) {
    if (lockedMidi != null) {
      const target = midiToFreq(lockedMidi, { a4: a4Ref, temperament });
      dialTargetEl.textContent = `TARGET ${target.toFixed(1)} Hz`;
    } else {
      dialTargetEl.textContent = 'TARGET —';
    }
    return;
  }
  dialTargetEl.textContent = `TARGET ${targetFreq.toFixed(1)} Hz`;
}

// ---------- String tabs / instrument & lock state ---------------------

function renderStringTabs() {
  const config = INSTRUMENTS[instrumentKey];
  if (!config?.strings) {
    stringTabsEl.hidden = true;
    stringTabRowEl.innerHTML = '';
    return;
  }
  stringTabsEl.hidden = false;
  stringTabRowEl.innerHTML = '';
  for (const midi of config.strings) {
    const display = midiToDisplayName(midi, naming);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'string-tab';
    btn.dataset.midi = String(midi);
    const name = document.createElement('span');
    name.textContent = display.name;
    const oct = document.createElement('sub');
    oct.textContent = String(display.octave);
    btn.appendChild(name);
    btn.appendChild(oct);
    btn.setAttribute('aria-label', `Lock target to ${display.name} octave ${display.octave}`);
    btn.setAttribute('aria-pressed', lockedMidi === midi ? 'true' : 'false');
    btn.addEventListener('click', () => {
      // Tap the currently-locked string to unlock; tap any other to switch lock.
      setLockedMidi(lockedMidi === midi ? null : midi);
    });
    stringTabRowEl.appendChild(btn);
  }
  autoToggleEl.setAttribute('aria-pressed', lockedMidi == null ? 'true' : 'false');
}

function refreshStringTabPressed() {
  for (const btn of stringTabRowEl.children) {
    const m = Number(btn.dataset.midi);
    btn.setAttribute('aria-pressed', lockedMidi === m ? 'true' : 'false');
  }
  autoToggleEl.setAttribute('aria-pressed', lockedMidi == null ? 'true' : 'false');
}

function setInstrument(key) {
  if (!INSTRUMENTS[key]) return;
  instrumentKey = key;
  // If the previously locked string isn't in the new tuning, drop the lock.
  if (lockedMidi != null && !instrumentHasMidi(key, lockedMidi)) {
    lockedMidi = null;
  }
  renderStringTabs();
  // Auto-pin carousel to the lock if any; otherwise blank it.
  lastRenderedMidi = null;
  renderInitialCarousel();
  renderTargetText(null);
  // Re-render last detection against the new lock state.
  if (recentFreqs.length) renderDetection(median(recentFreqs));
  savePrefs();
}

function setLockedMidi(midi) {
  lockedMidi = midi;
  refreshStringTabPressed();
  lastRenderedMidi = null;
  renderInitialCarousel();
  renderTargetText(null);
  if (recentFreqs.length) renderDetection(median(recentFreqs));
  savePrefs();
}

// ---------- Reference-pitch buttons ------------------------------------

let activeRefBtn = null;
let activeRefVoice = null; // { osc, gain }

function effectiveRefMidi(pc) {
  // When clamping, snap every reference into a single speaker-friendly
  // octave so phone speakers can actually reproduce the low notes.
  const oct = clampReference ? CLAMP_OCTAVE : refOctave;
  return midiFromPcOctave(pc, oct);
}

function stopRefVoice({ immediate = false } = {}) {
  if (!activeRefVoice) return;
  const { osc, gain } = activeRefVoice;
  const ctx = getCtx();
  const now = ctx.currentTime;
  try {
    gain.gain.cancelScheduledValues(now);
    if (immediate) {
      gain.gain.setValueAtTime(0, now);
    } else {
      gain.gain.setTargetAtTime(0, now, 0.05);
    }
    osc.stop(now + 0.4);
  } catch (_) {
    /* ignore */
  }
  activeRefVoice = null;
  if (activeRefBtn) {
    activeRefBtn.setAttribute('aria-pressed', 'false');
    activeRefBtn = null;
  }
}

function startRefVoice(midi, btn) {
  resumeIfSuspended();
  const ctx = getCtx();
  const master = getMaster();
  const freq = midiToFreq(midi, { a4: a4Ref, temperament });

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.45, now + 0.04);
  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  window.heymingAchievements?.unlockForCurrentApp('first-action');

  activeRefVoice = { osc, gain };
  activeRefBtn = btn;
  btn.setAttribute('aria-pressed', 'true');
}

function buildReferenceGrid() {
  refGridEl.innerHTML = '';
  for (let pc = 0; pc < 12; pc++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ref-btn';
    if (pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10) {
      btn.classList.add('is-sharp');
    }
    btn.dataset.pc = String(pc);
    btn.setAttribute('aria-pressed', 'false');
    refreshRefBtnLabel(btn);
    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const wasActive = activeRefBtn === btn;
      stopRefVoice({ immediate: wasActive });
      if (!wasActive) startRefVoice(effectiveRefMidi(pc), btn);
    });
    refGridEl.appendChild(btn);
  }
}

function refreshRefBtnLabel(btn) {
  const pc = Number(btn.dataset.pc);
  const midi = effectiveRefMidi(pc);
  const display = midiToDisplayName(midi, naming);
  btn.textContent = display.name;
  btn.setAttribute('aria-label', `Play reference ${display.name} octave ${display.octave}`);
}

function refreshAllRefBtnLabels() {
  for (const btn of refGridEl.children) refreshRefBtnLabel(btn);
}

function retuneActiveRefVoice() {
  if (!activeRefVoice || !activeRefBtn) return;
  const pc = Number(activeRefBtn.dataset.pc);
  const freq = midiToFreq(effectiveRefMidi(pc), { a4: a4Ref, temperament });
  activeRefVoice.osc.frequency.setTargetAtTime(freq, getCtx().currentTime, 0.02);
}

// ---------- Population / wiring ---------------------------------------

function populateInstrumentSelect() {
  instrumentSelectEl.innerHTML = '';
  for (const [key, cfg] of Object.entries(INSTRUMENTS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = cfg.label;
    instrumentSelectEl.appendChild(opt);
  }
  instrumentSelectEl.value = instrumentKey;
}

function populateTemperamentSelect() {
  temperamentSelectEl.innerHTML = '';
  for (const [key, cfg] of Object.entries(TEMPERAMENTS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = cfg.label;
    temperamentSelectEl.appendChild(opt);
  }
  temperamentSelectEl.value = temperament;
}

function refreshClampUi() {
  refClampEl.checked = clampReference;
  referenceSectionEl.dataset.clamped = clampReference ? 'true' : 'false';
  refOctDisplayEl.textContent = clampReference ? String(CLAMP_OCTAVE) : String(refOctave);
}

function wire() {
  instrumentSelectEl.addEventListener('change', () => {
    setInstrument(instrumentSelectEl.value);
  });
  temperamentSelectEl.addEventListener('change', () => {
    temperament = temperamentSelectEl.value;
    refreshAllRefBtnLabels();
    retuneActiveRefVoice();
    if (recentFreqs.length) renderDetection(median(recentFreqs));
    renderTargetText(null);
    savePrefs();
  });
  namingSelectEl.addEventListener('change', () => {
    naming = namingSelectEl.value;
    renderStringTabs();
    refreshAllRefBtnLabels();
    if (lockedMidi != null) {
      renderCarousel(lockedMidi);
    } else if (lastRenderedMidi != null) {
      renderCarousel(lastRenderedMidi);
    } else {
      renderInitialCarousel();
    }
    if (recentFreqs.length) renderDetection(median(recentFreqs));
    savePrefs();
  });
  a4El.addEventListener('change', () => {
    a4Ref = clampA4(a4El.value);
    a4El.value = String(a4Ref);
    retuneActiveRefVoice();
    if (recentFreqs.length) renderDetection(median(recentFreqs));
    renderTargetText(null);
    savePrefs();
  });
  volumeEl.addEventListener('input', () => {
    volume = Number(volumeEl.value);
    setMasterVolume(volume / 100);
    savePrefs();
  });
  micBtn.addEventListener('click', () => {
    if (listening) stopListening();
    else startListening();
  });
  fallbackRetryEl.addEventListener('click', () => {
    hideFallback();
    startListening();
  });
  autoToggleEl.addEventListener('click', () => {
    setLockedMidi(null);
  });
  refOctDownEl.addEventListener('click', () => {
    if (clampReference || refOctave <= REF_OCTAVE_MIN) return;
    refOctave -= 1;
    refOctDisplayEl.textContent = String(refOctave);
    refreshAllRefBtnLabels();
    retuneActiveRefVoice();
    savePrefs();
  });
  refOctUpEl.addEventListener('click', () => {
    if (clampReference || refOctave >= REF_OCTAVE_MAX) return;
    refOctave += 1;
    refOctDisplayEl.textContent = String(refOctave);
    refreshAllRefBtnLabels();
    retuneActiveRefVoice();
    savePrefs();
  });
  refClampEl.addEventListener('change', () => {
    clampReference = refClampEl.checked;
    refreshClampUi();
    refreshAllRefBtnLabels();
    retuneActiveRefVoice();
    savePrefs();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopListening();
      stopRefVoice({ immediate: true });
    } else {
      resumeIfSuspended();
    }
  });
  window.addEventListener('focus', () => resumeIfSuspended());
  window.addEventListener('beforeunload', () => {
    stopListening();
    stopRefVoice({ immediate: true });
  });
}

// ---------- Init ------------------------------------------------------

a4El.value = String(a4Ref);
volumeEl.value = String(volume);
namingSelectEl.value = naming;
populateInstrumentSelect();
populateTemperamentSelect();
buildReferenceGrid();
refreshClampUi();
renderStringTabs();
renderInitialCarousel();
renderTargetText(null);
updateMicButton();
wire();
