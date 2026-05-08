/**
 * Tiny tactile-feedback helper for instrument buttons.
 *
 * `navigator.vibrate(ms)` is the standard Web Vibration API: well
 * supported on Android browsers and Chrome OS, silently ignored on
 * iOS Safari and on desktops without a vibration motor. Callers don't
 * need to feature-detect — `tap()` swallows missing API, user-disabled
 * vibration, and any synchronous errors so it's always safe to call
 * from a hot per-press path.
 *
 * The default 10ms is intentionally short: instrument buttons fire
 * rapidly during glissandos and chord-row drags, and longer pulses
 * (>20ms) blur into a continuous buzz that distracts from the music.
 * 10ms reads as a crisp "click" on most phones without piling up.
 */

let supported = false;
try {
  supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
} catch (_) {
  supported = false;
}

export function tap(ms = 10) {
  if (!supported) return;
  try {
    navigator.vibrate(ms);
  } catch (_) {
    /* hardware unavailable / user-disabled / browser quirk — ignore */
  }
}

export const isHapticsAvailable = () => supported;
