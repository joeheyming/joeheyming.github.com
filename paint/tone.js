// Image › Adjustments that need more than a per-pixel formula: Shadows/Highlights, Replace Color
// and Equalize (PhotoCraft algo tone.rs, tone/shadows_highlights.rs, engine extra_cmds.rs
// equalize). Each takes RGBA bytes, works in straight 0..1 floats, and writes only pixels where
// mask is null or mask[p] is set; neighbourhoods and histograms read the whole image (or, for
// Equalize, the selected pixels), as PhotoCraft's rgba_edit / map_pixels do.

import { gaussBlurN } from './adjustments.js';

const W = [0.299, 0.587, 0.114];

function luma(r, g, b) {
  return W[0] * r + W[1] * g + W[2] * b;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const level = (v) => Math.round(clamp01(v) * 255);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ── Equalize ─────────────────────────────────────────────────────────────────

// One CDF over the R, G and B values of the selected, non-transparent pixels, applied to every
// channel; the first occupied level maps to 0 and the last to 1.
export function applyEqualize(imgData, mask = null) {
  const d = imgData.data;
  const n = d.length >> 2;
  const hist = new Float64Array(256);
  for (let p = 0; p < n; p++) {
    if ((mask && !mask[p]) || d[p * 4 + 3] === 0) continue;
    hist[d[p * 4]]++;
    hist[d[p * 4 + 1]]++;
    hist[d[p * 4 + 2]]++;
  }
  let total = 0;
  for (const h of hist) total += h;
  if (total === 0) return;
  const first = hist.find((h) => h > 0) ?? 0;
  const lut = new Uint8ClampedArray(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    lut[i] = total > first ? Math.round(clamp01((acc - first) / (total - first)) * 255) : i;
  }
  for (let p = 0; p < n; p++) {
    if (mask && !mask[p]) continue;
    const i = p * 4;
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

// ── Replace Color ────────────────────────────────────────────────────────────

// PhotoCraft other2.rs rgb_to_hsl / hsl_to_rgb (all 0..1).
function hue(r, g, b, mx, dd) {
  if (dd <= 0) return 0;
  let h;
  if (mx === r) h = ((((g - b) / dd) % 6) + 6) % 6;
  else if (mx === g) h = (b - r) / dd + 2;
  else h = (r - g) / dd + 4;
  return h / 6;
}

export function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  const dd = mx - mn;
  const l = (mx + mn) / 2;
  const s = dd <= 0 ? 0 : dd / Math.max(1 - Math.abs(2 * l - 1), 1e-7);
  return [hue(r, g, b, mx, dd), clamp01(s), l];
}

export function hslToRgb(h, s, l) {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const m = l - chroma / 2;
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

function hexToUnit(hex) {
  const v = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// Select › Color Range's match (PhotoCraft selection.rs color_range): 1 at the color, falling to
// 0 when the largest channel difference reaches Fuzziness + 1 levels; transparent pixels are 0.
export function colorRangeMatch(r, g, b, a, color, fuzziness) {
  if (a <= 0) return 0;
  const f = Math.max(0, fuzziness) + 1;
  const dd = Math.max(
    Math.abs(r - color[0]) * 255,
    Math.abs(g - color[1]) * 255,
    Math.abs(b - color[2]) * 255
  );
  return clamp01(1 - dd / f);
}

// The hue (±180°), saturation and lightness (±100) shift of one color (tone.rs
// replace_color_masked): up moves toward 1, down toward 0.
export function replaceColorShift(c, hueShift, saturation, lightness) {
  const [hh, ss, ll] = rgbToHsl(c[0], c[1], c[2]);
  const s = saturation >= 0 ? ss + ((1 - ss) * saturation) / 100 : ss * (1 + saturation / 100);
  const l = lightness >= 0 ? ll + ((1 - ll) * lightness) / 100 : ll * (1 + lightness / 100);
  return hslToRgb((((hh + hueShift / 360) % 1) + 1) % 1, clamp01(s), clamp01(l));
}

// params: color '#rrggbb', fuzziness 0..200, hue −180..180, saturation / lightness −100..100.
export function applyReplaceColor(imgData, params = {}, mask = null) {
  const color = hexToUnit(params.color ?? '#000000');
  const fuzz = Math.min(200, Math.max(0, num(params.fuzziness, 40)));
  const h = Math.min(180, Math.max(-180, num(params.hue, 0)));
  const sat = Math.min(100, Math.max(-100, num(params.saturation, 0)));
  const lig = Math.min(100, Math.max(-100, num(params.lightness, 0)));
  const d = imgData.data;
  for (let p = 0, i = 0; i < d.length; p++, i += 4) {
    if (mask && !mask[p]) continue;
    const c = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
    const k = colorRangeMatch(c[0], c[1], c[2], d[i + 3] / 255, color, fuzz);
    if (k <= 0) continue;
    const o = replaceColorShift(c, h, sat, lig);
    for (let ch = 0; ch < 3; ch++)
      d[i + ch] = Math.round(clamp01(c[ch] + (o[ch] - c[ch]) * k) * 255);
  }
}

// ── Shadows/Highlights ───────────────────────────────────────────────────────

const SPATIAL = 1.1424;
const GUIDE = 1.3559;
const RANGE = 1.0152;
const LEVELS = 17;

// Edge-aware neighbourhood brightness of lum (w × h) for Radius: a piecewise-linear bilateral
// average (Durand and Dorsey) on a grid d times coarser.
function neighbourhood(lum, w, h, radius) {
  const guide = Float32Array.from(lum);
  gaussBlurN(guide, w, h, 1, GUIDE);
  const sigma = SPATIAL * radius;
  if (sigma < 0.3) return guide;
  const dd = Math.max(1, Math.floor(sigma / 4));
  const rw = Math.ceil(w / dd),
    rh = Math.ceil(h / dd);
  const cells = rw * rh;
  const step = 1 / (LEVELS - 1);
  const avg = new Float32Array(LEVELS * cells);
  const buf = new Float32Array(2 * cells);
  for (let k = 0; k < LEVELS; k++) {
    const g = k * step;
    buf.fill(0);
    for (let i = 0; i < lum.length; i++) {
      const l = lum[i];
      const wgt = Math.max(0, 1 - Math.abs(l - g) / RANGE);
      const c = 2 * (Math.floor(Math.floor(i / w) / dd) * rw + Math.floor((i % w) / dd));
      buf[c] += wgt * l;
      buf[c + 1] += wgt;
    }
    gaussBlurN(buf, rw, rh, 2, sigma / dd);
    for (let c = 0; c < cells; c++) {
      avg[k * cells + c] = buf[2 * c + 1] > 1e-6 ? buf[2 * c] / buf[2 * c + 1] : g;
    }
  }
  const out = new Float32Array(lum.length);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) / dd - 0.5, 0), rh - 1);
    const y0 = Math.floor(fy),
      ty = fy - y0,
      y1 = Math.min(y0 + 1, rh - 1);
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max((x + 0.5) / dd - 0.5, 0), rw - 1);
      const x0 = Math.floor(fx),
        tx = fx - x0,
        x1 = Math.min(x0 + 1, rw - 1);
      const at = (k) => {
        const o = k * cells;
        const top = avg[o + y0 * rw + x0] + (avg[o + y0 * rw + x1] - avg[o + y0 * rw + x0]) * tx;
        const bot = avg[o + y1 * rw + x0] + (avg[o + y1 * rw + x1] - avg[o + y1 * rw + x0]) * tx;
        return top + (bot - top) * ty;
      };
      const t = Math.min(clamp01(guide[y * w + x]) / step, LEVELS - 1 - 1e-4);
      const k = Math.floor(t);
      const f = t - k;
      out[y * w + x] = at(k) * (1 - f) + at(k + 1) * f;
    }
  }
  return out;
}

// Beta(α, β) of the tonal mask for Tone 0, 5, …, 95.
const MASK_BETA = [
  [1.9468, 22.9366],
  [1.777, 18.3471],
  [1.6403, 14.7559],
  [1.527, 11.9346],
  [1.4269, 9.6467],
  [1.347, 7.843],
  [1.2807, 6.4038],
  [1.224, 5.2384],
  [1.1772, 4.2967],
  [1.1373, 3.535],
  [1.1021, 2.9109],
  [1.0755, 2.4186],
  [1.0508, 2.0189],
  [1.0307, 1.7034],
  [1.014, 1.4583],
  [1.0015, 1.2758],
  [1.0, 1.1403],
  [1.0, 1.051],
  [1.0, 1.0002],
  [1.0, 1.0]
];

// The tonal mask for tone (0..100) at the 256 neighbourhood levels: 1 − I_L(α, β).
export function tonalMask(tone) {
  const t = Math.min(Math.max(tone, 0), 95) / 5;
  const i = Math.min(Math.floor(t), MASK_BETA.length - 2);
  const f = t - i;
  const [a0, b0] = MASK_BETA[i];
  const [a1, b1] = MASK_BETA[i + 1];
  const a = a0 + (a1 - a0) * f,
    b = b0 + (b1 - b0) * f;
  const SUB = 16;
  const n = 255 * SUB;
  const cum = new Float64Array(256);
  let acc = 0;
  for (let j = 0; j < n; j++) {
    const x = (j + 0.5) / n;
    acc += Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x));
    if ((j + 1) % SUB === 0) cum[(j + 1) / SUB] = acc;
  }
  const total = Math.max(acc, Number.MIN_VALUE);
  return Float32Array.from(cum, (c) => 1 - c / total);
}

// Curve strength for Amount (0..100): 0 at 0, 1 near 15, 2 at 50, 3 at 100.
function strength(amount) {
  const u = Math.pow(Math.min(Math.max(amount, 0), 100) / 100, 0.6216);
  return u <= 0.3 ? u / 0.3 : (1 + 20 * u) / 7;
}

// 1 − (1 − v)^q blended between q = 2^⌊s⌋ and 2^(⌊s⌋+1).
function lift(s, v) {
  const n = Math.min(Math.max(Math.floor(s), 0), 2);
  const t = clamp01(s - n);
  const lo = Math.pow(clamp01(1 - v), 1 << n);
  return 1 - ((1 - t) * lo + t * lo * lo);
}

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [xa, ya] = table[i - 1],
      [xb, yb] = table[i];
    if (x <= xb) return ya + ((yb - ya) * (x - xa)) / (xb - xa);
  }
  return table[table.length - 1][1];
}

const COLOR_UP = [
  [0, 0],
  [1, 0.1566],
  [2, 0.2271],
  [5, 0.3776],
  [10, 0.5653],
  [20, 0.8669],
  [30, 1.1299],
  [40, 1.3748],
  [50, 1.6093],
  [60, 1.8375],
  [75, 2.1721],
  [100, 2.7193]
];
const COLOR_DOWN = [
  [0, 0],
  [1, -0.0145],
  [5, -0.0709],
  [10, -0.1373],
  [20, -0.257],
  [30, -0.3612],
  [50, -0.5312],
  [75, -0.6866],
  [100, -0.7968]
];
// Midtone: (value, k, p) of k · (Y − ½) · (4Y(1 − Y))^p.
const MIDTONE = [
  [-100, -0.6955, 2.267],
  [-75, -0.5873, 2.362],
  [-50, -0.4429, 2.492],
  [-25, -0.2514, 2.667],
  [-10, -0.1088, 2.803],
  [0, 0, 2.9],
  [10, 0.1206, 3.016],
  [25, 0.3262, 3.216],
  [50, 0.7423, 3.625],
  [75, 1.2635, 4.16],
  [100, 1.9032, 4.85]
];
const MIDTONE_K = MIDTONE.map((r) => [r[0], r[1]]);
const MIDTONE_P = MIDTONE.map((r) => [r[0], r[2]]);

function midtone(m, y) {
  if (m === 0) return y;
  const k = interp(MIDTONE_K, m),
    p = interp(MIDTONE_P, m);
  return clamp01(y + k * (y - 0.5) * Math.pow(Math.max(0, 4 * y * (1 - y)), p));
}

// Black and White Clip: stretch the new luma so black% of pixels reach 0 and white% reach 1.
function clipLevels(y2, alpha, black, white) {
  if (black <= 0 && white <= 0) return;
  const hist = new Uint32Array(4096);
  let n = 0;
  for (let i = 0; i < y2.length; i++) {
    if (alpha[i * 4 + 3] > 0) {
      hist[Math.round(clamp01(y2[i]) * 4095)]++;
      n++;
    }
  }
  if (n === 0) return;
  const find = (pct, rev) => {
    const target = Math.floor((Math.min(Math.max(pct, 0), 50) / 100) * n);
    let acc = 0;
    for (let k = 0; k < 4096; k++) {
      const i = rev ? 4095 - k : k;
      acc += hist[i];
      if (acc > target) return i / 4095;
    }
    return rev ? 0 : 1;
  };
  const lo = black > 0 ? find(black, false) : 0;
  const hi = white > 0 ? find(white, true) : 1;
  if (hi - lo < 1e-3) return;
  for (let i = 0; i < y2.length; i++) y2[i] = clamp01((y2[i] - lo) / (hi - lo));
}

export const SHADOWS_HIGHLIGHTS_DEFAULTS = Object.freeze({
  shadowAmount: 35,
  shadowTone: 50,
  shadowRadius: 30,
  highlightAmount: 0,
  highlightTone: 50,
  highlightRadius: 30,
  color: 20,
  midtone: 0,
  blackClip: 0.01,
  whiteClip: 0.01
});

// params: SHADOWS_HIGHLIGHTS_DEFAULTS' keys (PhotoCraft's shadowAmount … whiteClip).
export function applyShadowsHighlights(imgData, params = {}, mask = null) {
  const P = (k, lo, hi) =>
    Math.min(hi, Math.max(lo, num(params[k], SHADOWS_HIGHLIGHTS_DEFAULTS[k])));
  const sa = P('shadowAmount', 0, 100),
    ha = P('highlightAmount', 0, 100);
  const sr = P('shadowRadius', 0, 2500),
    hr = P('highlightRadius', 0, 2500);
  const color = P('color', -100, 100),
    mid = P('midtone', -100, 100);
  const { width: w, height: h, data: d } = imgData;
  const n = w * h;
  if (n === 0) return;
  const lum = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = d[i] / 255,
      g = d[i + 1] / 255,
      b = d[i + 2] / 255;
    lum[p] = (Math.max(r, g, b) + luma(r, g, b)) / 2;
  }
  const ls = sa > 0 ? neighbourhood(lum, w, h, sr) : null;
  const lh = ha > 0 ? (ls && Math.abs(hr - sr) < 1e-3 ? ls : neighbourhood(lum, w, h, hr)) : null;
  const ms = tonalMask(P('shadowTone', 0, 100)),
    mh = tonalMask(P('highlightTone', 0, 100));
  const ss = strength(sa),
    hs = strength(ha);
  const y2 = new Float32Array(n);
  const adj = [0, 0, 0],
    q = [0, 0, 0];
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    for (let c = 0; c < 3; c++) q[c] = adj[c] = d[i + c] / 255;
    if (ls) {
      const m = ms[level(ls[p])];
      for (let c = 0; c < 3; c++) adj[c] += m * (lift(ss, adj[c]) - adj[c]);
    }
    if (lh) {
      const m = mh[255 - level(lh[p])];
      for (let c = 0; c < 3; c++) adj[c] -= m * (lift(hs, 1 - q[c]) - (1 - q[c]));
    }
    y2[p] = midtone(mid, clamp01(luma(adj[0], adj[1], adj[2])));
  }
  clipLevels(y2, d, P('blackClip', 0, 50), P('whiteClip', 0, 50));
  const gain = (f) =>
    color >= 0 ? Math.exp(interp(COLOR_UP, color) * f) : 1 + interp(COLOR_DOWN, -color) * f;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if ((mask && !mask[p]) || d[i + 3] === 0) continue;
    const r = d[i] / 255,
      g = d[i + 1] / 255,
      b = d[i + 2] / 255;
    const y1 = luma(r, g, b);
    const yn = y2[p];
    const gn = gain(Math.abs(yn - y1) / Math.max(yn, y1, 1e-6));
    const dr = (r - y1) * gn,
      dg = (g - y1) * gn,
      db = (b - y1) * gn;
    // Shorten the color difference where it would leave 0..1.
    let k = 1;
    for (const v of [dr, dg, db]) {
      if (v > 1e-9) k = Math.min(k, (1 - yn) / v);
      else if (v < -1e-9) k = Math.min(k, yn / -v);
    }
    k = clamp01(k);
    d[i] = Math.round(clamp01(yn + k * dr) * 255);
    d[i + 1] = Math.round(clamp01(yn + k * dg) * 255);
    d[i + 2] = Math.round(clamp01(yn + k * db) * 255);
  }
}
