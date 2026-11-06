/**
 * Diffusion adapter — wraps `web-txt2img` to run Janus-Pro 1B locally
 * on the user's GPU.
 *
 * Architecture mirrors `chat/webllm-adapter.js`: the engine is a
 * module-scope singleton, the model is downloaded into Cache Storage
 * on the user's explicit Install, and progress is reported via an
 * optional callback.
 *
 * `web-txt2img` itself wraps onnxruntime-web (UNet/VAE) plus a CLIP
 * tokenizer — implementing all of that from scratch on a static site
 * is multi-day work. We use it via jsDelivr so no build step is
 * required.
 *
 * Why we import the inline runtime directly instead of the package
 * root:
 *
 *   - The package's main `dist/index.js` re-exports
 *     `Txt2ImgWorkerClient` from `worker/client.js`, which spawns
 *     `new Worker('https://cdn.jsdelivr.net/.../host.js')`. Workers
 *     are gated to same-origin (or CORS-blob) — cross-origin from
 *     localhost / github.io to jsdelivr fails with SecurityError.
 *
 *   - The inline runtime at `dist/runtime/inline_client.js` exposes a
 *     `Txt2ImgClient` with the same API surface that runs on the main
 *     thread instead of in a worker. It's the right tool for a
 *     CDN-loaded build.
 *
 * Bare specifiers (`onnxruntime-common`, `onnxruntime-web`,
 * `@huggingface/transformers`) are resolved by the import map in
 * `imagine/index.html`. `onnxruntime-common` and `onnxruntime-web`
 * must be the same module; see that comment.
 */

const WEB_TXT2IMG_INLINE_URL =
  'https://cdn.jsdelivr.net/npm/web-txt2img@0.3.1/dist/runtime/inline_client.js';

/**
 * Absolute URL for `@xenova/transformers` v2 ESM bundle. We import
 * this directly (and inject the tokenizer via the adapter's
 * `tokenizerProvider` DI hook) instead of relying on the import map,
 * because import maps don't reliably apply to dynamic imports that
 * originate inside cross-origin modules — and the SD-Turbo adapter's
 * `await import('@xenova/transformers')` does exactly that. Pinned;
 * bump deliberately.
 *
 * NOTE: must be `dist/transformers.js`, NOT jsDelivr's `+esm`
 * endpoint. The `+esm` build stubs peer dependencies
 * (`onnxruntime-common`) as null, which makes the bundled ORT inside
 * transformers.js throw `Cannot read properties of null (reading
 * 'registerBackend')` at module init. The webpack-built
 * `dist/transformers.js` is self-contained — it ships its own
 * `onnxruntime-common` inline. Same URL Microsoft's official
 * ORT-WebGPU SD-Turbo demo uses.
 */
const TRANSFORMERS_URL =
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

/** CLIP tokenizer used by SD-Turbo's text encoder. */
const CLIP_TOKENIZER_ID = 'Xenova/clip-vit-base-patch16';

/**
 * Janus-Pro 1B is the default. SD-Turbo is the other model web-txt2img
 * 0.3.1 can run; the page offers it from the model menu.
 */
const DEFAULT_MODEL = 'janus-pro-1b';

/** Human-readable size of the default model, shown before a selection. */
const DEFAULT_MODEL_SIZE_LABEL = '~2.2 GB';

/**
 * Models this page can load. web-txt2img 0.3.1 ships exactly these two.
 *
 * `supportsSeed` is what the runtime actually honors. SD-Turbo takes a
 * seed and always draws 512×512. Janus-Pro ignores seeds and draws
 * 384×384, one image token at a time. Neither adapter accepts a source
 * image, so image-to-image is not offered.
 *
 * @typedef {Object} ImagineModelInfo
 * @property {string} id
 * @property {string} label
 * @property {string} sizeLabel
 * @property {string} description
 * @property {string} speedHint
 * @property {string} features   Short line for the composer.
 * @property {number} sizePx     Square output edge, in pixels.
 * @property {boolean} supportsSeed
 * @property {boolean} supportsImage  SD-Turbo can start from a source image.
 * @property {'web-txt2img' | 'web-txt2img-janus'} runtime
 *
 * @type {Record<string, ImagineModelInfo>}
 */
export const IMAGE_MODELS = {
  'janus-pro-1b': {
    id: 'janus-pro-1b',
    label: 'Janus-Pro 1B',
    sizeLabel: '~2.2 GB',
    description:
      'Autoregressive image model. Reads detailed prompts more literally than a one-step diffusion model, and draws the picture one token at a time.',
    speedHint: 'about 20–60 seconds per image',
    features: '384×384 · new sample every time · about 20–60 seconds',
    sizePx: 384,
    supportsSeed: false,
    supportsImage: false,
    runtime: 'web-txt2img-janus'
  },
  'sd-turbo': {
    id: 'sd-turbo',
    label: 'SD-Turbo',
    sizeLabel: '~2.6 GB',
    description:
      'One-step distillation of Stable Diffusion. Fast, the same seed redraws the same picture, and a source image can steer the result.',
    speedHint: 'about 1–5 seconds per image, a bit longer from a source image',
    features: '512×512 · seed · source image · about 1–5 seconds',
    sizePx: 512,
    supportsSeed: true,
    supportsImage: true,
    runtime: 'web-txt2img'
  }
};

/** @type {Promise<any> | null} */
let modulePromise = null;
/** @type {Promise<(text: string, opts?: object) => any> | null} */
let tokenizerPromise = null;
/** @type {Promise<any> | null} HF transformers module shared by Janus. */
let hfTransformersPromise = null;
/**
 * The `Txt2ImgWorkerClient` (or inline-runtime equivalent) returned by
 * `createDefault()`. Module-scope singleton so we don't reload the
 * model when the page hot-reloads scripts.
 *
 * @type {any}
 */
let client = null;
/** @type {import('./sd-turbo.js').SDTurboEngine | null} */
let turbo = null;
let currentModelId = '';
let modelLoaded = false;

/**
 * @param {string} src
 * @returns {Promise<any>}
 */
function dynamicImport(src) {
  return import(/* @vite-ignore */ src);
}

async function loadModule() {
  if (!modulePromise) {
    modulePromise = dynamicImport(WEB_TXT2IMG_INLINE_URL).catch((err) => {
      modulePromise = null;
      throw new Error(
        `Failed to load web-txt2img inline runtime from CDN: ${err?.message || err}. ` +
          `Check your network and ad-blockers (jsDelivr is sometimes blocked).`
      );
    });
  }
  return modulePromise;
}

/**
 * Lazily import `@xenova/transformers` from a hard-coded absolute URL
 * and build the CLIP tokenizer used by SD-Turbo's text encoder.
 * Cached for the lifetime of the page.
 *
 * Returned function is the call-shape the SD-Turbo adapter expects:
 * `(text, opts) => { input_ids, ... }`.
 *
 * @returns {Promise<(text: string, opts?: object) => any>}
 */
function loadTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      let mod;
      try {
        mod = await dynamicImport(TRANSFORMERS_URL);
      } catch (err) {
        tokenizerPromise = null;
        throw new Error(`Failed to load @xenova/transformers from CDN: ${err?.message || err}.`);
      }
      const AutoTokenizer = mod?.AutoTokenizer;
      const env = mod?.env;
      if (!AutoTokenizer || typeof AutoTokenizer.from_pretrained !== 'function') {
        tokenizerPromise = null;
        throw new Error(
          'Loaded @xenova/transformers but AutoTokenizer is missing. The CDN bundle may have changed shape.'
        );
      }
      // Force the library to fetch model files from huggingface.co
      // (some browser caches end up with bad defaults for these flags
      // when the bundle is loaded cross-origin).
      if (env) {
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        env.remoteHost = 'https://huggingface.co/';
        env.remotePathTemplate = '{model}/resolve/{revision}/';
      }
      const tok = await AutoTokenizer.from_pretrained(CLIP_TOKENIZER_ID, {
        local_files_only: false,
        revision: 'main'
      });
      // SD-Turbo's text encoder expects pad_token_id = 0 (the
      // tokenizer's default differs across CLIP variants).
      tok.pad_token_id = 0;
      return (/** @type {string} */ text, /** @type {any} */ opts) => tok(text, opts);
    })();
  }
  return tokenizerPromise;
}

/**
 * Lazy-load `@huggingface/transformers` (v3) for the Janus-Pro
 * adapter. The web-txt2img Janus adapter tries `import(bare)` first
 * and falls back to `globalThis.transformers`; we satisfy *both*
 * paths by performing the import here (so the import map applies in
 * the host context) and stamping the resolved module onto
 * `globalThis.transformers`.
 *
 * @returns {Promise<any>}
 */
function loadHfTransformers() {
  if (!hfTransformersPromise) {
    hfTransformersPromise = (async () => {
      try {
        const mod = await import('@huggingface/transformers');
        // The Janus adapter looks at globalThis as a last resort —
        // the bare import only works when the page's import map is
        // visible to it (which depends on which runtime ends up
        // doing the dynamic import). Setting the global is cheap
        // insurance so the fallback path Just Works.
        // eslint-disable-next-line no-undef
        globalThis.transformers = mod;
        return mod;
      } catch (err) {
        hfTransformersPromise = null;
        throw new Error(
          `Failed to load @huggingface/transformers (needed for Janus-Pro): ${err?.message || err}.`
        );
      }
    })();
  }
  return hfTransformersPromise;
}

/**
 * Patch `navigator.gpu.requestAdapter` to default to
 * `powerPreference: 'high-performance'` so on hybrid-graphics machines
 * we don't end up running diffusion on the iGPU (5–10× slower).
 *
 * Same idea as `chat/webllm-adapter.js#preferHighPerformanceGpu` —
 * duplicated here intentionally so the two apps stay decoupled.
 *
 * Idempotent.
 */
function preferHighPerformanceGpu() {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return;
  /** @type {any} */
  const gpu = navigator.gpu;
  if (gpu.__heymingHighPerfPatched) return;
  const orig = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = function patchedRequestAdapter(opts) {
    const merged = {
      ...(opts || {}),
      powerPreference: (opts && opts.powerPreference) || 'high-performance'
    };
    return orig(merged);
  };
  gpu.__heymingHighPerfPatched = true;
  console.log('[imagine:webgpu] patched navigator.gpu.requestAdapter to prefer high-performance');
}

/**
 * @returns {boolean} true when `navigator.gpu` is present. Coarse —
 *   for a usable-adapter check use `probeWebGpu()`.
 */
export function isWebGpuSupported() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * @param {string} [modelId]  When omitted, treat any loaded model
 *   as ready. When given, ready means the loaded model matches.
 * @returns {boolean} true when the engine is loaded and ready to
 *   generate without a network round-trip.
 */
export function isEngineReady(modelId) {
  if (!modelLoaded) return false;
  if (!client && !turbo) return false;
  if (modelId && currentModelId !== modelId) return false;
  return true;
}

/**
 * @returns {string} The currently-loaded model id, or '' if none.
 */
export function getCurrentModelId() {
  return currentModelId;
}

/**
 * Probe WebGPU end-to-end: API surface present AND `requestAdapter()`
 * returns a usable adapter. Returns a structured result so the UI can
 * tell the user the specific reason it failed.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: 'no-api' | 'no-adapter' | 'adapter-error' | 'iframe-blocked' | 'not-secure-context',
 *   detail?: string
 * }>}
 */
export async function probeWebGpu() {
  const secureContext =
    typeof window !== 'undefined' && typeof window.isSecureContext === 'boolean'
      ? window.isSecureContext
      : false;
  const origin =
    typeof window !== 'undefined' && window.location ? window.location.origin || '' : '';
  let inIframe = false;
  try {
    inIframe = typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    inIframe = true;
  }

  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    if (!secureContext) {
      return {
        ok: false,
        reason: 'not-secure-context',
        detail: `Page is not a secure context (origin: ${
          origin || '(unknown)'
        }). WebGPU requires HTTPS, or localhost / 127.0.0.1.`
      };
    }
    if (inIframe) {
      return {
        ok: false,
        reason: 'iframe-blocked',
        detail:
          'navigator.gpu is missing inside this iframe. The host page may not be granting the WebGPU permissions policy. Try opening /imagine/ in a top-level tab.'
      };
    }
    return {
      ok: false,
      reason: 'no-api',
      detail:
        'navigator.gpu is undefined. WebGPU requires Chrome 113+, Edge 113+, Firefox 141+, or Safari 18+, with hardware acceleration enabled.'
    };
  }

  try {
    const adapter = await /** @type {any} */ (navigator).gpu.requestAdapter();
    if (!adapter) {
      return {
        ok: false,
        reason: 'no-adapter',
        detail:
          'requestAdapter() returned null. The WebGPU API is present but no compatible GPU adapter is available — usually a driver issue, browser flag, or GPU blocklist. On Chrome/Edge, check chrome://gpu for the WebGPU status row.'
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'adapter-error',
      detail:
        err && /** @type {Error} */ (err).message ? /** @type {Error} */ (err).message : String(err)
    };
  }
}

/**
 * Initialize the engine, downloading the model if not cached. Reports
 * progress via the optional callback. Subsequent calls with the same
 * model id are no-ops (the engine is a singleton).
 *
 * @param {(report: { progress: number, text: string }) => void} [onProgress]
 * @param {string} [modelId]
 * @param {AbortSignal} [signal]
 */
export async function initEngine(onProgress, modelId = DEFAULT_MODEL, signal) {
  if (!isWebGpuSupported()) {
    throw new Error('WebGPU is required to run the local image model in this browser.');
  }
  preferHighPerformanceGpu();

  const modelInfo = IMAGE_MODELS[modelId] || IMAGE_MODELS[DEFAULT_MODEL];
  if (modelLoaded && currentModelId === modelId) {
    return modelInfo.runtime === 'web-txt2img' ? turbo : client;
  }

  if (modelInfo.runtime === 'web-txt2img') {
    return initTurbo(onProgress, modelId, signal);
  }

  if (turbo) {
    try {
      await turbo.unload();
    } catch {
      /* ignore */
    }
    turbo = null;
    modelLoaded = false;
  }

  const mod = await loadModule();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (client && currentModelId !== modelId) {
    try {
      await client.unload?.();
    } catch {
      /* ignore */
    }
    client = null;
    modelLoaded = false;
  }

  if (!client) {
    client = createClient(mod);
  }

  // Janus needs @huggingface/transformers reachable. Pre-load it
  // (and stamp the global) before the adapter's load runs so its
  // import-or-fallback chain resolves on the first try.
  onProgress?.({ progress: 0, text: 'Loading transformers library…' });
  await loadHfTransformers();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const result = await client.load(
    modelId,
    { backendPreference: ['webgpu'], wasmNumThreads: 1 },
    /** @param {any} p */ (p) => {
      if (signal?.aborted) return;
      const pct = typeof p?.pct === 'number' ? p.pct / 100 : 0;
      const sizeFrag =
        typeof p?.bytesDownloaded === 'number' && typeof p?.totalBytesExpected === 'number'
          ? ` (${formatMb(p.bytesDownloaded)} / ${formatMb(p.totalBytesExpected)})`
          : '';
      const text = `${p?.message || 'Loading…'}${sizeFrag}`;
      try {
        onProgress?.({ progress: Math.max(0, Math.min(1, pct)), text });
      } catch {
        /* don't let UI errors abort the load */
      }
    }
  );

  if (signal?.aborted) {
    try {
      await client.unload?.();
    } catch {
      /* ignore */
    }
    throw new DOMException('Aborted', 'AbortError');
  }

  if (!result?.ok) {
    const message = result?.message || `Unknown error loading model "${modelId}".`;
    client = null;
    modelLoaded = false;
    throw new Error(message);
  }

  currentModelId = modelId;
  modelLoaded = true;
  return client;
}

/**
 * SD-Turbo loads through our own runtime so a source image can be
 * encoded. Janus keeps using web-txt2img.
 *
 * @param {(report: { progress: number, text: string }) => void} [onProgress]
 * @param {string} modelId
 * @param {AbortSignal} [signal]
 */
async function initTurbo(onProgress, modelId, signal) {
  if (client) {
    try {
      await client.unload?.();
    } catch {
      /* ignore */
    }
    client = null;
    modelLoaded = false;
  }
  if (!turbo) {
    const { SDTurboEngine } = await import('./sd-turbo.js');
    turbo = new SDTurboEngine();
  }
  loadTokenizer().catch((err) => {
    console.warn('[imagine] tokenizer pre-warm failed (will retry on generate)', err);
    tokenizerPromise = null;
  });
  await turbo.load({
    tokenizerProvider: () => loadTokenizer(),
    onProgress,
    signal
  });
  currentModelId = modelId;
  modelLoaded = true;
  return turbo;
}

/**
 * Generate one image. SD-Turbo accepts a seed and, when `image` is
 * set, starts from that picture. Janus-Pro takes the prompt alone.
 *
 * @param {{
 *   prompt: string,
 *   seed?: number,
 *   image?: CanvasImageSource | null,
 *   strength?: number,
 *   signal?: AbortSignal,
 *   onProgress?: (report: { progress: number, text: string }) => void
 * }} req
 * @returns {Promise<{ blob: Blob, url: string, prompt: string, seed: number, modelId: string, fromImage: boolean, timeMs: number }>}
 */
export async function generateImage(req) {
  if (!modelLoaded) {
    throw new Error('Engine not initialized. Call initEngine() first.');
  }
  const prompt = (req.prompt || '').trim();
  if (!prompt) {
    throw new Error('Prompt is empty.');
  }
  const model = IMAGE_MODELS[currentModelId];
  const supportsSeed = model?.supportsSeed === true;
  const seed = supportsSeed
    ? typeof req.seed === 'number' && Number.isFinite(req.seed)
      ? Math.max(0, Math.floor(req.seed)) >>> 0
      : Math.floor(Math.random() * 0xffffffff) >>> 0
    : 0;
  const fromImage = model?.supportsImage === true && !!req.image;

  console.log('[imagine:gen] generating', { prompt, seed, modelId: currentModelId, fromImage });

  /** @type {{ ok?: boolean, blob?: Blob, timeMs?: number, reason?: string, message?: string }} */
  let result;
  if (model?.runtime === 'web-txt2img') {
    if (!turbo) throw new Error('Engine not initialized. Call initEngine() first.');
    result = await turbo.generate({
      prompt,
      seed,
      image: fromImage ? req.image : null,
      strength: req.strength,
      signal: req.signal,
      onProgress: (report) => {
        try {
          req.onProgress?.(report);
        } catch {
          /* ignore UI errors */
        }
      }
    });
  } else {
    if (!client) throw new Error('Engine not initialized. Call initEngine() first.');
    const handle = client.generate(
      supportsSeed ? { prompt, seed } : { prompt },
      /** @param {any} p */ (p) => {
        if (req.signal?.aborted) return;
        const pct = typeof p?.pct === 'number' ? p.pct / 100 : 0;
        const phase = p?.phase || p?.message || 'generating';
        try {
          req.onProgress?.({
            progress: Math.max(0, Math.min(1, pct)),
            text: `${phase}…`
          });
        } catch {
          /* ignore UI errors */
        }
      }
    );
    if (req.signal) {
      if (req.signal.aborted) {
        try {
          await handle.abort?.();
        } catch {
          /* ignore */
        }
        throw new DOMException('Aborted', 'AbortError');
      }
      req.signal.addEventListener(
        'abort',
        () => {
          try {
            handle.abort?.();
          } catch {
            /* ignore */
          }
        },
        { once: true }
      );
    }
    result = await handle.promise;
  }

  if (!result?.ok) {
    if (result?.reason === 'cancelled' || result?.reason === 'aborted' || req.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    throw new Error(result?.message || 'Image generation failed.');
  }

  const blob = /** @type {Blob} */ (result.blob);
  const url = URL.createObjectURL(blob);
  return {
    blob,
    url,
    prompt,
    seed,
    modelId: currentModelId,
    fromImage,
    timeMs: typeof result.timeMs === 'number' ? result.timeMs : 0
  };
}

/**
 * Fully unload the engine, freeing GPU memory. Used when the user
 * cleans up (e.g. closes the app in HeymingOS) — the cache stays.
 */
export async function unloadEngine() {
  try {
    await client?.unload?.();
  } catch {
    /* ignore */
  }
  try {
    await turbo?.unload();
  } catch {
    /* ignore */
  }
  client = null;
  turbo = null;
  modelLoaded = false;
  currentModelId = '';
}

/**
 * Build a `Txt2ImgClient` from the loaded inline runtime module.
 *
 * `runtime/inline_client.js` exports two classes: the recommended
 * `Txt2ImgClient` and a deprecated `Txt2ImgWorkerClient` shim that
 * inherits from it. We prefer `Txt2ImgClient` directly. If the export
 * shape ever changes upstream, we surface a clear error rather than
 * silently fall back to something else.
 *
 * @param {any} mod
 * @returns {any}
 */
function createClient(mod) {
  if (mod?.Txt2ImgClient && typeof mod.Txt2ImgClient === 'function') {
    return new mod.Txt2ImgClient();
  }
  // Compatibility shim: older drafts of the package only exposed
  // `Txt2ImgWorkerClient.createDefault()`. The inline runtime's
  // shim is safe even though the name suggests a worker — it
  // doesn't actually spawn one.
  if (mod?.Txt2ImgWorkerClient && typeof mod.Txt2ImgWorkerClient.createDefault === 'function') {
    return mod.Txt2ImgWorkerClient.createDefault();
  }
  throw new Error(
    'Unrecognized web-txt2img inline runtime shape — Txt2ImgClient is missing. ' +
      'The CDN bundle may have changed; pin a version that works.'
  );
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

export const IMAGINE_DEFAULT_MODEL = DEFAULT_MODEL;
export const IMAGINE_DEFAULT_MODEL_SIZE = DEFAULT_MODEL_SIZE_LABEL;
