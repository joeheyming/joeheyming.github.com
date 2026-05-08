/**
 * Mallets page — one bar keyboard, four pitched-percussion voices.
 *
 * Tones share the soundfont catalog so swapping is a single soundfont
 * load away:
 *
 *   - **Xylophone** — bright wood, short decay
 *   - **Marimba** — warm wood, medium decay
 *   - **Vibraphone** — sustained metal, optional ~5.5 Hz tremolo
 *     (modeled after the rotating resonator discs of a real vibraphone)
 *   - **Glockenspiel** — bright bell-like metal, medium decay
 *
 * For each tone we also implement a Web Audio synth-fallback voice
 * (sine partials through a bandpass + a high-passed strike noise — same
 * shape as the steel drum and bell voices in `/play/`) so the page is
 * playable even if the soundfont CDN is unreachable.
 *
 * Visuals: the shared `Keyboard` component (`play/shared/keyboard.js`)
 * renders the bars; this page just retunes its layout per tone, swaps
 * the per-tone CSS palette, and routes through a vibrato bus when
 * vibraphone+vibrato is on.
 */
import {
  midiToFreq,
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

const Prefs = makePrefs('play.mallets.prefs.v1');

/**
 * Per-tone configuration. `defaultStartMidi` lands the layout in each
 * instrument's natural register. `synth` parameters drive the
 * Web-Audio fallback voice (used when the soundfont hasn't loaded yet
 * or the network is unreachable).
 *
 * The synth-partial ratios are tuned by ear to evoke each instrument:
 *   - Xylophone uses the odd "wooden" partial (3×) common to xylo bars
 *   - Marimba accents the 4× partial (real marimba bars are tuned so
 *     the second mode lands two octaves above the fundamental)
 *   - Vibraphone is a full octave/fifth/twelfth stack — sustained metal
 *   - Glockenspiel uses the inharmonic 2.756× partial for "bell" tone
 */
const TONES = {
  xylophone: {
    soundfont: 'xylophone',
    defaultStartMidi: 60, // C4
    synth: {
      partials: [
        { ratio: 1, gain: 0.55, decayMul: 1.0 },
        { ratio: 3, gain: 0.18, decayMul: 0.5 },
        { ratio: 6, gain: 0.04, decayMul: 0.2 }
      ],
      decay: 0.55,
      bandpass: 1.6,
      bandpassQ: 0.6,
      strikeAmp: 0.22,
      strikeHpRatio: 4
    }
  },
  marimba: {
    soundfont: 'marimba',
    defaultStartMidi: 48, // C3
    synth: {
      partials: [
        { ratio: 1, gain: 0.55, decayMul: 1.0 },
        { ratio: 4, gain: 0.1, decayMul: 0.4 },
        { ratio: 9.2, gain: 0.025, decayMul: 0.15 }
      ],
      decay: 1.4,
      bandpass: 1.2,
      bandpassQ: 0.7,
      strikeAmp: 0.12,
      strikeHpRatio: 3.5
    }
  },
  vibraphone: {
    soundfont: 'vibraphone',
    defaultStartMidi: 53, // F3
    canVibrato: true,
    synth: {
      partials: [
        { ratio: 1, gain: 0.5, decayMul: 1.0 },
        { ratio: 2, gain: 0.28, decayMul: 0.85 },
        { ratio: 3, gain: 0.12, decayMul: 0.6 },
        { ratio: 4, gain: 0.04, decayMul: 0.4 }
      ],
      decay: 4.2,
      bandpass: 1.8,
      bandpassQ: 0.6,
      strikeAmp: 0.1,
      strikeHpRatio: 4
    }
  },
  glockenspiel: {
    soundfont: 'glockenspiel',
    defaultStartMidi: 72, // C5
    synth: {
      partials: [
        { ratio: 1, gain: 0.45, decayMul: 1.0 },
        { ratio: 2.756, gain: 0.18, decayMul: 0.5 },
        { ratio: 5.4, gain: 0.05, decayMul: 0.2 }
      ],
      decay: 1.2,
      bandpass: 2.4,
      bandpassQ: 0.5,
      strikeAmp: 0.15,
      strikeHpRatio: 6
    }
  }
};

/**
 * MalletSynth — combines a soundfont path (when reachable) with a
 * Web-Audio synth fallback, plus a shared "vibrato bus" gain stage that
 * the vibraphone tone routes through when its tremolo is on.
 */
class MalletSynth {
  constructor() {
    this.tone = 'xylophone';
    this.vibratoEnabled = false;
    /** tone -> { instrument, loadingPromise, dest, playing } */
    this.samplePlayers = new Map();
    this.vibratoBus = null;
    this.vibratoLfo = null;
    this.vibratoLfoDepth = null;
    this.onStatusChange = () => {};
  }

  /**
   * The audio destination for a given tone's notes. Vibraphone routes
   * through a dedicated gain stage so the LFO can modulate it; everything
   * else goes straight to the master gain.
   */
  destForTone(tone) {
    if (tone === 'vibraphone') return this.ensureVibratoBus();
    return getMaster();
  }

  ensureVibratoBus() {
    if (this.vibratoBus) return this.vibratoBus;
    const ctx = getCtx();
    this.vibratoBus = ctx.createGain();
    this.vibratoBus.gain.value = 1;
    this.vibratoBus.connect(getMaster());
    return this.vibratoBus;
  }

  setVibrato(on) {
    this.vibratoEnabled = on;
    const ctx = getCtx();
    this.ensureVibratoBus();
    if (on) {
      // Lazily allocate the LFO + its depth gain. Once started, the LFO
      // free-runs forever; we control "vibrato off" by zeroing the depth
      // gain rather than tearing down the oscillator (which would force
      // a re-allocation on every toggle).
      if (!this.vibratoLfo) {
        this.vibratoLfo = ctx.createOscillator();
        this.vibratoLfo.type = 'sine';
        this.vibratoLfo.frequency.value = 5.5; // ~5.5 Hz vibraphone speed
        this.vibratoLfoDepth = ctx.createGain();
        this.vibratoLfoDepth.gain.value = 0.35;
        this.vibratoLfo.connect(this.vibratoLfoDepth);
        this.vibratoLfoDepth.connect(this.vibratoBus.gain);
        this.vibratoLfo.start();
      } else {
        this.vibratoLfoDepth.gain.value = 0.35;
      }
    } else if (this.vibratoLfoDepth) {
      this.vibratoLfoDepth.gain.value = 0;
    }
  }

  setTone(tone) {
    this.allOff();
    this.tone = tone;
    this.ensureSampleLoaded(tone).then(() => this.onStatusChange());
    this.onStatusChange();
  }

  async ensureSampleLoaded(tone) {
    let player = this.samplePlayers.get(tone);
    if (!player) {
      player = { instrument: null, loadingPromise: null, playing: new Map() };
      this.samplePlayers.set(tone, player);
    }
    if (player.instrument) return player.instrument;
    if (player.loadingPromise) return player.loadingPromise;

    const cfg = TONES[tone];
    if (!cfg || !window.Soundfont) {
      player.loadingPromise = Promise.resolve(null);
      return player.loadingPromise;
    }

    const dest = this.destForTone(tone);
    player.loadingPromise = window.Soundfont.instrument(getCtx(), cfg.soundfont, {
      destination: dest
    })
      .then((inst) => {
        player.instrument = inst;
        player.loadingPromise = null;
        return inst;
      })
      .catch((err) => {
        console.warn('Soundfont load failed for', tone, err);
        player.loadingPromise = null;
        return null;
      });
    return player.loadingPromise;
  }

  isReady(tone = this.tone) {
    return !!this.samplePlayers.get(tone)?.instrument;
  }

  /**
   * Note-on: mallet bars layer (a re-strike doesn't truncate the previous
   * ring) — that's the realistic behavior. We deliberately do NOT
   * `stop()` the prior soundfont node for the same midi.
   */
  noteOn(midi) {
    getCtx();
    resumeIfSuspended();
    const player = this.samplePlayers.get(this.tone);
    if (player && player.instrument) {
      const node = player.instrument.play(midiToName(midi));
      // Track only the most-recent node per pitch — earlier ones are left
      // to ring out. Tracking is needed for `allOff()` (e.g. tone change,
      // window blur) to silence everything cleanly.
      const list = player.playing.get(midi) || [];
      list.push(node);
      player.playing.set(midi, list);
      // Trim long lists to avoid unbounded growth on rapid retriggers —
      // the oldest few are likely already silent anyway.
      if (list.length > 8) list.splice(0, list.length - 8);
      return;
    }
    // Soundfont not ready (or unreachable) — synth fallback. Kicks off a
    // load so subsequent notes get the real samples.
    this.synthStrike(midi);
    if (window.Soundfont) this.ensureSampleLoaded(this.tone);
  }

  /**
   * Note-off: deliberately a no-op. Mallet bars ring out naturally after
   * the strike — releasing the key shouldn't cut the sound short. Use
   * `allOff()` if you really need silence (page switching tones,
   * blur, etc.).
   */
  noteOff(/* midi, instant */) {
    /* intentional no-op */
  }

  /** Synth-fallback strike — a small self-disposing voice graph per hit. */
  synthStrike(midi) {
    const cfg = TONES[this.tone] || TONES.xylophone;
    const params = cfg.synth;
    const ctx = getCtx();
    const dest = this.destForTone(this.tone);
    const t = ctx.currentTime;
    const freq = midiToFreq(midi);
    // Slightly shorter decay for higher pitches — matches how real bars
    // ring out (high glock bars die faster than low marimba ones).
    const decay = params.decay * Math.max(0.45, 1.55 - midi / 96);

    const sum = ctx.createGain();
    sum.gain.value = 1;

    for (const p of params.partials) {
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

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * params.bandpass;
    bp.Q.value = params.bandpassQ;

    if (params.strikeAmp > 0) {
      const noiseLen = 0.03;
      const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * noiseLen));
      const buf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const noiseHp = ctx.createBiquadFilter();
      noiseHp.type = 'highpass';
      noiseHp.frequency.value = Math.min(freq * params.strikeHpRatio, 8000);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(params.strikeAmp, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      noise.connect(noiseHp);
      noiseHp.connect(noiseGain);
      noiseGain.connect(dest);
      noise.start(t);
    }

    const masterEnv = ctx.createGain();
    masterEnv.gain.value = 0.6;
    sum.connect(bp);
    bp.connect(masterEnv);
    masterEnv.connect(dest);
  }

  allOff() {
    for (const player of this.samplePlayers.values()) {
      for (const list of player.playing.values()) {
        for (const node of list) {
          try {
            node.stop();
          } catch (_) {
            /* ignore */
          }
        }
      }
      player.playing.clear();
    }
  }
}

// ---------- Page wiring ----------

const keyboardEl = document.getElementById('mallet-keyboard');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const toneEl = document.getElementById('tone');
const toneStatusEl = document.getElementById('tone-status');
const layoutEl = document.getElementById('layout');
const octaveDownBtn = document.getElementById('octave-down');
const octaveUpBtn = document.getElementById('octave-up');
const octaveDisplay = document.getElementById('octave-display');
const vibratoControl = document.getElementById('vibrato-control');
const vibratoEl = document.getElementById('vibrato');
const showLabelsEl = document.getElementById('show-labels');
const midiStatusEl = document.getElementById('midi-status');

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.tone === 'string' && TONES[prefs.tone]) toneEl.value = prefs.tone;
if (typeof prefs.layout === 'string') {
  const opt = Array.from(layoutEl.options).find((o) => o.value === prefs.layout);
  if (opt) layoutEl.value = prefs.layout;
}
if (typeof prefs.vibrato === 'boolean') vibratoEl.checked = prefs.vibrato;
if (typeof prefs.showLabels === 'boolean') showLabelsEl.checked = prefs.showLabels;

const synth = new MalletSynth();
setMasterVolume(Number(volumeEl.value) / 100);
synth.setTone(toneEl.value);
synth.setVibrato(vibratoEl.checked);

const layoutFor = () => {
  const octaves = Math.max(1, Number(layoutEl.value) || 3);
  // 7 naturals per octave + the closing C, so the player can land on
  // both the bottom and top tonic of the chosen range.
  return { whiteKeyCount: octaves * 7 + 1 };
};

const toneCfg = () => TONES[toneEl.value] || TONES.xylophone;

let baseStartMidi = toneCfg().defaultStartMidi;
let { whiteKeyCount } = layoutFor();
let octaveOffset = Number.isInteger(prefs.octaveOffset) ? prefs.octaveOffset : 0;

const layoutEndMidi = () => baseStartMidi + Math.ceil(whiteKeyCount * (12 / 7)) - 1;
const clampOctaveOffset = (offset) => {
  const minOffset = Math.ceil((0 - baseStartMidi) / 12);
  const maxOffset = Math.floor((127 - layoutEndMidi()) / 12);
  return Math.max(minOffset, Math.min(maxOffset, offset));
};
octaveOffset = clampOctaveOffset(octaveOffset);
let startMidi = baseStartMidi + octaveOffset * 12;

let nowPlayingTimer = null;
const announceNote = (midi) => {
  nowPlaying.textContent = midiToName(midi);
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    nowPlaying.classList.remove('active');
  }, 350);
};

const keyboard = new Keyboard(keyboardEl, {
  startMidi,
  whiteKeyCount,
  synth,
  onActivity: announceNote,
  // Mallet accidentals are full-size bars in their own row, so they
  // can carry a "C#" / "D#" pitch label just like the naturals. The
  // shared `Keyboard` defaults this off because piano-style layouts
  // don't have room.
  labelAccidentals: true
});

const applyToneClass = () => {
  // Drop any prior tone-* class then set the current one. The CSS in
  // style.css drives the wood/metal palette off this class.
  for (const t of Object.keys(TONES)) keyboardEl.classList.remove(`tone-${t}`);
  keyboardEl.classList.add(`tone-${toneEl.value}`);
};
applyToneClass();
keyboardEl.classList.toggle('hide-notes', !showLabelsEl.checked);

const updateVibratoVisibility = () => {
  const canVibrato = !!toneCfg().canVibrato;
  if (canVibrato) vibratoControl.removeAttribute('hidden');
  else vibratoControl.setAttribute('hidden', '');
};
updateVibratoVisibility();

const updateOctaveDisplay = () => {
  octaveDisplay.textContent = midiToName(startMidi);
  octaveDownBtn.disabled = clampOctaveOffset(octaveOffset - 1) === octaveOffset;
  octaveUpBtn.disabled = clampOctaveOffset(octaveOffset + 1) === octaveOffset;
};
updateOctaveDisplay();

const updateToneStatus = () => {
  if (!toneStatusEl) return;
  if (synth.isReady()) toneStatusEl.textContent = '';
  else if (window.Soundfont) toneStatusEl.textContent = 'loading…';
  else toneStatusEl.textContent = 'offline · synth fallback';
};
synth.onStatusChange = updateToneStatus;
updateToneStatus();

const persist = () => {
  Prefs.save({
    volume: Number(volumeEl.value),
    tone: toneEl.value,
    layout: layoutEl.value,
    octaveOffset,
    vibrato: vibratoEl.checked,
    showLabels: showLabelsEl.checked
  });
};

const shiftOctave = (direction) => {
  const next = clampOctaveOffset(octaveOffset + direction);
  if (next === octaveOffset) return;
  octaveOffset = next;
  startMidi = baseStartMidi + octaveOffset * 12;
  keyboard.setStartMidi(startMidi);
  updateOctaveDisplay();
  persist();
};

octaveDownBtn.addEventListener('click', () => shiftOctave(-1));
octaveUpBtn.addEventListener('click', () => shiftOctave(+1));

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  persist();
});

toneEl.addEventListener('change', () => {
  synth.setTone(toneEl.value);
  // Re-anchor the layout to the new tone's natural register, but only if
  // the user hasn't manually shifted away — preserving an explicit
  // octave choice across tone swaps avoids surprising jumps. In practice
  // we always reset to 0 because tone-specific defaults are the whole
  // point of giving each instrument its own register.
  baseStartMidi = toneCfg().defaultStartMidi;
  octaveOffset = 0;
  octaveOffset = clampOctaveOffset(octaveOffset);
  startMidi = baseStartMidi + octaveOffset * 12;
  keyboard.setStartMidi(startMidi);
  applyToneClass();
  updateVibratoVisibility();
  updateOctaveDisplay();
  updateToneStatus();
  persist();
});

layoutEl.addEventListener('change', () => {
  const cfg = layoutFor();
  whiteKeyCount = cfg.whiteKeyCount;
  octaveOffset = clampOctaveOffset(octaveOffset);
  startMidi = baseStartMidi + octaveOffset * 12;
  keyboard.setWhiteKeyCount(whiteKeyCount);
  keyboard.setStartMidi(startMidi);
  updateOctaveDisplay();
  persist();
});

vibratoEl.addEventListener('change', () => {
  synth.setVibrato(vibratoEl.checked);
  persist();
});

showLabelsEl.addEventListener('change', () => {
  keyboardEl.classList.toggle('hide-notes', !showLabelsEl.checked);
  persist();
});

// Pre-warm the soundfont on first user interaction. Same dance as the
// piano page — the AudioContext can't autoplay until the user gestures,
// so we wait for that gesture before kicking off the load.
const warm = () => {
  resumeIfSuspended();
  synth.ensureSampleLoaded(toneEl.value).then(updateToneStatus);
  document.removeEventListener('pointerdown', warm);
  document.removeEventListener('keydown', warm);
};
document.addEventListener('pointerdown', warm, { once: true });
document.addEventListener('keydown', warm, { once: true });

attachKeyboardInput({
  keyboard,
  synth,
  // No sustain element — mallet bars ring out on their own. We pass null
  // so the input handler skips sustain wiring.
  sustainEl: null,
  announceNote,
  shiftOctave
});

setupMidi({
  statusEl: midiStatusEl,
  onNoteOn: (note) => {
    synth.noteOn(note);
    keyboard.pressVisual(note, true);
    announceNote(note);
    // Mallet bars decay naturally; auto-release the visual after a beat
    // so MIDI inputs don't leave keys "stuck on" until manual release.
    setTimeout(() => keyboard.pressVisual(note, false), 220);
  },
  onNoteOff: (note) => {
    keyboard.pressVisual(note, false);
  }
});
