/**
 * Synthesized drum kit. Pure Web Audio — no samples, no network.
 *
 * Each voice is a one-shot composition of oscillators + filtered noise,
 * tuned to roughly approximate the canonical drum sound. Two timbral
 * variants ("acoustic" softer, "electronic" punchier) are selectable.
 */
import { getCtx, getMaster, resumeIfSuspended, setMasterVolume } from '../shared/audio.js';
import { makePrefs } from '../shared/prefs.js';

const Prefs = makePrefs('play.drums.prefs.v1');

/**
 * Pad layout. Three rows of four, mapped to the QWERTY top/home/bottom rows
 * so it doubles as a 4x3 keyboard pad.
 *
 *   Q W E R   crash open-hat hat ride
 *   A S D F   snare clap stick tambo
 *   Z X C V   kick low-tom mid-tom cowbell
 */
const PAD_LAYOUT = [
  { id: 'crash', name: 'Crash', emoji: '💥', key: 'q', accent: '#fbbf24' },
  { id: 'open-hat', name: 'Open Hat', emoji: '〽️', key: 'w', accent: '#fbbf24' },
  { id: 'closed-hat', name: 'Closed Hat', emoji: '🎩', key: 'e', accent: '#fbbf24' },
  { id: 'ride', name: 'Ride', emoji: '🛎️', key: 'r', accent: '#fbbf24' },
  { id: 'snare', name: 'Snare', emoji: '🥁', key: 'a', accent: '#f472b6' },
  { id: 'clap', name: 'Clap', emoji: '👏', key: 's', accent: '#f472b6' },
  { id: 'stick', name: 'Stick', emoji: '🪵', key: 'd', accent: '#f472b6' },
  { id: 'tambourine', name: 'Tambourine', emoji: '✨', key: 'f', accent: '#f472b6' },
  { id: 'kick', name: 'Kick', emoji: '🦶', key: 'z', accent: '#818cf8' },
  { id: 'low-tom', name: 'Low Tom', emoji: '🛢️', key: 'x', accent: '#818cf8' },
  { id: 'mid-tom', name: 'Mid Tom', emoji: '🛢️', key: 'c', accent: '#818cf8' },
  { id: 'cowbell', name: 'Cowbell', emoji: '🐄', key: 'v', accent: '#34d399' }
];

class DrumKit {
  constructor() {
    this.kit = 'acoustic';
    this._noiseBuffer = null;
  }

  setKit(name) {
    this.kit = name;
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

  hit(name) {
    const ctx = getCtx();
    if (ctx.state === 'suspended') resumeIfSuspended();
    const master = getMaster();
    const now = ctx.currentTime;
    const electric = this.kit === 'electronic';

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

// ---------- Page wiring ----------

const padsContainer = document.getElementById('drum-pads');
const nowPlaying = document.getElementById('now-playing');
const volumeEl = document.getElementById('volume');
const kitEl = document.getElementById('kit');

const prefs = Prefs.load();
if (typeof prefs.volume === 'number') volumeEl.value = String(prefs.volume);
if (typeof prefs.kit === 'string') {
  const opt = Array.from(kitEl.options).find((o) => o.value === prefs.kit);
  if (opt) kitEl.value = prefs.kit;
}

const kit = new DrumKit();
kit.setKit(kitEl.value);
setMasterVolume(Number(volumeEl.value) / 100);

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

const triggerPad = (id) => {
  kit.hit(id);
  flashPad(id);
  announcePad(id);
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
  Prefs.save({ volume: Number(volumeEl.value), kit: kitEl.value });
});

window.addEventListener('focus', () => resumeIfSuspended());
