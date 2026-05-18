/**
 * Chat app entry point — wires the DOM to the chat client and the
 * local WebLLM engine.
 *
 * Architecture: 100% client-side. The LLM runs in the visitor's
 * browser via WebGPU. No backend, no API key, no third-party LLM
 * endpoint. The page gates entry on WebGPU support; the model is
 * downloaded lazily on the user's first send, not at page load.
 *
 * Standalone-friendly: works at /chat/ directly. Inside the HeymingOS
 * iframe shell, notifications and `launchApp` route through the
 * os-embed bridge so e.g. launching Paint opens it as another OS
 * window instead of replacing the chat tab.
 */

import { createOSEmbed } from '/os-embed.js';
import { createNotifier } from '/notifications.js';
import {
  isWebGpuSupported,
  isWebLlmReady,
  initWebLlm,
  probeWebGpu,
  probeAdapters,
  WEBLLM_DEFAULT_MODEL,
  WEBLLM_DEFAULT_MODEL_SIZE
} from './webllm-adapter.js';
import { loadDocument, formatBytes } from './document-loader.js';

// -------------------- Hot-reloadable modules --------------------

// chat-client, tools, system-prompt, and storage are loaded dynamically so
// we can re-fetch them with a `?t=…` cache-bust on demand (the "Reload"
// button). webllm-adapter stays statically imported — the engine is a
// module-scope singleton and dropping it would force a multi-second
// re-init from OPFS, which is exactly what we're trying to avoid.

/** @type {(opts: any) => Promise<{ aborted: boolean, iterations: number }>} */
let runChatTurn;
/** @type {() => Array<object>} */
let loadHistory;
/** @type {(messages: Array<object>) => void} */
let saveHistory;
/** @type {() => void} */
let clearHistory;
/** @type {() => boolean} */
let hasInstalledModel;
/** @type {() => void} */
let markModelInstalled;
/** @type {() => void} */
let clearModelInstalledFlag;

let scriptsCacheBust = '';

async function loadDynamicModules() {
  const t = scriptsCacheBust;
  const [chatClient, storage] = await Promise.all([
    import(`./chat-client.js${t}`),
    import(`./storage.js${t}`)
  ]);
  runChatTurn = chatClient.runChatTurn;
  loadHistory = storage.loadHistory;
  saveHistory = storage.saveHistory;
  clearHistory = storage.clearHistory;
  hasInstalledModel = storage.hasInstalledModel;
  markModelInstalled = storage.markModelInstalled;
  clearModelInstalledFlag = storage.clearModelInstalledFlag;
}

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const els = {
  app: $('chat-app'),
  scroll: $('chat-scroll'),
  empty: $('chat-empty'),
  emptyDefault: $('chat-empty-default'),
  install: $('chat-install'),
  installBtn: /** @type {HTMLButtonElement} */ ($('chat-install-btn')),
  messages: $('chat-messages'),
  composer: /** @type {HTMLFormElement} */ ($('chat-composer')),
  input: /** @type {HTMLTextAreaElement} */ ($('chat-input')),
  send: /** @type {HTMLButtonElement} */ ($('chat-send')),
  stop: /** @type {HTMLButtonElement} */ ($('chat-stop')),
  newBtn: /** @type {HTMLButtonElement} */ ($('chat-new-btn')),
  reloadBtn: /** @type {HTMLButtonElement | null} */ (document.getElementById('chat-reload-btn')),
  modeLine: $('chat-mode-line'),
  toasts: $('chat-toasts'),
  unsupported: $('chat-unsupported'),
  attachments: $('chat-attachments'),
  attachBtn: /** @type {HTMLButtonElement} */ ($('chat-attach-btn')),
  attachInput: /** @type {HTMLInputElement} */ ($('chat-attach-input')),
  dropOverlay: $('chat-drop-overlay')
};

const localNotifier = createNotifier({
  container: els.toasts,
  kindClass: (k) => `notify notify-${k}`,
  defaultDurationMs: 3500,
  dismissible: true
});

const embed = createOSEmbed({
  app: 'chat',
  title: 'Open in Chat',
  notifier: localNotifier
});

const notify = (message, kind = 'info') => embed.notify(message, { kind });

// -------------------- State --------------------

/** @type {Array<object>} */
let history = [];

/** @type {AbortController | null} */
let currentTurn = null;

/**
 * Documents the user has dropped/attached but not sent yet. Each entry
 * has the extracted text in `content`; on send we hand the list to the
 * chat client which expands it into the LLM-visible user message and
 * stamps it onto the history entry as `attachments` (sans content for
 * persistence — see storage.js).
 *
 * @type {Array<import('./document-loader.js').Attachment>}
 */
let pendingAttachments = [];

/**
 * In-flight model-ready promise. When a load is already running, both
 * the boot path and a user-triggered send await this same promise
 * instead of kicking off concurrent inits.
 */
let modelReadyPromise = /** @type {Promise<boolean> | null} */ (null);

/** Cache the apps registry — every listApps call would otherwise refetch. */
let appsRegistryPromise = /** @type {Promise<Array<object>> | null} */ (null);

/** Cache the FileSystemDB instance lazily. */
let fsPromise = /** @type {Promise<any> | null} */ (null);

const toolCtx = {
  embed,
  notify: (msg, kind) => notify(msg, kind),
  proxy: () => /** @type {any} */ (window).proxyService || null,
  appsRegistry: () => {
    if (!appsRegistryPromise) {
      appsRegistryPromise = fetch('/apps-registry.json')
        .then((r) => r.json())
        .catch(() => []);
    }
    return appsRegistryPromise;
  },
  fs: () => {
    if (!fsPromise) {
      fsPromise = (async () => {
        if (!('FileSystemDB' in window)) {
          await import('/os/filesystem-db.js');
        }
        const FS = /** @type {any} */ (window).FileSystemDB;
        if (!FS) throw new Error('Filesystem unavailable.');
        return FS.getInstance();
      })();
    }
    return fsPromise;
  }
};

// -------------------- Rendering --------------------

function renderInitialHistory() {
  els.messages.replaceChildren();
  let hasVisible = false;

  for (const msg of history) {
    if (msg.role === 'user') {
      hasVisible = true;
      appendBubble('user', msg.content || '', /** @type {any} */ (msg).attachments);
      continue;
    }
    if (msg.role === 'assistant') {
      if (msg.content) {
        hasVisible = true;
        appendBubble('asst', msg.content);
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          hasVisible = true;
          appendToolCall(tc.id, tc.function?.name || '', tc.function?.arguments || '');
        }
      }
      continue;
    }
    if (msg.role === 'tool') {
      hasVisible = true;
      completeToolCall(msg.tool_call_id || '', msg.content || '');
    }
  }

  els.empty.hidden = hasVisible;
  scrollToBottom();
}

/**
 * @param {'user'|'asst'} who
 * @param {string} text
 * @param {Array<import('./document-loader.js').Attachment>} [attachments]
 * @returns {HTMLElement} the bubble element (caller can keep streaming into it)
 */
function appendBubble(who, text, attachments) {
  const li = document.createElement('li');
  li.className = `chat-msg chat-msg-${who}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (who === 'user') {
    if (Array.isArray(attachments) && attachments.length) {
      for (const a of attachments) {
        bubble.appendChild(buildAttachmentChip(a, { removable: false }));
      }
    }
    if (text) {
      const textNode = document.createElement('div');
      textNode.textContent = text;
      bubble.appendChild(textNode);
    }
  } else {
    bubble.innerHTML = renderMarkdown(text);
  }

  li.appendChild(bubble);
  els.messages.appendChild(li);
  els.empty.hidden = true;
  scrollToBottom();
  return bubble;
}

// -------------------- Attachment chips --------------------

/**
 * Build a chip element for one attachment. Used both in the composer
 * (where it's removable) and inside sent user bubbles (read-only).
 *
 * @param {import('./document-loader.js').Attachment & { _id?: string, _loading?: boolean }} a
 * @param {{ removable: boolean }} opts
 */
function buildAttachmentChip(a, opts) {
  const chip = document.createElement('span');
  chip.className = 'chat-attachment-chip';
  if (a._loading) chip.classList.add('chat-attachment-chip-loading');

  const emoji = document.createElement('span');
  emoji.className = 'chat-attachment-chip-emoji';
  emoji.setAttribute('aria-hidden', 'true');
  emoji.textContent = a.kind === 'pdf' ? '📕' : '📄';
  chip.appendChild(emoji);

  const name = document.createElement('span');
  name.className = 'chat-attachment-chip-name';
  name.textContent = a.name || 'document';
  name.title = a.name || '';
  chip.appendChild(name);

  const meta = document.createElement('span');
  meta.className = 'chat-attachment-chip-meta';
  meta.textContent = chipMeta(a);
  chip.appendChild(meta);

  if (opts.removable) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chat-attachment-chip-remove';
    remove.setAttribute('aria-label', `Remove ${a.name}`);
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      if (!a._id) return;
      pendingAttachments = pendingAttachments.filter((x) => x._id !== a._id);
      renderPendingAttachments();
    });
    chip.appendChild(remove);
  }

  return chip;
}

/**
 * @param {import('./document-loader.js').Attachment & { _loading?: boolean }} a
 */
function chipMeta(a) {
  if (a._loading) return 'parsing…';
  /** @type {string[]} */
  const bits = [];
  if (a.kind === 'pdf' && a.pages) bits.push(`${a.pages}p`);
  if (typeof a.size === 'number') {
    const fb = formatBytes(a.size);
    if (fb) bits.push(fb);
  }
  if (a.truncated) bits.push('truncated');
  return bits.length ? `· ${bits.join(' · ')}` : '';
}

function renderPendingAttachments() {
  if (!els.attachments) return;
  els.attachments.replaceChildren();
  if (pendingAttachments.length === 0) {
    els.attachments.hidden = true;
    return;
  }
  els.attachments.hidden = false;
  for (const a of pendingAttachments) {
    els.attachments.appendChild(buildAttachmentChip(a, { removable: true }));
  }
}

/**
 * Load a single dropped/selected file into a pending-attachment chip.
 * Shows a "parsing…" placeholder while extraction is in flight (PDFs
 * with hundreds of pages can take a beat).
 *
 * @param {File} file
 */
async function ingestFile(file) {
  if (!file) return;
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  /** @type {any} */
  const placeholder = {
    _id: id,
    _loading: true,
    name: file.name,
    kind: file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : 'text',
    size: file.size,
    truncated: false,
    content: ''
  };
  pendingAttachments.push(placeholder);
  renderPendingAttachments();

  try {
    const attachment = await loadDocument(file);
    const idx = pendingAttachments.findIndex((x) => x._id === id);
    if (idx === -1) return; // user removed it mid-parse
    /** @type {any} */
    const merged = { ...attachment, _id: id, _loading: false };
    pendingAttachments[idx] = merged;
    renderPendingAttachments();
    if (attachment.truncated) {
      notify(
        `Attached ${attachment.name} (truncated — only the first ${attachment.content.length.toLocaleString()} chars will be sent to the model).`,
        'warn'
      );
    } else {
      notify(`Attached ${attachment.name}.`, 'success');
    }
  } catch (err) {
    pendingAttachments = pendingAttachments.filter((x) => x._id !== id);
    renderPendingAttachments();
    const message = err && /** @type {Error} */ (err).message;
    notify(message || 'Could not read that file.', 'error');
  }
}

/**
 * Drag-and-drop wiring.
 *
 * Listening on `window` instead of the chat container so a file dragged
 * over any part of the viewport reveals the overlay (matches Slack /
 * Discord behavior). We use a counter rather than dragleave-on-target
 * because `dragleave` fires constantly as the cursor crosses child
 * elements, which makes the overlay flicker.
 */
function wireDragAndDrop() {
  let dragDepth = 0;

  /** @param {DragEvent} e */
  const isFileDrag = (e) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth += 1;
    if (els.dropOverlay) els.dropOverlay.hidden = false;
  });

  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && els.dropOverlay) els.dropOverlay.hidden = true;
  });

  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    if (els.dropOverlay) els.dropOverlay.hidden = true;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      void ingestFile(file);
    }
  });
}

/**
 * Append (or refresh) a tool-call collapsible row.
 * @param {string} id  — tool call id (used to find it later for completion)
 * @param {string} name
 * @param {string} argsRaw — JSON string of arguments
 */
function appendToolCall(id, name, argsRaw) {
  const existing = els.messages.querySelector(`[data-tool-id="${cssEscape(id)}"]`);
  if (existing) return /** @type {HTMLElement} */ (existing);

  const li = document.createElement('li');
  li.className = 'chat-msg chat-msg-tool';

  const details = document.createElement('details');
  details.className = 'chat-tool';
  details.dataset.toolId = id;

  const summary = document.createElement('summary');
  const nameSpan = document.createElement('span');
  nameSpan.className = 'chat-tool-name';
  nameSpan.textContent = `🔧 ${name || 'tool'}(${summarizeArgs(argsRaw)})`;
  const statusSpan = document.createElement('span');
  statusSpan.className = 'chat-tool-status';
  statusSpan.textContent = 'running…';
  summary.appendChild(nameSpan);
  summary.appendChild(statusSpan);
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'chat-tool-body';
  body.textContent = argsRaw ? `args: ${argsRaw}` : '(no arguments)';
  details.appendChild(body);

  li.appendChild(details);
  els.messages.appendChild(li);
  els.empty.hidden = true;
  scrollToBottom();
  return details;
}

function completeToolCall(id, resultJson) {
  const node = els.messages.querySelector(`[data-tool-id="${cssEscape(id)}"]`);
  if (!node) return;
  const status = node.querySelector('.chat-tool-status');
  const body = node.querySelector('.chat-tool-body');
  if (!status || !body) return;
  let parsed;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    parsed = null;
  }
  const ok = parsed && parsed.ok !== false;
  status.textContent = ok ? '✓' : '✗';
  status.classList.toggle('is-ok', ok);
  status.classList.toggle('is-err', !ok);
  body.textContent = resultJson;
}

function failToolCall(id, error) {
  const node = els.messages.querySelector(`[data-tool-id="${cssEscape(id)}"]`);
  if (!node) return;
  const status = node.querySelector('.chat-tool-status');
  const body = node.querySelector('.chat-tool-body');
  if (status) {
    status.textContent = '✗';
    status.classList.add('is-err');
  }
  if (body) body.textContent = error;
}

function summarizeArgs(argsRaw) {
  if (!argsRaw) return '';
  try {
    const parsed = JSON.parse(argsRaw);
    const keys = Object.keys(parsed);
    if (keys.length === 0) return '';
    const first = keys[0];
    const v = parsed[first];
    const preview = typeof v === 'string' ? v : JSON.stringify(v);
    const shown = preview.length > 30 ? `${preview.slice(0, 30)}…` : preview;
    return `${first}: ${shown}${keys.length > 1 ? ', …' : ''}`;
  } catch {
    return argsRaw.length > 30 ? `${argsRaw.slice(0, 30)}…` : argsRaw;
  }
}

function renderMarkdown(text) {
  const md = /** @type {any} */ (window).marked;
  const purify = /** @type {any} */ (window).DOMPurify;
  if (md && purify) {
    try {
      const rendered = md.parse(text, { breaks: true, gfm: true });
      return purify.sanitize(rendered);
    } catch {
      /* fall through to plain */
    }
  }
  const el = document.createElement('div');
  el.textContent = text;
  return el.innerHTML.replace(/\n/g, '<br>');
}

function scrollToBottom() {
  els.scroll.scrollTop = els.scroll.scrollHeight;
}

function cssEscape(s) {
  return s.replace(/["\\]/g, '\\$&');
}

// -------------------- Model lifecycle --------------------

/**
 * Cached GPU label (e.g. "Intel" / "NVIDIA"). Populated once the model
 * has loaded — the label is appended to the mode line so the user can
 * see which GPU is doing the inference (and notice when a fast dGPU
 * is being passed over for a slow iGPU).
 *
 * @type {string}
 */
let gpuLabel = '';

/** @param {'unsupported'|'loading'|null} [state] @param {string} [detail] */
function refreshModeLine(state, detail) {
  if (state === 'unsupported') {
    els.modeLine.textContent = 'WebGPU not available';
    return;
  }
  if (state === 'loading') {
    els.modeLine.textContent = detail ? `Loading model · ${detail}` : 'Loading model…';
    return;
  }
  const modelLabel = WEBLLM_DEFAULT_MODEL.replace('-MLC', '');
  if (isWebLlmReady()) {
    const gpuSuffix = gpuLabel ? ` · GPU: ${gpuLabel}` : '';
    els.modeLine.textContent = `Local · ${modelLabel}${gpuSuffix}`;
    return;
  }
  els.modeLine.textContent = `Local · ${WEBLLM_DEFAULT_MODEL_SIZE} install required`;
}

/** Show either the install CTA or the regular suggestion content. */
function setInstallCardVisible(visible) {
  if (els.install) els.install.hidden = !visible;
  if (els.emptyDefault) els.emptyDefault.hidden = visible;
}

/**
 * Make sure the WebLLM engine is initialized.
 *
 * Two modes:
 *   - silent=true: returning-visitor path. No confirm dialog, no
 *     progress modal. Progress shows inline in the mode line. Used at
 *     boot when `hasInstalledModel()` says we've done this before.
 *   - silent=false: explicit-install path. Confirm dialog → progress
 *     modal. Used when the user clicks the Install button or sends a
 *     first message before installing.
 *
 * Concurrent callers (e.g. the user mashing send while boot init is
 * still running) share the same in-flight promise rather than racing.
 *
 * @param {{ silent?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
function ensureModelReady(opts = {}) {
  if (isWebLlmReady()) return Promise.resolve(true);
  if (modelReadyPromise) return modelReadyPromise;

  const silent = !!opts.silent;
  modelReadyPromise = (async () => {
    if (!silent) {
      const confirmed = await confirmDownload();
      if (!confirmed) return false;
    }

    refreshModeLine('loading');
    const progress = silent ? null : openDownloadDialog();
    const installBtnWasDisabled = els.installBtn?.disabled;
    if (els.installBtn) els.installBtn.disabled = true;

    try {
      await initWebLlm((report) => {
        if (progress) {
          progress.update(report.progress, report.text);
        } else {
          refreshModeLine('loading', report.text);
        }
      });
      markModelInstalled();
      setInstallCardVisible(false);
      progress?.close();
      // Fire-and-forget GPU probe — populates the mode line with the
      // active adapter and warns the user if they're on an iGPU while
      // a dGPU is available (classic Windows-hybrid-graphics gotcha).
      void identifyAndAnnounceGpu();
      if (!silent) notify('Local chat is ready.', 'success');
      refreshModeLine();
      return true;
    } catch (err) {
      progress?.close();
      const message = err && /** @type {Error} */ (err).message;
      // Silent init only fails when the cache is gone / WebGPU misbehaving;
      // fall back to the visible Install CTA so the user can retry deliberately.
      clearModelInstalledFlag();
      setInstallCardVisible(true);
      if (els.installBtn) els.installBtn.disabled = installBtnWasDisabled ?? false;
      if (silent) {
        notify(`Couldn't load the model from cache. Try installing again.`, 'warn');
      } else {
        notify(`Could not load the local model: ${message || err}`, 'error');
      }
      refreshModeLine();
      return false;
    } finally {
      modelReadyPromise = null;
    }
  })();
  return modelReadyPromise;
}

/**
 * Probe the WebGPU adapters once the model is ready and surface the
 * active GPU in the mode line. On Windows laptops with hybrid graphics
 * the default adapter is almost always the iGPU even when a much
 * faster dGPU exists — pop a one-time notice with actionable advice
 * so the user knows they're leaving 5-10× of perf on the table.
 */
async function identifyAndAnnounceGpu() {
  try {
    const adapters = await probeAdapters();
    console.log('[chat:webgpu] adapters', adapters);
    if (adapters.defaultAdapter) {
      gpuLabel = adapters.defaultAdapter.label;
      refreshModeLine();
    }
    if (adapters.hybridGraphics && adapters.defaultAdapter?.likelyIntegrated) {
      const slow = adapters.defaultAdapter.label;
      const fast =
        adapters.highPerformanceAdapter?.label || 'a discrete GPU';
      notify(
        `Inference is running on ${slow}. A faster ${fast} is available — set Chrome's graphics preference to "High performance" in Windows Display settings to use it (~5-10× faster).`,
        'warn'
      );
    }
  } catch (err) {
    console.warn('[chat:webgpu] adapter probe failed', err);
  }
}

// -------------------- Sending --------------------

async function send(text) {
  const trimmed = text.trim();
  // Allow sending with no typed text when there's an attachment — drop
  // a PDF, hit Enter, and we default to "Analyze this document." so
  // the model has *some* instruction beyond the raw content.
  const readyAttachments = pendingAttachments.filter((a) => !a._loading);
  const stillParsing = pendingAttachments.some((a) => a._loading);

  if (stillParsing) {
    notify('Still parsing a document — try again in a moment.', 'warn');
    return;
  }
  if (!trimmed && readyAttachments.length === 0) return;
  if (currentTurn) return;

  if (!isWebGpuSupported()) {
    notify('WebGPU is required to chat. See the banner above for browser options.', 'error');
    return;
  }

  // Make sure the model is loaded before showing the user bubble. If
  // they cancel the download, we don't want to leave their message
  // hanging in the conversation with no reply.
  const ready = await ensureModelReady();
  if (!ready) return;

  const finalText = trimmed || (readyAttachments.length ? 'Analyze this document.' : '');

  // Snapshot the attachments and clear the composer state before the
  // turn kicks off — the user should see them disappear from the input
  // as soon as they hit send, like every other chat app.
  /** @type {Array<import('./document-loader.js').Attachment>} */
  const sendAttachments = readyAttachments.map((a) => {
    // Drop the internal `_id` / `_loading` keys before handing off.
    const { _id, _loading, ...rest } = /** @type {any} */ (a);
    return rest;
  });
  pendingAttachments = [];
  renderPendingAttachments();

  els.input.value = '';
  autoResize();

  appendBubble('user', finalText, sendAttachments);

  currentTurn = new AbortController();
  els.send.hidden = true;
  els.stop.hidden = false;
  els.input.disabled = true;

  /** @type {HTMLElement | null} */
  let streamingBubble = null;
  let cursor = /** @type {HTMLElement | null} */ (null);

  function ensureBubble() {
    if (!streamingBubble) {
      streamingBubble = appendBubble('asst', '');
      cursor = document.createElement('span');
      cursor.className = 'chat-cursor';
      streamingBubble.appendChild(cursor);
    }
    return streamingBubble;
  }

  let assistantBuffer = '';

  try {
    await runChatTurn({
      history,
      userText: finalText,
      attachments: sendAttachments,
      toolCtx,
      signal: currentTurn.signal,
      onAssistantMessageStart: () => {
        streamingBubble = null;
        assistantBuffer = '';
      },
      onAssistantDelta: ({ content }) => {
        if (!content) return;
        assistantBuffer += content;
        const bubble = ensureBubble();
        bubble.innerHTML = renderMarkdown(assistantBuffer);
        const c = document.createElement('span');
        c.className = 'chat-cursor';
        bubble.appendChild(c);
        cursor = c;
        scrollToBottom();
      },
      onAssistantMessageEnd: () => {
        if (cursor && cursor.parentNode) cursor.parentNode.removeChild(cursor);
        cursor = null;
        // Drop the empty bubble when the assistant produced only tool
        // calls in this iteration.
        if (streamingBubble && !assistantBuffer) {
          streamingBubble.parentElement?.remove();
        }
        streamingBubble = null;
      },
      onAssistantTextRetracted: () => {
        // Recovery path: the model wrote a tool call as text and the
        // chat client extracted it into a real tool call. Throw away
        // the pseudo-call text bubble so the user only sees the tool
        // card + the next iteration's natural-language summary.
        if (streamingBubble) {
          streamingBubble.parentElement?.remove();
          streamingBubble = null;
        }
        assistantBuffer = '';
      },
      onToolEvent: (evt) => {
        if (evt.phase === 'started') {
          appendToolCall(evt.id, evt.name, evt.argumentsRaw || '');
        } else if (evt.phase === 'completed') {
          completeToolCall(evt.id, evt.resultPreview || '');
        } else if (evt.phase === 'failed') {
          failToolCall(evt.id, evt.error || 'tool failed');
        }
      }
    });

    saveHistory(history);
  } catch (err) {
    if (cursor && cursor.parentNode) cursor.parentNode.removeChild(cursor);
    if (err && /** @type {any} */ (err).name === 'AbortError') {
      notify('Stopped.', 'warn');
    } else {
      const message = /** @type {any} */ (err)?.message || String(err);
      notify(`Chat failed: ${message}`, 'error');
      appendBubble('asst', `_Error: ${message}_`);
    }
  } finally {
    currentTurn = null;
    els.send.hidden = false;
    els.stop.hidden = true;
    els.input.disabled = false;
    els.input.focus();
  }
}

// -------------------- Modal dialogs --------------------

function confirmDownload() {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'chat-modal';
    modal.innerHTML = `
      <div class="chat-modal-box" role="dialog" aria-modal="true">
        <h2>One-time setup</h2>
        <p>This chat runs entirely on your device — no backend, no API key. To do that, your browser needs to download a small language model (${WEBLLM_DEFAULT_MODEL_SIZE}) and cache it for future visits.</p>
        <p>After the download, chat is instant and works offline.</p>
        <div class="chat-modal-actions">
          <button type="button" data-action="cancel">Not now</button>
          <button type="button" class="chat-modal-primary" data-action="ok">Download &amp; chat</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const action = target.getAttribute('data-action');
      if (action === 'ok' || action === 'cancel' || target === modal) {
        modal.remove();
        resolve(action === 'ok');
      }
    });
  });
}

function openDownloadDialog() {
  const modal = document.createElement('div');
  modal.className = 'chat-modal';
  modal.innerHTML = `
    <div class="chat-modal-box" role="dialog" aria-modal="true">
      <h2>Loading model…</h2>
      <p data-role="status">Initializing…</p>
      <div class="chat-modal-progress"><div class="chat-modal-progress-bar"></div></div>
      <p class="chat-modal-hint">First load only. Future chats start instantly.</p>
    </div>`;
  document.body.appendChild(modal);
  const statusEl = /** @type {HTMLElement} */ (modal.querySelector('[data-role="status"]'));
  const barEl = /** @type {HTMLElement} */ (modal.querySelector('.chat-modal-progress-bar'));
  return {
    update(progress, text) {
      if (statusEl) statusEl.textContent = text || 'Loading…';
      if (barEl) barEl.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    },
    close() {
      modal.remove();
    }
  };
}

// -------------------- Boot --------------------

function autoResize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 200)}px`;
}

function wireEvents() {
  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    if (currentTurn) return;
    void send(els.input.value);
  });

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(els.input.value);
    }
  });

  els.input.addEventListener('input', autoResize);

  els.stop.addEventListener('click', () => {
    if (currentTurn) {
      currentTurn.abort();
    }
  });

  els.newBtn.addEventListener('click', () => {
    if (currentTurn) currentTurn.abort();
    history = [];
    clearHistory();
    renderInitialHistory();
    notify('Started a new conversation.', 'info');
    els.input.focus();
  });

  // Suggestion buttons in the empty state.
  els.empty.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.tagName === 'BUTTON' && target.dataset.prompt) {
      els.input.value = target.dataset.prompt;
      autoResize();
      els.input.focus();
    }
  });

  // Explicit Install button on the empty-state CTA.
  els.installBtn?.addEventListener('click', () => {
    void ensureModelReady({ silent: false });
  });

  // Dev hot-reload: re-fetch the logic scripts (chat-client, tools,
  // system-prompt, storage) with a cache-bust query so code changes
  // take effect without dropping the WebLLM engine.
  els.reloadBtn?.addEventListener('click', () => {
    void refreshScripts();
  });

  // Paperclip → native file picker. Same handler as drag/drop.
  els.attachBtn?.addEventListener('click', () => {
    els.attachInput?.click();
  });
  els.attachInput?.addEventListener('change', () => {
    const files = els.attachInput.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      void ingestFile(file);
    }
    els.attachInput.value = '';
  });

  wireDragAndDrop();
}

async function refreshScripts() {
  if (currentTurn) currentTurn.abort();
  if (els.reloadBtn) {
    els.reloadBtn.disabled = true;
    els.reloadBtn.textContent = 'Reloading…';
  }
  scriptsCacheBust = `?t=${Date.now()}`;
  try {
    await loadDynamicModules();
    notify('Scripts reloaded.', 'success');
  } catch (err) {
    const message = err && /** @type {Error} */ (err).message;
    notify(`Reload failed: ${message || err}`, 'error');
  } finally {
    if (els.reloadBtn) {
      els.reloadBtn.disabled = false;
      els.reloadBtn.textContent = '🔄 Reload';
    }
  }
}

/**
 * @param {{ reason?: string, detail?: string, userAgent?: string, inIframe?: boolean, secureContext?: boolean, origin?: string }} [probe]
 */
function showWebGpuGate(probe) {
  els.unsupported.hidden = false;
  const detailEl = els.unsupported.querySelector('[data-role="detail"]');
  if (detailEl && probe?.detail) {
    detailEl.textContent = probe.detail;
    /** @type {HTMLElement} */ (detailEl).hidden = false;
  }
  const envEl = els.unsupported.querySelector('[data-role="env"]');
  if (envEl && probe) {
    const bits = [];
    if (probe.origin) bits.push(`origin: ${probe.origin}`);
    if (typeof probe.secureContext === 'boolean') {
      bits.push(`secureContext: ${probe.secureContext}`);
    }
    if (typeof probe.inIframe === 'boolean') {
      bits.push(`inIframe: ${probe.inIframe}`);
    }
    if (probe.userAgent) bits.push(`UA: ${probe.userAgent}`);
    envEl.textContent = bits.join(' · ');
    /** @type {HTMLElement} */ (envEl).hidden = bits.length === 0;
  }
  els.input.disabled = true;
  els.input.placeholder = 'WebGPU required — see banner above.';
  els.send.disabled = true;
  if (els.attachBtn) els.attachBtn.disabled = true;
  refreshModeLine('unsupported');
}

async function boot() {
  await loadDynamicModules();
  history = loadHistory();
  renderInitialHistory();
  wireEvents();
  autoResize();

  const probe = await probeWebGpu();
  console.log('[chat:webgpu] probe', probe);
  if (!probe.ok) {
    showWebGpuGate(probe);
    return;
  }
  refreshModeLine();

  if (hasInstalledModel()) {
    // Returning visitor: silently warm the engine from the OPFS cache
    // so their first message doesn't pay the load latency.
    setInstallCardVisible(false);
    void ensureModelReady({ silent: true });
  } else {
    // First visit: show the explicit Install CTA in the empty state.
    setInstallCardVisible(true);
  }
}

void boot();
