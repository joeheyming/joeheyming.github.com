// Liquify's side panel (PhotoCraft liquify_ui.rs): the tool strip, Brush Tool Options (Size,
// Density, Pressure, Rate), Reconstruct with its Amount and Restore All, the Mask Options
// buttons, then OK and Cancel. It floats at the canvas column's right edge while Liquify owns
// the canvas, reusing the Blur Gallery panel's layout.

import { LIQUIFY_FIELDS, LIQUIFY_TOOLS } from './liquify.js';
import { iconSvg } from './icons.js';

/**
 * @param {HTMLElement} host
 * @param {{
 *   onTool: (tool: string) => void,
 *   onOption: (key: string, value: number) => void,
 *   onReconstruct: () => void,
 *   onRestoreAll: () => void,
 *   onMask: (how: 'none' | 'all' | 'invert') => void,
 *   onOk: () => void,
 *   onCancel: () => void
 * }} deps
 */
export function initLiquifyPanel(host, deps) {
  const panel = document.createElement('div');
  panel.className = 'blur-gallery-panel liquify-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Liquify');
  panel.hidden = true;
  const title = document.createElement('div');
  title.className = 'blur-gallery-title';
  title.textContent = 'Liquify';

  const button = (text, onClick, label = text) => {
    const b = document.createElement('button');
    b.type = 'button';
    if (typeof text === 'string') b.textContent = text;
    else b.appendChild(text);
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const strip = document.createElement('div');
  strip.className = 'blur-gallery-buttons liquify-tools';
  strip.setAttribute('role', 'toolbar');
  const toolButtons = LIQUIFY_TOOLS.map((t) => {
    const label = t.key ? `${t.label} (${t.key.toUpperCase()})` : t.label;
    const b = button(iconSvg(t.icon, 16), () => deps.onTool(t.id), label);
    b.dataset.tool = t.id;
    strip.appendChild(b);
    return b;
  });

  const slider = (f, onInput) => {
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
      value.textContent = range.value;
      onInput(Number(range.value));
    });
    row.append(label, range, value);
    return { row, range, value };
  };
  const fields = document.createElement('div');
  fields.className = 'blur-gallery-fields';
  const rows = LIQUIFY_FIELDS.map((f) => {
    const s = slider(f, (v) => deps.onOption(f.key, v));
    fields.appendChild(s.row);
    return { f, ...s };
  });
  const amountField = { key: 'amount', label: 'Amount', min: 0, max: 100 };
  const amount = slider(amountField, (v) => deps.onOption('amount', v));
  fields.appendChild(amount.row);
  rows.push({ f: amountField, ...amount });

  const recon = document.createElement('div');
  recon.className = 'blur-gallery-buttons';
  recon.append(
    button('Reconstruct…', () => deps.onReconstruct(), 'Reconstruct'),
    button('Restore All', () => deps.onRestoreAll())
  );
  const masks = document.createElement('div');
  masks.className = 'blur-gallery-buttons';
  masks.setAttribute('aria-label', 'Mask Options');
  masks.append(
    button('None', () => deps.onMask('none'), 'Mask None'),
    button('Mask All', () => deps.onMask('all')),
    button('Invert All', () => deps.onMask('invert'))
  );
  const buttons = document.createElement('div');
  buttons.className = 'blur-gallery-buttons';
  buttons.append(button('Cancel', () => deps.onCancel()), button('OK', () => deps.onOk()));
  panel.append(title, strip, fields, recon, masks, buttons);
  host.appendChild(panel);

  const sync = (opts) => {
    for (const b of toolButtons) {
      const on = b.dataset.tool === opts.tool;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('active', on);
    }
    for (const { f, range, value } of rows) {
      range.value = String(opts[f.key]);
      value.textContent = String(opts[f.key]);
    }
  };

  return {
    open(opts) {
      sync(opts);
      panel.hidden = false;
    },
    sync,
    close() {
      panel.hidden = true;
    }
  };
}
