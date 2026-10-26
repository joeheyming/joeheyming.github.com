// Layer › Lock Layers… (PhotoCraft layers_panel_ui.rs LockLayers: Transparency, Image, Position,
// All). The markup is #lock-layers-modal in index.html. open(locks, onOk) shows the active
// layer's locks; OK hands every checkbox to onOk as { transparency, pixels, position, all },
// which runs layer.lockLayers on the selected layers. Image covers Transparency, so checking it
// clears and greys that box (Locks::set).

import { LOCK_KEYS, layerLocks } from './layer-locks.js';

/**
 * @param {{ doc?: Document }} [deps]
 * @returns {{ open: (locks: object, onOk: (locks: Record<string, boolean>) => void) => void }}
 */
export function initLockLayersDialog({ doc = document } = {}) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('lock-layers-modal');
  if (!modal) return { open() {} };
  const boxes = Object.fromEntries(LOCK_KEYS.map((k) => [k, $(`lock-layers-${k}`)]));
  const syncTransparency = () => {
    if (boxes.pixels.checked) boxes.transparency.checked = false;
    boxes.transparency.disabled = boxes.pixels.checked;
  };
  boxes.pixels.addEventListener('change', syncTransparency);

  let onOk = null;
  const close = () => {
    modal.classList.add('hidden');
    onOk = null;
  };
  const confirm = () => {
    const run = onOk;
    const locks = Object.fromEntries(LOCK_KEYS.map((k) => [k, boxes[k].checked]));
    close();
    run?.(locks);
  };
  $('lock-layers-ok')?.addEventListener('click', confirm);
  $('lock-layers-cancel')?.addEventListener('click', close);
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      confirm();
    }
  });

  return {
    open(locks, ok) {
      onOk = ok;
      const current = layerLocks({ locks });
      for (const k of LOCK_KEYS) boxes[k].checked = current[k];
      syncTransparency();
      modal.classList.remove('hidden');
      setTimeout(() => $('lock-layers-ok')?.focus(), 50);
    }
  };
}
