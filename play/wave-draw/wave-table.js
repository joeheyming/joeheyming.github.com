/** Single-period wavetable helpers (draw → DFT → PeriodicWave coeffs). */

export const TABLE_SIZE = 256;

/**
 * @param {string} name
 * @param {number} [n]
 * @returns {Float32Array}
 */
export function fillPreset(name, n = TABLE_SIZE) {
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    if (name === 'sine') samples[i] = Math.sin(2 * Math.PI * t);
    else if (name === 'square') samples[i] = t < 0.5 ? 1 : -1;
    else if (name === 'saw') samples[i] = 2 * t - 1;
    else if (name === 'triangle') samples[i] = t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
    else if (name === 'noise') samples[i] = Math.random() * 2 - 1;
    else samples[i] = 0;
  }
  return samples;
}

/**
 * Shortest wrapped delta on a ring of length `n`.
 * @param {number} from
 * @param {number} to
 * @param {number} n
 */
export function shortestSampleDelta(from, to, n) {
  let d = to - from;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

/**
 * Paint a line into a periodic table. x is 0..1 around the period, y is -1..1.
 * Long jumps wrap around the table (drawing off the right edge continues on the left).
 * @param {Float32Array} samples
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
export function paintLine(samples, x0, y0, x1, y1) {
  const n = samples.length;
  if (n < 2) return;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const clampY = (v) => Math.max(-1, Math.min(1, v));
  const ix0 = Math.round(clamp01(x0) * (n - 1));
  const ix1 = Math.round(clamp01(x1) * (n - 1));
  const dx = shortestSampleDelta(ix0, ix1, n);
  const steps = Math.max(1, Math.abs(dx), Math.ceil(Math.abs(y1 - y0) * n));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    let xi = Math.round(ix0 + dx * t);
    xi = ((xi % n) + n) % n;
    samples[xi] = clampY(y0 + (y1 - y0) * t);
  }
}

/**
 * Real/imag cosine-sine DFT for `createPeriodicWave`.
 * @param {Float32Array|number[]} samples
 * @returns {{ real: Float32Array, imag: Float32Array }}
 */
export function samplesToFourier(samples) {
  const n = samples.length;
  const nFreq = Math.floor(n / 2) + 1;
  const real = new Float32Array(nFreq);
  const imag = new Float32Array(nFreq);
  for (let k = 0; k < nFreq; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const ang = (2 * Math.PI * k * i) / n;
      re += samples[i] * Math.cos(ang);
      im -= samples[i] * Math.sin(ang);
    }
    real[k] = re / n;
    imag[k] = im / n;
  }
  return { real, imag };
}
