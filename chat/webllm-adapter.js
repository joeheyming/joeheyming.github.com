/**
 * WebLLM adapter — runs an instruct model locally via WebGPU.
 *
 * The model is downloaded lazily on the user's explicit Install (or
 * first send) into the browser's OPFS cache; subsequent loads are
 * instant.
 *
 * Model selection note: WebLLM only enables `ChatCompletionRequest.tools`
 * for a hand-picked set of Hermes-family models. We pin to the latest
 * (Hermes-3-Llama-3.1-8B) so the agent's tool-calling actually fires.
 * Trying Llama-3.2-1B/3B here will return an error like "X is not
 * supported for ChatCompletionRequest.tools."
 */

const WEBLLM_MODULE_URL =
  'https://esm.run/@mlc-ai/web-llm@0.2.79';

/**
 * Default model — Hermes-3-Llama-3.1-8B quantized to q4f16_1. ~4.5 GB
 * download. Chosen because WebLLM gates tool-calling to the Hermes
 * family; without it, the agent's `tools` array is rejected at runtime.
 * Inference is ~20–40 tok/s on Apple Silicon, ~10–20 on a discrete GPU.
 */
const DEFAULT_MODEL = 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC';

/** Human-readable size of the default model, shown in the install dialog. */
const DEFAULT_MODEL_SIZE_LABEL = '~4.5 GB';

/** @type {Promise<any> | null} */
let modulePromise = null;
/** @type {any} */
let engine = null;
let currentModelId = '';

function loadModule() {
  if (!modulePromise) {
    modulePromise = import(/* @vite-ignore */ WEBLLM_MODULE_URL).catch((err) => {
      modulePromise = null;
      throw new Error(`Failed to load WebLLM: ${err?.message || err}`);
    });
  }
  return modulePromise;
}

/**
 * Patch `navigator.gpu.requestAdapter` so every call (including the
 * internal one WebLLM/Dawn makes) defaults to `powerPreference:
 * 'high-performance'`. Without this, WebLLM passes no preference and
 * the browser returns the OS-default adapter — on Windows laptops with
 * hybrid graphics that's the slow iGPU.
 *
 * Idempotent — re-running is a no-op so it's safe to call on every
 * init. Caller explicit options still win (we only fill in the
 * default).
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
  console.log('[chat:webgpu] patched navigator.gpu.requestAdapter to prefer high-performance');
}

/**
 * @returns {boolean} true when the current browser exposes WebGPU.
 *   Coarse sync check — only verifies that `navigator.gpu` exists.
 *   For diagnostics use `probeWebGpu()`.
 */
export function isWebGpuSupported() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Probe WebGPU end-to-end: API surface present AND `requestAdapter()`
 * actually returns a usable adapter. Returns a structured result so
 * the UI can show the user the specific reason it failed (the bare
 * "this chat needs WebGPU" message isn't actionable on a machine that
 * obviously has a GPU).
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: 'no-api' | 'no-adapter' | 'adapter-error' | 'iframe-blocked' | 'not-secure-context',
 *   detail?: string,
 *   userAgent?: string,
 *   secureContext?: boolean,
 *   inIframe?: boolean,
 *   origin?: string
 * }>}
 */
export async function probeWebGpu() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const secureContext =
    typeof window !== 'undefined' && typeof window.isSecureContext === 'boolean'
      ? window.isSecureContext
      : false;
  const origin =
    typeof window !== 'undefined' && window.location
      ? window.location.origin || ''
      : '';
  let inIframe = false;
  try {
    inIframe = typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    inIframe = true;
  }
  const env = { userAgent: ua, secureContext, inIframe, origin };

  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    // Secure-context check beats every other diagnosis: when `navigator.gpu`
    // is missing AND `isSecureContext` is false (e.g. loaded over plain
    // HTTP from a LAN IP), the page is the problem, not the browser.
    if (!secureContext) {
      return {
        ok: false,
        reason: 'not-secure-context',
        detail:
          `This page is not a secure context (origin: ${origin || '(unknown)'}). WebGPU requires HTTPS, or localhost / 127.0.0.1. Reload the page over HTTPS, or use localhost instead of a LAN IP.`,
        ...env
      };
    }
    // The most common case: API simply not in this browser. When inside
    // an iframe this can ALSO mean the parent didn't grant the
    // `webgpu` permissions policy to this frame — surface that hint.
    if (inIframe) {
      return {
        ok: false,
        reason: 'iframe-blocked',
        detail:
          'navigator.gpu is missing inside this iframe. The host page may not be granting the WebGPU permissions policy. Try opening /chat/ in a top-level tab.',
        ...env
      };
    }
    return {
      ok: false,
      reason: 'no-api',
      detail: noApiDetail(ua),
      ...env
    };
  }

  try {
    const adapter = await /** @type {any} */ (navigator).gpu.requestAdapter();
    if (!adapter) {
      return {
        ok: false,
        reason: 'no-adapter',
        detail:
          'requestAdapter() returned null. The WebGPU API is present but no compatible GPU adapter is available — usually a driver issue, a browser flag is off, or the GPU is blocklisted by the browser. On Chrome/Edge, check chrome://gpu (or edge://gpu) for the WebGPU status line, and try chrome://flags/#enable-unsafe-webgpu if your GPU is listed as blocklisted.',
        ...env
      };
    }
    return { ok: true, ...env };
  } catch (err) {
    return {
      ok: false,
      reason: 'adapter-error',
      detail: err && /** @type {Error} */ (err).message
        ? /** @type {Error} */ (err).message
        : String(err),
      ...env
    };
  }
}

/**
 * @typedef {Object} AdapterSummary
 * @property {string} vendor
 * @property {string} architecture
 * @property {string} description
 * @property {string} device
 * @property {string} label   Short human label like "Intel" or "NVIDIA".
 * @property {boolean} likelyIntegrated  Heuristic: looks like an integrated GPU.
 */

/**
 * Probe the WebGPU adapters available for each power preference. Used to
 * tell the user *which* GPU they're actually running on — on Windows
 * laptops with hybrid graphics, the default adapter is usually the
 * iGPU (power saving), and the user has to set Chrome's graphics
 * preference to "High performance" in Windows to get the dGPU.
 *
 * @returns {Promise<{
 *   defaultAdapter: AdapterSummary | null,
 *   highPerformanceAdapter: AdapterSummary | null,
 *   lowPowerAdapter: AdapterSummary | null,
 *   hybridGraphics: boolean
 * }>}
 */
export async function probeAdapters() {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return {
      defaultAdapter: null,
      highPerformanceAdapter: null,
      lowPowerAdapter: null,
      hybridGraphics: false
    };
  }
  /** @type {any} */
  const gpu = navigator.gpu;
  const [def, hp, lp] = await Promise.all([
    gpu.requestAdapter().catch(() => null),
    gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null),
    gpu.requestAdapter({ powerPreference: 'low-power' }).catch(() => null)
  ]);
  const defaultAdapter = await summarizeAdapter(def);
  const highPerformanceAdapter = await summarizeAdapter(hp);
  const lowPowerAdapter = await summarizeAdapter(lp);
  // True when the high-performance and low-power adapters describe
  // different physical GPUs — the classic Optimus / iGPU+dGPU setup.
  const hybridGraphics =
    !!highPerformanceAdapter &&
    !!lowPowerAdapter &&
    !sameAdapter(highPerformanceAdapter, lowPowerAdapter);
  return { defaultAdapter, highPerformanceAdapter, lowPowerAdapter, hybridGraphics };
}

/**
 * @param {any} adapter
 * @returns {Promise<AdapterSummary | null>}
 */
async function summarizeAdapter(adapter) {
  if (!adapter) return null;
  // Modern spec: `adapter.info` is a sync getter. Older spec /
  // browsers still expose `adapter.requestAdapterInfo()`.
  let info = adapter.info;
  if (!info && typeof adapter.requestAdapterInfo === 'function') {
    try {
      info = await adapter.requestAdapterInfo();
    } catch {
      info = null;
    }
  }
  if (!info) {
    return {
      vendor: '',
      architecture: '',
      description: '',
      device: '',
      label: 'unknown',
      likelyIntegrated: false
    };
  }
  const vendor = (info.vendor || '').toLowerCase();
  const architecture = (info.architecture || '').toLowerCase();
  const description = (info.description || '').toString();
  const device = (info.device || '').toString();
  // Human label — prefer description (sometimes has full GPU name),
  // fall back to a Title-Cased vendor name.
  const label =
    description ||
    (vendor ? vendor[0].toUpperCase() + vendor.slice(1) : '') ||
    'unknown';
  // Heuristic: Intel = iGPU; AMD APUs sometimes report "amd" but with
  // architectures like "rdna2" + small device names. The safest
  // signal is vendor=intel. Apple is single-GPU so it's effectively
  // integrated but we don't want to warn there.
  const likelyIntegrated = vendor === 'intel';
  return { vendor, architecture, description, device, label, likelyIntegrated };
}

/**
 * @param {AdapterSummary} a
 * @param {AdapterSummary} b
 */
function sameAdapter(a, b) {
  if (a.description && b.description) return a.description === b.description;
  return a.vendor === b.vendor && a.architecture === b.architecture;
}

/**
 * Initialize the engine, downloading the model if not cached. Reports
 * progress via the optional callback.
 *
 * @param {(report: { progress: number, text: string }) => void} [onProgress]
 * @param {string} [modelId]
 */
export async function initWebLlm(onProgress, modelId = DEFAULT_MODEL) {
  if (!isWebGpuSupported()) {
    throw new Error('WebGPU is required to run the local model in this browser.');
  }
  preferHighPerformanceGpu();

  const mod = await loadModule();
  if (engine && currentModelId === modelId) {
    return engine;
  }

  if (engine && currentModelId !== modelId) {
    try {
      await engine.unload?.();
    } catch {
      /* ignore */
    }
    engine = null;
  }

  engine = await mod.CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      if (typeof onProgress === 'function') {
        onProgress({
          progress: typeof report.progress === 'number' ? report.progress : 0,
          text: report.text || ''
        });
      }
    }
  });
  currentModelId = modelId;
  return engine;
}

/**
 * Run a streaming chat completion against the loaded engine. Resolves
 * with the fully-assembled message (text + any tool calls). Calls
 * `onDelta` for each incremental content chunk so the UI can paint.
 *
 * @param {{
 *   messages: Array<object>,
 *   tools?: Array<object>,
 *   toolChoice?: 'auto'|'required'|'none'|{type:'function',function:{name:string}},
 *   model?: string,
 *   signal?: AbortSignal,
 *   onDelta?: (delta: { content?: string }) => void
 * }} req
 */
export async function webllmChat(req) {
  if (!engine) {
    throw new Error('WebLLM not initialized. Call initWebLlm() first.');
  }

  const hasTools = !!(req.tools && req.tools.length);
  const toolChoice = req.toolChoice || 'auto';
  const body = {
    messages: req.messages,
    stream: true,
    ...(hasTools ? { tools: req.tools, tool_choice: toolChoice } : {})
  };

  console.log('[chat:llm] sending request', {
    messageCount: req.messages.length,
    lastUserMessage: lastUserText(req.messages),
    toolCount: hasTools ? req.tools.length : 0,
    toolChoice: hasTools ? toolChoice : '(no tools)'
  });

  const result = {
    content: '',
    /** @type {Array<{ id: string, name: string, arguments: string }>} */
    toolCalls: [],
    finishReason: 'stop'
  };
  /** @type {Map<number, { id?: string, name?: string, arguments: string }>} */
  const toolCallsByIndex = new Map();

  try {
    // WebLLM's chat.completions.create returns an async iterable when stream is true.
    const stream = await engine.chat.completions.create(body);

    for await (const chunk of stream) {
      if (req.signal?.aborted) {
        try {
          await engine.interruptGenerate?.();
        } catch {
          /* ignore */
        }
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      const choice = chunk.choices && chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        result.content += delta.content;
        req.onDelta?.({ content: delta.content });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === 'number' ? tc.index : toolCallsByIndex.size;
          const existing = toolCallsByIndex.get(idx) || { arguments: '' };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCallsByIndex.set(idx, existing);
        }
      }
      if (choice.finish_reason) {
        result.finishReason = choice.finish_reason;
      }
    }
  } catch (err) {
    // WebLLM bug: when `tools` is passed and `tool_choice: 'auto'`, the
    // parser tries to interpret EVERY response as JSON for function
    // calling, even when the model legitimately answered in plain text.
    // The model's actual response is preserved verbatim in the error
    // message. Recover it instead of failing the turn.
    const recovered = recoverPlainTextFromToolParseError(err);
    if (recovered) {
      // In practice the tool parser buffers everything and then throws,
      // so result.content is empty here and we emit the full recovered
      // text. If a future WebLLM streamed chunks before failing, avoid
      // double-painting by only emitting the delta past what was already
      // streamed; the UI appends content to its buffer.
      if (recovered.startsWith(result.content)) {
        const delta = recovered.slice(result.content.length);
        if (delta) req.onDelta?.({ content: delta });
      } else if (!result.content) {
        req.onDelta?.({ content: recovered });
      }
      result.content = recovered;
      result.finishReason = 'stop';
    } else {
      throw err;
    }
  }

  result.toolCalls = [...toolCallsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      name: tc.name || '',
      arguments: tc.arguments || ''
    }));

  console.log('[chat:llm] stream finished', {
    finishReason: result.finishReason,
    contentLength: result.content.length,
    contentPreview: result.content.slice(0, 200),
    toolCallCount: result.toolCalls.length,
    toolCalls: result.toolCalls.map((tc) => ({ name: tc.name, args: tc.arguments }))
  });

  return result;
}

/**
 * Parse a user agent string into a coarse { name, version } pair. Used
 * to tailor the WebGPU diagnostic banner — a modern Chrome on Windows
 * with `navigator.gpu` undefined means something very specific (almost
 * always hardware acceleration disabled), and we want to say so.
 *
 * @param {string} ua
 * @returns {{ name: 'Edge'|'Opera'|'Firefox'|'Chrome'|'Safari'|'unknown', version: number }}
 */
function detectBrowser(ua) {
  // Edge UA contains "Chrome" so check Edge first.
  let m = ua.match(/Edg\/(\d+)/);
  if (m) return { name: 'Edge', version: Number(m[1]) };
  m = ua.match(/OPR\/(\d+)/);
  if (m) return { name: 'Opera', version: Number(m[1]) };
  m = ua.match(/Firefox\/(\d+)/);
  if (m) return { name: 'Firefox', version: Number(m[1]) };
  m = ua.match(/Chrome\/(\d+)/);
  if (m) return { name: 'Chrome', version: Number(m[1]) };
  m = ua.match(/Version\/(\d+)[\d.]* Safari/);
  if (m) return { name: 'Safari', version: Number(m[1]) };
  return { name: 'unknown', version: 0 };
}

/**
 * Pick a tailored detail string for the `no-api` case (navigator.gpu
 * missing despite no iframe). The headline cause on a modern
 * Chrome/Edge on Windows is hardware acceleration being off — that
 * single setting hides the WebGPU API surface entirely. Old browsers
 * or unsupported derivatives need different advice.
 *
 * @param {string} ua
 * @returns {string}
 */
function noApiDetail(ua) {
  const { name, version } = detectBrowser(ua);
  const id = `${name} ${version || '?'}`;
  if ((name === 'Chrome' || name === 'Edge') && version >= 113) {
    const settingsUrl = name === 'Edge' ? 'edge://settings/system' : 'chrome://settings/system';
    const gpuUrl = name === 'Edge' ? 'edge://gpu' : 'chrome://gpu';
    const policyUrl = name === 'Edge' ? 'edge://policy' : 'chrome://policy';
    return (
      `navigator.gpu is undefined despite running ${id}, which supports WebGPU. ` +
      'On Windows this almost always means hardware acceleration is disabled. ' +
      `Open ${settingsUrl} → enable "Use hardware acceleration when available" → restart the browser. ` +
      `If hardware acceleration is already on, check ${gpuUrl} (look for the "WebGPU" status row) ` +
      `and ${policyUrl} (an enterprise policy can disable WebGPU on managed devices).`
    );
  }
  if ((name === 'Chrome' || name === 'Edge') && version > 0) {
    return `${id} is older than 113 and doesn't support WebGPU. Update via the browser settings.`;
  }
  if (name === 'Firefox' && version > 0 && version < 141) {
    return `Firefox ${version} doesn't ship WebGPU on Windows yet — that landed in Firefox 141. Update, or enable dom.webgpu.enabled in about:config.`;
  }
  if (name === 'Firefox' && version >= 141) {
    return (
      `navigator.gpu is undefined despite Firefox ${version}, which supports WebGPU. ` +
      'Check about:support → "Graphics" to see if hardware acceleration / WebRender are enabled, ' +
      'and about:config → dom.webgpu.enabled is true.'
    );
  }
  if (name === 'Safari' && version > 0 && version < 18) {
    return `Safari ${version} — WebGPU shipped in Safari 18 (macOS Sequoia). Update macOS / Safari.`;
  }
  return (
    `navigator.gpu is not defined in this browser (detected: ${id}). ` +
    'WebGPU requires Chrome 113+, Edge 113+, Firefox 141+, or Safari 18+.'
  );
}

/**
 * Pull the most recent user message text out of an OpenAI-style messages
 * array for the request log. Falls back to '' if the conversation has
 * no user turn yet (e.g. an internal recovery call).
 *
 * @param {Array<object>} messages
 * @returns {string}
 */
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = /** @type {any} */ (messages[i]);
    if (m && m.role === 'user' && typeof m.content === 'string') {
      return m.content.length > 200 ? `${m.content.slice(0, 200)}…` : m.content;
    }
  }
  return '';
}

/**
 * WebLLM throws an `Internal error: error encountered when parsing
 * outputMessage for function calling. Got outputMessage: <text>\nGot
 * error: SyntaxError: …` when the model answered in natural language
 * but the function-calling parser was active. The raw model text is
 * embedded in the message between `Got outputMessage:` and `Got error:`.
 *
 * @param {unknown} err
 * @returns {string} the recovered text, or '' if the error doesn't
 *   match the known parse-failure shape.
 */
function recoverPlainTextFromToolParseError(err) {
  if (!err) return '';
  const message =
    typeof (/** @type {any} */ (err).message) === 'string'
      ? /** @type {any} */ (err).message
      : String(err);
  if (!message.includes('parsing outputMessage for function calling')) {
    return '';
  }
  const match = message.match(/Got outputMessage:\s*([\s\S]*?)(?:\nGot error:|$)/);
  if (!match) return '';
  return match[1].trim();
}

export const WEBLLM_DEFAULT_MODEL = DEFAULT_MODEL;
export const WEBLLM_DEFAULT_MODEL_SIZE = DEFAULT_MODEL_SIZE_LABEL;

/**
 * @returns {boolean} true if the engine for the default model is already
 *   loaded and ready to chat without a network round-trip.
 */
export function isWebLlmReady() {
  return engine != null && currentModelId === DEFAULT_MODEL;
}
