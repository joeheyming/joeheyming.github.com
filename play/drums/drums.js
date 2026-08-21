/**
 * Hybrid drum kit. Two flavours of voice:
 *
 *   - **Sampled kits** (`linndrum`, `tr-808`): one-shot OGGs streamed from
 *     the public-domain `smpldsnds/drum-machines` catalog through proxy.js
 *     and decoded once into AudioBuffers. Played as a fresh
 *     AudioBufferSourceNode per hit for unlimited polyphony.
 *   - **Synth kits** (`acoustic`, `electronic`): pure Web Audio — oscillators
 *     plus filtered noise — same code as before. Always available, no
 *     network needed.
 *
 * If the network or the decode fails for any pad, we silently fall back to
 * the synth voice for that pad on the same hit, so the kit never plays
 * silence. The looper records pad ids (not audio), so it survives a kit
 * change mid-loop.
 */
import { getCtx, getMaster, resumeIfSuspended, setMasterVolume } from '../shared/audio.js';
import { SampleKit } from '../shared/samples.js';
import { makePrefs } from '../shared/prefs.js';
import { LoopTrack } from '../shared/loop-track.js';
import { createLoopTrackController } from '../shared/loop-track-ui.js';

const Prefs = makePrefs('play.drums.prefs.v1');

/**
 * Pad layout. Three rows of four, mapped to the QWERTY top/home/bottom rows
 * so it doubles as a 4x3 keyboard pad.
 *
 * Hand-split is intentional: left two columns are the "left hand" of a real
 * kit (snare, kick, toms — the rhythmic backbone), right two columns are
 * the "right hand" (hi-hats, cymbals, percussion accents). On a phone in
 * landscape this maps cleanly to left-thumb / right-thumb territory, and
 * snare (Q) sits directly above kick (A) so one thumb can flick between
 * the two essentials of any beat.
 *
 *   Q W E R   snare    clap     closed-hat tambourine? — see below
 *   A S D F   kick     stick    ride       crash
 *   Z X C V   low-tom  mid-tom  tambourine cowbell
 */
const PAD_LAYOUT = [
  // Row 1 — Q W E R
  { id: 'snare', name: 'Snare', emoji: '🥁', key: 'q', accent: '#f472b6' },
  { id: 'clap', name: 'Clap', emoji: '👏', key: 'w', accent: '#f472b6' },
  { id: 'closed-hat', name: 'Closed Hat', emoji: '🎩', key: 'e', accent: '#fbbf24' },
  { id: 'open-hat', name: 'Open Hat', emoji: '〽️', key: 'r', accent: '#fbbf24' },
  // Row 2 — A S D F
  { id: 'kick', name: 'Kick', emoji: '🦶', key: 'a', accent: '#818cf8' },
  { id: 'stick', name: 'Stick', emoji: '🪵', key: 's', accent: '#f472b6' },
  { id: 'ride', name: 'Ride', emoji: '🛎️', key: 'd', accent: '#fbbf24' },
  { id: 'crash', name: 'Crash', emoji: '💥', key: 'f', accent: '#fbbf24' },
  // Row 3 — Z X C V
  { id: 'low-tom', name: 'Low Tom', emoji: '🛢️', key: 'z', accent: '#818cf8' },
  { id: 'mid-tom', name: 'Mid Tom', emoji: '🛢️', key: 'x', accent: '#818cf8' },
  { id: 'tambourine', name: 'Tambourine', emoji: '✨', key: 'c', accent: '#34d399' },
  { id: 'cowbell', name: 'Cowbell', emoji: '🐄', key: 'v', accent: '#34d399' }
];

/**
 * Sampled-kit catalogs. Each entry maps a pad id to one or more candidate
 * audio URLs (the loader tries them in order until one decodes). Sources
 * are the smpldsnds/drum-machines repo on raw.githubusercontent.com which
 * mirrors well-circulated public-domain drum-machine samples; CORS is
 * permissive there so the proxy step usually short-circuits to a direct
 * fetch (proxy.js falls back automatically if it doesn't).
 *
 * Pads are mapped to the closest equivalent voice on each machine. Some
 * substitutions are deliberate: TR-808 has no acoustic tambourine, so we
 * use its `maraca` shake — the timbre is close enough on a 4x3 pad layout
 * that it reads as "shaker accent" rather than "wrong sample".
 */
const SAMPLE_DRUMS_BASE = 'https://raw.githubusercontent.com/smpldsnds/drum-machines/main';

const SAMPLED_KIT_CATALOGS = {
  linndrum: {
    snare: [`${SAMPLE_DRUMS_BASE}/LM-2/snare-m.ogg`],
    clap: [`${SAMPLE_DRUMS_BASE}/LM-2/clap.ogg`],
    'closed-hat': [`${SAMPLE_DRUMS_BASE}/LM-2/hhclosed.ogg`],
    'open-hat': [`${SAMPLE_DRUMS_BASE}/LM-2/hhopen.ogg`],
    kick: [`${SAMPLE_DRUMS_BASE}/LM-2/kick.ogg`],
    stick: [`${SAMPLE_DRUMS_BASE}/LM-2/stick-m.ogg`],
    ride: [`${SAMPLE_DRUMS_BASE}/LM-2/ride.ogg`],
    crash: [`${SAMPLE_DRUMS_BASE}/LM-2/crash.ogg`],
    'low-tom': [`${SAMPLE_DRUMS_BASE}/LM-2/tom-l.ogg`],
    'mid-tom': [`${SAMPLE_DRUMS_BASE}/LM-2/tom-m.ogg`],
    tambourine: [`${SAMPLE_DRUMS_BASE}/LM-2/tambourine.ogg`],
    cowbell: [`${SAMPLE_DRUMS_BASE}/LM-2/cowbell.ogg`]
  },
  'tr-808': {
    snare: [`${SAMPLE_DRUMS_BASE}/TR-808/snare/sd5050.ogg`],
    clap: [`${SAMPLE_DRUMS_BASE}/TR-808/clap/cp.ogg`],
    'closed-hat': [`${SAMPLE_DRUMS_BASE}/TR-808/hihat-close/ch.ogg`],
    'open-hat': [`${SAMPLE_DRUMS_BASE}/TR-808/hihat-open/oh50.ogg`],
    kick: [`${SAMPLE_DRUMS_BASE}/TR-808/kick/bd5050.ogg`],
    stick: [`${SAMPLE_DRUMS_BASE}/TR-808/rimshot/rs.ogg`],
    ride: [`${SAMPLE_DRUMS_BASE}/TR-808/cymbal/cy7510.ogg`],
    crash: [`${SAMPLE_DRUMS_BASE}/TR-808/cymbal/cy0050.ogg`],
    'low-tom': [`${SAMPLE_DRUMS_BASE}/TR-808/tom-low/lt50.ogg`],
    'mid-tom': [`${SAMPLE_DRUMS_BASE}/TR-808/mid-tom/mt50.ogg`],
    tambourine: [`${SAMPLE_DRUMS_BASE}/TR-808/maraca/ma.ogg`],
    cowbell: [`${SAMPLE_DRUMS_BASE}/TR-808/cowbell/cb.ogg`]
  }
};

// Per-pad gain trim so sampled hits sit at roughly the same loudness as the
// synth voices. Mostly small attenuations: cymbals and open hats are long
// and dominate a mix without a -6 dB shave.
const SAMPLE_KIT_GAINS = {
  snare: 0.95,
  clap: 0.85,
  'closed-hat': 0.6,
  'open-hat': 0.5,
  kick: 1.0,
  stick: 0.85,
  ride: 0.55,
  crash: 0.5,
  'low-tom': 0.95,
  'mid-tom': 0.95,
  tambourine: 0.7,
  cowbell: 0.8
};

const SAMPLED_KITS = new Set(Object.keys(SAMPLED_KIT_CATALOGS));
const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4'
];
const RECORDING_TAIL_MS = 1500;
const POSTS_AUDIO_BITS_PER_SECOND = 12000;
const POSTS_AUDIO_MAX_BYTES = 180000;

class DrumKit {
  constructor() {
    this.kit = 'linndrum';
    this._noiseBuffer = null;
    // Lazy-loaded SampleKit per sampled-kit name. Loading is kicked off on
    // the first selection; subsequent hits get an instant cache lookup.
    this._sampleKits = new Map(); // name -> SampleKit
    this._sampleKitStatus = new Map(); // name -> 'idle' | 'loading' | 'ready' | 'error'
    this.onStatusChange = () => {};
  }

  setKit(name) {
    this.kit = name;
    if (SAMPLED_KITS.has(name)) this._ensureSampleKit(name);
  }

  isSampledKit(name = this.kit) {
    return SAMPLED_KITS.has(name);
  }

  sampleKitStatus(name = this.kit) {
    return this._sampleKitStatus.get(name) || 'idle';
  }

  /**
   * Begin loading a sampled kit. Idempotent — repeat calls join the same
   * promise. The synth fallback is always available while loading, so this
   * is purely a "warm the cache" call from the page.
   */
  _ensureSampleKit(name) {
    if (this._sampleKits.has(name)) return this._sampleKits.get(name);
    const catalog = SAMPLED_KIT_CATALOGS[name];
    if (!catalog) return null;
    const kit = new SampleKit(catalog);
    this._sampleKits.set(name, kit);
    this._sampleKitStatus.set(name, 'loading');
    this.onStatusChange(name, 'loading');
    kit
      .preload()
      .then(() => {
        const next = kit.buffers.size > 0 ? 'ready' : 'error';
        this._sampleKitStatus.set(name, next);
        this.onStatusChange(name, next);
      })
      .catch(() => {
        this._sampleKitStatus.set(name, 'error');
        this.onStatusChange(name, 'error');
      });
    return kit;
  }

  // Reusable white-noise buffer (1s, mono). Cheaper than recreating.
  noiseBuffer() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const ctx = getCtx();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
    return buf;
  }

  noiseSource() {
    const ctx = getCtx();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    return src;
  }

  hit(name, destination = null, when = null) {
    const ctx = getCtx();
    if (ctx.state === 'suspended') resumeIfSuspended();
    const master = destination || getMaster();
    const now = when ?? ctx.currentTime;

    // Sampled kits: try the buffer first; fall through to the synth voice
    // if this specific pad hasn't loaded yet (or permanently failed).
    if (SAMPLED_KITS.has(this.kit)) {
      const kit = this._sampleKits.get(this.kit);
      if (kit && kit.has(name)) {
        kit.play(name, { gain: SAMPLE_KIT_GAINS[name] ?? 0.9, destination: master, when: now });
        return;
      }
      // Fall through to a synth voice that approximates this pad.
    }

    const electric = this.kit === 'electronic' || this.kit === 'tr-808';

    switch (name) {
      case 'kick':
        return this.kick(ctx, master, now, electric);
      case 'snare':
        return this.snare(ctx, master, now, electric);
      case 'clap':
        return this.clap(ctx, master, now);
      case 'stick':
        return this.stick(ctx, master, now);
      case 'closed-hat':
        return this.hihat(ctx, master, now, electric ? 0.04 : 0.06);
      case 'open-hat':
        return this.hihat(ctx, master, now, electric ? 0.22 : 0.32);
      case 'crash':
        return this.cymbal(ctx, master, now, 1.4, false);
      case 'ride':
        return this.cymbal(ctx, master, now, 0.8, true);
      case 'tambourine':
        return this.tambourine(ctx, master, now);
      case 'low-tom':
        return this.tom(ctx, master, now, electric ? 80 : 110);
      case 'mid-tom':
        return this.tom(ctx, master, now, electric ? 140 : 180);
      case 'cowbell':
        return this.cowbell(ctx, master, now);
      default:
        return null;
    }
  }

  kick(ctx, master, now, electric) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const startFreq = electric ? 160 : 120;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(electric ? 30 : 45, now + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (electric ? 0.5 : 0.4));

    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.6);

    // Click transient
    const noise = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    noise.connect(hp);
    hp.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(now);
    noise.stop(now + 0.05);
  }

  snare(ctx, master, now, electric) {
    // Tonal body
    const osc = ctx.createOscillator();
    osc.type = electric ? 'square' : 'triangle';
    osc.frequency.value = electric ? 220 : 200;
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.45, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(now);
    osc.stop(now + 0.15);

    // Noise (rattle)
    const noise = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = electric ? 2200 : 1500;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(electric ? 0.85 : 0.65, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + (electric ? 0.14 : 0.2));
    noise.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(now);
    noise.stop(now + 0.25);
  }

  clap(ctx, master, now) {
    // Three quick noise bursts to mimic multiple hands.
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.012;
      const noise = this.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 1.4;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.6, t + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      noise.connect(bp);
      bp.connect(gain);
      gain.connect(master);
      noise.start(t);
      noise.stop(t + 0.08);
    }
    // Long tail
    const tail = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 0.9;
    const gain = ctx.createGain();
    const t0 = now + 0.04;
    gain.gain.setValueAtTime(0.35, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    tail.connect(bp);
    bp.connect(gain);
    gain.connect(master);
    tail.start(t0);
    tail.stop(t0 + 0.22);
  }

  stick(ctx, master, now) {
    const noise = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4500;
    bp.Q.value = 8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    noise.connect(bp);
    bp.connect(gain);
    gain.connect(master);
    noise.start(now);
    noise.stop(now + 0.06);
  }

  hihat(ctx, master, now, duration) {
    // Stacked square oscillators give the metallic ringing.
    const freqs = [320, 540, 800, 1080, 1380, 1800];
    const sumGain = ctx.createGain();
    sumGain.gain.value = 0.18;
    const oscNodes = freqs.map((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(sumGain);
      osc.start(now);
      osc.stop(now + duration + 0.02);
      return osc;
    });
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    sumGain.connect(hp);
    hp.connect(gain);
    gain.connect(master);
    void oscNodes;
  }

  cymbal(ctx, master, now, duration, isRide) {
    const noise = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = isRide ? 4500 : 6000;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = isRide ? 5200 : 8000;
    peak.gain.value = 6;
    peak.Q.value = 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    noise.connect(hp);
    hp.connect(peak);
    peak.connect(gain);
    gain.connect(master);
    noise.start(now);
    noise.stop(now + duration + 0.05);

    if (isRide) {
      // Ride bell: short ringing tone on top.
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1100;
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.18, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(oscGain);
      oscGain.connect(master);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  }

  tambourine(ctx, master, now) {
    // Two quick noise bursts with a metallic shimmer.
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.03;
      const noise = this.noiseSource();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.45, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      noise.connect(hp);
      hp.connect(gain);
      gain.connect(master);
      noise.start(t);
      noise.stop(t + 0.15);
    }
  }

  tom(ctx, master, now, baseFreq) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.85, now + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.85, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  cowbell(ctx, master, now) {
    // Two square waves at famous Roland cowbell frequencies.
    const freqs = [540, 800];
    const sum = ctx.createGain();
    sum.gain.value = 0.4;
    freqs.forEach((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(sum);
      osc.start(now);
      osc.stop(now + 0.3);
    });
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    sum.connect(bp);
    bp.connect(gain);
    gain.connect(master);
  }
}

const pickAudioMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  return AUDIO_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported?.(mime)) || '';
};

/**
 * Capture one deliberate pass of the loop into an isolated Web Audio output.
 * This does not stop, restart, or otherwise disturb the live LoopTrack.
 */
async function renderLoopAudio(loopTrack, drumKit) {
  if (!loopTrack.hasLoop()) throw new Error('Record a loop before making a post.');

  const mimeType = pickAudioMimeType();
  if (mimeType == null) throw new Error("This browser can't create an audio attachment.");

  const ctx = getCtx();
  await ctx.resume();
  const recordDestination = ctx.createMediaStreamDestination();
  const recordGain = ctx.createGain();
  recordGain.gain.value = Number(volumeEl.value) / 100;
  recordGain.connect(recordDestination);

  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(recordDestination.stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: POSTS_AUDIO_BITS_PER_SECOND
    });
  } catch (error) {
    recordGain.disconnect();
    recordDestination.stream.getTracks().forEach((track) => track.stop());
    throw new Error("This browser can't create an audio attachment.", { cause: error });
  }

  const recording = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = () => reject(recorder.error || new Error('Audio recording failed.'));
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      if (blob.size === 0) reject(new Error('The browser produced an empty audio recording.'));
      else resolve(blob);
    };
  });

  const leadSeconds = 0.05;
  recorder.start();
  const startAt = ctx.currentTime + leadSeconds;
  for (const event of loopTrack.events.slice().sort((a, b) => a.time - b.time)) {
    drumKit.hit(event.id, recordGain, startAt + event.time / 1000);
  }

  const stopDelay = leadSeconds * 1000 + loopTrack.loopLength + RECORDING_TAIL_MS;
  const stopTimer = window.setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, stopDelay);

  try {
    return await recording;
  } finally {
    window.clearTimeout(stopTimer);
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* already stopping */
      }
    }
    recordGain.disconnect();
    recordDestination.stream.getTracks().forEach((track) => track.stop());
  }
}

// ---------- Page wiring ----------

const padsContainer = document.getElementById('drum-pads');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const kitEl = document.getElementById('kit');
const kitStatusEl = document.getElementById('kit-status');

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.kit === 'string') {
  const opt = Array.from(kitEl.options).find((o) => o.value === prefs.kit);
  if (opt) kitEl.value = prefs.kit;
}

const kit = new DrumKit();
setMasterVolume(Number(volumeEl.value) / 100);

const updateKitStatus = () => {
  if (!kitStatusEl) return;
  if (!kit.isSampledKit()) {
    kitStatusEl.textContent = '';
    return;
  }
  const status = kit.sampleKitStatus();
  if (status === 'loading') kitStatusEl.textContent = 'loading…';
  else if (status === 'error') kitStatusEl.textContent = 'offline · synth fallback';
  else kitStatusEl.textContent = '';
};

kit.onStatusChange = (name) => {
  if (name === kit.kit) updateKitStatus();
};
kit.setKit(kitEl.value);
updateKitStatus();

// LoopTrack instance — plays back via `playPad` (sound + visuals, no recording).
const looper = new LoopTrack({ onPlay: (id) => playPad(id) });

// Build pads
const padEls = new Map(); // id -> element
const keyToPad = new Map(); // key -> id
for (const def of PAD_LAYOUT) {
  const el = document.createElement('button');
  el.className = 'drum-pad';
  el.dataset.id = def.id;
  el.style.setProperty('--pad-accent', def.accent);
  el.setAttribute('aria-label', `${def.name} (${def.key.toUpperCase()})`);
  el.innerHTML = `
    <span class="drum-pad-key" aria-hidden="true">${def.key.toUpperCase()}</span>
    <span class="drum-pad-emoji" aria-hidden="true">${def.emoji}</span>
    <span class="drum-pad-name">${def.name}</span>
  `;
  padsContainer.appendChild(el);
  padEls.set(def.id, el);
  keyToPad.set(def.key, def.id);
}

let nowPlayingTimer = null;
const announcePad = (id) => {
  const def = PAD_LAYOUT.find((p) => p.id === id);
  if (!def) return;
  nowPlaying.textContent = def.name;
  nowPlaying.classList.add('active');
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    nowPlaying.classList.remove('active');
  }, 350);
};

const flashPad = (id) => {
  const el = padEls.get(id);
  if (!el) return;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 110);
};

// Plays a pad with sound + visuals only (no looper recording).
const playPad = (id) => {
  kit.hit(id);
  flashPad(id);
  announcePad(id);
};

const triggerPad = (id) => {
  window.heymingAchievements?.unlockForCurrentApp('first-action');
  playPad(id);
  looper.noteHit(id);
};

// Pointer input — trigger on press, and again whenever the pointer drags
// onto a new pad so a sweep across the kit makes a drumroll.
const lastPadByPointer = new Map();

const triggerFromPad = (padEl, pointerId) => {
  if (!padEl) return;
  if (lastPadByPointer.get(pointerId) === padEl) return;
  lastPadByPointer.set(pointerId, padEl);
  triggerPad(padEl.dataset.id);
};

padsContainer.addEventListener('pointerdown', (event) => {
  const padEl = event.target.closest('.drum-pad');
  if (!padEl) return;
  padsContainer.setPointerCapture?.(event.pointerId);
  triggerFromPad(padEl, event.pointerId);
  event.preventDefault();
});

padsContainer.addEventListener('pointermove', (event) => {
  if (!lastPadByPointer.has(event.pointerId)) return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const padEl = target && target.closest && target.closest('.drum-pad');
  if (padEl) triggerFromPad(padEl, event.pointerId);
});

const endDrumPointer = (event) => {
  lastPadByPointer.delete(event.pointerId);
};
padsContainer.addEventListener('pointerup', endDrumPointer);
padsContainer.addEventListener('pointercancel', endDrumPointer);

// Keyboard input
const heldKeys = new Set();
document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const target = event.target;
  if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return;
  }
  const key = event.key.toLowerCase();
  const id = keyToPad.get(key);
  if (!id) return;
  if (heldKeys.has(key)) return;
  heldKeys.add(key);
  triggerPad(id);
  event.preventDefault();
});

document.addEventListener('keyup', (event) => {
  heldKeys.delete(event.key.toLowerCase());
});

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  Prefs.save({ volume: Number(volumeEl.value), kit: kitEl.value });
});

kitEl.addEventListener('change', () => {
  kit.setKit(kitEl.value);
  updateKitStatus();
  Prefs.save({ volume: Number(volumeEl.value), kit: kitEl.value });
});

window.addEventListener('focus', () => resumeIfSuspended());

// ---------- Looper UI ----------

const recBtn = document.getElementById('loop-record');
const playBtn = document.getElementById('loop-play');
const clearBtn = document.getElementById('loop-clear');
const postBtn = document.getElementById('loop-post');
const postStatusEl = document.getElementById('loop-post-status');

createLoopTrackController(looper, {
  recBtn,
  playBtn,
  clearBtn,
  statusEl: document.getElementById('loop-status'),
  barEl: document.getElementById('loop-bar'),
  barFillEl: document.getElementById('loop-bar-fill'),
  playLabelEl: playBtn.querySelector('.loop-btn-label'),
  playIconEl: playBtn.querySelector('.loop-btn-icon'),
  onUserAction: () => resumeIfSuspended()
});

let postBusy = false;
const updatePostButton = () => {
  const ready = looper.hasLoop();
  postBtn.disabled = postBusy || !ready;
  postBtn.title = postBusy
    ? 'Preparing post…'
    : ready
    ? 'Make a Post'
    : 'Record a loop first, then make a post';
};
looper.on(updatePostButton);
updatePostButton();

postBtn.addEventListener('click', async () => {
  if (postBusy || !looper.hasLoop()) return;
  postBusy = true;
  updatePostButton();
  postStatusEl.classList.remove('error');
  postStatusEl.textContent = 'Preparing audio…';
  try {
    const audio = await renderLoopAudio(looper, kit);
    if (audio.size > POSTS_AUDIO_MAX_BYTES) {
      throw new Error('This loop is too long to attach. Record a shorter loop and try again.');
    }
    postStatusEl.textContent = 'Opening Posts…';
    const { share } = await import('/posts/share-client.js');
    await share({
      text: '🥁 Drum loop\n\nMade with [Drums](/play/drums/)',
      attachments: [audio]
    });
  } catch (error) {
    console.warn('Posting drum loop failed', error);
    postBusy = false;
    updatePostButton();
    postStatusEl.classList.add('error');
    postStatusEl.textContent = error instanceof Error ? error.message : 'Could not make a post.';
  }
});

// Keyboard shortcuts: Space = Rec, P = Play/Stop. Skip when typing in inputs.
document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const target = event.target;
  if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return;
  }
  if (event.code === 'Space') {
    looper.toggleRecord();
    event.preventDefault();
    return;
  }
  if (event.key === 'p' || event.key === 'P') {
    looper.togglePlay();
    event.preventDefault();
  }
});
