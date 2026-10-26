// Edit › Fill… and Edit › Stroke… dialogs (PhotoCraft fill_ui.rs / stroke_ui.rs). The markup is
// #fill-modal and #stroke-modal in index.html; the Contents, Location, and Mode choices are
// filled in from FILL_CONTENTS, STROKE_LOCATIONS, and BLEND_MODES. OK remembers the choices for
// the session, so the dialog reopens with them (PhotoCraft keeps them in its preferences).

import { BLEND_MODES } from './layers.js';
import { FILL_CONTENTS, STROKE_LOCATIONS, strokeWidth } from './fill-stroke.js';

const $ = (id) => document.getElementById(id);

function fillOptions(select, options) {
  if (!select || select.options.length) return;
  for (const { value, label } of options) select.add(new Option(label, value));
}

function percent(input) {
  const v = Number(input?.value);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
}

function wire(modal, ok, cancel, onOk) {
  const close = () => modal.classList.add('hidden');
  $(ok)?.addEventListener('click', () => {
    close();
    onOk();
  });
  $(cancel)?.addEventListener('click', close);
  modal.addEventListener('keydown', (e) => {
    // The app's keydown handler would read Escape as Deselect.
    if (e.key === 'Escape' || e.key === 'Enter') e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      close();
      onOk();
    }
  });
}

/**
 * @param {{ foreground: () => string, onFill: (p: object) => void, onStroke: (p: object) => void }} deps
 * @returns {{ openFill: () => void, openStroke: () => void }}
 */
export function initFillStrokeDialogs({ foreground, onFill, onStroke }) {
  const fillModal = $('fill-modal'),
    strokeModal = $('stroke-modal');
  let lastFill = null,
    lastStroke = null;

  fillOptions($('fill-contents'), FILL_CONTENTS);
  fillOptions($('fill-mode'), BLEND_MODES);
  fillOptions($('stroke-mode'), BLEND_MODES);
  const radios = strokeModal?.querySelector('.modal-radios');
  if (radios && !radios.children.length) {
    for (const { value, label } of STROKE_LOCATIONS) {
      const l = document.createElement('label');
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'stroke-location';
      r.value = value;
      l.append(r, ` ${label}`);
      radios.append(l);
    }
  }
  const syncColorRow = () => {
    const row = $('fill-color-row');
    if (row) row.hidden = $('fill-contents')?.value !== 'color';
  };
  $('fill-contents')?.addEventListener('change', syncColorRow);

  const readFill = () => ({
    contents: $('fill-contents').value,
    color: $('fill-color').value,
    mode: $('fill-mode').value,
    opacity: percent($('fill-opacity')),
    preserveTransparency: $('fill-preserve').checked
  });
  const readStroke = () => ({
    width: strokeWidth($('stroke-width').value),
    color: $('stroke-color').value,
    location: strokeModal.querySelector('input[name="stroke-location"]:checked')?.value ?? 'center',
    mode: $('stroke-mode').value,
    opacity: percent($('stroke-opacity')),
    preserveTransparency: $('stroke-preserve').checked
  });

  if (fillModal) {
    wire(fillModal, 'fill-ok', 'fill-cancel', () => {
      lastFill = readFill();
      onFill(lastFill);
    });
  }
  if (strokeModal) {
    wire(strokeModal, 'stroke-ok', 'stroke-cancel', () => {
      lastStroke = readStroke();
      onStroke(lastStroke);
    });
  }

  return {
    openFill() {
      if (!fillModal) return;
      // Photoshop's defaults (fill_ui.rs default_fields), overridden by the last choices.
      const p = {
        contents: 'foreground',
        color: foreground(),
        mode: 'source-over',
        opacity: 100,
        preserveTransparency: false,
        ...lastFill
      };
      $('fill-contents').value = p.contents;
      $('fill-color').value = p.color;
      $('fill-mode').value = p.mode;
      $('fill-opacity').value = String(p.opacity);
      $('fill-preserve').checked = p.preserveTransparency;
      syncColorRow();
      fillModal.classList.remove('hidden');
      setTimeout(() => $('fill-contents')?.focus(), 50);
    },
    openStroke() {
      if (!strokeModal) return;
      const p = {
        width: 1,
        color: foreground(),
        location: 'center',
        mode: 'source-over',
        opacity: 100,
        preserveTransparency: false,
        ...lastStroke
      };
      $('stroke-width').value = String(p.width);
      $('stroke-color').value = p.color;
      for (const r of strokeModal.querySelectorAll('input[name="stroke-location"]')) {
        r.checked = r.value === p.location;
      }
      $('stroke-mode').value = p.mode;
      $('stroke-opacity').value = String(p.opacity);
      $('stroke-preserve').checked = p.preserveTransparency;
      strokeModal.classList.remove('hidden');
      setTimeout(() => $('stroke-width')?.focus(), 50);
    }
  };
}
