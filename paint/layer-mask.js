// Layer masks (PhotoCraft Layer > Layer Mask). A mask is an 8-bit grayscale
// Uint8Array of length W * H, index y * W + x: 255 reveals, 0 hides. The
// composite multiplies the layer's alpha by mask / 255.

import { gaussBlurN } from './adjustments.js';
import { multiplyMasks, vectorMaskValues } from './combine-shapes.js';

// Properties › Density and Feather (PhotoCraft LayerMask density / feather). Both are applied at
// composite time; layer.mask stays the painted surface.
export const MASK_FEATHER_MAX = 1000;

/** Density as a 0..1 fraction (default 1), from the layer record. */
export function maskDensity(layer) {
  const d = Number(layer?.maskDensity);
  return Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : 1;
}

/** Feather radius in px (default 0), from the layer record. */
export function maskFeather(layer) {
  const f = Number(layer?.maskFeather);
  return Number.isFinite(f) ? Math.max(0, Math.min(MASK_FEATHER_MAX, f)) : 0;
}

/**
 * The mask the composite uses: mask blurred by a Gaussian of sigma = feather px, then
 * 255 − density × (255 − v), so density 0.5 halves how much any pixel hides. Returns mask
 * itself when density is 1 and feather is under PhotoCraft's 0.3 px identity.
 */
export function effectiveMask(mask, W, H, density = 1, feather = 0) {
  const soft = feather >= 0.3;
  if (density >= 1 && !soft) return mask;
  let v = mask;
  if (soft) {
    const buf = Float32Array.from(mask);
    gaussBlurN(buf, W, H, 1, feather);
    v = buf;
  }
  const out = new Uint8Array(mask.length);
  for (let p = 0; p < out.length; p++) out[p] = Math.round(255 - density * (255 - v[p]));
  return out;
}

/**
 * A layer's enabled mask with its density and feather, or null when it has none. Cached on the
 * layer until syncLayerMask (or a density / feather change) drops layer.maskComposite.
 */
export function compositeMask(layer, W) {
  const px = pixelCompositeMask(layer, W);
  if (!layer?.vectorMask) return px;
  // A vector mask multiplies in (combine-shapes.js); cached per pixel mask and vector record.
  const w = W ?? layer.canvas?.width ?? Math.round(Math.sqrt(layer.mask?.length ?? 0));
  const h = layer.canvas?.height ?? (layer.mask ? layer.mask.length / w : w);
  const vm = vectorMaskValues(layer, w, h);
  if (!px || !vm) return px ?? vm;
  const c = layer.vectorMaskComposite;
  if (c && c.px === px && c.vm === vm) return c.out;
  const out = multiplyMasks(px, vm);
  layer.vectorMaskComposite = { px, vm, out };
  return out;
}

function pixelCompositeMask(layer, W) {
  if (!layer?.mask || layer.maskEnabled === false) return null;
  const density = maskDensity(layer),
    feather = maskFeather(layer);
  if (density >= 1 && feather < 0.3) return layer.mask;
  const c = layer.maskComposite;
  if (c && c.mask === layer.mask && c.density === density && c.feather === feather) return c.out;
  const w = W ?? layer.canvas?.width ?? Math.round(Math.sqrt(layer.mask.length));
  const out = effectiveMask(layer.mask, w, layer.mask.length / w, density, feather);
  layer.maskComposite = { mask: layer.mask, density, feather, out };
  return out;
}

/** Copy of img with alpha multiplied by mask[p] / 255 (rounded); RGB is unchanged. */
export function applyLayerMask(img, mask) {
  const data = new Uint8ClampedArray(img.data);
  if (mask) {
    for (let p = 0, i = 3; p < mask.length; p++, i += 4) {
      data[i] = Math.round((data[i] * mask[p]) / 255);
    }
  }
  return { width: img.width, height: img.height, data };
}

/** 'revealAll' → 255, 'hideAll' → 0, 'revealSelection' → 255 inside selectionMask. */
export function newLayerMask(kind, W, H, selectionMask = null) {
  const mask = new Uint8Array(W * H);
  if (kind === 'revealAll') mask.fill(255);
  else if (kind === 'revealSelection' && selectionMask) {
    for (let p = 0; p < mask.length; p++) mask[p] = selectionMask[p] ? 255 : 0;
  } else if (kind === 'hideSelection' && selectionMask) {
    for (let p = 0; p < mask.length; p++) mask[p] = selectionMask[p] ? 0 : 255;
  } else if (kind !== 'hideAll' && kind !== 'revealSelection' && kind !== 'hideSelection') {
    throw new Error('Unknown layer mask kind: ' + kind);
  }
  return mask;
}

/**
 * Layer › Layer Mask › From Transparency: the layer's alpha becomes the mask and its pixels
 * turn opaque. Edits img in place; returns the mask.
 */
export function maskFromTransparency(img) {
  const mask = new Uint8Array(img.width * img.height);
  for (let p = 0, i = 3; p < mask.length; p++, i += 4) {
    mask[p] = img.data[i];
    img.data[i] = 255;
  }
  return mask;
}

/** Rec. 601 luma of an RGB triple, 0..255 (rounded). */
function luma(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/** Gray level a color paints into a mask. */
export function maskLevel(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
  return luma((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** The color, as the gray hex it paints into a mask. */
export function maskGrayHex(hex) {
  const v = maskLevel(hex).toString(16).padStart(2, '0');
  return '#' + v + v + v;
}

/** Opaque gray RGBA bytes for the mask's edit surface. */
export function maskToRgba(mask) {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    out[i] = out[i + 1] = out[i + 2] = mask[p];
    out[i + 3] = 255;
  }
  return out;
}

/**
 * Read a mask back from its edit surface. Each pixel's luma is the level;
 * transparent pixels (the eraser) show the background level, as in PhotoCraft.
 */
export function maskFromRgba(data, bgLevel = 0) {
  const mask = new Uint8Array(data.length / 4);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const a = data[i + 3] / 255;
    mask[p] = Math.round(luma(data[i], data[i + 1], data[i + 2]) * a + bgLevel * (1 - a));
  }
  return mask;
}

/** Black RGBA bytes whose alpha is the mask, for a CSS mask-image. */
export function maskAlphaRgba(mask) {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let p = 0; p < mask.length; p++) out[p * 4 + 3] = mask[p];
  return out;
}

/** The sw × sh window of a W × H mask at (sx, sy); area outside the source is fill. */
export function cropMask(mask, W, H, sx, sy, sw, sh, fill = 255) {
  const out = new Uint8Array(sw * sh).fill(fill);
  for (let y = 0; y < sh; y++) {
    const ty = y + sy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < sw; x++) {
      const tx = x + sx;
      if (tx >= 0 && tx < W) out[y * sw + x] = mask[ty * W + tx];
    }
  }
  return out;
}

// .paintproj stores a mask as base64 run-length pairs (count 1..255, level).
export function encodeMask(mask) {
  const bytes = [];
  for (let p = 0; p < mask.length; ) {
    const v = mask[p];
    let n = 1;
    while (n < 255 && p + n < mask.length && mask[p + n] === v) n++;
    bytes.push(n, v);
    p += n;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  return btoa(bin);
}

export function decodeMask(text, length) {
  const bin = atob(text);
  const mask = new Uint8Array(length);
  let p = 0;
  for (let i = 0; i + 1 < bin.length && p < length; i += 2) {
    const n = bin.charCodeAt(i);
    mask.fill(bin.charCodeAt(i + 1), p, Math.min(length, p + n));
    p += n;
  }
  return mask;
}
