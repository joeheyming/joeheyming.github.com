// Image › Analysis › Set Measurement Scale… dialog (PhotoCraft analysis_ui.rs dialog "scale").
// The markup is #measurement-scale-modal in index.html: Presets (Custom / Default), Pixel
// Length, Logical Length, Logical Units, and the Scale text. OK hands
// { preset, pixelLength, logicalLength, units } to onOk.

import { isDefaultMeasurementScale, measurementScaleText } from './measurement.js';

/**
 * @param {{ onOk: (f: { preset: string, pixelLength: number, logicalLength: number, units: string }) => void, doc?: Document }} deps
 * @returns {{ open: (scale: { pixelLength: number, logicalLength: number, units: string }) => void }}
 */
export function initMeasurementScaleDialog({ onOk, doc = document }) {
  const $ = (id) => doc.getElementById(id);
  const modal = $('measurement-scale-modal');
  if (!modal) return { open() {} };
  const preset = $('measurement-scale-preset');
  const pixel = $('measurement-scale-pixel');
  const logical = $('measurement-scale-logical');
  const units = $('measurement-scale-units');
  const text = $('measurement-scale-text');

  const fields = () => ({
    preset: preset.value,
    pixelLength: Number(pixel.value),
    logicalLength: Number(logical.value),
    units: units.value
  });
  // Default greys the fields out and reads 1 pixels = 1.0000 pixels.
  const sync = () => {
    const custom = preset.value !== 'default';
    for (const el of [pixel, logical, units]) el.disabled = !custom;
    const f = fields();
    text.textContent = custom
      ? measurementScaleText(f)
      : measurementScaleText({ pixelLength: 1, logicalLength: 1, units: 'pixels' });
  };
  for (const el of [preset, pixel, logical, units]) el.addEventListener('input', sync);
  preset.addEventListener('change', sync);

  const close = () => modal.classList.add('hidden');
  const confirm = () => {
    close();
    onOk(fields());
  };
  $('measurement-scale-ok')?.addEventListener('click', confirm);
  $('measurement-scale-cancel')?.addEventListener('click', close);
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
    open(scale) {
      preset.value = isDefaultMeasurementScale(scale) ? 'default' : 'custom';
      pixel.value = String(scale.pixelLength);
      logical.value = String(scale.logicalLength);
      units.value = scale.units;
      sync();
      modal.classList.remove('hidden');
      setTimeout(() => preset.focus(), 50);
    }
  };
}
