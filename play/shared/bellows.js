/**
 * Phone-as-bellows: turn a phone's motion sensor into the air supply for
 * the accordion.
 *
 * The pipeline:
 *
 *   1. Read raw `acceleration` (gravity-removed) from DeviceMotion events.
 *   2. Integrate to **velocity** with a short leak so the integrator
 *      doesn't drift. Velocity is much friendlier than raw acceleration:
 *      hand-tremor wiggles average out near zero, while a deliberate swing
 *      produces a sustained 1–3 m/s peak. That means gentler motion
 *      produces a stronger signal — players don't need to shake hard.
 *   3. Map velocity magnitude through floor/saturation to a 0..1 target
 *      pressure, then smooth with asymmetric attack/decay.
 *   4. Watch the sign of the **dominant velocity component** for flips —
 *      each flip is a stroke-end on the dominant axis, which is exactly
 *      the moment a real accordion's bellows reverses. We briefly drop
 *      the gain to zero (~50ms) to recreate that authentic mechanical
 *      "tick" between push and pull.
 *
 * iOS gates DeviceMotion behind an explicit permission prompt that must be
 * triggered from a user gesture; we expose `requestPermission()` for the
 * caller to invoke from the toggle's `change` handler.
 */

export function isBellowsAvailable() {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
}

export function isBellowsPermissionRequired() {
  return isBellowsAvailable() && typeof DeviceMotionEvent.requestPermission === 'function';
}

export class Bellows {
  constructor(opts = {}) {
    // Tuneable response curve. Velocity is in m/s; relaxed handheld
    // bellows-style swings peak around 0.5–2 m/s.
    //   `floor`     — velocity below this is treated as zero motion. Has
    //                 to be just above the leaky-integrator's residual,
    //                 not the much-larger raw-acceleration noise floor.
    //   `sat`       — saturation point: max effective motion. A vigorous
    //                 shake won't get louder than a steady swing.
    //   `silenceAt` — final hard cutoff applied AFTER smoothing. Below
    //                 this pressure the gain snaps to 0 so a held-still
    //                 phone is genuinely silent.
    this.floor = opts.floor ?? 0.25;
    this.sat = opts.sat ?? 1.5;
    this.silenceAt = opts.silenceAt ?? 0.04;
    // Attack is faster than decay so a quick wrist flick still pops out a
    // note, but a long decay would feel sustained and unrealistic.
    this.attackPerSec = opts.attackPerSec ?? 16;
    this.decayPerSec = opts.decayPerSec ?? 6;

    // Velocity integrator leak. Time constant 1/velLeak seconds — a still
    // phone's velocity decays to ~37% in 0.25s and to silence in ~1s.
    this.velLeak = opts.velLeak ?? 4;

    // Reversal-mute parameters. When the dominant axis flips sign with
    // sufficient magnitude, we briefly attenuate the gain to mimic the
    // mechanical "tick" of a real bellows turnaround.
    //   `reversalMs`        — how long the attenuation lasts.
    //   `reversalThresh`    — sign-flip detection: velocity in the *new*
    //                         direction must exceed this before counting
    //                         as a reversal.
    //   `reversalPeakMin`   — the previous stroke must have peaked above
    //                         this magnitude. Stops light wobbles
    //                         around zero from triggering the tick.
    //   `reversalCooldown`  — after a reversal fires, ignore further
    //                         reversals for this long. Avoids stutter-
    //                         muting during one continuous turnaround.
    //   `reversalAttenuation` — gain multiplier during the dip
    //                         (0 = full mute; ~0.3 = soft tick).
    this.reversalMs = opts.reversalMs ?? 45;
    this.reversalThresh = opts.reversalThresh ?? 0.6;
    this.reversalPeakMin = opts.reversalPeakMin ?? 0.9;
    this.reversalCooldown = opts.reversalCooldown ?? 220;
    this.reversalAttenuation = opts.reversalAttenuation ?? 0.25;

    this.pressure = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this._lastDomSign = 0;
    this._lastDomMag = 0;
    this._reversalUntil = 0;
    this.listening = false;
    this.onPressure = () => {};
    this.onReversal = () => {};
    this._lastTs = 0;
    this._handler = (event) => this._onMotion(event);
  }

  async requestPermission() {
    if (!isBellowsPermissionRequired()) return true;
    try {
      const result = await DeviceMotionEvent.requestPermission();
      return result === 'granted';
    } catch (_err) {
      return false;
    }
  }

  start() {
    if (this.listening) return;
    window.addEventListener('devicemotion', this._handler);
    this.listening = true;
    this._lastTs = 0;
    this.vx = this.vy = this.vz = 0;
    this._lastDomSign = 0;
    this._lastDomMag = 0;
    this._reversalUntil = 0;
  }

  stop() {
    if (!this.listening) return;
    window.removeEventListener('devicemotion', this._handler);
    this.listening = false;
    this.pressure = 0;
    this.vx = this.vy = this.vz = 0;
    this.onPressure(0);
  }

  _onMotion(event) {
    const a = event.acceleration;
    const ax = a?.x ?? 0;
    const ay = a?.y ?? 0;
    const az = a?.z ?? 0;

    const now = performance.now();
    const dt = this._lastTs ? Math.min(0.1, (now - this._lastTs) / 1000) : 1 / 60;
    this._lastTs = now;

    // Leaky integrator: velocity = velocity * leakDecay + accel * dt.
    // Without the leak, sensor bias would cause the velocity to drift
    // unbounded; with it, a stationary phone returns to v ≈ 0 quickly.
    const leak = Math.exp(-this.velLeak * dt);
    this.vx = this.vx * leak + ax * dt;
    this.vy = this.vy * leak + ay * dt;
    this.vz = this.vz * leak + az * dt;

    const speed = Math.hypot(this.vx, this.vy, this.vz);

    // Dominant-axis sign-flip detection for reversal "ticks". We pick
    // whichever component currently has the largest magnitude and watch
    // its sign relative to the last flip. Tracking the dominant axis
    // (instead of a fixed one) means the user can hold the phone in any
    // orientation and still get reversal detection.
    const adx = Math.abs(this.vx);
    const ady = Math.abs(this.vy);
    const adz = Math.abs(this.vz);
    let domVal = this.vx;
    let domMag = adx;
    if (ady >= adx && ady >= adz) {
      domVal = this.vy;
      domMag = ady;
    } else if (adz >= adx && adz >= ady) {
      domVal = this.vz;
      domMag = adz;
    }

    const sign = domVal > this.reversalThresh ? 1 : domVal < -this.reversalThresh ? -1 : 0;
    if (
      sign !== 0 &&
      this._lastDomSign !== 0 &&
      sign === -this._lastDomSign &&
      // The previous stroke must have been a real swing, not just sensor
      // jitter near zero. `_lastDomMag` is the leaky peak of the last
      // stroke's magnitude.
      this._lastDomMag > this.reversalPeakMin &&
      // Cooldown: don't stack reversals within one turnaround. Real
      // bellows have a single "click" per direction change, not a buzz.
      now > this._reversalUntil + this.reversalCooldown
    ) {
      this._reversalUntil = now + this.reversalMs;
      this.onReversal();
      // Reset peak tracker so the *next* reversal needs a fresh strong
      // stroke before triggering.
      this._lastDomMag = 0;
    }
    if (sign !== 0) {
      this._lastDomSign = sign;
      this._lastDomMag = Math.max(this._lastDomMag * leak, domMag);
    } else {
      this._lastDomMag *= leak;
    }

    // Map velocity speed to target pressure via the floor/sat curve.
    const target = Math.max(0, Math.min(1, (speed - this.floor) / (this.sat - this.floor)));

    const rate = target > this.pressure ? this.attackPerSec : this.decayPerSec;
    this.pressure += (target - this.pressure) * Math.min(1, rate * dt);

    // Cutoffs:
    //   - a held-still phone hits silence,
    //   - a recent reversal multiplies output by `reversalAttenuation`
    //     for `reversalMs` to recreate the bellows-turnaround "tick".
    //     Using a multiplicative dip rather than a hard cut keeps the
    //     overall flow smooth — the user feels a soft pulse, not a
    //     jarring stop.
    let out = this.pressure < this.silenceAt ? 0 : this.pressure;
    if (now < this._reversalUntil) out *= this.reversalAttenuation;
    this.onPressure(out);
  }
}
