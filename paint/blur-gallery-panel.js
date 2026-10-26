// Blur Gallery's side panel (PhotoCraft blur_pins.rs dialog): the selected pin's sliders from
// GALLERY_FIELDS, then OK and Cancel. It floats at the canvas column's right edge while the
// gallery owns the canvas. Every slider edit calls onChange(key, value) in slider units.

import { GALLERY_FIELDS, GALLERY_KINDS } from './blur-gallery.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   onChange: (key: string, value: number) => void,
 *   onOk: () => void,
 *   onCancel: () => void
 * }} deps
 */
export function initBlurGalleryPanel(host, { onChange, onOk, onCancel }) {
  const panel = document.createElement('div');
  panel.className = 'blur-gallery-panel';
  panel.setAttribute('role', 'dialog');
  panel.hidden = true;
  const title = document.createElement('div');
  title.className = 'blur-gallery-title';
  const fields = document.createElement('div');
  fields.className = 'blur-gallery-fields';
  const buttons = document.createElement('div');
  buttons.className = 'blur-gallery-buttons';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = 'OK';
  ok.addEventListener('click', () => onOk());
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => onCancel());
  buttons.append(cancel, ok);
  panel.append(title, fields, buttons);
  host.appendChild(panel);
  let rows = [];

  const sync = (g) => {
    const p = g.pins[g.selected];
    for (const { f, range, value } of rows) {
      const v = p ? Math.round(p[f.key] * f.scale) : f.min;
      range.value = String(v);
      range.disabled = !p;
      value.textContent = `${v}${f.unit}`;
    }
  };

  return {
    open(g) {
      title.textContent = GALLERY_KINDS[g.kind].label;
      panel.setAttribute('aria-label', GALLERY_KINDS[g.kind].label);
      fields.replaceChildren();
      rows = GALLERY_FIELDS[g.kind].map((f) => {
        const row = document.createElement('div');
        row.className = 'adjust-field';
        row.dataset.key = f.key;
        const label = document.createElement('label');
        label.textContent = f.label;
        const range = document.createElement('input');
        range.type = 'range';
        range.min = String(f.min);
        range.max = String(f.max);
        range.step = '1';
        range.setAttribute('aria-label', f.label);
        const value = document.createElement('span');
        value.className = 'adjust-field-value';
        range.addEventListener('input', () => {
          value.textContent = `${range.value}${f.unit}`;
          onChange(f.key, Number(range.value));
        });
        row.append(label, range, value);
        fields.appendChild(row);
        return { f, range, value };
      });
      sync(g);
      panel.hidden = false;
    },
    sync,
    close() {
      panel.hidden = true;
    }
  };
}
