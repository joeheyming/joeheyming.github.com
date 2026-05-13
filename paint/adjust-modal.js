// Adjust-modal module for the paint app.
//
// Owns the modal that lets the user preview-and-apply layer
// adjustments (brightness, hue/sat/lightness, threshold, invert,
// grayscale, sepia, pixelate). Also owns the small action-menu
// open/close helpers for the Adjust and Save dropdowns since they
// share the same toggle pattern.
//
// Drawing the actual pixels is delegated to the adjustment
// definitions in `./adjustments.js`; this module owns the modal
// lifecycle (open / preview-on-slider-change / cancel / commit) and
// caches the pre-adjustment ImageData as `baseImage` so previews
// stay non-destructive until the user clicks OK.
//
// Like `./selection.js`, stateful entry points take the paint app's
// `state` object and a small `deps` bag with the helpers we need
// (active layer ctx, pushUndo, refresh hooks) instead of importing
// them directly.

import { ADJUSTMENTS } from './adjustments.js';
import { selectionToFullMask } from './selection.js';

// Currently-open adjustment session: { id, baseImage, params, mask, ctx, W, H, pushUndo, onCommit }.
// Module-local so the slider callbacks and cancel/commit buttons can share it.
let adjustSession = null;

export function openAdjust(id, state, deps) {
  const def = ADJUSTMENTS[id];
  if (!def) return;
  closeAdjustMenu();
  const ctx = deps.activeCtx();
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const baseImage = ctx.getImageData(0, 0, W, H);
  const mask = state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null;
  const params = {};
  for (const f of def.fields) params[f.key] = f.default;
  adjustSession = {
    id, baseImage, params, mask, ctx, W, H,
    pushUndo: deps.pushUndo,
    onCommit: deps.onCommit,
  };

  document.getElementById('adjust-modal-title').textContent = def.label;
  const fieldsEl = document.getElementById('adjust-modal-fields');
  fieldsEl.innerHTML = '';

  if (def.fields.length === 0) {
    // No-parameter adjustments — show preview directly without sliders.
    const note = document.createElement('div');
    note.style.fontSize = '13px';
    note.style.color = 'var(--fg-dim)';
    note.textContent = 'Apply ' + def.label + (mask ? ' to selection' : ' to active layer') + '?';
    fieldsEl.appendChild(note);
    previewAdjust();
  } else {
    for (const f of def.fields) {
      const row = document.createElement('div');
      row.className = 'adjust-field';
      const label = document.createElement('label');
      label.textContent = f.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(f.min);
      input.max = String(f.max);
      input.step = String(f.step ?? 1);
      input.value = String(f.default);
      const display = document.createElement('span');
      display.className = 'adjust-field-value';
      display.textContent = String(f.default);
      input.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        adjustSession.params[f.key] = v;
        display.textContent = String(v);
        previewAdjust();
      });
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(display);
      fieldsEl.appendChild(row);
    }
    previewAdjust();
  }

  document.getElementById('adjust-modal').classList.remove('hidden');
}

export function previewAdjust() {
  if (!adjustSession) return;
  const { id, baseImage, params, mask, ctx } = adjustSession;
  // Clone base image so the original stays intact between preview redraws.
  const work = ctx.createImageData(baseImage.width, baseImage.height);
  work.data.set(baseImage.data);
  ADJUSTMENTS[id].apply(work, params, mask);
  ctx.putImageData(work, 0, 0);
}

export function cancelAdjust() {
  if (adjustSession) {
    adjustSession.ctx.putImageData(adjustSession.baseImage, 0, 0);
  }
  adjustSession = null;
  document.getElementById('adjust-modal').classList.add('hidden');
}

export function commitAdjust() {
  if (!adjustSession) return;
  const def = ADJUSTMENTS[adjustSession.id];
  // Restore base, push undo, re-apply for the canonical record.
  adjustSession.ctx.putImageData(adjustSession.baseImage, 0, 0);
  adjustSession.pushUndo(def.label);
  const work = adjustSession.ctx.createImageData(adjustSession.W, adjustSession.H);
  work.data.set(adjustSession.baseImage.data);
  def.apply(work, adjustSession.params, adjustSession.mask);
  adjustSession.ctx.putImageData(work, 0, 0);
  adjustSession.onCommit?.();
  adjustSession = null;
  document.getElementById('adjust-modal').classList.add('hidden');
}

export function buildAdjustMenu(onOpen) {
  const list = document.getElementById('adjust-menu-list');
  if (!list) return;
  list.innerHTML = '';
  const order = ['brightness', 'hsl', 'threshold', null, 'invert', 'grayscale', 'sepia', null, 'pixelate'];
  for (const id of order) {
    if (id === null) {
      const sep = document.createElement('div');
      sep.className = 'action-menu-sep';
      list.appendChild(sep);
      continue;
    }
    const def = ADJUSTMENTS[id];
    if (!def) continue;
    const item = document.createElement('button');
    item.className = 'action-menu-item';
    item.textContent = def.label;
    item.addEventListener('click', () => onOpen(id));
    list.appendChild(item);
  }
}

// ── Generic action-menu open/close (shared with Save menu) ───────

export function toggleAdjustMenu() {
  const list = document.getElementById('adjust-menu-list');
  const btn = document.getElementById('btn-adjust');
  if (!list) return;
  const willOpen = list.classList.contains('hidden');
  list.classList.toggle('hidden', !willOpen);
  btn?.setAttribute('aria-expanded', String(willOpen));
}

export function closeAdjustMenu() {
  document.getElementById('adjust-menu-list')?.classList.add('hidden');
  document.getElementById('btn-adjust')?.setAttribute('aria-expanded', 'false');
}

export function toggleSaveMenu() {
  const list = document.getElementById('save-menu-list');
  const btn = document.getElementById('btn-save');
  if (!list) return;
  const willOpen = list.classList.contains('hidden');
  list.classList.toggle('hidden', !willOpen);
  btn?.setAttribute('aria-expanded', String(willOpen));
}

export function closeSaveMenu() {
  document.getElementById('save-menu-list')?.classList.add('hidden');
  document.getElementById('btn-save')?.setAttribute('aria-expanded', 'false');
}
