// Paint — Brushes presets and Tool Presets (PhotoCraft crates/paint/src/presets.rs General
// set, ui-egui preset_panels.rs tool_presets_panel).
//
// A brush preset is { name, size, hardness, settings } where settings is a state.brushSettings
// object (brush-dynamics.js). A tool preset is { name, tool, options, brush? }: a copy of
// state.toolOptions[tool], plus the Brush Settings when the tool is the Brush. Presets the user
// saves live in localStorage; the General Brushes set is built in.

import { BRUSH_SETTINGS_DEFAULTS, brushSettingsOf } from './brush-dynamics.js';

export const BRUSH_PRESETS_KEY = 'paint.brushPresets';
export const TOOL_PRESETS_KEY = 'paint.toolPresets';

const general = (name, size, hardness, settings = {}) => ({
  name,
  group: 'General',
  builtin: true,
  size,
  hardness,
  settings: { ...BRUSH_SETTINGS_DEFAULTS, ...settings }
});

/** presets.rs general(): the presets a browser brush can paint (no pen-only dynamics). */
export const GENERAL_BRUSHES = Object.freeze([
  general('Hard Round', 30, 100),
  general('Soft Round', 45, 0),
  general('Hard Round Fine', 5, 100, { spacing: 10 }),
  general('Calligraphy Flat', 28, 100, { roundness: 20, angle: 45, spacing: 5 })
]);

function storageOf(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The presets saved under key, or [] when there are none or storage is unavailable. */
export function loadPresets(key, storage) {
  try {
    const list = JSON.parse(storageOf(storage)?.getItem(key) ?? '[]');
    return Array.isArray(list) ? list.filter((p) => p && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

export function savePresets(key, list, storage) {
  try {
    storageOf(storage)?.setItem(key, JSON.stringify(list));
  } catch {
    // Quota or private mode: the presets stay for this session only.
  }
}

/** Presets whose name contains query (case-insensitive). */
export function filterPresets(list, query) {
  const q = (query ?? '').trim().toLowerCase();
  return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
}

/** Every Brushes panel preset: the General set, then the saved ones. */
export function brushPresets(storage) {
  return [...GENERAL_BRUSHES, ...loadPresets(BRUSH_PRESETS_KEY, storage)];
}

/** Brushes › New Brush Preset: the Brush tool's Size and Hardness and the Brush Settings. */
export function brushPresetFrom(state, name) {
  const opts = state.toolOptions?.brush ?? {};
  return {
    name,
    group: 'Saved',
    size: opts.size ?? 20,
    hardness: opts.hardness ?? 100,
    settings: brushSettingsOf(state.brushSettings)
  };
}

/**
 * Pick a brush preset: the Brush tool takes its Size, Hardness, and Brush Settings, and the next
 * stroke uses that size whichever tool is active.
 */
export function applyBrushPreset(state, preset) {
  const opts = (state.toolOptions.brush ??= {});
  opts.size = preset.size;
  opts.hardness = preset.hardness;
  state.brushSettings = brushSettingsOf(preset.settings);
  state.brushSize = preset.size;
}

/** Tool Presets › New Tool Preset: the tool and a copy of its options. */
export function toolPresetFrom(state, tool, name) {
  const preset = { name, tool, options: { ...(state.toolOptions?.[tool] ?? {}) } };
  if (tool === 'brush') preset.brush = brushSettingsOf(state.brushSettings);
  return preset;
}

/** Pick a tool preset: its options replace the tool's. Returns the tool to switch to. */
export function applyToolPreset(state, preset) {
  state.toolOptions[preset.tool] = { ...(state.toolOptions[preset.tool] ?? {}), ...preset.options };
  if (preset.brush) state.brushSettings = brushSettingsOf(preset.brush);
  return preset.tool;
}

/** "<Tool> 1", "<Tool> 2", … : the first name not in list. */
export function nextPresetName(list, base) {
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!list.some((p) => p.name === name)) return name;
  }
}
