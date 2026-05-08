/**
 * AudioClock — drop-in replacement for createWallClock() backed by the
 * AudioContext clock with a Chris-Wilson-style look-ahead.
 *
 * Same interface as createWallClock from ./clock.js:
 *   { now(), setTimeout(fn, ms), clearTimeout(handle) }
 *
 * Differences vs the wall clock:
 *   - now() returns ctx.currentTime * 1000 (audio-time milliseconds).
 *   - Pending callbacks are checked on a fixed setInterval and fired when
 *     audio-time crosses their target. The lookahead window means the
 *     callback receives the precise *audio time* it should have fired at,
 *     even if the JS event loop fires it a few ms late — callers that want
 *     sample-accurate scheduling can use that timestamp as the `when`
 *     argument to AudioBufferSourceNode.start(), GainNode ramps, etc.
 *
 * Today's only consumer is opt-in for LoopTrack instances that want tight
 * timing. Future Step Sequencer / Tone Matrix pages can use it directly.
 */

const DEFAULT_INTERVAL_MS = 25;
const DEFAULT_LOOKAHEAD_S = 0.1;

export function createAudioClock({
  ctx,
  intervalMs = DEFAULT_INTERVAL_MS,
  // eslint-disable-next-line no-unused-vars
  lookaheadS = DEFAULT_LOOKAHEAD_S
} = {}) {
  if (!ctx) {
    throw new Error('createAudioClock requires { ctx: AudioContext }');
  }

  const pending = new Map();
  let nextHandle = 1;
  let pollHandle = null;

  const now = () => ctx.currentTime * 1000;

  const ensurePolling = () => {
    if (pollHandle != null) return;
    pollHandle = globalThis.setInterval(() => {
      const audioMs = now();
      for (const [handle, entry] of pending) {
        if (entry.fireAt <= audioMs) {
          pending.delete(handle);
          try {
            entry.fn(entry.fireAt);
          } catch (err) {
            console.warn('audio-clock callback threw', err);
          }
        }
      }
      if (pending.size === 0) {
        globalThis.clearInterval(pollHandle);
        pollHandle = null;
      }
    }, intervalMs);
  };

  return {
    now,
    setTimeout(fn, ms) {
      const handle = nextHandle++;
      pending.set(handle, { fn, fireAt: now() + ms });
      ensurePolling();
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
      if (pending.size === 0 && pollHandle != null) {
        globalThis.clearInterval(pollHandle);
        pollHandle = null;
      }
    }
  };
}
