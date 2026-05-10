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
  setMasterVolume,
  SampleVoice
} from '../shared/audio.js';
import { MultiSampler } from '../shared/samples.js';
import { Keyboard } from '../shared/keyboard.js';
import { setupMidi } from '../shared/midi.js';
import { makePrefs } from '../shared/prefs.js';
import { attachKeyboardInput } from '../shared/input.js';
import { renderStradella } from './stradella.js';
import { renderChromatic } from './chromatic.js';
import { Bellows, isBellowsAvailable, isBellowsPermissionRequired } from '../shared/bellows.js';
import { tap as hapticTap } from '../shared/haptics.js';
import { createBreathBus } from './breath-bus.js';

/**
 * Tone identifier for the FreePats Button Accordion HN sample pack
 * (CC0 public domain). The pack records 16 single-reed notes spanning
 * B3-G6 — i.e. only the right-hand treble register. MultiSampler picks
 * the closest anchor and detunes via playbackRate.
 *
 * Because the lowest recorded sample is B3 (MIDI 59), every note below
 * B3 would have to be produced by slowing that sample down. By G2
 * (Stradella bass) that's a 16-semitone pitch drop, ~40% playback
 * speed — formants and breath transients drag with the pitch and the
 * note stops sounding like a reed at all. Nothing in the pack is
 * actually "deep" — there is no bass-reed recording in it.
 *
 * Architecture: this is exactly how a real piano accordion is built.
 * Left-hand bass and chord buttons trigger a physically separate set
 * of bass reeds; the right-hand treble keys trigger treble reeds. So
 * we mirror that: the **right hand** (piano keyboard, chromatic
 * buttons, MIDI input) plays the FreePats sample pack as `voice`, and
 * the **left hand** (Stradella bass + chord rows) plays the Tango
 * accordion soundfont as `bassVoice`. The soundfont has natively-
 * mapped low notes, so no large pitch-stretch is ever needed and a
 * chord triad's three notes share a single timbre.
 */
const BUTTON_ACCORDION_TONE = 'button_accordion_samples';
// Soundfont used for the left-hand voice when the FreePats sample
// tone is selected, AND as the hard-failure fallback for the whole
// voice when not a single FreePats anchor decodes (network/proxy
// outage). Tango accordion is drier and punchier than the generic
// "accordion" soundfont — closer to a real button-accordion bass reed
// — and has natively-recorded notes across the bass and chord ranges.
const BUTTON_ACCORDION_LEFT_HAND_TONE = 'tango_accordion';
const FREEPATS_ACCORDION_BASE =
  'https://raw.githubusercontent.com/freepats/button-accordion-HN/main';
const BUTTON_ACCORDION_ANCHORS = [
  'B3',
  'D4',
  'F#4',
  'G4',
  'A4',
  'C5',
  'D5',
  'E5',
  'F#5',
  'G5',
  'A5',
  'B5',
  'C6',
  'D6',
  'E6',
  'G6'
];

/**
 * Build the `{ noteName: [url] }` shape MultiSampler.fromNotes wants.
 * FreePats files are named `Button Accordion HN <Note>.flac` (with a
 * literal `#` for sharps); encodeURIComponent turns the space into
 * `%20` and the `#` into `%23` so githubusercontent.com serves the
 * file instead of a fragment-truncated 404.
 */
function buildButtonAccordionAnchors() {
  const out = {};
  for (const note of BUTTON_ACCORDION_ANCHORS) {
    const file = `Button Accordion HN ${note}.flac`;
    out[note] = [`${FREEPATS_ACCORDION_BASE}/${encodeURIComponent(file)}`];
  }
  return out;
}

const Prefs = makePrefs('play.accordion.prefs.v1');

/**
 * Refcounted accordion synth: a single MIDI note is held as long as ANY
 * caller has it pressed. This matters on the Stradella side, where two
 * adjacent chord buttons (C-major = C-E-G and F-major = F-A-C) share a note
 * and releasing one shouldn't cut the other.
 *
 * The synth also models a real accordion's **register switches** (couplers).
 * Each register is an array of octave shifts in semitones — for example
 * `[0]` plays only the middle reed, `[-12, 0, +12]` layers the low,
 * middle, and high reeds together (the "Master" register). When a logical
 * note comes in we trigger one physical voice per active shift, and
 * refcount on the *physical* MIDI value so that two logical notes whose
 * shifted pitches collide (e.g. logical-60 with shift +12 vs logical-72
 * with shift 0 → both physical 72) don't cut each other off prematurely.
 */
class AccordionSynth {
  constructor({ destination = null } = {}) {
    // AudioNode that all voices created in setTone() route into. Default
    // (null) means voices route to the shared master gain. The accordion
    // page passes its BreathBus.input here so the bellows pressure can
    // gate the whole accordion graph without rewiring the global master.
    this.destination = destination;
    this.toneName = '';
    // Right-hand voice: piano view, chromatic buttons, MIDI input, and
    // anything else that doesn't pass `side: 'left'` to noteOn(). In
    // FreePats sample mode this is the FreePats sampler.
    this.voice = null;
    // Left-hand voice: Stradella bass and chord buttons. Only populated
    // in FreePats sample mode (where it's a tango_accordion soundfont,
    // because the FreePats pack has no recorded bass-reed samples). For
    // any other tone — including the post-failure fallback — there is
    // no separate left-hand voice and both sides play `this.voice`.
    this.bassVoice = null;
    this.activeCount = 0;
    // Refcounts are kept per voice because the same physical MIDI value
    // can be held by both sides simultaneously (e.g. right hand plays
    // G3 while a left-hand C-major chord also produces G3) and they
    // need to noteOff independently.
    this.mainRefCount = new Map(); // physical midi -> holders on `voice`
    this.bassRefCount = new Map(); // physical midi -> holders on `bassVoice`
    this.shifts = [0]; // active reed banks: octave offsets in semitones
    this.onActiveChange = () => {};
    // Set when a sample-based tone failed to load any anchors and we
    // silently swapped in a soundfont so the user still hears reeds.
    // Surfaced in the UI as a "samples failed, using soundfont" hint.
    this.fallbackFromSamples = false;
  }

  setTone(name) {
    if (this.toneName === name && this.voice) return;
    if (this.voice) this.voice.allOff();
    if (this.bassVoice) this.bassVoice.allOff();
    this.mainRefCount.clear();
    this.bassRefCount.clear();
    this.activeCount = 0;
    this.onActiveChange(this.activeCount);
    this.toneName = name;
    this.fallbackFromSamples = false;
    this.bassVoice = null;
    // `loop: true` keeps the sample sustaining for as long as the key
    // is held — accordion notes ring as long as there's air, not for
    // the few-second length of a single sample. This is doubly
    // important for bellows mode, where the player may pump-and-hold
    // long after the sample would have naturally faded out.
    const dest = this.destination;
    if (name === BUTTON_ACCORDION_TONE) {
      const sampler = MultiSampler.fromNotes(buildButtonAccordionAnchors(), {
        loop: true,
        destination: dest
      });
      this.voice = sampler;
      sampler.preload().then(() => {
        // If `preload()` returned but no anchors decoded (network or
        // proxy failure across the board), drop down to the soundfont
        // accordion so the user isn't stuck with silence. Both sides
        // then share the soundfont.
        if (this.voice === sampler && !sampler.isReady()) {
          this.fallbackFromSamples = true;
          const fallback = new SampleVoice(BUTTON_ACCORDION_LEFT_HAND_TONE, {
            loop: true,
            destination: dest
          });
          this.voice = fallback;
          this.bassVoice = null;
          fallback.load();
        }
      });
      // Left-hand voice: a real soundfont with natively-mapped bass
      // reeds. The Stradella's onPress passes `side: 'left'` so this
      // is what plays for bass row, counter-bass, and chord triads.
      const bass = new SampleVoice(BUTTON_ACCORDION_LEFT_HAND_TONE, {
        loop: true,
        destination: dest
      });
      this.bassVoice = bass;
      bass.load();
    } else {
      this.voice = new SampleVoice(name, { loop: true, destination: dest });
      this.voice.load();
    }
  }

  setRegister(shifts) {
    const next = [...new Set(shifts)].sort((a, b) => a - b);
    if (this.shifts.length === next.length && this.shifts.every((s, i) => s === next[i])) return;
    // Clean transition: drop any held notes so we don't have orphan voices
    // playing at old offsets when the user rejiggers the register mid-chord.
    this.allOff();
    this.shifts = next;
  }

  isReady() {
    // When both voices are configured (FreePats sample mode) we require
    // BOTH to be ready: the soundfont bass voice typically loads almost
    // instantly from cache while the FreePats FLACs stream over the
    // network, and we don't want the "loading samples…" status to
    // disappear while the right hand is still silent.
    if (this.bassVoice) {
      return !!(this.voice?.isReady() && this.bassVoice.isReady());
    }
    return !!this.voice?.isReady();
  }

  // Returns the voice + refcount map for a given side. Falls back to
  // the main voice if a left-hand voice isn't configured (the case for
  // every non-samples tone).
  _routeFor(side) {
    if (side === 'left' && this.bassVoice) {
      return { voice: this.bassVoice, refCount: this.bassRefCount };
    }
    return { voice: this.voice, refCount: this.mainRefCount };
  }

  noteOn(midi, { side = 'right' } = {}) {
    getCtx();
    resumeIfSuspended();
    const { voice, refCount } = this._routeFor(side);
    if (!voice?.isReady()) return;
    for (const shift of this.shifts) {
      const m = midi + shift;
      if (m < 0 || m > 127) continue;
      const next = (refCount.get(m) || 0) + 1;
      refCount.set(m, next);
      // (re)trigger the sample whenever a fresh holder presses, so repeated
      // taps still feel responsive.
      voice.noteOn(m);
      this.activeCount += 1;
    }
    this.onActiveChange(this.activeCount);
  }

  noteOff(midi, { side = 'right' } = {}) {
    const { voice, refCount } = this._routeFor(side);
    if (!voice) return;
    for (const shift of this.shifts) {
      const m = midi + shift;
      if (m < 0 || m > 127) continue;
      const cur = refCount.get(m) || 0;
      if (cur === 0) continue;
      if (cur === 1) {
        refCount.delete(m);
        voice.noteOff(m);
      } else {
        refCount.set(m, cur - 1);
      }
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    this.onActiveChange(this.activeCount);
  }

  allOff() {
    this.voice?.allOff();
    this.bassVoice?.allOff();
    this.mainRefCount.clear();
    this.bassRefCount.clear();
    this.activeCount = 0;
    this.onActiveChange(this.activeCount);
  }
}

/**
 * Register switch presets, modelled on a piano accordion's reed couplers.
 * Each entry has an `id`, a short text label (`L`/`M`/`H` etc.), a longer
 * reed-name, and a list of octave shifts in semitones representing which
 * reed banks are engaged.
 *
 * Real instruments have *two* register sections — one above the right
 * (treble) keyboard for the melody side, and a much smaller one for the
 * left (Stradella bass) side. The treble side typically offers all
 * combinations of L/M/H reeds; the bass side commonly offers just two
 * settings: a single "tenor" reed for tonal lines, or a layered "master"
 * couple of all reeds for full dance-band volume. We model both.
 */
const RIGHT_REGISTERS = [
  { id: 'L', label: 'L', name: 'Bassoon', shifts: [-12] },
  { id: 'M', label: 'M', name: 'Clarinet', shifts: [0] },
  { id: 'H', label: 'H', name: 'Piccolo', shifts: [12] },
  { id: 'LM', label: 'LM', name: 'Bandoneon', shifts: [-12, 0] },
  { id: 'MH', label: 'MH', name: 'Violin', shifts: [0, 12] },
  { id: 'LMH', label: 'LMH', name: 'Master', shifts: [-12, 0, 12] }
];

const LEFT_REGISTERS = [
  { id: 'tenor', label: 'M', name: 'Tenor (tonal)', shifts: [0] },
  { id: 'master', label: 'LMH', name: 'Master (full)', shifts: [-12, 0, 12] }
];

const handForView = (cfg) => (cfg && cfg.kind === 'stradella' ? 'left' : 'right');
const registersForHand = (hand) => (hand === 'left' ? LEFT_REGISTERS : RIGHT_REGISTERS);

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
const viewEl = document.getElementById('view');
const registerOptionsEl = document.getElementById('register-options');
const registerToggleEl = document.getElementById('register-toggle');
const registerStripEl = document.querySelector('.register-strip');
const accordionStageEl = document.querySelector('.accordion-stage');
const accordionViewEl = document.getElementById('accordion-view');
const instrumentControlsEl = document.querySelector('.instrument-controls');
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
if (typeof prefs.view === 'string' && viewEl) {
  const opt = Array.from(viewEl.options).find((o) => o.value === prefs.view);
  if (opt) viewEl.value = prefs.view;
}

// Each hand keeps its own register selection so switching between, say,
// piano and Stradella views remembers what reed bank was on either side.
// Migration: the old single `register` pref was always a right-hand id.
let activeRightRegisterId = 'M';
if (
  typeof prefs.registerRight === 'string' &&
  RIGHT_REGISTERS.some((r) => r.id === prefs.registerRight)
) {
  activeRightRegisterId = prefs.registerRight;
} else if (
  typeof prefs.register === 'string' &&
  RIGHT_REGISTERS.some((r) => r.id === prefs.register)
) {
  activeRightRegisterId = prefs.register;
}
let activeLeftRegisterId = 'master';
if (
  typeof prefs.registerLeft === 'string' &&
  LEFT_REGISTERS.some((r) => r.id === prefs.registerLeft)
) {
  activeLeftRegisterId = prefs.registerLeft;
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
    view: viewEl ? viewEl.value : 'stradella-standard-h',
    registerRight: activeRightRegisterId,
    registerLeft: activeLeftRegisterId,
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
    }
    persist();
  });
}

// Tracks which hand's register set is currently displayed/applied. Set by
// `setView()` whenever the active view changes.
let currentHand = 'right';

/**
 * Render the register switches as a strip of physical-accordion-style stop
 * buttons. Each button is a black pill with a silver "stop" plate inset;
 * the plate has a vertical engraved spine, and black dots are punched on
 * the spine at the H (top) / M (middle) / L (bottom) positions to show
 * which reed banks the register engages. Inactive positions show no dot —
 * just the bare spine — exactly like a real instrument. Radio-style
 * behaviour: exactly one register is active at a time.
 *
 * The set rendered depends on `currentHand`: the right (treble) side gets
 * the full L/M/H matrix; the left (Stradella) side gets the simpler
 * tenor / master toggle that's typical on real instruments.
 */
const SHIFT_TO_POS = { 12: 'h', 0: 'm', '-12': 'l' };

const renderRegisterOptions = () => {
  if (!registerOptionsEl) return;
  registerOptionsEl.innerHTML = '';
  const set = registersForHand(currentHand);
  const activeId = currentHand === 'left' ? activeLeftRegisterId : activeRightRegisterId;
  set.forEach((reg) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'register-button';
    btn.dataset.register = reg.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(reg.id === activeId));
    btn.setAttribute('aria-label', `${reg.label} (${reg.name})`);
    btn.title = `${reg.label} — ${reg.name}`;
    if (reg.id === activeId) btn.classList.add('selected');

    const stop = document.createElement('span');
    stop.className = 'register-stop';
    stop.setAttribute('aria-hidden', 'true');
    // Each shift -> dot at the matching position on the silver plate.
    // Inactive positions get no dot (the spine line shows alone).
    reg.shifts.forEach((shift) => {
      const pos = SHIFT_TO_POS[shift];
      if (!pos) return;
      const dot = document.createElement('span');
      dot.className = `register-dot ${pos}`;
      stop.appendChild(dot);
    });
    btn.appendChild(stop);

    const label = document.createElement('span');
    label.className = 'register-label';
    label.textContent = reg.label;
    btn.appendChild(label);

    registerOptionsEl.appendChild(btn);
  });
  syncRegisterToggle();
};

/**
 * Mirror the active register's silver stop and label onto the compact
 * toggle pill. The pill is only visible when CSS collapses the strip
 * (short viewports / landscape phones), but we keep its content in
 * sync at all times so it's correct the moment it appears.
 */
const syncRegisterToggle = () => {
  if (!registerToggleEl) return;
  const set = registersForHand(currentHand);
  const activeId = currentHand === 'left' ? activeLeftRegisterId : activeRightRegisterId;
  const reg = set.find((r) => r.id === activeId) || set[0];
  if (!reg) return;
  const stopEl = registerToggleEl.querySelector('.register-toggle-stop');
  const nameEl = registerToggleEl.querySelector('.register-toggle-name');
  if (stopEl) {
    stopEl.innerHTML = '';
    reg.shifts.forEach((shift) => {
      const pos = SHIFT_TO_POS[shift];
      if (!pos) return;
      const dot = document.createElement('span');
      dot.className = `register-dot ${pos}`;
      stopEl.appendChild(dot);
    });
  }
  if (nameEl) nameEl.textContent = reg.label;
  registerToggleEl.title = `${reg.label} — ${reg.name}`;
};

const setRegisterStripOpen = (open) => {
  if (!registerStripEl || !registerToggleEl) return;
  registerStripEl.dataset.collapsedOpen = open ? 'true' : 'false';
  registerToggleEl.setAttribute('aria-expanded', String(Boolean(open)));
};

/**
 * Re-syncs the synth and the rendered strip with the active register for
 * the current hand. Called on view changes and on register clicks.
 */
const applyActiveHandRegister = () => {
  const set = registersForHand(currentHand);
  const activeId = currentHand === 'left' ? activeLeftRegisterId : activeRightRegisterId;
  const reg = set.find((r) => r.id === activeId) || set[0];
  if (!reg) return;
  if (currentHand === 'left') activeLeftRegisterId = reg.id;
  else activeRightRegisterId = reg.id;
  synth.setRegister(reg.shifts);
  renderRegisterOptions();
};

if (registerOptionsEl) {
  registerOptionsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.register-button');
    if (!btn) return;
    const id = btn.dataset.register;
    const set = registersForHand(currentHand);
    if (!set.some((r) => r.id === id)) return;
    const currentId = currentHand === 'left' ? activeLeftRegisterId : activeRightRegisterId;
    // Always close the collapsed popover after a tap, even if the
    // active register didn't change — the user has made their pick.
    setRegisterStripOpen(false);
    if (id === currentId) return;
    if (currentHand === 'left') activeLeftRegisterId = id;
    else activeRightRegisterId = id;
    hapticTap();
    applyActiveHandRegister();
    persist();
  });
}

if (registerToggleEl) {
  registerToggleEl.addEventListener('click', () => {
    if (!registerStripEl) return;
    const isOpen = registerStripEl.dataset.collapsedOpen === 'true';
    setRegisterStripOpen(!isOpen);
  });
  // Tap outside the strip closes the popover. Pointerdown rather than
  // click so the popover is gone before the user's tap can land on
  // a button beneath it.
  document.addEventListener('pointerdown', (event) => {
    if (!registerStripEl) return;
    if (registerStripEl.dataset.collapsedOpen !== 'true') return;
    if (registerStripEl.contains(event.target)) return;
    setRegisterStripOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!registerStripEl) return;
    if (registerStripEl.dataset.collapsedOpen !== 'true') return;
    setRegisterStripOpen(false);
    registerToggleEl.focus();
  });
}

/* The register strip lives in two different DOM locations depending
 * on viewport: above the keyboard inside `.accordion-stage` on
 * desktop (where it has space to render the full row of stops), or
 * inline with the other chrome controls inside `.instrument-controls`
 * on mobile (where it collapses to a single "current register" pill
 * and a tap-popover, keeping the keyboard's vertical real-estate
 * intact). Physically moving the element rather than rendering twin
 * copies keeps state, accessibility, and event handlers in one place. */
const mobileRegisterMq = window.matchMedia('(max-width: 720px), (max-height: 540px)');

const placeRegisterStrip = () => {
  if (!registerStripEl) return;
  const targetParent =
    mobileRegisterMq.matches && instrumentControlsEl ? instrumentControlsEl : accordionStageEl;
  if (!targetParent) return;
  if (registerStripEl.parentElement !== targetParent) {
    setRegisterStripOpen(false);
    if (targetParent === instrumentControlsEl) {
      instrumentControlsEl.appendChild(registerStripEl);
    } else if (accordionViewEl) {
      accordionStageEl.insertBefore(registerStripEl, accordionViewEl);
    } else {
      accordionStageEl.appendChild(registerStripEl);
    }
  }
  // Mark as placed so the CSS hide-until-placed guard releases.
  registerStripEl.dataset.placed = 'true';
};

if (typeof mobileRegisterMq.addEventListener === 'function') {
  mobileRegisterMq.addEventListener('change', placeRegisterStrip);
} else if (typeof mobileRegisterMq.addListener === 'function') {
  // Safari < 14 fallback.
  mobileRegisterMq.addListener(placeRegisterStrip);
}
placeRegisterStrip();

renderRegisterOptions();
applyActiveHandRegister();

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
  ...rightHandHandlers
});

// ---------- View switching ----------
//
// One flat list of views — Stradella variants × orientation, Piano, and
// Chromatic systems × orientation. Layout-/system-specific state is part
// of the view definition so the player picks "what they want to see" in a
// single dropdown rather than three.

const VIEWS = {
  'stradella-standard-h': {
    kind: 'stradella',
    layout: 'standard',
    orientation: 'horizontal'
  },
  'stradella-standard-v': {
    kind: 'stradella',
    layout: 'standard',
    orientation: 'vertical'
  },
  'stradella-eastern-h': {
    kind: 'stradella',
    layout: 'eastern',
    orientation: 'horizontal'
  },
  'stradella-eastern-v': {
    kind: 'stradella',
    layout: 'eastern',
    orientation: 'vertical'
  },
  'stradella-freebass-h': {
    kind: 'stradella',
    layout: 'free-bass',
    orientation: 'horizontal'
  },
  'stradella-freebass-v': {
    kind: 'stradella',
    layout: 'free-bass',
    orientation: 'vertical'
  },
  piano: { kind: 'piano' },
  'chromatic-B-h': {
    kind: 'chromatic',
    system: 'B',
    orientation: 'horizontal'
  },
  'chromatic-B-v': { kind: 'chromatic', system: 'B', orientation: 'vertical' },
  'chromatic-C-h': {
    kind: 'chromatic',
    system: 'C',
    orientation: 'horizontal'
  },
  'chromatic-C-v': { kind: 'chromatic', system: 'C', orientation: 'vertical' }
};

/**
 * On phone-sized viewports we override the picked H/V orientation to match
 * the device's own orientation: portrait phones get vertical layouts, and
 * landscape phones get horizontal. On desktop we always honour the user's
 * dropdown choice. Returns the orientation that should actually be used,
 * or `null` for the piano view (which has no H/V variant).
 */
const MOBILE_BREAKPOINT_PX = 720;
const portraitMql = window.matchMedia('(orientation: portrait)');
const isMobileViewport = () => window.innerWidth <= MOBILE_BREAKPOINT_PX;
const effectiveOrientation = (cfg) => {
  if (cfg.orientation == null) return null;
  if (isMobileViewport()) {
    return portraitMql.matches ? 'vertical' : 'horizontal';
  }
  return cfg.orientation;
};

const setView = (viewId) => {
  const cfg = VIEWS[viewId];
  if (!cfg) return;

  // Drop visual state from whichever view we're leaving.
  stradella.clearActive();
  chromatic.clearActive();

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
  if (hand !== currentHand) {
    currentHand = hand;
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

/* ---------- Mobile dropdown labels ----------
 *
 * On a touch device we auto-pick the orientation, so showing the user a
 * "Standard (horizontal)" / "Standard (vertical)" pair is just confusing
 * noise. On mobile we therefore (a) hide the "-v" duplicates and (b)
 * relabel the "-h" entries with their bare name. Desktop keeps the full
 * H/V picker. The original labels are preserved in `data-desktop-label`
 * so we can restore them on the way back. */
const MOBILE_VIEW_LABELS = {
  'stradella-standard-h': 'Standard',
  'stradella-eastern-h': 'Eastern 5-row',
  'stradella-freebass-h': 'Free bass',
  piano: 'Piano keyboard',
  'chromatic-B-h': 'Chromatic B-system',
  'chromatic-C-h': 'Chromatic C-system'
};

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
});
