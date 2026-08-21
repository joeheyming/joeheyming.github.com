/**
 * Browser metronome with Web Audio look-ahead scheduling.
 *
 * Uses the canonical "two-clock" pattern (Chris Wilson, "A Tale of Two
 * Clocks"): a `setInterval` running every 25ms peeks 100ms into the future
 * on the AudioContext clock and pre-schedules any clicks that fall in
 * that window. Each click's audio start time is `ctx.currentTime`-anchored,
 * so even if the JS thread stalls briefly the click sample fires exactly
 * on the beat. The visual pulse is dispatched via setTimeout aligned to
 * the same audio time.
 */
import { getCtx, getMaster, resumeIfSuspended, setMasterVolume } from '../shared/audio.js';
import { SampleKit, playBuffer } from '../shared/samples.js';
import { makePrefs } from '../shared/prefs.js';

const Prefs = makePrefs('play.metronome.prefs.v1');

const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_S = 0.1;

const TEMPO_NAMES = [
  { max: 24, name: 'Larghissimo' },
  { max: 40, name: 'Grave' },
  { max: 60, name: 'Largo' },
  { max: 66, name: 'Larghetto' },
  { max: 76, name: 'Adagio' },
  { max: 108, name: 'Andante' },
  { max: 120, name: 'Moderato' },
  { max: 156, name: 'Allegro' },
  { max: 176, name: 'Vivace' },
  { max: 200, name: 'Presto' },
  { max: Infinity, name: 'Prestissimo' }
];

function tempoNameFor(bpm) {
  for (const entry of TEMPO_NAMES) {
    if (bpm < entry.max) return entry.name;
  }
  return '';
}

/**
 * Sample-backed click voices. Each entry uses a single one-shot from the
 * smpldsnds/drum-machines public-domain catalog and uses `playbackRate`
 * tweaks to derive the three pitch tiers (downbeat / beat / sub) from the
 * same base sample. This keeps the network footprint to one tiny OGG per
 * voice and still gives the metronome a real-instrument feel.
 *
 * The `gainFor()` and `rateFor()` ramps roughly match the synth voices
 * below so an A/B comparison feels like a timbre swap rather than a
 * loudness swap.
 */
const SAMPLE_CLICK_BASE = 'https://raw.githubusercontent.com/smpldsnds/drum-machines/main';

const SAMPLE_CLICK_CATALOG = {
  'acoustic-clave': {
    name: 'Clave',
    url: `${SAMPLE_CLICK_BASE}/TR-808/clave/cl.ogg`
  },
  'acoustic-cowbell': {
    name: 'Cowbell',
    url: `${SAMPLE_CLICK_BASE}/TR-808/cowbell/cb.ogg`
  },
  'acoustic-rim': {
    name: 'Rimshot',
    url: `${SAMPLE_CLICK_BASE}/TR-808/rimshot/rs.ogg`
  }
};

const sampleClickKit = new SampleKit(
  Object.fromEntries(Object.entries(SAMPLE_CLICK_CATALOG).map(([k, v]) => [k, [v.url]]))
);
let sampleClickStatus = 'idle';
const sampleClickStatusListeners = new Set();
function setSampleClickStatus(s) {
  sampleClickStatus = s;
  for (const fn of sampleClickStatusListeners) fn(s);
}

function ensureSampleClickKit() {
  if (sampleClickStatus === 'loading' || sampleClickStatus === 'ready') return;
  setSampleClickStatus('loading');
  sampleClickKit
    .preload()
    .then(() => {
      setSampleClickStatus(sampleClickKit.buffers.size > 0 ? 'ready' : 'error');
    })
    .catch(() => setSampleClickStatus('error'));
}

function gainFor(isDown, isSub) {
  if (isDown) return 0.95;
  if (isSub) return 0.35;
  return 0.7;
}

function rateFor(isDown, isSub) {
  // Pitch-shift the same one-shot up for the downbeat and down for the sub
  // so the three tiers remain audibly distinct without needing three files.
  if (isDown) return 1.18;
  if (isSub) return 0.82;
  return 1.0;
}

/**
 * Synthesises the click for a single beat. Three pitch tiers:
 *   - downbeat (first beat of a measure): brightest + loudest
 *   - normal beat: standard
 *   - subdivision: dimmer/lower
 */
function playClick(time, kind, sound) {
  const ctx = getCtx();
  const master = getMaster();

  // Pitch + amplitude per tier.
  const isDown = kind === 'downbeat';
  const isSub = kind === 'sub';

  if (SAMPLE_CLICK_CATALOG[sound]) {
    if (sampleClickKit.has(sound)) {
      playBuffer(sampleClickKit.buffers.get(sound), {
        gain: gainFor(isDown, isSub),
        rate: rateFor(isDown, isSub),
        when: time
      });
      return;
    }
    // Sample not loaded yet: fall through to the synth click for instant
    // feedback. ensureSampleClickKit() is being called by the page wiring.
    return click(ctx, master, time, isDown, isSub);
  }

  switch (sound) {
    case 'wood':
      return woodblock(ctx, master, time, isDown, isSub);
    case 'beep':
      return beep(ctx, master, time, isDown, isSub);
    case 'cowbell':
      return cowbell(ctx, master, time, isDown, isSub);
    case 'click':
    default:
      return click(ctx, master, time, isDown, isSub);
  }
}

function click(ctx, master, t, isDown, isSub) {
  const freq = isDown ? 1800 : isSub ? 900 : 1200;
  const peak = isDown ? 0.6 : isSub ? 0.18 : 0.4;
  const dur = isSub ? 0.03 : 0.05;

  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.01);
}

function woodblock(ctx, master, t, isDown, isSub) {
  const freq = isDown ? 1100 : isSub ? 700 : 880;
  const peak = isDown ? 0.55 : isSub ? 0.18 : 0.4;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq * 1.4, t);
  osc.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + 0.1);
}

function beep(ctx, master, t, isDown, isSub) {
  const freq = isDown ? 880 : isSub ? 440 : 660;
  const peak = isDown ? 0.4 : isSub ? 0.14 : 0.28;
  const dur = isSub ? 0.04 : 0.06;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.01);
}

function cowbell(ctx, master, t, isDown, isSub) {
  // Two square waves at Roland-cowbell pitches plus a band-pass envelope.
  const peak = isDown ? 0.55 : isSub ? 0.18 : 0.4;
  const detune = isDown ? 0 : isSub ? -300 : -150;
  const freqs = [540, 800];
  const sum = ctx.createGain();
  sum.gain.value = 0.45;
  const oscs = freqs.map((f) => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    osc.detune.value = detune;
    osc.connect(sum);
    osc.start(t);
    osc.stop(t + 0.18);
    return osc;
  });
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.14);
  sum.connect(bp);
  bp.connect(gain);
  gain.connect(master);
  void oscs;
}

// ---------- Scheduler ---------------------------------------------------

class Metronome {
  constructor() {
    this.bpm = 100;
    this.beatsPerMeasure = 4;
    this.subdivision = 1;
    this.sound = 'click';
    this.accentDownbeat = true;

    this._intervalId = null;
    this._nextTick = 0; // AudioContext time of the next subdivision tick
    this._subIndex = 0; // 0..(beatsPerMeasure*subdivision - 1)
    this._listeners = new Set();
    this.running = false;
  }

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(event) {
    for (const fn of this._listeners) fn(event);
  }

  setBpm(bpm) {
    this.bpm = Math.max(30, Math.min(300, Math.round(bpm)));
  }

  setBeatsPerMeasure(n) {
    this.beatsPerMeasure = Math.max(1, Math.min(16, n));
    if (this._subIndex >= this.beatsPerMeasure * this.subdivision) this._subIndex = 0;
  }

  setSubdivision(n) {
    this.subdivision = Math.max(1, Math.min(8, n));
    this._subIndex = 0;
  }

  setSound(name) {
    this.sound = name;
  }

  setAccent(on) {
    this.accentDownbeat = !!on;
  }

  /** Seconds between consecutive subdivision ticks at the current BPM. */
  _tickInterval() {
    return 60 / this.bpm / this.subdivision;
  }

  start() {
    if (this.running) return;
    resumeIfSuspended();
    const ctx = getCtx();
    this.running = true;
    window.heymingAchievements?.unlockForCurrentApp('first-action');
    this._subIndex = 0;
    // Tiny lead so the very first click isn't clipped by a still-warming graph.
    this._nextTick = ctx.currentTime + 0.06;
    this._scheduleAhead();
    this._intervalId = setInterval(() => this._scheduleAhead(), SCHEDULER_INTERVAL_MS);
    this._emit({ type: 'start' });
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this._intervalId != null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._emit({ type: 'stop' });
  }

  toggle() {
    if (this.running) this.stop();
    else this.start();
  }

  _scheduleAhead() {
    const ctx = getCtx();
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    while (this._nextTick < horizon) {
      const tickTime = this._nextTick;
      const subIndex = this._subIndex;
      const beatIndex = Math.floor(subIndex / this.subdivision);
      const isBeat = subIndex % this.subdivision === 0;
      const isDownbeat = this.accentDownbeat && beatIndex === 0 && isBeat;
      const kind = isDownbeat ? 'downbeat' : isBeat ? 'beat' : 'sub';

      playClick(tickTime, kind, this.sound);

      // Schedule the visual pulse so it lands when the audio actually fires.
      const delayMs = Math.max(0, (tickTime - ctx.currentTime) * 1000);
      const snapshot = { kind, beatIndex, subIndex, time: tickTime };
      setTimeout(() => {
        if (!this.running) return;
        this._emit({ type: 'tick', ...snapshot });
      }, delayMs);

      this._subIndex = (this._subIndex + 1) % (this.beatsPerMeasure * this.subdivision);
      this._nextTick += this._tickInterval();
    }
  }
}

// ---------- Tap-tempo helper -------------------------------------------

class TapTempo {
  constructor() {
    this.taps = [];
    this.timeoutId = null;
  }

  /** Record a tap. Returns the rolling BPM estimate, or null if not enough taps yet. */
  tap() {
    const now = performance.now();
    // If the user pauses for more than 2s, restart the tap window.
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) {
      this.taps = [];
    }
    this.taps.push(now);
    if (this.taps.length > 6) this.taps.shift();
    this._scheduleReset();
    if (this.taps.length < 2) return null;
    const intervals = [];
    for (let i = 1; i < this.taps.length; i++) {
      intervals.push(this.taps[i] - this.taps[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return 60000 / avg;
  }

  _scheduleReset() {
    if (this.timeoutId != null) clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => {
      this.taps = [];
      this.timeoutId = null;
    }, 2200);
  }
}

// ---------- Page wiring -------------------------------------------------

const bpmEl = document.getElementById('bpm');
const bpmSliderEl = document.getElementById('bpm-slider');
const bpmDownEl = document.getElementById('bpm-down');
const bpmUpEl = document.getElementById('bpm-up');
const sigEl = document.getElementById('signature');
const subEl = document.getElementById('subdivision');
const soundEl = document.getElementById('sound');
const soundStatusEl = document.getElementById('sound-status');
const accentEl = document.getElementById('accent');
const volumeEl = document.getElementById('volume');
const startStopEl = document.getElementById('start-stop');
const startStopLabel = startStopEl.querySelector('.btn-label');
const startStopIcon = startStopEl.querySelector('.btn-icon');
const tapEl = document.getElementById('tap-tempo');
const beatDotsEl = document.getElementById('beat-dots');
const pendulumArm = document.getElementById('pendulum-arm');
const tempoNameEl = document.getElementById('tempo-name');
const nowPlayingEl = document.getElementById('now-playing');

const metronome = new Metronome();
const tap = new TapTempo();

// Restore prefs.
const prefs = Prefs.load();
if (typeof prefs.bpm === 'number') {
  bpmEl.value = String(prefs.bpm);
  bpmSliderEl.value = String(prefs.bpm);
  metronome.setBpm(prefs.bpm);
}
if (typeof prefs.signature === 'string') {
  const opt = Array.from(sigEl.options).find((o) => o.value === prefs.signature);
  if (opt) sigEl.value = prefs.signature;
}
if (typeof prefs.subdivision === 'string') {
  const opt = Array.from(subEl.options).find((o) => o.value === prefs.subdivision);
  if (opt) subEl.value = prefs.subdivision;
}
if (typeof prefs.sound === 'string') {
  const opt = Array.from(soundEl.options).find((o) => o.value === prefs.sound);
  if (opt) soundEl.value = prefs.sound;
}
if (typeof prefs.accent === 'boolean') accentEl.checked = prefs.accent;
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);

metronome.setBeatsPerMeasure(Number(sigEl.value));
metronome.setSubdivision(Number(subEl.value));
metronome.setSound(soundEl.value);
metronome.setAccent(accentEl.checked);
setMasterVolume(Number(volumeEl.value) / 100);

const savePrefs = () => {
  Prefs.save({
    bpm: Number(bpmEl.value),
    signature: sigEl.value,
    subdivision: subEl.value,
    sound: soundEl.value,
    accent: accentEl.checked,
    volume: Number(volumeEl.value)
  });
};

// ---- Beat-dots rendering ----

const renderBeatDots = () => {
  beatDotsEl.innerHTML = '';
  for (let i = 0; i < metronome.beatsPerMeasure; i++) {
    const dot = document.createElement('span');
    dot.className = 'beat-dot';
    if (i === 0) dot.classList.add('downbeat');
    beatDotsEl.appendChild(dot);
  }
};

renderBeatDots();

const flashBeatDot = (beatIndex) => {
  const dots = beatDotsEl.children;
  for (const dot of dots) dot.classList.remove('active');
  const dot = dots[beatIndex];
  if (dot) {
    dot.classList.add('active');
    setTimeout(() => dot.classList.remove('active'), 120);
  }
};

// ---- Pendulum swing ----

let swingDir = 1; // 1 = swing right next, -1 = swing left next
let pendulumStopTimer = null;

const swingPendulum = () => {
  // Sweep duration = one beat (subdivision-aware metronomes still swing on beats).
  const beatMs = (60 / metronome.bpm) * 1000;
  pendulumArm.style.setProperty('--swing', `${beatMs.toFixed(0)}ms`);
  pendulumArm.classList.remove(swingDir === 1 ? 'tick-left' : 'tick-right');
  pendulumArm.classList.add(swingDir === 1 ? 'tick-right' : 'tick-left');
  swingDir *= -1;
};

const restPendulum = () => {
  pendulumArm.classList.remove('tick-left', 'tick-right');
  swingDir = 1;
};

// ---- Tempo display ----

const tempoSync = (source) => {
  // Keep all three tempo widgets (number, slider, internal state) consistent.
  let v;
  if (source === 'number') v = Number(bpmEl.value);
  else if (source === 'slider') v = Number(bpmSliderEl.value);
  else v = metronome.bpm;
  if (!Number.isFinite(v)) v = metronome.bpm;
  metronome.setBpm(v);
  bpmEl.value = String(metronome.bpm);
  bpmSliderEl.value = String(metronome.bpm);
  tempoNameEl.textContent = tempoNameFor(metronome.bpm);
};

tempoSync();

// ---- Wire up controls ----

const updateStartStopUI = () => {
  startStopEl.setAttribute('aria-pressed', metronome.running ? 'true' : 'false');
  startStopLabel.textContent = metronome.running ? 'Stop' : 'Start';
  startStopIcon.textContent = metronome.running ? '■' : '▶';
};

bpmEl.addEventListener('input', () => {
  tempoSync('number');
  savePrefs();
});
bpmEl.addEventListener('blur', () => {
  tempoSync('number');
  savePrefs();
});
bpmSliderEl.addEventListener('input', () => {
  tempoSync('slider');
  savePrefs();
});
bpmDownEl.addEventListener('click', () => {
  metronome.setBpm(metronome.bpm - 1);
  tempoSync();
  savePrefs();
});
bpmUpEl.addEventListener('click', () => {
  metronome.setBpm(metronome.bpm + 1);
  tempoSync();
  savePrefs();
});

sigEl.addEventListener('change', () => {
  metronome.setBeatsPerMeasure(Number(sigEl.value));
  renderBeatDots();
  savePrefs();
});

subEl.addEventListener('change', () => {
  metronome.setSubdivision(Number(subEl.value));
  savePrefs();
});

const updateSoundStatus = () => {
  if (!soundStatusEl) return;
  if (!SAMPLE_CLICK_CATALOG[soundEl.value]) {
    soundStatusEl.textContent = '';
    return;
  }
  if (sampleClickStatus === 'loading') soundStatusEl.textContent = 'loading…';
  else if (sampleClickStatus === 'error') soundStatusEl.textContent = 'offline · click fallback';
  else soundStatusEl.textContent = '';
};

sampleClickStatusListeners.add(() => updateSoundStatus());

soundEl.addEventListener('change', () => {
  metronome.setSound(soundEl.value);
  if (SAMPLE_CLICK_CATALOG[soundEl.value]) ensureSampleClickKit();
  updateSoundStatus();
  savePrefs();
});

if (SAMPLE_CLICK_CATALOG[soundEl.value]) ensureSampleClickKit();
updateSoundStatus();

accentEl.addEventListener('change', () => {
  metronome.setAccent(accentEl.checked);
  savePrefs();
});

volumeEl.addEventListener('input', () => {
  setMasterVolume(Number(volumeEl.value) / 100);
  savePrefs();
});

startStopEl.addEventListener('click', () => {
  metronome.toggle();
});

let tapResetTimer = null;
tapEl.addEventListener('click', () => {
  resumeIfSuspended();
  const bpm = tap.tap();
  tapEl.classList.add('tapping');
  if (tapResetTimer) clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => tapEl.classList.remove('tapping'), 250);
  if (bpm != null && bpm >= 30 && bpm <= 300) {
    metronome.setBpm(bpm);
    tempoSync();
    savePrefs();
  }
});

// ---- Metronome event listeners ----

metronome.on((event) => {
  if (event.type === 'start') {
    updateStartStopUI();
    nowPlayingEl.textContent = `${metronome.bpm} BPM`;
    nowPlayingEl.classList.add('active');
    return;
  }
  if (event.type === 'stop') {
    updateStartStopUI();
    nowPlayingEl.textContent = '—';
    nowPlayingEl.classList.remove('active');
    if (pendulumStopTimer) clearTimeout(pendulumStopTimer);
    pendulumStopTimer = setTimeout(restPendulum, 200);
    for (const dot of beatDotsEl.children) dot.classList.remove('active');
    return;
  }
  if (event.type === 'tick') {
    if (event.kind !== 'sub') {
      flashBeatDot(event.beatIndex);
      swingPendulum();
    }
  }
});

updateStartStopUI();

// ---- Keyboard shortcuts ----

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const target = event.target;
  // Don't hijack typing in number/select inputs except the BPM number which
  // we still want to handle Up/Down arrow nudges on.
  const isInput =
    target instanceof HTMLElement &&
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) &&
    target.id !== 'bpm';
  if (isInput) return;

  if (event.code === 'Space') {
    metronome.toggle();
    event.preventDefault();
    return;
  }
  if (event.key === 't' || event.key === 'T') {
    tapEl.click();
    event.preventDefault();
    return;
  }
  const step = event.shiftKey ? 5 : 1;
  if (event.key === 'ArrowUp') {
    metronome.setBpm(metronome.bpm + step);
    tempoSync();
    savePrefs();
    event.preventDefault();
  } else if (event.key === 'ArrowDown') {
    metronome.setBpm(metronome.bpm - step);
    tempoSync();
    savePrefs();
    event.preventDefault();
  }
});

window.addEventListener('focus', () => resumeIfSuspended());
