// /meme/index.js — bootstrap
//
// Wires the DOM scaffolding from index.html to the modules:
//   - templates.js: left gallery + upload
//   - editor.js: canvas + draggable overlay
//   - stickers.js: emoji palette
//   - export.js: PNG download + clipboard
//   - share.js: URL-hash deep links

import * as store from './modules/state.js';
import * as templates from './modules/templates.js';
import * as editor from './modules/editor.js';
import { initPalette } from './modules/stickers.js';
import { downloadPng, copyToClipboard } from './modules/export.js';
import { buildShareUrl, readHashPayload } from './modules/share.js';

const els = {
  stageEl: document.getElementById('stage'),
  bgCanvas: document.getElementById('bg-canvas'),
  overlayEl: document.getElementById('overlay'),
  boxListEl: document.getElementById('box-list'),
  emptyStateEl: document.getElementById('empty-state'),
  gridEl: document.getElementById('tpl-grid'),
  searchEl: document.getElementById('tpl-search'),
  uploadInput: document.getElementById('upload-input'),
  pasteBtn: document.getElementById('paste-btn'),
  addBoxBtn: document.getElementById('add-box-btn'),
  stickerPalette: document.getElementById('sticker-palette'),
  blurSlider: document.getElementById('blur-slider'),
  blurValue: document.getElementById('blur-value'),
  clearStickersBtn: document.getElementById('clear-stickers-btn'),
  stageTip: document.getElementById('stage-tip')
};

// ---------- Init core ----------

editor.init(els);

initPalette(els.stickerPalette, () => {
  // First sticker hint
  if (store.get().stickers.length === 1) {
    showTip('Sticker added. Drag to move, corner to resize, top to rotate.');
  }
});

await templates.init({
  gridEl: els.gridEl,
  searchEl: els.searchEl,
  onSelect: () => {
    showTip('Click a text box to select. Type in the sidebar to edit.');
  }
});

// ---------- Wire UI ----------

els.uploadInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await templates.loadCustomImage(file);
    showTip('Custom image loaded.');
  } catch {
    showTip('Could not load that image.', 'err');
  }
  els.uploadInput.value = '';
});

els.pasteBtn.addEventListener('click', () => {
  pasteImageFromClipboard();
});

window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type?.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        templates.loadCustomImage(file).then(() => showTip('Pasted image loaded.'));
        e.preventDefault();
        break;
      }
    }
  }
});

async function pasteImageFromClipboard() {
  try {
    if (!navigator.clipboard?.read) {
      showTip('Clipboard reads need a recent browser. Try Cmd/Ctrl+V instead.', 'err');
      return;
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const file = new File([blob], 'pasted.png', { type: imageType });
        await templates.loadCustomImage(file);
        showTip('Pasted image loaded.');
        return;
      }
    }
    showTip('No image in clipboard.', 'err');
  } catch (err) {
    showTip('Clipboard read blocked. Try Cmd/Ctrl+V instead.', 'err');
    console.warn(err);
  }
}

els.addBoxBtn.addEventListener('click', () => {
  store.addBox({ x: 0.1, y: 0.4, w: 0.8, h: 0.2 });
});

els.blurSlider.addEventListener('input', () => {
  const value = parseInt(els.blurSlider.value, 10);
  store.setBgBlur(value);
  els.blurValue.textContent = value + 'px';
});

els.clearStickersBtn.addEventListener('click', () => {
  if (store.get().stickers.length === 0) return;
  if (confirm('Remove all stickers from this meme?')) {
    store.clearStickers();
  }
});

// ---------- Top-bar actions ----------

document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => handleAction(btn.dataset.action));
});

async function handleAction(action) {
  switch (action) {
    case 'reset':
      if (store.get().boxes.length === 0 && !store.get().imageSrc) return;
      if (confirm('Discard the current meme and start over?')) {
        store.reset();
        showTip('Cleared. Pick a new template to start.');
      }
      break;
    case 'download':
      try {
        await downloadPng();
        if (window.trackEvent) {
          window.trackEvent('meme_download', 'Meme', store.get().template?.id || 'custom');
        }
        showTip('Downloaded.', 'ok');
      } catch (err) {
        showTip(err.message, 'err');
      }
      break;
    case 'copy':
      try {
        await copyToClipboard();
        if (window.trackEvent) {
          window.trackEvent('meme_copy', 'Meme', store.get().template?.id || 'custom');
        }
        showTip('Copied to clipboard. Paste anywhere.', 'ok');
      } catch (err) {
        showTip('Copy failed: ' + err.message, 'err');
      }
      break;
    case 'share': {
      const url = buildShareUrl();
      try {
        await navigator.clipboard.writeText(url);
        showTip('Share link copied to clipboard.', 'ok');
        history.replaceState(null, '', url);
      } catch {
        prompt('Copy this share link:', url);
      }
      if (window.trackEvent) {
        window.trackEvent('meme_share', 'Meme', store.get().template?.id || 'custom');
      }
      break;
    }
  }
}

// ---------- Keyboard ----------

window.addEventListener('keydown', (e) => {
  // Don't intercept while editing text
  if (
    e.target.matches(
      'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
    )
  )
    return;

  const sel = store.get().selection;
  if (!sel) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (sel.kind === 'box') store.removeBox(sel.id);
    else if (sel.kind === 'sticker') store.removeSticker(sel.id);
  }
});

// ---------- Initial template ----------
//
// Priority: share-hash (#m=) > querystring (?t=) > default.
// All three paths load silently (no `meme_template_selected` event) —
// they describe what the URL is asking for, not what the user clicked.
// `?t=` arrivals additionally fire a separate `meme_template_arrival`
// event so we can tell tagged-link traffic apart from organic landings.

const payload = readHashPayload();
const queryTemplateId = new URLSearchParams(location.search).get('t');

if (payload) {
  if (payload.templateId) {
    // Wait for the chosen template's image to load, then overlay the
    // shared boxes/stickers on top of the (now-initialized) state.
    templates.selectTemplate(payload.templateId, { silent: true });
    const off = store.subscribe(() => {
      const s = store.get();
      if (s.template?.id === payload.templateId && s.naturalSize.w > 0) {
        off();
        store.replaceAll({
          ...s,
          boxes: payload.boxes,
          stickers: payload.stickers,
          bgBlur: payload.bgBlur
        });
        els.blurSlider.value = String(payload.bgBlur);
        els.blurValue.textContent = payload.bgBlur + 'px';
      }
    });
  }
} else if (queryTemplateId) {
  templates.selectTemplate(queryTemplateId, { silent: true });
  if (window.trackEvent) {
    window.trackEvent('meme_template_arrival', 'Meme', queryTemplateId);
  }
} else {
  // First-load delight: open with the most popular template loaded.
  templates.selectTemplate('drake-hotline-bling', { silent: true });
}

// ---------- Keep the URL in sync with the chosen template ----------
//
// Mirror the active template id into `?t=`. When the user uploads a
// custom image (template becomes null) or otherwise clears it, drop
// the param. We also strip the share-hash on any template change —
// the hash references a specific snapshot that no longer matches.
// Uses replaceState (no new history entry) so the back button keeps
// pointing at the previous page.

let lastTemplateId = null;
store.subscribe(() => {
  const id = store.get().template?.id || null;
  if (id === lastTemplateId) return;
  lastTemplateId = id;
  try {
    const url = new URL(location.href);
    if (id) {
      url.searchParams.set('t', id);
    } else {
      url.searchParams.delete('t');
    }
    url.hash = '';
    history.replaceState(null, '', url.toString());
  } catch (_) {
    /* URL/history APIs unavailable — non-fatal */
  }
});

function showTip(msg, kind) {
  els.stageTip.textContent = msg;
  els.stageTip.dataset.kind = kind || '';
  clearTimeout(showTip._timer);
  showTip._timer = setTimeout(() => {
    els.stageTip.textContent = '';
  }, 4500);
}
