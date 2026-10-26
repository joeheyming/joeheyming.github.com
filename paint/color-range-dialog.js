// Select › Color Range… dialog (PhotoCraft color_range_ui.rs). The markup is #color-range-modal
// in index.html. The preview shows the coverage as gray; a click on it is the eyedropper (Shift
// adds to the sample, Alt subtracts). It opens with the foreground color as the sample, like
// PhotoCraft. OK hands the soft 0..255 coverage to onOk.

import {
  COLOR_RANGE_DEFAULTS,
  COLOR_RANGE_SELECT,
  colorRangeCoverage,
  pickSample
} from './color-range.js';
import { hexToRgb } from './selection.js';
import { iconSvg } from './icons.js';

const $ = (id) => document.getElementById(id);
const PREVIEW_PX = 200;
const NUMBER_FIELDS = [
  'fuzziness',
  'toneFuzziness',
  'shadowsLevel',
  'highlightsLevel',
  'midtonesLow',
  'midtonesHigh'
];

/**
 * @param {{ image: () => ImageData, foreground: () => string, onOk: (soft: Uint8Array, W: number, H: number) => void }} deps
 * @returns {{ open: () => void }}
 */
export function initColorRangeDialog({ image, foreground, onOk }) {
  const modal = $('color-range-modal');
  if (!modal) return { open() {} };
  const selectEl = $('color-range-select');
  if (!selectEl.options.length) {
    for (const { value, label } of COLOR_RANGE_SELECT) selectEl.add(new Option(label, value));
  }
  const preview = /** @type {HTMLCanvasElement} */ ($('color-range-preview'));
  const toolBtns = [...modal.querySelectorAll('[data-range-tool]')];
  for (const b of toolBtns) if (!b.querySelector('svg')) b.prepend(iconSvg('pipette', 16));

  let img = null;
  let samples = [];
  let tool = 'sample';
  let soft = null;

  const params = () => {
    const p = { ...COLOR_RANGE_DEFAULTS, select: selectEl.value };
    p.invert = $('color-range-invert').checked;
    for (const k of NUMBER_FIELDS) {
      const v = Number($(`color-range-${k}`).value);
      if (Number.isFinite(v)) p[k] = v;
    }
    return p;
  };

  const showRows = () => {
    const sel = selectEl.value;
    for (const row of modal.querySelectorAll('[data-range-for]')) {
      row.hidden = !row.dataset.rangeFor.split(' ').includes(sel);
    }
  };

  const refresh = () => {
    if (!img) return;
    soft = colorRangeCoverage(img, params(), samples);
    const W = img.width;
    const H = img.height;
    const scale = Math.min(1, PREVIEW_PX / Math.max(W, H));
    preview.width = Math.max(1, Math.round(W * scale));
    preview.height = Math.max(1, Math.round(H * scale));
    const pctx = preview.getContext('2d');
    if (!pctx) return;
    const out = pctx.createImageData(preview.width, preview.height);
    for (let y = 0; y < preview.height; y++) {
      const sy = Math.min(H - 1, Math.floor(y / scale));
      for (let x = 0; x < preview.width; x++) {
        const v = soft[sy * W + Math.min(W - 1, Math.floor(x / scale))];
        const o = (y * preview.width + x) * 4;
        out.data[o] = out.data[o + 1] = out.data[o + 2] = v;
        out.data[o + 3] = 255;
      }
    }
    pctx.putImageData(out, 0, 0);
  };

  const setTool = (t) => {
    tool = t;
    for (const b of toolBtns) b.setAttribute('aria-checked', String(b.dataset.rangeTool === t));
  };
  for (const b of toolBtns) b.addEventListener('click', () => setTool(b.dataset.rangeTool));

  preview.addEventListener('click', (e) => {
    if (!img || selectEl.value !== 'sampledColors') return;
    const r = preview.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / (r.width || 1)) * img.width);
    const y = Math.floor(((e.clientY - r.top) / (r.height || 1)) * img.height);
    const px = Math.min(img.width - 1, Math.max(0, x));
    const py = Math.min(img.height - 1, Math.max(0, y));
    const i = (py * img.width + px) * 4;
    const how = e.shiftKey ? 'add' : e.altKey ? 'subtract' : tool;
    samples = pickSample(samples, [img.data[i], img.data[i + 1], img.data[i + 2]], how);
    refresh();
  });

  selectEl.addEventListener('change', () => {
    showRows();
    refresh();
  });
  modal.addEventListener('input', refresh);

  const close = () => {
    modal.classList.add('hidden');
    img = null;
  };
  const confirm = () => {
    refresh();
    const result = soft;
    const W = img?.width ?? 0;
    const H = img?.height ?? 0;
    close();
    if (result) onOk(result, W, H);
  };
  $('color-range-ok')?.addEventListener('click', confirm);
  $('color-range-cancel')?.addEventListener('click', close);
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
    open() {
      img = image();
      samples = pickSample([], hexToRgb(foreground()), 'sample');
      setTool('sample');
      showRows();
      modal.classList.remove('hidden');
      refresh();
      setTimeout(() => selectEl.focus(), 50);
    }
  };
}
