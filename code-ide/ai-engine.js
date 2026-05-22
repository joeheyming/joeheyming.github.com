/**
 * ai-engine.js — thin bootstrap around the on-device LLM that powers
 * Code IDE's AI panel and Cmd+K inline edit.
 *
 * The actual model runs through the same WebLLM adapter the standalone
 * chat app uses (`/chat/webllm-adapter.js`). We share the engine
 * singleton on purpose: a user with chat already cached has an instant
 * Code IDE AI experience too, and vice versa — one ~4.5 GB download in
 * OPFS, two surfaces.
 *
 * The chat-side `runChatTurn` is also reused. It's fully headless
 * (DOM-free, callbacks-only) — perfect for plugging into a different
 * UI shell. Code IDE supplies its own `toolCtx` (see ai-context.js)
 * and its own callbacks for streaming + tool-event rendering.
 */

import {
  isWebGpuSupported,
  probeWebGpu,
  initWebLlm,
  isWebLlmReady,
  WEBLLM_DEFAULT_MODEL,
  WEBLLM_DEFAULT_MODEL_SIZE
} from '/chat/webllm-adapter.js';
import { runChatTurn } from '/chat/chat-client.js';

/** @typedef {{ progress: number, text: string }} EngineProgress */
/** @typedef {(p: EngineProgress) => void} EngineProgressCallback */

const STATUS = {
  IDLE: 'idle',
  PROBING: 'probing',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error'
};

export class AiEngine {
  constructor() {
    /** @type {string} */
    this.status = STATUS.IDLE;
    /** @type {string} */
    this.lastError = '';
    /** @type {EngineProgress|null} */
    this.lastProgress = null;
    /** @type {Set<EngineProgressCallback>} */
    this._progressListeners = new Set();
    /** @type {Set<(status: string, error: string) => void>} */
    this._statusListeners = new Set();
    /** @type {Promise<void>|null} */
    this._loadPromise = null;
  }

  static get DEFAULT_MODEL() {
    return WEBLLM_DEFAULT_MODEL;
  }

  static get DEFAULT_MODEL_SIZE() {
    return WEBLLM_DEFAULT_MODEL_SIZE;
  }

  /** @returns {boolean} */
  isReady() {
    return isWebLlmReady() && this.status === STATUS.READY;
  }

  /** @returns {boolean} */
  isLoading() {
    return this.status === STATUS.LOADING || this.status === STATUS.PROBING;
  }

  /** @param {EngineProgressCallback} fn */
  onProgress(fn) {
    this._progressListeners.add(fn);
    return () => this._progressListeners.delete(fn);
  }

  /** @param {(status: string, error: string) => void} fn */
  onStatusChange(fn) {
    this._statusListeners.add(fn);
    return () => this._statusListeners.delete(fn);
  }

  _setStatus(status, error = '') {
    this.status = status;
    this.lastError = error;
    for (const fn of this._statusListeners) {
      try {
        fn(status, error);
      } catch (err) {
        console.warn('[code-ide:ai] status listener threw', err);
      }
    }
  }

  _emitProgress(p) {
    this.lastProgress = p;
    for (const fn of this._progressListeners) {
      try {
        fn(p);
      } catch (err) {
        console.warn('[code-ide:ai] progress listener threw', err);
      }
    }
  }

  /**
   * Probe WebGPU + load the model if not already cached. Reuses the
   * in-flight load when called concurrently. Becomes a no-op once
   * READY.
   */
  async ensureModel() {
    if (this.isReady()) return;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      this._setStatus(STATUS.PROBING);
      if (!isWebGpuSupported()) {
        const detail = (await probeWebGpu()).detail || 'WebGPU unavailable.';
        this._setStatus(STATUS.ERROR, detail);
        throw new Error(detail);
      }
      const probe = await probeWebGpu();
      if (!probe.ok) {
        const detail = probe.detail || `WebGPU probe failed (${probe.reason}).`;
        this._setStatus(STATUS.ERROR, detail);
        throw new Error(detail);
      }

      this._setStatus(STATUS.LOADING);
      try {
        await initWebLlm((report) => this._emitProgress(report));
        this._setStatus(STATUS.READY);
      } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        this._setStatus(STATUS.ERROR, detail);
        throw err;
      } finally {
        this._loadPromise = null;
      }
    })();

    return this._loadPromise;
  }

  /**
   * Run a single conversational turn. Delegates to chat-side
   * runChatTurn so we inherit tool dispatch, abort, recovery, and
   * context-window fitting for free.
   *
   * @param {{
   *   history: Array<object>,
   *   userText: string,
   *   toolCtx: object,
   *   signal: AbortSignal,
   *   onAssistantDelta?: (d: { content?: string }) => void,
   *   onToolEvent?: (e: object) => void,
   *   onAssistantMessageStart?: () => void,
   *   onAssistantMessageEnd?: () => void,
   *   onAssistantTextRetracted?: () => void
   * }} opts
   */
  async runTurn(opts) {
    if (!this.isReady()) {
      throw new Error('AI engine not ready. Call ensureModel() first.');
    }
    return runChatTurn(opts);
  }
}

/** Single shared engine instance for Code IDE. */
let _shared = null;
export function getAiEngine() {
  if (!_shared) _shared = new AiEngine();
  return _shared;
}
