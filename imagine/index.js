/**
 * Imagine app entry point — wires the DOM to the local diffusion
 * engine.
 *
 * Architecture: 100% client-side. Janus-Pro 1B is the default; SD-Turbo
 * is the other choice in the model menu. SD-Turbo takes a seed and
 * draws 512×512. Janus-Pro ignores seeds and draws 384×384.
 * No backend, no API key, no third-party endpoint. The page gates
 * entry on WebGPU support; the model is downloaded lazily on the
 * user's explicit Install (or first generate), not on page load.
 */

import { createOSEmbed } from '/os-embed.js';
import { createNotifier } from '/notifications.js';
import { stageImageForPaint } from '/paint-handoff.js';
import {
  isWebGpuSupported,
  isEngineReady,
  initEngine,
  generateImage,
  probeWebGpu,
  IMAGINE_DEFAULT_MODEL,
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
  outputSub: $('imagine-output-sub'),
  current: $('imagine-current'),
  currentImg: /** @type {HTMLImageElement} */ ($('imagine-current-img')),
  currentCaption: $('imagine-current-caption'),
  progressOverlay: $('imagine-progress-overlay'),
  progressFill: $('imagine-progress-fill'),
  progressText: $('imagine-progress-text'),
  downloadBtn: /** @type {HTMLButtonElement} */ ($('imagine-download-btn')),
  paintBtn: /** @type {HTMLButtonElement} */ ($('imagine-paint-btn')),
  useSourceBtn: /** @type {HTMLButtonElement} */ ($('imagine-use-source-btn')),
  reuseBtn: /** @type {HTMLButtonElement} */ ($('imagine-reuse-btn')),
  history: $('imagine-history'),
  historyList: $('imagine-history-list'),
  historyClearAll: /** @type {HTMLButtonElement} */ ($('imagine-history-clear-all')),
  composer: /** @type {HTMLFormElement} */ ($('imagine-composer')),
  prompt: /** @type {HTMLTextAreaElement} */ ($('imagine-prompt')),
  model: /** @type {HTMLSelectElement} */ ($('imagine-model')),
  features: $('imagine-model-features'),
  seedLabel: $('imagine-seed-label'),
  seed: /** @type {HTMLInputElement} */ ($('imagine-seed')),
  seedRandom: /** @type {HTMLButtonElement} */ ($('imagine-seed-random')),
  source: $('imagine-source'),
  sourceFile: /** @type {HTMLInputElement} */ ($('imagine-source-file')),
  sourcePick: /** @type {HTMLButtonElement} */ ($('imagine-source-pick')),
  sourcePreview: /** @type {HTMLImageElement} */ ($('imagine-source-preview')),
  sourceClear: /** @type {HTMLButtonElement} */ ($('imagine-source-clear')),
  strengthLabel: $('imagine-strength-label'),
  strength: /** @type {HTMLInputElement} */ ($('imagine-strength')),
  strengthValue: $('imagine-strength-value'),
  generateBtn: /** @type {HTMLButtonElement} */ ($('imagine-generate-btn')),
  stopBtn: /** @type {HTMLButtonElement} */ ($('imagine-stop-btn')),
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
 * @type {{ blob: Blob, url: string, prompt: string, seed: number, modelId?: string, fromImage?: boolean } | null}
 */
let currentResult = null;

/** Source picture for SD-Turbo image-to-image. Null means text only. */
let sourceImage = /** @type {HTMLImageElement | null} */ (null);
let sourceObjectUrl = '';

/** Held URLs for revoke-on-replace. */
let currentImgObjectUrl = '';

/**
 * In-flight engine-ready promise. Concurrent callers (e.g. install
 * button + auto-generate) share it instead of racing.
 *
 * @type {Promise<boolean> | null}
 */
let engineReadyPromise = null;

/** Model id currently chosen in the menu. Janus-Pro unless the visitor picked SD-Turbo. */
let selectedModelId = IMAGINE_DEFAULT_MODEL;

/** @returns {(typeof IMAGE_MODELS)[string]} */
function selectedModel() {
  return IMAGE_MODELS[selectedModelId] || IMAGE_MODELS[IMAGINE_DEFAULT_MODEL];
}

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
  const info = selectedModel();
  if (isEngineReady(info.id)) {
    els.modeLine.textContent = `Local · ${info.label}`;
    return;
  }
  els.modeLine.textContent = `Local · ${info.label} (${info.sizeLabel}) — install required`;
}

function setInstallCardVisible(visible) {
  if (els.install) els.install.hidden = !visible;
}

/**
 * Show the controls the selected model actually honors. SD-Turbo gets
 * the seed field; Janus-Pro does not.
 *
 * @param {(typeof IMAGE_MODELS)[string]} info
 */
function applyModelFeatures(info) {
  if (els.features) els.features.textContent = info.features;
  if (els.outputSub) els.outputSub.textContent = `${info.label}: ${info.features}.`;
  if (els.seedLabel) els.seedLabel.hidden = !info.supportsSeed;
  if (els.seedRandom) els.seedRandom.hidden = !info.supportsSeed;
  if (els.source) els.source.hidden = !info.supportsImage;
  if (els.useSourceBtn) els.useSourceBtn.hidden = !info.supportsImage;
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
  const info = selectedModel();
  applyModelFeatures(info);

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
  if (isEngineReady(info.id)) {
    setInstallCardVisible(false);
    return;
  }

  // Selected model is installed before — silently re-init it (the
  // weights are cached; this is fast).
  if (hasInstalledModel(info.id)) {
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
      image: selectedModel().supportsImage ? sourceImage : null,
      strength: readStrength(),
      signal: currentTurn.signal,
      onProgress: ({ progress, text }) => setProgress(progress, text)
    });

    setCurrentImage(result);
    if (selectedModel().supportsSeed) {
      els.seed.value = String(result.seed);
    }
    window.heymingAchievements?.unlockForCurrentApp('first-action');
    notify(`Generated in ${formatSeconds(result.timeMs)}s`, 'success');

    try {
      const thumbDataUrl = await blobToThumbDataUrl(result.blob);
      const entryId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pushHistory({
        id: entryId,
        prompt: result.prompt,
        seed: result.seed,
        modelId: result.modelId,
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
  els.stopBtn.hidden = !busy;
  els.prompt.disabled = busy;
  els.installBtn.disabled = busy;
  els.model.disabled = busy;
  els.seed.disabled = busy;
  els.seedRandom.disabled = busy;
  els.sourcePick.disabled = busy;
  els.sourceClear.disabled = busy;
  els.strength.disabled = busy;
  els.useSourceBtn.disabled = busy;
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
 * @param {{ url: string, prompt: string, seed: number, blob: Blob, modelId?: string }} result
 */
function setCurrentImage(result) {
  if (currentImgObjectUrl) {
    URL.revokeObjectURL(currentImgObjectUrl);
  }
  currentImgObjectUrl = result.url;
  currentResult = result;
  els.currentImg.src = result.url;
  els.currentImg.alt = result.prompt;
  const size = IMAGE_MODELS[result.modelId || '']?.sizePx;
  if (size) {
    els.currentImg.width = size;
    els.currentImg.height = size;
  }
  els.currentCaption.textContent = imageCaption(
    result.prompt,
    result.seed,
    result.modelId,
    result.fromImage
  );
  hideProgressOverlay();
}

/**
 * Seed belongs in the caption only for models that honor it. Older
 * history rows have no model id; those were SD-Turbo.
 *
 * @param {string} prompt
 * @param {number} seed
 * @param {string} [modelId]
 * @param {boolean} [fromImage]
 */
function imageCaption(prompt, seed, modelId, fromImage) {
  const usesSeed = modelId ? IMAGE_MODELS[modelId]?.supportsSeed === true : true;
  const seedBit = usesSeed ? ` — seed ${seed}` : '';
  const imageBit = fromImage ? ' · from image' : '';
  return `"${prompt}"${seedBit}${imageBit}`;
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
    btn.title = entry.prompt;
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
 * Restore a past generation: fill the composer with the prompt,
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
  autoResize();
  if (entryUsesSeed(entry)) {
    els.seed.value = String(entry.seed);
  }

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
  if (currentImgObjectUrl) {
    URL.revokeObjectURL(currentImgObjectUrl);
    currentImgObjectUrl = '';
  }
  currentResult = null;
  els.currentImg.src = entry.thumbDataUrl;
  els.currentImg.alt = entry.prompt;
  els.currentCaption.textContent = `${imageCaption(
    entry.prompt,
    entry.seed,
    entry.modelId
  )} · regenerate for full quality`;
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
    'This generator runs entirely on your device — no backend, no API key. Janus-Pro 1B downloads once into your browser cache. After that, each image takes about 20–60 seconds and works offline.';
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
  els.model.disabled = true;
  els.seed.disabled = true;
  els.seedRandom.disabled = true;
  els.sourcePick.disabled = true;
  els.sourceClear.disabled = true;
  els.strength.disabled = true;
}

function submitGenerate() {
  if (currentTurn) return;
  const prompt = els.prompt.value.trim();
  if (!prompt) {
    notify('Type a prompt first.', 'warn');
    els.prompt.focus();
    return;
  }
  void generateTurn(prompt, selectedModel().supportsSeed ? readSeedFromInput() : null);
}

/** @returns {number | null} null when the field is empty or not a number. */
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

/** Strength slider, 0.15–1. Ignored when there is no source image. */
function readStrength() {
  const n = Number(els.strength.value);
  if (!Number.isFinite(n)) return 0.55;
  return Math.min(1, Math.max(0.15, n));
}

function updateStrengthLabel() {
  els.strengthValue.textContent = `${Math.round(readStrength() * 100)}%`;
}

/**
 * @param {File} file
 */
function setSourceFile(file) {
  if (!file.type.startsWith('image/')) {
    notify('Choose an image file.', 'warn');
    return;
  }
  if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  sourceObjectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    sourceImage = img;
    els.sourcePreview.src = sourceObjectUrl;
    els.sourcePreview.hidden = false;
    els.sourceClear.hidden = false;
    els.strengthLabel.hidden = false;
  };
  img.onerror = () => {
    notify("Couldn't read that image.", 'error');
    clearSource();
  };
  img.src = sourceObjectUrl;
}

/**
 * Take the picture on screen as the next source. Copies the PNG blob
 * so the source survives a later generation replacing the result.
 */
function useCurrentAsSource() {
  if (!currentResult) {
    notify('Generate an image first.', 'warn');
    return;
  }
  const blob = currentResult.blob;
  setSourceFile(new File([blob], 'imagine-result.png', { type: blob.type || 'image/png' }));
  notify('Using this image as the source.', 'success');
}

function clearSource() {
  sourceImage = null;
  if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
  sourceObjectUrl = '';
  els.sourcePreview.removeAttribute('src');
  els.sourcePreview.hidden = true;
  els.sourceClear.hidden = true;
  els.strengthLabel.hidden = true;
}

/**
 * Older history rows predate the model menu and were all SD-Turbo,
 * which honors a seed.
 *
 * @param {{ modelId?: string }} entry
 */
function entryUsesSeed(entry) {
  if (!entry.modelId) return true;
  return IMAGE_MODELS[entry.modelId]?.supportsSeed === true;
}

/**
 * Download name for the current image: `imagine-<prompt-stem>.png`.
 * @param {{ prompt?: string, seed?: number, modelId?: string }} result
 */
function resultFileName(result) {
  const safeStem =
    (result.prompt || 'image')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image';
  const seeded =
    result.modelId && IMAGE_MODELS[result.modelId]?.supportsSeed && typeof result.seed === 'number'
      ? `-seed${result.seed}`
      : '';
  return `imagine-${safeStem}${seeded}.png`;
}

/**
 * Stage the current image for Paint, then open Paint. Inside HeymingOS
 * the OS opens a new Paint window; standalone, Paint opens in a new tab.
 * Paint places the image as a new layer when it boots.
 */
async function openInPaint() {
  if (!currentResult) return;
  try {
    await stageImageForPaint(currentResult.blob, resultFileName(currentResult));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify(`Couldn't hand the image to Paint: ${message}`, 'error');
    return;
  }
  if (embed.isEmbedded) {
    embed.launchApp('paint');
  } else {
    window.open('/paint/', '_blank', 'noopener');
  }
}

function wireEvents() {
  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    submitGenerate();
  });

  els.prompt.addEventListener('input', autoResize);
  els.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitGenerate();
    }
  });

  els.stopBtn.addEventListener('click', () => {
    if (currentTurn) currentTurn.abort();
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
    a.download = resultFileName(currentResult);
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  els.paintBtn.addEventListener('click', () => {
    void openInPaint();
  });

  els.useSourceBtn.addEventListener('click', useCurrentAsSource);

  els.reuseBtn.addEventListener('click', () => {
    if (!currentResult) return;
    els.prompt.value = currentResult.prompt;
    if (entryUsesSeed(currentResult)) els.seed.value = String(currentResult.seed);
    autoResize();
    els.prompt.focus();
  });

  els.seedRandom.addEventListener('click', () => {
    els.seed.value = String(randomSeed());
    els.seed.focus();
  });

  els.model.addEventListener('change', () => {
    const next = els.model.value;
    if (!IMAGE_MODELS[next]) {
      els.model.value = selectedModelId;
      return;
    }
    selectedModelId = next;
    saveSelectedModel(next);
    applySelectedModel();
  });

  els.sourcePick.addEventListener('click', () => {
    els.sourceFile.click();
  });
  els.sourceFile.addEventListener('change', () => {
    const file = els.sourceFile.files?.[0];
    els.sourceFile.value = '';
    if (file) setSourceFile(file);
  });
  els.sourceClear.addEventListener('click', clearSource);
  els.strength.addEventListener('input', updateStrengthLabel);
}

function populateModelSelect() {
  const saved = loadSelectedModel();
  if (saved && IMAGE_MODELS[saved]) selectedModelId = saved;
  els.model.replaceChildren();
  for (const info of Object.values(IMAGE_MODELS)) {
    const option = document.createElement('option');
    option.value = info.id;
    option.textContent = info.label;
    els.model.appendChild(option);
  }
  els.model.value = selectedModelId;
}

async function boot() {
  populateModelSelect();
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
