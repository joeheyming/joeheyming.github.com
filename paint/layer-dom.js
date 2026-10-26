// Layer canvas / mask DOM sync — shared by kind factories and the Layers panel.
// Kept out of layers.js so kind Modules can sync masks without importing the panel hub.

import { normalizeVectorMask, vectorMaskActive } from './combine-shapes.js';
import { isAdjustmentLayer } from './adjustment-layers.js';
import { isGroupLayer } from './layer-groups.js';
import { compositeMask, maskAlphaRgba, maskToRgba } from './layer-mask.js';

function blendCssValue(mode) {
  return mode === 'source-over' ? 'normal' : mode;
}

function maskAlphaUrl(mask, width, height) {
  const alpha = document.createElement('canvas');
  alpha.width = width;
  alpha.height = height;
  const actx = alpha.getContext('2d');
  const img = actx.createImageData(width, height);
  img.data.set(maskAlphaRgba(mask));
  actx.putImageData(img, 0, 0);
  return alpha.toDataURL('image/png');
}

/**
 * Redraw the mask's gray edit surface and the CSS mask the stack shows, after
 * layer.mask changed. A null mask drops both.
 */
export function syncLayerMask(layer) {
  const { width, height } = layer.canvas;
  if (!layer.mask) {
    layer.maskCanvas = null;
    layer.maskCtx = null;
    // A vector mask alone still masks the stack canvas.
    const vm = vectorMaskActive(layer) ? compositeMask(layer, width) : null;
    layer.maskUrl = vm ? maskAlphaUrl(vm, width, height) : null;
    syncLayerDOM(layer);
    return;
  }
  if (!layer.maskCanvas) {
    layer.maskCanvas = document.createElement('canvas');
    layer.maskCtx = layer.maskCanvas.getContext('2d', { willReadFrequently: true });
  }
  layer.maskComposite = null;
  layer.maskCanvas.width = width;
  layer.maskCanvas.height = height;
  const gray = layer.maskCtx.createImageData(width, height);
  gray.data.set(maskToRgba(layer.mask));
  layer.maskCtx.putImageData(gray, 0, 0);
  layer.maskUrl = maskAlphaUrl(compositeMask(layer, width) ?? layer.mask, width, height);
  syncLayerDOM(layer);
}

/** Opacity, visibility, blend, and CSS mask on the layer's stack canvas. */
export function syncLayerDOM(layer) {
  layer.canvas.style.opacity = layer.opacity;
  // An adjustment layer or a group has nothing to show; the composited view (paint.js) draws it.
  const empty = isAdjustmentLayer(layer) || isGroupLayer(layer);
  layer.canvas.style.display = layer.visible && !empty ? 'block' : 'none';
  layer.canvas.style.mixBlendMode = isGroupLayer(layer)
    ? 'normal'
    : blendCssValue(layer.blendMode || 'source-over');
  const masked = (layer.mask && layer.maskEnabled !== false) || vectorMaskActive(layer);
  const url = masked && !isAdjustmentLayer(layer) ? layer.maskUrl : null;
  const image = url ? `url(${url})` : '';
  layer.canvas.style.maskImage = image;
  layer.canvas.style.webkitMaskImage = image;
  layer.canvas.style.maskSize = layer.canvas.style.webkitMaskSize = '100% 100%';
  layer.canvas.style.maskRepeat = layer.canvas.style.webkitMaskRepeat = 'no-repeat';
}

// Re-export for callers that normalize vector masks when syncing.
export { normalizeVectorMask };
