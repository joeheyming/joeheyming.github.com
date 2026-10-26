// Image › Mode (PhotoCraft image_cmds.rs mode conversion): a document is RGB Color, Grayscale,
// Indexed Color (only its color table's colors) or Bitmap (black and white), always 8 Bits/Channel. Grayscale is Rec. 601 luma (photocraft_color convert.rs rgb_to_gray),
// the same weights a layer mask paints with.

import { isAdjustmentLayer } from './adjustment-layers.js';
import { maskGrayHex, maskLevel } from './layer-mask.js';
import { nearestTableColor } from './indexed-mode.js';

const MODES = ['rgb', 'grayscale', 'indexed', 'bitmap'];
const TAGS = { rgb: 'RGB/8', grayscale: 'Gray/8', indexed: 'Indexed/8', bitmap: 'Bitmap/8' };

/** A saved or missing mode; older .paintproj files have none and open as RGB. */
export function normalizeDocMode(mode) {
  return MODES.includes(mode) ? mode : 'rgb';
}

/** The doc tab's mode tag (PhotoCraft canvas.rs mode_label): "RGB/8", "Gray/8", "Indexed/8"…. */
export function docModeTag(mode) {
  return TAGS[normalizeDocMode(mode)];
}

/**
 * A picked color as the document can hold it: its gray in Grayscale, the nearest color table
 * entry in Indexed Color, black or white in Bitmap, unchanged in RGB.
 */
export function docColor(mode, hex, table = null) {
  switch (normalizeDocMode(mode)) {
    case 'grayscale':
      return maskGrayHex(hex);
    case 'indexed':
      return nearestTableColor(table, hex);
    case 'bitmap':
      return maskLevel(hex) >= 128 ? '#ffffff' : '#000000';
    default:
      return hex;
  }
}

/** Converts RGBA bytes to their luma in place; alpha is kept. Returns the same ImageData. */
export function grayscaleImageData(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return img;
}

/** Converts every pixel layer's canvas to luma; adjustment layers have no pixels to convert. */
export function grayscaleLayers(layers) {
  for (const layer of layers) {
    if (isAdjustmentLayer(layer) || !layer.ctx) continue;
    const { width: W, height: H } = layer.canvas;
    layer.ctx.putImageData(grayscaleImageData(layer.ctx.getImageData(0, 0, W, H)), 0, 0);
  }
}
