/**
 * Accordion: piano keyboard, Stradella bass, and chromatic right-hand
 * button systems with soundfont reed instruments
 * (accordion / harmonica / reed organ / bandoneon).
 */
import {
  midiToName,
  getCtx,
  getMaster,
  resumeIfSuspended,
  setMasterVolume
} from '../shared/audio.js';
import { Keyboard } from '../shared/keyboard.js';
import { setupMidi } from '../shared/midi.js';
import { makePrefs } from '../shared/prefs.js';
import { attachKeyboardInput } from '../shared/input.js';
import { renderStradella } from './stradella.js';
import { renderChromatic } from './chromatic.js';
import { renderDiatonic } from './diatonic.js';
import { Bellows, isBellowsAvailable, isBellowsPermissionRequired } from '../shared/bellows.js';
import { tap as hapticTap } from '../shared/haptics.js';
import { createBreathBus } from './breath-bus.js';
import { AccordionSynth, BUTTON_ACCORDION_TONE } from './accordion-instruments.js';
import { RIGHT_REGISTERS, LEFT_REGISTERS, handForView } from './accordion-registers.js';
import {
  VIEWS,
  MOBILE_VIEW_LABELS,
  portraitMql,
  isMobileViewport,
  effectiveOrientation
} from './accordion-views.js';
import {
  registerPatch,
  initRegisterStrip,
  applyActiveHandRegister
} from './accordion-register-ui.js';

const Prefs = makePrefs('play.accordion.prefs.v1');

// ---------- Page wiring ----------

const stageEl = document.getElementById('accordion-view');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const toneEl = document.getElementById('tone');
const showNotesEl = document.getElementById('show-notes');
const showKbdEl = document.getElementById('show-kbd');
const bellowsControlEl = document.getElementById('bellows-control');
const bellowsToggleEl = document.getElementById('bellows-mode');
const bellowsMeterEl = document.getElementById('bellows-meter');
const bellowsHelpEl = document.querySelector('.bellows-help');
const pianoLayoutEl = document.getElementById('piano-layout');
const bassSizeEl = document.getElementById('bass-size');
const bassFlipEl = document.getElementById('bass-flip');
const chromaticButtonsEl = document.getElementById('chromatic-buttons');
const chromaticFlipEl = document.getElementById('chromatic-flip');
const diatonicTuningEl = document.getElementById('diatonic-tuning');
const viewEl = document.getElementById('view');
const handLabelEl = document.getElementById('register-hand');
const toneStatus = document.getElementById('tone-status');
const midiStatusEl = document.getElementById('midi-status');
const instrumentHelpEl = document.getElementById('instrument-help');

// Collapse the "How to play" panel by default on touch-capable
// devices (iPad Safari is the main offender — it's wider than the
// 720px mobile breakpoint that hides the panel entirely on phones,
// so the always-open desktop layout was eating most of the vertical
// space above the keyboard). Desktop visitors keep the open-by-
// default behaviour.
//
// Detection uses `(any-pointer: coarse)` rather than `(hover: none)`:
// an iPad WITH a Magic Keyboard's trackpad still has a touchscreen
// (so `any-pointer: coarse` is true) but the trackpad makes the
// primary pointer fine and `hover: hover`, so the simpler hover
// check would miss the most common iPad-with-keyboard setup the
// player just hit. `maxTouchPoints > 0` is checked as a UA-side
// fallback for browsers that report `any-pointer` poorly.
const isTouch =
  (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches) ||
  (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
if (instrumentHelpEl && isTouch) {
  instrumentHelpEl.removeAttribute('open');
}

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.tone === 'string') {
  const opt = Array.from(toneEl.options).find((o) => o.value === prefs.tone);
  if (opt) toneEl.value = prefs.tone;
}
if (typeof prefs.pianoLayout === 'string' && pianoLayoutEl) {
  const opt = Array.from(pianoLayoutEl.options).find((o) => o.value === prefs.pianoLayout);
  if (opt) pianoLayoutEl.value = prefs.pianoLayout;
}
if (typeof prefs.bassSize === 'string' && bassSizeEl) {
  const opt = Array.from(bassSizeEl.options).find((o) => o.value === prefs.bassSize);
  if (opt) bassSizeEl.value = prefs.bassSize;
}
if (typeof prefs.bassFlip === 'string' && bassFlipEl) {
  const opt = Array.from(bassFlipEl.options).find((o) => o.value === prefs.bassFlip);
  if (opt) bassFlipEl.value = prefs.bassFlip;
}
if (typeof prefs.chromaticButtons === 'string' && chromaticButtonsEl) {
  const opt = Array.from(chromaticButtonsEl.options).find(
    (o) => o.value === prefs.chromaticButtons
  );
  if (opt) chromaticButtonsEl.value = prefs.chromaticButtons;
}
if (typeof prefs.chromaticFlip === 'string' && chromaticFlipEl) {
  const opt = Array.from(chromaticFlipEl.options).find((o) => o.value === prefs.chromaticFlip);
  if (opt) chromaticFlipEl.value = prefs.chromaticFlip;
}
if (typeof prefs.diatonicTuning === 'string' && diatonicTuningEl) {
  const opt = Array.from(diatonicTuningEl.options).find((o) => o.value === prefs.diatonicTuning);
  if (opt) diatonicTuningEl.value = prefs.diatonicTuning;
}
if (typeof prefs.view === 'string' && viewEl) {
  const opt = Array.from(viewEl.options).find((o) => o.value === prefs.view);
  if (opt) viewEl.value = prefs.view;
}

// Each hand keeps its own register selection so switching between, say,
// piano and Stradella views remembers what reed bank was on either side.
// Migration: the old single `register` pref was always a right-hand id.
if (
  typeof prefs.registerRight === 'string' &&
  RIGHT_REGISTERS.some((r) => r.id === prefs.registerRight)
) {
  registerPatch.activeRightRegisterId = prefs.registerRight;
} else if (
  typeof prefs.register === 'string' &&
  RIGHT_REGISTERS.some((r) => r.id === prefs.register)
) {
  registerPatch.activeRightRegisterId = prefs.register;
}
if (
  typeof prefs.registerLeft === 'string' &&
  LEFT_REGISTERS.some((r) => r.id === prefs.registerLeft)
) {
  registerPatch.activeLeftRegisterId = prefs.registerLeft;
}

if (typeof prefs.showNotes === 'boolean' && showNotesEl) {
  showNotesEl.checked = prefs.showNotes;
}
if (typeof prefs.showKbd === 'boolean' && showKbdEl) {
  showKbdEl.checked = prefs.showKbd;
}

// Construct the BreathBus eagerly so every voice routes through it from
// the start. The bus is transparent (gain=1) until bellows mode is
// activated, at which point bellows.onPressure drives setPressure.
const breathBus = createBreathBus({ ctx: getCtx(), master: getMaster() });
const synth = new AccordionSynth({ destination: breathBus.input });
registerPatch.synth = synth;
setMasterVolume(Number(volumeEl.value) / 100);

/**
 * Standard MIDI-controller / piano-keyboard sizes. Each entry pins the
 * starting note and white-key count so switching the "Layout" select
 * snaps the keyboard to a real instrument's range — no free-form octave
 * picker, just authentic configurations.
 *
 *   25-key C3–C5  (15 whites)  e.g. M-Audio Keystation Mini
 *   37-key C3–C6  (22 whites)  e.g. Akai LPK37, AKAI MPK Mini extended
 *   49-key C2–C6  (29 whites)  e.g. Casio CT-S1, M-Audio Keystation 49
 *   61-key C2–C7  (36 whites)  e.g. Yamaha PSR-E series, MIDIPLUS X6
 */
const PIANO_LAYOUTS = {
  25: { startMidi: 48, whiteKeyCount: 15 },
  37: { startMidi: 48, whiteKeyCount: 22 },
  49: { startMidi: 36, whiteKeyCount: 29 },
  61: { startMidi: 36, whiteKeyCount: 36 }
};

const pianoLayoutFor = () => {
  const id = pianoLayoutEl ? pianoLayoutEl.value : '25';
  return PIANO_LAYOUTS[id] || PIANO_LAYOUTS[25];
};
let { startMidi, whiteKeyCount } = pianoLayoutFor();

let nowPlayingTimer = null;
const announceNote = (midi) => {
  nowPlaying.textContent = midiToName(midi);
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    nowPlaying.classList.remove('active');
  }, 350);
};

// Pre-create one host element per view; we attach exactly one to the stage
// at a time and just keep the others detached. This way each component can
// hold onto its DOM/state without re-rendering on every view switch.
const pianoHostEl = document.createElement('div');
pianoHostEl.className = 'piano-keyboard';
pianoHostEl.id = 'piano-keyboard';

const stradellaHostEl = document.createElement('div');
stradellaHostEl.className = 'stradella-bass';
stradellaHostEl.id = 'stradella-bass';
stradellaHostEl.setAttribute('aria-label', 'Stradella bass buttons');

const chromaticHostEl = document.createElement('div');
chromaticHostEl.className = 'chromatic-keyboard';
chromaticHostEl.id = 'chromatic-keyboard';
chromaticHostEl.setAttribute('aria-label', 'Chromatic right-hand buttons');

const diatonicHostEl = document.createElement('div');
diatonicHostEl.className = 'diatonic-keyboard';
diatonicHostEl.id = 'diatonic-keyboard';
diatonicHostEl.setAttribute('aria-label', 'Diatonic right-hand buttons');

const accordion = new Keyboard(pianoHostEl, {
  startMidi,
  whiteKeyCount,
  synth,
  onActivity: announceNote
});

const applyLabelClasses = () => {
  if (!showNotesEl || !showKbdEl) return;
  pianoHostEl.classList.toggle('hide-notes', !showNotesEl.checked);
  pianoHostEl.classList.toggle('show-kbd', showKbdEl.checked);
};
applyLabelClasses();

const persist = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    tone: toneEl.value,
    pianoLayout: pianoLayoutEl ? pianoLayoutEl.value : '25',
    bassSize: bassSizeEl ? bassSizeEl.value : '120',
    bassFlip: bassFlipEl ? bassFlipEl.value : 'normal',
    chromaticButtons: chromaticButtonsEl ? chromaticButtonsEl.value : '64',
    chromaticFlip: chromaticFlipEl ? chromaticFlipEl.value : 'normal',
    diatonicTuning: diatonicTuningEl ? diatonicTuningEl.value : 'DG',
    view: viewEl ? viewEl.value : 'stradella-standard-h',
    registerRight: registerPatch.activeRightRegisterId,
    registerLeft: registerPatch.activeLeftRegisterId,
    showNotes: showNotesEl ? showNotesEl.checked : true,
    showKbd: showKbdEl ? showKbdEl.checked : false,
    bellowsMode: !!(bellowsToggleEl && bellowsToggleEl.checked)
  });
};

/**
 * Phone-as-bellows wiring. Hidden on devices without DeviceMotion (i.e.
 * desktops). When the toggle flips on:
 *   - On iOS we ask for motion permission inside the change handler so it
 *     counts as a user gesture. If it's denied we silently revert.
 *   - We lazily insert the bellows gain into the audio graph and start
 *     listening for motion. The 0..1 pressure value drives both the gain
 *     and the meter fill.
 *
 * Pressure is *also* multiplied by the master volume slider implicitly,
 * since it sits downstream in the audio graph.
 */
const bellows = new Bellows();
bellows.onPressure = (p) => {
  breathBus.setPressure(p);
  if (bellowsMeterEl) bellowsMeterEl.style.setProperty('--bellows-pressure', String(p));
};
// Bellows turnaround is a pure visual hint for the diatonic view —
// since both push and pull keyboards are always rendered side-by-side,
// the bellows direction doesn't gate which side can sound. We just
// highlight the matching half so the player gets feedback that the
// device is detecting their swing.
bellows.onDirection = (dir) => {
  if (diatonic) diatonic.setBellowsDirection(dir);
};

const setBellowsActive = (on) => {
  if (!bellowsControlEl) return;
  bellowsControlEl.classList.toggle('is-active', on);
  if (on) {
    breathBus.setPressure(0);
    bellows.start();
  } else {
    bellows.stop();
    breathBus.disable();
    if (bellowsMeterEl) bellowsMeterEl.style.setProperty('--bellows-pressure', '0');
  }
};

// Bellows mode only makes sense on a device you can physically swing —
// i.e. a phone (or tablet). On a desktop the `DeviceMotionEvent` API is
// usually present but never fires, so the toggle would be visible but
// silent. We layer four signals because no single one is reliable:
//   - coarse, non-hover pointer: the standard touch-device media
//     query. True on most Android and iOS Safari out of the box, but
//     lies on some Android skins, on Chrome's "desktop mode", and
//     when a stylus or external mouse is paired.
//   - iOS motion-permission API (`requestPermission`): iOS-only, and
//     still present even when iPadOS Safari requests the desktop UA.
//   - `maxTouchPoints > 0`: a phone or tablet has at least one touch
//     point. (Touchscreen laptops also match — acceptable false
//     positive.)
//   - UA sniff for `Android | iPhone | iPad | iPod | Mobile`: the
//     last-resort fallback for the Android skins that misreport hover
//     *and* maxTouchPoints in some configurations.
// Any one match → eligible. Worst case on a touchscreen laptop the
// toggle appears but produces no motion — harmless and reversible.
const isMobileBellowsDevice = () => {
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
  if (isBellowsPermissionRequired()) return true;
  if ((navigator.maxTouchPoints || 0) > 0) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
};

if (bellowsControlEl && isBellowsAvailable() && isMobileBellowsDevice()) {
  bellowsControlEl.hidden = false;
  if (bellowsHelpEl) bellowsHelpEl.hidden = false;
  // Restore previous state — but only auto-enable if no permission prompt
  // is required (otherwise we'd need a user gesture).
  if (prefs.bellowsMode && bellowsToggleEl) {
    if (!isBellowsPermissionRequired()) {
      bellowsToggleEl.checked = true;
      setBellowsActive(true);
    }
  }
}

if (bellowsToggleEl) {
  bellowsToggleEl.addEventListener('change', async () => {
    if (bellowsToggleEl.checked) {
      // iOS requires the permission request to be inside the gesture.
      if (isBellowsPermissionRequired()) {
        const ok = await bellows.requestPermission();
        if (!ok) {
          bellowsToggleEl.checked = false;
          return;
        }
      }
      setBellowsActive(true);
    } else {
      setBellowsActive(false);
      // Clear the visual bellows hint on the diatonic view.
      if (diatonic) diatonic.setBellowsDirection(null);
    }
    persist();
  });
}

initRegisterStrip({ persist });

const updateToneStatus = () => {
  if (!toneStatus) return;
  if (!synth.isReady()) {
    // Loading FLAC samples over the proxy can take a few seconds on
    // the first visit; soundfonts are usually in CDN cache and pop in
    // almost instantly. Differentiating the message helps users
    // understand why one tone takes longer to come up.
    toneStatus.textContent =
      synth.toneName === BUTTON_ACCORDION_TONE ? 'loading samples…' : 'loading…';
  } else if (synth.fallbackFromSamples) {
    toneStatus.textContent = 'samples failed, using soundfont';
  } else {
    toneStatus.textContent = '';
  }
};

const switchTone = (name) => {
  synth.setTone(name);
  updateToneStatus();
  // Poll for ready since loadInstrument is cached and won't retrigger.
  let pollAttempts = 0;
  const poll = setInterval(() => {
    pollAttempts += 1;
    if (synth.isReady() || pollAttempts > 40) {
      clearInterval(poll);
      updateToneStatus();
    }
  }, 200);
};

switchTone(toneEl.value);

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  persist();
});

toneEl.addEventListener('change', () => {
  switchTone(toneEl.value);
  persist();
});

if (showNotesEl) {
  showNotesEl.addEventListener('change', () => {
    applyLabelClasses();
    persist();
  });
}
if (showKbdEl) {
  showKbdEl.addEventListener('change', () => {
    applyLabelClasses();
    persist();
  });
}

const applyPianoLayout = () => {
  const cfg = pianoLayoutFor();
  startMidi = cfg.startMidi;
  whiteKeyCount = cfg.whiteKeyCount;
  accordion.setStartMidi(startMidi);
  accordion.setWhiteKeyCount(whiteKeyCount);
};

if (pianoLayoutEl) {
  pianoLayoutEl.addEventListener('change', () => {
    applyPianoLayout();
    persist();
  });
}
applyPianoLayout();

if (bassSizeEl) {
  bassSizeEl.addEventListener('change', () => {
    stradella.setSize(bassSizeEl.value);
    persist();
  });
}

if (bassFlipEl) {
  bassFlipEl.addEventListener('change', () => {
    stradella.setFlip(bassFlipEl.value);
    persist();
  });
}

if (chromaticButtonsEl) {
  chromaticButtonsEl.addEventListener('change', () => {
    chromatic.setLayout(chromaticButtonsEl.value);
    persist();
  });
}

if (chromaticFlipEl) {
  chromaticFlipEl.addEventListener('change', () => {
    chromatic.setFlip(chromaticFlipEl.value);
    persist();
  });
}

if (diatonicTuningEl) {
  diatonicTuningEl.addEventListener('change', () => {
    diatonic.setTuning(diatonicTuningEl.value);
    persist();
  });
}

// Pre-warm the soundfont on first user interaction.
const warm = () => {
  switchTone(toneEl.value);
  document.removeEventListener('pointerdown', warm);
  document.removeEventListener('keydown', warm);
};
document.addEventListener('pointerdown', warm, { once: true });
document.addEventListener('keydown', warm, { once: true });

// No sustain control: a real accordion only sustains while the key is
// physically held (and the bellows are moving), so we pass `null` and let
// the input handler skip its sustain logic.
//
// No octave shift either: standard piano-accordion sizes already pin the
// note range, and the user picks a Layout to change it. The Keyboard
// arrow shortcuts simply do nothing on this page.
attachKeyboardInput({
  keyboard: accordion,
  synth,
  sustainEl: null,
  announceNote,
  shiftOctave: null
});

setupMidi({
  statusEl: midiStatusEl,
  onNoteOn: (note) => {
    synth.noteOn(note);
    accordion.pressVisual(note, true);
    announceNote(note);
  },
  onNoteOff: (note) => {
    synth.noteOff(note);
    accordion.pressVisual(note, false);
  }
});

// ---------- Stradella + Chromatic components ----------
//
// The Stradella is the LEFT (bass) side of the accordion, and the
// chromatic button board is the RIGHT (treble) side. We tell the synth
// which side a press came from so it can route bass and chord notes
// to the dedicated bass-reed voice when the FreePats sample tone is
// active. For every other tone the side hint is ignored and both
// hands play the same voice.

const leftHandHandlers = {
  onPress: (notes) => {
    for (const m of notes) synth.noteOn(m, { side: 'left' });
  },
  onRelease: (notes) => {
    for (const m of notes) synth.noteOff(m, { side: 'left' });
  },
  onActivity: announceNote
};

const rightHandHandlers = {
  onPress: (notes) => {
    for (const m of notes) synth.noteOn(m);
  },
  onRelease: (notes) => {
    for (const m of notes) synth.noteOff(m);
  },
  onActivity: announceNote
};

const stradella = renderStradella(stradellaHostEl, {
  initialLayout: 'standard',
  orientation: 'horizontal',
  size: bassSizeEl ? bassSizeEl.value : '120',
  flip: bassFlipEl ? bassFlipEl.value : 'normal',
  ...leftHandHandlers
});

const chromatic = renderChromatic(chromaticHostEl, {
  orientation: 'horizontal',
  system: 'B',
  layout: chromaticButtonsEl ? chromaticButtonsEl.value : 64,
  flip: chromaticFlipEl ? chromaticFlipEl.value : 'normal',
  ...rightHandHandlers
});

// Two side-by-side keyboards (PUSH + PULL). The renderer enforces
// mutex internally so only one half can sound at a time, mirroring a
// real bellows. Bellows direction (when phone bellows mode is on) is
// fed in as a pure visual hint via setBellowsDirection().
const diatonic = renderDiatonic(diatonicHostEl, {
  orientation: 'horizontal',
  tuning: diatonicTuningEl ? diatonicTuningEl.value : 'DG',
  ...rightHandHandlers
});

// Tracks which hand's register set is currently displayed/applied. Set by
// `setView()` whenever the active view changes.

const setView = (viewId) => {
  const cfg = VIEWS[viewId];
  if (!cfg) return;

  // Drop visual state from whichever view we're leaving.
  stradella.clearActive();
  chromatic.clearActive();
  diatonic.clearActive();

  // Tag the stage so CSS can size each layout differently.
  stageEl.dataset.view = viewId;
  stageEl.dataset.kind = cfg.kind;

  // Hide controls that aren't relevant to this view.
  document.querySelectorAll('[data-only-for]').forEach((el) => {
    const only = el.getAttribute('data-only-for');
    el.hidden = only !== cfg.kind;
  });

  // Switch the register strip to whichever hand owns this view, and apply
  // that hand's last-used register to the synth.
  const hand = handForView(cfg);
  if (hand !== registerPatch.currentHand) {
    registerPatch.currentHand = hand;
  }
  applyActiveHandRegister();
  if (handLabelEl) {
    handLabelEl.textContent = hand === 'left' ? 'Left hand' : 'Right hand';
  }

  const orientation = effectiveOrientation(cfg);

  // Detach old, attach new — and re-configure the chosen component.
  while (stageEl.firstChild) stageEl.removeChild(stageEl.firstChild);
  if (cfg.kind === 'stradella') {
    stradella.setLayout(cfg.layout);
    stradella.setOrientation(orientation);
    if (bassSizeEl) stradella.setSize(bassSizeEl.value);
    stageEl.appendChild(stradellaHostEl);
  } else if (cfg.kind === 'chromatic') {
    chromatic.setSystem(cfg.system);
    chromatic.setOrientation(orientation);
    if (chromaticButtonsEl) chromatic.setLayout(chromaticButtonsEl.value);
    stageEl.appendChild(chromaticHostEl);
  } else if (cfg.kind === 'diatonic') {
    diatonic.setOrientation(orientation);
    if (diatonicTuningEl) diatonic.setTuning(diatonicTuningEl.value);
    stageEl.appendChild(diatonicHostEl);
  } else {
    stageEl.appendChild(pianoHostEl);
  }
};

if (viewEl) {
  viewEl.addEventListener('change', () => {
    setView(viewEl.value);
    persist();
  });
}

const updateViewOptions = () => {
  if (!viewEl) return;
  const mobile = isMobileViewport();
  const options = viewEl.querySelectorAll('option');
  options.forEach((opt) => {
    if (!opt.dataset.desktopLabel) opt.dataset.desktopLabel = opt.textContent;
    if (mobile) {
      // Hide the -v twins; they'd produce the same render anyway.
      const isVerticalDup = opt.value.endsWith('-v');
      opt.hidden = isVerticalDup;
      opt.disabled = isVerticalDup;
      const mobileLabel = MOBILE_VIEW_LABELS[opt.value];
      if (mobileLabel) opt.textContent = mobileLabel;
    } else {
      opt.hidden = false;
      opt.disabled = false;
      opt.textContent = opt.dataset.desktopLabel;
    }
  });

  // If the saved selection is a now-hidden -v variant, fold it onto its
  // -h sibling so the dropdown shows something sensible. (Auto-orientation
  // means the rendered layout is already correct either way.)
  if (mobile && viewEl.selectedOptions[0]?.hidden) {
    const fallback = viewEl.value.replace(/-v$/, '-h');
    if (VIEWS[fallback]) viewEl.value = fallback;
  }
};

// Re-render whenever the device flips orientation or crosses the mobile
// breakpoint, so a portrait-locked phone always sees the vertical layout.
const reapplyView = () => {
  updateViewOptions();
  if (viewEl) setView(viewEl.value);
};
portraitMql.addEventListener('change', reapplyView);
let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(reapplyView);
});

updateViewOptions();
setView(viewEl ? viewEl.value : 'stradella-standard-h');

// Drop in-flight presses if the page loses focus.
window.addEventListener('blur', () => {
  stradella.clearActive();
  chromatic.clearActive();
  diatonic.clearActive();
});
