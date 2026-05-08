/**
 * BreathBus — gain insert that gates an upstream voice graph by a 0..1
 * "pressure" signal.
 *
 * Carved out of the bellows-aware routing that used to live inside
 * play/shared/audio.js (and silently rewired the global master output of
 * every page that touched the singleton). The bus is now accordion-local
 * and explicit: the page constructs one, points its voices at
 * `breathBus.input`, and drives `setPressure(p)` from a Bellows instance.
 *
 * Lifecycle: created once per accordion page; the gain defaults to 1
 * (transparent), so simply allocating it has no audible effect. When
 * bellows mode flips on, `setPressure(p)` modulates the gain in real
 * time. When it flips off, `disable()` ramps gain back to 1 — the bus
 * stays in the chain but stops gating.
 *
 * Future: bagpipes / didgeridoo / harmonica blow modes could reuse this
 * pattern. When the second instrument arrives, this file moves into
 * play/shared/. Until then it lives next to its only consumer (per the
 * "two adapters before generalizing" rule).
 */

const PRESSURE_TIME_CONSTANT = 0.02;
const DISABLE_TIME_CONSTANT = 0.04;

export function createBreathBus({ ctx, master }) {
  if (!ctx) throw new Error('createBreathBus requires { ctx: AudioContext }');
  if (!master) throw new Error('createBreathBus requires { master: AudioNode }');

  const gain = ctx.createGain();
  gain.gain.value = 1;
  gain.connect(master);

  const setPressure = (p) => {
    const v = Math.max(0, Math.min(1, p));
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(v, now, PRESSURE_TIME_CONSTANT);
  };

  const disable = () => {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(1, now, DISABLE_TIME_CONSTANT);
  };

  return {
    input: gain,
    output: gain,
    setPressure,
    disable,
  };
}
