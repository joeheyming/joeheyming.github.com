// modules/stickers.js
//
// Emoji-based "stickers" the user can drop onto a meme. Drawn on the
// editor as DOM elements (with the same drag/resize/rotate plumbing
// as text boxes) and re-rendered on the export canvas via fillText.
//
// We avoid bundling SVG assets — emoji renders are universal (each
// OS has its own emoji font) and zero-overhead.

import * as store from './state.js';
import { makeDraggable, makeResize, makeRotate } from './interactions.js';

// Curated palette — broad enough to cover most meme reactions
// without flooding the panel.
export const STICKERS = [
  '🔥',
  '💯',
  '👑',
  '😎',
  '🤡',
  '💀',
  '👀',
  '✨',
  '🌟',
  '⚡',
  '💥',
  '💩',
  '🎯',
  '🚀',
  '💎',
  '🎉',
  '🤔',
  '😂',
  '😭',
  '🤣',
  '😍',
  '🥰',
  '🤩',
  '😱',
  '🙄',
  '👍',
  '👎',
  '👻',
  '🦄',
  '🌈',
  '🎮',
  '🎵',
  '🎸',
  '👽',
  '🦖',
  '🦊',
  '🐱',
  '🐶',
  '🍕',
  '🍔'
];

/** Render the emoji palette grid inside `paletteEl`. */
export function initPalette(paletteEl, onPick) {
  paletteEl.innerHTML = '';
  for (const emoji of STICKERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = emoji;
    btn.title = `Add ${emoji}`;
    btn.addEventListener('click', () => {
      const id = store.addSticker(emoji);
      onPick?.(id);
    });
    paletteEl.appendChild(btn);
  }
}

/** Create an on-stage overlay element for a sticker. */
export function createStickerOverlay(sticker, overlayEl, stageEl) {
  const el = document.createElement('div');
  el.className = 'sticker';
  el.dataset.id = sticker.id;

  const inner = document.createElement('div');
  inner.className = 'sticker-inner';
  inner.textContent = sticker.emoji;
  el.appendChild(inner);

  const handleResize = document.createElement('div');
  handleResize.className = 'text-box-handle handle-resize';
  el.appendChild(handleResize);

  const handleRotate = document.createElement('div');
  handleRotate.className = 'text-box-handle handle-rotate';
  el.appendChild(handleRotate);

  const handleDelete = document.createElement('div');
  handleDelete.className = 'text-box-handle handle-delete';
  handleDelete.textContent = '×';
  handleDelete.title = 'Remove sticker';
  el.appendChild(handleDelete);

  overlayEl.appendChild(el);

  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.text-box-handle')) return;
    store.setSelection('sticker', sticker.id);
  });

  makeDraggable(
    el,
    stageEl,
    () => {
      const s = store.get().stickers.find((x) => x.id === sticker.id);
      return { x: s.x, y: s.y };
    },
    ({ x, y }) => store.updateSticker(sticker.id, { x, y })
  );

  makeResize(
    handleResize,
    stageEl,
    () => {
      const s = store.get().stickers.find((x) => x.id === sticker.id);
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    },
    ({ w, h }) => store.updateSticker(sticker.id, { w, h })
  );

  makeRotate(handleRotate, el, stageEl, (deg) =>
    store.updateSticker(sticker.id, { rotation: deg })
  );

  handleDelete.addEventListener('click', (e) => {
    e.stopPropagation();
    store.removeSticker(sticker.id);
  });

  return el;
}

export function applyStickerStyles(el, sticker) {
  el.style.left = sticker.x * 100 + '%';
  el.style.top = sticker.y * 100 + '%';
  el.style.width = sticker.w * 100 + '%';
  el.style.height = sticker.h * 100 + '%';
  el.style.transform = `rotate(${sticker.rotation}deg)`;

  // Auto-fit the emoji glyph to the box height. We use 0.9 to leave a
  // tiny margin so the emoji's typical baseline padding doesn't clip.
  const stage = el.parentElement.parentElement;
  const cssH = stage?.getBoundingClientRect().height || 1;
  const inner = el.querySelector('.sticker-inner');
  inner.style.fontSize = sticker.h * cssH * 0.9 + 'px';
  inner.textContent = sticker.emoji;
}
