// Layer › Layer Style › <effect>… and the Layers footer's fx button (PhotoCraft layer_style.rs):
// Blending Options and a list of effects with checkboxes on the left, the selected page's
// controls on the right, and a live preview. open(styles, kind, { general, onPreview, onOk,
// onCancel }) edits a copy of styles and of general ({ blendMode, opacity 0..100 }, the layer's
// own); every change hands both to onPreview(styles, general), OK to onOk(styles, general), and
// Cancel and Escape call onCancel.

import { BLEND_MODES } from './layers.js';
import {
  BEVEL_DIRECTIONS,
  BEVEL_STYLES,
  BEVEL_TECHNIQUES,
  EFFECT_FIELDS,
  EFFECT_KINDS,
  EFFECT_LABELS,
  GLOW_SOURCES,
  GRADIENT_STYLES,
  STROKE_POSITIONS,
  defaultEffect,
  normalizeStyles,
  patternSnapshot
} from './layer-style.js';
import {
  GRADIENT_PRESET_GROUPS,
  resolvePresetOpacity,
  resolvePresetStops
} from './gradient-presets.js';

const BLENDING = 'blendingOptions';
const PRESETS = GRADIENT_PRESET_GROUPS.flatMap((g) => g.presets);

/**
 * pattern() is the tile a new Pattern Overlay takes (Edit › Define Pattern's, or a stand-in);
 * swatches() the app's [fg, bg] for gradient presets that use them.
 * @param {{ doc?: Document, pattern?: () => object | null, swatches?: () => string[] }} [deps]
 */
export function initLayerStyleDialog({
  doc = document,
  pattern = () => null,
  swatches = () => ['#000000', '#ffffff']
} = {}) {
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const modal = el('div', 'modal hidden layer-style-modal');
  modal.id = 'layer-style-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Layer Style');
  modal.setAttribute('aria-modal', 'true');
  const box = el('div', 'modal-box layer-style-box');
  const body = el('div', 'layer-style-body');
  const list = el('div', 'layer-style-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Styles');
  const fields = el('div', 'layer-style-fields');
  body.append(list, fields);
  const buttons = el('div', 'modal-buttons');
  const cancelBtn = el('button', 'modal-btn secondary', 'Cancel');
  cancelBtn.id = 'layer-style-cancel';
  const okBtn = el('button', 'modal-btn primary', 'OK');
  okBtn.id = 'layer-style-ok';
  buttons.append(cancelBtn, okBtn);
  box.append(el('h2', '', 'Layer Style'), body, buttons);
  modal.appendChild(box);
  doc.body.appendChild(modal);

  let work = null;
  let general = null;
  let current = EFFECT_KINDS[0];
  let handlers = null;

  const preview = () => handlers?.onPreview?.(normalizeStyles(work), { ...general });
  const effect = (kind) => {
    if (!work[kind]) {
      work[kind] = { ...defaultEffect(kind), enabled: false };
      if (kind === 'patternOverlay') work[kind].pattern = patternSnapshot(pattern());
    }
    return work[kind];
  };
  // The page's values: the layer's own and Fill on Blending Options, else the effect's.
  const values = (kind) =>
    kind === BLENDING ? { ...general, fillOpacity: work.fillOpacity ?? 100 } : effect(kind);

  function renderList() {
    list.innerHTML = '';
    const blending = el(
      'div',
      'layer-style-item layer-style-blending' + (current === BLENDING ? ' active' : '')
    );
    blending.dataset.effect = BLENDING;
    blending.setAttribute('role', 'option');
    blending.setAttribute('aria-selected', String(current === BLENDING));
    const blendingName = el('button', 'layer-style-name', EFFECT_LABELS[BLENDING]);
    blendingName.addEventListener('click', () => select(BLENDING, false));
    blending.appendChild(blendingName);
    list.appendChild(blending);
    for (const kind of EFFECT_KINDS) {
      const row = el('div', 'layer-style-item' + (kind === current ? ' active' : ''));
      row.dataset.effect = kind;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(kind === current));
      const check = el('input');
      check.type = 'checkbox';
      check.checked = !!work[kind]?.enabled;
      check.setAttribute('aria-label', EFFECT_LABELS[kind]);
      check.addEventListener('change', () => {
        effect(kind).enabled = check.checked;
        preview();
      });
      const name = el('button', 'layer-style-name', EFFECT_LABELS[kind]);
      // Picking an effect by name shows its controls and turns it on, as in Photoshop.
      name.addEventListener('click', () => select(kind, true));
      row.append(check, name);
      list.appendChild(row);
    }
  }

  function control(kind, [key, label, type, min, max, unit]) {
    const fx = values(kind);
    const row = el('label', 'modal-row layer-style-field');
    row.append(el('span', 'layer-style-label', label));
    const set = (v) => {
      fx[key] = v;
      if (kind !== BLENDING) fx.enabled = true;
      else if (key === 'fillOpacity') work.fillOpacity = v;
      else general[key] = v;
      renderList();
      preview();
    };
    let input;
    const choices = {
      blend: BLEND_MODES.map((m) => [m.value, m.label]),
      position: STROKE_POSITIONS,
      source: GLOW_SOURCES,
      gradientStyle: GRADIENT_STYLES,
      bevelStyle: BEVEL_STYLES,
      technique: BEVEL_TECHNIQUES,
      direction: BEVEL_DIRECTIONS,
      gradient: PRESETS.map((p) => [p.name, p.name])
    };
    if (type === 'gradient') {
      // A preset sets the effect's own stops, with the colors it names resolved now.
      input = el('select');
      for (const [value, text] of choices.gradient) {
        const opt = el('option', '', text);
        opt.value = value;
        input.appendChild(opt);
      }
      input.value = fx[key];
      input.addEventListener('change', () => {
        const preset = PRESETS.find((p) => p.name === input.value);
        if (!preset) return;
        const [fg, bg] = swatches();
        fx.stops = resolvePresetStops(preset, fg, bg);
        fx.opacityStops = resolvePresetOpacity(preset);
        set(preset.name);
      });
    } else if (type === 'check') {
      input = el('input');
      input.type = 'checkbox';
      input.checked = !!fx[key];
      input.addEventListener('change', () => set(input.checked));
    } else if (choices[type]) {
      input = el('select');
      const options = choices[type];
      for (const [value, text] of options) {
        const opt = el('option', '', text);
        opt.value = value;
        input.appendChild(opt);
      }
      input.value = fx[key];
      input.addEventListener('change', () => set(input.value));
    } else if (type === 'color') {
      input = el('input');
      input.type = 'color';
      input.value = fx[key];
      input.addEventListener('input', () => set(input.value));
    } else {
      input = el('input');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.value = String(fx[key]);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) set(Math.max(min, Math.min(max, v)));
      });
    }
    input.dataset.field = key;
    input.setAttribute('aria-label', label);
    row.appendChild(input);
    if (unit) row.append(el('span', 'layer-style-unit', unit));
    return row;
  }

  function renderFields() {
    fields.innerHTML = '';
    fields.appendChild(el('h3', 'layer-style-title', EFFECT_LABELS[current]));
    for (const spec of EFFECT_FIELDS[current]) fields.appendChild(control(current, spec));
  }

  function select(kind, enable) {
    current = kind;
    if (kind !== BLENDING && enable && !effect(kind).enabled) {
      effect(kind).enabled = true;
      preview();
    }
    renderList();
    renderFields();
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
    const styles = normalizeStyles(work);
    close();
    h?.onOk?.(styles, { ...general });
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
    open(styles, kind, h) {
      handlers = h;
      work = normalizeStyles(styles) ?? { enabled: true };
      general = { blendMode: 'source-over', opacity: 100, ...h?.general };
      // Editing a style shows the layer's effects again (Hide All Effects is undone for it).
      work.enabled = true;
      const first = EFFECT_KINDS.find((k) => work[k]?.enabled) ?? EFFECT_KINDS[0];
      modal.classList.remove('hidden');
      select(kind ?? first, !!kind && kind !== BLENDING);
      preview();
    }
  };
}
