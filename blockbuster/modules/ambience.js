/**
 * Store ambience — quiet room tone + soft door chime.
 * No muzak pad (that read as harsh / synthetic). Mute persists in localStorage.
 */

const MUTE_KEY = 'heyming.blockbuster.mute';

/**
 * @param {{ onMuteChange?: (muted: boolean) => void }} [opts]
 */
export function createAmbience(opts = {}) {
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {GainNode | null} */
  let master = null;
  /** @type {AudioBufferSourceNode | null} */
  let humSrc = null;
  let started = false;
  let muted = false;
  let chimePlayed = false;

  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    /* ignore */
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC =
      window.AudioContext ||
      /** @type {typeof AudioContext | undefined} */ (window).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    return ctx;
  }

  /**
   * Very quiet HVAC / room tone: long brown-noise loop, steep lowpass,
   * barely-there gain so footsteps stay the loudest thing.
   */
  function startHum() {
    if (!ctx || !master || humSrc) return;
    const dur = 4;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.015 * white) / 1.015;
      data[i] = last * 2.2;
    }
    // Crossfade seam so the loop doesn't click
    const fade = Math.min(2048, Math.floor(data.length / 8));
    for (let i = 0; i < fade; i++) {
      const w = i / fade;
      data[i] *= w;
      data[data.length - 1 - i] *= w;
    }

    humSrc = ctx.createBufferSource();
    humSrc.buffer = buffer;
    humSrc.loop = true;

    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 140;
    low.Q.value = 0.5;

    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 40;

    const gain = ctx.createGain();
    gain.gain.value = 0.018;

    humSrc.connect(high);
    high.connect(low);
    low.connect(gain);
    gain.connect(master);
    humSrc.start();
  }

  /** Soft two-tone door chime on first enter (quieter than before). */
  function playDoorChime() {
    if (!ctx || !master || chimePlayed) return;
    chimePlayed = true;
    const notes = [523.25, 659.25];
    const t0 = ctx.currentTime + 0.08;
    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = notes[i];
      const gain = ctx.createGain();
      const start = t0 + i * 0.22;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.035, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.75);
    }
  }

  /** Call from first pointer-lock / touch / key — unlocks AudioContext. */
  function start() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') void c.resume();
    if (!started) {
      started = true;
      startHum();
    }
    playDoorChime();
  }

  /** @param {boolean} next */
  function setMuted(next) {
    muted = next;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
    }
    opts.onMuteChange?.(muted);
  }

  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  return {
    start,
    setMuted,
    toggleMute,
    isMuted() {
      return muted;
    },
    hasStarted() {
      return started;
    }
  };
}
