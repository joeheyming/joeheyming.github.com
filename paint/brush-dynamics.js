// Paint — Brush Settings dab engine (PhotoCraft crates/paint/src/dynamics.rs PathWalker and
// DabBuilder, rng.rs, brush.rs BrushSettings).
//
// A stroke walks its path one spacing step at a time (the distance left over at the end of a
// segment carries into the next one), and each step builds one or more dabs: Shape Dynamics
// jitters size, angle, and roundness, Scattering moves the dab and repeats it Count times, and
// Transfer jitters the dab's opacity ceiling and flow. Every random value is a pure hash of
// (seed, dab index, stream), so a stroke with the same seed lays the same dabs.
//
// Settings are percents (spacing, roundness, jitters, minimums, scatter) and degrees (angle),
// as the Brush Settings panel shows them. Size and Hardness stay on the options bar.

/** state.brushSettings defaults: PhotoCraft's builtin brush base (spacing 25%, round tip). */
export const BRUSH_SETTINGS_DEFAULTS = Object.freeze({
  spacing: 25,
  angle: 0,
  roundness: 100,
  shapeDynamics: false,
  sizeJitter: 0,
  minDiameter: 0,
  angleJitter: 0,
  roundnessJitter: 0,
  minRoundness: 25,
  scattering: false,
  scatter: 0,
  bothAxes: false,
  count: 1,
  countJitter: 0,
  transfer: false,
  opacityJitter: 0,
  flowJitter: 0
});

/** The brush settings with defaults filled in, from state.brushSettings (or null). */
export function brushSettingsOf(settings) {
  return { ...BRUSH_SETTINGS_DEFAULTS, ...(settings || {}) };
}

// ── rng.rs: SplitMix64, counter-based ────────────────────────────────────────────────

const M64 = (1n << 64n) - 1n;

function mix64(z) {
  z = (z + 0x9e3779b97f4a7c15n) & M64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
  return z ^ (z >> 31n);
}

/** Uniform in [0, 1) from (seed, index, stream), PhotoCraft rng::rand01. */
export function rand01(seed, index, stream) {
  const k = ((BigInt(index) * 0xd1b54a32d192ed03n) ^ (BigInt(stream) * 0x8cb92ba72f3d8dd7n)) & M64;
  const h = mix64((BigInt.asUintN(64, BigInt(seed)) ^ mix64(k)) & M64);
  return Number(h >> 40n) / 16777216;
}

function randSigned(seed, index, stream) {
  return rand01(seed, index, stream) * 2 - 1;
}

// rng::stream
const STREAM = {
  SIZE: 1,
  ANGLE: 2,
  ROUNDNESS: 3,
  SCATTER_X: 6,
  SCATTER_Y: 7,
  COUNT: 8,
  OPACITY: 9,
  FLOW: 10
};

const frac = (v) => Math.min(1, Math.max(0, (v ?? 0) / 100));

// dynamics.rs scalar with no control: jitter reduces the value at random, never below minimum.
function jitterScale(jitter, minimum, r) {
  if (jitter <= 0) return 1;
  return Math.max(minimum, 1 - jitter * r);
}

/**
 * One stroke's dab builder (DabBuilder). size is the base diameter in pixels (after pressure),
 * flow 0..1. stepLen(size) is the walker's spacing; dabsAt(x, y, direction, size, flow) returns
 * this step's dabs: { x, y, radius, angle (degrees, counter-clockwise), roundness (0..1),
 * flow (0..1), ceil (0..1, Transfer's opacity) }.
 */
export function dabBuilder(settings, seed = 0) {
  const b = brushSettingsOf(settings);
  let step = 0;
  let index = 0;
  return {
    stepLen(size) {
      return Math.max(0.5, Math.max(1, size) * Math.max(0.01, frac(b.spacing)));
    },
    dabsAt(x, y, direction, size, flow) {
      const s = step++;
      let count = 1;
      if (b.scattering) {
        const n = Math.min(16, Math.max(1, Math.round(b.count ?? 1)));
        const k = jitterScale(frac(b.countJitter), 0, rand01(seed, s, STREAM.COUNT));
        count = Math.min(16, Math.max(1, Math.round(n * k)));
      }
      const out = [];
      for (let c = 0; c < count; c++) {
        const i = index++;
        const r = (st) => rand01(seed, i, st);
        let diameter = size;
        let angle = b.angle ?? 0;
        let roundness = Math.min(1, Math.max(0.01, frac(b.roundness)));
        if (b.shapeDynamics) {
          if (b.sizeJitter > 0) {
            diameter *= Math.max(frac(b.minDiameter), 1 - frac(b.sizeJitter) * r(STREAM.SIZE));
          }
          angle += randSigned(seed, i, STREAM.ANGLE) * frac(b.angleJitter) * 180;
          const k = jitterScale(frac(b.roundnessJitter), frac(b.minRoundness), r(STREAM.ROUNDNESS));
          roundness = Math.min(1, Math.max(0.01, roundness * k));
        }
        const radius = Math.max(0.5, diameter / 2);
        let cx = x,
          cy = y;
        if (b.scattering && b.scatter > 0) {
          const amt = (b.scatter / 100) * radius;
          const ox = randSigned(seed, i, STREAM.SCATTER_X) * amt;
          const oy = randSigned(seed, i, STREAM.SCATTER_Y) * amt;
          if (b.bothAxes) {
            cx += ox;
            cy += oy;
          } else {
            // Perpendicular to the direction of travel (y-down image space).
            const dx = Math.cos(direction),
              dy = -Math.sin(direction);
            cx += -dy * ox;
            cy += dx * ox;
          }
        }
        let ceil = 1,
          f = flow;
        if (b.transfer) {
          ceil = jitterScale(frac(b.opacityJitter), 0, r(STREAM.OPACITY));
          f *= jitterScale(frac(b.flowJitter), 0, r(STREAM.FLOW));
        }
        out.push({ x: cx, y: cy, radius, angle, roundness, flow: Math.min(1, f), ceil });
      }
      return out;
    }
  };
}

/**
 * PathWalker: emits the first point, then one step every stepLen() pixels along the path; the
 * distance left at a segment's end carries into the next. emit(x, y, direction) gets the step
 * point and the direction of travel (radians, y-up, PhotoCraft's (-dy).atan2(dx)).
 */
export function pathWalker(x, y, stepLen, emit) {
  let lastX = x,
    lastY = y,
    dir = 0;
  emit(x, y, dir);
  let nextAt = stepLen();
  return {
    push(px, py) {
      const dx = px - lastX,
        dy = py - lastY;
      const len = Math.hypot(dx, dy);
      if (len > 1e-9) {
        dir = Math.atan2(-dy, dx);
        let n = 0;
        while (nextAt <= len + 1e-9 && n++ < 100000) {
          const t = Math.min(1, nextAt / len);
          emit(lastX + dx * t, lastY + dy * t, dir);
          nextAt += Math.max(0.25, stepLen());
        }
        nextAt -= len;
      }
      lastX = px;
      lastY = py;
    }
  };
}

/**
 * The dabs a stroke through points ([[x, y], …]) lays with these settings, base diameter size,
 * and flow (0..1). The Brush tool runs the same walker and builder one segment at a time.
 */
export function strokeDabs(settings, points, size, flow = 1, seed = 0) {
  const builder = dabBuilder(settings, seed);
  const dabs = [];
  const [first, ...rest] = points;
  const walker = pathWalker(
    first[0],
    first[1],
    () => builder.stepLen(size),
    (x, y, dir) => dabs.push(...builder.dabsAt(x, y, dir, size, flow))
  );
  for (const [x, y] of rest) walker.push(x, y);
  return dabs;
}

/** A stroke seed from its start point, so strokes differ and a replayed stroke matches. */
export function strokeSeed(x, y) {
  return ((Math.round(x * 16) & 0xffff) << 16) | (Math.round(y * 16) & 0xffff);
}
