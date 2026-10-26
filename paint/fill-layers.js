// Fill layers (PhotoCraft Layer › New Fill Layer, doc Fill / compose render_fill). A fill layer
// holds a Solid Color, Gradient, or Pattern description in layer.fill instead of pixels; its
// canvas is re-rendered from that description at the document size, so it stays live through
// Canvas Size, Image Size, and Crop. Its mask (Reveal All, or the selection) is the edit target.

import { gradientT, patternSnapshot } from './layer-style.js';
import { DEFAULT_GRADIENT_STOPS, sampleStops } from './gradient-stops.js';
import { sampleOpacity } from './gradient-presets.js';
import { syncLayerMask } from './layer-dom.js';
import { newLayerMask } from './layer-mask.js';
import { createLayer } from './layer-shell.js';

// The Layer › New Fill Layer submenu and the Layers footer's first three items, in that order.
// name is the base of the new layer's name (next_layer_name), undo its history label.
export const FILL_LAYER_TYPES = [
  { type: 'solid', id: 'solidColor', label: 'Solid Color…', name: 'Color Fill' },
  { type: 'gradient', id: 'gradient', label: 'Gradient…', name: 'Gradient Fill' },
  { type: 'pattern', id: 'pattern', label: 'Pattern…', name: 'Pattern Fill' }
].map((t) => ({ ...t, undo: `New ${t.name} Layer` }));

export const EDIT_FILL_LABEL = 'Edit Fill Layer';

export function isFillLayer(layer) {
  return layer?.kind === 'fill';
}

/**
 * A new fill of type ('solid', 'gradient', 'pattern'): the foreground color, a foreground to
 * background linear gradient at 90°, or the given pattern tile at 100 %.
 */
export function defaultFill(type, { fg = '#000000', bg = '#ffffff', pattern = null } = {}) {
  if (type === 'gradient') {
    return {
      type,
      preset: 'Foreground to Background',
      stops: [
        [0, fg],
        [1, bg]
      ],
      opacityStops: [
        [0, 1],
        [1, 1]
      ],
      style: 'linear',
      angle: 90,
      scale: 100,
      reverse: false
    };
  }
  if (type === 'pattern') return { type, pattern: patternSnapshot(pattern), scale: 100 };
  return { type: 'solid', color: fg };
}

/** A deep, JSON-friendly copy of a fill (null for anything that is not one). */
export function cloneFill(fill) {
  if (!fill || typeof fill !== 'object') return null;
  if (fill.type === 'gradient') {
    const stops = Array.isArray(fill.stops) && fill.stops.length ? fill.stops : null;
    return {
      ...fill,
      stops: (stops ?? DEFAULT_GRADIENT_STOPS).map((s) => [Number(s[0]) || 0, String(s[1])]),
      opacityStops: Array.isArray(fill.opacityStops)
        ? fill.opacityStops.map((s) => [Number(s[0]) || 0, Number(s[1])])
        : []
    };
  }
  if (fill.type === 'pattern') {
    const tile = fill.pattern;
    const pattern = tile?.width > 0 && tile?.height > 0 ? patternSnapshot(tile) : null;
    return { type: 'pattern', pattern, scale: Number(fill.scale) || 100 };
  }
  return { type: 'solid', color: typeof fill.color === 'string' ? fill.color : '#000000' };
}

function hexRgb(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * PhotoCraft fill_frame: the box [x0, y0, x1, y1) a gradient or a linked pattern is laid out in.
 * A mask that hides part of the canvas (a fill made from a selection) gives its revealed bounds;
 * otherwise the canvas.
 */
export function fillFrame(mask, W, H) {
  if (!mask || mask.every((v) => v > 0)) return [0, 0, W, H];
  let [x0, y0, x1, y1] = [W, H, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  return x0 < x1 ? [x0, y0, x1, y1] : [0, 0, W, H];
}

/**
 * The fill's pixels over a W × H canvas as { width, height, data } straight RGBA, before the
 * layer's mask (compose render_fill). mask only places the frame (fillFrame). A pattern fill
 * with no tile is transparent.
 */
export function renderFill(fill, W, H, mask = null) {
  const data = new Uint8ClampedArray(W * H * 4);
  const out = { width: W, height: H, data };
  const f = cloneFill(fill);
  if (!f) return out;
  if (f.type === 'solid') {
    const [r, g, b] = hexRgb(f.color);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
    return out;
  }
  const frame = fillFrame(mask, W, H);
  if (f.type === 'gradient') {
    const angle = Number(f.angle) || 0;
    const scale = (Number(f.scale) || 100) / 100;
    const opacity = f.opacityStops.length ? f.opacityStops : null;
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i += 4) {
        const t = gradientT(f.style, angle, scale, !!f.reverse, frame, x + 0.5, y + 0.5);
        const [r, g, b] = sampleStops(f.stops, t);
        data[i] = Math.round(r * 255);
        data[i + 1] = Math.round(g * 255);
        data[i + 2] = Math.round(b * 255);
        data[i + 3] = Math.round((opacity ? sampleOpacity(opacity, t) : 1) * 255);
      }
    }
    return out;
  }
  const tile = f.pattern;
  if (!tile || tile.data.length < tile.width * tile.height * 4) return out;
  // Linked with the layer: the tile starts at the frame's corner, scaled about it.
  const scale = Math.max(0.01, f.scale / 100);
  const mod = (v, n) => ((v % n) + n) % n;
  for (let y = 0, i = 0; y < H; y++) {
    const v = mod(Math.floor((y + 0.5 - frame[1]) / scale), tile.height);
    for (let x = 0; x < W; x++, i += 4) {
      const u = mod(Math.floor((x + 0.5 - frame[0]) / scale), tile.width);
      const q = (v * tile.width + u) * 4;
      for (let c = 0; c < 4; c++) data[i + c] = tile.data[q + c];
    }
  }
  return out;
}

/** PhotoCraft next_layer_name: base plus one more than the highest "base N" in the stack. */
export function nextFillName(layers, base) {
  let n = 0;
  const re = new RegExp(`^${base} (\\d+)$`);
  for (const l of layers) {
    const m = re.exec(l?.name ?? '');
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${base} ${n + 1}`;
}

/**
 * A fill layer: layer.fill renders its pixels at the canvas size; mask is the given one
 * (a selection) or Reveal All, and is always its edit target.
 */
export function createFillLayer(name, fill, w, h, mask = null) {
  const layer = createLayer(name, w, h);
  layer.kind = 'fill';
  layer.fill = cloneFill(fill);
  layer.mask = mask ? mask.slice() : newLayerMask('revealAll', w, h);
  syncLayerMask(layer);
  renderFillLayer(layer);
  return layer;
}

/** Redraw a fill layer's canvas from layer.fill at the canvas's current size. */
export function renderFillLayer(layer) {
  if (!isFillLayer(layer)) return;
  const { width, height } = layer.canvas;
  const mask = layer.mask?.length === width * height ? layer.mask : null;
  const img = layer.ctx.createImageData(width, height);
  img.data.set(renderFill(layer.fill, width, height, mask).data);
  layer.ctx.putImageData(img, 0, 0);
  layer.fillSize = [width, height];
}

/** Re-render every fill layer whose canvas changed size since it was drawn (Canvas Size, Crop). */
export function refreshFillLayers(layers) {
  for (const layer of layers) {
    if (!isFillLayer(layer)) continue;
    const [w, h] = layer.fillSize ?? [];
    if (w !== layer.canvas.width || h !== layer.canvas.height) renderFillLayer(layer);
  }
}
