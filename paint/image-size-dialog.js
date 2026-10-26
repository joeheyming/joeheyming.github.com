// Image › Image Size… dialog (PhotoCraft sizing.rs image_size). The markup is #image-size-modal
// in index.html; Width / Height are typed in Pixels or Percent, Constrain Proportions keeps the
// original aspect, and Resample picks the method. OK hands { width, height, method } in pixels
// to onOk. The Resample choice is remembered for the session.

import { RESAMPLE_METHODS, SIZE_UNITS, fromUnit, linkedSize, toUnit } from './image-size.js';

const $ = (id) => document.getElementById(id);

function fillOptions(select, options) {
  if (!select || select.options.length) return;
  for (const { value, label } of options) select.add(new Option(label, value));
}

const shown = (v) => String(Math.round(v * 100) / 100);

/**
 * @param {{ size: () => [number, number], onOk: (p: { width: number, height: number,
 *   method: string }) => void }} deps
 * @returns {{ open: () => void }}
 */
export function initImageSizeDialog({ size, onOk }) {
  const modal = $('image-size-modal');
  if (!modal) return { open() {} };
  const wIn = $('image-size-w'),
    hIn = $('image-size-h'),
    unitSel = $('image-size-unit'),
    constrainBox = $('image-size-constrain'),
    methodSel = $('image-size-resample'),
    dims = $('image-size-dims');
  fillOptions(unitSel, SIZE_UNITS);
  fillOptions(methodSel, RESAMPLE_METHODS);
  let origW = 1,
    origH = 1,
    width = 1,
    height = 1,
    method = 'bicubic';

  const render = (skip) => {
    const unit = unitSel.value;
    if (skip !== wIn) wIn.value = shown(toUnit(width, unit, origW));
    if (skip !== hIn) hIn.value = shown(toUnit(height, unit, origH));
    if (dims) dims.textContent = `${width} px × ${height} px (was ${origW} px × ${origH} px)`;
  };
  const edit = (edited) => {
    const input = edited === 'width' ? wIn : hIn;
    const v = Number(input.value);
    if (!Number.isFinite(v) || v <= 0) return;
    const unit = unitSel.value;
    ({ width, height } = linkedSize({
      origW,
      origH,
      width: edited === 'width' ? fromUnit(v, unit, origW) : width,
      height: edited === 'height' ? fromUnit(v, unit, origH) : height,
      edited,
      constrain: constrainBox.checked
    }));
    render(input);
  };
  wIn.addEventListener('input', () => edit('width'));
  hIn.addEventListener('input', () => edit('height'));
  unitSel.addEventListener('change', () => render());
  constrainBox.addEventListener('change', () => {
    if (constrainBox.checked) {
      ({ width, height } = linkedSize({
        origW,
        origH,
        width,
        height,
        edited: 'width',
        constrain: true
      }));
      render();
    }
  });

  const close = () => modal.classList.add('hidden');
  const confirm = () => {
    close();
    method = methodSel.value;
    if (width !== origW || height !== origH) onOk({ width, height, method });
  };
  $('image-size-ok')?.addEventListener('click', confirm);
  $('image-size-cancel')?.addEventListener('click', close);
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
      [origW, origH] = size();
      width = origW;
      height = origH;
      constrainBox.checked = true;
      methodSel.value = method;
      render();
      modal.classList.remove('hidden');
      setTimeout(() => wIn.focus(), 50);
    }
  };
}
