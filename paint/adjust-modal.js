// Adjust-modal module for the paint app.
//
// Owns the modal that lets the user preview-and-apply layer
// adjustments and filters (brightness, hue/sat/lightness, threshold,
// pixelate, …). The menu items that open it are commands in
// `./commands.js` (Image › Adjustments and the Filter submenus).
//
// Drawing the actual pixels is delegated to the adjustment
// definitions in `./adjustments.js`; this module owns the modal
// lifecycle (open / preview-on-slider-change / cancel / commit) and
// caches the pre-adjustment ImageData as `baseImage` so previews
// stay non-destructive until the user clicks OK.
//
// Like `./selection.js`, stateful entry points take the paint app's
// `state` object and a small `deps` bag with the helpers we need
// (active layer ctx, pushUndo, refresh hooks) instead of importing
// them directly.

import {
  ADJUSTMENTS,
  curveLut,
  histogramBars,
  levelsDialogAuto,
  levelsHistograms
} from './adjustments.js';
import {
  dragCurvePoint,
  graphToLevel,
  levelToGraph,
  pickOrInsertCurvePoint
} from './curve-editor.js';
import {
  MAX_GRADIENT_STOPS,
  addStopAt,
  addStopInWidestGap,
  gradientMapStops,
  moveMapStop,
  removeStop,
  sampleStops,
  setStopColor,
  unitToHex
} from './gradient-stops.js';
import { GRADIENT_PRESET_GROUPS, resolvePresetStops } from './gradient-presets.js';
import { selectionToFullMask } from './selection.js';
import { closeMenus } from './menu-bar.js';

// Currently-open adjustment session: { id, baseImage, params, mask, ctx, W, H, pushUndo, onCommit },
// or, for an adjustment layer, { id, layer, params, oldParams, isNew, deps }.
// Module-local so the slider callbacks and cancel/commit buttons can share it.
let adjustSession = null;

const CURVE_GRAPH_SIZE = 256;
const LEVELS_HISTOGRAM_HEIGHT = 110;
const THRESHOLD_HISTOGRAM_HEIGHT = 90;
// PhotoCraft gradient_map_strip: 300 × 44, the bar inset 8 px with markers below it.
const STRIP_W = 300;
const STRIP_H = 44;
const STRIP_BAR = { left: 8, right: STRIP_W - 8, top: 2, bottom: 26 };
const STRIP_HIT = 6;

// A Channel choice's histogram from levelsHistograms' [R, G, B, composite]: RGB (Levels 'rgb',
// Curves 'master') is the composite.
export function channelHistogram(histograms, channel) {
  const i = ['red', 'green', 'blue'].indexOf(channel);
  return histograms[i >= 0 ? i : 3];
}

// PhotoCraft tone.rs draw_histogram: one bar per bin, bottom-aligned on a W × H surface.
function fillHistogram(g, h, W, H) {
  g.fillStyle = getComputedStyle(g.canvas).getPropertyValue('--fg-dim').trim() || '#888';
  const w = W / 256;
  for (const bar of histogramBars(h, W, H)) {
    if (bar.height > 0) g.fillRect(bar.x - w / 2, H - bar.height, w, bar.height);
  }
}

export function drawHistogram(canvas, h) {
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  fillHistogram(g, h, canvas.width, canvas.height);
}

// Draw one curve (params[key]) on the Curves graph: the channel histogram (when there is one),
// quarter grid, the identity diagonal, the spline, and its control points.
function drawCurveGraph(canvas, points, histogram = null) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const S = CURVE_GRAPH_SIZE;
  const css = getComputedStyle(canvas);
  const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  g.clearRect(0, 0, S, S);
  if (histogram) fillHistogram(g, histogram, S, S);
  g.lineWidth = 1;
  g.strokeStyle = color('--border', '#555');
  g.beginPath();
  for (let q = 1; q < 4; q++) {
    const t = Math.round((q * (S - 1)) / 4) + 0.5;
    g.moveTo(t, 0);
    g.lineTo(t, S);
    g.moveTo(0, t);
    g.lineTo(S, t);
  }
  g.moveTo(0, S);
  g.lineTo(S, 0);
  g.stroke();
  const table = curveLut(points);
  g.strokeStyle = color('--fg', '#eee');
  g.lineWidth = 1.5;
  g.beginPath();
  for (let x = 0; x < S; x++) {
    const v = table[Math.round((x / (S - 1)) * (table.length - 1))];
    const y = (1 - v) * (S - 1);
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.fillStyle = color('--accent', '#4af');
  for (const p of points) {
    const { x, y } = levelToGraph(p, S);
    g.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6);
  }
}

// The Curves editor for consecutive 'curve' fields: a channel select (one option per field) over
// a 256 × 256 graph. Pointer down picks or adds a point, drag moves it, and dragging a point off
// the graph removes it. Each edit stores a new point array in params[key]. histograms (from
// levelsHistograms) draws the select's channel behind the grid.
function renderCurveEditor(fieldsEl, curveFields, params, onChange, histograms = null) {
  const row = document.createElement('div');
  row.className = 'adjust-field';
  row.style.display = 'flex';
  row.style.flexDirection = 'column';
  row.style.alignItems = 'flex-start';
  const label = document.createElement('label');
  label.textContent = 'Channel ';
  const select = document.createElement('select');
  for (const f of curveFields) {
    const opt = document.createElement('option');
    opt.value = f.key;
    opt.textContent = f.label;
    select.appendChild(opt);
  }
  label.appendChild(select);
  const canvas = document.createElement('canvas');
  canvas.className = 'curve-graph';
  canvas.width = CURVE_GRAPH_SIZE;
  canvas.height = CURVE_GRAPH_SIZE;
  canvas.style.border = '1px solid var(--border)';
  canvas.style.cursor = 'crosshair';
  canvas.style.touchAction = 'none';
  const redraw = () =>
    drawCurveGraph(
      canvas,
      params[select.value],
      histograms && channelHistogram(histograms, select.value)
    );
  select.addEventListener('change', redraw);
  const levelAt = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) * CURVE_GRAPH_SIZE) / (r.width || CURVE_GRAPH_SIZE);
    const y = ((e.clientY - r.top) * CURVE_GRAPH_SIZE) / (r.height || CURVE_GRAPH_SIZE);
    return graphToLevel(x, y, CURVE_GRAPH_SIZE);
  };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const picked = pickOrInsertCurvePoint(params[select.value], levelAt(e));
    drag = { key: select.value, ...picked };
    params[drag.key] = picked.points;
    canvas.setPointerCapture?.(e.pointerId);
    redraw();
    onChange();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    params[drag.key] = dragCurvePoint(drag.points, drag.index, levelAt(e));
    redraw();
    onChange();
  });
  const end = () => {
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  row.appendChild(label);
  row.appendChild(canvas);
  fieldsEl.appendChild(row);
  redraw();
}

const stripX = (loc) => STRIP_BAR.left + loc * (STRIP_BAR.right - STRIP_BAR.left);
const stripLocation = (x) =>
  Math.min(1, Math.max(0, (x - STRIP_BAR.left) / (STRIP_BAR.right - STRIP_BAR.left)));

// The marker under (x, y) on the strip, last stop first, or -1 (PhotoCraft's hit: below the bar,
// within 6 px of the stop).
function stripHit(stops, x, y) {
  if (y < STRIP_BAR.bottom) return -1;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (Math.abs(stripX(stops[i][0]) - x) <= STRIP_HIT) return i;
  }
  return -1;
}

// The gradient bar (49 samples, as PhotoCraft's spectrum_bar) and one marker per stop: a
// triangle and a 10 × 10 swatch, the selected one bordered in the accent color.
function drawGradientStrip(canvas, stops, selected) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const css = getComputedStyle(canvas);
  const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const { left, right, top, bottom } = STRIP_BAR;
  g.clearRect(0, 0, STRIP_W, STRIP_H);
  const step = (right - left) / 48;
  for (let i = 0; i < 48; i++) {
    g.fillStyle = unitToHex(sampleStops(stops, (i + 0.5) / 48));
    g.fillRect(left + i * step, top, step + 0.5, bottom - top);
  }
  g.lineWidth = 1;
  g.strokeStyle = color('--border', '#555');
  g.strokeRect(left - 0.5, top - 0.5, right - left + 1, bottom - top + 1);
  stops.forEach(([at, hex], i) => {
    const x = stripX(at);
    const border = i === selected ? color('--accent', '#4af') : color('--fg-dim', '#888');
    g.fillStyle = border;
    g.beginPath();
    g.moveTo(x, bottom + 1);
    g.lineTo(x + 5, bottom + 5);
    g.lineTo(x - 5, bottom + 5);
    g.fill?.();
    g.fillStyle = hex;
    g.fillRect(x - 5, bottom + 5, 10, 10);
    g.strokeStyle = border;
    g.strokeRect(x - 5.5, bottom + 4.5, 11, 11);
  });
}

// PhotoCraft's Gradient Map editor: a Preset picker (GRADIENT_PRESET_GROUPS, Foreground /
// Background from swatches), the stop strip (pointer down on a marker selects it and dragging
// moves it; elsewhere adds a stop in the gradient's color there), then the selected stop's Color
// and Location, Remove, and Add Stop. Each edit stores a new params[f.key] array.
function renderGradientMapEditor(fieldsEl, f, params, onEdit, swatches) {
  const row = document.createElement('div');
  row.className = 'adjust-field';
  row.dataset.key = f.key;
  row.style.display = 'flex';
  row.style.flexDirection = 'column';
  row.style.alignItems = 'flex-start';
  row.style.gap = '6px';
  const presetLabel = document.createElement('label');
  presetLabel.textContent = 'Preset ';
  const preset = document.createElement('select');
  preset.className = 'gradient-map-preset';
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom';
  preset.appendChild(custom);
  GRADIENT_PRESET_GROUPS.forEach((g, gi) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = g.name;
    g.presets.forEach((p, pi) => {
      const opt = document.createElement('option');
      opt.value = `${gi}:${pi}`;
      opt.textContent = p.name;
      optgroup.appendChild(opt);
    });
    preset.appendChild(optgroup);
  });
  presetLabel.appendChild(preset);
  const canvas = document.createElement('canvas');
  canvas.className = 'gradient-map-strip';
  canvas.width = STRIP_W;
  canvas.height = STRIP_H;
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'pointer';
  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.flexWrap = 'wrap';
  controls.style.alignItems = 'center';
  controls.style.gap = '6px';
  const colorLabel = document.createElement('label');
  colorLabel.textContent = 'Color ';
  const color = document.createElement('input');
  color.type = 'color';
  color.className = 'gradient-stop-color';
  colorLabel.appendChild(color);
  const locationLabel = document.createElement('label');
  locationLabel.textContent = 'Location ';
  const location = document.createElement('input');
  location.type = 'number';
  location.className = 'gradient-stop-location';
  location.min = '0';
  location.max = '100';
  location.step = '0.1';
  location.style.width = '64px';
  locationLabel.append(location, ' %');
  const button = (cls, text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    return b;
  };
  const remove = button('gradient-stop-remove', 'Remove');
  const add = button('gradient-stop-add', 'Add Stop');
  controls.append(colorLabel, locationLabel, remove, add);
  row.append(presetLabel, canvas, controls);
  fieldsEl.appendChild(row);

  let stops = gradientMapStops(params);
  let selected = 0;
  const sync = () => {
    selected = Math.min(selected, stops.length - 1);
    color.value = stops[selected][1];
    location.value = String(Math.round(stops[selected][0] * 1000) / 10);
    remove.disabled = stops.length <= 2;
    add.disabled = stops.length >= MAX_GRADIENT_STOPS;
    drawGradientStrip(canvas, stops, selected);
  };
  // A manual stop edit leaves the stops no preset's, so the picker reads Custom again.
  const commit = (next, picked = 'custom') => {
    if (!next) return;
    stops = next.stops;
    selected = next.index;
    params[f.key] = stops;
    preset.value = picked;
    sync();
    onEdit();
  };
  const pointAt = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * STRIP_W) / (r.width || STRIP_W),
      y: ((e.clientY - r.top) * STRIP_H) / (r.height || STRIP_H)
    };
  };
  let drag = null;
  preset.addEventListener('change', () => {
    const [gi, pi] = preset.value.split(':').map(Number);
    const p = GRADIENT_PRESET_GROUPS[gi]?.presets[pi];
    if (!p) return;
    const [fg, bg] = swatches?.() ?? [];
    drag = null;
    commit({ stops: resolvePresetStops(p, fg, bg), index: 0 }, preset.value);
  });
  canvas.addEventListener('pointerdown', (e) => {
    const { x, y } = pointAt(e);
    const hit = stripHit(stops, x, y);
    if (hit < 0) {
      commit(addStopAt(stops, stripLocation(x)));
      return;
    }
    selected = hit;
    drag = { offset: x - stripX(stops[hit][0]) };
    canvas.setPointerCapture?.(e.pointerId);
    sync();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const at = stripLocation(pointAt(e).x - drag.offset);
    if (Math.round(at * 1000) / 1000 === stops[selected][0]) return;
    commit(moveMapStop(stops, selected, at));
  });
  const end = () => {
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  color.addEventListener('input', () => {
    commit({ stops: setStopColor(stops, selected, color.value), index: selected });
  });
  location.addEventListener('change', () => {
    const v = parseFloat(location.value);
    if (Number.isFinite(v)) commit(moveMapStop(stops, selected, v / 100));
    else sync();
  });
  remove.addEventListener('click', () => {
    if (stops.length > 2) commit(removeStop(stops, selected));
  });
  add.addEventListener('click', () => commit(addStopInWidestGap(stops)));
  sync();
}

// Range rows (or a checkbox for type 'checkbox', a color input for 'color', a stop strip for
// 'gradient', or one Curves editor for the 'curve' fields)
// for def.fields, writing into params and calling onChange after each input.
// A field with local: true is a dialog-only selector: its value lives here, not in params; its
// default may be a function of params. A select's onChange(params, value) may write params from it.
// A field with group: { key, value } shows only while that selector (or params[key]) equals value.
// A type 'readout' field (also local) shows f.text(params), refreshed on every edit; f.warn(params)
// colors it as a warning.
// histograms ([R, G, B, composite] from levelsHistograms) gives Levels its histogram and Auto
// button, Curves its graph histogram, and Threshold its composite strip. colors() returns the
// app's [foreground, background] hex colors for the Gradient Map presets.
function renderFields(
  def,
  params,
  note,
  onChange,
  histograms = null,
  colors = null,
  fieldsEl = document.getElementById('adjust-modal-fields')
) {
  fieldsEl.innerHTML = '';
  if (def.fields.length === 0) {
    // No-parameter adjustments — show preview directly without sliders.
    const el = document.createElement('div');
    el.style.fontSize = '13px';
    el.style.color = 'var(--fg-dim)';
    el.textContent = note;
    fieldsEl.appendChild(el);
    return;
  }
  const curveFields = def.fields.filter((f) => f.type === 'curve');
  if (curveFields.length) {
    renderCurveEditor(fieldsEl, curveFields, params, onChange, histograms);
  }
  const local = {};
  for (const f of def.fields) {
    if (f.local) local[f.key] = typeof f.default === 'function' ? f.default(params) : f.default;
  }
  const afterSelect = [];
  if (def === ADJUSTMENTS.levels && histograms) {
    afterSelect.push(renderLevelsHistogram(fieldsEl, histograms, params, local, () => changed()));
  }
  // Redraws that follow every edit (Threshold's level marker).
  const afterEdit = [];
  if (def === ADJUSTMENTS.threshold) {
    afterEdit.push(renderThresholdHistogram(fieldsEl, histograms, params));
  }
  const readouts = [];
  const syncReadouts = () => {
    for (const { el, f } of readouts) {
      el.textContent = f.text(params);
      el.style.color = f.warn?.(params) ? 'var(--warning)' : '';
    }
  };
  const grouped = [];
  const selects = [];
  const inGroup = (group) => {
    const v = group.key in local ? local[group.key] : params[group.key];
    return String(v) === String(group.value);
  };
  // Options with a group (Channel Mixer's Gray) are listed only while it matches; a select whose
  // value drops out of the list falls back to its first listed option.
  const syncOptions = () => {
    for (const { select, f, store } of selects) {
      const opts = f.options.filter((o) => !o.group || inGroup(o.group));
      const shown = [...select.options].map((o) => o.value);
      if (shown.join('\n') !== opts.map((o) => String(o.value)).join('\n')) {
        select.innerHTML = '';
        for (const o of opts) {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          select.appendChild(opt);
        }
      }
      if (opts.length && !opts.some((o) => String(o.value) === String(store[f.key]))) {
        store[f.key] = opts[0].value;
      }
      select.value = String(store[f.key]);
    }
  };
  const syncGroups = () => {
    syncOptions();
    for (const { row, group } of grouped) {
      row.hidden = !inGroup(group);
      // .adjust-field sets display: grid, which would override the hidden attribute.
      row.style.display = row.hidden ? 'none' : '';
    }
  };
  // Color inputs follow params, which a select's onChange may rewrite (Photo Filter's presets).
  const swatches = [];
  // Sliders follow params too: Hue / Saturation's Colorize starts saturation at 25.
  const sliders = [];
  const changed = () => {
    for (const { swatch, f } of swatches) swatch.value = String(params[f.key]);
    for (const { input, display, f } of sliders) {
      input.value = String(params[f.key]);
      display.textContent = String(params[f.key]);
    }
    syncReadouts();
    syncGroups();
    for (const fn of afterEdit) fn();
    onChange();
  };
  for (const f of def.fields) {
    if (f.type === 'curve') continue;
    if (f.type === 'gradient') {
      renderGradientMapEditor(fieldsEl, f, params, changed, colors);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'adjust-field';
    row.dataset.key = f.key;
    if (f.group) grouped.push({ row, group: f.group });
    const label = document.createElement('label');
    label.textContent = f.label;
    if (f.type === 'readout') {
      const el = document.createElement('span');
      el.className = 'adjust-field-value';
      el.style.gridColumn = '2 / -1';
      readouts.push({ el, f });
      row.append(label, el);
      fieldsEl.appendChild(row);
      continue;
    }
    if (f.type === 'checkbox') {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = (params[f.key] ?? f.default) !== false;
      box.addEventListener('change', (e) => {
        params[f.key] = e.target.checked;
        f.onChange?.(params, e.target.checked);
        changed();
      });
      label.prepend(box);
      label.style.gridColumn = '1 / -1';
      row.appendChild(label);
      fieldsEl.appendChild(row);
      continue;
    }
    if (f.type === 'color') {
      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.value = String(params[f.key]);
      swatches.push({ swatch, f });
      swatch.addEventListener('input', (e) => {
        params[f.key] = e.target.value;
        changed();
      });
      row.append(label, swatch);
      fieldsEl.appendChild(row);
      continue;
    }
    if (f.type === 'select') {
      const select = document.createElement('select');
      const store = f.local ? local : params;
      selects.push({ select, f, store });
      select.addEventListener('change', (e) => {
        store[f.key] = e.target.value;
        f.onChange?.(params, store[f.key]);
        syncGroups();
        for (const fn of afterSelect) fn();
        if (!f.local || f.onChange) changed();
      });
      row.append(label, select);
      fieldsEl.appendChild(row);
      continue;
    }
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(f.min);
    input.max = String(f.max);
    input.step = String(f.step ?? 1);
    input.value = String(params[f.key]);
    const display = document.createElement('span');
    display.className = 'adjust-field-value';
    display.textContent = String(params[f.key]);
    sliders.push({ input, display, f });
    input.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      params[f.key] = v;
      display.textContent = String(v);
      changed();
    });
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(display);
    fieldsEl.appendChild(row);
  }
  syncReadouts();
  syncGroups();
}

// PhotoCraft's Levels histogram (the Channel choice's bins) with its Auto button, which sets that
// channel's Black / White from levelsDialogAuto and its Gamma to 1. Returns the redraw callback.
function renderLevelsHistogram(fieldsEl, histograms, params, local, onAuto) {
  const row = document.createElement('div');
  row.className = 'adjust-field';
  row.style.display = 'flex';
  row.style.flexDirection = 'column';
  row.style.alignItems = 'flex-end';
  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'levels-auto';
  auto.textContent = 'Auto';
  const canvas = document.createElement('canvas');
  canvas.className = 'levels-histogram';
  canvas.width = 256;
  canvas.height = LEVELS_HISTOGRAM_HEIGHT;
  canvas.style.width = '100%';
  canvas.style.border = '1px solid var(--border)';
  const redraw = () => drawHistogram(canvas, channelHistogram(histograms, local.channel));
  auto.addEventListener('click', () => {
    const ch = local.channel;
    const key = (name) => (ch === 'rgb' ? name.toLowerCase() : ch + name);
    [params[key('Black')], params[key('White')]] = levelsDialogAuto(
      channelHistogram(histograms, ch)
    );
    params[key('Gamma')] = 1;
    onAuto();
  });
  row.append(auto, canvas);
  fieldsEl.appendChild(row);
  redraw();
  return redraw;
}

// PhotoCraft's Threshold strip: the composite histogram (when there is a base image) with an
// accent line at level / 255 of the width. Returns the redraw callback.
function renderThresholdHistogram(fieldsEl, histograms, params) {
  const canvas = document.createElement('canvas');
  canvas.className = 'threshold-histogram';
  canvas.width = 256;
  canvas.height = THRESHOLD_HISTOGRAM_HEIGHT;
  canvas.style.width = '100%';
  canvas.style.border = '1px solid var(--border)';
  const redraw = () => {
    const g = canvas.getContext('2d');
    if (!g) return;
    const { width: W, height: H } = canvas;
    g.clearRect(0, 0, W, H);
    if (histograms) fillHistogram(g, histograms[3], W, H);
    const x = (Number(params.level) / 255) * W;
    g.strokeStyle = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#4af';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  };
  fieldsEl.appendChild(canvas);
  redraw();
  return redraw;
}

/**
 * Open the dialog on an adjustment layer's params (adjustment-layers.js). Sliders edit
 * layer.params live; deps.onPreview redraws the composite. Cancel restores the old params
 * (and deps.onCancelNew removes a layer that was just created); OK on an existing layer
 * pushes 'Edit Adjustment Layer' with the old params in place first.
 */
export function openAdjustLayer(layer, isNew, deps) {
  const def = ADJUSTMENTS[layer.adjustmentId];
  if (!def) return;
  closeAdjustMenu();
  const oldParams = { ...layer.params };
  adjustSession = { id: layer.adjustmentId, layer, params: layer.params, oldParams, isNew, deps };
  document.getElementById('adjust-modal-title').textContent = def.label + ' Adjustment Layer';
  renderFields(
    def,
    layer.params,
    def.label + ' the layers below.',
    () => deps.onPreview?.(),
    null,
    deps.swatches
  );
  deps.onPreview?.();
  document.getElementById('adjust-modal').classList.remove('hidden');
}

/**
 * Properties panel: the adjustment layer's fields in container, editing layer.params live.
 * onChange runs after every edit (the panel pushes undo once, then redraws the composite).
 */
export function renderAdjustLayerFields(container, layer, onChange, swatches = null) {
  const def = ADJUSTMENTS[layer.adjustmentId];
  if (!def) return;
  const note = def.label + ' the layers below.';
  renderFields(def, layer.params, note, onChange, null, swatches, container);
}

export function openAdjust(id, state, deps) {
  const def = ADJUSTMENTS[id];
  if (!def) return;
  closeAdjustMenu();
  const ctx = deps.activeCtx();
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const baseImage = ctx.getImageData(0, 0, W, H);
  const mask = state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null;
  const params = {};
  for (const f of def.fields) if (!f.local) params[f.key] = f.default;
  // A color field with swatch: i starts from the app's foreground (0) or background (1).
  for (const f of def.fields) {
    const seed = f.swatch != null ? deps.swatches?.()?.[f.swatch] : null;
    if (seed) params[f.key] = seed;
  }
  adjustSession = {
    id,
    baseImage,
    params,
    mask,
    ctx,
    W,
    H,
    pushUndo: deps.pushUndo,
    onCommit: deps.onCommit,
    onApplied: deps.onApplied,
    onPreview: deps.onPreview
  };

  document.getElementById('adjust-modal-title').textContent = def.label;
  const note = 'Apply ' + def.label + (mask ? ' to selection' : ' to active layer') + '?';
  const histograms = ['levels', 'curves', 'threshold'].includes(id)
    ? levelsHistograms(baseImage, mask)
    : null;
  renderFields(def, params, note, previewAdjust, histograms, deps.swatches);
  previewAdjust();

  document.getElementById('adjust-modal').classList.remove('hidden');
}

export function previewAdjust() {
  if (!adjustSession || adjustSession.layer) return;
  const { id, baseImage, params, mask, ctx } = adjustSession;
  // Clone base image so the original stays intact between preview redraws.
  const work = ctx.createImageData(baseImage.width, baseImage.height);
  work.data.set(baseImage.data);
  ADJUSTMENTS[id].apply(work, params, mask);
  ctx.putImageData(work, 0, 0);
  adjustSession.onPreview?.();
}

// Put target's keys back to source's, dropping keys an edit added (a legacy Gradient Map layer
// gains params.stops on its first stop edit).
export function replaceParams(target, source) {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  Object.assign(target, source);
}

export function cancelAdjust() {
  const layerSession = adjustSession?.layer ? adjustSession : null;
  if (layerSession) {
    replaceParams(layerSession.layer.params, layerSession.oldParams);
    if (layerSession.isNew) layerSession.deps.onCancelNew?.(layerSession.layer);
    else layerSession.deps.onPreview?.();
  } else if (adjustSession) {
    adjustSession.ctx.putImageData(adjustSession.baseImage, 0, 0);
    adjustSession.onPreview?.();
  }
  adjustSession = null;
  document.getElementById('adjust-modal').classList.add('hidden');
}

export function commitAdjust() {
  if (!adjustSession) return;
  if (adjustSession.layer) {
    const { layer, oldParams, isNew, deps } = adjustSession;
    const params = { ...layer.params };
    if (!isNew) {
      // Undo snapshots the layer as it is, so put the old params back for the snapshot.
      replaceParams(layer.params, oldParams);
      deps.pushUndo('Edit Adjustment Layer');
      replaceParams(layer.params, params);
    }
    deps.onCommit?.();
    adjustSession = null;
    document.getElementById('adjust-modal').classList.add('hidden');
    return;
  }
  const def = ADJUSTMENTS[adjustSession.id];
  // Restore base, push undo, re-apply for the canonical record.
  adjustSession.ctx.putImageData(adjustSession.baseImage, 0, 0);
  adjustSession.pushUndo(def.label);
  const work = adjustSession.ctx.createImageData(adjustSession.W, adjustSession.H);
  work.data.set(adjustSession.baseImage.data);
  def.apply(work, adjustSession.params, adjustSession.mask);
  adjustSession.ctx.putImageData(work, 0, 0);
  adjustSession.onApplied?.(adjustSession.id, adjustSession.params);
  adjustSession.onCommit?.();
  adjustSession = null;
  document.getElementById('adjust-modal').classList.add('hidden');
}

// Adjustments sit in the menu bar's Image menu; opening one closes it.

export function closeAdjustMenu() {
  closeMenus();
}
