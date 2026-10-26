// Adjustment layers (PhotoCraft Layer > New Adjustment Layer). An adjustment layer holds an
// ADJUSTMENTS id and its params instead of pixels. It runs that adjustment on the composite of
// the layers below it and mixes the result back by opacity × mask / 255.

import { ADJUSTMENTS } from './adjustments.js';
import { syncLayerMask } from './layer-dom.js';
import { compositeMask, newLayerMask } from './layer-mask.js';
import { createLayer } from './layer-shell.js';

// The Layer > New Adjustment Layer submenu, in PhotoCraft's order.
export const ADJUSTMENT_LAYER_IDS = [
  'brightness',
  'levels',
  'curves',
  'exposure',
  'vibrance',
  'hsl',
  'colorBalance',
  'blackWhite',
  'photoFilter',
  'channelMixer',
  'colorLookup',
  'gradientMap',
  'selectiveColor',
  'invert',
  'threshold',
  'posterize'
];

export function isAdjustmentLayer(layer) {
  return layer?.kind === 'adjustment';
}

/** Default params for an adjustment id, from its ADJUSTMENTS fields. */
export function defaultAdjustmentParams(id) {
  const def = ADJUSTMENTS[id];
  if (!def) throw new Error('Unknown adjustment: ' + id);
  const params = {};
  for (const f of def.fields) if (!f.local) params[f.key] = f.default;
  return params;
}

/**
 * Run an adjustment layer over RGBA bytes in place. data is the composite of the layers
 * below; a hidden layer, an unknown id, or opacity 0 leaves it unchanged.
 */
export function applyAdjustmentLayer(data, layer, W, H) {
  const def = ADJUSTMENTS[layer.adjustmentId];
  if (!def || layer.visible === false || !(layer.opacity > 0)) return data;
  const adjusted = { width: W, height: H, data: new Uint8ClampedArray(data) };
  def.apply(adjusted, layer.params || {}, null);
  const out = adjusted.data;
  const mask = compositeMask(layer, W);
  const opacity = Math.min(1, layer.opacity);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const t = mask ? (opacity * mask[p]) / 255 : opacity;
    if (t <= 0) continue;
    for (let c = 0; c < 4; c++)
      data[i + c] = Math.round(data[i + c] + (out[i + c] - data[i + c]) * t);
  }
  return data;
}

// Stack compositing lives in layer-groups.js compositeTreeBytes / layers.js flattenToCanvas —
// the same Seam production uses. Do not add a second flat compositor here.

/**
 * An adjustment layer: no pixels of its own (canvas stays empty/hidden), an ADJUSTMENTS id and
 * params, and a Reveal All mask that is always its edit target.
 */
export function createAdjustmentLayer(name, adjustmentId, params, w, h) {
  const layer = createLayer(name, w, h);
  layer.kind = 'adjustment';
  layer.adjustmentId = adjustmentId;
  layer.params = { ...params };
  layer.mask = newLayerMask('revealAll', w, h);
  syncLayerMask(layer);
  return layer;
}
