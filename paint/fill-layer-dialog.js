// Layer › New Fill Layer › Solid Color… / Gradient… / Pattern… and a fill layer's double-click
// (PhotoCraft solid_fill_ui, gradient_ui, pattern_fill_ui). open(fill, { onPreview, onOk,
// onCancel }) edits a copy of the fill; every change hands it to onPreview(fill), OK to
// onOk(fill), and Cancel and Escape call onCancel.

import { cloneFill } from './fill-layers.js';
import { GRADIENT_STYLES } from './layer-style.js';
import {
  GRADIENT_PRESET_GROUPS,
  resolvePresetOpacity,
  resolvePresetStops
} from './gradient-presets.js';

const PRESETS = GRADIENT_PRESET_GROUPS.flatMap((g) => g.presets);

const TITLES = { solid: 'Color Fill', gradient: 'Gradient Fill', pattern: 'Pattern Fill' };

// Per fill type: [key, label, type, min, max, unit].
const FIELDS = {
  solid: [['color', 'Color', 'color']],
  gradient: [
    ['preset', 'Gradient', 'gradient'],
    ['style', 'Style', 'style'],
    ['angle', 'Angle', 'number', -180, 180, '°'],
    ['scale', 'Scale', 'number', 10, 150, '%'],
    ['reverse', 'Reverse', 'check']
  ],
  pattern: [['scale', 'Scale', 'number', 1, 1000, '%']]
};

/**
 * swatches() is the app's [fg, bg] for gradient presets that name them.
 * @param {{ doc?: Document, swatches?: () => string[] }} [deps]
 */
export function initFillLayerDialog({
  doc = document,
  swatches = () => ['#000000', '#ffffff']
} = {}) {
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const modal = el('div', 'modal hidden fill-layer-modal');
  modal.id = 'fill-layer-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const box = el('div', 'modal-box');
  const title = el('h2');
  const fields = el('div', 'fill-layer-fields');
  const buttons = el('div', 'modal-buttons');
  const cancelBtn = el('button', 'modal-btn secondary', 'Cancel');
  cancelBtn.id = 'fill-layer-cancel';
  const okBtn = el('button', 'modal-btn primary', 'OK');
  okBtn.id = 'fill-layer-ok';
  buttons.append(cancelBtn, okBtn);
  box.append(title, fields, buttons);
  modal.appendChild(box);
  doc.body.appendChild(modal);

  let work = null;
  let handlers = null;

  const preview = () => handlers?.onPreview?.(cloneFill(work));

  function control([key, label, type, min, max, unit]) {
    const row = el('label', 'modal-row');
    row.append(el('span', '', label));
    const set = (v) => {
      work[key] = v;
      preview();
    };
    let input;
    if (type === 'gradient' || type === 'style') {
      input = el('select');
      const options = type === 'style' ? GRADIENT_STYLES : PRESETS.map((p) => [p.name, p.name]);
      for (const [value, text] of options) {
        const opt = el('option', '', text);
        opt.value = value;
        input.appendChild(opt);
      }
      input.value = work[key] ?? '';
      input.addEventListener('change', () => {
        if (type === 'style') return set(input.value);
        // A preset sets the fill's own stops, with the colors it names resolved now.
        const preset = PRESETS.find((p) => p.name === input.value);
        if (!preset) return;
        const [fg, bg] = swatches();
        work.stops = resolvePresetStops(preset, fg, bg);
        work.opacityStops = resolvePresetOpacity(preset);
        set(preset.name);
      });
    } else if (type === 'check') {
      input = el('input');
      input.type = 'checkbox';
      input.checked = !!work[key];
      input.addEventListener('change', () => set(input.checked));
    } else if (type === 'color') {
      input = el('input');
      input.type = 'color';
      input.value = work[key];
      input.addEventListener('input', () => set(input.value));
    } else {
      input = el('input');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.value = String(work[key]);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) set(Math.max(min, Math.min(max, v)));
      });
    }
    input.dataset.field = key;
    input.setAttribute('aria-label', label);
    row.appendChild(input);
    if (unit) row.append(el('span', '', unit));
    return row;
  }

  const close = () => {
    modal.classList.add('hidden');
    handlers = null;
  };
  const cancel = () => {
    const h = handlers;
    close();
    h?.onCancel?.();
  };
  const confirm = () => {
    const h = handlers;
    const fill = cloneFill(work);
    close();
    h?.onOk?.(fill);
  };
  okBtn.addEventListener('click', confirm);
  cancelBtn.addEventListener('click', cancel);
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      confirm();
    }
  });

  return {
    modal,
    open(fill, h) {
      handlers = h;
      work = cloneFill(fill);
      title.textContent = TITLES[work.type];
      modal.setAttribute('aria-label', TITLES[work.type]);
      fields.innerHTML = '';
      for (const spec of FIELDS[work.type]) fields.appendChild(control(spec));
      modal.classList.remove('hidden');
      preview();
    }
  };
}
