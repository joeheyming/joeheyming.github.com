// Image › Mode dialogs: Indexed Color… (#indexed-color-modal), Bitmap… (#bitmap-modal) and
// Color Table… (#color-table-modal) in index.html. Each OK hands its choices to onOk; Indexed
// Color and Bitmap remember them for the session. Color Table edits a pending copy of the
// table (a swatch click opens the color picker for that entry) and OK hands the new table over.

import { BITMAP_METHODS, INDEXED_DITHERS, INDEXED_PALETTES } from './indexed-mode.js';

/** Escape / Enter handling shared by the three dialogs. */
function wireModal(modal, close, confirm) {
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      confirm();
    }
  });
}

function fillSelect(sel, options) {
  if (sel.options.length) return;
  for (const { value, label } of options) {
    const opt = sel.ownerDocument.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sel.add(opt);
  }
}

/**
 * @param {{ onOk: (p: { palette: string, colors: number, dither: string, amount: number }) => void }} deps
 * @param {Document} [doc]
 */
export function initIndexedColorDialog({ onOk }, doc = document) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('indexed-color-modal');
  if (!modal) return { open() {} };
  const palette = $('indexed-palette');
  const dither = $('indexed-dither');
  const colors = $('indexed-colors');
  const amount = $('indexed-amount');
  fillSelect(palette, INDEXED_PALETTES);
  fillSelect(dither, INDEXED_DITHERS);
  palette.value = 'adaptive';
  dither.value = 'diffusion';
  // Exact keeps every color, so Colors does not apply; Amount only scales Diffusion.
  const sync = () => {
    colors.disabled = palette.value === 'exact';
    amount.disabled = dither.value !== 'diffusion';
  };
  palette.addEventListener('change', sync);
  dither.addEventListener('change', sync);
  sync();

  const close = () => modal.classList.add('hidden');
  const confirm = () => {
    close();
    const n = Math.min(256, Math.max(2, Math.round(Number(colors.value)) || 256));
    const a = Math.min(100, Math.max(0, Number(amount.value) || 0));
    colors.value = String(n);
    amount.value = String(a);
    onOk({ palette: palette.value, colors: n, dither: dither.value, amount: a });
  };
  $('indexed-ok')?.addEventListener('click', confirm);
  $('indexed-cancel')?.addEventListener('click', close);
  wireModal(modal, close, confirm);
  return {
    open() {
      modal.classList.remove('hidden');
      setTimeout(() => palette.focus(), 50);
    }
  };
}

/**
 * @param {{ onOk: (p: { method: string }) => void }} deps
 * @param {Document} [doc]
 */
export function initBitmapDialog({ onOk }, doc = document) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('bitmap-modal');
  if (!modal) return { open() {} };
  const method = $('bitmap-method');
  fillSelect(method, BITMAP_METHODS);
  method.value = 'diffusion';
  const close = () => modal.classList.add('hidden');
  const confirm = () => {
    close();
    onOk({ method: method.value });
  };
  $('bitmap-ok')?.addEventListener('click', confirm);
  $('bitmap-cancel')?.addEventListener('click', close);
  wireModal(modal, close, confirm);
  return {
    open() {
      modal.classList.remove('hidden');
      setTimeout(() => method.focus(), 50);
    }
  };
}

/**
 * @param {{ onOk: (table: string[]) => void }} deps
 * @param {Document} [doc]
 * @returns {{ open: (table: string[]) => void }}
 */
export function initColorTableDialog({ onOk }, doc = document) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('color-table-modal');
  if (!modal) return { open() {} };
  const grid = $('color-table-grid');
  const picker = $('color-table-picker');
  let pending = [];
  let editing = -1;

  const render = () => {
    grid.replaceChildren(
      ...pending.map((hex, i) => {
        const sw = doc.createElement('button');
        sw.type = 'button';
        sw.className = 'color-table-swatch';
        sw.dataset.index = String(i);
        sw.style.background = hex;
        sw.title = hex;
        sw.setAttribute('aria-label', `Entry ${i}: ${hex}`);
        return sw;
      })
    );
  };
  grid.addEventListener('click', (e) => {
    const sw = e.target.closest?.('.color-table-swatch');
    if (!sw) return;
    editing = Number(sw.dataset.index);
    picker.value = pending[editing];
    picker.click();
  });
  const pick = () => {
    if (editing < 0) return;
    pending = pending.map((c, i) => (i === editing ? picker.value.toLowerCase() : c));
    render();
  };
  picker.addEventListener('input', pick);
  picker.addEventListener('change', pick);

  const close = () => {
    modal.classList.add('hidden');
    editing = -1;
  };
  const confirm = () => {
    const table = pending;
    close();
    onOk(table);
  };
  $('color-table-ok')?.addEventListener('click', confirm);
  $('color-table-cancel')?.addEventListener('click', close);
  wireModal(modal, close, confirm);
  return {
    open(table) {
      pending = table.slice();
      render();
      modal.classList.remove('hidden');
      setTimeout(() => grid.querySelector('.color-table-swatch')?.focus(), 50);
    }
  };
}
