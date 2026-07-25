// modules/editor.js
//
// Stage orchestrator. Owns:
//   - The background <canvas> at the image's natural size.
//   - The DOM overlay that hosts text-box and sticker elements.
//   - The right-sidebar list of text-box editor cards.
// Wires everything to the store and re-renders on subscribe().

import * as store from './state.js';
import {
  createBoxOverlay,
  applyBoxStyles,
  createBoxSidebar,
  applySidebarValues
} from './text-box.js';
import { createStickerOverlay, applyStickerStyles } from './stickers.js';

let stageEl, bgCanvas, overlayEl, boxListEl, emptyStateEl;
let currentImage = null; // HTMLImageElement currently loaded
let boxOverlayEls = new Map(); // id -> DOM element
let boxSidebarEls = new Map(); // id -> DOM element
let stickerOverlayEls = new Map(); // id -> DOM element

export function init(els) {
  ({ stageEl, bgCanvas, overlayEl, boxListEl, emptyStateEl } = els);
  store.subscribe(render);

  // Click on the stage background (not an overlay item) clears selection
  stageEl.addEventListener('pointerdown', (e) => {
    if (e.target === stageEl || e.target === bgCanvas || e.target === overlayEl) {
      store.clearSelection();
    }
  });

  // Re-size canvas-CSS-relative font sizes on viewport changes
  window.addEventListener('resize', () => render(store.get()));
}

/** Normalize a possibly-relative URL to its absolute form for cache hits. */
function abs(src) {
  try {
    return new URL(src, location.href).href;
  } catch {
    return src;
  }
}

/** Load and cache an Image for `imageSrc` if it's not already loaded. */
async function loadImageIfNeeded(src) {
  if (!src) {
    currentImage = null;
    return null;
  }
  const want = abs(src);
  if (currentImage && currentImage.src === want) return currentImage;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = src;
  });
  currentImage = img;
  return img;
}

async function renderBg(state) {
  const { naturalSize, bgBlur, imageSrc } = state;
  if (!imageSrc || !naturalSize.w) {
    bgCanvas.width = 0;
    bgCanvas.height = 0;
    stageEl.removeAttribute('data-loaded');
    return;
  }

  const img = await loadImageIfNeeded(imageSrc);
  if (!img) return;

  bgCanvas.width = naturalSize.w;
  bgCanvas.height = naturalSize.h;
  // Keep the stage footprint CSS-driven (width + aspect-ratio). Setting
  // explicit pixel width/height here was the main CLS jump when the
  // default template auto-loaded after first paint.
  stageEl.style.aspectRatio = `${naturalSize.w} / ${naturalSize.h}`;
  stageEl.style.width = '';
  stageEl.style.height = '';

  const ctx = bgCanvas.getContext('2d');
  ctx.clearRect(0, 0, naturalSize.w, naturalSize.h);
  // Blur is expressed in natural-image pixels so the editor preview
  // and the exported PNG match exactly (the export does not know the
  // display size, so we keep the unit absolute).
  ctx.filter = bgBlur > 0 ? `blur(${bgBlur}px)` : 'none';
  ctx.drawImage(img, 0, 0, naturalSize.w, naturalSize.h);
  ctx.filter = 'none';

  stageEl.setAttribute('data-loaded', '1');
}

function syncBoxOverlays(state) {
  const seen = new Set();
  for (const box of state.boxes) {
    seen.add(box.id);
    let el = boxOverlayEls.get(box.id);
    if (!el) {
      el = createBoxOverlay(box, overlayEl, stageEl);
      boxOverlayEls.set(box.id, el);
    }
    applyBoxStyles(el, box, state.naturalSize);
    el.classList.toggle(
      'is-selected',
      state.selection?.kind === 'box' && state.selection?.id === box.id
    );
  }
  // Remove overlays for boxes no longer in state
  for (const [id, el] of boxOverlayEls) {
    if (!seen.has(id)) {
      el.remove();
      boxOverlayEls.delete(id);
    }
  }
}

function syncBoxSidebars(state) {
  const seen = new Set();
  for (const box of state.boxes) {
    seen.add(box.id);
    let item = boxSidebarEls.get(box.id);
    if (!item) {
      item = createBoxSidebar(box, boxListEl);
      boxSidebarEls.set(box.id, item);
    }
    applySidebarValues(item, box);
    item.classList.toggle(
      'is-selected',
      state.selection?.kind === 'box' && state.selection?.id === box.id
    );
  }
  for (const [id, item] of boxSidebarEls) {
    if (!seen.has(id)) {
      item.remove();
      boxSidebarEls.delete(id);
    }
  }
}

function syncStickerOverlays(state) {
  const seen = new Set();
  for (const sticker of state.stickers) {
    seen.add(sticker.id);
    let el = stickerOverlayEls.get(sticker.id);
    if (!el) {
      el = createStickerOverlay(sticker, overlayEl, stageEl);
      stickerOverlayEls.set(sticker.id, el);
    }
    applyStickerStyles(el, sticker);
    el.classList.toggle(
      'is-selected',
      state.selection?.kind === 'sticker' && state.selection?.id === sticker.id
    );
  }
  for (const [id, el] of stickerOverlayEls) {
    if (!seen.has(id)) {
      el.remove();
      stickerOverlayEls.delete(id);
    }
  }
}

let renderRaf = 0;
let lastImageSrc = null;
let lastBgBlur = -1;
let lastStageW = 0;
let lastStageH = 0;
let lastFocusedBoxId = null;
function render(state) {
  cancelAnimationFrame(renderRaf);
  renderRaf = requestAnimationFrame(async () => {
    // Only redraw the background when image/blur changed, or when the
    // stage container has been resized (which forces a re-fit). Skipping
    // this for every pointermove during drag keeps the editor smooth.
    const editorRect = stageEl.parentElement.getBoundingClientRect();
    const sized = editorRect.width !== lastStageW || editorRect.height !== lastStageH;
    if (state.imageSrc !== lastImageSrc || state.bgBlur !== lastBgBlur || sized) {
      await renderBg(state);
      lastImageSrc = state.imageSrc;
      lastBgBlur = state.bgBlur;
      lastStageW = editorRect.width;
      lastStageH = editorRect.height;
    }
    syncBoxOverlays(state);
    syncStickerOverlays(state);
    syncBoxSidebars(state);
    emptyStateEl.style.display = state.imageSrc ? 'none' : '';

    // When the user picks a different text box (by clicking on the
    // canvas overlay), bring its sidebar editor into view and focus
    // the text input — that's now the canonical place to type meme
    // text. Only fires when the selected id CHANGES, so it doesn't
    // steal focus on every pointermove during a drag.
    const selBoxId = state.selection?.kind === 'box' ? state.selection.id : null;
    if (selBoxId !== lastFocusedBoxId) {
      lastFocusedBoxId = selBoxId;
      if (selBoxId) {
        const item = document.querySelector(`.box-item[data-id="${CSS.escape(selBoxId)}"]`);
        if (item) {
          item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          item.querySelector('textarea[data-field="text"]')?.focus();
        }
      }
    }
  });
}

/** Force a fresh redraw (e.g. on viewport resize). */
export function redraw() {
  render(store.get());
}
