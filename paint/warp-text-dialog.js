// Type › Warp Text… (PhotoCraft warp_text_dialog.rs): Style, Horizontal / Vertical, then Bend,
// Horizontal Distortion and Vertical Distortion. The markup is #warp-text-modal in index.html.
// open(warp, { preview, commit, cancel }) shows it with the layer's warp (or none); every edit
// previews on the layer, OK commits, Cancel puts the old warp back. Style None disables the
// sliders and removes the warp.

import { WARP_DEFAULTS, WARP_STYLES, normalizeWarp } from './text-warp.js';

const FIELDS = [
  ['bend', 'warp-bend'],
  ['hDistort', 'warp-hdistort'],
  ['vDistort', 'warp-vdistort']
];

/**
 * @param {{ doc?: Document }} [deps]
 * @returns {{ open: (warp: object | null, handlers: object) => void }}
 */
export function initWarpTextDialog({ doc = document } = {}) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('warp-text-modal');
  if (!modal) return { open() {} };

  const style = /** @type {HTMLSelectElement} */ ($('warp-style'));
  for (const [id, label] of WARP_STYLES) {
    const opt = doc.createElement('option');
    opt.value = id;
    opt.textContent = label;
    style.appendChild(opt);
  }

  let handlers = null;
  const read = () => ({
    style: style.value,
    vertical: $('warp-vertical').checked,
    ...Object.fromEntries(FIELDS.map(([k, id]) => [k, Number($(id + '-num').value) || 0]))
  });
  const sync = () => {
    const none = style.value === 'none';
    for (const [, id] of FIELDS) $(id).disabled = $(id + '-num').disabled = none;
    $('warp-horizontal').disabled = $('warp-vertical').disabled = none;
  };
  const preview = () => {
    sync();
    handlers?.preview?.(normalizeWarp(read()));
  };
  for (const [, id] of FIELDS) {
    $(id).addEventListener('input', () => {
      $(id + '-num').value = $(id).value;
      preview();
    });
    $(id + '-num').addEventListener('input', () => {
      $(id).value = $(id + '-num').value;
      preview();
    });
  }
  style.addEventListener('change', preview);
  $('warp-horizontal').addEventListener('change', preview);
  $('warp-vertical').addEventListener('change', preview);

  const close = (ok) => {
    const h = handlers;
    handlers = null;
    modal.classList.add('hidden');
    if (ok) h?.commit?.(normalizeWarp(read()));
    else h?.cancel?.();
  };
  $('warp-ok')?.addEventListener('click', () => close(true));
  $('warp-cancel')?.addEventListener('click', () => close(false));
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') close(false);
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      close(true);
    }
  });

  return {
    open(warp, h) {
      const w = normalizeWarp(warp) ?? WARP_DEFAULTS;
      style.value = w.style;
      $(w.vertical ? 'warp-vertical' : 'warp-horizontal').checked = true;
      for (const [k, id] of FIELDS) $(id).value = $(id + '-num').value = String(w[k]);
      sync();
      handlers = h;
      modal.classList.remove('hidden');
      setTimeout(() => style.focus(), 50);
    }
  };
}
