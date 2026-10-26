// Filter › Last Filter and Edit › Fade… (PhotoCraft engine filters.rs last_filter and
// edit_menu_cmds.rs fadeable / fade_surface). Pure: paint.js records what ran and owns undo.
//
// state.lastFilter is { id, params } of the most recent Filter menu command; Last Filter reruns
// it with those params on the active layer. state.fadeSource is { entry, label }: the undo entry
// a fadeable step pushed (its pixels are the "before"). Fade is enabled while that entry is still
// the top of the undo stack, so any later step, undo, or redo turns it off.

import { composite } from './fill-stroke.js';

// edit.fade's Mode list (PhotoCraft spec order), as BLEND_MODES values.
export const FADE_MODES = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'difference', label: 'Difference' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' }
];

// Tools whose undo rows are not paint strokes (selections, view, measuring, type, crop).
const NOT_PAINT = new Set([
  'select',
  'eyedropper',
  'ruler',
  'count',
  'text',
  'verticalType',
  'horizontalTypeMask',
  'verticalTypeMask',
  'rectSelect',
  'ellipseSelect',
  'lasso',
  'polyLasso',
  'magneticLasso',
  'quickSelection',
  'magicWand',
  'crop',
  'perspectiveCrop',
  'move',
  'hand',
  'zoom'
]);

/**
 * The pushUndo labels Fade can blend back: adjustments and filters, Fill, Stroke, and paint
 * tool strokes.
 * @param {Record<string, { label: string }>} adjustments
 * @param {Record<string, { label: string }>} tools
 * @returns {Set<string>}
 */
export function fadeableLabels(adjustments, tools) {
  const set = new Set(['Fill', 'Stroke']);
  for (const def of Object.values(adjustments)) set.add(def.label);
  for (const [id, tool] of Object.entries(tools)) if (!NOT_PAINT.has(id)) set.add(tool.label);
  return set;
}

/** After pushUndo(label): remember the new top entry if the step it records can be faded. */
export function noteFadeStep(state, label, labels) {
  const entry = state.undoStack?.at(-1);
  state.fadeSource = entry && entry.data && !entry.stack && labels.has(label) ? { entry, label } : null;
}

/** Fade… is enabled while the faded step is still the last one and its layer is active. */
export function canFade(state) {
  const f = state.fadeSource;
  if (!f || state.undoStack?.at(-1) !== f.entry) return false;
  return state.layers?.[state.activeLayerIdx]?.id === f.entry.layerId;
}

/** Remember a Filter menu command for Last Filter (params are copied, never shared). */
export function recordLastFilter(state, id, params) {
  state.lastFilter = { id, params: { ...params } };
}

/** Last Filter's menu label: the filter's name once one has run. */
export function lastFilterLabel(state, adjustments) {
  const def = state.lastFilter && adjustments[state.lastFilter.id];
  return def ? `Last Filter (${def.label.replace(/…$/, '')})` : 'Last Filter';
}

/**
 * Edit › Fade: blend `after` (RGBA bytes, rewritten in place) back towards `before` as
 * before + opacity × (B(before, after) − before), premultiplied so alpha fades too.
 * opacity is 0..100; mode is a FADE_MODES value.
 * @param {Uint8ClampedArray} before
 * @param {Uint8ClampedArray} after
 * @param {number} opacity
 * @param {string} [mode]
 */
export function fadePixels(before, after, opacity, mode = 'source-over') {
  const k = Math.max(0, Math.min(100, Number(opacity) || 0)) / 100;
  const b = [0, 0, 0, 0],
    a = [0, 0, 0, 0],
    blended = [0, 0, 0, 0];
  for (let i = 0; i < after.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      b[c] = before[i + c] / 255;
      a[c] = after[i + c] / 255;
    }
    // Normal is a plain lerp; other modes composite the result over the old pixels first.
    const t = mode === 'source-over' ? a : (composite(mode, b, a, 1, false, blended), blended);
    const ao = b[3] + (t[3] - b[3]) * k;
    for (let c = 0; c < 3; c++) {
      const pm = b[c] * b[3] + (t[c] * t[3] - b[c] * b[3]) * k;
      after[i + c] = Math.round((ao > 1e-9 ? pm / ao : 0) * 255);
    }
    after[i + 3] = Math.round(ao * 255);
  }
}
