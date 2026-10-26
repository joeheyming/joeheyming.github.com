// Edit › Fill… and Edit › Stroke… pixel work (PhotoCraft engine fill_cmds.rs blend_tile and
// extra_cmds.rs stroke). Pure: both take an ImageData-like { width, height, data } and a 0/1
// (or 0..1 coverage) mask of length W * H, or null for the whole layer.

import { blendRgb, checkerPattern } from './retouch.js';
import { squaredDistance } from './selection.js';

// Fill › Contents, in PhotoCraft's order (fill_ui.rs CONTENTS). Content-Aware and History stay
// in PhotoCraft.
export const FILL_CONTENTS = [
  { value: 'foreground', label: 'Foreground Color' },
  { value: 'background', label: 'Background Color' },
  { value: 'color', label: 'Color…' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'black', label: 'Black' },
  { value: 'gray', label: '50% Gray' },
  { value: 'white', label: 'White' }
];

export const STROKE_LOCATIONS = [
  { value: 'inside', label: 'Inside' },
  { value: 'center', label: 'Center' },
  { value: 'outside', label: 'Outside' }
];

function hexRgba(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0).concat(255);
}

// The fill source for a Contents choice: an [r, g, b, a] byte color, or the pattern tile
// ({ width, height, data }) for 'pattern' (the Pattern Stamp's checker when none is defined).
// colors is { fg, bg, color } as '#rrggbb'.
export function fillContentsSource(contents, colors, pattern) {
  switch (contents) {
    case 'background':
      return hexRgba(colors.bg);
    case 'color':
      return hexRgba(colors.color ?? colors.fg);
    case 'pattern':
      return pattern ?? checkerPattern(hexRgba(colors.fg), hexRgba(colors.bg));
    case 'black':
      return [0, 0, 0, 255];
    case 'gray':
      return [128, 128, 128, 255];
    case 'white':
      return [255, 255, 255, 255];
    default:
      return hexRgba(colors.fg);
  }
}

// blend.rs composite (source over in a blend mode) and composite_atop (the backdrop's alpha
// kept), on straight RGBA in 0..1. k is coverage × opacity.
export function composite(mode, d, c, k, keep, out) {
  const as = c[3] * k;
  const ab = d[3];
  const b = blendRgb(mode, d, c);
  if (keep) {
    for (let i = 0; i < 3; i++) out[i] = (1 - as) * d[i] + as * b[i];
    out[3] = ab;
    return;
  }
  const ao = as + ab * (1 - as);
  if (ao <= 0) {
    out.fill(0);
    return;
  }
  for (let i = 0; i < 3; i++) {
    out[i] = ((1 - as) * ab * d[i] + (1 - ab) * as * c[i] + as * ab * b[i]) / ao;
  }
  out[3] = ao;
}

/**
 * Edit › Fill: src (an [r, g, b, a] byte color, or a pattern tile repeated from the canvas
 * origin) blended into imgData where mask is set, at mask[p] × opacity (0..100). mode is a
 * BLEND_MODES value; preserveTransparency keeps every pixel's alpha (source atop).
 */
export function fillMask(imgData, mask, src, options = {}) {
  const { mode = 'source-over', opacity = 100, preserveTransparency = false } = options;
  const { width: W, data: px } = imgData;
  const o = Math.max(0, Math.min(100, Number(opacity) || 0)) / 100;
  if (o <= 0 || !src) return;
  const tile = Array.isArray(src) ? null : src;
  const d = [0, 0, 0, 0],
    c = tile ? [0, 0, 0, 0] : src.map((v) => v / 255),
    out = [0, 0, 0, 0];
  const n = W * imgData.height;
  for (let p = 0; p < n; p++) {
    const k = (mask ? mask[p] : 1) * o;
    if (k <= 0) continue;
    const i = p * 4;
    if (tile) {
      const t = ((Math.floor(p / W) % tile.height) * tile.width + ((p % W) % tile.width)) * 4;
      for (let j = 0; j < 4; j++) c[j] = tile.data[t + j] / 255;
    }
    for (let j = 0; j < 4; j++) d[j] = px[i + j] / 255;
    composite(mode, d, c, k, preserveTransparency, out);
    for (let j = 0; j < 4; j++) px[i + j] = Math.round(out[j] * 255);
  }
}

// Stroke widths are whole pixels, rounded up, 1..250 (extra_cmds.rs stroke_width).
export function strokeWidth(width) {
  const w = Number(width);
  return Math.ceil(Math.max(1, Math.min(250, Number.isFinite(w) ? w : 1)));
}

/**
 * The Stroke band of a 0/1 mask as a 0/1 Uint8Array (extra_cmds.rs stroke, hard edges): outside,
 * an unselected pixel whose centre is less than out + 1 from a selected centre; inside, a
 * selected pixel less than in + ½ from an unselected one. Center puts the odd pixel inside.
 * Past the canvas nothing is selected, so the canvas edge strokes like any other edge.
 */
export function strokeBand(mask, W, H, width, location = 'center') {
  const w = strokeWidth(width);
  const [outPx, inPx] =
    location === 'inside' ? [0, w] : location === 'outside' ? [w, 0] : [w >> 1, (w + 1) >> 1];
  const pad = w + 1;
  const PW = W + 2 * pad,
    PH = H + 2 * pad;
  const sel = new Uint8Array(PW * PH),
    unsel = new Uint8Array(PW * PH).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const q = (y + pad) * PW + x + pad;
      sel[q] = 1;
      unsel[q] = 0;
    }
  }
  const toSel = outPx > 0 ? squaredDistance(sel, PW, PH) : null;
  const toUnsel = inPx > 0 ? squaredDistance(unsel, PW, PH) : null;
  const outR = (outPx + 1) ** 2,
    inR = (inPx + 0.5) ** 2;
  const band = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x,
        q = (y + pad) * PW + x + pad;
      band[p] = mask[p] ? (toUnsel && toUnsel[q] < inR ? 1 : 0) : toSel && toSel[q] < outR ? 1 : 0;
    }
  }
  return band;
}

/**
 * Edit › Stroke: rgba (bytes) along the edge of mask, width px at location ('inside' | 'center' |
 * 'outside'), blended like Fill (mode, opacity 0..100, preserveTransparency).
 */
export function strokeMask(imgData, mask, rgba, options = {}) {
  const { width = 1, location = 'center', ...blend } = options;
  const band = strokeBand(mask, imgData.width, imgData.height, width, location);
  fillMask(imgData, band, rgba, blend);
  return band;
}
