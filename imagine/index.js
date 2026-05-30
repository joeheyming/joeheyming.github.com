/**
 * Imagine app entry point — wires the DOM to the local diffusion
 * engine.
 *
 * Architecture: 100% client-side. SD-Turbo runs in the visitor's
 * browser via WebGPU + onnxruntime-web (wrapped through web-txt2img).
 * No backend, no API key, no third-party endpoint. The page gates
 * entry on WebGPU support; the model is downloaded lazily on the
 * user's explicit Install (or first generate), not on page load.
 */

import { createOSEmbed } from '/os-embed.js';
import { createNotifier } from '/notifications.js';
import {
  isWebGpuSupported,
  isEngineReady,
  initEngine,
  generateImage,
  probeWebGpu,
  IMAGINE_DEFAULT_MODEL,
  IMAGINE_DEFAULT_MODEL_SIZE,
  IMAGE_MODELS
} from './diffusion-adapter.js';
import {
  loadHistory,
  pushHistory,
  blobToThumbDataUrl,
  hasInstalledModel,
  markModelInstalled,
  clearModelInstalledFlag,
  cacheFullImage,
  loadFullImage,
  removeHistoryItem,
  clearAllHistory,
  loadSelectedModel,
  saveSelectedModel
} from './storage.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const els = {
  app: $('imagine-app'),
  main: $('imagine-main'),
  modeLine: $('imagine-mode-line'),
  unsupported: $('imagine-unsupported'),
  unsupportedDetail: /** @type {HTMLElement} */ (
    document.querySelector('#imagine-unsupported [data-role="detail"]')
  ),
  install: $('imagine-install'),
  installBtn: /** @type {HTMLButtonElement} */ ($('imagine-install-btn')),
  outputEmpty: $('imagine-output-empty'),
  current: $('imagine-current'),
  currentImg: /** @type {HTMLImageElement} */ ($('imagine-current-img')),
  currentCaption: $('imagine-current-caption'),
  progressOverlay: $('imagine-progress-overlay'),
  progressFill: $('imagine-progress-fill'),
  progressText: $('imagine-progress-text'),
  downloadBtn: /** @type {HTMLButtonElement} */ ($('imagine-download-btn')),
  reuseBtn: /** @type {HTMLButtonElement} */ ($('imagine-reuse-btn')),
  history: $('imagine-history'),
  historyList: $('imagine-history-list'),
  historyClearAll: /** @type {HTMLButtonElement} */ ($('imagine-history-clear-all')),
  composer: /** @type {HTMLFormElement} */ ($('imagine-composer')),
  prompt: /** @type {HTMLTextAreaElement} */ ($('imagine-prompt')),
  seed: /** @type {HTMLInputElement} */ ($('imagine-seed')),
  seedRandom: /** @type {HTMLButtonElement} */ ($('imagine-seed-random')),
  generateBtn: /** @type {HTMLButtonElement} */ ($('imagine-generate-btn')),
  generateRandomBtn: /** @type {HTMLButtonElement} */ ($('imagine-generate-random-btn')),
  stopBtn: /** @type {HTMLButtonElement} */ ($('imagine-stop-btn')),
  model: /** @type {HTMLSelectElement} */ ($('imagine-model')),
  installTitle: $('imagine-install-title'),
  installBody: $('imagine-install-body'),
  toasts: $('imagine-toasts')
};

const localNotifier = createNotifier({
  container: els.toasts,
  kindClass: (k) => `notify notify-${k}`,
  defaultDurationMs: 3500,
  dismissible: true
});

const embed = createOSEmbed({
  app: 'imagine',
  title: 'Open in Imagine',
  notifier: localNotifier
});

const notify = (message, kind = 'info') => embed.notify(message, { kind });

// -------------------- State --------------------

/** @type {AbortController | null} */
let currentTurn = null;

/**
 * Most recently generated result (full-resolution, in memory only).
 * Lost on reload — only the thumbnail in localStorage survives.
 *
 * @type {{ blob: Blob, url: string, prompt: string, seed: number } | null}
 */
let currentResult = null;

/** Held URLs for revoke-on-replace. */
let currentImgObjectUrl = '';

/**
 * The user's currently-selected text-to-image model. Persisted to
 * localStorage and read back on boot. Defaults to SD-Turbo for
 * first-time visitors. Switching models updates the install card,
 * picker, and ensureEngineReady target — but doesn't trigger a
 * download until the user clicks Generate or Install.
 */
let selectedModelId = IMAGINE_DEFAULT_MODEL;

/**
 * In-flight engine-ready promise. Concurrent callers (e.g. install
 * button + auto-generate) share it instead of racing.
 *
 * @type {Promise<boolean> | null}
 */
let engineReadyPromise = null;

// -------------------- Mode line --------------------

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
  const info = IMAGE_MODELS[selectedModelId] || IMAGE_MODELS[IMAGINE_DEFAULT_MODEL];
  if (isEngineReady(selectedModelId)) {
    els.modeLine.textContent = `Local · ${info.label}`;
    return;
  }
  els.modeLine.textContent = `Local · ${info.label} (${info.sizeLabel}) — install required`;
}

function setInstallCardVisible(visible) {
  if (els.install) els.install.hidden = !visible;
}

/**
 * Re-render the install card copy + the install/Generate gating
 * for whichever model is currently selected. Called once at boot
 * (after the picker is initialized) and again every time the user
 * changes the picker.
 *
 * Important: switching models doesn't trigger a download. It just
 * tells the gating which engine should be ready next time the user
 * hits Generate. If the selected model is already installed, we
 * silently re-init it; if not, we surface the install card.
 */
function applySelectedModel() {
  const info = IMAGE_MODELS[selectedModelId] || IMAGE_MODELS[IMAGINE_DEFAULT_MODEL];

  if (els.installTitle) {
    els.installTitle.textContent = `Install ${info.label}`;
  }
  if (els.installBody) {
    // Build innerHTML so we can keep the bold model-name styling
    // without parsing the whole sentence into spans.
    const safeLabel = escapeHtml(info.label);
    const safeSize = escapeHtml(info.sizeLabel);
    const safeSpeed = escapeHtml(info.speedHint);
    const safeDesc = escapeHtml(info.description);
    els.installBody.innerHTML =
      `${safeDesc} The full model runs on your GPU — no backend, no API key. ` +
      `Install adds <strong>${safeLabel}</strong> (${safeSize}) to your browser cache; ` +
      `generation takes ${safeSpeed} after that.`;
  }
  if (els.installBtn) {
    els.installBtn.textContent = `Install ${info.label} (${info.sizeLabel})`;
  }

  refreshModeLine();

  // If we're already on the right engine, just refresh copy and bail.
  if (isEngineReady(selectedModelId)) {
    setInstallCardVisible(false);
    return;
  }

  // Selected model is installed before — silently re-init it (the
  // weights are cached; this is fast).
  if (hasInstalledModel(selectedModelId)) {
    setInstallCardVisible(false);
    void ensureEngineReady({ silent: true });
    return;
  }

  // Cold model — show the install card.
  setInstallCardVisible(true);
}

/**
 * Tiny HTML escape used for model-name interpolation in the install
 * card. Not loaded as a generic template — just enough to be safe
 * against the (currently static) labels in IMAGE_MODELS.
 *
 * @param {string} s
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -------------------- Engine readiness --------------------

/**
 * Make sure the diffusion engine is initialized.
 *
 * silent=true: returning-visitor path. Inline progress in the mode
 * line, no modal.
 * silent=false: explicit-install path with the confirm + progress
 * dialogs.
 *
 * @param {{ silent?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
function ensureEngineReady(opts = {}) {
  const targetModel = opts.modelId || selectedModelId;
  if (isEngineReady(targetModel)) return Promise.resolve(true);
  if (engineReadyPromise) return engineReadyPromise;

  const silent = !!opts.silent;
  engineReadyPromise = (async () => {
    const info = IMAGE_MODELS[targetModel] || IMAGE_MODELS[IMAGINE_DEFAULT_MODEL];
    if (!silent) {
      const confirmed = await confirmDownload({
        title: `Install ${info.label}`,
        body:
          `One-time download of ${info.label} (${info.sizeLabel}). It runs on your device — no ` +
          `backend, no API key. ${info.description} ${info.speedHint}.`,
        primary: `Download (${info.sizeLabel})`
      });
      if (!confirmed) return false;
    }

    refreshModeLine('loading');
    const progress = silent ? null : openDownloadDialog(`Loading ${info.label}…`);
    const installBtnWasDisabled = els.installBtn?.disabled;
    if (els.installBtn) els.installBtn.disabled = true;

    try {
      await initEngine((report) => {
        if (progress) {
          progress.update(report.progress, report.text);
        } else {
          refreshModeLine('loading', report.text);
        }
      }, targetModel);
      markModelInstalled(targetModel);
      setInstallCardVisible(false);
      progress?.close();
      if (!silent) notify(`${info.label} is ready.`, 'success');
      refreshModeLine();
      return true;
    } catch (err) {
      progress?.close();
      const message = err && /** @type {Error} */ (err).message;
      clearModelInstalledFlag(targetModel);
      setInstallCardVisible(true);
      if (els.installBtn) els.installBtn.disabled = installBtnWasDisabled ?? false;
      if (silent) {
        notify(`Couldn't load ${info.label} from cache. Try installing again.`, 'warn');
      } else {
        notify(`Could not load ${info.label}: ${message || err}`, 'error');
      }
      refreshModeLine();
      return false;
    } finally {
      engineReadyPromise = null;
    }
  })();
  return engineReadyPromise;
}

// -------------------- Generation --------------------

/**
 * Run a single generation turn. Disables the composer for the
 * duration, paints the in-canvas progress overlay, and stores the
 * result in `currentResult` / appends a history entry.
 *
 * @param {string} prompt
 * @param {number | null} seed  null → random per turn
 */
async function generateTurn(prompt, seed) {
  if (currentTurn) return;
  if (!isWebGpuSupported()) {
    notify('WebGPU is required to generate images. See the banner above.', 'error');
    return;
  }

  const ready = await ensureEngineReady();
  if (!ready) return;

  currentTurn = new AbortController();
  setComposerBusy(true);
  showCurrentFrame();
  setProgress(0, 'Preparing…');

  try {
    const result = await generateImage({
      prompt,
      seed: typeof seed === 'number' ? seed : undefined,
      signal: currentTurn.signal,
      onProgress: ({ progress, text }) => setProgress(progress, text)
    });

    setCurrentImage(result);
    notify(`Generated in ${formatSeconds(result.timeMs)}s`, 'success');

    try {
      const thumbDataUrl = await blobToThumbDataUrl(result.blob);
      const entryId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pushHistory({
        id: entryId,
        prompt: result.prompt,
        seed: result.seed,
        thumbDataUrl,
        createdAt: Date.now()
      });
      // Stash the full PNG in Cache Storage so the history click
      // handler can show it at full size later. Fire-and-forget;
      // failures are logged inside cacheFullImage and don't affect
      // the in-memory currentResult.
      void cacheFullImage(entryId, result.blob);
      renderHistory();
    } catch (err) {
      console.warn('[imagine:history] could not store thumbnail', err);
    }
  } catch (err) {
    if (err && /** @type {any} */ (err).name === 'AbortError') {
      notify('Stopped.', 'warn');
    } else {
      const message = /** @type {any} */ (err)?.message || String(err);
      notify(`Generation failed: ${message}`, 'error');
      console.error('[imagine:gen] failed', err);
    }
    if (!currentResult) hideCurrentFrame();
  } finally {
    currentTurn = null;
    setComposerBusy(false);
    hideProgressOverlay();
  }
}

function setComposerBusy(busy) {
  els.generateBtn.hidden = busy;
  els.generateRandomBtn.hidden = busy;
  els.stopBtn.hidden = !busy;
  els.prompt.disabled = busy;
  els.seed.disabled = busy;
  els.seedRandom.disabled = busy;
  els.model.disabled = busy;
  els.installBtn.disabled = busy;
}

// -------------------- Output rendering --------------------

function showCurrentFrame() {
  els.outputEmpty.hidden = true;
  els.current.hidden = false;
  showProgressOverlay();
}

function hideCurrentFrame() {
  els.current.hidden = true;
  els.outputEmpty.hidden = false;
}

function showProgressOverlay() {
  if (els.progressOverlay) els.progressOverlay.hidden = false;
}

function hideProgressOverlay() {
  if (els.progressOverlay) els.progressOverlay.hidden = true;
}

function setProgress(progress, text) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  if (els.progressFill) els.progressFill.style.width = `${pct.toFixed(1)}%`;
  if (els.progressText) els.progressText.textContent = text || 'Generating…';
}

/**
 * @param {{ url: string, prompt: string, seed: number, blob: Blob }} result
 */
function setCurrentImage(result) {
  if (currentImgObjectUrl) {
    URL.revokeObjectURL(currentImgObjectUrl);
  }
  currentImgObjectUrl = result.url;
  currentResult = result;
  els.currentImg.src = result.url;
  els.currentImg.alt = result.prompt;
  els.currentCaption.textContent = `"${result.prompt}" — seed ${result.seed}`;
  hideProgressOverlay();
}

// -------------------- History --------------------

function renderHistory() {
  const entries = loadHistory();
  if (entries.length === 0) {
    els.history.hidden = true;
    return;
  }
  els.history.hidden = false;
  els.historyList.replaceChildren();
  for (const entry of entries) {
    // Each cell holds two siblings: the thumbnail-as-button and a
    // small delete-X button overlaid in the corner. They can't nest
    // (HTML disallows button-in-button) so the <li> is the
    // positioning context.
    const li = document.createElement('li');
    li.className = 'imagine-history-cell';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'imagine-history-item';
    btn.title = `${entry.prompt} (seed ${entry.seed})`;
    btn.addEventListener('click', () => {
      void loadFromHistory(entry);
    });

    const img = document.createElement('img');
    img.src = entry.thumbDataUrl;
    img.alt = entry.prompt;
    img.loading = 'lazy';
    btn.appendChild(img);

    const promptLabel = document.createElement('span');
    promptLabel.className = 'imagine-history-item-prompt';
    promptLabel.textContent = entry.prompt;
    btn.appendChild(promptLabel);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'imagine-history-delete';
    del.setAttribute('aria-label', `Remove "${entry.prompt}" from history`);
    del.title = 'Remove from history';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromHistory(entry);
    });

    li.appendChild(btn);
    li.appendChild(del);
    els.historyList.appendChild(li);
  }
}

/**
 * Remove a history entry (and its cached full image) and re-render.
 * If the deleted entry was what the canvas is currently displaying,
 * clear the canvas back to the empty state so the user isn't looking
 * at a ghost of something that no longer exists in their history.
 *
 * @param {import('./storage.js').HistoryEntry} entry
 */
function removeFromHistory(entry) {
  removeHistoryItem(entry.id);

  if (currentResult && currentResult.prompt === entry.prompt && currentResult.seed === entry.seed) {
    if (currentImgObjectUrl) {
      URL.revokeObjectURL(currentImgObjectUrl);
      currentImgObjectUrl = '';
    }
    currentResult = null;
    els.currentImg.removeAttribute('src');
    els.currentImg.alt = '';
    els.currentCaption.textContent = '';
    hideCurrentFrame();
  }

  renderHistory();
}

/**
 * Wipe the entire Recent strip: removes every history entry from
 * localStorage and every cached full-resolution image from Cache
 * Storage. Confirms first because this is destructive and not
 * undoable. If the canvas is currently showing one of the soon-to-
 * be-cleared entries, blank it back to the empty state.
 */
async function doClearAllHistory() {
  const entries = loadHistory();
  if (entries.length === 0) return;
  const confirmed = await confirmDownload({
    title: 'Clear all recent images?',
    body:
      `This removes ${entries.length} item${entries.length === 1 ? '' : 's'} from your Recent ` +
      `strip and deletes their cached full-resolution PNGs from this browser. The model itself ` +
      `stays installed.`,
    primary: 'Clear all'
  });
  if (!confirmed) return;
  clearAllHistory();
  if (currentResult) {
    if (currentImgObjectUrl) {
      URL.revokeObjectURL(currentImgObjectUrl);
      currentImgObjectUrl = '';
    }
    currentResult = null;
    els.currentImg.removeAttribute('src');
    els.currentImg.alt = '';
    els.currentCaption.textContent = '';
    hideCurrentFrame();
  }
  renderHistory();
  notify('Recent images cleared.', 'success');
}

/**
 * Restore a past generation: fill the composer with prompt + seed,
 * and (when available) display the full-resolution PNG from Cache
 * Storage in the main canvas. Falls back to the localStorage
 * thumbnail for entries created before the cache existed; in that
 * case the caption hints that the user can regenerate to get a
 * crisp version.
 *
 * Don't trigger a generation here — clicking history is for review
 * and remix, not "redo". The user hits Generate when they want a
 * fresh render.
 *
 * @param {import('./storage.js').HistoryEntry} entry
 */
async function loadFromHistory(entry) {
  if (currentTurn) return; // don't disrupt an in-flight generation

  els.prompt.value = entry.prompt;
  els.seed.value = String(entry.seed);
  autoResize();

  els.outputEmpty.hidden = true;
  els.current.hidden = false;
  hideProgressOverlay();

  const blob = await loadFullImage(entry.id);
  if (blob) {
    const url = URL.createObjectURL(blob);
    setCurrentImage({ blob, url, prompt: entry.prompt, seed: entry.seed });
    return;
  }

  // No cached full image — display the upscaled thumbnail. We don't
  // assign a downloadable currentResult here because handing the
  // user back a 96px JPEG would be misleading; the reuse path still
  // works because prompt + seed are populated above.
  if (currentImgObjectUrl) {
    URL.revokeObjectURL(currentImgObjectUrl);
    currentImgObjectUrl = '';
  }
  currentResult = null;
  els.currentImg.src = entry.thumbDataUrl;
  els.currentImg.alt = entry.prompt;
  els.currentCaption.textContent = `"${entry.prompt}" — seed ${entry.seed} · regenerate for full quality`;
}

// -------------------- Modal dialogs ----------------
// Same shape as chat/'s dialogs but with imagine- classes so the two
// apps can diverge styling later without tripping over each other.

/**
 * @param {{ title?: string, body?: string, primary?: string }} [opts]
 */
function confirmDownload(opts = {}) {
  const title = opts.title || 'One-time setup';
  const body =
    opts.body ||
    `This generator runs entirely on your device — no backend, no API key. To do that, your browser needs to download the SD-Turbo model (${IMAGINE_DEFAULT_MODEL_SIZE}) and cache it for future visits. After the download, generation takes 1–5 seconds per image and works offline.`;
  const primary = opts.primary || 'Download & generate';
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'imagine-modal';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const para = document.createElement('p');
    para.textContent = body;
    const actions = document.createElement('div');
    actions.className = 'imagine-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.action = 'cancel';
    cancel.textContent = 'Not now';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'imagine-modal-primary';
    ok.dataset.action = 'ok';
    ok.textContent = primary;
    actions.append(cancel, ok);
    const box = document.createElement('div');
    box.className = 'imagine-modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.append(heading, para, actions);
    modal.appendChild(box);
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

/**
 * @param {string} [title]
 */
function openDownloadDialog(title = 'Loading model…') {
  const modal = document.createElement('div');
  modal.className = 'imagine-modal';
  modal.innerHTML = `
    <div class="imagine-modal-box" role="dialog" aria-modal="true">
      <h2></h2>
      <p data-role="status">Initializing…</p>
      <div class="imagine-modal-progress"><div class="imagine-modal-progress-bar"></div></div>
      <p class="imagine-modal-hint">First load only. Future runs start instantly.</p>
    </div>`;
  /** @type {HTMLHeadingElement | null} */
  const headingEl = modal.querySelector('h2');
  if (headingEl) headingEl.textContent = title;
  document.body.appendChild(modal);
  const statusEl = /** @type {HTMLElement} */ (modal.querySelector('[data-role="status"]'));
  const barEl = /** @type {HTMLElement} */ (modal.querySelector('.imagine-modal-progress-bar'));
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

// -------------------- Helpers --------------------

function autoResize() {
  els.prompt.style.height = 'auto';
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 160)}px`;
}

function formatSeconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0';
  return (ms / 1000).toFixed(1);
}

function readSeedFromInput() {
  const raw = els.seed.value.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n) >>> 0;
}

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// -------------------- Boot --------------------

async function checkWebGpuOrFail() {
  if (isWebGpuSupported()) {
    const probe = await probeWebGpu();
    if (probe.ok) return true;
    showUnsupported(probe.detail);
    return false;
  }
  const probe = await probeWebGpu();
  showUnsupported(probe.detail);
  return false;
}

function showUnsupported(detail) {
  els.unsupported.hidden = false;
  if (detail && els.unsupportedDetail) {
    els.unsupportedDetail.textContent = detail;
    els.unsupportedDetail.hidden = false;
  }
  refreshModeLine('unsupported');
  // Disable the composer entirely — there's no path forward.
  els.prompt.disabled = true;
  els.generateBtn.disabled = true;
  els.installBtn.disabled = true;
  // Generate Random shares the WebGPU dependency.
  els.generateRandomBtn.disabled = true;
  els.model.disabled = true;
}

/**
 * Shared body for both Generate buttons. The plain Generate button
 * uses whatever is currently in the seed input (manual or sticky
 * from a prior 🎲 click); Generate Random stamps a fresh seed in
 * first so each click yields a different image without the user
 * having to bounce off the dice button.
 *
 * @param {{ randomizeSeed?: boolean }} [opts]
 */
function submitGenerate(opts = {}) {
  if (currentTurn) return;
  const prompt = els.prompt.value.trim();
  if (!prompt) {
    notify('Type a prompt first.', 'warn');
    els.prompt.focus();
    return;
  }
  if (opts.randomizeSeed) {
    els.seed.value = String(randomSeed());
  }
  const seed = readSeedFromInput();
  void generateTurn(prompt, seed);
}

function wireEvents() {
  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    submitGenerate({ randomizeSeed: false });
  });

  els.generateRandomBtn.addEventListener('click', () => {
    submitGenerate({ randomizeSeed: true });
  });

  els.prompt.addEventListener('input', autoResize);
  els.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Enter = "give me something new". Each press rolls a fresh
      // seed, mirroring the dedicated Generate Random button. To
      // re-run the same seed (e.g. iterating on a prompt that's
      // close), users click the explicit Generate button.
      e.preventDefault();
      submitGenerate({ randomizeSeed: true });
    }
  });

  els.stopBtn.addEventListener('click', () => {
    if (currentTurn) currentTurn.abort();
  });

  els.seedRandom.addEventListener('click', () => {
    els.seed.value = String(randomSeed());
  });

  els.model.addEventListener('change', () => {
    const next = els.model.value;
    if (!IMAGE_MODELS[next]) return;
    if (currentTurn) {
      // Don't allow swapping mid-turn — revert and warn.
      els.model.value = selectedModelId;
      notify('Wait for the current generation to finish before switching models.', 'warn');
      return;
    }
    selectedModelId = next;
    saveSelectedModel(next);
    applySelectedModel();
  });

  els.historyClearAll.addEventListener('click', () => {
    void doClearAllHistory();
  });

  // Suggestion buttons in the empty state.
  els.outputEmpty.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.tagName === 'BUTTON' && target.dataset.prompt) {
      els.prompt.value = target.dataset.prompt;
      autoResize();
      els.prompt.focus();
    }
  });

  els.installBtn.addEventListener('click', () => {
    void ensureEngineReady({ silent: false });
  });

  els.downloadBtn.addEventListener('click', () => {
    if (!currentResult) return;
    const a = document.createElement('a');
    a.href = currentResult.url;
    const safeStem =
      (currentResult.prompt || 'image')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'image';
    a.download = `imagine-${safeStem}-seed${currentResult.seed}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  els.reuseBtn.addEventListener('click', () => {
    if (!currentResult) return;
    els.prompt.value = currentResult.prompt;
    els.seed.value = String(currentResult.seed);
    autoResize();
    els.prompt.focus();
  });
}

async function boot() {
  // Restore the user's last-selected model BEFORE wiring events
  // and the install card so the picker, mode line, and install copy
  // all start in the correct state.
  const savedModel = loadSelectedModel();
  if (savedModel && IMAGE_MODELS[savedModel]) {
    selectedModelId = savedModel;
  }
  if (els.model) {
    els.model.value = selectedModelId;
  }

  wireEvents();
  renderHistory();
  refreshModeLine();

  const ok = await checkWebGpuOrFail();
  if (!ok) return;

  // Returning visitor: model bytes are already in cache, so silently
  // re-init the engine without scaring the user with a download
  // dialog. On the first visit (or after the user purged the cache)
  // we show the install card instead. applySelectedModel handles
  // both branches and writes the right install-card copy.
  applySelectedModel();
}

void boot();
