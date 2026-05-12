import { getCtx, resumeIfSuspended, SampleVoice } from '../shared/audio.js';
import { MultiSampler } from '../shared/samples.js';

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
export const BUTTON_ACCORDION_TONE = 'button_accordion_samples';
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

/**
 * Refcounted accordion synth: a single MIDI note is held as long as ANY
 * caller has it pressed. This matters on the Stradella side, where two
 * adjacent chord buttons (C-major = C-E-G and F-major = F-A-C) share a note
 * and releasing one shouldn't cut the other.
 *
 * The synth also models a real accordion's **register switches** (couplers).
 * Each register is a list of *reeds* — `{ semis, cents }` pairs — describing
 * which physical reed banks engage:
 *
 *   - `semis: -12 / 0 / +12` selects the L (bassoon) / M (clarinet) /
 *     H (piccolo) reed bank.
 *   - `cents: 0` is the on-pitch reed; non-zero cents lets us synthesize
 *     the **musette** beating real accordions get from two physical M
 *     reeds detuned a few cents apart. E.g. `[{semis:0,cents:0},
 *     {semis:0,cents:+8}]` plays the standard "MM" 2-voice musette.
 *
 * For each note, we trigger one physical voice per active reed and
 * refcount on `(physicalMidi, cents)` so that:
 *   - two logical notes whose shifted pitches collide (logical-60 with
 *     shift +12 vs logical-72 with shift 0 → both physical 72) don't
 *     cut each other off prematurely;
 *   - and a +0¢ M reed and a +8¢ M reed at the same physical midi each
 *     keep their own refcount, since musically they're independent
 *     voices that the player wants ringing simultaneously.
 */
export class AccordionSynth {
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
    // need to noteOff independently. Keys are `${midi}|${cents}` so a
    // pair of musette M reeds at the same midi but different cents are
    // tracked as independent voices.
    this.mainRefCount = new Map(); // `${midi}|${cents}` -> holders on `voice`
    this.bassRefCount = new Map(); // `${midi}|${cents}` -> holders on `bassVoice`
    this.reeds = [{ semis: 0, cents: 0 }]; // active reed banks
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

  /**
   * `reeds` is a list of `{ semis, cents }` pairs (or bare numbers for
   * backwards compat — old callers passing `[0, -12, 12]` still work,
   * each entry treated as `{ semis: n, cents: 0 }`). Duplicates are
   * dedup'd by full (semis, cents) identity, not just semis, so two
   * detuned M reeds for musette stay separate.
   */
  setRegister(reeds) {
    const normalized = reeds.map((r) =>
      typeof r === 'number' ? { semis: r, cents: 0 } : { semis: r.semis | 0, cents: r.cents | 0 }
    );
    // Dedup by (semis, cents) identity and sort for stable comparison.
    const seen = new Set();
    const unique = [];
    for (const r of normalized) {
      const k = `${r.semis}|${r.cents}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(r);
    }
    unique.sort((a, b) => a.semis - b.semis || a.cents - b.cents);
    if (
      this.reeds.length === unique.length &&
      this.reeds.every((r, i) => r.semis === unique[i].semis && r.cents === unique[i].cents)
    ) {
      return;
    }
    // Clean transition: drop any held notes so we don't have orphan voices
    // playing at old offsets when the user rejiggers the register mid-chord.
    this.allOff();
    this.reeds = unique;
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
    for (const reed of this.reeds) {
      const m = midi + reed.semis;
      if (m < 0 || m > 127) continue;
      const key = `${m}|${reed.cents}`;
      const next = (refCount.get(key) || 0) + 1;
      refCount.set(key, next);
      // (re)trigger the sample whenever a fresh holder presses, so repeated
      // taps still feel responsive.
      voice.noteOn(m, { detune: reed.cents });
      this.activeCount += 1;
    }
    this.onActiveChange(this.activeCount);
  }

  noteOff(midi, { side = 'right' } = {}) {
    const { voice, refCount } = this._routeFor(side);
    if (!voice) return;
    for (const reed of this.reeds) {
      const m = midi + reed.semis;
      if (m < 0 || m > 127) continue;
      const key = `${m}|${reed.cents}`;
      const cur = refCount.get(key) || 0;
      if (cur === 0) continue;
      if (cur === 1) {
        refCount.delete(key);
        voice.noteOff(m, { detune: reed.cents });
      } else {
        refCount.set(key, cur - 1);
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
