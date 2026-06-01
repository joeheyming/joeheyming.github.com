// Audio-context-anchored playhead. Replaces stepmania's timing.js — we
// don't need beats-vs-seconds conversion because @tonejs/midi already
// emits times in seconds. The single source of truth is the AudioContext
// clock from /play/shared/audio.js, which is the same clock the
// PianoSynth's voices schedule against, so audio and visuals stay
// frame-perfectly aligned.
//
// Wall-clock model:
//   When playing, songSec = startSongSec + (ctx.currentTime - startCtxSec) * rate
//   When paused,  songSec = lastPausedSongSec
// `setRate` (tempo slider) re-anchors so the perceived song time doesn't
// jump on tempo changes.

import { getCtx } from '/play/shared/audio.js';

class Clock {
  constructor() {
    this._running = false;
    this._rate = 1.0;
    /** Song-second value at the moment we last started/seeked. */
    this._startSongSec = 0;
    /** Audio-context time at the moment we last started/seeked. */
    this._startCtxSec = 0;
    /** Cached value for when paused. */
    this._pausedSongSec = 0;
  }

  /** Current AudioContext time in seconds. */
  ctxNow() {
    return getCtx().currentTime;
  }

  /** Current playhead position, in song seconds. */
  now() {
    if (!this._running) return this._pausedSongSec;
    return this._startSongSec + (this.ctxNow() - this._startCtxSec) * this._rate;
  }

  isRunning() {
    return this._running;
  }

  /** Begin (or resume) playback from the current paused position. */
  start() {
    if (this._running) return;
    this._startSongSec = this._pausedSongSec;
    this._startCtxSec = this.ctxNow();
    this._running = true;
  }

  pause() {
    if (!this._running) return;
    this._pausedSongSec = this.now();
    this._running = false;
  }

  /**
   * Seek to a specific song-second. Maintains play/paused state.
   * Negative values are accepted — the engine uses them to seed a
   * pre-roll "Get Ready" lead-in before song time 0 (notes scroll into
   * view but no audio fires until songSec crosses 0).
   */
  seek(songSec) {
    const t = Number(songSec) || 0;
    if (this._running) {
      this._startSongSec = t;
      this._startCtxSec = this.ctxNow();
    } else {
      this._pausedSongSec = t;
    }
  }

  /**
   * Set tempo / playback rate. Re-anchors so the perceived position
   * doesn't jump.
   */
  setRate(rate) {
    const r = Math.max(0.1, Math.min(4, Number(rate) || 1));
    if (this._running) {
      // Snapshot current position, then change rate, then re-anchor.
      const songSec = this.now();
      this._startSongSec = songSec;
      this._startCtxSec = this.ctxNow();
    }
    this._rate = r;
  }

  getRate() {
    return this._rate;
  }

  /** Reset to the start, paused. */
  reset() {
    this._running = false;
    this._pausedSongSec = 0;
    this._startSongSec = 0;
    this._startCtxSec = this.ctxNow();
  }
}

const clock = new Clock();
export default clock;
