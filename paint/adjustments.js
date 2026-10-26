// Pure pixel adjustments — every function takes an ImageData and the params,
// and mutates the data in place. Caller is responsible for getImageData /
// putImageData and undo bookkeeping.

import { blendLum, setLum } from './retouch.js';
import {
  DEFAULT_GRADIENT_STOPS,
  gradientMapColor,
  gradientMapStops,
  unitStops
} from './gradient-stops.js';

import {
  SHADOWS_HIGHLIGHTS_DEFAULTS,
  applyEqualize,
  applyReplaceColor,
  applyShadowsHighlights
} from './tone.js';
import { applyDefringe, applyRemoveMatte } from './matting.js';

export { gradientMapColor };

// ── Color-space helpers ──────────────────────────────────────────────────────

// Rec. 709 luminance.
const LUMA_R = 0.2126,
  LUMA_G = 0.7152,
  LUMA_B = 0.0722;

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ── Adjustments ──────────────────────────────────────────────────────────────

// PhotoCraft adjust.rs legacy_brightness_contrast_at: contrast scales around LEGACY_PIVOT;
// brightness is added before raised contrast and after lowered contrast.
const LEGACY_PIVOT = 128 / 255;

export function applyLegacyBrightnessContrast(imgData, brightness, contrast, mask = null) {
  const d = imgData.data;
  const b = brightness / 255;
  const c = Math.min(99, Math.max(-100, contrast));
  const k = c >= 0 ? 1 / (1 - c / 100) : 1 + c / 100;
  const pre = c >= 0 ? b : 0;
  const post = c >= 0 ? 0 : b;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const out = (v / 255 + pre - LEGACY_PIVOT) * k + LEGACY_PIVOT + post;
    lut[v] = Math.round(Math.min(1, Math.max(0, out)) * 255);
  }
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

// PhotoCraft adjust.rs modern_contrast: a symmetric cubic Hermite S-curve pivoting at 0.5,
// endpoint slope 1 - c/128 and centre slope 1 + c/128. Pins 0, 0.5, and 1.
export function modernContrast(v, contrast) {
  if (contrast === 0) return v;
  const k = contrast / 128;
  const end = 1 - k;
  const mid = 1 + k;
  const half = (t) =>
    end * 0.5 * (t * t * t - 2 * t * t + t) +
    (-2 * t * t * t + 3 * t * t) * 0.5 +
    mid * 0.5 * (t * t * t - t * t);
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.5 ? half(x / 0.5) : 1 - half((1 - x) / 0.5);
}

// PhotoCraft adjust.rs Brightness: raised, a line of slope s up to a knee at output 126/255,
// then a Hermite (or, past about +110, a power) roll-off to (1, 1). Lowered inverts it.
const BRIGHTNESS_KNEE = 126 / 255;

function brightnessCurve(brightness) {
  const b = Math.abs(brightness);
  const s = Math.pow(1.375, b / 50);
  const e = 1 / (1 + 0.084 * b);
  const x0 = Math.min(1, BRIGHTNESS_KNEE / s);
  const h = Math.max(1e-6, 1 - x0);
  const secant = (1 - BRIGHTNESS_KNEE) / h;
  const alpha = s / secant;
  const beta = e / secant;
  const hermite = alpha * alpha + beta * beta <= 9;
  const y0 = BRIGHTNESS_KNEE;
  return (x) => {
    if (x <= x0) return Math.min(y0, s * x);
    const t = Math.min(1, Math.max(0, (x - x0) / h));
    const t2 = t * t;
    const t3 = t2 * t;
    const y = hermite
      ? (2 * t3 - 3 * t2 + 1) * y0 +
        (t3 - 2 * t2 + t) * h * s +
        (-2 * t3 + 3 * t2) +
        (t3 - t2) * h * e
      : 1 - (1 - y0) * Math.pow(1 - t, alpha);
    return Math.min(1, Math.max(0, y));
  };
}

function modernBrightnessWith(raised, raise, v) {
  const x = Math.min(1, Math.max(0, v));
  if (raise) return raised(x);
  if (x <= 0 || x >= 1) return x;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const m = 0.5 * (lo + hi);
    if (raised(m) < x) lo = m;
    else hi = m;
  }
  return 0.5 * (lo + hi);
}

export function modernBrightness(v, brightness) {
  if (brightness === 0 || !Number.isFinite(brightness)) return v;
  return modernBrightnessWith(brightnessCurve(brightness), brightness > 0, v);
}

// Modern (CS3+) Brightness / Contrast: modernBrightness then modernContrast through one table.
export function applyModernBrightnessContrast(imgData, brightness, contrast, mask = null) {
  const d = imgData.data;
  const b = Number.isFinite(brightness) ? brightness : 0;
  const c = Math.min(100, Math.max(-50, contrast));
  const raised = b === 0 ? null : brightnessCurve(b);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const bv = raised ? modernBrightnessWith(raised, b > 0, v / 255) : v / 255;
    lut[v] = Math.round(Math.min(1, Math.max(0, modernContrast(bv, c))) * 255);
  }
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

// Hue / Saturation's Edit ranges (PhotoCraft doc/adjust.rs HueRange), reds first, 60° apart.
export const HUE_RANGES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];

// How much hue `deg` belongs to range i at PhotoCraft's default bounds
// [60i - 45, 60i - 15, 60i + 15, 60i + 45]: 1 within 15° of the centre, fading to 0 at 45°.
export function hueRangeWeight(i, deg) {
  const a = 60 * i - 45;
  const rel = (x) => (((x - a) % 360) + 360) % 360;
  const b = rel(60 * i - 15);
  const c = Math.max(rel(60 * i + 15), b);
  const d = Math.max(rel(60 * i + 45), c);
  const h = rel(deg);
  if (h <= b) return b <= 0 ? 1 : h / b;
  if (h <= c) return 1;
  if (h <= d) return d <= c ? 1 : (d - h) / (d - c);
  return 0;
}

// A range's Lightness (adjust.rs range_lightness): each channel (0..1) moves toward the
// brightest channel when raised and the darkest when lowered, by |l|.
export function rangeLightness(c, l) {
  l = Math.max(-1, Math.min(1, l));
  const target = l > 0 ? Math.max(c[0], c[1], c[2]) : Math.min(c[0], c[1], c[2]);
  const k = Math.abs(l);
  return c.map((v) => v + (target - v) * k);
}

// Hue (-180..180), Saturation (-100..100), Lightness (-100..100).
// Colorize (PhotoCraft adjust.rs hue_saturation_in) rebuilds each pixel from one hue and
// saturation at its own lightness, lightened or darkened toward white or black.
// ranges (HUE_RANGES order, each { hue, saturation, lightness }) add their shifts weighted by
// the pixel's original hue, then their lightness after the master edit. Colorize ignores them.
export function applyHueSatLight(
  imgData,
  hue,
  sat,
  light,
  colorize = false,
  mask = null,
  ranges = null
) {
  const d = imgData.data;
  if (colorize) {
    const ch = (((hue % 360) + 360) % 360) / 360;
    const cs = Math.min(1, Math.abs(sat) / 100);
    const l = light / 100;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      if (mask && !mask[p]) continue;
      const v = rgbToHsl(d[i], d[i + 1], d[i + 2])[2];
      const [r, g, b] = hslToRgb(ch, cs, l > 0 ? v + (1 - v) * l : v * (1 + l));
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
    return;
  }
  const active = [];
  if (ranges) {
    ranges.forEach((r, i) => {
      if (r && (r.hue || r.saturation || r.lightness)) active.push([i, r]);
    });
  }
  const lShift = light / 100;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    let dh = 0,
      ds = 0,
      dl = 0;
    // Greys have no hue, so no range edits them.
    if (active.length && s > 0) {
      const deg = h * 360;
      for (const [k, r] of active) {
        const w = hueRangeWeight(k, deg);
        dh += w * r.hue;
        ds += (w * r.saturation) / 100;
        dl += (w * r.lightness) / 100;
      }
    }
    h = (h + (hue + dh) / 360) % 1;
    if (h < 0) h += 1;
    s = Math.max(0, Math.min(1, s * (1 + Math.max(-1, Math.min(1, sat / 100 + ds)))));
    l = Math.max(0, Math.min(1, l + lShift));
    let [r, g, b] = hslToRgb(h, s, l);
    if (dl) {
      [r, g, b] = rangeLightness([r / 255, g / 255, b / 255], dl).map((v) => Math.round(v * 255));
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

export function applyInvert(imgData, mask = null) {
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
}

// Image › Adjustments › Desaturate: every pixel becomes its Rec. 601 grey; alpha stays
// (PhotoCraft algo stylize::desaturate with fxutil luma in RGB mode).
export function applyDesaturate(imgData, mask = null) {
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
  }
}

// Threshold: anything brighter than `level` (0..255 luma) becomes white,
// the rest becomes black.
export function applyThreshold(imgData, level, mask = null) {
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    const y = d[i] * LUMA_R + d[i + 1] * LUMA_G + d[i + 2] * LUMA_B;
    const v = y >= level ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

// Posterize: quantize R, G, B to `levels` evenly spaced tones (2..255).
// Alpha is untouched. 255 levels is a no-op: every 8-bit value is already its
// own level, and the round-trip formula would otherwise tie 127 up to 128.
export function applyPosterize(imgData, levels, mask = null) {
  const n = Math.max(2, Math.min(255, Math.round(levels))) - 1;
  if (n === 254) return;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round((Math.round((v * n) / 255) * 255) / n);
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

// Pixelate: average each NxN block. block=1 is a no-op.
export function applyPixelate(imgData, block, mask = null) {
  if (block <= 1) return;
  const d = imgData.data;
  const W = imgData.width,
    H = imgData.height;
  for (let by = 0; by < H; by += block) {
    for (let bx = 0; bx < W; bx += block) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      const xMax = Math.min(bx + block, W),
        yMax = Math.min(by + block, H);
      for (let y = by; y < yMax; y++) {
        for (let x = bx; x < xMax; x++) {
          const i = (y * W + x) * 4;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          a += d[i + 3];
          n++;
        }
      }
      r = (r / n) | 0;
      g = (g / n) | 0;
      b = (b / n) | 0;
      a = (a / n) | 0;
      for (let y = by; y < yMax; y++) {
        for (let x = bx; x < xMax; x++) {
          const i = (y * W + x) * 4,
            p = y * W + x;
          if (mask && !mask[p]) continue;
          d[i] = r;
          d[i + 1] = g;
          d[i + 2] = b;
          d[i + 3] = a;
        }
      }
    }
  }
}

// Gaussian blur with sigma = radius (at most 32), matching PhotoCraft blur.rs
// gaussian_kernel: sigma below 0.05 is the identity. The dialog's field keeps
// radius >= 1; presets such as Blur pass smaller sigmas. Separable: one
// horizontal and one vertical pass over premultiplied RGBA, edges clamped.
// Every pixel feeds the blur; the mask only limits which pixels are written.
export function applyGaussianBlur(imgData, radius, mask = null) {
  const sigma = Math.min(32, Number(radius) || 0);
  if (!(sigma >= 0.05)) return;
  const r = Math.ceil(sigma * 3);
  const kernel = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k++) {
    kernel[k + r] = Math.exp(-(k * k) / (2 * sigma * sigma));
    sum += kernel[k + r];
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;

  const d = imgData.data;
  const W = imgData.width,
    H = imgData.height;
  const src = new Float32Array(W * H * 4);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    src[i] = d[i] * a;
    src[i + 1] = d[i + 1] * a;
    src[i + 2] = d[i + 2] * a;
    src[i + 3] = d[i + 3];
  }

  const tmp = new Float32Array(src.length);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let cr = 0,
        cg = 0,
        cb = 0,
        ca = 0;
      for (let k = -r; k <= r; k++) {
        const sx = x + k < 0 ? 0 : x + k >= W ? W - 1 : x + k;
        const j = (row + sx) * 4,
          w = kernel[k + r];
        cr += src[j] * w;
        cg += src[j + 1] * w;
        cb += src[j + 2] * w;
        ca += src[j + 3] * w;
      }
      const o = (row + x) * 4;
      tmp[o] = cr;
      tmp[o + 1] = cg;
      tmp[o + 2] = cb;
      tmp[o + 3] = ca;
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      let cr = 0,
        cg = 0,
        cb = 0,
        ca = 0;
      for (let k = -r; k <= r; k++) {
        const sy = y + k < 0 ? 0 : y + k >= H ? H - 1 : y + k;
        const j = (sy * W + x) * 4,
          w = kernel[k + r];
        cr += tmp[j] * w;
        cg += tmp[j + 1] * w;
        cb += tmp[j + 2] * w;
        ca += tmp[j + 3] * w;
      }
      const o = p * 4;
      const a = ca / 255;
      d[o] = a > 0 ? clamp(Math.round(cr / a)) : 0;
      d[o + 1] = a > 0 ? clamp(Math.round(cg / a)) : 0;
      d[o + 2] = a > 0 ? clamp(Math.round(cb / a)) : 0;
      d[o + 3] = clamp(Math.round(ca));
    }
  }
}

// Motion blur, following PhotoCraft blur.rs `motion`: each pixel is the mean of
// ceil(d) + 1 bilinear samples on a line of length d centred on it, taken in
// premultiplied alpha. The offsets are the same everywhere, so their bilinear
// taps are merged once into a fixed kernel. Samples clamp to the edge.
export function applyMotionBlur(imgData, angle, distance, mask = null) {
  const d0 = Math.abs(Number(distance) || 0);
  if (d0 < 0.5) return;
  const rad = ((Number(angle) || 0) * Math.PI) / 180;
  const c = Math.cos(rad),
    s = Math.sin(rad);
  const steps = Math.ceil(d0);
  const k = 1 / (steps + 1);
  const taps = new Map();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps - 0.5;
    const ox = c * d0 * t,
      oy = -s * d0 * t;
    const x0 = Math.floor(ox),
      y0 = Math.floor(oy);
    const ax = ox - x0,
      ay = oy - y0;
    const parts = [
      [0, 0, (1 - ax) * (1 - ay)],
      [1, 0, ax * (1 - ay)],
      [0, 1, (1 - ax) * ay],
      [1, 1, ax * ay]
    ];
    for (const [dx, dy, w] of parts) {
      if (w <= 1e-12) continue;
      const key = `${x0 + dx},${y0 + dy}`;
      const tap = taps.get(key);
      if (tap) tap[2] += w * k;
      else taps.set(key, [x0 + dx, y0 + dy, w * k]);
    }
  }
  const kernel = [...taps.values()];

  const d = imgData.data;
  const W = imgData.width,
    H = imgData.height;
  const src = new Float32Array(W * H * 4);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    src[i] = d[i] * a;
    src[i + 1] = d[i + 1] * a;
    src[i + 2] = d[i + 2] * a;
    src[i + 3] = d[i + 3];
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      let cr = 0,
        cg = 0,
        cb = 0,
        ca = 0;
      for (const [dx, dy, w] of kernel) {
        const sx = x + dx < 0 ? 0 : x + dx >= W ? W - 1 : x + dx;
        const sy = y + dy < 0 ? 0 : y + dy >= H ? H - 1 : y + dy;
        const j = (sy * W + sx) * 4;
        cr += src[j] * w;
        cg += src[j + 1] * w;
        cb += src[j + 2] * w;
        ca += src[j + 3] * w;
      }
      const o = p * 4;
      const a = ca / 255;
      d[o] = a > 0 ? clamp(Math.round(cr / a)) : 0;
      d[o + 1] = a > 0 ? clamp(Math.round(cg / a)) : 0;
      d[o + 2] = a > 0 ? clamp(Math.round(cb / a)) : 0;
      d[o + 3] = clamp(Math.round(ca));
    }
  }
}

const RADIAL_INTERVAL_CAPS = [64, 256, 4096];

// Sample intervals along a radial blur path (PhotoCraft blur.rs
// `radial_intervals`): ceil(length) clamped to 1..cap for the quality
// (0 Draft, 1 Good, 2 Best). NaN gives 1.
export function radialIntervals(pathLength, quality = 1) {
  const max = RADIAL_INTERVAL_CAPS[quality] ?? 256;
  if (Number.isNaN(pathLength)) return 1;
  return Math.max(1, Math.min(max, Math.ceil(pathLength)));
}

// Radial Blur (PhotoCraft blur.rs `radial` / `average_samples`, blur/radial.rs)
// with the canvas as bounds at 0, 0. Spin averages n + 1 samples over an arc of
// `amount` degrees centred on the pixel; Zoom averages n + 1 samples along the
// ray towards the centre, up to amount / 2 % closer. Each sample is bilinear
// in premultiplied alpha with pixel centres at .5; taps off the canvas are
// transparent, as in the engine. Reads come from a copy; the mask limits
// writes. f32 via Math.fround.
export function applyRadialBlur(imgData, params = {}, mask = null) {
  const F = Math.fround;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const amount = F(clampTo(num(params.amount, 10), 1, 100));
  const zoom = Math.round(clampTo(num(params.method, 0), 0, 1)) === 1;
  const quality = Math.round(clampTo(num(params.quality, 1), 0, 2));
  const centerX = F(clampTo(num(params.centerX, 50), 0, 100) / 100);
  const centerY = F(clampTo(num(params.centerY, 50), 0, 100) / 100);
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  if (!W || !H) return;
  const src = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) src[i] = F(d[i] / 255);
  const cx = F(W * centerX);
  const cy = F(H * centerY);
  const extent = zoom ? F(amount / 200) : F(amount * F(F(Math.PI) / 180));
  // Per interval count, the (sin, cos) of each Spin step or the Zoom scale.
  const tables = [];
  const table = (n) => {
    if (tables[n]) return tables[n];
    const t = new Float32Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      if (zoom) {
        t[i * 2 + 1] = F(1 - F(F(extent * i) / n));
      } else {
        const a = F(F(F(i / n) - 0.5) * extent);
        t[i * 2] = F(Math.sin(a));
        t[i * 2 + 1] = F(Math.cos(a));
      }
    }
    return (tables[n] = t);
  };
  const acc = [0, 0, 0, 0];
  const smp = [0, 0, 0, 0];
  const sample = (x, y) => {
    const fx = F(x - 0.5);
    const fy = F(y - 0.5);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = F(fx - x0);
    const ay = F(fy - y0);
    smp[0] = smp[1] = smp[2] = smp[3] = 0;
    const taps = [
      [x0, y0, F(F(1 - ax) * F(1 - ay))],
      [x0 + 1, y0, F(ax * F(1 - ay))],
      [x0, y0 + 1, F(F(1 - ax) * ay)],
      [x0 + 1, y0 + 1, F(ax * ay)]
    ];
    for (const [tx, ty, w] of taps) {
      if (w <= 0 || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const j = (ty * W + tx) * 4;
      const a = src[j + 3];
      for (let c = 0; c < 3; c++) smp[c] = F(smp[c] + F(F(src[j + c] * a) * w));
      smp[3] = F(smp[3] + F(a * w));
    }
    // Image::sample unpremultiplies and average_samples premultiplies again.
    const a = smp[3];
    for (let c = 0; c < 3; c++) acc[c] = F(acc[c] + (a > 0 ? F(F(smp[c] / a) * a) : smp[c]));
    acc[3] = F(acc[3] + a);
  };
  for (let y = 0; y < H; y++) {
    const dy = F(F(y + 0.5) - cy);
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const dx = F(F(x + 0.5) - cx);
      const r = F(Math.sqrt(F(F(dx * dx) + F(dy * dy))));
      const n = radialIntervals(F(extent * r), quality);
      const t = table(n);
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      for (let i = 0; i <= n; i++) {
        const s = t[i * 2];
        const c = t[i * 2 + 1];
        if (zoom) sample(F(cx + F(dx * c)), F(cy + F(dy * c)));
        else sample(F(F(cx + F(dx * c)) - F(dy * s)), F(F(cy + F(dx * s)) + F(dy * c)));
      }
      const k = F(1 / (n + 1));
      const a = F(acc[3] * k);
      const o = p * 4;
      for (let c = 0; c < 3; c++) {
        const v = a > 1e-7 ? F(F(acc[c] * k) / a) : 0;
        d[o + c] = Math.round(clampTo(v, 0, 1) * 255);
      }
      d[o + 3] = Math.round(clampTo(a, 0, 1) * 255);
    }
  }
}

const SMART_BLUR_TARGETS = [4, 7, 12];

// Smart Blur sample grid (PhotoCraft blur2.rs `smart_blur`): ri = ceil(radius),
// stride = max(ceil(ri / target), 1) for the quality's target (0 Low 4,
// 1 Medium 7, 2 High 12), and the [dx, dy] offsets on that grid, dy outer,
// within dx^2 + dy^2 <= r^2 + 0.5. radius is clamped to 0.1..100.
export function smartBlurOffsets(radius, quality = 2) {
  const F = Math.fround;
  const r = F(Math.max(0.1, Math.min(100, radius)));
  const ri = Math.ceil(r);
  const target = SMART_BLUR_TARGETS[quality] ?? 12;
  const stride = Math.max(Math.ceil(ri / target), 1);
  const lim = F(F(r * r) + 0.5);
  const offsets = [];
  for (let dy = -ri; dy <= ri; dy += stride) {
    for (let dx = -ri; dx <= ri; dx += stride) {
      if (dx * dx + dy * dy <= lim) offsets.push([dx, dy]);
    }
  }
  return { ri, stride, offsets };
}

// Smart Blur (PhotoCraft blur2.rs `smart_blur` / `smart_rows`) with the canvas
// as bounds at 0, 0. Normal averages the window samples whose every colour
// channel is within threshold / 255 of the centre, weighting colour by alpha
// and averaging alpha over the kept count. Edge Only paints a pixel white
// where a 4-neighbour differs by more than the threshold and black elsewhere;
// Overlay Edge paints only the edges white. Alpha is kept in the edge modes.
// Off-canvas reads repeat the edge, as the engine's clamped layer read does.
// Reads come from a copy; the mask limits writes. f32 via Math.fround.
export function applySmartBlur(imgData, params = {}, mask = null) {
  const F = Math.fround;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const radius = F(clampTo(num(params.radius, 3), 0.1, 100));
  const threshold = F(clampTo(num(params.threshold, 25), 0.1, 100));
  const quality = Math.round(clampTo(num(params.quality, 2), 0, 2));
  const mode = Math.round(clampTo(num(params.mode, 0), 0, 2));
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  if (!W || !H) return;
  const t = F(threshold / 255);
  const src = new Float32Array(W * H * 4);
  for (let i = 0; i < src.length; i++) src[i] = F(d[i] / 255);
  const at = (x, y) => (clampTo(y, 0, H - 1) * W + clampTo(x, 0, W - 1)) * 4;
  const differs = (q, m) =>
    Math.abs(F(src[q] - src[m])) > t ||
    Math.abs(F(src[q + 1] - src[m + 1])) > t ||
    Math.abs(F(src[q + 2] - src[m + 2])) > t;
  const toByte = (v) => Math.round(F(clampTo(v, 0, 1) * 255));
  const { offsets } = smartBlurOffsets(radius, quality);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const m = p * 4;
      if (mode !== 0) {
        const edge =
          differs(at(x + 1, y), m) ||
          differs(at(x, y + 1), m) ||
          differs(at(x - 1, y), m) ||
          differs(at(x, y - 1), m);
        if (edge) d.fill(255, m, m + 3);
        else if (mode === 1) d.fill(0, m, m + 3);
        continue;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (const [dx, dy] of offsets) {
        const q = at(x + dx, y + dy);
        if (differs(q, m)) continue;
        const qa = src[q + 3];
        r = F(r + F(src[q] * qa));
        g = F(g + F(src[q + 1] * qa));
        b = F(b + F(src[q + 2] * qa));
        a = F(a + qa);
        wsum++;
      }
      if (wsum === 0) continue;
      const oa = F(a / wsum);
      const un = (v) => (oa > 1e-7 ? F(F(v / wsum) / oa) : 0);
      d[m] = toByte(un(r));
      d[m + 1] = toByte(un(g));
      d[m + 2] = toByte(un(b));
      d[m + 3] = toByte(oa);
    }
  }
}

const F32_PI = Math.fround(Math.PI);

// Even-odd point-in-polygon (PhotoCraft blur2.rs `in_poly`), in f32.
export function inPoly(u, v, pts) {
  const F = Math.fround;
  let inside = false;
  let j = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > v !== yj > v && u < F(F(F(F(xj - xi) * F(v - yi)) / F(yj - yi)) + xi)) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

// Radius of a regular n-gon with circumradius 1 in direction theta
// (PhotoCraft blur2.rs `polygon_radius`), in f32.
export function polygonRadius(theta, n, rot) {
  const F = Math.fround;
  const seg = F(F(2 * F32_PI) / n);
  let m = F(F(theta - rot) % seg);
  if (m < 0) m = F(m + seg);
  const a = F(m - F(seg / 2));
  return F(F(Math.cos(F(F32_PI / n))) / F(Math.cos(a)));
}

const SHAPE_BLUR_STAR = Array.from({ length: 10 }, (_, i) => {
  const F = Math.fround;
  const r = i % 2 === 0 ? 1 : F(0.42);
  const a = F(F(-F32_PI / 2) + F(F(i * F32_PI) / 5));
  return [F(r * F(Math.cos(a))), F(r * F(Math.sin(a)))];
});

// Shape Blur kernels (PhotoCraft blur2.rs `shape_inside`): inside(u, v) with
// u, v in -1..1, in f32. Index is the shape: 0 Circle, 1 Ring, 2 Square,
// 3 Diamond, 4 Triangle, 5 Hexagon, 6 Star, 7 Heart, 8 Cross.
export const SHAPE_BLUR_INSIDE = [
  (u, v) => Math.fround(Math.fround(u * u) + Math.fround(v * v)) <= 1,
  (u, v) => {
    const d = Math.fround(Math.fround(u * u) + Math.fround(v * v));
    return d >= Math.fround(0.36) && d <= 1;
  },
  () => true,
  (u, v) => Math.fround(Math.abs(u) + Math.abs(v)) <= 1,
  (u, v) => v <= 0.75 && Math.abs(u) <= Math.fround(Math.fround(v + 1) / 1.75),
  (u, v) => {
    const F = Math.fround;
    return F(Math.sqrt(F(F(u * u) + F(v * v)))) <= polygonRadius(F(Math.atan2(v, u)), 6, 0);
  },
  (u, v) => inPoly(u, v, SHAPE_BLUR_STAR),
  (u, v) => {
    // (x^2 + y^2 - 1)^3 - x^2 y^3 <= 0, scaled into the unit square, y up.
    const F = Math.fround;
    const x = F(u * F(1.2));
    const y = F(F(F(-v) * F(1.2)) + F(0.15));
    const t = F(F(F(x * x) + F(y * y)) - 1);
    return F(F(t * F(t * t)) - F(F(F(F(x * x) * y) * y) * y)) <= 0;
  },
  (u, v) => Math.abs(u) <= Math.fround(0.3) || Math.abs(v) <= Math.fround(0.3)
];

// A binary kernel as inclusive horizontal runs [dy, dx0, dx1] (PhotoCraft
// blur2.rs `Spans::new`): inside(dx / r, dy / r) over -ceil(r)..ceil(r).
// r < 0.5, or a kernel with no hits, is the single centre pixel.
export function shapeBlurSpans(r, inside) {
  const F = Math.fround;
  r = F(r);
  if (!(r >= 0.5)) return { rows: [[0, 0, 0]], count: 1 };
  const ri = Math.ceil(r);
  const rows = [];
  let count = 0;
  for (let dy = -ri; dy <= ri; dy++) {
    const v = F(dy / r);
    let run = null;
    for (let dx = -ri; dx <= ri + 1; dx++) {
      const hit = dx <= ri && inside(F(dx / r), v);
      if (hit && run === null) run = dx;
      else if (!hit && run !== null) {
        rows.push([dy, run, dx - 1]);
        count += dx - run;
        run = null;
      }
    }
  }
  if (rows.length === 0) return { rows: [[0, 0, 0]], count: 1 };
  return { rows, count };
}

// Shape Blur (PhotoCraft shape_blur.rs `Prepared`) with the canvas as bounds
// at 0, 0: the mean of premultiplied RGBA over the shape's spans, divided by
// the kernel's fixed pixel count, then unpremultiplied (alpha > 1e-7). Per-row
// f64 prefix sums make each span two lookups. Off-canvas reads repeat the
// edge, as the engine's clamped layer read does. radius clamps 5..1000; shape
// rounds and clamps 0..8. Reads come from a copy; the mask limits writes.
export function applyShapeBlur(imgData, params = {}, mask = null) {
  const F = Math.fround;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const radius = F(clampTo(num(params.radius, 10), 5, 1000));
  const shape = Math.round(clampTo(num(params.shape, 0), 0, 8));
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  if (!W || !H) return;
  const { rows, count } = shapeBlurSpans(radius, SHAPE_BLUR_INSIDE[shape]);
  // Each row is padded by the halo (ceil(r) + 1) of repeated edge pixels, so
  // prefix index i covers padded columns 0..i - 1, i.e. x = i - 1 - pad.
  const pad = Math.ceil(radius) + 1;
  const PW = W + 2 * pad;
  const stride = (PW + 1) * 4;
  const prefix = new Float64Array(stride * H);
  for (let y = 0; y < H; y++) {
    const row = y * stride;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let i = 0; i < PW; i++) {
      const s = (y * W + clampTo(i - pad, 0, W - 1)) * 4;
      const a = F(d[s + 3] / 255);
      sr += F(F(d[s] / 255) * a);
      sg += F(F(d[s + 1] / 255) * a);
      sb += F(F(d[s + 2] / 255) * a);
      sa += a;
      const o = row + (i + 1) * 4;
      prefix[o] = sr;
      prefix[o + 1] = sg;
      prefix[o + 2] = sb;
      prefix[o + 3] = sa;
    }
  }
  const out = new Uint8ClampedArray(d.length);
  out.set(d);
  const toByte = (v) => Math.round(F(clampTo(v, 0, 1) * 255));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [dy, x0, x1] of rows) {
        const row = clampTo(y + dy, 0, H - 1) * stride;
        const lo = row + (x + x0 + pad) * 4;
        const hi = row + (x + x1 + pad + 1) * 4;
        r += prefix[hi] - prefix[lo];
        g += prefix[hi + 1] - prefix[lo + 1];
        b += prefix[hi + 2] - prefix[lo + 2];
        a += prefix[hi + 3] - prefix[lo + 3];
      }
      const oa = F(a / count);
      const un = (v) => (oa > 1e-7 ? F(F(v / count) / oa) : 0);
      const m = p * 4;
      out[m] = toByte(un(r));
      out[m + 1] = toByte(un(g));
      out[m + 2] = toByte(un(b));
      out[m + 3] = toByte(oa);
    }
  }
  d.set(out);
}

// Lens Blur iris (PhotoCraft blur2.rs `lens_blur`): a `blades`-gon rounded
// toward the circle by curvature 0..1, turned by rot radians, u, v in -1..1.
export function lensIris(blades, curvature, rot) {
  const F = Math.fround;
  const turn = F(rot - F(F32_PI / 2));
  return (u, v) => {
    const rho = F(Math.sqrt(F(F(u * u) + F(v * v))));
    const pr = polygonRadius(F(Math.atan2(v, u)), blades, turn);
    return rho <= F(pr + F(F(1 - pr) * curvature));
  };
}

const LENS_LEVELS = 8;
const LENS_BLADES = { triangle: 3, square: 4, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8 };

// Lens Blur's depth source. paint.js registers the active layer's mask
// (Uint8Array W * H, 0..255, or null) for the Layer Mask depth map.
let lensDepth = { layerMask: () => null };
export function setLensDepthSource(source) {
  lensDepth = source;
}

// Lens Blur (PhotoCraft blur2.rs `lens_blur`) with the canvas as bounds:
// highlights at or above threshold are brightened by up to 5x (brightness
// 0..100) on premultiplied RGBA, then each pixel is the mean over an iris
// kernel. With a depth map (transparency, or a 0..255 layer mask given as
// depthMap) the iris radius steps through 8 levels with |depth - focal|,
// interpolating between them, so the focal plane stays sharp. Noise (0..100,
// uniform or gaussian, mono reuses channel 0) restores grain. Off-canvas reads
// repeat the edge; reads come from a copy and the mask limits writes.
export function applyLensBlur(imgData, params = {}, mask = null, depthMap = null) {
  const F = Math.fround;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  if (!W || !H) return;
  const rmax = F(clampTo(num(params.radius, 15), 0, 100));
  const blades = LENS_BLADES[params.shape] ?? clampTo(Math.round(num(params.shape, 6)), 3, 8);
  const curv = F(clampTo(num(params.bladeCurvature, 0), 0, 100) / 100);
  const rot = F((num(params.rotation, 0) * Math.PI) / 180);
  const iris = lensIris(blades, curv, rot);
  const levels = [];
  for (let k = 0; k <= LENS_LEVELS; k++) {
    levels.push(shapeBlurSpans(F(F(rmax * k) / LENS_LEVELS), iris));
  }
  const p = new Float32Array(W * H * 4);
  for (let i = 0; i < p.length; i += 4) {
    const a = F(d[i + 3] / 255);
    p[i] = F(d[i] / 255) * a;
    p[i + 1] = F(d[i + 1] / 255) * a;
    p[i + 2] = F(d[i + 2] / 255) * a;
    p[i + 3] = a;
  }
  const boost = F(F(clampTo(num(params.brightness, 0), 0, 100) / 100) * 4);
  if (boost > 0) {
    const th = F(clampTo(num(params.threshold, 255), 0, 255) / 255);
    for (let i = 0; i < p.length; i += 4) {
      const a = p[i + 3];
      if (a <= 0) continue;
      const l = F(
        F(F(0.299 * F(p[i] / a)) + F(0.587 * F(p[i + 1] / a))) + F(0.114 * F(p[i + 2] / a))
      );
      const k = F(1 + F(boost * smoothstep(th, F(th + F(0.02)), l)));
      p[i] *= k;
      p[i + 1] *= k;
      p[i + 2] *= k;
    }
  }
  // Rows padded by the largest halo of repeated edge pixels (see applyShapeBlur).
  const pad = Math.ceil(rmax) + 1;
  const PW = W + 2 * pad;
  const stride = (PW + 1) * 4;
  const prefix = new Float64Array(stride * H);
  for (let y = 0; y < H; y++) {
    const row = y * stride;
    for (let i = 0; i < PW; i++) {
      const s = (y * W + clampTo(i - pad, 0, W - 1)) * 4;
      const o = row + (i + 1) * 4;
      for (let c = 0; c < 4; c++) prefix[o + c] = prefix[o + c - 4] + p[s + c];
    }
  }
  const mean = (spans, x, y, acc) => {
    acc.fill(0);
    for (const [dy, x0, x1] of spans.rows) {
      const row = clampTo(y + dy, 0, H - 1) * stride;
      const lo = row + (x + x0 + pad) * 4;
      const hi = row + (x + x1 + pad + 1) * 4;
      for (let c = 0; c < 4; c++) acc[c] += prefix[hi + c] - prefix[lo + c];
    }
    for (let c = 0; c < 4; c++) acc[c] /= spans.count;
  };
  const depth = params.depthMap ?? 'none';
  const map = depth === 'layerMask' ? (depthMap ?? lensDepth.layerMask()) : null;
  const invert = !!params.invert;
  const depthAt = (q) => {
    let v;
    if (depth === 'transparency') v = F(d[q * 4 + 3] / 255);
    else if (map && map.length === W * H) v = F(map[q] / 255);
    else return null;
    return invert ? F(1 - v) : v;
  };
  const focal = F(clampTo(num(params.focalDistance, 0), 0, 255) / 255);
  const amount = F(F(clampTo(num(params.noise, 0), 0, 100) / 100) * F(0.25));
  const gaussian = params.distribution === 'gaussian';
  const mono = !!params.monochromatic;
  const seed = num(params.seed, 0) >>> 0;
  const acc = new Float64Array(4);
  const acc2 = new Float64Array(4);
  const px = new Float32Array(4);
  const out = new Uint8ClampedArray(d);
  const toByte = (v) => Math.round(F(clampTo(v, 0, 1) * 255));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const q = y * W + x;
      if (mask && !mask[q]) continue;
      const dv = depthAt(q);
      const level =
        dv === null ? LENS_LEVELS : Math.min(F(Math.abs(dv - focal) * LENS_LEVELS), LENS_LEVELS);
      const lo = Math.floor(level);
      const f = F(level - lo);
      mean(levels[lo], x, y, acc);
      if (f > 1e-4 && lo < LENS_LEVELS) {
        mean(levels[lo + 1], x, y, acc2);
        for (let c = 0; c < 4; c++) acc[c] += (acc2[c] - acc[c]) * f;
      }
      for (let c = 0; c < 4; c++) px[c] = acc[c];
      const a = px[3];
      for (let c = 0; c < 3; c++) px[c] = a > 1e-7 ? F(px[c] / a) : 0;
      if (amount > 0 && a > 0) {
        for (let c = 0; c < 3; c++) {
          const ch = mono ? 0 : c;
          if (gaussian) {
            const u1 = Math.max(hash01(x, y, ch * 2 + 301, seed), 1e-7);
            const u2 = hash01(x, y, ch * 2 + 302, seed);
            px[c] += Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * amount * 0.5;
          } else {
            px[c] += (hash01(x, y, ch + 200, seed) - 0.5) * 2 * amount;
          }
        }
      }
      const o = q * 4;
      for (let c = 0; c < 4; c++) out[o + c] = toByte(px[c]);
    }
  }
  d.set(out);
}

// One running-sum box pass of radius r along a line of len pixels with n
// interleaved channels, starting at pixel `start`, `step` pixels apart, reading
// `from` and writing the mean to `to`. Samples clamp to the line's ends and the
// sums are f64 (PhotoCraft fxutil.rs `box_rows_n` / `box_cols_n`); a
// Float32Array `to` rounds each pass to f32 as the engine does.
function boxPass(from, to, n, r, start, step, len) {
  const k = 1 / (2 * r + 1);
  const acc = new Float64Array(n);
  for (let t = -r; t <= r; t++) {
    const j = (start + (t < 0 ? 0 : t >= len ? len - 1 : t) * step) * n;
    for (let c = 0; c < n; c++) acc[c] += from[j + c];
  }
  for (let t = 0; t < len; t++) {
    const o = (start + t * step) * n;
    for (let c = 0; c < n; c++) to[o + c] = acc[c] * k;
    const add = (start + Math.min(len - 1, t + r + 1) * step) * n;
    const sub = (start + Math.max(0, t - r) * step) * n;
    for (let c = 0; c < n; c++) acc[c] += from[add + c] - from[sub + c];
  }
}

// Odd box widths whose 3-fold convolution approximates a Gaussian of sigma
// (PhotoCraft fxutil.rs `gauss_box_radii`, Kovesi 2010, in f32), as radii.
export function gaussBoxRadii(sigma) {
  const F = Math.fround;
  const s2 = F(F(12 * F(sigma)) * F(sigma));
  let wl = Math.floor(F(Math.sqrt(F(F(s2 / 3) + 1))));
  if (wl % 2 === 0) wl -= 1;
  wl = Math.max(wl, 1);
  const wu = wl + 2;
  const num = F(F(F(s2 - F(3 * wl * wl)) - F(F(12) * wl)) - 9);
  const m = Math.max(0, Math.min(3, Math.round(F(num / F(-4 * wl - 4)))));
  const radii = [0, 1, 2].map((i) => (i < m ? (wl - 1) / 2 : (wu - 1) / 2));
  if (radii.every((r) => r === 0)) radii[0] = 1;
  return radii;
}

// In-place approximate Gaussian of a w x h buffer with n interleaved f32
// channels (PhotoCraft fxutil.rs `gauss_blur_n`): three row passes, then three
// column passes. Sigma below 0.3 is the identity.
export function gaussBlurN(buf, w, h, n, sigma) {
  if (!(sigma >= 0.3)) return;
  const radii = gaussBoxRadii(sigma);
  const tmp = new Float32Array(buf.length);
  for (const r of radii) {
    if (r === 0 || w === 0) continue;
    tmp.set(buf);
    for (let y = 0; y < h; y++) boxPass(tmp, buf, n, r, y * w, 1, w);
  }
  for (const r of radii) {
    if (r === 0 || h === 0) continue;
    tmp.set(buf);
    for (let x = 0; x < w; x++) boxPass(tmp, buf, n, r, x, w, h);
  }
}

// Box blur, following PhotoCraft blur.rs `boxed`: a separable uniform kernel of
// width 2r + 1, horizontal then vertical, over premultiplied RGBA. Running sums
// keep it O(1) per pixel. Samples clamp to the edge; the mask limits writes only.
export function applyBoxBlur(imgData, radius, mask = null) {
  const r = Math.round(Math.max(0, Number(radius) || 0));
  if (r === 0) return;
  const d = imgData.data;
  const W = imgData.width,
    H = imgData.height;
  const src = new Float64Array(W * H * 4);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    src[i] = d[i] * a;
    src[i + 1] = d[i + 1] * a;
    src[i + 2] = d[i + 2] * a;
    src[i + 3] = d[i + 3];
  }

  const tmp = new Float64Array(src.length);
  for (let y = 0; y < H; y++) boxPass(src, tmp, 4, r, y * W, 1, W);
  for (let x = 0; x < W; x++) boxPass(tmp, src, 4, r, x, W, H);

  for (let p = 0; p < W * H; p++) {
    if (mask && !mask[p]) continue;
    const o = p * 4;
    const a = src[o + 3] / 255;
    d[o] = a > 0 ? clamp(Math.round(src[o] / a)) : 0;
    d[o + 1] = a > 0 ? clamp(Math.round(src[o + 1] / a)) : 0;
    d[o + 2] = a > 0 ? clamp(Math.round(src[o + 2] / a)) : 0;
    d[o + 3] = clamp(Math.round(src[o + 3]));
  }
}

// Surface Blur, following PhotoCraft blur.rs `surface_direct` (RGB with alpha):
// each of R, G, B becomes the mean of the (2r + 1)^2 window weighted by
// max(0, 1 - |v - v0| / t), with t = threshold * 2.5 on bytes. Window pixels
// outside the image or with alpha 0 are skipped; a zero weight sum keeps v0.
// Alpha is unchanged. A per-channel 256-bin histogram slides along each row
// (PhotoCraft surface_8bit); weights are scaled by 2t so whole thresholds sum
// exactly. Reads come from a copy; the mask limits writes only.
export function applySurfaceBlur(imgData, radius, threshold, mask = null) {
  const r = Math.min(100, Math.max(1, Math.round(Number(radius) || 0)));
  const t = Math.min(255, Math.max(2, Number(threshold) || 0)) * 2.5;
  const reach = Math.min(255, Math.ceil(t));
  const wt = new Float64Array(256);
  for (let k = 0; k < 256; k++) wt[k] = Math.max(0, 2 * t - 2 * k);
  const d = imgData.data;
  const src = d.slice();
  const W = imgData.width,
    H = imgData.height;
  const hist = new Int32Array(3 * 256);
  const column = (x, y0, y1, s) => {
    for (let yy = y0; yy <= y1; yy++) {
      const o = (yy * W + x) * 4;
      if (src[o + 3] === 0) continue;
      hist[src[o]] += s;
      hist[256 + src[o + 1]] += s;
      hist[512 + src[o + 2]] += s;
    }
  };
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r),
      y1 = Math.min(H - 1, y + r);
    hist.fill(0);
    for (let x = 0; x <= Math.min(W - 1, r); x++) column(x, y0, y1, 1);
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!mask || mask[p]) {
        const o = p * 4;
        for (let c = 0; c < 3; c++) {
          const v0 = src[o + c];
          const base = c * 256;
          let acc = 0,
            wsum = 0;
          const lo = Math.max(0, v0 - reach),
            hi = Math.min(255, v0 + reach);
          for (let k = lo; k <= hi; k++) {
            const cnt = hist[base + k];
            if (cnt === 0) continue;
            const w = wt[k < v0 ? v0 - k : k - v0] * cnt;
            acc += k * w;
            wsum += w;
          }
          d[o + c] = wsum > 0 ? clamp(Math.round(acc / wsum)) : v0;
        }
      }
      if (x - r >= 0) column(x - r, y0, y1, -1);
      if (x + r + 1 < W) column(x + r + 1, y0, y1, 1);
    }
  }
}

// Median, following PhotoCraft noise.rs `median` with no threshold: each RGBA
// channel takes the sample at index floor(count / 2) of the disc
// dx^2 + dy^2 <= r^2 + r, read from an unmodified copy. Outside the image reads
// as 0. A per-channel 256-bin histogram slides along each row, swapping the two
// ends of every disc row per step. The mask limits writes only.
export function applyMedian(imgData, radius, mask = null) {
  const r = Math.round(Math.max(0, Number(radius) || 0));
  if (r === 0) return;
  const d = imgData.data;
  const W = imgData.width,
    H = imgData.height;
  const src = d.slice();
  // Half-width of the disc on row dy = j - r.
  const hws = new Int32Array(2 * r + 1);
  let count = 0;
  for (let j = 0; j <= 2 * r; j++) {
    const dy = j - r;
    hws[j] = Math.floor(Math.sqrt(r * r + r - dy * dy));
    count += 2 * hws[j] + 1;
  }
  const mid = (count / 2) | 0;
  const hist = new Int32Array(1024);
  // Add (sign 1) or remove (sign -1) the sample at (x, y); outside counts bin 0.
  const bump = (x, y, sign) => {
    if (x < 0 || x >= W || y < 0 || y >= H) {
      for (let c = 0; c < 4; c++) hist[c * 256] += sign;
      return;
    }
    const i = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) hist[c * 256 + src[i + c]] += sign;
  };

  for (let y = 0; y < H; y++) {
    hist.fill(0);
    for (let j = 0; j <= 2 * r; j++) {
      for (let dx = -hws[j]; dx <= hws[j]; dx++) bump(dx, y + j - r, 1);
    }
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!mask || mask[p]) {
        for (let c = 0; c < 4; c++) {
          const base = c * 256;
          let v = 0,
            seen = hist[base];
          while (seen <= mid) seen += hist[base + ++v];
          d[p * 4 + c] = v;
        }
      }
      if (x + 1 < W) {
        for (let j = 0; j <= 2 * r; j++) {
          const yy = y + j - r;
          bump(x - hws[j], yy, -1);
          bump(x + 1 + hws[j], yy, 1);
        }
      }
    }
  }
}

// PhotoCraft noise.rs `hash01`: a 32-bit integer hash of (x, y, channel, seed)
// mapped to [0, 1).
export function hash01(x, y, c, seed) {
  let h =
    Math.imul(x, 0x8da6b343) ^
    Math.imul(y, 0xd8163841) ^
    Math.imul(c, 0xcb1ab31f) ^
    Math.imul(seed, 0x9e3779b9);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

// Add Noise, following PhotoCraft noise.rs `add`: amount 100 spans +-50% of the
// range for uniform noise, and gaussian noise uses the same amount as ~2 sigma.
// Noise depends only on (x, y, channel, seed), so mono reuses channel 0 for R,
// G, and B. Alpha-0 pixels are skipped; alpha is unchanged.
export function applyAddNoise(imgData, amount, gaussian, mono, seed, mask = null) {
  const a = (Math.max(0, Number(amount) || 0) / 100) * 0.5;
  if (a === 0) return;
  const gauss = Number(gaussian) >= 0.5;
  const isMono = Number(mono) >= 0.5;
  const s = Math.round(Number(seed) || 0);
  const { width: W } = imgData;
  const d = imgData.data;
  for (let p = 0, i = 0; i < d.length; p++, i += 4) {
    if ((mask && !mask[p]) || d[i + 3] === 0) continue;
    const x = p % W,
      y = (p / W) | 0;
    for (let c = 0; c < 3; c++) {
      const ch = isMono ? 0 : c;
      let n;
      if (gauss) {
        const u1 = Math.max(hash01(x, y, ch * 2 + 101, s), 1e-7);
        const u2 = hash01(x, y, ch * 2 + 102, s);
        n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * a * 0.5;
      } else {
        n = (hash01(x, y, ch, s) - 0.5) * 2 * a;
      }
      d[i + c] = Math.round(d[i + c] + n * 255);
    }
  }
}

// Dust & Scratches, following PhotoCraft noise.rs `median` with a threshold:
// take applyMedian's result on a copy, then keep each original channel when it
// is within threshold levels of its median. The mask limits writes only.
export function applyDustScratches(imgData, radius, threshold, mask = null) {
  const r = Math.round(Math.max(0, Number(radius) || 0));
  if (r === 0) return;
  const t = Math.max(0, Number(threshold) || 0);
  const d = imgData.data;
  const med = { width: imgData.width, height: imgData.height, data: d.slice() };
  applyMedian(med, r, mask);
  const m = med.data;
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i] - m[i]) > t) d[i] = m[i];
  }
}

// out[i] = extreme of v[i .. i + k - 1] for every full window of v (length
// len), via van Herk / Gil-Werman: prefix extremes within blocks of k (g) and
// suffix extremes within blocks (h), one lookup of each per output.
function runningExtreme(v, len, k, max, g, h, out) {
  const pick = max ? Math.max : Math.min;
  for (let i = 0; i < len; i++) g[i] = i % k === 0 ? v[i] : pick(g[i - 1], v[i]);
  for (let i = len - 1; i >= 0; i--) {
    h[i] = i === len - 1 || (i + 1) % k === 0 ? v[i] : pick(h[i + 1], v[i]);
  }
  for (let i = 0; i + k <= len; i++) out[i] = pick(h[i], g[i + k - 1]);
}

// Maximum / Minimum, following PhotoCraft other.rs `min_max` (Preserve:
// Squareness): each RGBA channel takes the extreme over the (2r + 1) square,
// read from an unmodified copy. Outside the image reads as 0. Separable: a
// running extreme along rows, then along columns. The mask limits writes only.
export function applyMinMax(imgData, radius, max, mask = null) {
  const r = Math.round(Math.max(0, Number(radius) || 0));
  if (r === 0) return;
  const d = imgData.data;
  const W = imgData.width,
    H = imgData.height;
  const k = 2 * r + 1;
  const n = Math.max(W, H) + 2 * r;
  const line = new Uint8Array(n),
    g = new Uint8Array(n),
    h = new Uint8Array(n),
    ext = new Uint8Array(n);
  // Rows: rows outside the image are all zeros, so only in-image rows are kept;
  // the column pass pads with the same zeros.
  const tmp = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let c = 0; c < 4; c++) {
      line.fill(0);
      for (let x = 0; x < W; x++) line[x + r] = d[(y * W + x) * 4 + c];
      runningExtreme(line, W + 2 * r, k, max, g, h, ext);
      for (let x = 0; x < W; x++) tmp[(y * W + x) * 4 + c] = ext[x];
    }
  }
  for (let x = 0; x < W; x++) {
    for (let c = 0; c < 4; c++) {
      line.fill(0);
      for (let y = 0; y < H; y++) line[y + r] = tmp[(y * W + x) * 4 + c];
      runningExtreme(line, H + 2 * r, k, max, g, h, ext);
      for (let y = 0; y < H; y++) {
        const p = y * W + x;
        if (!mask || mask[p]) d[p * 4 + c] = ext[y];
      }
    }
  }
}

// Maximum / Minimum with Preserve: Roundness, following PhotoCraft other.rs
// `min_max_round`: the window is the disc dx^2 + dy^2 <= r^2, taken as one
// running extreme per disc row dy, each of half-width hw. Outside the image
// reads as 0. The mask limits writes only.
export function applyMinMaxRound(imgData, radius, max, mask = null) {
  const r = Math.max(0, Number(radius) || 0);
  const ri = Math.floor(r);
  if (ri === 0) return;
  const d = imgData.data;
  const W = imgData.width,
    H = imgData.height;
  const pick = max ? Math.max : Math.min;
  const res = new Uint8Array(W * H * 4).fill(max ? 0 : 255);
  const n = W + 2 * ri + 1;
  const line = new Uint8Array(n),
    g = new Uint8Array(n),
    h = new Uint8Array(n),
    ext = new Uint8Array(n);
  for (let dy = -ri; dy <= ri; dy++) {
    // The epsilon keeps exact squares, e.g. r 5, dy 3 gives 4.
    const hw = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)) + 1e-4);
    const k = 2 * hw + 1;
    for (let y = 0; y < H; y++) {
      const sy = y + dy;
      if (sy < 0 || sy >= H) {
        // A row outside the image is all zeros.
        if (!max) res.fill(0, y * W * 4, (y + 1) * W * 4);
        continue;
      }
      for (let c = 0; c < 4; c++) {
        line.fill(0);
        for (let x = 0; x < W; x++) line[x + hw] = d[(sy * W + x) * 4 + c];
        runningExtreme(line, W + 2 * hw, k, max, g, h, ext);
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4 + c;
          res[i] = pick(res[i], ext[x]);
        }
      }
    }
  }
  for (let p = 0; p < W * H; p++) {
    if (mask && !mask[p]) continue;
    for (let c = 0; c < 4; c++) d[p * 4 + c] = res[p * 4 + c];
  }
}

// 3x3 convolution, after PhotoCraft other2.rs `custom` (the centre of its 5x5
// kernel): each color channel is sum(kernel * pixel) / scale + offset on
// straight (not premultiplied) values, rounded. kernel is 9 row-major taps;
// scale 0 counts as 1. Edges repeat, alpha is kept, reads come from a copy, and
// the mask only limits writes.
export function applyConvolve3(imgData, kernel, scale, offset, mask = null) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const src = d.slice();
  const s = scale === 0 ? 1 : scale;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      let r = 0,
        g = 0,
        b = 0;
      for (let k = 0; k < 9; k++) {
        const w = kernel[k];
        if (!w) continue;
        const sx = Math.max(0, Math.min(W - 1, x + (k % 3) - 1));
        const sy = Math.max(0, Math.min(H - 1, y + ((k / 3) | 0) - 1));
        const j = (sy * W + sx) * 4;
        r += src[j] * w;
        g += src[j + 1] * w;
        b += src[j + 2] * w;
      }
      const o = p * 4;
      d[o] = clamp(Math.round(r / s + offset));
      d[o + 1] = clamp(Math.round(g / s + offset));
      d[o + 2] = clamp(Math.round(b / s + offset));
    }
  }
}

// Filter > Other > Custom (PhotoCraft other2.rs `custom`): each color channel
// is sum(kernel * pixel) / scale + offset over a 5x5 row-major kernel (centre
// index 12), on straight 0..255 values, rounded; alpha is kept. A short kernel
// is zero-padded, scale 0 counts as 1, and an all-zero kernel is a no-op.
// Edges repeat, reads come from a copy, and the mask only limits writes.
export function applyCustom(imgData, kernel, scale = 1, offset = 0, mask = null) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const taps = [];
  for (let i = 0; i < 25; i++) {
    const w = Number(kernel?.[i]) || 0;
    if (w) taps.push([(i % 5) - 2, ((i / 5) | 0) - 2, w]);
  }
  if (!taps.length) return;
  const s = Number(scale) || 1;
  const off = Number(offset) || 0;
  const src = d.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy, w] of taps) {
        const sx = Math.max(0, Math.min(W - 1, x + dx));
        const sy = Math.max(0, Math.min(H - 1, y + dy));
        const j = (sy * W + sx) * 4;
        r += src[j] * w;
        g += src[j + 1] * w;
        b += src[j + 2] * w;
      }
      const o = p * 4;
      d[o] = clamp(Math.round(r / s + off));
      d[o + 1] = clamp(Math.round(g / s + off));
      d[o + 2] = clamp(Math.round(b / s + off));
    }
  }
}

// HSB / HSL encodings (PhotoCraft other2.rs), every component 0..1.
function hueOf(r, g, b, mx, dl) {
  if (dl <= 0) return 0;
  let h;
  if (mx === r) h = (((g - b) / dl) % 6 + 6) % 6;
  else if (mx === g) h = (b - r) / dl + 2;
  else h = (r - g) / dl + 4;
  return h / 6;
}

export function hsbFromRgb([r, g, b]) {
  const mx = Math.max(r, g, b);
  const dl = mx - Math.min(r, g, b);
  return [hueOf(r, g, b, mx, dl), mx > 0 ? dl / mx : 0, mx];
}

export function hslFromRgb([r, g, b]) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const dl = mx - mn;
  const l = (mx + mn) / 2;
  const s = dl <= 0 ? 0 : dl / Math.max(1 - Math.abs(2 * l - 1), 1e-7);
  return [hueOf(r, g, b, mx, dl), Math.max(0, Math.min(1, s)), l];
}

function rgbFromHcm(h, chroma, m) {
  const hp = (((h % 1) + 1) % 1) * 6;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  const rgb = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x]
  ][Math.min(5, Math.floor(hp))];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

export function rgbFromHsb([h, s, v]) {
  const chroma = v * s;
  return rgbFromHcm(h, chroma, v - chroma);
}

export function rgbFromHsl([h, s, l]) {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  return rgbFromHcm(h, chroma, l - chroma / 2);
}

const HSB_DECODE = { rgb: (c) => c, hsb: rgbFromHsb, hsl: rgbFromHsl };
const HSB_ENCODE = { rgb: (c) => c, hsb: hsbFromRgb, hsl: hslFromRgb };

// Filter > Other > HSB/HSL (PhotoCraft other2.rs `hsb_hsl`): reads R, G, B as
// the input model (rgb, hsb, or hsl) and writes the output model's three
// components into R, G, B. Alpha is kept; equal models are a no-op.
export function applyHsbHsl(imgData, input = 'rgb', output = 'hsb', mask = null) {
  if (input === output) return;
  const decode = HSB_DECODE[input] ?? HSB_DECODE.rgb;
  const encode = HSB_ENCODE[output] ?? HSB_ENCODE.hsb;
  const d = imgData.data;
  for (let p = 0, i = 0; i < d.length; p++, i += 4) {
    if (mask && !mask[p]) continue;
    const o = encode(decode([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]));
    d[i] = clamp(Math.round(o[0] * 255));
    d[i + 1] = clamp(Math.round(o[1] * 255));
    d[i + 2] = clamp(Math.round(o[2] * 255));
  }
}

// Unsharp mask: blur a copy at a fixed small radius, then push each pixel away
// from its blurred value by amount / 100. Alpha is left alone.
const SHARPEN_RADIUS = 1;
export function applySharpen(imgData, amount, mask = null) {
  const k = Math.max(0, Math.min(100, Number(amount) || 0)) / 100;
  if (k === 0) return;
  const d = imgData.data;
  const blurred = { width: imgData.width, height: imgData.height, data: d.slice() };
  applyGaussianBlur(blurred, SHARPEN_RADIUS, mask);
  const b = blurred.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    d[i] = clamp(Math.round(d[i] + (d[i] - b[i]) * k));
    d[i + 1] = clamp(Math.round(d[i + 1] + (d[i + 1] - b[i + 1]) * k));
    d[i + 2] = clamp(Math.round(d[i + 2] + (d[i + 2] - b[i + 2]) * k));
  }
}

// High Pass, after PhotoCraft's sharpen.rs high_pass: each color channel becomes
// mid gray plus its difference from a Gaussian blur at the same radius. The blur
// reads an unmasked copy, so masked-out pixels still feed it. Transparent pixels
// and alpha are left alone.
export function applyHighPass(imgData, radius, mask = null) {
  const d = imgData.data;
  const blurred = { width: imgData.width, height: imgData.height, data: d.slice() };
  applyGaussianBlur(blurred, radius);
  const b = blurred.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    d[i] = clamp(Math.round(127.5 + d[i] - b[i]));
    d[i + 1] = clamp(Math.round(127.5 + d[i + 1] - b[i + 1]));
    d[i + 2] = clamp(Math.round(127.5 + d[i + 2] - b[i + 2]));
  }
}

// Smart Sharpen, after PhotoCraft's sharpen.rs smart: unsharp masking against a
// Gaussian blur at the same radius, with differences near noise level damped by
// reduceNoise. The blur reads an unmasked copy, so masked-out pixels still feed
// it. Transparent pixels and alpha are left alone.
export function applySmartSharpen(imgData, amount, radius, reduceNoise, mask = null) {
  const d = imgData.data;
  const blurred = { width: imgData.width, height: imgData.height, data: d.slice() };
  applyGaussianBlur(blurred, radius);
  const b = blurred.data;
  const k = amount / 100;
  const nr = Math.min(1, Math.max(0, reduceNoise / 100));
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      const o = d[i + c];
      const diff = o - b[i + c];
      const keep = 1 - nr * Math.exp(-(Math.abs(diff) / 255) * 40);
      d[i + c] = clamp(Math.round(o + k * diff * keep));
    }
  }
}

// Unsharp Mask, after PhotoCraft's sharpen/exact.rs run: each channel moves by
// amount / 100 of its difference from a Gaussian blur at radius, but only where
// that difference reaches threshold (inclusive). The blur reads an unmasked
// copy, so masked-out pixels still feed it. Transparent pixels and alpha are
// left alone.
export function applyUnsharpMask(imgData, amount, radius, threshold, mask = null) {
  const d = imgData.data;
  const blurred = { width: imgData.width, height: imgData.height, data: d.slice() };
  applyGaussianBlur(blurred, radius);
  const b = blurred.data;
  const k = amount / 100;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      const o = d[i + c];
      const diff = o - b[i + c];
      if (Math.abs(diff) + 1e-6 >= threshold) d[i + c] = clamp(Math.round(o + k * diff));
    }
  }
}

// Emboss, after PhotoCraft's Stylize > Emboss: each pixel becomes a gray relief
// of the luma difference between the samples h pixels ahead of and behind it
// along the light angle. Edges clamp; reads come from an unmodified copy, so
// masked-out pixels still count as neighbors. Alpha is left alone.
export function applyEmboss(imgData, angle, height, amount, mask = null) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const rad = ((Number(angle) || 0) * Math.PI) / 180;
  const h = Math.max(1, Number(height) || 0);
  const dx = Math.round(Math.cos(rad) * h);
  const dy = Math.round(-Math.sin(rad) * h);
  const k = (Number(amount) || 0) / 100;
  const luma = new Float32Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    luma[p] = d[i] * LUMA_R + d[i + 1] * LUMA_G + d[i + 2] * LUMA_B;
  }
  const at = (x, y) => luma[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      if (mask && !mask[p]) continue;
      const g = clamp(Math.round(128 + k * (at(x + dx, y + dy) - at(x - dx, y - dy))));
      const i = p * 4;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
  }
}

// Find Edges, after PhotoCraft's Stylize > Find Edges: a Sobel magnitude per
// R, G, and B channel on 0..1 samples, drawn as dark lines on white. Edges
// clamp; reads come from an unmodified copy, so masked-out pixels still count
// as neighbors. Alpha is left alone.
export function applyFindEdges(imgData, mask = null) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const src = d.slice();
  for (let y = 0, p = 0; y < H; y++) {
    const ys = [Math.max(0, y - 1), y, Math.min(H - 1, y + 1)];
    for (let x = 0; x < W; x++, p++) {
      if (mask && !mask[p]) continue;
      const xs = [Math.max(0, x - 1), x, Math.min(W - 1, x + 1)];
      const i = p * 4;
      for (let c = 0; c < 3; c++) {
        const g = (dx, dy) => src[(ys[dy + 1] * W + xs[dx + 1]) * 4 + c] / 255;
        const gx = g(1, -1) + 2 * g(1, 0) + g(1, 1) - (g(-1, -1) + 2 * g(-1, 0) + g(-1, 1));
        const gy = g(-1, 1) + 2 * g(0, 1) + g(1, 1) - (g(-1, -1) + 2 * g(0, -1) + g(1, -1));
        const e = Math.min(1, Math.sqrt(gx * gx + gy * gy));
        d[i + c] = Math.round((1 - e) * 255);
      }
    }
  }
}

// Trace Contour, after PhotoCraft's Stylize > Trace Contour (RGB): for each of
// R, G, and B, a pixel is a line when its side of level (v > level) matches the
// edge (0 Lower, 1 Upper) and a 4-neighbour sits on the other side. Neighbours
// repeat at the image border and are read from a copy, so masked-out pixels
// still count. Lines are 0, everything else 255. Alpha is left alone.
export function applyTraceContour(imgData, level, edge, mask = null) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const src = d.slice();
  const t = Math.min(255, Math.max(0, level));
  const upper = Math.min(1, Math.max(0, Math.round(edge))) === 1;
  for (let y = 0, p = 0; y < H; y++) {
    const up = Math.max(0, y - 1) * W;
    const down = Math.min(H - 1, y + 1) * W;
    for (let x = 0; x < W; x++, p++) {
      if (mask && !mask[p]) continue;
      const near = [y * W + Math.min(W - 1, x + 1), y * W + Math.max(0, x - 1), down + x, up + x];
      const i = p * 4;
      for (let c = 0; c < 3; c++) {
        const me = src[i + c] > t;
        const line = me === upper && near.some((q) => src[q * 4 + c] > t !== me);
        d[i + c] = line ? 0 : 255;
      }
    }
  }
}

// Diffuse, after PhotoCraft's Stylize > Diffuse (RGB with alpha). Modes 0..2
// (Normal, Darken Only, Lighten Only) copy a hashed neighbour within one pixel;
// Darken / Lighten copy it only when its luma is lower / higher, and skip a
// transparent neighbour of an opaque pixel. Mode 3 (Anisotropic) averages with
// the ring neighbour closest in luma. Reads come from a copy, and a neighbour
// outside the image is transparent black.
const DIFFUSE_RING = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1]
];

export function applyDiffuse(imgData, mode, seed, mask = null) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const src = d.slice();
  const m = Math.min(3, Math.max(0, Math.round(mode)));
  const s = Math.min(9999, Math.max(0, Math.round(seed)));
  const nb = [0, 0, 0, 0];
  const read = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) {
      nb[0] = nb[1] = nb[2] = nb[3] = 0;
      return;
    }
    const q = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) nb[c] = src[q + c];
  };
  const luma = (a, i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      if (mask && !mask[p]) continue;
      const i = p * 4;
      const me = luma(src, i);
      if (m === 3) {
        let best = Infinity;
        let bx = 0;
        let by = 0;
        const start = Math.floor(hash01(x, y, 3, s) * 8);
        for (let k = 0; k < 8; k++) {
          const [dx, dy] = DIFFUSE_RING[(start + k) % 8];
          read(x + dx, y + dy);
          const dist = Math.abs(luma(nb, 0) - me);
          if (dist < best) {
            best = dist;
            bx = dx;
            by = dy;
          }
        }
        read(x + bx, y + by);
        for (let c = 0; c < 4; c++) d[i + c] = Math.round((src[i + c] + nb[c]) / 2);
        continue;
      }
      const dx = Math.floor(hash01(x, y, 1, s) * 3) - 1;
      const dy = Math.floor(hash01(x, y, 2, s) * 3) - 1;
      read(x + dx, y + dy);
      if (m !== 0 && nb[3] === 0 && src[i + 3] > 0) continue;
      const take = m === 1 ? luma(nb, 0) < me : m === 2 ? luma(nb, 0) > me : true;
      if (take) for (let c = 0; c < 4; c++) d[i + c] = nb[c];
    }
  }
}

// Wind, after PhotoCraft's Stylize > Wind (`wind_direct`, RGB with alpha).
// method 0 Wind, 1 Blast, 2 Stagger; direction 0 From Right (streaks run -x),
// 1 From Left (+x). Stagger shifts hashed row segments downwind. Wind / Blast
// blend each pixel toward the upwind edge pixel with the strongest weight.
// Reads come from a copy, and a pixel outside the image is transparent black.
export function applyWind(imgData, method, direction, seed, mask = null) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const src = d.slice();
  const m = Math.min(2, Math.max(0, Math.round(method)));
  const dir = Math.min(1, Math.max(0, Math.round(direction)));
  const s = Math.min(9999, Math.max(0, Math.round(seed)));
  const dx = dir === 1 ? 1 : -1;
  const lmax = m === 1 ? 40 : m === 2 ? 12 : 16;
  const strength = m === 1 ? 8 : 4;
  const at = (x, y) => (x < 0 || x >= W ? -1 : (y * W + x) * 4);
  const luma = (x, y) => {
    const q = at(x, y);
    return q < 0 ? 0 : 0.299 * src[q] + 0.587 * src[q + 1] + 0.114 * src[q + 2];
  };
  for (let y = 0, p = 0; y < H; y++) {
    const segLen = 8 + Math.floor(hash01(0, y, 41, s) * 32);
    const phase = Math.floor(hash01(1, y, 42, s) * segLen);
    for (let x = 0; x < W; x++, p++) {
      if (mask && !mask[p]) continue;
      const i = p * 4;
      if (m === 2) {
        const seg = Math.floor((x * dx + phase) / segLen);
        const shift = Math.floor(hash01(seg, y, 43, s) ** 2 * lmax);
        const q = at(x - dx * shift, y);
        for (let c = 0; c < 4; c++) d[i + c] = q < 0 ? 0 : src[q + c];
        continue;
      }
      let best = 0;
      let bx = x;
      for (let k = 1; k <= lmax; k++) {
        const sx = x - dx * k;
        const len = Math.max(1, hash01(sx, y, 44, s) ** 2 * lmax);
        if (k > len) continue;
        const edge = Math.min(1, (Math.abs(luma(sx, y) - luma(sx - dx, y)) / 255) * strength);
        const wgt = edge * (1 - k / (len + 1));
        if (wgt > best) {
          best = wgt;
          bx = sx;
        }
      }
      if (best > 0) {
        const q = at(bx, y);
        for (let c = 0; c < 4; c++) {
          const v = src[i + c];
          d[i + c] = Math.round(v + ((q < 0 ? 0 : src[q + c]) - v) * best);
        }
      }
    }
  }
}

// Solarize, after PhotoCraft's Stylize > Solarize (RGB): each of R, G, and B
// above half (v / 255 > 0.5, so v >= 128) inverts to 255 - v. Alpha is left
// alone, including on alpha-0 pixels.
export function applySolarize(imgData, mask = null) {
  const d = imgData.data;
  for (let p = 0, i = 0; i < d.length; p++, i += 4) {
    if (mask && !mask[p]) continue;
    for (let c = i; c < i + 3; c++) if (d[c] >= 128) d[c] = 255 - d[c];
  }
}

// Shared remap for PhotoCraft distort.rs filters (remap with Edge::Repeat).
// map(X, Y, out) gets the output pixel centre (x + 0.5, y + 0.5), writes the
// source point into out[0], out[1], and returns false to leave the pixel alone.
// Sampling is bilinear at (sx - 0.5, sy - 0.5) in premultiplied alpha from a
// copy; alpha 0 gives RGB 0. A mask limits writes only. edge picks PhotoCraft
// Image::sample's Edge for each neighbour: 0 Wrap (rem_euclid), 1 Repeat (clamp,
// the default), 2 Transparent (an outside neighbour contributes 0).
function remapPixels(imgData, mask, map, edge = 1) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const src = new Float32Array(W * H * 4);
  for (let i = 0; i < d.length; i += 4) {
    const al = d[i + 3] / 255;
    src[i] = d[i] * al;
    src[i + 1] = d[i + 1] * al;
    src[i + 2] = d[i + 2] * al;
    src[i + 3] = d[i + 3];
  }
  // idx(x, y) returns the neighbour's offset into src, or -1 for transparent.
  const idx =
    edge === 0
      ? (x, y) => ((((y % H) + H) % H) * W + (((x % W) + W) % W)) * 4
      : edge === 2
      ? (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? -1 : (y * W + x) * 4)
      : (x, y) => ((y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)) * 4;
  const at = (i, ch) => (i < 0 ? 0 : src[i + ch]);
  const out = [0, 0];
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      if (mask && !mask[p]) continue;
      if (!map(x + 0.5, y + 0.5, out)) continue;
      const fx = out[0] - 0.5,
        fy = out[1] - 0.5;
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy);
      const ax = fx - x0,
        ay = fy - y0;
      const i00 = idx(x0, y0),
        i10 = idx(x0 + 1, y0),
        i01 = idx(x0, y0 + 1),
        i11 = idx(x0 + 1, y0 + 1);
      const w00 = (1 - ax) * (1 - ay),
        w10 = ax * (1 - ay),
        w01 = (1 - ax) * ay,
        w11 = ax * ay;
      const o = p * 4;
      const ca = at(i00, 3) * w00 + at(i10, 3) * w10 + at(i01, 3) * w01 + at(i11, 3) * w11;
      const al = ca / 255;
      for (let ch = 0; ch < 3; ch++) {
        const cv = at(i00, ch) * w00 + at(i10, ch) * w10 + at(i01, ch) * w01 + at(i11, ch) * w11;
        d[o + ch] = al > 0 ? clamp(Math.round(cv / al)) : 0;
      }
      d[o + 3] = clamp(Math.round(ca));
    }
  }
}

// Ellipse variant for filters that work inside the ellipse inscribed in the
// image. warp(u, v, r, out) gets the pixel centre in ellipse units
// (r = sqrt(u^2 + v^2) < 1) and writes the source point in the same units.
function remapEllipse(imgData, mask, warp) {
  const hx = imgData.width / 2,
    hy = imgData.height / 2;
  const e = [0, 0];
  remapPixels(imgData, mask, (X, Y, out) => {
    const u = (X - hx) / hx,
      v = (Y - hy) / hy;
    const r = Math.sqrt(u * u + v * v);
    if (r >= 1 || !warp(u, v, r, e)) return false;
    out[0] = hx + e[0] * hx;
    out[1] = hy + e[1] * hy;
    return true;
  });
}

// Twirl, following PhotoCraft distort.rs `twirl`: inside the inscribed ellipse
// each pixel samples the source rotated by angle * (1 - r), so the spin is
// strongest at the centre and fades to nothing at the rim.
export function applyTwirl(imgData, angle, mask = null) {
  const a = ((Number(angle) || 0) * Math.PI) / 180;
  if (a === 0) return;
  remapEllipse(imgData, mask, (u, v, r, out) => {
    const t = a * (1 - r);
    const c = Math.cos(t),
      s = Math.sin(t);
    out[0] = u * c - v * s;
    out[1] = u * s + v * c;
    return true;
  });
}

// Pinch, following PhotoCraft distort.rs `pinch`: inside the inscribed ellipse
// each pixel samples radius r^(1 - a / 2), a = amount / 100 in -1..1. A positive
// amount samples farther out and squeezes the middle; a negative one bulges it.
export function applyPinch(imgData, amount, mask = null) {
  const a = Math.max(-1, Math.min(1, (Number(amount) || 0) / 100));
  if (a === 0) return;
  const e = 1 - a * 0.5;
  remapEllipse(imgData, mask, (u, v, r, out) => {
    if (r <= 0) return false;
    const k = Math.pow(r, e) / r;
    out[0] = u * k;
    out[1] = v * k;
    return true;
  });
}

// PhotoCraft distort.rs `sphere_1d`: rn + |a| * (target - rn), where target is
// asin(rn) * 2 / PI for a >= 0 and sin(rn * PI / 2) for a < 0.
function sphere1d(rn, a) {
  const target = a >= 0 ? (Math.asin(rn) * 2) / Math.PI : Math.sin((rn * Math.PI) / 2);
  return rn + Math.abs(a) * (target - rn);
}

// Spherize, following PhotoCraft distort.rs `spherize` with the image as the
// bounds. Mode 0 (Normal): inside the inscribed ellipse each pixel samples radius
// sphere1d(r, a). Mode 1 (Horizontal Only) / 2 (Vertical Only): every row / column
// remaps its offset from the centre along that one axis. A positive amount samples
// nearer the centre and bulges it; a negative one sucks it in.
export function applySpherize(imgData, amount, mode = 0, mask = null) {
  const a = Math.max(-1, Math.min(1, (Number(amount) || 0) / 100));
  if (a === 0) return;
  const m = Math.max(0, Math.min(2, Math.round(Number(mode) || 0)));
  if (m === 0) {
    remapEllipse(imgData, mask, (u, v, r, out) => {
      if (r <= 0) return false;
      const k = sphere1d(r, a) / r;
      out[0] = u * k;
      out[1] = v * k;
      return true;
    });
    return;
  }
  const hx = imgData.width / 2,
    hy = imgData.height / 2;
  remapPixels(imgData, mask, (X, Y, out) => {
    const dx = X - hx,
      dy = Y - hy;
    out[0] = X;
    out[1] = Y;
    if (m === 1) {
      if (Math.abs(dx) >= hx) return false;
      out[0] = hx + Math.sign(dx) * hx * sphere1d(Math.abs(dx) / hx, a);
    } else {
      if (Math.abs(dy) >= hy) return false;
      out[1] = hy + Math.sign(dy) * hy * sphere1d(Math.abs(dy) / hy, a);
    }
    return true;
  });
}

// Ripple, following PhotoCraft distort.rs `ripple` with the image as the bounds:
// len is 8 / 16 / 32 for size 0 / 1 / 2 (Small / Medium / Large) and
// amp = amount / 100 * len / 8. Each pixel centre (X, Y) samples
// (X + amp * sin(2 PI Y / len), Y + amp * sin(2 PI X / len)), edges repeated.
export function applyRipple(imgData, amount, size = 1, mask = null) {
  const len = [8, 16, 32][Math.max(0, Math.min(2, Math.round(Number(size) || 0)))];
  const amp = (((Number(amount) || 0) / 100) * len) / 8;
  if (amp === 0) return;
  const k = (2 * Math.PI) / len;
  remapPixels(imgData, mask, (X, Y, out) => {
    out[0] = X + amp * Math.sin(k * Y);
    out[1] = Y + amp * Math.sin(k * X);
    return true;
  });
}

// Wave shapes, following PhotoCraft distort.rs `shape`: 0 Sine, 1 Triangle, 2 Square.
function waveShape(type, phase) {
  if (type === 0) return Math.sin(phase);
  const tau = 2 * Math.PI;
  const p = (((phase % tau) + tau) % tau) / tau;
  return type === 1 ? 1 - 4 * Math.abs(p - 0.5) : p < 0.5 ? 1 : -1;
}

// Wave, following PhotoCraft distort.rs `wave` with the image as the bounds: n
// seeded generators (1..64) each pick a wavelength, amplitude, and two phases from
// hash01(i, k, 7, seed). Each pixel centre (X, Y) samples (X + avg amp * shape(2 PI
// Y / len + p1), Y + avg amp * shape(2 PI X / len + p2)). undefinedAreas 0 wraps,
// 1 repeats the edge, 2 reads outside as transparent.
export function applyWave(
  imgData,
  generators,
  wavelengthMin,
  wavelengthMax,
  amplitudeMin,
  amplitudeMax,
  waveType = 0,
  undefinedAreas = 0,
  seed = 0,
  mask = null
) {
  const round = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  const n = round(generators, 1, 64);
  const type = round(waveType, 0, 2);
  const edge = round(undefinedAreas, 0, 2);
  const s = Math.round(Number(seed) || 0);
  const wl0 = Number(wavelengthMin) || 0,
    wl1 = Number(wavelengthMax) || 0;
  const am0 = Number(amplitudeMin) || 0,
    am1 = Number(amplitudeMax) || 0;
  const tau = 2 * Math.PI;
  const gens = [];
  for (let i = 0; i < n; i++) {
    const r = (k) => hash01(i, k, 7, s);
    gens.push([
      Math.max(1, wl0 + Math.max(0, wl1 - wl0) * r(1)),
      am0 + Math.max(0, am1 - am0) * r(2),
      r(3) * tau,
      r(4) * tau
    ]);
  }
  remapPixels(
    imgData,
    mask,
    (X, Y, out) => {
      let dx = 0,
        dy = 0;
      for (const [len, amp, p1, p2] of gens) {
        dx += amp * waveShape(type, (tau * Y) / len + p1);
        dy += amp * waveShape(type, (tau * X) / len + p2);
      }
      out[0] = X + dx / n;
      out[1] = Y + dy / n;
      return true;
    },
    edge
  );
}

// Polar Coordinates, following PhotoCraft distort.rs `polar` / `polar_map` with
// the image as the bounds: the map runs at integer pixel coordinates (the pixel
// centre - 0.5) and the source point is shifted back by + 0.5. mode 0 (Rectangular
// to Polar) reads angle counter-clockwise from 12 o'clock as source x and radius as
// source y; mode 1 (Polar to Rectangular) does the inverse. Edges repeat.
export function applyPolarCoordinates(imgData, mode = 0, mask = null) {
  const { width: W, height: H } = imgData;
  const m = Math.max(0, Math.min(1, Math.round(Number(mode) || 0)));
  const cx = W / 2,
    cy = H / 2;
  const rmax = Math.min(W, H) / 2;
  const tau = 2 * Math.PI;
  remapPixels(imgData, mask, (X, Y, out) => {
    const x = X - 0.5,
      y = Y - 0.5;
    if (m === 0) {
      const dx = x - cx,
        dy = y - cy;
      let theta = Math.atan2(-dx, -dy);
      if (theta <= 0) theta += tau;
      out[0] = (theta / tau) * W + 0.5;
      out[1] = (Math.sqrt(dx * dx + dy * dy) / rmax) * H + 0.5;
    } else {
      const theta = ((x + 1) / W) * tau;
      const r = (y / H) * rmax;
      out[0] = cx - r * Math.sin(theta) + 0.5;
      out[1] = cy - r * Math.cos(theta) + 0.5;
    }
    return true;
  });
}

// ZigZag, following PhotoCraft distort2.rs `zigzag` with the image as the bounds:
// inside the circle inscribed in the image (radius min(W, H) / 2) each pixel's
// radius and angle shift by a decaying wave sin(2 PI k rn) * (1 - rn). style 0
// (Around Center) twists the angle, 1 (Out From Center) pushes the radius, and
// 2 (Pond Ripples) does both at half strength. Edges repeat.
export function applyZigZag(imgData, amount, ridges, style = 2, mask = null) {
  const { width: W, height: H } = imgData;
  const a = Math.max(-1, Math.min(1, (Number(amount) || 0) / 100));
  if (a === 0) return;
  const k = Math.max(Math.max(0, Math.min(20, Number(ridges) || 0)), 0.5);
  const st = Math.max(0, Math.min(2, Math.round(Number(style) || 0)));
  const cx = W / 2,
    cy = H / 2;
  const rr = Math.min(W, H) / 2;
  remapPixels(imgData, mask, (X, Y, out) => {
    const dx = X - cx,
      dy = Y - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r >= rr || r <= 0) return false;
    const rn = r / rr;
    const wave = Math.sin(2 * Math.PI * k * rn) * (1 - rn);
    let radial = 0,
      angular = 0;
    if (st === 0) angular = (a * wave * Math.PI) / (2 * k);
    else if (st === 1) radial = (a * wave * rr) / (4 * k);
    else {
      radial = (a * wave * rr) / (8 * k);
      angular = (a * wave * Math.PI) / (4 * k);
    }
    const th = Math.atan2(dy, dx) + angular;
    const rs = Math.max(r + radial, 0);
    out[0] = cx + rs * Math.cos(th);
    out[1] = cy + rs * Math.sin(th);
    return true;
  });
}

// Offset, following PhotoCraft other.rs `offset` with the image as the bounds:
// output (x, y) reads source (x - dx, y - dy) from a copy, all four channels.
// undefinedAreas 0 wraps (rem_euclid), 1 repeats the edge, 2 leaves a source
// outside the image as transparent black. A mask limits writes only.
export function applyOffset(imgData, dx, dy, undefinedAreas = 0, mask = null) {
  const { width: W, height: H } = imgData;
  const ox = Math.round(Number(dx) || 0);
  const oy = Math.round(Number(dy) || 0);
  const mode = Math.max(0, Math.min(2, Math.round(Number(undefinedAreas) || 0)));
  if (ox === 0 && oy === 0) return;
  const coord = (p, n) => {
    if (mode === 0) return ((p % n) + n) % n;
    if (mode === 1) return Math.max(0, Math.min(n - 1, p));
    return p >= 0 && p < n ? p : -1;
  };
  const d = imgData.data;
  const src = new Uint8ClampedArray(d);
  for (let y = 0, p = 0; y < H; y++) {
    const sy = coord(y - oy, H);
    for (let x = 0; x < W; x++, p++) {
      if (mask && !mask[p]) continue;
      const sx = coord(x - ox, W);
      const i = p * 4;
      if (sx < 0 || sy < 0) {
        d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
        continue;
      }
      const j = (sy * W + sx) * 4;
      d[i] = src[j];
      d[i + 1] = src[j + 1];
      d[i + 2] = src[j + 2];
      d[i + 3] = src[j + 3];
    }
  }
}

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

// Displace's map choices. paint.js registers the open layers: options() lists
// { value, label } and image(value) returns that layer's ImageData (or null).
let displaceMaps = { options: () => [], image: () => null };
export function setDisplaceMapSource(source) {
  displaceMaps = source;
}

// Displace, following PhotoCraft distort2.rs `displace` with the image as the
// bounds: the map's red channel shifts pixels horizontally and its green
// vertically, by up to scale % of 128 px at full contrast. The map is stretched
// over the image (fit 'stretch') or tiled from its top-left ('tile'), and is
// read bilinearly with clamped edges. Byte 128 is the neutral gray, as in
// Photoshop, so a flat 128 map leaves the image alone. undefinedAreas 'wrap'
// or 'repeat' picks the edge. With no map the image is unchanged.
export function applyDisplace(
  imgData,
  horizontal,
  vertical,
  fit,
  undefinedAreas,
  map,
  mask = null
) {
  if (!map || !map.width || !map.height) return;
  const { width: W, height: H } = imgData;
  const mw = map.width,
    mh = map.height,
    md = map.data;
  const sx = (clampNum(horizontal, -999, 999, 10) / 100) * 128;
  const sy = (clampNum(vertical, -999, 999, 10) / 100) * 128;
  const stretch = fit !== 'tile';
  const g = (x, y, c) =>
    md[((y < 0 ? 0 : y >= mh ? mh - 1 : y) * mw + (x < 0 ? 0 : x >= mw ? mw - 1 : x)) * 4 + c];
  const sample = (u, v, c) => {
    const fx = u - 0.5,
      fy = v - 0.5;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const ax = fx - x0,
      ay = fy - y0;
    const top = g(x0, y0, c) + (g(x0 + 1, y0, c) - g(x0, y0, c)) * ax;
    const bot = g(x0, y0 + 1, c) + (g(x0 + 1, y0 + 1, c) - g(x0, y0 + 1, c)) * ax;
    return top + (bot - top) * ay;
  };
  remapPixels(
    imgData,
    mask,
    (X, Y, out) => {
      const u = stretch ? (X / W) * mw : ((X % mw) + mw) % mw;
      const v = stretch ? (Y / H) * mh : ((Y % mh) + mh) % mh;
      out[0] = X + ((sample(u, v, 0) - 128) / 127.5) * sx;
      out[1] = Y + ((sample(u, v, 1) - 128) / 127.5) * sy;
      return true;
    },
    undefinedAreas === 'wrap' ? 0 : 1
  );
}

// PhotoCraft distort2.rs `curve_at`: non-uniform Catmull-Rom through sorted
// [t, value] points, clamped to the end values.
export function shearCurveAt(pts, t) {
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0][1];
  if (t <= pts[0][0]) return pts[0][1];
  const last = pts.length - 1;
  if (t >= pts[last][0]) return pts[last][1];
  let i = 0;
  for (let k = 0; k < last; k++) {
    if (t >= pts[k][0] && t <= pts[k + 1][0]) {
      i = k;
      break;
    }
  }
  const p1 = pts[i],
    p2 = pts[i + 1];
  const p0 = i > 0 ? pts[i - 1] : p1;
  const p3 = i + 2 <= last ? pts[i + 2] : p2;
  const span = Math.max(p2[0] - p1[0], 1e-6);
  const s = (t - p1[0]) / span;
  const m1 = i > 0 ? ((p2[1] - p0[1]) / Math.max(p2[0] - p0[0], 1e-6)) * span : p2[1] - p1[1];
  const m2 =
    i + 2 <= last ? ((p3[1] - p1[1]) / Math.max(p3[0] - p1[0], 1e-6)) * span : p2[1] - p1[1];
  const s2 = s * s,
    s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * p1[1] +
    (s3 - 2 * s2 + s) * m1 +
    (-2 * s3 + 3 * s2) * p2[1] +
    (s3 - s2) * m2
  );
}

// Shear, following PhotoCraft distort2.rs `shear` with the image as the bounds:
// each row shifts horizontally by the curve through points ([t, offset], t 0..1
// top to bottom, offset -1..1 of half the width). undefinedAreas 'wrap' (the
// default) or 'repeat' fills what the shift uncovers.
export function applyShear(imgData, points, undefinedAreas = 'wrap', mask = null) {
  const { width: W, height: H } = imgData;
  const pts = (Array.isArray(points) ? points : [])
    .map((p) => [clampNum(p[0], 0, 1, 0), clampNum(p[1], -1, 1, 0)])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, a) => i === 0 || Math.abs(p[0] - a[i - 1][0]) >= 1e-6);
  const rows = new Float64Array(H);
  for (let y = 0; y < H; y++) rows[y] = (shearCurveAt(pts, (y + 0.5) / H) * W) / 2;
  remapPixels(
    imgData,
    mask,
    (X, Y, out) => {
      out[0] = X - rows[Math.max(0, Math.min(H - 1, Math.floor(Y - 0.5)))];
      out[1] = Y;
      return true;
    },
    undefinedAreas === 'repeat' ? 1 : 0
  );
}

// Extrude, following PhotoCraft stylize2.rs `extrude_direct` (RGBA) with the
// image as the bounds. The image is cut into size-px cells; each cell's height
// is hashed from the seed (depthMode 'random') or is its Rec. 601 luma
// ('levelBased'). Blocks push front faces away from the centre by up to
// depth / 4 px, with the top and left sides lit; Pyramids shade four faces lit
// from the top-left. Cells cut by the edge are left alone with
// maskIncompleteBlocks. Reads come from a copy; a mask limits writes.
export function applyExtrude(imgData, params = {}, mask = null) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const src = d.slice();
  const cs = Math.round(clampNum(params.size, 2, 255, 30));
  const depth = clampNum(params.depth, 1, 255, 30);
  const pyramids = params.type === 'pyramids';
  const levelBased = params.depthMode === 'levelBased';
  const solid = params.solidFrontFaces === true;
  const maskIncomplete = params.maskIncompleteBlocks === true;
  const seed = Math.round(clampNum(params.seed, 0, 0xffffffff, 0));
  const bcx = W / 2,
    bcy = H / 2;
  const halfDiag = Math.max(Math.hypot(W, H) / 2, 1);
  const reach = depth * 0.25;
  const cols = Math.ceil(W / cs),
    rows = Math.ceil(H / cs);
  const infos = new Array(cols * rows);
  // Average straight colour (0..1, alpha last) and height of a cell, sampled every cs / 8 px.
  const info = (gx, gy) => {
    const key = gy * cols + gx;
    if (infos[key]) return infos[key];
    const x0 = gx * cs,
      y0 = gy * cs;
    const x1 = Math.min(W, x0 + cs),
      y1 = Math.min(H, y0 + cs);
    const acc = [0, 0, 0, 0];
    let cnt = 0;
    const step = Math.max(Math.floor(cs / 8), 1);
    for (let yy = y0; yy < y1; yy += step) {
      for (let xx = x0; xx < x1; xx += step) {
        const q = (yy * W + xx) * 4;
        const a = src[q + 3] / 255;
        for (let c = 0; c < 3; c++) acc[c] += (src[q + c] / 255) * a;
        acc[3] += a;
        cnt++;
      }
    }
    if (cnt > 0) for (let c = 0; c < 4; c++) acc[c] /= cnt;
    for (let c = 0; c < 3; c++) acc[c] = acc[3] > 1e-7 ? acc[c] / acc[3] : 0;
    const h = levelBased
      ? Math.max(0, Math.min(1, 0.299 * acc[0] + 0.587 * acc[1] + 0.114 * acc[2]))
      : hash01(gx, gy, 21, seed);
    return (infos[key] = { col: acc, h });
  };
  const incomplete = (gx, gy) => (gx + 1) * cs > W || (gy + 1) * cs > H;
  const shade = (o, col, k) => {
    for (let c = 0; c < 3; c++) d[o + c] = Math.round(Math.max(0, Math.min(1, col[c] * k)) * 255);
    d[o + 3] = Math.round(col[3] * 255);
  };
  const half = cs / 2;
  const interval = (p, m, o) => {
    if (Math.abs(o) < 1e-6) return Math.abs(p - m) <= half ? [0, 1] : null;
    const a = (p - m - half) / o,
      b = (p - m + half) / o;
    const lo = Math.max(Math.min(a, b), 0),
      hi = Math.min(Math.max(a, b), 1);
    return lo <= hi ? [lo, hi] : null;
  };
  const k = Math.ceil(reach / cs) + 1;
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      if (mask && !mask[p]) continue;
      const o = p * 4;
      const fx = x + 0.5,
        fy = y + 0.5;
      const gx = Math.floor(x / cs),
        gy = Math.floor(y / cs);
      if (pyramids) {
        if (maskIncomplete && incomplete(gx, gy)) continue;
        const { col, h } = info(gx, gy);
        const u = fx - (gx * cs + half),
          v = fy - (gy * cs + half);
        const hgt = ((h * depth) / 255) * cs;
        const [nx, ny] = Math.abs(u) >= Math.abs(v) ? [Math.sign(u) * hgt, 0] : [0, Math.sign(v) * hgt];
        const norm = Math.sqrt(nx * nx + ny * ny + half * half);
        const lambert = Math.max((nx * -0.5 + ny * -0.5 + half * Math.SQRT1_2) / norm, 0);
        shade(o, col, 0.35 + 0.9 * lambert);
        continue;
      }
      // The highest block whose swept square (base to front face) covers the pixel.
      let best = null;
      for (let dy = -k; dy <= k; dy++) {
        for (let dx = -k; dx <= k; dx++) {
          const cx = gx + dx,
            cy = gy + dy;
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
          if (maskIncomplete && incomplete(cx, cy)) continue;
          const h = info(cx, cy).h;
          if (best && best.h >= h) continue;
          const mx = cx * cs + half,
            my = cy * cs + half;
          const off = (reach * h) / halfDiag;
          const ox = (mx - bcx) * off,
            oy = (my - bcy) * off;
          const ix = interval(fx, mx, ox),
            iy = interval(fy, my, oy);
          if (!ix || !iy || Math.max(ix[0], iy[0]) > Math.min(ix[1], iy[1])) continue;
          const hi = Math.min(ix[1], iy[1]);
          const face = hi >= 1 ? 0 : ix[1] < iy[1] ? (ox > 0 ? 1 : 2) : oy > 0 ? 3 : 4;
          best = { h, cx, cy, face };
        }
      }
      if (!best) continue;
      const { col } = info(best.cx, best.cy);
      if (best.face === 0 && !solid) {
        const mx = best.cx * cs + half,
          my = best.cy * cs + half;
        const off = (reach * best.h) / halfDiag;
        const rx0 = best.cx * cs,
          ry0 = best.cy * cs;
        const sx = Math.max(rx0, Math.min(rx0 + cs - 1, W - 1, Math.floor(fx - (mx - bcx) * off)));
        const sy = Math.max(ry0, Math.min(ry0 + cs - 1, H - 1, Math.floor(fy - (my - bcy) * off)));
        const q = (sy * W + sx) * 4;
        for (let c = 0; c < 4; c++) d[o + c] = src[q + c];
      } else {
        shade(o, col, [1, 0.85, 0.55, 0.95, 0.45][best.face]);
      }
    }
  }
}

function hexBytes(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  const v = m ? parseInt(m[1], 16) : fallback;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}

// Tiles, following PhotoCraft stylize2.rs `tiles` with the image as the
// bounds: square tiles (count along the shorter side) each shift by a hashed
// offset of up to maxOffset % of their size; later tiles (row-major) sit on
// top. Gaps get fill 'background' / 'foreground' (opaque colours), 'inverse'
// (inverted RGB) or 'unaltered'. Reads come from a copy; a mask limits writes.
export function applyTiles(imgData, params = {}, mask = null) {
  const { width: W, height: H } = imgData;
  const d = imgData.data;
  const src = d.slice();
  const count = Math.round(clampNum(params.count, 1, 99, 10));
  const ts = Math.max(Math.min(W, H) / count, 1);
  const m = (clampNum(params.maxOffset, 1, 99, 10) / 100) * ts;
  const seed = Math.round(clampNum(params.seed, 0, 0xffffffff, 0));
  const fill = params.fill ?? 'background';
  const color =
    fill === 'foreground'
      ? hexBytes(params.foreground, 0x000000)
      : hexBytes(params.background, 0xffffff);
  const offset = (gx, gy) => [
    (hash01(gx, gy, 31, seed) * 2 - 1) * m,
    (hash01(gx, gy, 32, seed) * 2 - 1) * m
  ];
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      if (mask && !mask[p]) continue;
      const o = p * 4;
      const fx = x + 0.5,
        fy = y + 0.5;
      const gx = Math.floor(fx / ts),
        gy = Math.floor(fy / ts);
      let hit = null;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = gx + dx,
            cy = gy + dy;
          if (cx < 0 || cy < 0 || cx * ts >= W || cy * ts >= H) continue;
          const [ox, oy] = offset(cx, cy);
          const u = fx - ox - cx * ts,
            v = fy - oy - cy * ts;
          if (u < 0 || v < 0 || u >= ts || v >= ts) continue;
          if (!hit || cy > hit.cy || (cy === hit.cy && cx > hit.cx)) hit = { cx, cy, ox, oy };
        }
      }
      if (hit) {
        const sx = Math.max(0, Math.min(W - 1, Math.floor(fx - hit.ox)));
        const sy = Math.max(0, Math.min(H - 1, Math.floor(fy - hit.oy)));
        const q = (sy * W + sx) * 4;
        for (let c = 0; c < 4; c++) d[o + c] = src[q + c];
      } else if (fill === 'inverse') {
        for (let c = 0; c < 3; c++) d[o + c] = 255 - src[o + c];
      } else if (fill !== 'unaltered') {
        for (let c = 0; c < 4; c++) d[o + c] = color[c];
      }
    }
  }
}

// f32::round (half away from zero) as an integer, and clamped into 0..n.
function roundHalfAway(v) {
  return Math.sign(v) * Math.floor(Math.abs(v) + 0.5);
}
function roundIndex(v, n) {
  return Math.max(0, Math.min(n - 1, roundHalfAway(v)));
}

// Oil Paint, following PhotoCraft oil.rs `oil_paint` (RGBA) with the image as
// the window: premultiplied colour pre-smoothed by cleanliness, a structure
// tensor (sigma from scale) whose minor eigenvector is the stroke direction, a
// line integral convolution of length 1.5 + 2 * stylization along it, and
// bristle streaks from hashed noise convolved the same way. With lighting the
// smoothed luminance plus bristles is a height map lit from angle at 45 deg
// with shine as the specular. The layer's alpha is kept; a mask limits writes.
export function applyOilPaint(imgData, params = {}, mask = null) {
  const { width: W, height: H } = imgData;
  if (!W || !H) return;
  const d = imgData.data;
  const N = W * H;
  const p = new Float32Array(N * 4);
  for (let i = 0; i < p.length; i += 4) {
    const a = d[i + 3] / 255;
    for (let c = 0; c < 3; c++) p[i + c] = (d[i + c] / 255) * a;
    p[i + 3] = a;
  }
  gaussBlurN(p, W, H, 4, clampNum(params.cleanliness, 0, 10, 5) * 0.25);
  const lum = new Float32Array(N);
  for (let q = 0; q < N; q++) lum[q] = (p[q * 4] + p[q * 4 + 1] + p[q * 4 + 2]) / 3;
  const efg = new Float32Array(N * 3);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const l = (dx, dy) => lum[(y + dy) * W + x + dx];
      const gx = l(1, -1) + 2 * l(1, 0) + l(1, 1) - (l(-1, -1) + 2 * l(-1, 0) + l(-1, 1));
      const gy = l(-1, 1) + 2 * l(0, 1) + l(1, 1) - (l(-1, -1) + 2 * l(0, -1) + l(1, -1));
      const o = (y * W + x) * 3;
      efg[o] = gx * gx;
      efg[o + 1] = gx * gy;
      efg[o + 2] = gy * gy;
    }
  }
  gaussBlurN(efg, W, H, 3, 0.8 + clampNum(params.scale, 0.1, 10, 1) * 0.6);
  // Stroke direction: the minor eigenvector (along edges); flat areas stroke diagonally.
  const tan = new Float32Array(N * 2);
  for (let q = 0; q < N; q++) {
    const e = efg[q * 3],
      f = efg[q * 3 + 1],
      g = efg[q * 3 + 2];
    const l1 = 0.5 * (e + g + Math.sqrt((e - g) * (e - g) + 4 * f * f));
    const tx = l1 - e,
      ty = -f;
    const m = Math.sqrt(tx * tx + ty * ty);
    if (m < 1e-6 || l1 - (e + g - l1) < 1e-6) {
      tan[q * 2] = tan[q * 2 + 1] = Math.SQRT1_2;
    } else {
      tan[q * 2] = tx / m;
      tan[q * 2 + 1] = ty / m;
    }
  }
  const len = 1.5 + clampNum(params.stylization, 0.1, 10, 4) * 2;
  const h = Math.max(len / 10, 1);
  const steps = Math.ceil(len / h);
  const col = new Float32Array(N * 4);
  const bristle = new Float32Array(N);
  const acc = [0, 0, 0, 0];
  const sample = (sx, sy, k) => {
    const x = Math.max(0, Math.min(W - 1, sx)),
      y = Math.max(0, Math.min(H - 1, sy));
    const x0 = Math.floor(x),
      y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, W - 1),
      y1 = Math.min(y0 + 1, H - 1);
    const ax = x - x0,
      ay = y - y0;
    const w00 = (1 - ax) * (1 - ay) * k,
      w10 = ax * (1 - ay) * k,
      w01 = (1 - ax) * ay * k,
      w11 = ax * ay * k;
    const i00 = (y0 * W + x0) * 4,
      i10 = (y0 * W + x1) * 4,
      i01 = (y1 * W + x0) * 4,
      i11 = (y1 * W + x1) * 4;
    for (let c = 0; c < 4; c++) {
      acc[c] += p[i00 + c] * w00 + p[i10 + c] * w10 + p[i01 + c] * w01 + p[i11 + c] * w11;
    }
  };
  for (let y = 0, q = 0; y < H; y++) {
    for (let x = 0; x < W; x++, q++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      sample(x, y, 1);
      let wsum = 1;
      let nsum = hash01(x, y, 71, 0);
      for (const dir of [1, -1]) {
        let qx = x,
          qy = y,
          px = 0,
          py = 0;
        for (let k = 1; k <= steps; k++) {
          const ti = (roundIndex(qy, H) * W + roundIndex(qx, W)) * 2;
          let tx = tan[ti],
            ty = tan[ti + 1];
          if (k === 1) {
            tx *= dir;
            ty *= dir;
          } else if (tx * px + ty * py < 0) {
            tx = -tx;
            ty = -ty;
          }
          px = tx;
          py = ty;
          qx += tx * h;
          qy += ty * h;
          const wk = 1 - k / (steps + 1);
          sample(qx, qy, wk);
          wsum += wk;
          nsum += wk * hash01(roundHalfAway(qx), roundHalfAway(qy), 71, 0);
        }
      }
      for (let c = 0; c < 4; c++) col[q * 4 + c] = acc[c] / wsum;
      bristle[q] = nsum / wsum - 0.5;
    }
  }
  const lighting = params.lighting !== false;
  const rad = (clampNum(params.angle, -360, 360, -60) * Math.PI) / 180;
  const elev = Math.PI / 4;
  const light = [Math.cos(rad) * Math.cos(elev), -Math.sin(rad) * Math.cos(elev), Math.sin(elev)];
  const hm = Math.hypot(light[0], light[1], light[2] + 1);
  const halfV = [light[0] / hm, light[1] / hm, (light[2] + 1) / hm];
  const amp = clampNum(params.bristleDetail, 0, 10, 5) / 10;
  const shine = clampNum(params.shine, 0, 10, 1) / 10;
  const height = (x, y) => {
    const o = (y * W + x) * 4;
    return ((col[o] + col[o + 1] + col[o + 2]) / 3) * 2 + bristle[y * W + x] * amp * 6;
  };
  const flatSpec = halfV[2] ** 40;
  const px = [0, 0, 0];
  for (let y = 0, q = 0; y < H; y++) {
    for (let x = 0; x < W; x++, q++) {
      if (mask && !mask[q]) continue;
      const o = q * 4;
      const a = col[o + 3];
      for (let c = 0; c < 3; c++) px[c] = a > 1e-7 ? col[o + c] / a : 0;
      if (lighting) {
        const hx = height(Math.min(x + 1, W - 1), y) - height(Math.max(x - 1, 0), y);
        const hy = height(x, Math.min(y + 1, H - 1)) - height(x, Math.max(y - 1, 0));
        const nx = -hx * 0.5,
          ny = -hy * 0.5;
        const m = Math.sqrt(nx * nx + ny * ny + 1);
        const ndl = (nx * light[0] + ny * light[1] + light[2]) / m;
        const ndh = Math.max((nx * halfV[0] + ny * halfV[1] + halfV[2]) / m, 0);
        const shade = 1 + (ndl - light[2]) * 1.2;
        const spec = shine * Math.max(ndh ** 40 - flatSpec, 0) * 0.8;
        for (let c = 0; c < 3; c++) px[c] = px[c] * shade + spec;
      }
      for (let c = 0; c < 3; c++) d[o + c] = clamp(Math.round(px[c] * 255));
    }
  }
}

// De-Interlace, following PhotoCraft video.rs `deinterlace` with the image as
// the bounds. Lines are 1-based, so row y is an odd line when y % 2 == 0.
// eliminate 0 rebuilds the odd lines, 1 the even lines. createBy 1 averages the
// rows above and below in premultiplied alpha; otherwise (or at the top or
// bottom) the row above is copied, or the row below when there is none above.
// A one-row image is unchanged. Reads come from a copy; a mask limits writes.
export function applyDeInterlace(imgData, eliminate = 0, createBy = 1, mask = null) {
  const { width: W, height: H } = imgData;
  const even = Math.max(0, Math.min(1, Math.round(Number(eliminate) || 0))) === 1;
  const interp = Math.max(0, Math.min(1, Math.round(Number(createBy) || 0))) === 1;
  if (H < 2) return;
  const d = imgData.data;
  const src = new Uint8ClampedArray(d);
  for (let y = even ? 1 : 0; y < H; y += 2) {
    const above = y > 0 ? y - 1 : -1;
    const below = y + 1 < H ? y + 1 : -1;
    const both = interp && above >= 0 && below >= 0;
    const r0 = above >= 0 ? above : below;
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const i = p * 4;
      const j = (r0 * W + x) * 4;
      if (!both) {
        if (src[j + 3] === 0) {
          d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
          continue;
        }
        d[i] = src[j];
        d[i + 1] = src[j + 1];
        d[i + 2] = src[j + 2];
        d[i + 3] = src[j + 3];
        continue;
      }
      const k = (below * W + x) * 4;
      const a1 = src[j + 3];
      const a2 = src[k + 3];
      const t = a1 + a2;
      if (t === 0) {
        d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
        continue;
      }
      d[i] = Math.round((src[j] * a1 + src[k] * a2) / t);
      d[i + 1] = Math.round((src[j + 1] * a1 + src[k + 1] * a2) / t);
      d[i + 2] = Math.round((src[j + 2] * a1 + src[k + 2] * a2) / t);
      d[i + 3] = Math.round(t / 2);
    }
  }
}

// NTSC Colors, following PhotoCraft video.rs `ntsc` for RGB. Each pixel's YIQ
// chroma is scaled down just enough that Y +/- chroma stays inside the -20..120
// IRE composite limits (relative to 7.5..100 IRE luma); luma and hue are kept.
// Safe colours are unchanged. Alpha is untouched; a mask limits writes.
const NTSC_MAX = (120 - 7.5) / 92.5;
const NTSC_MIN = (-20 - 7.5) / 92.5;

export function applyNtscColors(imgData, mask = null) {
  const d = imgData.data;
  const n = imgData.width * imgData.height;
  for (let p = 0; p < n; p++) {
    if (mask && !mask[p]) continue;
    const i = p * 4;
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const ii = 0.595716 * r - 0.274453 * g - 0.321263 * b;
    const qq = 0.211456 * r - 0.522591 * g + 0.311135 * b;
    const chroma = Math.sqrt(ii * ii + qq * qq);
    if (chroma <= 1e-7) continue;
    let k = 1;
    if (y + chroma > NTSC_MAX) k = Math.min(k, Math.max(0, (NTSC_MAX - y) / chroma));
    if (y - chroma < NTSC_MIN) k = Math.min(k, Math.max(0, (y - NTSC_MIN) / chroma));
    if (k >= 1) continue;
    const i2 = ii * k;
    const q2 = qq * k;
    d[i] = Math.round((y + 0.9563 * i2 + 0.621 * q2) * 255);
    d[i + 1] = Math.round((y - 0.2721 * i2 - 0.6474 * q2) * 255);
    d[i + 2] = Math.round((y - 1.107 * i2 + 1.7046 * q2) * 255);
  }
}

// Average, following PhotoCraft extra_cmds.rs `average`. Every covered pixel
// becomes the mean colour of the covered pixels: R, G, B weighted by alpha, and
// alpha the plain mean. If every covered pixel is transparent nothing changes.
export function applyAverage(imgData, mask = null) {
  const d = imgData.data;
  const n = imgData.width * imgData.height;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;
  for (let p = 0; p < n; p++) {
    if (mask && !mask[p]) continue;
    const i = p * 4;
    const w = d[i + 3];
    r += d[i] * w;
    g += d[i + 1] * w;
    b += d[i + 2] * w;
    a += w;
    count++;
  }
  if (a <= 0) return;
  const avg = [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / count)];
  for (let p = 0; p < n; p++) {
    if (mask && !mask[p]) continue;
    d.set(avg, p * 4);
  }
}

// Fragment: four copies offset 4 px left, right, up and down, averaged in
// premultiplied alpha (PhotoCraft pixelate.rs `fragment`). The engine reads a
// layer edge-clamped to the canvas, so off-canvas samples repeat the edge.
export function applyFragment(imgData, mask = null) {
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  const src = new Uint8ClampedArray(d);
  const offsets = [
    [-4, 0],
    [4, 0],
    [0, -4],
    [0, 4]
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [dx, dy] of offsets) {
        const sx = Math.min(W - 1, Math.max(0, x + dx));
        const sy = Math.min(H - 1, Math.max(0, y + dy));
        const i = (sy * W + sx) * 4;
        const w = src[i + 3];
        r += src[i] * w;
        g += src[i + 1] * w;
        b += src[i + 2] * w;
        a += w;
      }
      const i = p * 4;
      if (a > 0) {
        d[i] = Math.round(r / a);
        d[i + 1] = Math.round(g / a);
        d[i + 2] = Math.round(b / a);
      } else {
        d[i] = d[i + 1] = d[i + 2] = 0;
      }
      d[i + 3] = Math.round(a / 4);
    }
  }
}

// Facet: a radius-2 Kuwahara filter (PhotoCraft pixelate.rs `facet_direct`).
// Each pixel takes the plain mean of whichever of its four overlapping 3x3
// quadrants has the lowest luma variance; ties keep the earliest quadrant.
// Off-canvas samples repeat the edge pixel.
export function applyFacet(imgData, mask = null) {
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  const src = new Uint8ClampedArray(d);
  const quadrants = [
    [-2, -2],
    [0, -2],
    [-2, 0],
    [0, 0]
  ];
  const best = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      let bestVar = Infinity;
      for (const [qx, qy] of quadrants) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let s = 0;
        let s2 = 0;
        for (let yy = y + qy; yy <= y + qy + 2; yy++) {
          const sy = Math.min(H - 1, Math.max(0, yy));
          for (let xx = x + qx; xx <= x + qx + 2; xx++) {
            const sx = Math.min(W - 1, Math.max(0, xx));
            const i = (sy * W + sx) * 4;
            r += src[i];
            g += src[i + 1];
            b += src[i + 2];
            a += src[i + 3];
            const l = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
            s += l;
            s2 += l * l;
          }
        }
        const variance = s2 / 9 - (s / 9) ** 2;
        if (variance < bestVar) {
          bestVar = variance;
          best[0] = r / 9;
          best[1] = g / 9;
          best[2] = b / 9;
          best[3] = a / 9;
        }
      }
      const i = p * 4;
      for (let c = 0; c < 4; c++) d[i + c] = Math.round(best[c]);
    }
  }
}

// Crystallize (PhotoCraft pixelate.rs `crystallize_direct`, canvas origin 0, 0).
// Grid cell (cx, cy) has a jittered feature point; each pixel belongs to the
// nearest point among the 3x3 cells around it, in f32 like PhotoCraft. A cell
// copies the source pixel under its point, or, when the point is off-canvas,
// takes the alpha-weighted average of the pixels it owns.
const F01 = Math.fround(0.1);
const F08 = Math.fround(0.8);

export function crystallizeCellPoint(cx, cy, cell, seed) {
  const jx = Math.fround(F08 * hash01(cx, cy, 11, seed));
  const jy = Math.fround(F08 * hash01(cx, cy, 12, seed));
  return [
    Math.fround(Math.fround(Math.fround(cx + F01) + jx) * cell),
    Math.fround(Math.fround(Math.fround(cy + F01) + jy) * cell)
  ];
}

export function crystallizeOwner(x, y, cell, seed) {
  const fx = x + 0.5;
  const fy = y + 0.5;
  const cx = Math.floor(Math.fround(fx / cell));
  const cy = Math.floor(Math.fround(fy / cell));
  let best = Infinity;
  let owner = [cx, cy];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const [px, py] = crystallizeCellPoint(cx + dx, cy + dy, cell, seed);
      const ex = Math.fround(px - fx);
      const ey = Math.fround(py - fy);
      const d = Math.fround(Math.fround(ex * ex) + Math.fround(ey * ey));
      if (d < best) {
        best = d;
        owner = [cx + dx, cy + dy];
      }
    }
  }
  return owner;
}

export function applyCrystallize(imgData, cellSize, seed, mask = null) {
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  const size = Math.max(3, Math.min(300, Number(cellSize) || 10));
  const cell = Math.fround(Math.max(size, 2));
  const s = Math.max(0, Math.floor(Number(seed) || 0)) >>> 0;
  const src = new Uint8ClampedArray(d);
  // Owners are at most one cell off the canvas, so offset the grid by 1.
  const gw = Math.floor(W / cell) + 3;
  const gh = Math.floor(H / cell) + 3;
  const owners = new Int32Array(W * H);
  const acc = new Float64Array(gw * gh * 5);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [cx, cy] = crystallizeOwner(x, y, cell, s);
      const k = (cy + 1) * gw + (cx + 1);
      const p = y * W + x;
      owners[p] = k;
      const i = p * 4;
      const a = src[i + 3];
      acc[k * 5] += src[i] * a;
      acc[k * 5 + 1] += src[i + 1] * a;
      acc[k * 5 + 2] += src[i + 2] * a;
      acc[k * 5 + 3] += a;
      acc[k * 5 + 4] += 1;
    }
  }
  for (let p = 0; p < W * H; p++) {
    if (mask && !mask[p]) continue;
    const k = owners[p];
    const [px, py] = crystallizeCellPoint((k % gw) - 1, Math.floor(k / gw) - 1, cell, s);
    const sx = Math.floor(px);
    const sy = Math.floor(py);
    const i = p * 4;
    if (sx >= 0 && sy >= 0 && sx < W && sy < H) {
      const j = (sy * W + sx) * 4;
      for (let c = 0; c < 4; c++) d[i + c] = src[j + c];
      continue;
    }
    const cnt = acc[k * 5 + 4];
    if (cnt <= 0) continue;
    const sumA = acc[k * 5 + 3];
    for (let c = 0; c < 3; c++) d[i + c] = sumA > 0 ? Math.round(acc[k * 5 + c] / sumA) : 0;
    d[i + 3] = Math.round(sumA / cnt);
  }
}

// Pointillize (PhotoCraft pixelate.rs `pointillize_direct`, canvas origin 0, 0).
// Each grid cell has a dot at its crystallize point with a hashed radius; the
// pixel takes the dot it is deepest inside (depth = radius - distance, in f32),
// anti-aliased over the background. Returns [depth, gx, gy, px, py] or null.
const F045 = Math.fround(0.45);
const F035 = Math.fround(0.35);

export function pointillizeDot(x, y, cell, seed) {
  const fx = x + 0.5;
  const fy = y + 0.5;
  const cx = Math.floor(Math.fround(fx / cell));
  const cy = Math.floor(Math.fround(fy / cell));
  let best = null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const [px, py] = crystallizeCellPoint(gx, gy, cell, seed);
      const rad = Math.fround(
        cell * Math.fround(F045 + Math.fround(F035 * hash01(gx, gy, 13, seed)))
      );
      const ex = Math.fround(px - fx);
      const ey = Math.fround(py - fy);
      const d = Math.fround(Math.sqrt(Math.fround(Math.fround(ex * ex) + Math.fround(ey * ey))));
      const depth = Math.fround(rad - d);
      if (depth > -0.5 && (!best || depth > best[0])) best = [depth, gx, gy, px, py];
    }
  }
  return best;
}

export function applyPointillize(
  imgData,
  cellSize,
  seed,
  background = [255, 255, 255, 255],
  mask = null
) {
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  const size = Math.max(3, Math.min(300, Number(cellSize) || 5));
  const cell = Math.fround(Math.max(size, 2));
  const s = Math.max(0, Math.floor(Number(seed) || 0)) >>> 0;
  const bg = background || [255, 255, 255, 255];
  const src = new Uint8ClampedArray(d);
  const canvas = [0, 0, 0, 0];
  const dot = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const i = p * 4;
      canvas[0] = bg[0];
      canvas[1] = bg[1];
      canvas[2] = bg[2];
      canvas[3] = Math.max(src[i + 3], bg[3]);
      const best = pointillizeDot(x, y, cell, s);
      if (best) {
        const [depth, gx, gy, px, py] = best;
        const sx = Math.max(0, Math.min(W - 1, Math.floor(px)));
        const sy = Math.max(0, Math.min(H - 1, Math.floor(py)));
        const j = (sy * W + sx) * 4;
        const jit = (hash01(gx, gy, 17, s) - 0.5) * 0.08 * 255;
        for (let c = 0; c < 3; c++) dot[c] = Math.max(0, Math.min(255, src[j + c] + jit));
        dot[3] = src[j + 3];
        const k = Math.max(0, Math.min(1, depth + 0.5));
        for (let c = 0; c < 4; c++) canvas[c] += (dot[c] - canvas[c]) * k;
      }
      for (let c = 0; c < 4; c++) d[i + c] = Math.round(canvas[c]);
    }
  }
}

// Mezzotint (PhotoCraft pixelate.rs `mezzotint` / `mezzo_threshold`). Types:
// 0 Fine Dots, 1 Medium Dots, 2 Grainy Dots, 3 Coarse Dots, 4 Short Lines,
// 5 Medium Lines, 6 Long Lines, 7 Short Strokes, 8 Medium Strokes, 9 Long Strokes.
// Thresholds are f32 like PhotoCraft's, so the grainy mix goes through Math.fround.
export function mezzotintThreshold(type, x, y, k, seed) {
  const lines = (len) => {
    const phase = Math.trunc(Math.fround(hash01(0, y, k + 40, seed) * len));
    return hash01(Math.floor((x + phase) / len), y, k, seed);
  };
  const strokes = (len) => {
    const d = x - y;
    const phase = Math.trunc(Math.fround(hash01(d, 0, k + 50, seed) * len));
    return hash01(Math.floor((x + y + phase) / len), d, k + 60, seed);
  };
  switch (type) {
    case 1:
      return hash01(Math.floor(x / 2), Math.floor(y / 2), k, seed);
    case 2:
      return Math.fround(
        Math.fround(0.5 * hash01(x, y, k, seed)) +
          Math.fround(0.5 * hash01(Math.floor(x / 3), Math.floor(y / 3), k + 7, seed))
      );
    case 3:
      return hash01(Math.floor(x / 3), Math.floor(y / 3), k, seed);
    case 4:
      return lines(6);
    case 5:
      return lines(14);
    case 6:
      return lines(32);
    case 7:
      return strokes(5);
    case 8:
      return strokes(10);
    case 9:
      return strokes(20);
    default:
      return hash01(x, y, k, seed);
  }
}

// Each R, G, B channel becomes 255 when value / 255 beats its threshold, else 0.
// Alpha is untouched.
export function applyMezzotint(imgData, type, seed, mask = null) {
  const t = Math.max(0, Math.min(9, Math.round(Number(type) || 0)));
  const s = Math.max(0, Math.min(9999, Math.round(Number(seed) || 0)));
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const i = p * 4;
      for (let k = 0; k < 3; k++) {
        d[i + k] = Math.fround(d[i + k] / 255) > mezzotintThreshold(t, x, y, k, s) ? 255 : 0;
      }
    }
  }
}

// Color Halftone (PhotoCraft pixelate.rs `color_halftone`, RGB, origin 0, 0).
// Each channel is screened at its own angle into dots whose area follows the
// channel's ink (1 - value). f32 via Math.fround so dot edges match PhotoCraft.
export function applyColorHalftone(imgData, maxRadius, angle1, angle2, angle3, mask = null) {
  const F = Math.fround;
  const clampNum = (v, lo, hi, def) => {
    const n = Number(v);
    return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : def));
  };
  const rmax = F(Math.max(F(clampNum(maxRadius, 4, 127, 8)), 1));
  const cell = F(rmax * F(Math.SQRT2));
  const touch = F(Math.PI / 4);
  const pi = F(Math.PI);
  const rads = F(Math.PI / 180);
  const rot = [
    clampNum(angle1, -360, 360, 108),
    clampNum(angle2, -360, 360, 162),
    clampNum(angle3, -360, 360, 90)
  ].map((deg) => {
    const r = F(F(deg) * rads);
    return [F(Math.sin(r)), F(Math.cos(r))];
  });
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  const src = new Uint8ClampedArray(d);
  const q = F(cell * 0.25);
  const taps = [
    [0, 0],
    [-q, -q],
    [q, -q],
    [-q, q],
    [q, q]
  ];
  // Channel value at a point averaged over five taps clamped to the canvas.
  const value = (x, y, c) => {
    let acc = 0;
    for (const [dx, dy] of taps) {
      const ix = Math.max(0, Math.min(W - 1, Math.floor(F(x + dx))));
      const iy = Math.max(0, Math.min(H - 1, Math.floor(F(y + dy))));
      acc = F(acc + F(src[(iy * W + ix) * 4 + c] / 255));
    }
    return F(acc / 5);
  };
  const radiusFor = (ink) =>
    ink <= touch
      ? F(cell * F(Math.sqrt(F(ink / pi))))
      : F(cell * F(0.5 + F(F(F(ink - touch) / F(1 - touch)) * F(Math.SQRT1_2 - 0.5))));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const fx = F(x + 0.5);
      const fy = F(y + 0.5);
      for (let c = 0; c < 3; c++) {
        const [s, co] = rot[c];
        // Rotate into screen space.
        const u = F(F(fx * co) + F(fy * s));
        const v = F(F(-fx * s) + F(fy * co));
        const cu = Math.floor(F(u / cell));
        const cv = Math.floor(F(v / cell));
        let cov = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const mu = F(F(cu + di + 0.5) * cell);
            const mv = F(F(cv + dj + 0.5) * cell);
            const du = F(u - mu);
            const dv = F(v - mv);
            const dist = F(Math.sqrt(F(F(du * du) + F(dv * dv))));
            if (dist >= F(rmax + 0.5)) continue;
            // Back to document space to read the cell's value.
            const sx = F(F(mu * co) - F(mv * s));
            const sy = F(F(mu * s) + F(mv * co));
            const raw = Math.max(0, Math.min(1, value(sx, sy, c)));
            const r = radiusFor(F(1 - raw));
            // Tiny dots cannot cover more than their own area.
            const edge = Math.max(0, Math.min(1, F(F(r - dist) + 0.5)));
            cov = Math.max(cov, Math.min(edge, F(F(pi * r) * r)));
          }
        }
        d[p * 4 + c] = Math.round(F(1 - cov) * 255);
      }
    }
  }
}

// Clouds hash (PhotoCraft render.rs `cloud_hash`): u32 wrapping mix to 0..1 in f32.
export function cloudHash(x, y, seed) {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(seed, 0xcb1ab31f)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return Math.fround((h & 0xffffff) / 0xffffff);
}

// Eight octaves of smoothstep value noise (fBm) at integer pixel (x, y),
// stretched to 0..1 like PhotoCraft's `clouds_value`. All f32.
export function cloudsValue(x, y, base, seed) {
  const F = Math.fround;
  let sum = 0;
  let amp = 1;
  let freq = F(1 / base);
  let norm = 0;
  for (let o = 0; o < 8; o++) {
    const fx = F(x * freq);
    const fy = F(y * freq);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = F(fx - ix);
    const ty = F(fy - iy);
    const sx = F(F(tx * tx) * F(3 - F(2 * tx)));
    const sy = F(F(ty * ty) * F(3 - F(2 * ty)));
    const s = (seed + o * 7919) >>> 0;
    const h00 = cloudHash(ix, iy, s);
    const h01 = cloudHash(ix, iy + 1, s);
    const top = F(h00 + F(F(cloudHash(ix + 1, iy, s) - h00) * sx));
    const bot = F(h01 + F(F(cloudHash(ix + 1, iy + 1, s) - h01) * sx));
    sum = F(sum + F(F(top + F(F(bot - top) * sy)) * amp));
    norm = F(norm + amp);
    amp = F(amp * 0.5);
    freq = F(freq * 2);
  }
  const v = F(F(F(F(F(sum / norm) - 0.5) * F(2.2)) + 0.5));
  return Math.max(0, Math.min(1, v));
}

// Clouds / Difference Clouds (PhotoCraft render.rs `clouds`) from black to
// white, anchored at 0, 0. Clouds replaces RGB and sets alpha 255; Difference
// Clouds writes |value - cloud| per channel and keeps alpha.
export function applyClouds(imgData, seed, difference = false, mask = null) {
  const F = Math.fround;
  const s = Math.max(0, Math.min(9999, Math.round(Number(seed) || 0)));
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  const base = Math.max(16, Math.min(512, F(Math.max(W, H) / 4)));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const t = cloudsValue(x, y, base, s);
      const i = p * 4;
      if (difference) {
        for (let k = 0; k < 3; k++)
          d[i + k] = Math.round(F(Math.abs(F(F(d[i + k] / 255) - t)) * 255));
      } else {
        const v = Math.round(F(t * 255));
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
  }
}

// Smoothstep value noise in [0, 1) over hash01(ix, iy, 0, seed) lattice
// points (PhotoCraft render.rs `value_noise`). All f32.
export function valueNoise(x, y, seed) {
  const F = Math.fround;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = F(x - ix);
  const ty = F(y - iy);
  const sx = F(F(tx * tx) * F(3 - F(2 * tx)));
  const sy = F(F(ty * ty) * F(3 - F(2 * ty)));
  const h00 = hash01(ix, iy, 0, seed);
  const h01 = hash01(ix, iy + 1, 0, seed);
  const top = F(h00 + F(F(hash01(ix + 1, iy, 0, seed) - h00) * sx));
  const bot = F(h01 + F(F(hash01(ix + 1, iy + 1, 0, seed) - h01) * sx));
  return F(top + F(F(bot - top) * sy));
}

// Fibers (PhotoCraft render.rs `fibers`) from black to white, anchored at 0, 0.
// Variance raises the horizontal frequency; strength stretches fibres
// vertically. The source pixels are ignored; alpha becomes 255.
export function applyFibers(imgData, variance, strength, seed, mask = null) {
  const F = Math.fround;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const v = F(Math.max(1, Math.min(64, num(variance, 16))));
  const st = F(Math.max(1, Math.min(64, num(strength, 4))));
  const s = Math.max(0, Math.min(9999, Math.round(Number(seed) || 0)));
  const fx = F(F(0.08) + F(F(v / 64) * F(0.6)));
  const fy = F(F(fx / F(2 + F(st * 1.5))) * F(0.5 + F(v / 32)));
  const stretch = F(F(1.6) + F(v / 40));
  const gx = F(0.9);
  const gs = (s ^ 0x5bd1) >>> 0;
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  for (let y = 0; y < H; y++) {
    const gy = F(F(y * fy) * 0.25);
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      let sum = 0;
      let amp = 1;
      let norm = 0;
      let ax = fx;
      let ay = fy;
      for (let o = 0; o < 4; o++) {
        sum = F(sum + F(valueNoise(F(x * ax), F(y * ay), (s + o * 977) >>> 0) * amp));
        norm = F(norm + amp);
        amp = F(amp * F(0.55));
        ax = F(ax * 2);
        ay = F(ay * 2);
      }
      const grain = F(valueNoise(F(x * gx), gy, gs) - 0.5);
      const raw = F(F(F(F(F(sum / norm) - 0.5) * stretch) + 0.5) + F(grain * 0.25));
      const out = Math.round(F(Math.max(0, Math.min(1, raw)) * 255));
      const i = p * 4;
      d[i] = out;
      d[i + 1] = out;
      d[i + 2] = out;
      d[i + 3] = 255;
    }
  }
}

// PhotoCraft fxutil.rs `smoothstep`, in f32. A reversed edge pair (e1 <= e0)
// is a hard step at e1, as in the engine.
export function smoothstep(e0, e1, x) {
  const F = Math.fround;
  if (e1 <= e0) return x >= e1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, F(F(x - e0) / F(e1 - e0))));
  return F(F(t * t) * F(3 - F(2 * t)));
}

// Per-lens (core, glow, ringR, ringW, rays, streak) and ghost tables from
// PhotoCraft render.rs `lens_flare`. Index 0 Zoom, 1 35mm Prime, 2 105mm Prime,
// 3 Movie Prime.
const LENS_FLARE_LENSES = [
  {
    core: 14,
    glow: 90,
    ringR: 0,
    ringW: 0,
    rays: 0.5,
    streak: 0,
    ghosts: [
      [0.35, 10, [0.6, 0.8, 1.0], 0.18],
      [0.6, 26, [0.5, 1.0, 0.6], 0.1],
      [0.85, 6, [1.0, 0.7, 0.4], 0.25],
      [1.25, 40, [0.7, 0.5, 1.0], 0.08],
      [1.5, 16, [1.0, 0.6, 0.5], 0.15],
      [1.9, 70, [0.5, 0.7, 1.0], 0.06]
    ]
  },
  {
    core: 12,
    glow: 70,
    ringR: 90,
    ringW: 6,
    rays: 0.3,
    streak: 0,
    ghosts: [
      [0.7, 18, [0.6, 1.0, 0.7], 0.12],
      [1.4, 30, [1.0, 0.7, 0.5], 0.09]
    ]
  },
  {
    core: 22,
    glow: 130,
    ringR: 0,
    ringW: 0,
    rays: 0.8,
    streak: 0,
    ghosts: [
      [0.5, 14, [1.0, 0.8, 0.5], 0.12],
      [1.6, 50, [0.6, 0.7, 1.0], 0.07]
    ]
  },
  {
    core: 10,
    glow: 60,
    ringR: 0,
    ringW: 0,
    rays: 0.2,
    streak: 1,
    ghosts: [
      [0.4, 8, [0.5, 0.7, 1.0], 0.2],
      [1.0, 20, [0.4, 0.6, 1.0], 0.12],
      [1.6, 12, [0.5, 0.8, 1.0], 0.16]
    ]
  }
];

// Lens Flare (PhotoCraft render.rs `lens_flare`) with the canvas as bounds at
// 0, 0: a screen-blended core + glow, rays, anamorphic streak, halo ring and
// ghost discs along the line through the image centre. centerX / centerY are
// percents of width / height. Alpha is kept; the mask limits writes.
export function applyLensFlare(imgData, brightness, centerX, centerY, lens, mask = null) {
  const F = Math.fround;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const bright = F(F(clamp(num(brightness, 100), 10, 300)) / 100);
  const ux = F(F(clamp(num(centerX, 50), -50, 150)) / 100);
  const uy = F(F(clamp(num(centerY, 50), -50, 150)) / 100);
  const L = LENS_FLARE_LENSES[clamp(Math.round(num(lens, 0)), 0, 3)];
  const sq = (v) => F(v * v);
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  const s = F(F(Math.max(F(Math.hypot(W, H)), 1)) / 1000);
  const cx = F(ux * W);
  const cy = F(uy * H);
  const mx = F(W / 2);
  const my = F(H / 2);
  const coreS = F(L.core * s);
  const glowS = F(L.glow * s);
  const raysS = F(F(L.glow * F(1.6)) * s);
  const ghosts = L.ghosts.map(([t, r, tint, k]) => ({
    gx: F(cx + F(F(F(mx - cx) * F(t)) * 2)),
    gy: F(cy + F(F(F(my - cy) * F(t)) * 2)),
    rs: F(r * s),
    tint: tint.map(F),
    k: F(k)
  }));
  const glowW = [1, 0.95, 0.85].map(F);
  const ringOff = [1.04, 1, 0.96].map(F);
  const f = new Float64Array(3);
  for (let y = 0; y < H; y++) {
    const fy = F(y + 0.5);
    const dy = F(fy - cy);
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const fx = F(x + 0.5);
      const dx = F(fx - cx);
      const dist = F(Math.sqrt(F(sq(dx) + sq(dy))));
      const g = F(F(Math.exp(-sq(F(dist / coreS)))) + F(F(0.35) * F(Math.exp(F(-dist / glowS)))));
      for (let k = 0; k < 3; k++) f[k] = F(g * glowW[k]);
      if (L.rays > 0) {
        const th = F(Math.atan2(dy, dx));
        const a = F(F(F(Math.sin(F(th * 12))) * 0.5) + 0.5);
        const b = F(F(F(Math.sin(F(F(th * 7) + F(1.3)))) * 0.5) + 0.5);
        const a8 = sq(sq(sq(a)));
        const b4 = sq(sq(b));
        const b12 = F(sq(b4) * b4);
        const m = F(a8 + F(b12 * F(0.6)));
        const rr = F(F(F(L.rays) * m) * F(Math.exp(F(-dist / raysS))));
        const add = F(rr * F(0.6));
        for (let k = 0; k < 3; k++) f[k] = F(f[k] + add);
      }
      if (L.streak > 0) {
        const st = F(
          F(Math.exp(-F(Math.abs(dy) / F(F(2.5) * s)))) * F(Math.exp(-F(Math.abs(dx) / F(450 * s))))
        );
        f[0] = F(f[0] + F(st * 0.5));
        f[1] = F(f[1] + F(st * F(0.7)));
        f[2] = F(f[2] + st);
      }
      if (L.ringR > 0) {
        for (let k = 0; k < 3; k++) {
          const rd = F(F(dist - F(F(L.ringR * s) * ringOff[k])) / F(L.ringW * s));
          f[k] = F(f[k] + F(F(0.18) * F(Math.exp(F(-rd * rd)))));
        }
      }
      for (const gh of ghosts) {
        const gd = F(F(Math.sqrt(F(sq(F(fx - gh.gx)) + sq(F(fy - gh.gy))))) / gh.rs);
        if (gd < 1.2) {
          const e = F(smoothstep(1, F(0.85), gd) * F(F(0.6) + F(F(0.4) * gd)));
          for (let k = 0; k < 3; k++) f[k] = F(f[k] + F(F(e * gh.k) * gh.tint[k]));
        }
      }
      const i = p * 4;
      for (let k = 0; k < 3; k++) {
        const c = F(d[i + k] / 255);
        const a = Math.min(Math.max(F(f[k] * bright), 0), 1);
        d[i + k] = Math.round(F(F(c + F(a * Math.max(F(1 - c), 0))) * 255));
      }
    }
  }
}

// Lighting Effects (PhotoCraft render.rs `lighting`) with one white light and
// the canvas as bounds at 0, 0: Blinn-Phong shading of the image as a surface,
// optionally bumped by a texture channel. lightType 0 Spot, 1 Point,
// 2 Infinite; texture 0 None, 1 Red, 2 Green, 3 Blue, 4 Alpha, 5 Luminance.
// lightX / lightY are percents of width / height and lightZ a percent of the
// short side. Alpha is kept; the mask limits writes.
export function applyLightingEffects(imgData, params = {}, mask = null) {
  const F = Math.fround;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const p = (key, fallback, lo, hi) => F(clamp(num(params[key], fallback), lo, hi));
  const kind = clamp(Math.round(num(params.lightType, 0)), 0, 2);
  const texture = clamp(Math.round(num(params.texture, 0)), 0, 5);
  const lx = F(p('lightX', 25, -50, 150) / 100);
  const ly = F(p('lightY', 20, -50, 150) / 100);
  const lz = F(p('lightZ', 60, 0, 1000) / 100);
  const angle = p('angle', 135, -360, 360);
  const elevation = p('elevation', 45, 0, 90);
  const intensity = p('intensity', 75, -100, 100);
  const cone = p('cone', 45, 1, 89);
  const hotspot = p('hotspot', 50, 0, 100);
  const gloss = p('gloss', 0, -100, 100);
  const metallic = p('metallic', 0, -100, 100);
  const exposure = p('exposure', 0, -100, 100);
  const ambience = p('ambience', 8, -100, 100);
  const height = p('height', 50, 0, 100);
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  if (!W || !H) return;
  const src = new Uint8ClampedArray(d);
  const bw = F(W);
  const bh = F(H);
  const short = F(Math.max(Math.min(bw, bh), 1));
  const hscale = F(F(F(height / 100) * F(0.06)) * short);
  const gl = F(F(gloss + 100) / 200);
  const shininess = F(Math.pow(2, F(1 + F(gl * 7))));
  const specK = F(gl * F(0.7));
  const metal = F(F(metallic + 100) / 200);
  const expo = F(Math.pow(2, F(exposure / 50)));
  const ambient = F(F(ambience / 100) * 0.5);
  const norm3 = (x, y, z) => {
    const m = Math.max(F(Math.sqrt(F(F(F(x * x) + F(y * y)) + F(z * z)))), 1e-9);
    return [F(x / m), F(y / m), F(z / m)];
  };
  const dot3 = (a, b) => F(F(F(a[0] * b[0]) + F(a[1] * b[1])) + F(a[2] * b[2]));
  const toRad = F(Math.PI / 180);
  const tex = (x, y) => {
    const i = (clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4;
    if (texture === 4) return F(src[i + 3] / 255);
    if (texture === 5) {
      const r = F(src[i] / 255);
      const g = F(src[i + 1] / 255);
      const b = F(src[i + 2] / 255);
      return F(F(F(F(0.299) * r) + F(F(0.587) * g)) + F(F(0.114) * b));
    }
    return F(src[i + texture - 1] / 255);
  };
  const lpos = [F(lx * bw), F(ly * bh), F(lz * short)];
  let infDir = null;
  if (kind === 2) {
    const a = F(angle * toRad);
    const s = F(Math.sin(a));
    const co = F(Math.cos(a));
    const e = F(elevation * toRad);
    const ec = F(Math.cos(e));
    infDir = norm3(F(co * ec), F(-s * ec), F(Math.sin(e)));
  }
  const reach = Math.max(F(F(0.8) * short), 1);
  const tgt = [F(F(0.5) * bw), F(F(0.55) * bh), 0];
  const axis = norm3(F(tgt[0] - lpos[0]), F(tgt[1] - lpos[1]), F(tgt[2] - lpos[2]));
  const outer = F(Math.cos(F(cone * toRad)));
  const inner = F(Math.cos(F(F(cone * F(hotspot / 100)) * toRad)));
  const innerE = Math.max(inner, F(outer + F(1e-4)));
  const bump = texture !== 0 && hscale > 0;
  const base = new Float64Array(3);
  for (let y = 0; y < H; y++) {
    const fy = F(y + 0.5);
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      if (mask && !mask[pi]) continue;
      const fx = F(x + 0.5);
      let nrm = [0, 0, 1];
      if (bump) {
        const hx = F(F(F(tex(x + 1, y) - tex(x - 1, y)) * 0.5) * hscale);
        const hy = F(F(F(tex(x, y + 1) - tex(x, y - 1)) * 0.5) * hscale);
        nrm = norm3(-hx, -hy, 1);
      }
      const i = pi * 4;
      for (let k = 0; k < 3; k++) base[k] = F(src[i + k] / 255);
      let ldir;
      let atten = 1;
      if (kind === 2) {
        ldir = infDir;
      } else {
        const vx = F(lpos[0] - fx);
        const vy = F(lpos[1] - fy);
        ldir = norm3(vx, vy, lpos[2]);
        if (kind === 1) {
          const dist = F(Math.sqrt(F(F(vx * vx) + F(vy * vy))));
          const t = clamp(F(1 - F(dist / reach)), 0, 1);
          atten = F(t * t);
        } else {
          atten = smoothstep(outer, innerE, F(-dot3(ldir, axis)));
        }
      }
      let lit = ambient;
      let s = 0;
      let inten = 0;
      if (atten > 0) {
        inten = F(F(intensity / 50) * atten);
        const ndl = Math.max(dot3(nrm, ldir), 0);
        const hv = norm3(ldir[0], ldir[1], F(ldir[2] + 1));
        s = F(F(Math.pow(Math.max(dot3(nrm, hv), 0), shininess)) * specK);
        lit = F(ambient + F(ndl * inten));
      }
      for (let k = 0; k < 3; k++) {
        let spc = 0;
        if (atten > 0) {
          const sc = F(F(1 - metal) + F(base[k] * metal));
          spc = F(F(s * Math.max(inten, 0)) * sc);
        }
        const c = Math.max(F(F(F(base[k] * lit) + spc) * expo), 0);
        d[i + k] = Math.round(Math.min(c, 1) * 255);
      }
    }
  }
}

// Relight sigma (PhotoCraft relight.rs `sigma`) for a W x H canvas.
export function relightSigma(softness, W, H) {
  const F = Math.fround;
  const soft = F(Math.max(1, Math.min(100, softness)));
  const side = F(Math.max(Math.min(W, H), 1));
  return Math.max(2, Math.min(96, F(F(F(soft / 100) * F(0.08)) * side)));
}

// Relight finite-difference step in pixels (relight.rs `step_for_sigma`).
export function relightStep(sigma) {
  return Math.max(1, Math.min(32, Math.round(sigma)));
}

// Relight (PhotoCraft relight.rs `relight` / `relight_rect`) with the canvas as
// bounds at 0, 0: a blurred Rec.709 luma field stands in for the shading, its
// slope gives a surface normal, and each pixel's colour is divided by the old
// shading and multiplied by a Lambertian lamp from angle / elevation tinted by
// warmth. The field covers the canvas plus the read radius with edge-clamped
// reads; alpha-0 pixels are held out through a weight channel and skipped on
// output. Alpha is kept; the mask limits writes. f32 via Math.fround.
export function applyRelight(imgData, params = {}, mask = null) {
  const F = Math.fround;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const p = (key, fallback, lo, hi) => F(clamp(num(params[key], fallback), lo, hi));
  const angle = p('angle', 45, -180, 180);
  const elevation = p('elevation', 40, 0, 90);
  const intensity = p('intensity', 40, 0, 100);
  const ambient = p('ambient', 55, 0, 100);
  const warmth = p('warmth', 0, -100, 100);
  const softness = p('softness', 25, 1, 100);
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  if (!W || !H || intensity === 0) return;
  const sig = relightSigma(softness, W, H);
  const step = relightStep(sig);
  const reach = Math.ceil(F(sig * 3)) + 1 + step;
  const yw = W + 2 * reach;
  const yh = H + 2 * reach;
  // Packed (luma, weight) field over the inflated rect.
  const field = new Float32Array(yw * yh * 2);
  for (let y = 0; y < yh; y++) {
    const sy = clamp(y - reach, 0, H - 1);
    for (let x = 0; x < yw; x++) {
      const i = (sy * W + clamp(x - reach, 0, W - 1)) * 4;
      if (d[i + 3] === 0) continue;
      const r = F(d[i] / 255);
      const g = F(d[i + 1] / 255);
      const b = F(d[i + 2] / 255);
      const o = (y * yw + x) * 2;
      field[o] = F(F(F(F(0.2126) * r) + F(F(0.7152) * g)) + F(F(0.0722) * b));
      field[o + 1] = 1;
    }
  }
  gaussBlurN(field, yw, yh, 2, sig);
  const shading = new Float32Array(yw * yh);
  for (let i = 0; i < shading.length; i++) {
    const wgt = field[i * 2 + 1];
    shading[i] = wgt > 1e-6 ? F(field[i * 2] / wgt) : 0.5;
  }
  const sample = (x, y) => shading[clamp(y + reach, 0, yh - 1) * yw + clamp(x + reach, 0, yw - 1)];
  const norm3 = (x, y, z) => {
    const m = F(Math.sqrt(F(F(F(x * x) + F(y * y)) + F(z * z))));
    if (!Number.isFinite(m) || m < 1e-9) return [0, 0, 1];
    return [F(x / m), F(y / m), F(z / m)];
  };
  const toRad = F(Math.PI / 180);
  const a = F(angle * toRad);
  const e = F(elevation * toRad);
  const ec = F(Math.cos(e));
  const ldir = norm3(F(F(Math.cos(a)) * ec), F(F(-Math.sin(a)) * ec), F(Math.sin(e)));
  const w = F(warmth / 100);
  const t = -w;
  const lcol =
    w >= 0
      ? [F(1 + F(F(0.15) * w)), F(1 - F(F(0.05) * w)), F(1 - F(F(0.25) * w))]
      : [F(1 - F(F(0.2) * t)), F(1 - F(F(0.1) * t)), F(1 + F(F(0.15) * t))];
  const amb = F(ambient / 100);
  const inten = F(intensity / 100);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      if (mask && !mask[pi]) continue;
      const i = pi * 4;
      if (d[i + 3] === 0) continue;
      const s0 = Math.max(sample(x, y), F(0.04));
      const nx = F(F(sample(x - step, y) - sample(x + step, y)) * 2);
      const ny = F(F(sample(x, y - step) - sample(x, y + step)) * 2);
      const n = norm3(nx, ny, 1);
      const ndl = Math.max(F(F(F(n[0] * ldir[0]) + F(n[1] * ldir[1])) + F(n[2] * ldir[2])), 0);
      const shade = F(amb + F(inten * ndl));
      for (let k = 0; k < 3; k++) {
        const c = F(F(F(F(d[i + k] / 255) / s0) * shade) * lcol[k]);
        d[i + k] = Math.round(F(clamp(c, 0, 1) * 255));
      }
    }
  }
}

// Exponent of the shadow toe in levelsGamma (PhotoCraft LEVELS_TOE_POWER, fitted on Photoshop).
const LEVELS_TOE_POWER = 2.2;

// PhotoCraft levels_gamma (crates/compose/src/adjust.rs): Levels' midtone gamma g on u in 0..1 is
// u^(1/g), except above 1, where that curve is infinitely steep at black, Photoshop starts along a
// toe a·u − b·u^2.2 of slope a = 2^g that joins the power curve with the same value and slope.
export function levelsGamma(u, g) {
  const c = 1 / g;
  if (g <= 1) return Math.pow(u, c);
  const a = Math.pow(2, g);
  const q = LEVELS_TOE_POWER;
  // Where the toe meets the curve: a·u1 − b·u1^q = u1^c and a − q·b·u1^(q−1) = c·u1^(c−1).
  const u1 = Math.pow((1 - c / q) / (a * (1 - 1 / q)), 1 / (1 - c));
  if (u >= u1 || u1 <= 0) return Math.pow(u, c);
  const b = (a * u1 - Math.pow(u1, c)) / Math.pow(u1, q);
  // Just above gamma 1 the toe shrinks to nothing and b overflows; the power curve is its limit.
  if (!Number.isFinite(b)) return Math.pow(u, c);
  return a * u - b * Math.pow(u, q);
}

// Levels: PhotoCraft levels_q with quantum 255. Photoshop works on whole 8-bit levels in three
// steps, each rounded half up: the input black..white stretch, the midtone gamma (levelsGamma),
// and the output black..white range. Returns the 256-entry table; missing outBlack / outWhite
// are 0 / 255.
export function levelsTable(black, gamma, white, outBlack = 0, outWhite = 255) {
  const lo = Math.max(0, Math.min(254, Math.round(Number(black) || 0)));
  const hi = Math.max(lo + 1, Math.min(255, Math.round(Number(white ?? 255))));
  const g = Math.max(0.01, Math.min(9.99, Number(gamma) || 1));
  const ob = Math.max(0, Math.min(255, Number(outBlack ?? 0) || 0));
  const ow = Math.max(0, Math.min(255, Number.isFinite(Number(outWhite)) ? Number(outWhite) : 255));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const u = Math.floor(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 255 + 0.5 + 1e-3) / 255;
    const t = Math.floor(levelsGamma(u, g) * 255 + 0.5) / 255;
    lut[v] = Math.floor(ob + t * (ow - ob) + 0.5);
  }
  return lut;
}

// Maps R, G, B through their own tables. Alpha, fully transparent pixels, and pixels outside the
// mask are untouched.
function applyChannelTables(imgData, lutR, lutG, lutB, mask) {
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if ((mask && !mask[p]) || d[i + 3] === 0) continue;
    d[i] = lutR[d[i]];
    d[i + 1] = lutG[d[i + 1]];
    d[i + 2] = lutB[d[i + 2]];
  }
}

// Levels with one set of levels on all three channels (levelsTable).
export function applyLevels(
  imgData,
  black,
  gamma,
  white,
  mask = null,
  outBlack = 0,
  outWhite = 255
) {
  const lut = levelsTable(black, gamma, white, outBlack, outWhite);
  applyChannelTables(imgData, lut, lut, lut, mask);
}

// Per-channel Levels params: the RGB master is black / gamma / white / outBlack / outWhite; each
// of red, green, blue has <ch>Black, <ch>Gamma, <ch>White, <ch>OutBlack, <ch>OutWhite.
export const LEVELS_CHANNELS = ['red', 'green', 'blue'];

function levelsParamsTable(params, prefix) {
  const k = (name) => (prefix ? prefix + name : name[0].toLowerCase() + name.slice(1));
  return levelsTable(
    params[k('Black')] ?? 0,
    params[k('Gamma')] ?? 1,
    params[k('White')] ?? 255,
    params[k('OutBlack')] ?? 0,
    params[k('OutWhite')] ?? 255
  );
}

// PhotoCraft tone_luts_q for Levels: each channel's table is master(channel(v)), the channel's
// levels_q first, then the RGB master's. Params without per-channel keys are identity channels.
export function applyLevelsChannels(imgData, params = {}, mask = null) {
  const master = levelsParamsTable(params, '');
  const [r, g, b] = LEVELS_CHANNELS.map((ch) => {
    const lut = levelsParamsTable(params, ch);
    return lut.map((v) => master[v]);
  });
  applyChannelTables(imgData, r, g, b, mask);
}

// PhotoCraft edit_cmds.rs histograms: 256-bin R, G, B counts of pixels with alpha above 0, inside
// the mask when there is one. The fourth is tone.rs count_pixels' RGB composite: one count per
// pixel at floor((R + G + B) / 3).
export function levelsHistograms(imgData, mask = null) {
  const h = [0, 1, 2, 3].map(() => new Array(256).fill(0));
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if ((mask && !mask[p]) || d[i + 3] === 0) continue;
    h[0][d[i]]++;
    h[1][d[i + 1]]++;
    h[2][d[i + 2]]++;
    h[3][Math.floor((d[i] + d[i + 1] + d[i + 2]) / 3)]++;
  }
  return h;
}

// PhotoCraft clip_points: black and white levels with `clip` (a fraction) clipped at each end.
// Returns [lo, hi] in whole levels; an empty histogram gives [0, 255].
export function autoClipPoints(h, clip = 0.001) {
  const total = h.reduce((a, v) => a + v, 0);
  if (total === 0) return [0, 255];
  return clipWalk(h, Math.floor(total * clip), 254, 1);
}

// The shared clipping walk: lo climbs while under loStop and the clipped count stays within lim,
// then hi falls while above lo + gap.
function clipWalk(h, lim, loStop, gap) {
  let acc = 0,
    lo = 0;
  while (lo < loStop && acc + h[lo] <= lim) acc += h[lo++];
  acc = 0;
  let hi = 255;
  while (hi > lo + gap && acc + h[hi] <= lim) acc += h[hi--];
  return [lo, hi];
}

// PhotoCraft adjust_editors.rs auto_levels (the Levels dialog's Auto button): clip = total / 1000
// at each end, lo stops at 253, hi stops at lo + 2. An empty histogram gives [0, 255].
export function levelsDialogAuto(h) {
  const total = h.reduce((a, v) => a + v, 0);
  if (total === 0) return [0, 255];
  return clipWalk(h, Math.floor(total / 1000), 253, 2);
}

// PhotoCraft tone.rs histogram_scale_top / draw_histogram: one bar per bin, centred at
// (i + 0.5) / 256 * width, height min(h[i] / top, 1) * height with top = max(max bin, 1) * 1.1.
export function histogramBars(h, width, height) {
  const top = Math.max(...h, 1) * 1.1;
  return h.map((v, i) => ({ x: ((i + 0.5) / 256) * width, height: Math.min(v / top, 1) * height }));
}

// PhotoCraft median: the first level whose running count reaches half the total.
export function levelsMedian(h) {
  const total = h.reduce((a, v) => a + v, 0);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += h[i];
    if (acc * 2 >= total) return i;
  }
  return 127.5;
}

// PhotoCraft auto_adjust (Image › Auto Tone / Auto Contrast / Auto Color, 0.1% clipping): Levels
// params with an identity RGB master. 'tone' stretches each channel on its own clip points,
// 'contrast' uses the summed histogram's points for all three, and 'color' is 'tone' plus a
// per-channel gamma that moves each channel's median onto the mean median.
export function autoLevelsParams(imgData, kind, mask = null) {
  const params = {};
  for (const f of ADJUSTMENTS.levels.fields) if (!f.local) params[f.key] = f.default;
  const h = levelsHistograms(imgData, mask);
  if (h[0].every((v) => v === 0)) return params;
  const clip = 0.001;
  if (kind === 'contrast') {
    const all = h[0].map((v, i) => v + h[1][i] + h[2][i]);
    const [lo, hi] = autoClipPoints(all, clip);
    for (const ch of LEVELS_CHANNELS) [params[ch + 'Black'], params[ch + 'White']] = [lo, hi];
    return params;
  }
  LEVELS_CHANNELS.forEach((ch, c) => {
    [params[ch + 'Black'], params[ch + 'White']] = autoClipPoints(h[c], clip);
  });
  if (kind === 'color') {
    const meds = h.slice(0, 3).map(levelsMedian);
    const target = (meds[0] + meds[1] + meds[2]) / 3;
    const unit = (v) => Math.max(0.02, Math.min(0.98, v));
    LEVELS_CHANNELS.forEach((ch, c) => {
      const lo = params[ch + 'Black'];
      const span = Math.max(params[ch + 'White'] - lo, 0.255);
      const t = unit((meds[c] - lo) / span);
      const want = unit((target - lo) / span);
      // out = t^(1/g) = want  →  g = ln t / ln want
      params[ch + 'Gamma'] = Math.max(0.1, Math.min(9.99, Math.log(t) / Math.log(want)));
    });
  }
  return params;
}

// PhotoCraft Adjustment::Exposure on an 8-bit RGB document (crates/compose/src/adjust.rs). Each
// RGB channel is linearized through a pure 2.2 power (Transfer::for_exposure), scaled by
// 2^exposure, shifted by offset (clamped at 0), raised to 1 / gamma, and encoded back through the
// 2.2 curve. Alpha is untouched and fully transparent pixels are skipped, as map_rgb does.
export function applyExposure(imgData, params = {}, mask = null) {
  const exposure = Number(params.exposure ?? 0);
  const offset = Number(params.offset ?? 0);
  const gamma = Math.max(0.01, Number(params.gamma ?? 1));
  if (exposure === 0 && offset === 0 && gamma === 1) return imgData;
  const m = Math.pow(2, exposure);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let lin = Math.max(0, Math.pow(v / 255, 2.2) * m + offset);
    if (gamma !== 1) lin = Math.pow(lin, 1 / gamma);
    lut[v] = Math.round(Math.min(1, Math.pow(lin, 1 / 2.2)) * 255);
  }
  const d = imgData.data;
  const n = imgData.width * imgData.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
  return imgData;
}

// PhotoCraft's curve table size (adjust.rs LUT_SIZE).
const CURVE_LUT_SIZE = 4096;

// The straight 0 → 0, 255 → 255 curve. Frozen: curve edits always build a new point array.
export const IDENTITY_CURVE = Object.freeze([
  Object.freeze({ input: 0, output: 0 }),
  Object.freeze({ input: 255, output: 255 })
]);

export function isIdentityCurve(points) {
  if (!Array.isArray(points) || points.length < 2) return true;
  if (points.length !== 2) return false;
  const [a, b] = points;
  return a.input === 0 && a.output === 0 && b.input === 255 && b.output === 255;
}

// PhotoCraft curve_lut (crates/compose/src/adjust.rs): a natural cubic spline through the points
// (it may overshoot between them, as Photoshop's does), constant outside the first / last point,
// clamped to 0..1, sampled into a 4096-entry f32 table. Points are { input, output } in 0..255.
export function curveLut(points) {
  const F = Math.fround;
  const pts = (Array.isArray(points) ? points : [])
    .filter((p) => Number.isFinite(p?.input) && Number.isFinite(p?.output))
    .map((p) => [F(p.input / 255), F(p.output / 255)])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, all) => i === 0 || Math.abs(p[0] - all[i - 1][0]) >= 1e-6);
  const table = new Float32Array(CURVE_LUT_SIZE);
  if (pts.length < 2) {
    for (let k = 0; k < CURVE_LUT_SIZE; k++) table[k] = k / (CURVE_LUT_SIZE - 1);
    return table;
  }
  const n = pts.length;
  // Second derivatives of the natural spline (tridiagonal solve).
  const m2 = new Float64Array(n);
  if (n > 2) {
    const c = new Float64Array(n);
    const d = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      const h0 = pts[i][0] - pts[i - 1][0];
      const h1 = pts[i + 1][0] - pts[i][0];
      const a = h0 / 6;
      const r = (pts[i + 1][1] - pts[i][1]) / h1 - (pts[i][1] - pts[i - 1][1]) / h0;
      const denom = (h0 + h1) / 3 - a * c[i - 1];
      c[i] = h1 / 6 / denom;
      d[i] = (r - a * d[i - 1]) / denom;
    }
    for (let i = n - 2; i >= 1; i--) m2[i] = d[i] - c[i] * m2[i + 1];
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  let i = 0;
  for (let k = 0; k < CURVE_LUT_SIZE; k++) {
    const xv = F(k / (CURVE_LUT_SIZE - 1));
    if (xv <= pts[0][0]) {
      table[k] = clamp01(pts[0][1]);
      continue;
    }
    if (xv >= pts[n - 1][0]) {
      table[k] = clamp01(pts[n - 1][1]);
      continue;
    }
    while (i < n - 2 && xv > pts[i + 1][0]) i++;
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = x1 - x0;
    const a = (x1 - xv) / h;
    const b = (xv - x0) / h;
    const y =
      a * y0 + b * y1 + (((a * a * a - a) * m2[i] + (b * b * b - b) * m2[i + 1]) * h * h) / 6;
    table[k] = clamp01(F(y));
  }
  return table;
}

// PhotoCraft's lut(): linear interpolation into a table, f32.
function sampleCurveLut(table, v) {
  const F = Math.fround;
  const x = F(Math.max(0, Math.min(1, v)) * (table.length - 1));
  const i = Math.floor(x);
  const j = Math.min(i + 1, table.length - 1);
  const f = F(x - i);
  return F(F(table[i] * F(1 - f)) + F(table[j] * f));
}

// The three 8-bit LUTs of a Curves adjustment (PhotoCraft tone_luts_q): each channel's curve
// first, then the master curve, as Photoshop does.
export function curvesByteLuts(params = {}) {
  const master = curveLut(params.master);
  return ['red', 'green', 'blue'].map((key) => {
    const row = curveLut(params[key]).map((v) => sampleCurveLut(master, v));
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(sampleCurveLut(row, v / 255) * 255);
    return lut;
  });
}

// PhotoCraft Adjustment::Curves on an 8-bit RGB document. params.master / red / green / blue are
// arrays of { input, output } points in 0..255. Alpha is untouched and fully transparent pixels
// are skipped (map_rgb).
export function applyCurves(imgData, params = {}, mask = null) {
  if (['master', 'red', 'green', 'blue'].every((k) => isIdentityCurve(params[k]))) return imgData;
  const luts = curvesByteLuts(params);
  const d = imgData.data;
  const n = imgData.width * imgData.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    d[i] = luts[0][d[i]];
    d[i + 1] = luts[1][d[i + 1]];
    d[i + 2] = luts[2][d[i + 2]];
  }
  return imgData;
}

// PhotoCraft Adjustment::ColorBalance (crates/compose/src/adjust.rs BalanceCurve). The shadows,
// midtones, and highlights shifts (Cyan-Red, Magenta-Green, Yellow-Blue, -100..100) fold into one
// Levels per channel: a black point, a white point, and a midtone gamma 2^(m / 100).
// - Preserve Luminosity off: lowered shadows set the black point to |shadows| levels, raised
//   highlights the white point to 255 - highlights, and m = midtones + (shadows + highlights) / 2.
// - Preserve Luminosity on: black = max(shadows) - own, white = own - min(highlights), and
//   m = own - (max + min) / 2 of the midtones, so an equal shift on all three channels is a no-op.
// A gamma > 1 starts at slope 2^gamma and joins the power curve in a cubic Hermite. f32 as in
// PhotoCraft. Alpha is untouched and fully transparent pixels are skipped (map_rgb).
export function colorBalanceCurve(tones, preserveLuminosity, ch) {
  const F = Math.fround;
  const [sh, mid, hi] = tones.map((t) =>
    t.map((v) => (Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0))
  );
  const max = (t) => Math.max(t[0], t[1], t[2]);
  const min = (t) => Math.min(t[0], t[1], t[2]);
  let black, white, m;
  if (preserveLuminosity) {
    black = F(max(sh) - sh[ch]);
    white = F(hi[ch] - min(hi));
    m = F(mid[ch] - F(F(max(mid) + min(mid)) / 2));
  } else {
    black = Math.max(0, -sh[ch]);
    white = Math.max(0, hi[ch]);
    m = F(mid[ch] + F(F(sh[ch] + hi[ch]) / 2));
  }
  const gamma = F(Math.pow(2, F(m / 100)));
  const e = F(1 / Math.max(0.01, gamma));
  let knee = null;
  if (gamma > 1) {
    const s0 = F(Math.pow(2, gamma));
    const u0 = Math.min(1, F(2 * F(Math.pow(s0, F(1 / F(e - 1))))));
    if (!Number.isNaN(u0) && u0 > 0) {
      knee = { u0, s0, p: F(Math.pow(u0, e)), d: F(e * F(Math.pow(u0, F(e - 1)))) };
    }
  }
  const b = F(black / 255);
  const w = F(1 - F(white / 255));
  return (v) => {
    v = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    if (v >= w) return 1;
    if (v <= b) return 0;
    const u = F(F(v - b) / F(w - b));
    if (knee && u < knee.u0) {
      const { u0, s0, p, d } = knee;
      const t = u / u0;
      const t2 = t * t,
        t3 = t2 * t;
      const out = (t3 - 2 * t2 + t) * u0 * s0 + (3 * t2 - 2 * t3) * p + (t3 - t2) * u0 * d;
      return Math.max(0, Math.min(1, F(out)));
    }
    return F(Math.pow(u, e));
  };
}

// Flat dialog params → PhotoCraft's [shadows, midtones, highlights] triples of [R, G, B].
export const COLOR_BALANCE_TONES = ['shadows', 'midtones', 'highlights'];
const COLOR_BALANCE_AXES = [
  ['R', 'Cyan · Red'],
  ['G', 'Magenta · Green'],
  ['B', 'Yellow · Blue']
];

export function colorBalanceTones(params = {}) {
  return COLOR_BALANCE_TONES.map((range) =>
    ['R', 'G', 'B'].map((c) => Number(params[range + c] ?? 0))
  );
}

export function applyColorBalance(imgData, params = {}, mask = null) {
  const tones = colorBalanceTones(params);
  const preserve = params.preserveLuminosity !== false;
  if (tones.every((t) => t.every((v) => v === 0))) return imgData;
  const luts = [0, 1, 2].map((ch) => {
    const curve = colorBalanceCurve(tones, preserve, ch);
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(curve(v / 255) * 255);
    return lut;
  });
  const d = imgData.data;
  const n = imgData.width * imgData.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    d[i] = luts[0][d[i]];
    d[i + 1] = luts[1][d[i + 1]];
    d[i + 2] = luts[2][d[i + 2]];
  }
  return imgData;
}

// Black & White (PhotoCraft Adjustment::BlackWhite / black_white_gray). Weights are percent for
// BLACK_WHITE_RANGES; PhotoCraft's (and Photoshop's) defaults are 40 60 40 60 20 80.
export const BLACK_WHITE_RANGES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
export const BLACK_WHITE_DEFAULTS = [40, 60, 40, 60, 20, 80];

// Grey value of c (0..1 RGB): the smallest channel, plus the secondary-colour part (middle −
// smallest, weighted by yellows / cyans / magentas) and the primary part (largest − middle,
// weighted by reds / greens / blues). Unclipped.
export function blackWhiteGray(c, weights) {
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const mid = r + g + b - max - min;
  const primary = r >= g && r >= b ? 0 : g >= b ? 2 : 4;
  const secondary = b <= r && b <= g ? 1 : r <= g ? 3 : 5;
  return min + ((mid - min) * weights[secondary]) / 100 + ((max - mid) * weights[primary]) / 100;
}

function hexToUnitRgb(hex, fallback = 0xe1d3b3) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  const n = m ? parseInt(m[1], 16) : fallback;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

// params: reds … magentas (percent), tint (bool), tintColor ('#rrggbb'). The tint is laid on like
// the Color blend mode: its hue and saturation at the grey's luminosity (setLum + clip).
export function applyBlackWhite(imgData, params = {}, mask = null) {
  const weights = BLACK_WHITE_RANGES.map((k, i) => Number(params[k] ?? BLACK_WHITE_DEFAULTS[i]));
  const tint = params.tint === true ? hexToUnitRgb(params.tintColor) : null;
  const d = imgData.data;
  const n = imgData.width * imgData.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    const gray = Math.min(
      1,
      Math.max(0, blackWhiteGray([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255], weights))
    );
    const out = tint ? setLum(tint, gray) : [gray, gray, gray];
    d[i] = Math.round(out[0] * 255);
    d[i + 1] = Math.round(out[1] * 255);
    d[i + 2] = Math.round(out[2] * 255);
  }
  return imgData;
}

// Photo Filter (PhotoCraft Adjustment::PhotoFilter / photo_filter_matrix, 8-bit sRGB path). The
// pixel's linear sRGB goes to D50 XYZ, each XYZ component is scaled by 1 − d + d · filter / D50
// (d = density), and the result comes back to sRGB. Preserve Luminosity then restores the encoded
// W3C luminosity like the Luminosity blend mode (setLum + clip).
const PF_D50 = [0.96422, 1.0, 0.82521];
const PF_SRGB_TO_XYZ = [
  [0.436074, 0.385064, 0.14308],
  [0.222504, 0.716878, 0.060618],
  [0.013932, 0.097104, 0.714173]
];
const PF_XYZ_TO_SRGB = [
  [3.133856, -1.616867, -0.490615],
  [-0.978768, 1.916142, 0.033454],
  [0.071945, -0.228991, 1.405243]
];

function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function mat3Apply(m, v) {
  return m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

// Linear-light RGB matrix XYZ_TO_SRGB · diag(s) · SRGB_TO_XYZ for a 0..1 filter color and a
// 0..1 density.
export function photoFilterMatrix(color, density) {
  const d = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 0;
  const xyz = mat3Apply(
    PF_SRGB_TO_XYZ,
    color.map((v) => srgbToLinear(Math.min(1, Math.max(0, v))))
  );
  const s = xyz.map((v, i) => 1 - d + (d * v) / PF_D50[i]);
  return [0, 1, 2].map((r) =>
    [0, 1, 2].map((c) =>
      [0, 1, 2].reduce((sum, k) => sum + PF_XYZ_TO_SRGB[r][k] * s[k] * PF_SRGB_TO_XYZ[k][c], 0)
    )
  );
}

// PhotoCraft's Photo Filter presets (adjust_params.rs PHOTO_FILTERS), in menu order.
export const PHOTO_FILTERS = [
  { value: 'warming85', label: 'Warming Filter (85)', hex: '#ec8a00' },
  { value: 'warmingLBA', label: 'Warming Filter (LBA)', hex: '#fa9600' },
  { value: 'warming81', label: 'Warming Filter (81)', hex: '#ebb113' },
  { value: 'cooling80', label: 'Cooling Filter (80)', hex: '#006dff' },
  { value: 'coolingLBB', label: 'Cooling Filter (LBB)', hex: '#005dff' },
  { value: 'cooling82', label: 'Cooling Filter (82)', hex: '#00b5ff' },
  { value: 'red', label: 'Red', hex: '#ea1a1a' },
  { value: 'orange', label: 'Orange', hex: '#f38417' },
  { value: 'yellow', label: 'Yellow', hex: '#f9e31c' },
  { value: 'green', label: 'Green', hex: '#19c919' },
  { value: 'cyan', label: 'Cyan', hex: '#1dcbea' },
  { value: 'blue', label: 'Blue', hex: '#1d35ea' },
  { value: 'violet', label: 'Violet', hex: '#9b1dea' },
  { value: 'magenta', label: 'Magenta', hex: '#e318e3' },
  { value: 'sepia', label: 'Sepia', hex: '#ac7a33' },
  { value: 'deepRed', label: 'Deep Red', hex: '#ff0000' },
  { value: 'deepBlue', label: 'Deep Blue', hex: '#0022cd' },
  { value: 'deepEmerald', label: 'Deep Emerald', hex: '#008c00' },
  { value: 'deepYellow', label: 'Deep Yellow', hex: '#ffd500' },
  { value: 'underwater', label: 'Underwater', hex: '#00c2b1' }
];

// The preset whose hex is color (case-insensitive), or undefined for a custom color.
export function photoFilterPreset(color) {
  const hex = String(color ?? '').toLowerCase();
  return PHOTO_FILTERS.find((f) => f.hex === hex);
}

// params: color ('#rrggbb'), density (percent 0..100), preserveLuminosity (bool).
export function applyPhotoFilter(imgData, params = {}, mask = null) {
  const color = hexToUnitRgb(params.color ?? '#ec8a00');
  const m = photoFilterMatrix(color, Number(params.density ?? 25) / 100);
  const keepLum = params.preserveLuminosity !== false;
  const decode = new Float64Array(256);
  for (let v = 0; v < 256; v++) decode[v] = srgbToLinear(v / 255);
  const d = imgData.data;
  const n = imgData.width * imgData.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    const lin = mat3Apply(m, [decode[d[i]], decode[d[i + 1]], decode[d[i + 2]]]);
    let out = lin.map((v) => linearToSrgb(Math.max(0, v)));
    if (keepLum) out = setLum(out, blendLum([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]));
    d[i] = Math.round(Math.min(1, Math.max(0, out[0])) * 255);
    d[i + 1] = Math.round(Math.min(1, Math.max(0, out[1])) * 255);
    d[i + 2] = Math.round(Math.min(1, Math.max(0, out[2])) * 255);
  }
  return imgData;
}

// Channel Mixer (PhotoCraft Adjustment::ChannelMixer, 8-bit path). Each output channel is a row of
// source percentages plus a constant on 0..1 samples, clamped; Monochrome writes the Gray row
// (Photoshop's 40 / 40 / 20 / 0 grey mix by default) to all three channels.
const MIXER_ROWS = ['red', 'green', 'blue'];
const MIXER_COLUMNS = ['Red', 'Green', 'Blue', 'Constant'];
const MIXER_GRAY = [40, 40, 20, 0];
const mixerIdentity = (i) => MIXER_COLUMNS.map((_, j) => (i === j ? 100 : 0));

function mixerRow(params, row, defaults) {
  return MIXER_COLUMNS.map((col, j) => {
    const v = Number(params[row + col] ?? defaults[j]);
    return Number.isFinite(v) ? Math.min(200, Math.max(-200, v)) / 100 : 0;
  });
}

// params: redRed, redGreen, redBlue, redConstant, greenRed … blueConstant, grayRed … grayConstant
// (percent -200..200), monochrome (bool).
export function applyChannelMixer(imgData, params = {}, mask = null) {
  let rows;
  if (params.monochrome === true) {
    const gray = mixerRow(params, 'gray', MIXER_GRAY);
    rows = [gray, gray, gray];
  } else {
    rows = MIXER_ROWS.map((row, i) => mixerRow(params, row, mixerIdentity(i)));
  }
  const d = imgData.data;
  const n = imgData.width * imgData.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    for (let c = 0; c < 3; c++) {
      const w = rows[c];
      const v = w[0] * r + w[1] * g + w[2] * b + w[3];
      d[i + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  return imgData;
}

// PhotoCraft adjust.rs bayer4: ordered-dither offset in -0.5..0.5 (4×4 Bayer) for pixel (x, y).
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function bayer4(x, y) {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
}

// PhotoCraft adjust.rs lut3d_sample: table is n³ RGB triplets (red fastest), rgb in 0..1.
// A degenerate or short table leaves the colour alone.
export function lut3dSample(table, n, rgb, tetrahedral = false) {
  if (!(n >= 2) || table.length < n * n * n * 3) return [rgb[0], rgb[1], rgb[2]];
  const m = n - 1;
  const pos = [0, 1, 2].map((k) => Math.min(1, Math.max(0, rgb[k])) * m);
  const i0 = pos.map((v) => Math.min(Math.floor(v), n - 2));
  const fr = pos[0] - i0[0];
  const fg = pos[1] - i0[1];
  const fb = pos[2] - i0[2];
  const at = (dr, dg, db) => {
    const idx = (((i0[2] + db) * n + i0[1] + dg) * n + i0[0] + dr) * 3;
    return [table[idx], table[idx + 1], table[idx + 2]];
  };
  const mix = (w) => [0, 1, 2].map((k) => w.reduce((s, [a, v]) => s + a * v[k], 0));
  if (tetrahedral) {
    const c000 = at(0, 0, 0);
    const c111 = at(1, 1, 1);
    if (fr > fg) {
      if (fg > fb) {
        return mix([
          [1 - fr, c000],
          [fr - fg, at(1, 0, 0)],
          [fg - fb, at(1, 1, 0)],
          [fb, c111]
        ]);
      }
      if (fr > fb) {
        return mix([
          [1 - fr, c000],
          [fr - fb, at(1, 0, 0)],
          [fb - fg, at(1, 0, 1)],
          [fg, c111]
        ]);
      }
      return mix([
        [1 - fb, c000],
        [fb - fr, at(0, 0, 1)],
        [fr - fg, at(1, 0, 1)],
        [fg, c111]
      ]);
    }
    if (fb > fg) {
      return mix([
        [1 - fb, c000],
        [fb - fg, at(0, 0, 1)],
        [fg - fr, at(0, 1, 1)],
        [fr, c111]
      ]);
    }
    if (fb > fr) {
      return mix([
        [1 - fg, c000],
        [fg - fb, at(0, 1, 0)],
        [fb - fr, at(0, 1, 1)],
        [fr, c111]
      ]);
    }
    return mix([
      [1 - fg, c000],
      [fg - fr, at(0, 1, 0)],
      [fr - fb, at(1, 1, 0)],
      [fb, c111]
    ]);
  }
  const lerp = (a, b, t) => [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
  const c00 = lerp(at(0, 0, 0), at(1, 0, 0), fr);
  const c10 = lerp(at(0, 1, 0), at(1, 1, 0), fr);
  const c01 = lerp(at(0, 0, 1), at(1, 0, 1), fr);
  const c11 = lerp(at(0, 1, 1), at(1, 1, 1), fr);
  return lerp(lerp(c00, c10, fg), lerp(c01, c11, fg), fb);
}

// PhotoCraft cms lutfile.rs LutFile::from_fn: an n³ lattice of f(rgb), red fastest, clamped.
export function lutLattice(n, f) {
  const m = Math.max(n, 2) - 1;
  const table = new Float32Array(n * n * n * 3);
  let i = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const o = f([r / m, g / m, b / m]);
        for (let k = 0; k < 3; k++) table[i++] = Math.min(1, Math.max(0, o[k]));
      }
    }
  }
  return table;
}

const lookLuma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const lookSmooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const perChannel = (f) => [f(0), f(1), f(2)];

// PhotoCraft lutfile.rs BUILTIN / builtin(): procedural looks (CC0), each a 33³ lattice.
export const LUT_LOOK_SIZE = 33;
export const LUT_LOOKS = [
  {
    id: 'warm',
    label: 'Warm Filter',
    f: (c) => [c[0] * 0.92 + 0.08, c[1] * 0.97 + 0.02, c[2] * 0.85]
  },
  {
    id: 'cool',
    label: 'Cool Filter',
    f: (c) => [c[0] * 0.86, c[1] * 0.97 + 0.01, c[2] * 0.9 + 0.1]
  },
  {
    id: 'tealOrange',
    label: 'Teal & Orange',
    f: (c) => {
      // Shadows toward teal, highlights toward orange, skin-ish midtones kept.
      const l = lookLuma(c);
      const t = lookSmooth(l);
      const teal = [0, 0.5, 0.55];
      const orange = [1, 0.62, 0.3];
      return perChannel((k) => {
        const tint = teal[k] * (1 - t) + orange[k] * t;
        return c[k] * 0.75 + Math.min(tint * l * 1.1, 1) * 0.25 + (lookSmooth(c[k]) - c[k]) * 0.3;
      });
    }
  },
  {
    id: 'bleachBypass',
    label: 'Bleach Bypass',
    f: (c) => {
      const l = lookLuma(c);
      const s = lookSmooth(l);
      return perChannel((k) => (c[k] * 0.45 + l * 0.55) * 0.5 + s * 0.5);
    }
  },
  {
    id: 'fadedFilm',
    label: 'Faded Film',
    f: (c) => {
      const l = lookLuma(c);
      const tint = [1, 0.96, 0.88];
      return perChannel((k) => (0.08 + (c[k] * 0.8 + l * 0.2) * 0.84) * tint[k] + 0.02);
    }
  },
  {
    id: 'dayForNight',
    label: 'Day for Night',
    f: (c) => {
      const l = lookLuma(c);
      return [l * 0.35, l * 0.45 + c[1] * 0.05, l * 0.65 + c[2] * 0.15];
    }
  },
  {
    id: 'monoContrast',
    label: 'Mono High Contrast',
    f: (c) => {
      const v = lookSmooth(lookSmooth(lookLuma(c)));
      return [v, v, v];
    }
  },
  {
    id: 'crossProcess',
    label: 'Cross Process',
    f: (c) => [lookSmooth(c[0]) * 1.05, c[1] * 1.1 - 0.03, c[2] * 0.7 + 0.15]
  }
];

const lutLookTables = new Map();
/** The built-in look's lattice (LUT_LOOK_SIZE³), built once, or null for 'none' / unknown. */
export function lutLookTable(id) {
  if (lutLookTables.has(id)) return lutLookTables.get(id);
  const look = LUT_LOOKS.find((l) => l.id === id);
  if (!look) return null;
  const table = lutLattice(LUT_LOOK_SIZE, look.f);
  lutLookTables.set(id, table);
  return table;
}

// PhotoCraft's 8-bit Adjustment::ColorLookup arm. params: lut ('none' or a LUT_LOOKS id),
// tetrahedral (bool), dither (bool: + bayer4(x, y) / 255, then clamp).
export function applyColorLookup(imgData, params = {}, mask = null) {
  const table = lutLookTable(params.lut);
  if (!table) return imgData;
  const tetra = params.tetrahedral === true;
  const dither = params.dither === true;
  const d = imgData.data;
  const W = imgData.width;
  const n = W * imgData.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    const o = lut3dSample(
      table,
      LUT_LOOK_SIZE,
      [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255],
      tetra
    );
    const off = dither ? bayer4(p % W, Math.floor(p / W)) / 255 : 0;
    for (let c = 0; c < 3; c++) {
      d[i + c] = Math.round(Math.min(1, Math.max(0, o[c] + off)) * 255);
    }
  }
  return imgData;
}

// PhotoCraft's 8-bit Adjustment::GradientMap arm. params: stops ([location, '#rrggbb'], see
// paint/gradient-stops.js; a legacy startColor / endColor pair still reads), reverse (bool: 1 - t), dither (bool: + bayer4(x, y) / 255, then clamp).
// t is the W3C luminosity (0.3, 0.59, 0.11), which PhotoCraft matched against Photoshop.
export function applyGradientMap(imgData, params = {}, mask = null) {
  const stops = unitStops(gradientMapStops(params));
  const reverse = params.reverse === true;
  const dither = params.dither === true;
  const d = imgData.data;
  const W = imgData.width;
  const n = W * imgData.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    let t = blendLum([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]);
    if (reverse) t = 1 - t;
    const o = gradientMapColor(stops, t);
    const off = dither ? bayer4(p % W, Math.floor(p / W)) / 255 : 0;
    for (let c = 0; c < 3; c++) {
      d[i + c] = Math.round(Math.min(1, Math.max(0, o[c] + off)) * 255);
    }
  }
  return imgData;
}

// PhotoCraft adjust.rs selective_color_weights: how much c (0..1 RGB) belongs to each range in
// SELECTIVE_RANGES order. Hue ranges go by chroma within the hue sector; whites, neutrals, and
// blacks by lightness.
export function selectiveColorWeights(c) {
  const max = Math.max(c[0], c[1], c[2]);
  const min = Math.min(c[0], c[1], c[2]);
  const mid = c[0] + c[1] + c[2] - max - min;
  const top = (i) => (c[i] >= max ? max - mid : 0);
  const bottom = (i) => (c[i] <= min ? mid - min : 0);
  return [
    top(0),
    bottom(2),
    top(1),
    bottom(0),
    top(2),
    bottom(1),
    Math.max(0, (min - 0.5) * 2),
    Math.min(1, Math.max(0, 1 - Math.abs(max - 0.5) - Math.abs(min - 0.5))),
    Math.max(0, (0.5 - max) * 2)
  ];
}

// PhotoCraft adjust.rs selective_color: adj is nine [cyan, magenta, yellow, black] percent rows.
// Each range shifts the inks (1 - R, G, B) by its percent plus its black, weighted by membership.
// Relative scales by the ink present; Absolute by the room the ink has (min(1, 2 × room)).
export function selectiveColor(c, relative, adj) {
  const w = selectiveColorWeights(c);
  const delta = [0, 0, 0];
  for (let r = 0; r < 9; r++) {
    if (w[r] <= 0) continue;
    const a = adj[r].map((v) => v / 100);
    for (let i = 0; i < 3; i++) {
      const ink = 1 - c[i];
      let d = a[i] + a[3];
      if (relative) d *= ink;
      else if (d > 0) d *= Math.min(1, 2 * (1 - ink));
      else d *= Math.min(1, 2 * ink);
      delta[i] += d * w[r];
    }
  }
  return [0, 1, 2].map((i) => Math.min(1, Math.max(0, c[i] - delta[i])));
}

// PhotoCraft adjust_cmds.rs RANGES and the four ink sliders per range.
export const SELECTIVE_RANGES = [
  'reds',
  'yellows',
  'greens',
  'cyans',
  'blues',
  'magentas',
  'whites',
  'neutrals',
  'blacks'
];
const SELECTIVE_INKS = ['Cyan', 'Magenta', 'Yellow', 'Black'];

function selectivePercent(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(100, Math.max(-100, x)) : 0;
}

// PhotoCraft's 8-bit Adjustment::SelectiveColor arm (map_rgb). params: method ('relative' |
// 'absolute') and flat <range><Ink> percents, e.g. redsCyan, neutralsBlack.
export function applySelectiveColor(imgData, params = {}, mask = null) {
  const relative = params.method !== 'absolute';
  const adj = SELECTIVE_RANGES.map((r) =>
    SELECTIVE_INKS.map((ink) => selectivePercent(params[r + ink]))
  );
  if (adj.every((row) => row.every((v) => v === 0))) return imgData;
  const d = imgData.data;
  const n = imgData.width * imgData.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask && !mask[p]) continue;
    if (d[i + 3] === 0) continue;
    const o = selectiveColor([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255], relative, adj);
    for (let c = 0; c < 3; c++) d[i + c] = Math.round(o[c] * 255);
  }
  return imgData;
}

// Vibrance in [-100, 100]. Works on HSV saturation s = (max - min) / max and
// keeps hue and value. Positive amounts scale s by 1 + v (1 - s), so muted
// colors gain the most and fully saturated ones don't move. Negative amounts
// scale s by 1 + v, pulling every color toward gray (all the way at -100).
export function applyVibrance(imgData, amount, mask = null) {
  const v = Math.max(-100, Math.min(100, Number(amount) || 0)) / 100;
  if (v === 0) return;
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    if (mx === mn) continue;
    const s = (mx - mn) / mx;
    const s2 = Math.max(0, Math.min(1, v > 0 ? s * (1 + v * (1 - s)) : s * (1 + v)));
    const k = s2 / s;
    d[i] = clamp(Math.round(mx - (mx - r) * k));
    d[i + 1] = clamp(Math.round(mx - (mx - g) * k));
    d[i + 2] = clamp(Math.round(mx - (mx - b) * k));
  }
}

// ── Adjustments registry — drives the menu + dialog ──────────────────────────

// PhotoCraft filters.rs presets: Blur More is Photoshop's 3x3 / 14 kernel.
const BLUR_MORE_KERNEL = [1, 2, 1, 2, 2, 2, 1, 2, 1];

export const ADJUSTMENTS = {
  blur: {
    label: 'Blur',
    fields: [],
    apply(img, params, mask) {
      applyGaussianBlur(img, 0.6, mask);
    }
  },
  blurMore: {
    label: 'Blur More',
    fields: [],
    apply(img, params, mask) {
      applyConvolve3(img, BLUR_MORE_KERNEL, 14, 0, mask);
    }
  },
  gaussianBlur: {
    label: 'Gaussian Blur',
    fields: [{ key: 'radius', label: 'Radius', min: 1, max: 32, default: 4 }],
    apply(img, params, mask) {
      applyGaussianBlur(img, params.radius, mask);
    }
  },
  motionBlur: {
    label: 'Motion Blur',
    fields: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, default: 0 },
      { key: 'distance', label: 'Distance', min: 1, max: 200, default: 10 }
    ],
    apply(img, params, mask) {
      applyMotionBlur(img, params.angle, params.distance, mask);
    }
  },
  radialBlur: {
    label: 'Radial Blur',
    fields: [
      { key: 'amount', label: 'Amount', min: 1, max: 100, default: 10 },
      { key: 'method', label: 'Method (0 Spin, 1 Zoom)', min: 0, max: 1, default: 0 },
      {
        key: 'quality',
        label: 'Quality (0 Draft, 1 Good, 2 Best)',
        min: 0,
        max: 2,
        default: 1
      },
      { key: 'centerX', label: 'Center X (%)', min: 0, max: 100, default: 50 },
      { key: 'centerY', label: 'Center Y (%)', min: 0, max: 100, default: 50 }
    ],
    apply(img, params, mask) {
      applyRadialBlur(img, params, mask);
    }
  },
  smartBlur: {
    label: 'Smart Blur',
    fields: [
      { key: 'radius', label: 'Radius', min: 0.1, max: 100, step: 0.1, default: 3 },
      { key: 'threshold', label: 'Threshold', min: 0.1, max: 100, step: 0.1, default: 25 },
      {
        key: 'quality',
        label: 'Quality (0 Low, 1 Medium, 2 High)',
        min: 0,
        max: 2,
        default: 2
      },
      {
        key: 'mode',
        label: 'Mode (0 Normal, 1 Edge Only, 2 Overlay Edge)',
        min: 0,
        max: 2,
        default: 0
      }
    ],
    apply(img, params, mask) {
      applySmartBlur(img, params, mask);
    }
  },
  shapeBlur: {
    label: 'Shape Blur',
    fields: [
      { key: 'radius', label: 'Radius', min: 5, max: 1000, default: 10 },
      {
        key: 'shape',
        label:
          'Shape (0 Circle, 1 Ring, 2 Square, 3 Diamond, 4 Triangle, 5 Hexagon, 6 Star, 7 Heart, 8 Cross)',
        min: 0,
        max: 8,
        default: 0
      }
    ],
    apply(img, params, mask) {
      applyShapeBlur(img, params, mask);
    }
  },
  lensBlur: {
    label: 'Lens Blur',
    fields: [
      {
        key: 'depthMap',
        label: 'Depth Map Source',
        type: 'select',
        default: 'none',
        options: [
          { value: 'none', label: 'None' },
          { value: 'transparency', label: 'Transparency' },
          { value: 'layerMask', label: 'Layer Mask' }
        ]
      },
      { key: 'focalDistance', label: 'Blur Focal Distance', min: 0, max: 255, default: 0 },
      { key: 'invert', label: 'Invert', type: 'checkbox', default: false },
      {
        key: 'shape',
        label: 'Iris Shape',
        type: 'select',
        default: 'hexagon',
        options: [
          { value: 'triangle', label: 'Triangle (3)' },
          { value: 'square', label: 'Square (4)' },
          { value: 'pentagon', label: 'Pentagon (5)' },
          { value: 'hexagon', label: 'Hexagon (6)' },
          { value: 'heptagon', label: 'Heptagon (7)' },
          { value: 'octagon', label: 'Octagon (8)' }
        ]
      },
      { key: 'radius', label: 'Radius', min: 0, max: 100, default: 15 },
      { key: 'bladeCurvature', label: 'Blade Curvature', min: 0, max: 100, default: 0 },
      { key: 'rotation', label: 'Rotation', min: 0, max: 360, default: 0 },
      { key: 'brightness', label: 'Specular Brightness', min: 0, max: 100, default: 0 },
      { key: 'threshold', label: 'Specular Threshold', min: 0, max: 255, default: 255 },
      { key: 'noise', label: 'Noise Amount', min: 0, max: 100, default: 0 },
      {
        key: 'distribution',
        label: 'Distribution',
        type: 'select',
        default: 'uniform',
        options: [
          { value: 'uniform', label: 'Uniform' },
          { value: 'gaussian', label: 'Gaussian' }
        ]
      },
      { key: 'monochromatic', label: 'Monochromatic', type: 'checkbox', default: false },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyLensBlur(img, params, mask);
    }
  },
  boxBlur: {
    label: 'Box Blur',
    fields: [{ key: 'radius', label: 'Radius', min: 1, max: 100, default: 5 }],
    apply(img, params, mask) {
      applyBoxBlur(img, params.radius, mask);
    }
  },
  surfaceBlur: {
    label: 'Surface Blur',
    fields: [
      { key: 'radius', label: 'Radius', min: 1, max: 100, default: 5 },
      { key: 'threshold', label: 'Threshold', min: 2, max: 255, default: 15 }
    ],
    apply(img, params, mask) {
      applySurfaceBlur(img, params.radius, params.threshold, mask);
    }
  },
  median: {
    label: 'Median',
    fields: [{ key: 'radius', label: 'Radius', min: 1, max: 100, default: 1 }],
    apply(img, params, mask) {
      applyMedian(img, params.radius, mask);
    }
  },
  addNoise: {
    label: 'Add Noise',
    fields: [
      { key: 'amount', label: 'Amount', min: 0, max: 400, default: 25 },
      { key: 'gaussian', label: 'Gaussian', min: 0, max: 1, default: 0 },
      { key: 'mono', label: 'Monochromatic', min: 0, max: 1, default: 0 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 1 }
    ],
    apply(img, params, mask) {
      applyAddNoise(img, params.amount, params.gaussian, params.mono, params.seed, mask);
    }
  },
  dustScratches: {
    label: 'Dust & Scratches',
    fields: [
      { key: 'radius', label: 'Radius', min: 1, max: 100, default: 1 },
      { key: 'threshold', label: 'Threshold', min: 0, max: 255, default: 0 }
    ],
    apply(img, params, mask) {
      applyDustScratches(img, params.radius, params.threshold, mask);
    }
  },
  despeckle: {
    label: 'Despeckle',
    fields: [],
    apply(img, params, mask) {
      applySurfaceBlur(img, 2, 12, mask);
    }
  },
  maximum: {
    label: 'Maximum',
    fields: [
      { key: 'radius', label: 'Radius', min: 1, max: 100, default: 1 },
      { key: 'round', label: 'Roundness (0 square, 1 round)', min: 0, max: 1, default: 0 }
    ],
    apply(img, params, mask) {
      if (Number(params.round) === 1) applyMinMaxRound(img, params.radius, true, mask);
      else applyMinMax(img, params.radius, true, mask);
    }
  },
  minimum: {
    label: 'Minimum',
    fields: [
      { key: 'radius', label: 'Radius', min: 1, max: 100, default: 1 },
      { key: 'round', label: 'Roundness (0 square, 1 round)', min: 0, max: 1, default: 0 }
    ],
    apply(img, params, mask) {
      if (Number(params.round) === 1) applyMinMaxRound(img, params.radius, false, mask);
      else applyMinMax(img, params.radius, false, mask);
    }
  },
  sharpen: {
    label: 'Sharpen',
    fields: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 50 }],
    apply(img, params, mask) {
      applySharpen(img, params.amount, mask);
    }
  },
  highPass: {
    label: 'High Pass',
    fields: [{ key: 'radius', label: 'Radius', min: 1, max: 32, default: 10 }],
    apply(img, params, mask) {
      applyHighPass(img, params.radius, mask);
    }
  },
  smartSharpen: {
    label: 'Smart Sharpen',
    fields: [
      { key: 'amount', label: 'Amount', min: 1, max: 500, default: 100 },
      { key: 'radius', label: 'Radius', min: 1, max: 64, default: 1 },
      { key: 'reduceNoise', label: 'Reduce Noise', min: 0, max: 100, default: 10 }
    ],
    apply(img, params, mask) {
      applySmartSharpen(img, params.amount, params.radius, params.reduceNoise, mask);
    }
  },
  sharpenMore: {
    label: 'Sharpen More',
    fields: [],
    apply(img, params, mask) {
      applyUnsharpMask(img, 150, 0.6, 0, mask);
    }
  },
  sharpenEdges: {
    label: 'Sharpen Edges',
    fields: [],
    apply(img, params, mask) {
      applyUnsharpMask(img, 100, 0.8, 6, mask);
    }
  },
  unsharpMask: {
    label: 'Unsharp Mask',
    fields: [
      { key: 'amount', label: 'Amount', min: 1, max: 500, default: 50 },
      { key: 'radius', label: 'Radius', min: 1, max: 32, default: 1 },
      { key: 'threshold', label: 'Threshold', min: 0, max: 255, default: 0 }
    ],
    apply(img, params, mask) {
      applyUnsharpMask(img, params.amount, params.radius, params.threshold, mask);
    }
  },
  emboss: {
    label: 'Emboss',
    fields: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, default: 135 },
      { key: 'height', label: 'Height', min: 1, max: 10, default: 3 },
      { key: 'amount', label: 'Amount', min: 1, max: 500, default: 100 }
    ],
    apply(img, params, mask) {
      applyEmboss(img, params.angle, params.height, params.amount, mask);
    }
  },
  findEdges: {
    label: 'Find Edges',
    fields: [],
    apply(img, params, mask) {
      applyFindEdges(img, mask);
    }
  },
  traceContour: {
    label: 'Trace Contour',
    fields: [
      { key: 'level', label: 'Level', min: 0, max: 255, default: 128 },
      { key: 'edge', label: 'Edge', min: 0, max: 1, default: 0 }
    ],
    apply(img, params, mask) {
      applyTraceContour(img, params.level, params.edge, mask);
    }
  },
  diffuse: {
    label: 'Diffuse',
    fields: [
      { key: 'mode', label: 'Mode', min: 0, max: 3, default: 0 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyDiffuse(img, params.mode, params.seed, mask);
    }
  },
  wind: {
    label: 'Wind',
    fields: [
      { key: 'method', label: 'Method', min: 0, max: 2, default: 0 },
      { key: 'direction', label: 'Direction', min: 0, max: 1, default: 0 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyWind(img, params.method, params.direction, params.seed, mask);
    }
  },
  solarize: {
    label: 'Solarize',
    fields: [],
    apply(img, params, mask) {
      applySolarize(img, mask);
    }
  },
  twirl: {
    label: 'Twirl',
    fields: [{ key: 'angle', label: 'Angle', min: -999, max: 999, default: 50 }],
    apply(img, params, mask) {
      applyTwirl(img, params.angle, mask);
    }
  },
  pinch: {
    label: 'Pinch',
    fields: [{ key: 'amount', label: 'Amount', min: -100, max: 100, default: 50 }],
    apply(img, params, mask) {
      applyPinch(img, params.amount, mask);
    }
  },
  spherize: {
    label: 'Spherize',
    fields: [
      { key: 'amount', label: 'Amount', min: -100, max: 100, default: 100 },
      { key: 'mode', label: 'Mode', min: 0, max: 2, default: 0 }
    ],
    apply(img, params, mask) {
      applySpherize(img, params.amount, params.mode, mask);
    }
  },
  wave: {
    label: 'Wave',
    fields: [
      { key: 'generators', label: 'Generators', min: 1, max: 64, default: 5 },
      { key: 'wavelengthMin', label: 'Wavelength Min', min: 1, max: 998, default: 10 },
      { key: 'wavelengthMax', label: 'Wavelength Max', min: 2, max: 999, default: 120 },
      { key: 'amplitudeMin', label: 'Amplitude Min', min: 1, max: 998, default: 5 },
      { key: 'amplitudeMax', label: 'Amplitude Max', min: 1, max: 999, default: 35 },
      { key: 'waveType', label: 'Type', min: 0, max: 2, default: 0 },
      { key: 'undefinedAreas', label: 'Undefined Areas', min: 0, max: 2, default: 0 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyWave(
        img,
        params.generators,
        params.wavelengthMin,
        params.wavelengthMax,
        params.amplitudeMin,
        params.amplitudeMax,
        params.waveType,
        params.undefinedAreas,
        params.seed,
        mask
      );
    }
  },
  ripple: {
    label: 'Ripple',
    fields: [
      { key: 'amount', label: 'Amount', min: -999, max: 999, default: 100 },
      { key: 'size', label: 'Size', min: 0, max: 2, default: 1 }
    ],
    apply(img, params, mask) {
      applyRipple(img, params.amount, params.size, mask);
    }
  },
  polarCoordinates: {
    label: 'Polar Coordinates',
    fields: [{ key: 'mode', label: 'Mode', min: 0, max: 1, default: 0 }],
    apply(img, params, mask) {
      applyPolarCoordinates(img, params.mode, mask);
    }
  },
  zigZag: {
    label: 'ZigZag',
    fields: [
      { key: 'amount', label: 'Amount', min: -100, max: 100, default: 10 },
      { key: 'ridges', label: 'Ridges', min: 0, max: 20, default: 5 },
      { key: 'style', label: 'Style', min: 0, max: 2, default: 2 }
    ],
    apply(img, params, mask) {
      applyZigZag(img, params.amount, params.ridges, params.style, mask);
    }
  },
  displace: {
    label: 'Displace',
    fields: [
      { key: 'horizontal', label: 'Horizontal Scale (%)', min: -999, max: 999, default: 10 },
      { key: 'vertical', label: 'Vertical Scale (%)', min: -999, max: 999, default: 10 },
      {
        key: 'fit',
        label: 'Displacement Map',
        type: 'select',
        default: 'stretch',
        options: [
          { value: 'stretch', label: 'Stretch to Fit' },
          { value: 'tile', label: 'Tile' }
        ]
      },
      {
        key: 'undefinedAreas',
        label: 'Undefined Areas',
        type: 'select',
        default: 'repeat',
        options: [
          { value: 'repeat', label: 'Repeat Edge Pixels' },
          { value: 'wrap', label: 'Wrap Around' }
        ]
      },
      {
        key: 'mapLayer',
        label: 'Map Layer',
        type: 'select',
        default: '',
        get options() {
          return displaceMaps.options();
        }
      }
    ],
    apply(img, params, mask) {
      const map = params.map ?? displaceMaps.image(params.mapLayer);
      applyDisplace(
        img,
        params.horizontal,
        params.vertical,
        params.fit,
        params.undefinedAreas,
        map,
        mask
      );
    }
  },
  shear: {
    label: 'Shear',
    fields: [
      { key: 'amount', label: 'Amount', min: -100, max: 100, default: 0 },
      {
        key: 'undefinedAreas',
        label: 'Undefined Areas',
        type: 'select',
        default: 'wrap',
        options: [
          { value: 'wrap', label: 'Wrap Around' },
          { value: 'repeat', label: 'Repeat Edge Pixels' }
        ]
      }
    ],
    apply(img, params, mask) {
      const a = clampNum(params.amount, -100, 100, 0) / 100;
      const points = params.points ?? [
        [0, 0],
        [0.5, a],
        [1, 0]
      ];
      applyShear(img, points, params.undefinedAreas, mask);
    }
  },
  extrude: {
    label: 'Extrude',
    fields: [
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        default: 'blocks',
        options: [
          { value: 'blocks', label: 'Blocks' },
          { value: 'pyramids', label: 'Pyramids' }
        ]
      },
      { key: 'size', label: 'Size (px)', min: 2, max: 255, default: 30 },
      { key: 'depth', label: 'Depth', min: 1, max: 255, default: 30 },
      {
        key: 'depthMode',
        label: 'Depth Mode',
        type: 'select',
        default: 'random',
        options: [
          { value: 'random', label: 'Random' },
          { value: 'levelBased', label: 'Level-based' }
        ]
      },
      { key: 'solidFrontFaces', label: 'Solid Front Faces', type: 'checkbox', default: false },
      {
        key: 'maskIncompleteBlocks',
        label: 'Mask Incomplete Blocks',
        type: 'checkbox',
        default: false
      },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyExtrude(img, params, mask);
    }
  },
  oilPaint: {
    label: 'Oil Paint',
    fields: [
      { key: 'stylization', label: 'Stylization', min: 0.1, max: 10, step: 0.1, default: 4 },
      { key: 'cleanliness', label: 'Cleanliness', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'scale', label: 'Scale', min: 0.1, max: 10, step: 0.1, default: 1 },
      { key: 'bristleDetail', label: 'Bristle Detail', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'lighting', label: 'Lighting', type: 'checkbox', default: true },
      { key: 'angle', label: 'Angle', min: -180, max: 180, default: -60 },
      { key: 'shine', label: 'Shine', min: 0, max: 10, step: 0.1, default: 1 }
    ],
    apply(img, params, mask) {
      applyOilPaint(img, params, mask);
    }
  },
  tiles: {
    label: 'Tiles',
    fields: [
      { key: 'count', label: 'Number of Tiles', min: 1, max: 99, default: 10 },
      { key: 'maxOffset', label: 'Maximum Offset (%)', min: 1, max: 99, default: 10 },
      {
        key: 'fill',
        label: 'Fill Empty Area With',
        type: 'select',
        default: 'background',
        options: [
          { value: 'background', label: 'Background Color' },
          { value: 'foreground', label: 'Foreground Color' },
          { value: 'inverse', label: 'Inverse Image' },
          { value: 'unaltered', label: 'Unaltered Image' }
        ]
      },
      {
        key: 'foreground',
        label: 'Foreground',
        type: 'color',
        default: '#000000',
        swatch: 0,
        group: { key: 'fill', value: 'foreground' }
      },
      {
        key: 'background',
        label: 'Background',
        type: 'color',
        default: '#ffffff',
        swatch: 1,
        group: { key: 'fill', value: 'background' }
      },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyTiles(img, params, mask);
    }
  },
  offset: {
    label: 'Offset',
    fields: [
      { key: 'dx', label: 'Horizontal', min: -2000, max: 2000, default: 0 },
      { key: 'dy', label: 'Vertical', min: -2000, max: 2000, default: 0 },
      { key: 'undefinedAreas', label: 'Undefined Areas', min: 0, max: 2, default: 0 }
    ],
    apply(img, params, mask) {
      applyOffset(img, params.dx, params.dy, params.undefinedAreas, mask);
    }
  },
  custom: {
    label: 'Custom',
    // The 5x5 kernel is flat k0..k24 (row-major, k12 the centre) so params stay flat.
    fields: [
      ...Array.from({ length: 25 }, (_, i) => ({
        key: 'k' + i,
        label: `Row ${Math.floor(i / 5) + 1}, Column ${(i % 5) + 1}`,
        min: -999,
        max: 999,
        default: i === 12 ? 1 : 0
      })),
      { key: 'scale', label: 'Scale', min: 1, max: 9999, default: 1 },
      { key: 'offset', label: 'Offset', min: -9999, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      const kernel = Array.from({ length: 25 }, (_, i) => params['k' + i]);
      applyCustom(img, kernel, params.scale, params.offset, mask);
    }
  },
  hsbHsl: {
    label: 'HSB/HSL',
    fields: [
      {
        key: 'inputMode',
        label: 'Input Mode',
        type: 'select',
        default: 'rgb',
        options: [
          { value: 'rgb', label: 'RGB' },
          { value: 'hsb', label: 'HSB' },
          { value: 'hsl', label: 'HSL' }
        ]
      },
      {
        key: 'rowOrder',
        label: 'Row Order',
        type: 'select',
        default: 'hsb',
        options: [
          { value: 'rgb', label: 'RGB' },
          { value: 'hsb', label: 'HSB' },
          { value: 'hsl', label: 'HSL' }
        ]
      }
    ],
    apply(img, params, mask) {
      applyHsbHsl(img, params.inputMode, params.rowOrder, mask);
    }
  },
  deInterlace: {
    label: 'De-Interlace',
    fields: [
      { key: 'eliminate', label: 'Eliminate', min: 0, max: 1, default: 0 },
      { key: 'createBy', label: 'Create By', min: 0, max: 1, default: 1 }
    ],
    apply(img, params, mask) {
      applyDeInterlace(img, params.eliminate, params.createBy, mask);
    }
  },
  ntscColors: {
    label: 'NTSC Colors',
    fields: [],
    apply(img, params, mask) {
      applyNtscColors(img, mask);
    }
  },
  average: {
    label: 'Average',
    fields: [],
    apply(img, params, mask) {
      applyAverage(img, mask);
    }
  },
  fragment: {
    label: 'Fragment',
    fields: [],
    apply(img, params, mask) {
      applyFragment(img, mask);
    }
  },
  facet: {
    label: 'Facet',
    fields: [],
    apply(img, params, mask) {
      applyFacet(img, mask);
    }
  },
  crystallize: {
    label: 'Crystallize',
    fields: [
      { key: 'cellSize', label: 'Cell Size', min: 3, max: 300, default: 10 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyCrystallize(img, params.cellSize, params.seed, mask);
    }
  },
  pointillize: {
    label: 'Pointillize',
    fields: [
      { key: 'cellSize', label: 'Cell Size', min: 3, max: 300, default: 5 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyPointillize(img, params.cellSize, params.seed, [255, 255, 255, 255], mask);
    }
  },
  mezzotint: {
    label: 'Mezzotint',
    fields: [
      { key: 'type', label: 'Type', min: 0, max: 9, default: 0 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyMezzotint(img, params.type, params.seed, mask);
    }
  },
  colorHalftone: {
    label: 'Color Halftone',
    fields: [
      { key: 'maxRadius', label: 'Max Radius', min: 4, max: 127, default: 8 },
      { key: 'channel1', label: 'Channel 1', min: -360, max: 360, default: 108 },
      { key: 'channel2', label: 'Channel 2', min: -360, max: 360, default: 162 },
      { key: 'channel3', label: 'Channel 3', min: -360, max: 360, default: 90 }
    ],
    apply(img, params, mask) {
      applyColorHalftone(
        img,
        params.maxRadius,
        params.channel1,
        params.channel2,
        params.channel3,
        mask
      );
    }
  },
  clouds: {
    label: 'Clouds',
    fields: [{ key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }],
    apply(img, params, mask) {
      applyClouds(img, params.seed, false, mask);
    }
  },
  differenceClouds: {
    label: 'Difference Clouds',
    fields: [{ key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }],
    apply(img, params, mask) {
      applyClouds(img, params.seed, true, mask);
    }
  },
  fibers: {
    label: 'Fibers',
    fields: [
      { key: 'variance', label: 'Variance', min: 1, max: 64, default: 16 },
      { key: 'strength', label: 'Strength', min: 1, max: 64, default: 4 },
      { key: 'seed', label: 'Seed', min: 0, max: 9999, default: 0 }
    ],
    apply(img, params, mask) {
      applyFibers(img, params.variance, params.strength, params.seed, mask);
    }
  },
  lensFlare: {
    label: 'Lens Flare',
    fields: [
      { key: 'brightness', label: 'Brightness', min: 10, max: 300, default: 100 },
      { key: 'centerX', label: 'Center X (%)', min: -50, max: 150, default: 50 },
      { key: 'centerY', label: 'Center Y (%)', min: -50, max: 150, default: 50 },
      { key: 'lens', label: 'Lens (0 Zoom, 1 35mm, 2 105mm, 3 Movie)', min: 0, max: 3, default: 0 }
    ],
    apply(img, params, mask) {
      applyLensFlare(img, params.brightness, params.centerX, params.centerY, params.lens, mask);
    }
  },
  lightingEffects: {
    label: 'Lighting Effects',
    fields: [
      {
        key: 'lightType',
        label: 'Light (0 Spot, 1 Point, 2 Infinite)',
        min: 0,
        max: 2,
        default: 0
      },
      { key: 'lightX', label: 'Light X (%)', min: -50, max: 150, default: 25 },
      { key: 'lightY', label: 'Light Y (%)', min: -50, max: 150, default: 20 },
      { key: 'lightZ', label: 'Light Z (% of short side)', min: 0, max: 1000, default: 60 },
      { key: 'angle', label: 'Angle', min: -360, max: 360, default: 135 },
      { key: 'elevation', label: 'Elevation', min: 0, max: 90, default: 45 },
      { key: 'intensity', label: 'Intensity', min: -100, max: 100, default: 75 },
      { key: 'cone', label: 'Cone', min: 1, max: 89, default: 45 },
      { key: 'hotspot', label: 'Hotspot', min: 0, max: 100, default: 50 },
      { key: 'gloss', label: 'Gloss', min: -100, max: 100, default: 0 },
      { key: 'metallic', label: 'Metallic', min: -100, max: 100, default: 0 },
      { key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 },
      { key: 'ambience', label: 'Ambience', min: -100, max: 100, default: 8 },
      {
        key: 'texture',
        label: 'Texture (0 None, 1 R, 2 G, 3 B, 4 Alpha, 5 Luminance)',
        min: 0,
        max: 5,
        default: 0
      },
      { key: 'height', label: 'Height', min: 0, max: 100, default: 50 }
    ],
    apply(img, params, mask) {
      applyLightingEffects(img, params, mask);
    }
  },
  relight: {
    label: 'Relight',
    fields: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, default: 45 },
      { key: 'elevation', label: 'Elevation', min: 0, max: 90, default: 40 },
      { key: 'intensity', label: 'Intensity', min: 0, max: 100, default: 40 },
      { key: 'ambient', label: 'Ambient', min: 0, max: 100, default: 55 },
      { key: 'warmth', label: 'Warmth', min: -100, max: 100, default: 0 },
      { key: 'softness', label: 'Softness', min: 1, max: 100, default: 25 }
    ],
    apply(img, params, mask) {
      applyRelight(img, params, mask);
    }
  },
  brightness: {
    label: 'Brightness / Contrast',
    fields: [
      { key: 'brightness', label: 'Brightness', min: -150, max: 150, default: 0 },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 },
      {
        key: 'legacy',
        label: 'Use Legacy',
        type: 'checkbox',
        default: false,
        // PhotoCraft adjust_editors.rs brightness_contrast: modern contrast floors at -50.
        onChange(params, value) {
          if (!value && params.contrast < -50) params.contrast = -50;
        }
      }
    ],
    apply(img, params, mask) {
      if (params.legacy === true) {
        applyLegacyBrightnessContrast(img, params.brightness, params.contrast, mask);
      } else {
        applyModernBrightnessContrast(img, params.brightness, params.contrast, mask);
      }
    }
  },
  levels: {
    label: 'Levels',
    // PhotoCraft's Channel select is dialog-local; the params stay flat <ch><Field> keys.
    fields: [
      {
        key: 'channel',
        label: 'Channel',
        type: 'select',
        local: true,
        default: 'rgb',
        options: [
          { value: 'rgb', label: 'RGB' },
          ...LEVELS_CHANNELS.map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1)
          }))
        ]
      },
      ...['', ...LEVELS_CHANNELS].flatMap((ch) => {
        const group = { key: 'channel', value: ch || 'rgb' };
        const key = (name) => (ch ? ch + name : name[0].toLowerCase() + name.slice(1));
        return [
          { key: key('Black'), label: 'Input black', min: 0, max: 254, default: 0, group },
          {
            key: key('Gamma'),
            label: 'Gamma',
            min: 0.01,
            max: 9.99,
            step: 0.01,
            default: 1,
            group
          },
          { key: key('White'), label: 'Input white', min: 1, max: 255, default: 255, group },
          { key: key('OutBlack'), label: 'Output black', min: 0, max: 255, default: 0, group },
          { key: key('OutWhite'), label: 'Output white', min: 0, max: 255, default: 255, group }
        ];
      })
    ],
    apply(img, params, mask) {
      applyLevelsChannels(img, params, mask);
    }
  },
  // The four curve fields share one editor with a channel select (renderFields in adjust-modal.js).
  curves: {
    label: 'Curves',
    fields: [
      { key: 'master', label: 'RGB', type: 'curve', default: IDENTITY_CURVE },
      { key: 'red', label: 'Red', type: 'curve', default: IDENTITY_CURVE },
      { key: 'green', label: 'Green', type: 'curve', default: IDENTITY_CURVE },
      { key: 'blue', label: 'Blue', type: 'curve', default: IDENTITY_CURVE }
    ],
    apply(img, params, mask) {
      applyCurves(img, params, mask);
    }
  },
  hsl: {
    label: 'Hue / Saturation',
    // PhotoCraft's Edit dropdown: Master or one hue range, each with its own three sliders.
    // Edit is dialog-local; the params stay flat (hue, redsHue, redsSaturation, ...).
    fields: [
      {
        key: 'edit',
        label: 'Edit',
        type: 'select',
        local: true,
        default: 'master',
        options: ['master', ...HUE_RANGES].map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1)
        }))
      },
      ...['', ...HUE_RANGES].flatMap((range) => {
        const group = { key: 'edit', value: range || 'master' };
        const key = (name) => (range ? range + name : name.toLowerCase());
        return [
          { key: key('Hue'), label: 'Hue', min: -180, max: 180, default: 0, group },
          { key: key('Saturation'), label: 'Saturation', min: -100, max: 100, default: 0, group },
          { key: key('Lightness'), label: 'Lightness', min: -100, max: 100, default: 0, group }
        ];
      }),
      {
        key: 'colorize',
        label: 'Colorize',
        type: 'checkbox',
        default: false,
        // PhotoCraft starts Colorize at 25% saturation when none is set.
        onChange(params, value) {
          if (value && params.saturation === 0) params.saturation = 25;
        }
      }
    ],
    apply(img, params, mask) {
      applyHueSatLight(
        img,
        params.hue,
        params.saturation,
        params.lightness,
        params.colorize === true,
        mask,
        HUE_RANGES.map((range) => ({
          hue: params[range + 'Hue'] || 0,
          saturation: params[range + 'Saturation'] || 0,
          lightness: params[range + 'Lightness'] || 0
        }))
      );
    }
  },
  exposure: {
    label: 'Exposure',
    fields: [
      { key: 'exposure', label: 'Exposure', min: -20, max: 20, step: 0.01, default: 0 },
      { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.0001, default: 0 },
      { key: 'gamma', label: 'Gamma Correction', min: 0.1, max: 9.99, step: 0.01, default: 1 }
    ],
    apply(img, params, mask) {
      applyExposure(img, params, mask);
    }
  },
  colorBalance: {
    label: 'Color Balance',
    // PhotoCraft's editor: a Tone choice (default Midtones) shows that tone's three sliders.
    // Tone is dialog-local; the params stay flat <tone><R|G|B> keys.
    fields: [
      {
        key: 'tone',
        label: 'Tone',
        type: 'select',
        local: true,
        default: 'midtones',
        options: COLOR_BALANCE_TONES.map((tone) => ({
          value: tone,
          label: tone[0].toUpperCase() + tone.slice(1)
        }))
      },
      ...COLOR_BALANCE_TONES.flatMap((tone) =>
        COLOR_BALANCE_AXES.map(([c, label]) => ({
          key: tone + c,
          label,
          min: -100,
          max: 100,
          default: 0,
          group: { key: 'tone', value: tone }
        }))
      ),
      { key: 'preserveLuminosity', label: 'Preserve Luminosity', type: 'checkbox', default: true }
    ],
    apply(img, params, mask) {
      applyColorBalance(img, params, mask);
    }
  },
  blackWhite: {
    label: 'Black & White',
    fields: [
      ...BLACK_WHITE_RANGES.map((key, i) => ({
        key,
        label: key[0].toUpperCase() + key.slice(1),
        min: -200,
        max: 300,
        default: BLACK_WHITE_DEFAULTS[i]
      })),
      { key: 'tint', label: 'Tint', type: 'checkbox', default: false },
      { key: 'tintColor', label: 'Tint Color', type: 'color', default: '#e1d3b3' }
    ],
    apply(img, params, mask) {
      applyBlackWhite(img, params, mask);
    }
  },
  photoFilter: {
    label: 'Photo Filter',
    // PhotoCraft's editor: Use picks a named Filter preset or a custom Color. Use and Filter are
    // dialog-local; picking a preset writes its hex to params.color, so params stay flat.
    fields: [
      {
        key: 'use',
        label: 'Use',
        type: 'select',
        local: true,
        default: (params) => (photoFilterPreset(params.color) ? 'filter' : 'color'),
        options: [
          { value: 'filter', label: 'Filter' },
          { value: 'color', label: 'Color' }
        ]
      },
      {
        key: 'filter',
        label: 'Filter',
        type: 'select',
        local: true,
        default: (params) => (photoFilterPreset(params.color) ?? PHOTO_FILTERS[0]).value,
        options: PHOTO_FILTERS.map(({ value, label }) => ({ value, label })),
        group: { key: 'use', value: 'filter' },
        onChange(params, value) {
          params.color = PHOTO_FILTERS.find((f) => f.value === value).hex;
        }
      },
      {
        key: 'color',
        label: 'Color',
        type: 'color',
        default: '#ec8a00',
        group: { key: 'use', value: 'color' }
      },
      { key: 'density', label: 'Density', min: 0, max: 100, default: 25 },
      { key: 'preserveLuminosity', label: 'Preserve Luminosity', type: 'checkbox', default: true }
    ],
    apply(img, params, mask) {
      applyPhotoFilter(img, params, mask);
    }
  },
  channelMixer: {
    label: 'Channel Mixer',
    // PhotoCraft's editor: an Output Channel dropdown picks which row's Red / Green / Blue sliders,
    // Total readout, and Constant show; with Monochrome on it lists only Gray. Output Channel and
    // Total are dialog-local (not params); the params stay flat <row><Col> keys.
    fields: [
      {
        key: 'outputChannel',
        label: 'Output Channel',
        type: 'select',
        local: true,
        default: 'red',
        options: [...MIXER_ROWS, 'gray'].map((row) => ({
          value: row,
          label: row[0].toUpperCase() + row.slice(1),
          group: { key: 'monochrome', value: row === 'gray' }
        }))
      },
      ...[...MIXER_ROWS, 'gray'].flatMap((row, i) => {
        const group = { key: 'outputChannel', value: row };
        const defaults = row === 'gray' ? MIXER_GRAY : mixerIdentity(i);
        const slider = (col, j) => ({
          key: row + col,
          label: col,
          min: -200,
          max: 200,
          default: defaults[j],
          group
        });
        const total = (params) =>
          MIXER_COLUMNS.slice(0, 3).reduce((sum, col) => sum + Number(params[row + col] || 0), 0);
        return [
          ...MIXER_COLUMNS.slice(0, 3).map(slider),
          {
            key: row + 'Total',
            label: 'Total',
            type: 'readout',
            local: true,
            group,
            text: (params) => {
              const t = Math.round(total(params));
              return (t >= 0 ? '+' : '') + t + '%';
            },
            warn: (params) => total(params) > 100
          },
          slider('Constant', 3)
        ];
      }),
      { key: 'monochrome', label: 'Monochrome', type: 'checkbox', default: false }
    ],
    apply(img, params, mask) {
      applyChannelMixer(img, params, mask);
    }
  },
  colorLookup: {
    label: 'Color Lookup',
    fields: [
      {
        key: 'lut',
        label: 'Look',
        type: 'select',
        default: 'none',
        options: [
          { value: 'none', label: 'None' },
          ...LUT_LOOKS.map((l) => ({ value: l.id, label: l.label }))
        ]
      },
      { key: 'tetrahedral', label: 'Tetrahedral', type: 'checkbox', default: false },
      { key: 'dither', label: 'Dither', type: 'checkbox', default: false }
    ],
    apply(img, params, mask) {
      applyColorLookup(img, params, mask);
    }
  },
  gradientMap: {
    label: 'Gradient Map',
    fields: [
      // PhotoCraft's stop strip with the selected stop's Color / Location (renderFields).
      { key: 'stops', label: 'Gradient', type: 'gradient', default: DEFAULT_GRADIENT_STOPS },
      { key: 'reverse', label: 'Reverse', type: 'checkbox', default: false },
      { key: 'dither', label: 'Dither', type: 'checkbox', default: false }
    ],
    apply(img, params, mask) {
      applyGradientMap(img, params, mask);
    }
  },
  selectiveColor: {
    label: 'Selective Color',
    // PhotoCraft's editor: a Colors dropdown picks which range's four inks show. Colors is
    // dialog-local (not a param); the params stay flat <range><Ink> keys.
    fields: [
      {
        key: 'colors',
        label: 'Colors',
        type: 'select',
        local: true,
        default: 'reds',
        options: SELECTIVE_RANGES.map((range) => ({
          value: range,
          label: range[0].toUpperCase() + range.slice(1)
        }))
      },
      ...SELECTIVE_RANGES.flatMap((range) =>
        SELECTIVE_INKS.map((ink) => ({
          key: range + ink,
          label: ink,
          min: -100,
          max: 100,
          default: 0,
          group: { key: 'colors', value: range }
        }))
      ),
      {
        key: 'method',
        label: 'Method',
        type: 'select',
        default: 'relative',
        options: [
          { value: 'relative', label: 'Relative' },
          { value: 'absolute', label: 'Absolute' }
        ]
      }
    ],
    apply(img, params, mask) {
      applySelectiveColor(img, params, mask);
    }
  },
  vibrance: {
    label: 'Vibrance',
    fields: [{ key: 'amount', label: 'Amount', min: -100, max: 100, default: 0 }],
    apply(img, params, mask) {
      applyVibrance(img, params.amount, mask);
    }
  },
  threshold: {
    label: 'Threshold',
    fields: [{ key: 'level', label: 'Threshold Level', min: 1, max: 255, default: 128 }],
    apply(img, params, mask) {
      applyThreshold(img, params.level, mask);
    }
  },
  posterize: {
    label: 'Posterize',
    fields: [{ key: 'levels', label: 'Levels', min: 2, max: 255, step: 1, default: 4 }],
    apply(img, params, mask) {
      applyPosterize(img, params.levels, mask);
    }
  },
  pixelate: {
    label: 'Pixelate',
    fields: [{ key: 'block', label: 'Block size', min: 2, max: 64, default: 8 }],
    apply(img, params, mask) {
      applyPixelate(img, params.block, mask);
    }
  },
  invert: {
    label: 'Invert',
    fields: [],
    apply(img, params, mask) {
      applyInvert(img, mask);
    }
  },
  desaturate: {
    label: 'Desaturate',
    fields: [],
    apply(img, params, mask) {
      applyDesaturate(img, mask);
    }
  },
  shadowsHighlights: {
    label: 'Shadows/Highlights',
    fields: [
      ['shadowAmount', 'Shadows Amount (%)', 0, 100, 1],
      ['shadowTone', 'Shadows Tone (%)', 0, 100, 1],
      ['shadowRadius', 'Shadows Radius (px)', 0, 2500, 1],
      ['highlightAmount', 'Highlights Amount (%)', 0, 100, 1],
      ['highlightTone', 'Highlights Tone (%)', 0, 100, 1],
      ['highlightRadius', 'Highlights Radius (px)', 0, 2500, 1],
      ['color', 'Color', -100, 100, 1],
      ['midtone', 'Midtone', -100, 100, 1],
      ['blackClip', 'Black Clip (%)', 0, 50, 0.01],
      ['whiteClip', 'White Clip (%)', 0, 50, 0.01]
    ].map(([key, label, min, max, step]) => ({
      key,
      label,
      min,
      max,
      step,
      default: SHADOWS_HIGHLIGHTS_DEFAULTS[key]
    })),
    apply(img, params, mask) {
      applyShadowsHighlights(img, params, mask);
    }
  },
  replaceColor: {
    label: 'Replace Color',
    fields: [
      // PhotoCraft seeds the sampled color from the foreground (swatch 0).
      { key: 'color', label: 'Color', type: 'color', default: '#000000', swatch: 0 },
      { key: 'fuzziness', label: 'Fuzziness', min: 0, max: 200, default: 40 },
      { key: 'hue', label: 'Hue', min: -180, max: 180, default: 0 },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100, default: 0 },
      { key: 'lightness', label: 'Lightness', min: -100, max: 100, default: 0 }
    ],
    apply(img, params, mask) {
      applyReplaceColor(img, params, mask);
    }
  },
  equalize: {
    label: 'Equalize',
    fields: [],
    apply(img, params, mask) {
      applyEqualize(img, mask);
    }
  },
  // Layer › Matting (layer_menu_cmds.rs).
  defringe: {
    label: 'Defringe',
    fields: [{ key: 'width', label: 'Width', min: 1, max: 200, default: 1 }],
    apply(img, params, mask) {
      applyDefringe(img, Math.round(params.width), mask);
    }
  },
  removeBlackMatte: {
    label: 'Remove Black Matte',
    fields: [],
    apply(img, params, mask) {
      applyRemoveMatte(img, false, mask);
    }
  },
  removeWhiteMatte: {
    label: 'Remove White Matte',
    fields: [],
    apply(img, params, mask) {
      applyRemoveMatte(img, true, mask);
    }
  }
};
