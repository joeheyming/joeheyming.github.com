// Layer › New (PhotoCraft edit_cmds.rs layer_via, extra_cmds.rs layer_from_background,
// background_cmds.rs background_from_layer) and the Background layer.
//
// The Background is a pixel layer with `background: true`: opaque, named "Background", always at
// the bottom of the stack. Erasing on it paints the background colour; changing its opacity or
// blend mode, transforming it, or erasing to transparency (Magic / Background Eraser) turns it
// into "Layer 0" first, as in PhotoCraft. Older .paintproj files have no flag, so every layer
// they hold opens as a normal layer.
//
// Pixel buffers are RGBA bytes (Uint8ClampedArray, length W * H * 4). Selection masks are 0/1,
// layer masks 0..255, both length W * H.

import { blendRgb } from './retouch.js';

export const BACKGROUND_NAME = 'Background';
export const LAYER_ZERO_NAME = 'Layer 0';

export function isBackgroundLayer(layer) {
  return !!layer && layer.background === true;
}

/** The document has a Background (it is always layers[0]). */
export function hasBackground(layers) {
  return isBackgroundLayer(layers?.[0]);
}

/** Doc::next_layer_name: the first "Layer N" (N from 1) no layer is called yet. */
export function nextLayerName(layers, base = 'Layer') {
  const names = new Set((layers ?? []).map((l) => l.name));
  for (let n = 1; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** unlock_background: the Background becomes a normal layer named "Layer 0". */
export function unlockBackground(layer) {
  if (!isBackgroundLayer(layer)) return false;
  layer.background = false;
  layer.name = LAYER_ZERO_NAME;
  return true;
}

/**
 * Can the stack move layers[from] to index `to`? Nothing moves the Background, and no layer
 * goes below it (keep_background_at_bottom).
 */
export function canMoveLayer(layers, from, to) {
  if (from === to || !layers[from] || !layers[to]) return false;
  if (isBackgroundLayer(layers[from])) return false;
  return !(hasBackground(layers) && to === 0);
}

/**
 * Layer via Copy / Cut pixels: lifted holds the layer's pixels under the 0/1 selection mask (the
 * whole layer when mask is null) and transparency elsewhere. With cut, rest is the layer with
 * the lifted pixels cleared to `fill` ([r, g, b, a] bytes; transparent when null), else null.
 */
export function liftLayerPixels(src, mask, cut = false, fill = null) {
  const lifted = new Uint8ClampedArray(src.length);
  const rest = cut ? new Uint8ClampedArray(src) : null;
  const clear = fill ?? [0, 0, 0, 0];
  for (let p = 0, i = 0; i < src.length; p++, i += 4) {
    if (mask && !mask[p]) continue;
    lifted[i] = src[i];
    lifted[i + 1] = src[i + 1];
    lifted[i + 2] = src[i + 2];
    lifted[i + 3] = src[i + 3];
    if (rest) for (let c = 0; c < 4; c++) rest[i + c] = clear[c];
  }
  return { lifted, rest };
}

/** True when the lifted pixels hold nothing ("the selected area is empty"). */
export function liftIsEmpty(lifted) {
  for (let i = 3; i < lifted.length; i += 4) if (lifted[i]) return false;
  return true;
}

/**
 * Background from Layer: the layer as it looks on its own (opacity, enabled 0..255 layer mask,
 * blend mode) over the opaque background colour bg ([r, g, b] bytes).
 */
export function backgroundPixels(src, bg, { opacity = 1, blendMode = 'source-over', mask } = {}) {
  const out = new Uint8ClampedArray(src.length);
  const cb = [bg[0] / 255, bg[1] / 255, bg[2] / 255];
  for (let p = 0, i = 0; i < src.length; p++, i += 4) {
    const a = (src[i + 3] / 255) * opacity * (mask ? mask[p] / 255 : 1);
    const cs = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];
    const mix = blendMode === 'source-over' ? cs : blendRgb(blendMode, cb, cs);
    for (let c = 0; c < 3; c++) out[i + c] = Math.round((cb[c] * (1 - a) + mix[c] * a) * 255);
    out[i + 3] = 255;
  }
  return out;
}

/**
 * Background from Layer's stack order: layers[idx] moves to the bottom. Returns a new array.
 */
export function stackWithBackground(layers, idx) {
  const out = layers.slice();
  const [layer] = out.splice(idx, 1);
  out.unshift(layer);
  return out;
}
