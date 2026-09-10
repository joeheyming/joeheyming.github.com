// Smoothed song-position clock.
//
// `HTMLAudioElement.currentTime` does not advance smoothly: browsers update
// it in steps tied to the audio buffer, so reading it once per frame and
// using the value directly makes the note field jitter even at a solid frame
// rate. This keeps its own clock running off wall time and eases it toward
// the audio element, which is the same trick SM uses to keep the playfield
// steady between audio callbacks.
//
// Pure and injectable: callers pass in wall time, so tests drive it without
// timers.

/** Past this much disagreement, assume a seek or stall and jump. */
const DEFAULT_RESYNC_THRESHOLD = 0.12;

/** Fraction of the remaining error corrected per frame. */
const DEFAULT_SMOOTHING = 0.1;

export class SongClock {
  /**
   * @param {Object} [options]
   * @param {number} [options.resyncThreshold] - Seconds of drift that force a jump
   * @param {number} [options.smoothing] - Error fraction corrected per update (0-1)
   */
  constructor({ resyncThreshold = DEFAULT_RESYNC_THRESHOLD, smoothing = DEFAULT_SMOOTHING } = {}) {
    this._resyncThreshold = resyncThreshold;
    this._smoothing = smoothing;
    this.reset(0);
  }

  /**
   * Drop all history and pin the clock to a known song time.
   * @param {number} [time]
   */
  reset(time = 0) {
    this._time = time;
    this._wall = null;
    this._rate = 1;
    this._paused = true;
  }

  /** Song time as of the last update. */
  get time() {
    return this._time;
  }

  /**
   * Advance the clock and pull it toward the audio element.
   *
   * @param {Object} sample
   * @param {number} sample.audioTime - `audio.currentTime`
   * @param {number} sample.wallSeconds - Monotonic wall clock, e.g. performance.now() / 1000
   * @param {boolean} sample.paused
   * @param {number} [sample.rate] - Playback rate multiplier
   * @returns {number} Song time now
   */
  update({ audioTime, wallSeconds, paused, rate = 1 }) {
    // While paused the audio clock is authoritative and perfectly stable,
    // so scrubbing and stopping land exactly where the element says.
    if (paused || this._wall === null) {
      this._time = audioTime;
      this._wall = wallSeconds;
      this._rate = rate;
      this._paused = paused;
      return this._time;
    }

    const elapsed = Math.max(0, wallSeconds - this._wall);
    const predicted = this._time + elapsed * rate;
    const drift = audioTime - predicted;

    let next;
    if (Math.abs(drift) > this._resyncThreshold) {
      // A seek, a stall, or the first frames after play() — jump rather
      // than crawl toward it.
      next = audioTime;
    } else {
      next = predicted + drift * this._smoothing;
    }

    // Never hand out a position that moves backwards during playback; a
    // rewound beat re-triggers background changes and note animation.
    if (rate > 0 && next < this._time) {
      next = this._time;
    }

    this._time = next;
    this._wall = wallSeconds;
    this._rate = rate;
    this._paused = paused;
    return this._time;
  }

  /**
   * Song time at an arbitrary wall-clock moment, without disturbing the
   * clock. Used to judge input at the instant the key arrived rather than
   * at the last rendered frame.
   *
   * @param {number} wallSeconds
   * @returns {number}
   */
  timeAt(wallSeconds) {
    if (this._paused || this._wall === null) return this._time;
    const elapsed = Math.max(0, wallSeconds - this._wall);
    return this._time + elapsed * this._rate;
  }
}

export const songClock = new SongClock();
