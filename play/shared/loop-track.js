/**
 * LoopTrack — single-track record/overdub/play state machine.
 *
 * Carved out of the original `Looper` class in play/drums/drums.js. The
 * external behavior is identical; the only generalization is that the
 * timing source is injected via `clock` so consumers can pick wall time
 * (default) or audio-clock time (for tight scheduling).
 *
 * Event ids are opaque strings — the track only stores and replays them.
 * Drums uses pad ids; a future Step Sequencer can use cell ids; a chord
 * pad can use chord names. The track does not interpret them.
 *
 * State machine:
 *
 *   idle ──Rec──► armed ──first hit──► recording ──Rec/Play──► playing
 *     ▲                                                          │ ▲
 *     │                                                       Rec│ │Rec
 *     │                                                          ▼ │
 *     │                                                       overdubbing
 *     │                                                          │
 *     └──────────────────────── Play / Clear ────────────────────┘
 *
 * Recording captures hits with timestamps (ms) relative to the first hit.
 * The loop length is set when the user stops recording. During overdub,
 * new hits are phase-aligned and play on the next cycle.
 */

import { createWallClock } from './clock.js';

const MIN_LOOP_MS = 250;
const ARM_PROGRESS_CAP_MS = 8000;

export class LoopTrack {
  constructor({ onPlay, clock = createWallClock() } = {}) {
    if (typeof onPlay !== 'function') {
      throw new Error('LoopTrack requires { onPlay: (id) => void }');
    }
    this.onPlay = onPlay;
    this.clock = clock;
    this.state = 'idle';
    this.events = [];
    this.loopLength = 0;
    this._t0 = 0;
    this._loopStart = 0;
    this._timeouts = [];
    this._loopTimeout = null;
    this._listeners = new Set();
  }

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this);
  }

  hasLoop() {
    return this.events.length > 0 && this.loopLength > 0;
  }

  isActive() {
    return this.state !== 'idle';
  }

  /** Wall-clock-based "rec timer" reading (ms since recording started). */
  recordingElapsed() {
    if (this.state !== 'recording') return 0;
    return this.clock.now() - this._t0;
  }

  /** Returns 0..1 progress through the current loop, or null when idle. */
  progress(now = this.clock.now()) {
    if (this.state === 'recording') {
      return Math.min((now - this._t0) / ARM_PROGRESS_CAP_MS, 1);
    }
    if (this.state === 'playing' || this.state === 'overdubbing') {
      if (!this.loopLength) return 0;
      return ((now - this._loopStart) % this.loopLength) / this.loopLength;
    }
    return null;
  }

  /** "Rec" button. Cycles through the recording states. */
  toggleRecord() {
    switch (this.state) {
      case 'idle':
        this._beginArmed();
        break;
      case 'armed':
        this.state = 'idle';
        this.events = [];
        this._emit();
        break;
      case 'recording':
        this._finishRecording();
        break;
      case 'playing':
        this.state = 'overdubbing';
        this._emit();
        break;
      case 'overdubbing':
        this.state = 'playing';
        this._emit();
        break;
    }
  }

  /** "Play" button. Starts/stops loop playback. */
  togglePlay() {
    if (this.state === 'playing' || this.state === 'overdubbing') {
      this._stopPlayback();
      this.state = 'idle';
      this._emit();
      return;
    }
    if (this.state === 'recording' || this.state === 'armed') {
      this._finishRecording();
      return;
    }
    if (this.hasLoop()) {
      this._startPlayback();
    }
  }

  clear() {
    this._stopPlayback();
    this.events = [];
    this.loopLength = 0;
    this.state = 'idle';
    this._emit();
  }

  /** Called when the user triggers an event live (keyboard/pointer/etc.). */
  noteHit(id) {
    if (this.state === 'armed') {
      this._t0 = this.clock.now();
      this.state = 'recording';
      this.events.push({ time: 0, id });
      this._emit();
      return;
    }
    if (this.state === 'recording') {
      this.events.push({ time: this.clock.now() - this._t0, id });
      return;
    }
    if (this.state === 'overdubbing') {
      const phase = (this.clock.now() - this._loopStart) % this.loopLength;
      this.events.push({ time: phase, id });
    }
  }

  _beginArmed() {
    this.events = [];
    this.loopLength = 0;
    this.state = 'armed';
    this._emit();
  }

  _finishRecording() {
    if (this.state === 'armed') {
      this.state = 'idle';
      this._emit();
      return;
    }
    if (this.state !== 'recording') return;
    const now = this.clock.now();
    this.loopLength = Math.max(now - this._t0, MIN_LOOP_MS);
    this._startPlayback();
  }

  _startPlayback() {
    this._stopPlayback();
    this.state = 'playing';
    this._loopStart = this.clock.now();
    this._scheduleLoop();
    this._emit();
  }

  _scheduleLoop() {
    const len = this.loopLength;
    // Snapshot events so overdub additions only land on the *next* iteration.
    const snapshot = this.events.slice().sort((a, b) => a.time - b.time);
    for (const ev of snapshot) {
      const handle = this.clock.setTimeout(() => {
        if (this.state === 'playing' || this.state === 'overdubbing') {
          this.onPlay(ev.id);
        }
      }, ev.time);
      this._timeouts.push(handle);
    }
    this._loopTimeout = this.clock.setTimeout(() => {
      this._timeouts.forEach((h) => this.clock.clearTimeout(h));
      this._timeouts = [];
      if (this.state === 'playing' || this.state === 'overdubbing') {
        this._loopStart = this.clock.now();
        this._scheduleLoop();
      }
    }, len);
  }

  _stopPlayback() {
    if (this._loopTimeout != null) {
      this.clock.clearTimeout(this._loopTimeout);
      this._loopTimeout = null;
    }
    this._timeouts.forEach((h) => this.clock.clearTimeout(h));
    this._timeouts = [];
  }
}
