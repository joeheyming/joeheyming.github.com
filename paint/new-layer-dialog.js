// Layer › New › Layer…, Layer from Background…, Group… and Group from Layers… dialog (PhotoCraft's
// New Layer / New Group dialog). The markup is #new-layer-modal in index.html: Name, Mode, and
// Opacity. OK hands { name, blendMode, opacity } (opacity 0..1) to the open() call's onOk. For a
// group (open({ group: true })) Mode lists Pass Through first and starts there.

import { BLEND_MODES, GROUP_BLEND_MODES } from './layers.js';
import { PASS_THROUGH } from './layer-groups.js';

/** Dialog fields → the layer settings: an empty name stays empty, opacity clamps to 0..100 %. */
export function newLayerSettings({ name, mode, opacity, group = false }) {
  const pct = Number(opacity);
  const modes = group ? GROUP_BLEND_MODES : BLEND_MODES;
  return {
    name: String(name ?? '').trim(),
    blendMode: modes.some((m) => m.value === mode) ? mode : group ? PASS_THROUGH : 'source-over',
    opacity: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) / 100 : 1
  };
}

/**
 * @param {{ doc?: Document }} [deps]
 * @returns {{ open: (init: { title?: string, name: string, group?: boolean }, onOk: (s: { name: string, blendMode: string, opacity: number }) => void) => void }}
 */
export function initNewLayerDialog({ doc = document } = {}) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('new-layer-modal');
  if (!modal) return { open() {} };
  const title = $('new-layer-title');
  const name = $('new-layer-name');
  const mode = $('new-layer-mode');
  const opacity = $('new-layer-opacity');
  const fillModes = (modes) => {
    mode.replaceChildren();
    for (const { value, label } of modes) {
      const opt = doc.createElement('option');
      opt.value = value;
      opt.textContent = label;
      mode.appendChild(opt);
    }
  };
  fillModes(BLEND_MODES);

  let onOk = null;
  let group = false;
  const close = () => {
    modal.classList.add('hidden');
    onOk = null;
  };
  const confirm = () => {
    const run = onOk;
    const settings = newLayerSettings({
      name: name.value,
      mode: mode.value,
      opacity: opacity.value,
      group
    });
    close();
    run?.(settings);
  };
  $('new-layer-ok')?.addEventListener('click', confirm);
  $('new-layer-cancel')?.addEventListener('click', close);
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
    open(init, ok) {
      onOk = ok;
      group = init.group === true;
      if (title) title.textContent = init.title ?? (group ? 'New Group' : 'New Layer');
      fillModes(group ? GROUP_BLEND_MODES : BLEND_MODES);
      name.value = init.name;
      mode.value = group ? PASS_THROUGH : 'source-over';
      opacity.value = '100';
      modal.classList.remove('hidden');
      setTimeout(() => {
        name.focus();
        name.select();
      }, 50);
    }
  };
}
