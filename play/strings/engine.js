/**
 * Audio engine for the Strings page. Hides the difference between
 * tonejs-instruments multi-samplers (the guitar-only `*_samples` tones)
 * and the soundfont-player voices everything else uses, exposing a
 * single `pluck(midi)` / `strum(notes, dir)` API.
 *
 * The MultiSampler cache deliberately spans instrument switches so a
 * Guitar → Bass → Guitar round-trip reuses the warm AudioBuffers of
 * whichever guitar tone was active before.
 */
import { resumeIfSuspended, SampleVoice } from '../shared/audio.js';
import { MultiSampler } from '../shared/samples.js';

const TONEJS_BASE =
  'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples';

/**
 * Catalogs of multi-sampled guitar tones. Each entry pins:
 *   - `folder`: the tonejs-instruments folder name (under .../samples/)
 *   - `anchors`: chosen note names spaced ~perfect-fourth-ish apart so
 *     worst-case `playbackRate` detune from any played note is ≤3
 *     semitones (avoids audible chipmunking).
 *   - `ext`: file extension on the catalog. Tonejs publishes both .mp3
 *     and .ogg; we pick mp3 for broadest compatibility.
 *
 * Filename note: tonejs uses `s` instead of `#` (e.g. `Ds3.mp3` = D♯3).
 * `MultiSampler.fromNotes` accepts both spellings as keys.
 */
const MULTI_SAMPLE_CATALOGS = {
  acoustic_guitar_samples: {
    folder: 'guitar-acoustic',
    anchors: ['E2', 'A2', 'D3', 'G3', 'C4', 'F4', 'As4', 'D5'],
    ext: 'mp3'
  },
  electric_guitar_samples: {
    // Clean Fender-style single-coil. Real recorded plucks decay quickly
    // — much shorter sustain than the overdriven soundfont voice the
    // user previously hit. 7 anchors at ~perfect-fifth steps spans the
    // playable fretboard E2..E5 with ≤3 semitones worst-case detune.
    folder: 'guitar-electric',
    anchors: ['E2', 'A2', 'Ds3', 'A3', 'Ds4', 'A4', 'Ds5'],
    ext: 'mp3'
  }
};

function buildSampleCatalogAnchors(toneId) {
  const cat = MULTI_SAMPLE_CATALOGS[toneId];
  if (!cat) return null;
  const map = {};
  for (const note of cat.anchors) {
    map[note] = `${TONEJS_BASE}/${cat.folder}/${note}.${cat.ext}`;
  }
  return map;
}

export class StringEngine {
  constructor() {
    this.toneName = '';
    this.voice = null;
    this.multiSamplers = new Map(); // toneId -> MultiSampler
    this.multiSamplerStatuses = new Map(); // toneId -> 'idle'|'loading'|'ready'|'error'
    // When `paired` is true, every pluck fires a small tremolo
    // retrigger so a single tap sounds like a mandolin double-strike
    // rather than a single nylon-string pluck. Set by the page wiring
    // when the active instrument changes.
    this.paired = false;
  }

  isMultiSampleTone(name) {
    return name in MULTI_SAMPLE_CATALOGS;
  }

  get multiSampler() {
    return this.multiSamplers.get(this.toneName) || null;
  }

  get multiSamplerStatus() {
    return this.multiSamplerStatuses.get(this.toneName) || 'idle';
  }

  async setTone(name) {
    if (this.toneName === name) return;
    if (this.voice) this.voice.allOff();
    // Stop voices on every cached sampler, not just the active one,
    // so a held note on the prior tone doesn't keep ringing through
    // the swap.
    for (const ms of this.multiSamplers.values()) ms.allOff();
    this.toneName = name;
    if (this.isMultiSampleTone(name)) {
      this.voice = null;
      await this.ensureMultiSamplerLoaded(name);
      return;
    }
    this.voice = new SampleVoice(name);
    await this.voice.load();
  }

  async ensureMultiSamplerLoaded(toneId = this.toneName) {
    const status = this.multiSamplerStatuses.get(toneId);
    if (status === 'ready' || status === 'loading') return;
    let sampler = this.multiSamplers.get(toneId);
    if (!sampler) {
      const anchors = buildSampleCatalogAnchors(toneId);
      if (!anchors) {
        this.multiSamplerStatuses.set(toneId, 'error');
        return;
      }
      sampler = MultiSampler.fromNotes(anchors);
      this.multiSamplers.set(toneId, sampler);
    }
    this.multiSamplerStatuses.set(toneId, 'loading');
    try {
      await sampler.preload();
      this.multiSamplerStatuses.set(toneId, sampler.isReady() ? 'ready' : 'error');
    } catch (_) {
      this.multiSamplerStatuses.set(toneId, 'error');
    }
  }

  isReady() {
    if (this.isMultiSampleTone(this.toneName)) {
      return this.multiSamplerStatus === 'ready';
    }
    return !!this.voice?.isReady();
  }

  /** Internal one-shot trigger (no tremolo handling). */
  _trigger(midi) {
    if (this.isMultiSampleTone(this.toneName)) {
      const ms = this.multiSampler;
      if (!ms || !ms.isReady()) return false;
      ms.noteOff(midi, { release: 0.05 });
      ms.noteOn(midi, { gain: 0.95, attack: 0.003 });
      return true;
    }
    if (!this.voice || !this.voice.isReady()) return false;
    this.voice.noteOff(midi);
    this.voice.noteOn(midi);
    return true;
  }

  pluck(midi) {
    resumeIfSuspended();
    const ok = this._trigger(midi);
    if (!ok) return false;
    if (this.paired) {
      // Mandolin tremolo: a quick second strike ~55ms later. Real
      // mandolin tremolo is a continuous trill, but a single retrigger
      // is enough to read as "two strings, picked together" without
      // doubling our voice count or muddying the strum gesture.
      setTimeout(() => this._trigger(midi), 55);
    }
    return true;
  }

  strum(notes, direction = 'down') {
    const ordered = direction === 'down' ? [...notes] : [...notes].reverse();
    const stagger = 0.022; // seconds between adjacent strings
    let delay = 0;
    for (const midi of ordered) {
      if (midi == null) continue;
      setTimeout(() => this.pluck(midi), delay * 1000);
      delay += stagger;
    }
  }
}
