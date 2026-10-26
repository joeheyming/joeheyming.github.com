// Paint — the Brushes panel: brush presets (General set + saved), the Brush Settings section,
// and the Tool Presets section (PhotoCraft brush_picker.rs, brush_settings, preset_panels.rs).
//
// The model lives in brush-presets.js and brush-dynamics.js; this file only builds the DOM.

import { BRUSH_SETTINGS_DEFAULTS, brushSettingsOf } from './brush-dynamics.js';
import {
  BRUSH_PRESETS_KEY,
  TOOL_PRESETS_KEY,
  applyBrushPreset,
  applyToolPreset,
  brushPresetFrom,
  brushPresets,
  filterPresets,
  loadPresets,
  nextPresetName,
  savePresets,
  toolPresetFrom
} from './brush-presets.js';

const pctField = (key, label, max = 100, min = 0) => ({ key, label, min, max, unit: '%' });

/** Brush Settings sections, Photoshop order. toggle is the section's enable key. */
export const BRUSH_SETTINGS_SECTIONS = [
  {
    title: 'Brush Tip Shape',
    fields: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, unit: '°' },
      pctField('roundness', 'Roundness', 100, 1),
      pctField('spacing', 'Spacing', 1000, 1)
    ]
  },
  {
    title: 'Shape Dynamics',
    toggle: 'shapeDynamics',
    fields: [
      pctField('sizeJitter', 'Size Jitter'),
      pctField('minDiameter', 'Minimum Diameter'),
      pctField('angleJitter', 'Angle Jitter'),
      pctField('roundnessJitter', 'Roundness Jitter'),
      pctField('minRoundness', 'Minimum Roundness')
    ]
  },
  {
    title: 'Scattering',
    toggle: 'scattering',
    fields: [
      pctField('scatter', 'Scatter', 1000),
      { key: 'bothAxes', label: 'Both Axes', type: 'checkbox' },
      { key: 'count', label: 'Count', min: 1, max: 16, unit: '' },
      pctField('countJitter', 'Count Jitter')
    ]
  },
  {
    title: 'Transfer',
    toggle: 'transfer',
    fields: [pctField('opacityJitter', 'Opacity Jitter'), pctField('flowJitter', 'Flow Jitter')]
  }
];

function el(doc, tag, props = {}, kids = []) {
  const node = doc.createElement(tag);
  Object.assign(node, props);
  for (const k of kids) node.append(k);
  return node;
}

/**
 * Fill the Brushes panel. hooks: onBrushChange() after a preset or setting changes the Brush,
 * selectTool(id) to switch tools, toolLabel(id) for preset names. Returns { refresh }.
 */
export function initBrushPanel(state, hooks = {}, doc = globalThis.document, storage) {
  const { onBrushChange = () => {}, selectTool = () => {}, toolLabel = (id) => id } = hooks;
  const presetList = doc.getElementById('brush-preset-list');
  const search = doc.getElementById('brush-search');
  const fields = doc.getElementById('brush-settings-fields');
  const toolList = doc.getElementById('tool-preset-list');
  const currentOnly = doc.getElementById('tool-presets-current');
  if (!presetList || !fields || !toolList) return { refresh() {} };
  state.brushSettings = brushSettingsOf(state.brushSettings);
  const inputs = new Map();

  function renderPresets() {
    presetList.replaceChildren();
    for (const preset of filterPresets(brushPresets(storage), search?.value)) {
      const btn = el(doc, 'button', {
        type: 'button',
        className: 'preset-item',
        textContent: `${preset.name} (${preset.size} px)`
      });
      btn.dataset.preset = preset.name;
      btn.addEventListener('click', () => {
        applyBrushPreset(state, preset);
        syncFields();
        onBrushChange();
      });
      presetList.append(el(doc, 'li', {}, [btn]));
    }
  }

  function renderFields() {
    fields.replaceChildren();
    for (const section of BRUSH_SETTINGS_SECTIONS) {
      const box = el(doc, 'fieldset', { className: 'brush-settings-group' });
      const legend = el(doc, 'legend');
      if (section.toggle) {
        const cb = el(doc, 'input', { type: 'checkbox' });
        cb.dataset.setting = section.toggle;
        cb.addEventListener('input', () => (state.brushSettings[section.toggle] = cb.checked));
        inputs.set(section.toggle, cb);
        legend.append(el(doc, 'label', {}, [cb, ` ${section.title}`]));
      } else legend.textContent = section.title;
      box.append(legend);
      for (const f of section.fields) {
        const input = el(doc, 'input', {
          type: f.type === 'checkbox' ? 'checkbox' : 'range',
          ...(f.type === 'checkbox' ? {} : { min: String(f.min), max: String(f.max), step: '1' })
        });
        input.dataset.setting = f.key;
        inputs.set(f.key, input);
        const out = f.type === 'checkbox' ? null : el(doc, 'output');
        const row = el(doc, 'label', { className: 'brush-setting-row' }, [
          el(doc, 'span', { textContent: f.label }),
          input,
          ...(out ? [out] : [])
        ]);
        input.addEventListener('input', () => {
          state.brushSettings[f.key] = f.type === 'checkbox' ? input.checked : Number(input.value);
          if (out) out.textContent = `${input.value}${f.unit}`;
        });
        box.append(row);
      }
      fields.append(box);
    }
  }

  function syncFields() {
    const b = (state.brushSettings = brushSettingsOf(state.brushSettings));
    for (const [key, input] of inputs) {
      if (input.type === 'checkbox') input.checked = !!b[key];
      else {
        input.value = String(b[key] ?? BRUSH_SETTINGS_DEFAULTS[key]);
        const out = input.nextElementSibling;
        const unit = key === 'angle' ? '°' : key === 'count' ? '' : '%';
        if (out) out.textContent = `${input.value}${unit}`;
      }
    }
  }

  function renderToolPresets() {
    toolList.replaceChildren();
    const all = loadPresets(TOOL_PRESETS_KEY, storage);
    const shown = currentOnly?.checked ? all.filter((p) => p.tool === state.tool) : all;
    for (const preset of shown) {
      const pick = el(doc, 'button', {
        type: 'button',
        className: 'preset-item',
        textContent: preset.name
      });
      pick.dataset.toolPreset = preset.name;
      pick.addEventListener('click', () => {
        selectTool(applyToolPreset(state, preset));
        syncFields();
        onBrushChange();
      });
      const del = el(doc, 'button', {
        type: 'button',
        className: 'preset-delete',
        textContent: '×',
        title: `Delete ${preset.name}`
      });
      del.setAttribute('aria-label', `Delete ${preset.name}`);
      del.addEventListener('click', () => {
        savePresets(
          TOOL_PRESETS_KEY,
          all.filter((p) => p !== preset),
          storage
        );
        renderToolPresets();
      });
      toolList.append(el(doc, 'li', {}, [pick, del]));
    }
  }

  search?.addEventListener('input', renderPresets);
  currentOnly?.addEventListener('change', renderToolPresets);
  doc.getElementById('btn-new-brush-preset')?.addEventListener('click', () => {
    const saved = loadPresets(BRUSH_PRESETS_KEY, storage);
    const name = nextPresetName(brushPresets(storage), 'Brush');
    savePresets(BRUSH_PRESETS_KEY, [...saved, brushPresetFrom(state, name)], storage);
    renderPresets();
  });
  doc.getElementById('btn-new-tool-preset')?.addEventListener('click', () => {
    const saved = loadPresets(TOOL_PRESETS_KEY, storage);
    const name = nextPresetName(saved, toolLabel(state.tool));
    savePresets(TOOL_PRESETS_KEY, [...saved, toolPresetFrom(state, state.tool, name)], storage);
    renderToolPresets();
  });

  renderPresets();
  renderFields();
  syncFields();
  renderToolPresets();
  return {
    refresh() {
      syncFields();
      renderToolPresets();
    }
  };
}
