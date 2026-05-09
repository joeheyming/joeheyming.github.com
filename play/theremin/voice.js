/**
 * Theremin single-voice drone. One voice per page — touch and air
 * mode share it and only one is active at a time.
 *
 *   osc → amp → master
 *   vibratoLfo → vibratoDepth(gain) → osc.detune (in cents)
 *
 * The amp envelope idles at 0; `fadeInVoice` ramps it to a Y-derived
 * level over a short attack (so we don't click on first press), and
 * `fadeOutVoice` ramps it back to 0 over a slightly longer release
 * (so the note tail is audible). The oscillator runs continuously
 * while a primary input is active; pitch jumps within a single touch
 * are smoothed by `cfg.glideMs`, which is what gives a real theremin
 * its "sliding" feel.
 *
 * Module-private state means voice.js owns the audio nodes and
 * input modules only see the high-level operations they need.
 */
import { getCtx, getMaster, resumeIfSuspended, midiToFreq } from '../shared/audio.js';
import { xToMidi } from './scale.js';

// Vibrato range — chosen by ear so a midway 2nd-finger position gives
// an obvious-but-musical wobble.
const VIBRATO_MIN_HZ = 2;
const VIBRATO_MAX_HZ = 10;
const VIBRATO_MAX_CENTS = 120;

// Amp envelope timing — short attack so the surface feels responsive,
// slightly longer release so the note doesn't click off.
const AMP_ATTACK = 0.025;
const AMP_RELEASE = 0.12;

/**
 * Y → amplitude curve. Linear feels weak; a gentle squared curve gives
 * the bottom half of the pad real headroom and the top half a steady
 * push. yNorm convention: 0 at top (loud), 1 at bottom (silent).
 */
const yToAmp = (yNorm) => {
  const v = Math.max(0, Math.min(1, 1 - yNorm));
  return v * v * 0.6;
};

let osc = null;
let amp = null;
let vibratoLfo = null;
let vibratoDepth = null;
let waveformType = 'sine';

const midiListeners = new Set();

/**
 * Subscribe to "voice played a note" events — fires on each
 * applyPrimary call with the snapped midi number. Returns an
 * unsubscribe fn for symmetry; in practice listeners live for the
 * page lifetime.
 */
export const onMidi = (fn) => {
  midiListeners.add(fn);
  return () => midiListeners.delete(fn);
};

const fireMidi = (midi) => {
  for (const fn of midiListeners) fn(midi);
};

export const setWaveform = (type) => {
  waveformType = type;
  if (osc) osc.type = type;
};

/**
 * Build the oscillator + amp + vibrato chain on first use. Idempotent
 * — subsequent calls are no-ops. Caller passes the initial midi so
 * we can set the oscillator's starting pitch to match the pad's left
 * edge for the active scale config (avoids a quick glide from a
 * default pitch to wherever the first interaction lands).
 */
export const ensureVoice = (initialMidi) => {
  if (osc) return;
  const ctx = getCtx();
  if (ctx.state === 'suspended') resumeIfSuspended();

  amp = ctx.createGain();
  amp.gain.value = 0;
  amp.connect(getMaster());

  osc = ctx.createOscillator();
  osc.type = waveformType;
  osc.frequency.value = midiToFreq(initialMidi);
  osc.connect(amp);
  osc.start();

  vibratoLfo = ctx.createOscillator();
  vibratoLfo.type = 'sine';
  vibratoLfo.frequency.value = VIBRATO_MIN_HZ;
  vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = 0;
  vibratoLfo.connect(vibratoDepth);
  vibratoDepth.connect(osc.detune);
  vibratoLfo.start();
};

/**
 * Update the primary voice from normalized pad coordinates.
 *   xNorm 0..1 → pitch via scale config
 *   yNorm 0..1 → amplitude (0 = top/loud, 1 = bottom/silent)
 *   cfg          → { scale, root, range, glideMs }
 *
 * Glide: 0 → effectively snap; 200 → ~0.5s lyric slide. The slider's
 * unit is "ms of glide between any two updates", not full pad-width.
 * setTargetAtTime with a tiny tau is aggressive enough to track fast
 * drags and smooth enough to round off jagged updates.
 */
export const applyPrimary = (xNorm, yNorm, cfg) => {
  if (!osc) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const midi = xToMidi(xNorm, cfg);
  const freq = midiToFreq(midi);

  const tau = Math.max(0.001, cfg.glideMs / 1000);
  osc.frequency.cancelScheduledValues(now);
  osc.frequency.setTargetAtTime(freq, now, tau);

  // Amp follows Y immediately (no glide) so the player can articulate.
  const amplitude = yToAmp(yNorm);
  amp.gain.cancelScheduledValues(now);
  amp.gain.setTargetAtTime(amplitude, now, 0.012);

  fireMidi(midi);
};

/**
 * Vibrato modulator (driven by any 2nd+ pointer or the user's other
 * hand in air mode).
 *   X = rate (left = slow, right = fast)
 *   Y = depth (top = max, bottom = none) — inverted so "raise the
 *   second finger" means "more wobble", matching the volume convention.
 */
export const applyVibrato = (xNorm, yNorm) => {
  if (!vibratoLfo || !vibratoDepth) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const rate = VIBRATO_MIN_HZ + xNorm * (VIBRATO_MAX_HZ - VIBRATO_MIN_HZ);
  const depth = (1 - yNorm) * VIBRATO_MAX_CENTS;
  vibratoLfo.frequency.setTargetAtTime(rate, now, 0.05);
  vibratoDepth.gain.setTargetAtTime(depth, now, 0.05);
};

export const clearVibrato = () => {
  if (!vibratoDepth) return;
  const ctx = getCtx();
  vibratoDepth.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
};

export const fadeOutVoice = () => {
  if (!amp) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  amp.gain.cancelScheduledValues(now);
  amp.gain.setValueAtTime(amp.gain.value, now);
  amp.gain.linearRampToValueAtTime(0, now + AMP_RELEASE);
};

export const fadeInVoice = (yNorm) => {
  if (!amp) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const target = yToAmp(yNorm);
  amp.gain.cancelScheduledValues(now);
  amp.gain.setValueAtTime(amp.gain.value, now);
  amp.gain.linearRampToValueAtTime(target, now + AMP_ATTACK);
};
