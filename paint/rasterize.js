// Layer › Rasterize › Layer and All Layers (PhotoCraft extra_cmds.rs rasterize / rasterize_all,
// enable_rules.rs kind_blocks): type, shape, fill, and Smart Object layers become pixel layers as
// they look now, and a vector mask is multiplied into the pixel mask. Effects stay live (Layer
// Style is its own Rasterize item). Each live layer's canvas already holds its rendered pixels,
// so the composite does not change.

import { rasterizeVectorMask } from './combine-shapes.js';

// The live layer kinds and the record fields that describe them.
export const LIVE_KINDS = {
  type: ['type', 'typeSize'],
  shape: ['shape', 'shapeSize'],
  fill: ['fill', 'fillSize'],
  smart: ['smart', 'smartSize']
};

/** True when Rasterize › Layer would change this layer (enable_rules.rs layer.rasterize.layer). */
export function canRasterize(layer) {
  return !!layer && (Object.hasOwn(LIVE_KINDS, layer.kind) || !!layer.vectorMask);
}

/**
 * The layers a Rasterize command converts, bottom to top: every layer for All Layers, else the
 * selected ids (rasterize with no layer: every selected layer it applies to).
 */
export function rasterizeTargets(layers, ids, all = false) {
  return layers.filter((l) => (all || ids.has(l.id)) && canRasterize(l));
}

/** Turn one layer record into a pixel layer in place; false when there was nothing live. */
export function rasterizeRecord(layer, W, H) {
  if (!canRasterize(layer)) return false;
  if (layer.vectorMask) {
    layer.mask = rasterizeVectorMask(layer, W, H);
    layer.maskEnabled = layer.maskEnabled !== false;
    layer.vectorMask = null;
  }
  const fields = LIVE_KINDS[layer.kind];
  if (fields) {
    layer.kind = 'pixel';
    for (const key of fields) delete layer[key];
  }
  return true;
}
