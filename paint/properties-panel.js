// Paint — the Properties | Adjustments dock group (PhotoCraft panels.rs properties /
// adjustments_grid). Properties edits the active layer: an adjustment layer's params live, the
// mask's Density and Feather (applied at composite time, layer-mask.js compositeMask), or shows a
// pixel layer's size. Adjustments is a grid of one-click adjustment layers.

import { ADJUSTMENTS } from './adjustments.js';
import { isAdjustmentLayer } from './adjustment-layers.js';
import { renderAdjustLayerFields, replaceParams } from './adjust-modal.js';
import { iconSvg } from './icons.js';
import { MASK_FEATHER_MAX, maskDensity, maskFeather } from './layer-mask.js';
import { selectDockTab } from './dock.js';

// PhotoCraft's Adjustments panel, in its order: [Paint adjustment id, icon].
export const ADJUSTMENTS_PANEL = [
  ['brightness', 'sun'],
  ['levels', 'gauge'],
  ['curves', 'pen-tool'],
  ['exposure', 'scan'],
  ['vibrance', 'sparkles'],
  ['hsl', 'droplet'],
  ['colorBalance', 'blend'],
  ['blackWhite', 'contrast'],
  ['photoFilter', 'circle-dot'],
  ['channelMixer', 'sliders-horizontal'],
  ['invert', 'squares-subtract'],
  ['posterize', 'layers'],
  ['threshold', 'square'],
  ['gradientMap', 'palette'],
  ['selectiveColor', 'swatch-book'],
  ['colorLookup', 'grid-3x3']
];

/** What Properties shows for a layer, top to bottom: 'adjustment' | 'pixel', then 'mask'. */
export function propertiesSections(layer) {
  if (!layer) return [];
  const out = [isAdjustmentLayer(layer) ? 'adjustment' : 'pixel'];
  if (layer.mask) out.push('mask');
  return out;
}

/**
 * Properties › Density (0..100 %) and Feather (0..1000 px) written onto the layer record.
 * Returns true when either changed.
 */
export function setMaskProperties(layer, { density, feather } = {}) {
  const before = [maskDensity(layer), maskFeather(layer)];
  if (density != null) layer.maskDensity = Math.max(0, Math.min(100, Number(density) || 0)) / 100;
  if (feather != null) {
    layer.maskFeather = Math.max(0, Math.min(MASK_FEATHER_MAX, Number(feather) || 0));
  }
  layer.maskComposite = null;
  return before[0] !== maskDensity(layer) || before[1] !== maskFeather(layer);
}

function heading(doc, text) {
  const h = doc.createElement('div');
  h.className = 'properties-heading';
  h.textContent = text;
  return h;
}

/**
 * deps: activeLayer(), size() → [W, H], pushUndo(label), undoTop(), onAdjustmentEdit(layer),
 * onMaskEdit(layer), newAdjustmentLayer(id), swatches().
 * Renders the active layer at once. Returns { render(force), show() }: render rebuilds only when
 * the layer or its sections changed.
 */
export function initPropertiesPanel(deps, doc = document) {
  const panel = doc.getElementById('panel-properties');
  const grid = doc.getElementById('panel-adjustments');
  const tab = doc.getElementById('tab-properties');
  if (grid) {
    grid.innerHTML = '';
    const note = doc.createElement('p');
    note.className = 'properties-heading';
    note.textContent = 'Add an adjustment';
    const wrap = doc.createElement('div');
    wrap.className = 'adjustments-grid';
    for (const [id, icon] of ADJUSTMENTS_PANEL) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'adjustments-grid-btn';
      btn.dataset.adjustment = id;
      btn.title = ADJUSTMENTS[id]?.label ?? id;
      btn.setAttribute('aria-label', btn.title);
      btn.appendChild(iconSvg(icon, 18));
      btn.addEventListener('click', () => {
        deps.newAdjustmentLayer(id);
        if (tab) selectDockTab(tab);
      });
      wrap.appendChild(btn);
    }
    grid.append(note, wrap);
  }

  let key = null;

  function adjustmentSection(layer) {
    const box = doc.createElement('div');
    box.className = 'properties-section';
    box.appendChild(heading(doc, ADJUSTMENTS[layer.adjustmentId]?.label ?? 'Adjustment'));
    const fields = doc.createElement('div');
    fields.className = 'properties-fields';
    box.appendChild(fields);
    // Edits in a row share one 'Edit Adjustment Layer' undo; any other history step starts a new
    // one. The snapshot needs the params as they were before this edit.
    let before = { ...layer.params };
    let entry = null;
    renderAdjustLayerFields(
      fields,
      layer,
      () => {
        const now = { ...layer.params };
        if (!entry || entry !== deps.undoTop()) {
          replaceParams(layer.params, before);
          deps.pushUndo('Edit Adjustment Layer');
          replaceParams(layer.params, now);
          entry = deps.undoTop();
        }
        before = now;
        deps.onAdjustmentEdit(layer);
      },
      deps.swatches
    );
    return box;
  }

  function pixelSection(layer) {
    const box = doc.createElement('div');
    box.className = 'properties-section';
    const pixel = !layer.kind || layer.kind === 'pixel';
    box.appendChild(heading(doc, pixel ? 'Pixel Layer' : layer.name));
    const [W, H] = deps.size();
    const row = doc.createElement('div');
    row.className = 'properties-size';
    row.textContent = `W: ${W} px  H: ${H} px`;
    box.appendChild(row);
    return box;
  }

  function slider(label, value, max, unit, onInput) {
    const row = doc.createElement('label');
    row.className = 'properties-row';
    const name = doc.createElement('span');
    name.textContent = label;
    const input = doc.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    const out = doc.createElement('span');
    out.className = 'properties-value';
    out.textContent = value + unit;
    // A drag is one 'Mask Properties' undo: pushed on its first input, reset on change.
    let pushed = false;
    input.addEventListener('input', () => {
      if (!pushed) deps.pushUndo('Mask Properties');
      pushed = true;
      out.textContent = input.value + unit;
      onInput(Number(input.value));
    });
    input.addEventListener('change', () => (pushed = false));
    row.append(name, input, out);
    return row;
  }

  function maskSection(layer) {
    const box = doc.createElement('div');
    box.className = 'properties-section';
    box.appendChild(heading(doc, 'Masks'));
    const edited = () => deps.onMaskEdit(layer);
    box.appendChild(
      slider('Density', Math.round(maskDensity(layer) * 100), 100, '%', (v) => {
        if (setMaskProperties(layer, { density: v })) edited();
      })
    );
    box.appendChild(
      slider('Feather', Math.round(maskFeather(layer)), MASK_FEATHER_MAX, ' px', (v) => {
        if (setMaskProperties(layer, { feather: v })) edited();
      })
    );
    return box;
  }

  function render(force = false) {
    if (!panel) return;
    const layer = deps.activeLayer();
    const sections = propertiesSections(layer);
    const next = layer ? `${layer.id}:${sections.join(',')}` : '';
    if (!force && next === key) return;
    key = next;
    panel.innerHTML = '';
    if (!sections.length) {
      const empty = doc.createElement('p');
      empty.className = 'panel-empty';
      empty.textContent = 'No properties';
      panel.appendChild(empty);
      return;
    }
    for (const s of sections) {
      if (s === 'adjustment') panel.appendChild(adjustmentSection(layer));
      else if (s === 'pixel') panel.appendChild(pixelSection(layer));
      else panel.appendChild(maskSection(layer));
    }
  }

  /** Show Properties for the active layer (double-click on an adjustment layer). */
  function show() {
    if (tab) selectDockTab(tab);
    render(true);
  }

  // index.html ships a placeholder paragraph; the first paint replaces it with the active layer.
  render(true);
  return { render, show };
}
