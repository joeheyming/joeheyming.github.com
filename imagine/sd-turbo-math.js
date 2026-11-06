/**
 * Pure math for the SD-Turbo Euler sampler. Kept off the ONNX runtime
 * so it can be tested without WebGPU.
 *
 * The schedule matches the scheduler config shipped with
 * schmuell/sd-turbo-ort-web: Euler discrete, scaled-linear betas,
 * trailing timesteps. One step at timestep 999 is what text-to-image
 * already does (sigma ≈ 14.6146). Image-to-image runs four steps and
 * starts later in that schedule, so a lower strength keeps more of
 * the source picture.
 */

export const VAE_SCALING_FACTOR = 0.18215;
export const LATENT_SIZE = 64;
export const IMAGE_SIZE = 512;
/** Steps used when a source image is present. Text-only stays at 1. */
export const IMG2IMG_STEPS = 4;

const BETA_START = 0.00085;
const BETA_END = 0.012;
const TRAIN_STEPS = 1000;

/** @type {Float64Array} */
const TRAIN_SIGMAS = buildTrainSigmas();

function buildTrainSigmas() {
  const sigmas = new Float64Array(TRAIN_STEPS);
  const start = Math.sqrt(BETA_START);
  const end = Math.sqrt(BETA_END);
  let alphaCum = 1;
  for (let i = 0; i < TRAIN_STEPS; i++) {
    const t = i / (TRAIN_STEPS - 1);
    const beta = (start + (end - start) * t) ** 2;
    alphaCum *= 1 - beta;
    sigmas[i] = Math.sqrt((1 - alphaCum) / alphaCum);
  }
  return sigmas;
}

/**
 * @param {number} steps
 * @returns {{ timesteps: number[], sigmas: number[] }}
 *   `sigmas` has one extra trailing 0, the scheduler's terminal sigma.
 */
export function eulerSchedule(steps) {
  const stepRatio = TRAIN_STEPS / steps;
  /** @type {number[]} */
  const timesteps = [];
  /** @type {number[]} */
  const sigmas = [];
  for (let i = steps; i > 0; i--) {
    const timestep = Math.round(i * stepRatio) - 1;
    timesteps.push(timestep);
    sigmas.push(TRAIN_SIGMAS[timestep]);
  }
  sigmas.push(0);
  return { timesteps, sigmas };
}

/**
 * First schedule index to denoise from. Strength 1 starts at the
 * noisiest step. Very small strengths still run the last step.
 *
 * @param {number} steps
 * @param {number} strength  0–1
 */
export function strengthStart(steps, strength) {
  const s = Math.min(1, Math.max(0, strength));
  const init = Math.min(Math.max(1, Math.floor(steps * s)), steps);
  return steps - init;
}

/**
 * @param {Float32Array | number[]} sample
 * @param {number} sigma
 * @returns {Float32Array}
 */
export function scaleModelInputs(sample, sigma) {
  const divi = Math.sqrt(sigma * sigma + 1);
  const out = new Float32Array(sample.length);
  for (let i = 0; i < sample.length; i++) out[i] = sample[i] / divi;
  return out;
}

/**
 * Euler step from `sigma` toward `sigmaNext`. At sigmaNext 0 this is
 * the same update the text-to-image path uses.
 *
 * @param {ArrayLike<number>} sample
 * @param {ArrayLike<number>} noisePred
 * @param {number} sigma
 * @param {number} sigmaNext
 * @returns {Float32Array}
 */
export function eulerUpdate(sample, noisePred, sigma, sigmaNext) {
  const out = new Float32Array(sample.length);
  const dt = sigmaNext - sigma;
  for (let i = 0; i < sample.length; i++) {
    const predOriginal = sample[i] - sigma * noisePred[i];
    const derivative = (sample[i] - predOriginal) / sigma;
    out[i] = sample[i] + derivative * dt;
  }
  return out;
}

/**
 * @param {ArrayLike<number>} latents  VAE latent already scaled into UNet space.
 * @param {ArrayLike<number>} unitNoise  Standard-normal noise, one value per latent.
 * @param {number} sigma
 * @returns {Float32Array}
 */
export function addNoise(latents, unitNoise, sigma) {
  const out = new Float32Array(latents.length);
  for (let i = 0; i < latents.length; i++) out[i] = latents[i] + unitNoise[i] * sigma;
  return out;
}

/** @param {number} seed */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard-normal sample, Box–Muller, matching the text-to-image
 * adapter's generator so a seed still redraws the same picture.
 *
 * @param {number} size
 * @param {number} seed
 * @returns {Float32Array}
 */
export function unitNoise(size, seed) {
  const rand = mulberry32(seed);
  const data = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const u = rand();
    const v = rand();
    data[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  return data;
}

/**
 * RGBA bytes to the NCHW float tensor SD-Turbo's VAE expects, in [-1, 1].
 *
 * @param {Uint8ClampedArray | Uint8Array} rgba
 * @param {number} w
 * @param {number} h
 * @returns {Float32Array}
 */
export function rgbaToModelInput(rgba, w, h) {
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    out[i] = (rgba[p] / 255) * 2 - 1;
    out[plane + i] = (rgba[p + 1] / 255) * 2 - 1;
    out[2 * plane + i] = (rgba[p + 2] / 255) * 2 - 1;
  }
  return out;
}

/**
 * Cover-crop a source image into a square of `size` pixels.
 *
 * @param {number} sw
 * @param {number} sh
 * @param {number} size
 */
export function coverCrop(sw, sh, size) {
  const scale = Math.max(size / sw, size / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  return { dx: (size - dw) / 2, dy: (size - dh) / 2, dw, dh };
}

/**
 * Take the mean latent. Some VAE exports pack mean and log-variance
 * into 8 channels; this model's export is 4, and the 8-channel case
 * keeps the first half.
 *
 * @param {ArrayLike<number>} data
 * @param {number[]} dims
 * @returns {Float32Array}
 */
export function latentMean(data, dims) {
  const channels = dims[1];
  const spatial = dims[2] * dims[3];
  if (channels === 4) return Float32Array.from(data);
  if (channels === 8) return Float32Array.from(data).subarray(0, 4 * spatial);
  throw new Error(`Unexpected VAE latent shape ${dims.join('x')}`);
}

/**
 * @param {Float32Array} latent
 * @param {number} [scale]
 * @returns {Float32Array}
 */
export function scaleLatent(latent, scale = VAE_SCALING_FACTOR) {
  const out = new Float32Array(latent.length);
  for (let i = 0; i < latent.length; i++) out[i] = latent[i] * scale;
  return out;
}

const halfFloatView = new Float32Array(1);
const halfIntView = new Int32Array(halfFloatView.buffer);

/**
 * Pack one float32 as IEEE float16 bits. Round-to-nearest.
 * ONNX Runtime Web has no Float16Array tensor, so float16 inputs
 * are a Uint16Array of these bits.
 *
 * @param {number} val
 * @returns {number}
 */
function toHalf(val) {
  halfFloatView[0] = val;
  const x = halfIntView[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) {
    bits |= 0x7c00;
    if (e === 255 && x & 0x007fffff) bits |= 0x200;
    return bits;
  }
  if (e < 113) {
    m |= 0x0800;
    bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
    return bits;
  }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits & 0xffff;
}

/**
 * @param {ArrayLike<number>} values
 * @returns {Uint16Array}
 */
export function float32ToFloat16Bits(values) {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = toHalf(values[i]);
  return out;
}

/**
 * Unpack IEEE float16 bits (the Uint16Array an ORT float16 tensor returns)
 * into float32. A Float32Array passes through, so a float32 output is safe.
 *
 * @param {ArrayLike<number>} bits
 * @returns {Float32Array}
 */
export function float16BitsToFloat32(bits) {
  if (bits instanceof Float32Array) return bits;
  const out = new Float32Array(bits.length);
  for (let i = 0; i < bits.length; i++) {
    const h = bits[i] & 0xffff;
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const mant = h & 0x3ff;
    if (exp === 0) {
      out[i] = sign * (mant / 1024) * 2 ** -14;
    } else if (exp === 31) {
      out[i] = mant ? NaN : sign * Infinity;
    } else {
      out[i] = sign * (1 + mant / 1024) * 2 ** (exp - 15);
    }
  }
  return out;
}
