/**
 * SD-Turbo on ONNX Runtime Web, including a source image.
 *
 * Text-only generation is the same one-step Euler update web-txt2img
 * runs (timestep 999). A source image is encoded with the VAE, noised
 * to the strength's timestep, and denoised over the remaining steps of
 * a 4-step schedule. Model files are the same URLs web-txt2img caches,
 * plus the VAE encoder that pipeline never downloads.
 */

import {
  IMAGE_SIZE,
  IMG2IMG_STEPS,
  LATENT_SIZE,
  VAE_SCALING_FACTOR,
  addNoise,
  coverCrop,
  eulerSchedule,
  eulerUpdate,
  float16BitsToFloat32,
  float32ToFloat16Bits,
  latentMean,
  rgbaToModelInput,
  scaleLatent,
  scaleModelInputs,
  strengthStart,
  unitNoise
} from './sd-turbo-math.js';

const MODEL_BASE = 'https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main';
const CACHE_URL = 'https://cdn.jsdelivr.net/npm/web-txt2img@0.3.1/dist/cache.js';
const CACHE_MODEL_ID = 'sd-turbo';

/** @type {Promise<{ fetchArrayBufferWithCacheProgress: Function }> | null} */
let cachePromise = null;

function loadCache() {
  if (!cachePromise) {
    cachePromise = import(/* @vite-ignore */ CACHE_URL).catch((err) => {
      cachePromise = null;
      throw err;
    });
  }
  return cachePromise;
}

/**
 * @param {string} src
 * @returns {Promise<any>}
 */
function dynamicImport(src) {
  return import(/* @vite-ignore */ src);
}

const MODELS = {
  unet: {
    url: 'unet/model.onnx',
    bytes: 1733430199,
    opt: {
      freeDimensionOverrides: {
        batch_size: 1,
        num_channels: 4,
        height: 64,
        width: 64,
        sequence_length: 77
      }
    }
  },
  text_encoder: {
    url: 'text_encoder/model.onnx',
    bytes: 681393168,
    opt: { freeDimensionOverrides: { batch_size: 1 } }
  },
  vae_decoder: {
    url: 'vae_decoder/model.onnx',
    bytes: 99094314,
    opt: {
      freeDimensionOverrides: {
        batch_size: 1,
        num_channels_latent: 4,
        height_latent: 64,
        width_latent: 64
      }
    }
  },
  vae_encoder: {
    url: 'vae_encoder/model.onnx',
    bytes: 68430468,
    // Symbolic dims must be fixed or WebGPU skips the graph optimizations
    // and this encoder runs on the order of a minute instead of a second.
    opt: {
      freeDimensionOverrides: {
        batch_size: 1,
        num_channels: 3,
        height: 512,
        width: 512,
        num_channels_latent: 4,
        height_latent: 64,
        width_latent: 64
      }
    }
  }
};

const TOTAL_BYTES = Object.values(MODELS).reduce((sum, model) => sum + model.bytes, 0);

export class SDTurboEngine {
  constructor() {
    /** @type {Record<string, any>} */
    this.sessions = {};
    /** @type {any} */
    this.ort = null;
    /** @type {((text: string, opts?: object) => Promise<any>) | null} */
    this.tokenizerFn = null;
  }

  /**
   * @param {{
   *   tokenizerProvider: () => Promise<(text: string, opts?: object) => any>,
   *   onProgress?: (report: { progress: number, text: string }) => void,
   *   signal?: AbortSignal
   * }} options
   */
  async load(options) {
    await this.releaseSessions();
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const ortMod = await dynamicImport('onnxruntime-web/webgpu');
    const ort = ortMod.default ?? ortMod;
    this.ort = ort;
    try {
      ort.env.wasm.numThreads = 1;
    } catch {
      /* env may be frozen in some builds */
    }

    const cache = await loadCache();
    const opt = {
      executionProviders: ['webgpu'],
      enableMemPattern: false,
      enableCpuMemArena: false,
      extra: {
        session: {
          disable_prepacking: '1',
          use_device_allocator_for_initializers: '1',
          use_ort_model_bytes_directly: '1',
          use_ort_model_bytes_for_initializers: '1'
        }
      }
    };
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    let downloaded = 0;
    for (const key of Object.keys(MODELS)) {
      const model = MODELS[/** @type {keyof typeof MODELS} */ (key)];
      options.onProgress?.({
        progress: downloaded / TOTAL_BYTES,
        text: `downloading ${model.url}…`
      });
      const buf = await cache.fetchArrayBufferWithCacheProgress(
        `${MODEL_BASE}/${model.url}`,
        CACHE_MODEL_ID,
        (loaded) => {
          options.onProgress?.({
            progress: Math.min(1, (downloaded + loaded) / TOTAL_BYTES),
            text: `downloading ${model.url}…`
          });
        },
        model.bytes
      );
      downloaded += buf.byteLength;
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const session = await ort.InferenceSession.create(buf, { ...opt, ...model.opt });
      this.sessions[key] = session;
      options.onProgress?.({
        progress: downloaded / TOTAL_BYTES,
        text: `${model.url} ready`
      });
    }
    this.tokenizerFn = await options.tokenizerProvider();
  }

  /**
   * @param {{
   *   prompt: string,
   *   seed: number,
   *   image?: CanvasImageSource | null,
   *   strength?: number,
   *   signal?: AbortSignal,
   *   onProgress?: (report: { progress: number, text: string }) => void
   * }} params
   * @returns {Promise<{ ok: true, blob: Blob, timeMs: number } | { ok: false, message: string, reason?: string }>}
   */
  async generate(params) {
    const started = performance.now();
    const ort = this.ort;
    const { prompt, seed, signal, onProgress } = params;
    try {
      if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Cancelled' };
      onProgress?.({ progress: 0.1, text: 'Reading the prompt…' });
      const { input_ids: inputIds } = await this.tokenizerFn(prompt, {
        padding: true,
        max_length: 77,
        truncation: true,
        return_tensor: false
      });
      const ids = Int32Array.from(inputIds);
      const encoded = await this.sessions.text_encoder.run({
        input_ids: new ort.Tensor('int32', ids, [1, ids.length])
      });
      const hidden = encoded.last_hidden_state ?? encoded;
      if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Cancelled' };

      const useImage = !!params.image;
      const steps = useImage ? IMG2IMG_STEPS : 1;
      const schedule = eulerSchedule(steps);
      const start = useImage ? strengthStart(steps, params.strength ?? 0.55) : 0;
      const noise = unitNoise(1 * 4 * LATENT_SIZE * LATENT_SIZE, seed);
      let sample;
      if (useImage) {
        onProgress?.({ progress: 0.25, text: 'Encoding the source image…' });
        const imageTensor = await imageToTensor(params.image, ort);
        let encodedLatent;
        try {
          encodedLatent = await this.sessions.vae_encoder.run({ sample: imageTensor });
        } finally {
          imageTensor.dispose?.();
        }
        const latentTensor = encodedLatent.latent_sample ?? encodedLatent;
        // The encoder's latent_sample is float16. Its .data is the bit
        // pattern, which latent math would read as huge integers.
        const mean = latentMean(tensorToFloat32(latentTensor), latentTensor.dims);
        latentTensor.dispose?.();
        const scaled = scaleLatent(mean);
        sample = addNoise(scaled, noise, schedule.sigmas[start]);
      } else {
        sample = new Float32Array(noise.length);
        const sigma = schedule.sigmas[0];
        for (let i = 0; i < noise.length; i++) sample[i] = noise[i] * sigma;
      }

      const count = steps - start;
      for (let i = start; i < steps; i++) {
        if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Cancelled' };
        const done = i - start;
        onProgress?.({
          progress: 0.35 + (0.5 * done) / count,
          text: useImage ? `Changing the image… (${done + 1}/${count})` : 'Denoising…'
        });
        const sigma = schedule.sigmas[i];
        const modelInput = scaleModelInputs(sample, sigma);
        const feed = {
          sample: new ort.Tensor('float32', modelInput, [1, 4, LATENT_SIZE, LATENT_SIZE]),
          timestep: new ort.Tensor('int64', [BigInt(schedule.timesteps[i])], [1]),
          encoder_hidden_states: hidden
        };
        let unetOut;
        try {
          unetOut = await this.sessions.unet.run(feed);
        } finally {
          feed.sample.dispose?.();
          feed.timestep.dispose?.();
        }
        const predicted = unetOut.out_sample ?? unetOut;
        sample = eulerUpdate(sample, predicted.data, sigma, schedule.sigmas[i + 1]);
        predicted.dispose?.();
      }
      hidden.dispose?.();

      if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Cancelled' };
      onProgress?.({ progress: 0.9, text: 'Decoding…' });
      const decodedLatent = new Float32Array(sample.length);
      for (let i = 0; i < sample.length; i++) decodedLatent[i] = sample[i] / VAE_SCALING_FACTOR;
      const latentTensor = new ort.Tensor('float32', decodedLatent, [
        1,
        4,
        LATENT_SIZE,
        LATENT_SIZE
      ]);
      let vaeOut;
      try {
        vaeOut = await this.sessions.vae_decoder.run({ latent_sample: latentTensor });
      } finally {
        latentTensor.dispose?.();
      }
      const pixels = vaeOut.sample ?? vaeOut;
      const blob = await tensorToPngBlob(pixels);
      pixels.dispose?.();
      return { ok: true, blob, timeMs: performance.now() - started };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  async unload() {
    await this.releaseSessions();
    this.ort = null;
    this.tokenizerFn = null;
  }

  async releaseSessions() {
    for (const session of Object.values(this.sessions)) {
      try {
        await session?.release?.();
      } catch {
        /* already released */
      }
    }
    this.sessions = {};
  }
}

/**
 * @param {CanvasImageSource} image
 * @param {any} ort
 */
async function imageToTensor(image, ort) {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not read the source image.');
  const sw = /** @type {HTMLImageElement} */ (image).naturalWidth || image.width;
  const sh = /** @type {HTMLImageElement} */ (image).naturalHeight || image.height;
  if (!sw || !sh) throw new Error('Source image has no pixels.');
  const crop = coverCrop(sw, sh, IMAGE_SIZE);
  ctx.drawImage(image, crop.dx, crop.dy, crop.dw, crop.dh);
  const rgba = ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE).data;
  // vae_encoder/model.onnx declares sample as tensor(float16). The UNet
  // and VAE decoder in this same package take float32.
  const pixels = rgbaToModelInput(rgba, IMAGE_SIZE, IMAGE_SIZE);
  return new ort.Tensor('float16', float32ToFloat16Bits(pixels), [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
}

/**
 * @param {{ type?: string, data: ArrayLike<number> }} tensor
 * @returns {Float32Array}
 */
function tensorToFloat32(tensor) {
  if (tensor.type === 'float16') {
    if (typeof Float16Array === 'function' && tensor.data instanceof Float16Array) {
      return Float32Array.from(tensor.data);
    }
    return float16BitsToFloat32(tensor.data);
  }
  if (tensor.data instanceof Float32Array) return tensor.data;
  return Float32Array.from(tensor.data);
}

/**
 * @param {any} tensor  NCHW float tensor in roughly [-1, 1].
 * @returns {Promise<Blob>}
 */
async function tensorToPngBlob(tensor) {
  const [, , h, w] = tensor.dims;
  const data = tensor.data;
  const out = new Uint8ClampedArray(w * h * 4);
  let idx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = data[y * w + x];
      const g = data[h * w + y * w + x];
      const b = data[2 * h * w + y * w + x];
      out[idx++] = clampByte(r);
      out[idx++] = clampByte(g);
      out[idx++] = clampByte(b);
      out[idx++] = 255;
    }
  }
  const imageData = new ImageData(out, w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not encode the image.');
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  if (!blob) throw new Error('Could not encode the image.');
  return blob;
}

/** @param {number} v */
function clampByte(v) {
  let x = v / 2 + 0.5;
  if (x < 0) x = 0;
  if (x > 1) x = 1;
  return Math.round(x * 255);
}
