/**
 * Clock — injectable timing source for schedulers, loopers, and any module
 * that wants to be testable / swappable between wall-time and audio-time.
 *
 * Interface (the duck-type every clock satisfies):
 *
 *   {
 *     now(): number             // milliseconds, monotonic
 *     setTimeout(fn, ms): handle // fn may receive (audioTimeMs) as 1st arg
 *     clearTimeout(handle): void
 *   }
 *
 * Two implementations live in this folder:
 *   - createWallClock()   — performance.now() + global setTimeout (this file)
 *   - createAudioClock()  — AudioContext-driven look-ahead (audio-clock.js)
 *
 * Both share the same shape so consumers like LoopTrack don't care which
 * one they got.
 */

export function createWallClock() {
  return {
    now: () => performance.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(() => fn(performance.now()), ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle)
  };
}
