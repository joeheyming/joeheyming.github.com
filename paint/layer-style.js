// Layer styles (PhotoCraft crates/compose effects.rs, doc effects.rs, engine layer_style.rs
// effect_defaults): live effects drawn from a layer's alpha at composite time.
//
// layer.styles is null or { enabled, fillOpacity?, <kind>? } for each of EFFECT_KINDS. Each effect
// is its params plus `enabled`; `enabled` on the record is the master switch Hide All Effects
// turns off (Effects::enabled); fillOpacity is Blending Options' Fill (Layer::fill_opacity). Colors are '#rrggbb', opacities and spread are percent, sizes are pixels,
// blend modes are BLEND_MODES values (layers.js).
//
// renderEffectParts splits a styled layer the way the compositor needs it: the exterior effects
// (Drop Shadow, Outer Glow, an outer bevel), which PhotoCraft blends onto the backdrop each in its
// own mode, and the body (the layer at its Fill with the overlays, Satin, the inner effects,
// Stroke, and an inner bevel). renderEffects puts the two together as one styled layer.

import { blendRgb } from './retouch.js';
import { DEFAULT_GRADIENT_STOPS, sampleStops } from './gradient-stops.js';
import { sampleOpacity } from './gradient-presets.js';

// The Layer Style dialog's list, in Photoshop's order (Bevel & Emboss, Stroke, …, Drop Shadow).
export const EFFECT_KINDS = [
  'bevelEmboss',
  'stroke',
  'innerShadow',
  'innerGlow',
  'satin',
  'colorOverlay',
  'gradientOverlay',
  'patternOverlay',
  'outerGlow',
  'dropShadow'
];

export const EFFECT_LABELS = {
  blendingOptions: 'Blending Options',
  bevelEmboss: 'Bevel & Emboss',
  stroke: 'Stroke',
  innerShadow: 'Inner Shadow',
  innerGlow: 'Inner Glow',
  satin: 'Satin',
  colorOverlay: 'Color Overlay',
  gradientOverlay: 'Gradient Overlay',
  patternOverlay: 'Pattern Overlay',
  outerGlow: 'Outer Glow',
  dropShadow: 'Drop Shadow'
};

// effect_defaults in PhotoCraft's engine layer_style.rs.
export const EFFECT_DEFAULTS = {
  dropShadow: {
    blendMode: 'multiply',
    color: '#000000',
    opacity: 75,
    angle: 120,
    distance: 5,
    spread: 0,
    size: 5
  },
  innerShadow: {
    blendMode: 'multiply',
    color: '#000000',
    opacity: 75,
    angle: 120,
    distance: 5,
    choke: 0,
    size: 5
  },
  outerGlow: { blendMode: 'screen', color: '#ffffbe', opacity: 75, spread: 0, size: 5, range: 50 },
  innerGlow: {
    blendMode: 'screen',
    color: '#ffffbe',
    opacity: 75,
    source: 'edge',
    choke: 0,
    size: 5,
    range: 50
  },
  stroke: { size: 1, position: 'inside', color: '#000000', opacity: 100 },
  colorOverlay: { blendMode: 'source-over', color: '#ff0000', opacity: 100 },
  // Stops are [location, '#rrggbb'] and opacityStops [location, alpha 0..1] (gradient-presets.js).
  gradientOverlay: {
    blendMode: 'source-over',
    opacity: 100,
    preset: 'Black, White',
    stops: [
      [0, '#000000'],
      [1, '#ffffff']
    ],
    opacityStops: [
      [0, 1],
      [1, 1]
    ],
    style: 'linear',
    angle: 90,
    scale: 100,
    reverse: false
  },
  // pattern is the tile { width, height, data: number[] } taken from Edit › Define Pattern.
  patternOverlay: { blendMode: 'source-over', opacity: 100, scale: 100, link: true, pattern: null },
  satin: {
    blendMode: 'multiply',
    color: '#000000',
    opacity: 50,
    angle: 19,
    distance: 11,
    size: 14,
    invert: true
  },
  bevelEmboss: {
    style: 'inner',
    technique: 'smooth',
    depth: 100,
    direction: 'up',
    size: 5,
    soften: 0,
    angle: 120,
    altitude: 30,
    highlightBlend: 'screen',
    highlightColor: '#ffffff',
    highlightOpacity: 75,
    shadowBlend: 'multiply',
    shadowColor: '#000000',
    shadowOpacity: 75
  }
};

// The dialog's controls per effect: [key, label, type, min, max, unit].
export const EFFECT_FIELDS = {
  blendingOptions: [
    ['blendMode', 'Blend Mode', 'blend'],
    ['opacity', 'Opacity', 'range', 0, 100, '%'],
    ['fillOpacity', 'Fill Opacity', 'range', 0, 100, '%']
  ],
  bevelEmboss: [
    ['style', 'Style', 'bevelStyle'],
    ['technique', 'Technique', 'technique'],
    ['depth', 'Depth', 'range', 1, 1000, '%'],
    ['direction', 'Direction', 'direction'],
    ['size', 'Size', 'range', 0, 250, 'px'],
    ['soften', 'Soften', 'range', 0, 16, 'px'],
    ['angle', 'Angle', 'range', -180, 180, '°'],
    ['altitude', 'Altitude', 'range', 0, 90, '°'],
    ['highlightBlend', 'Highlight Mode', 'blend'],
    ['highlightColor', 'Highlight Color', 'color'],
    ['highlightOpacity', 'Highlight Opacity', 'range', 0, 100, '%'],
    ['shadowBlend', 'Shadow Mode', 'blend'],
    ['shadowColor', 'Shadow Color', 'color'],
    ['shadowOpacity', 'Shadow Opacity', 'range', 0, 100, '%']
  ],
  dropShadow: [
    ['blendMode', 'Blend Mode', 'blend'],
    ['color', 'Color', 'color'],
    ['opacity', 'Opacity', 'range', 0, 100, '%'],
    ['angle', 'Angle', 'range', -180, 180, '°'],
    ['distance', 'Distance', 'range', 0, 300, 'px'],
    ['spread', 'Spread', 'range', 0, 100, '%'],
    ['size', 'Size', 'range', 0, 250, 'px']
  ],
  innerShadow: [
    ['blendMode', 'Blend Mode', 'blend'],
    ['color', 'Color', 'color'],
    ['opacity', 'Opacity', 'range', 0, 100, '%'],
    ['angle', 'Angle', 'range', -180, 180, '°'],
    ['distance', 'Distance', 'range', 0, 300, 'px'],
    ['choke', 'Choke', 'range', 0, 100, '%'],
    ['size', 'Size', 'range', 0, 250, 'px']
  ],
  outerGlow: [
    ['blendMode', 'Blend Mode', 'blend'],
    ['opacity', 'Opacity', 'range', 0, 100, '%'],
    ['color', 'Color', 'color'],
    ['spread', 'Spread', 'range', 0, 100, '%'],
    ['size', 'Size', 'range', 0, 250, 'px'],
    ['range', 'Range', 'range', 1, 100, '%']
  ],
  innerGlow: [
    ['blendMode', 'Blend Mode', 'blend'],
    ['opacity', 'Opacity', 'range', 0, 100, '%'],
    ['color', 'Color', 'color'],
    ['source', 'Source', 'source'],
    ['choke', 'Choke', 'range', 0, 100, '%'],
    ['size', 'Size', 'range', 0, 250, 'px'],
    ['range', 'Range', 'range', 1, 100, '%']
  ],
  satin: [
    ['blendMode', 'Blend Mode', 'blend'],
    ['color', 'Color', 'color'],
    ['opacity', 'Opacity', 'range', 0, 100, '%'],
    ['angle', 'Angle', 'range', -180, 180, '°'],
    ['distance', 'Distance', 'range', 1, 250, 'px'],
    ['size', 'Size', 'range', 0, 250, 'px'],
    ['invert', 'Invert', 'check']
  ],
  stroke: [
    ['size', 'Size', 'range', 1, 250, 'px'],
    ['position', 'Position', 'position'],
    ['color', 'Color', 'color'],
    ['opacity', 'Opacity', 'range', 0, 100, '%']
  ],
  colorOverlay: [
    ['blendMode', 'Blend Mode', 'blend'],
    ['color', 'Color', 'color'],
    ['opacity', 'Opacity', 'range', 0, 100, '%']
  ],
  gradientOverlay: [
    ['blendMode', 'Blend Mode', 'blend'],
    ['opacity', 'Opacity', 'range', 0, 100, '%'],
    ['preset', 'Gradient', 'gradient'],
    ['reverse', 'Reverse', 'check'],
    ['style', 'Style', 'gradientStyle'],
    ['angle', 'Angle', 'range', -180, 180, '°'],
    ['scale', 'Scale', 'range', 10, 150, '%']
  ],
  patternOverlay: [
    ['blendMode', 'Blend Mode', 'blend'],
    ['opacity', 'Opacity', 'range', 0, 100, '%'],
    ['scale', 'Scale', 'range', 1, 1000, '%'],
    ['link', 'Link with Layer', 'check']
  ]
};

export const STROKE_POSITIONS = [
  ['outside', 'Outside'],
  ['inside', 'Inside'],
  ['center', 'Center']
];

export const GLOW_SOURCES = [
  ['center', 'Center'],
  ['edge', 'Edge']
];

export const GRADIENT_STYLES = [
  ['linear', 'Linear'],
  ['radial', 'Radial'],
  ['angle', 'Angle'],
  ['reflected', 'Reflected'],
  ['diamond', 'Diamond']
];

export const BEVEL_STYLES = [
  ['outer', 'Outer Bevel'],
  ['inner', 'Inner Bevel'],
  ['emboss', 'Emboss'],
  ['pillow', 'Pillow Emboss']
];

export const BEVEL_TECHNIQUES = [
  ['smooth', 'Smooth'],
  ['chiselHard', 'Chisel Hard']
];

export const BEVEL_DIRECTIONS = [
  ['up', 'Up'],
  ['down', 'Down']
];

/** A new effect of kind with PhotoCraft's defaults, switched on. */
export function defaultEffect(kind) {
  return { enabled: true, ...EFFECT_DEFAULTS[kind] };
}

/**
 * A clean styles record from anything (a saved file, a clipboard copy): known effects only, each
 * filled out with its defaults, and Blending Options' fillOpacity (percent) when it is below 100.
 * Null when there is nothing to keep.
 */
export function normalizeStyles(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = { enabled: raw.enabled !== false };
  let any = false;
  const fill = Number(raw.fillOpacity);
  if (Number.isFinite(fill) && fill < 100) {
    out.fillOpacity = Math.max(0, fill);
    any = true;
  }
  for (const kind of EFFECT_KINDS) {
    const fx = raw[kind];
    if (!fx || typeof fx !== 'object') continue;
    out[kind] = { ...EFFECT_DEFAULTS[kind], ...fx, enabled: fx.enabled !== false };
    any = true;
  }
  return any ? out : null;
}

/** A deep copy of a styles record (or null). */
export function cloneStyles(styles) {
  return normalizeStyles(styles);
}

/** True when the layer has any effect, on or off (Copy / Clear Layer Style enable on this). */
export function hasLayerStyle(layer) {
  return !!layer?.styles && EFFECT_KINDS.some((k) => layer.styles[k]);
}

/** True when the layer draws effects: the master switch is on and one effect is (has_effects). */
export function hasActiveEffects(layer) {
  const s = layer?.styles;
  return !!s && s.enabled !== false && EFFECT_KINDS.some((k) => s[k]?.enabled);
}

/** Blending Options › Fill Opacity as 0..1: the layer's own pixels fade, its effects do not. */
export function fillOpacityOf(styles) {
  const v = Number(styles?.fillOpacity);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : 1;
}

/** True when compositing must go through renderEffectParts: live effects or a Fill below 100 %. */
export function drawsStyle(layer) {
  return hasActiveEffects(layer) || (canHaveStyle(layer) && fillOpacityOf(layer.styles) < 1);
}

// Layer styles sit on pixel and fill layers here; groups and adjustment layers have no alpha of
// their own.
export function canHaveStyle(layer) {
  return !!layer && ['pixel', 'fill'].includes(layer.kind ?? 'pixel');
}

/**
 * The Layers panel Fill: field (Layer::fill_opacity): f is 0..1, stored as styles.fillOpacity in
 * percent beside the effects. 100 % drops the key; a record left with nothing in it goes to null.
 */
export function setFillOpacity(layer, f) {
  const pct = Math.round(Math.min(1, Math.max(0, Number(f) || 0)) * 100);
  const styles = layer.styles ?? { enabled: true };
  if (pct < 100) styles.fillOpacity = pct;
  else delete styles.fillOpacity;
  layer.styles = 'fillOpacity' in styles || EFFECT_KINDS.some((k) => styles[k]) ? styles : null;
}

/** Paste Layer Style: copy (or Clear Layer Style when copy is null) onto the layers named by ids. */
export function setLayerStyles(layers, ids, styles) {
  const want = new Set(ids);
  let n = 0;
  for (const layer of layers) {
    if (!want.has(layer.id) || !canHaveStyle(layer)) continue;
    layer.styles = cloneStyles(styles);
    n++;
  }
  return n;
}

/** Hide All / Show All Effects: the master switch on every layer that has effects. */
export function setAllEffects(layers, on) {
  let n = 0;
  for (const layer of layers) {
    if (!hasLayerStyle(layer)) continue;
    layer.styles.enabled = on;
    n++;
  }
  return n;
}

// ── Rendering ────────────────────────────────────────────────────────────────

const INF = 1e20;

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// The shadow's offset away from the light: whole pixels, halves rounded away from zero (offset).
export function lightOffset(angle, distance) {
  const a = (angle * Math.PI) / 180;
  // The epsilon keeps a half that trigonometry left a hair short (−cos 120° × 5) a half.
  const round = (v) => Math.sign(v) * Math.round(Math.abs(v) + 1e-9);
  return [round(-Math.cos(a) * distance) || 0, round(Math.sin(a) * distance) || 0];
}

// Felzenszwalb's 1D squared distance transform of f (n samples) into d.
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Euclidean distance from each pixel to the nearest pixel where feature[p] is set. */
export function distanceTo(feature, W, H) {
  const n = Math.max(W, H);
  const f = new Float64Array(n),
    d = new Float64Array(n),
    z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const grid = new Float64Array(W * H);
  for (let p = 0; p < W * H; p++) grid[p] = feature[p] ? 0 : INF;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
  }
  return out;
}

// One running-sum box pass of radius r along rows (step 1) or columns (step W).
function boxPass(src, dst, W, H, r, horizontal) {
  const len = horizontal ? W : H,
    lines = horizontal ? H : W;
  const step = horizontal ? 1 : W;
  const span = 2 * r + 1;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * W : line;
    let sum = 0;
    for (let i = -r; i <= r; i++) if (i >= 0 && i < len) sum += src[base + i * step];
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = sum / span;
      const out = i - r,
        inn = i + r + 1;
      if (out >= 0) sum -= src[base + out * step];
      if (inn < len) sum += src[base + inn * step];
    }
  }
}

// The soft falloff of an effect of `size` pixels: two box passes of width size (a tent), as
// Photoshop does (effects.rs blur).
function tentBlur(m, W, H, size) {
  const r = Math.floor(size / 2);
  if (r <= 0) return m;
  const tmp = new Float32Array(m.length);
  for (let pass = 0; pass < 2; pass++) {
    boxPass(m, tmp, W, H, r, true);
    boxPass(tmp, m, W, H, r, false);
  }
  return m;
}

// Spread / choke of a soft effect (effects.rs spread_split): m grown by size × spread whole
// pixels, then softened by what is left of the size. m is W × H and is changed.
function spreadSoften(m, W, H, size, spread) {
  const r = Math.round(size * spread);
  if (r > 0) {
    const inside = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) inside[p] = m[p] >= 0.5 ? 1 : 0;
    const d = distanceTo(inside, W, H);
    for (let p = 0; p < W * H; p++) m[p] = Math.max(m[p], Math.min(1, Math.max(0, r + 1 - d[p])));
  }
  return tentBlur(m, W, H, size * (1 - spread));
}

const sizeOf = (fx) => Math.max(0, Number(fx.size) || 0);
const percent = (v, lo = 0) => Math.min(100, Math.max(lo, Number(v) || 0)) / 100;

// shape moved by (dx, dy) on a canvas grown by pad on every side, `outside` beyond the shape's
// own W × H (0 for the shape, 1 for its inverse).
function padShifted(shape, W, H, pad, dx, dy, invert) {
  const PW = W + 2 * pad,
    PH = H + 2 * pad;
  const m = new Float32Array(PW * PH).fill(invert ? 1 : 0);
  for (let y = 0; y < H; y++) {
    const py = y + pad + dy;
    if (py < 0 || py >= PH) continue;
    for (let x = 0; x < W; x++) {
      const px = x + pad + dx;
      if (px < 0 || px >= PW) continue;
      const a = shape[y * W + x];
      m[py * PW + px] = invert ? 1 - a : a;
    }
  }
  return m;
}

// The W × H middle of a map built on a grid grown by pad.
function unpad(m, W, H, pad) {
  if (pad === 0) return m;
  const PW = W + 2 * pad;
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    out.set(m.subarray((y + pad) * PW + pad, (y + pad) * PW + pad + W), y * W);
  return out;
}

// A soft map of the shape (or, for inner effects, of what lies outside it, the canvas beyond its
// edge included), shifted by (dx, dy), spread or choked, and blurred.
function softMap(shape, W, H, { dx = 0, dy = 0, size, spread, inner }) {
  const pad = inner ? Math.ceil(size) + Math.abs(dx) + Math.abs(dy) + 1 : 0;
  const m = padShifted(shape, W, H, pad, dx, dy, inner);
  spreadSoften(m, W + 2 * pad, H + 2 * pad, size, spread);
  return unpad(m, W, H, pad);
}

// Drop Shadow and Inner Shadow coverage: the shape (the inverse of the shape inside it) shifted
// away from the light, grown by the spread or choke, then softened (effects.rs shadow_map).
function shadowCoverage(shape, W, H, fx, inner = false) {
  const [dx, dy] = lightOffset(Number(fx.angle) || 0, Math.max(0, Number(fx.distance) || 0));
  const spread = percent(inner ? fx.choke : fx.spread);
  return softMap(shape, W, H, { dx, dy, size: sizeOf(fx), spread, inner });
}

// Outer Glow and Inner Glow coverage, Softer technique: the shape (outer) or its outside (inner)
// spread or choked and blurred by the size, then stretched by the Range (contour(min(v / range,
// 1)), Linear contour); a Center source is the edge glow inverted (effects.rs glow_map).
function glowCoverage(shape, W, H, fx, inner = false) {
  const spread = percent(inner ? fx.choke : fx.spread);
  const m = softMap(shape, W, H, { size: sizeOf(fx), spread, inner });
  const range = percent(fx.range ?? 50, 1);
  for (let p = 0; p < m.length; p++) {
    const v = Math.min(1, m[p] / range);
    m[p] = inner && fx.source === 'center' ? 1 - v : v;
  }
  return m;
}

// The stroke's coverage: a band `size` wide outside, inside, or centred on the shape's edge.
// `inner` is the band's coverage of the pixels inside the shape, relative to the shape (painted
// on the layer before its alpha applies); `outer` lies outside it, beneath the layer.
function strokeCoverage(shape, W, H, fx) {
  const size = Math.max(0, Number(fx.size) || 0);
  const [wIn, wOut] =
    fx.position === 'outside'
      ? [0, size]
      : fx.position === 'center'
      ? [size / 2, size / 2]
      : [size, 0];
  const inside = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) inside[p] = shape[p] >= 0.5 ? 1 : 0;
  const inner = new Float32Array(W * H);
  const outer = new Float32Array(W * H);
  if (wOut > 0) {
    const d = distanceTo(inside, W, H);
    for (let p = 0; p < W * H; p++)
      if (!inside[p]) outer[p] = Math.min(1, Math.max(0, wOut + 1 - d[p])) * (1 - shape[p]);
  }
  if (wIn > 0) {
    const outside = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) outside[p] = inside[p] ? 0 : 1;
    const d = distanceTo(outside, W, H);
    for (let p = 0; p < W * H; p++)
      if (inside[p]) inner[p] = Math.min(1, Math.max(0, wIn + 1 - d[p]));
  }
  return { inner, outer };
}

// ── Satin, Bevel & Emboss ────────────────────────────────────────────────────

// Satin (effects.rs satin_map, Linear contour): the shape shifted both ways along the angle by
// the distance, each blurred by the size, and their difference; Invert flips it. Relative to the
// shape (the caller paints it on pixels inside it only).
function satinCoverage(shape, W, H, fx) {
  const [dx, dy] = lightOffset(Number(fx.angle) || 0, Math.max(1, Number(fx.distance) || 0));
  const a = tentBlur(padShifted(shape, W, H, 0, dx, dy, false), W, H, sizeOf(fx));
  const b = tentBlur(padShifted(shape, W, H, 0, -dx, -dy, false), W, H, sizeOf(fx));
  const m = new Float32Array(W * H);
  for (let p = 0; p < m.length; p++) {
    const v = Math.min(1, Math.abs(a[p] - b[p]));
    m[p] = fx.invert ? 1 - v : v;
  }
  return m;
}

// Chiselled height from the distances inside / outside the edge (effects.rs bevel_chisel_h,
// Chisel Hard).
function chiselHeight(paint, size, din, dout) {
  const ramp = size + 1;
  if (paint === 'outer') {
    const top = (size + 2) / ramp;
    return dout > 0 ? Math.min(top, Math.max(0, (size + 1.5 - dout) / ramp)) : top;
  }
  if (paint === 'both') {
    const half = size / 2 + 0.5;
    return din > 0
      ? 0.5 + 0.5 * Math.min(1, din / half)
      : 0.5 - 0.5 * Math.min(1, Math.max(0, dout / half));
  }
  return din > 0 ? Math.min(1, (din + 0.5) / ramp) : 0;
}

/**
 * Bevel & Emboss shading (effects.rs bevel_geom / bevel_height / bevel_maps): a height field from
 * the layer's alpha (Smooth: the shape tent-blurred over the bevel width; Chisel Hard: ramps of
 * the distance to the edge), lit from angle / altitude. Returns { paint, hi, sh, hiOut, shOut }:
 * paint is 'inner', 'outer', or 'both' (the emboss styles); hi / sh cover the shape's inside
 * (relative to it), hiOut / shOut its outside. W × H Float32Arrays.
 */
export function bevelShading(shape, W, H, fx) {
  const size = Math.max(1, Number(fx.size) || 0);
  const paint = fx.style === 'outer' ? 'outer' : fx.style === 'inner' ? 'inner' : 'both';
  const width = paint === 'both' ? Math.ceil(size / 2) : size;
  const smooth = fx.technique !== 'chiselHard';
  const sign = fx.direction === 'down' ? -1 : 1;
  const depth = (Math.max(0, Number(fx.depth) || 0) / 100) * (smooth ? width : size / 2) * sign;
  // Built on a grid grown past the canvas, where everything counts as outside the shape.
  const pad = Math.ceil(size) + 2;
  const PW = W + 2 * pad,
    PH = H + 2 * pad;
  const s = padShifted(shape, W, H, pad, 0, 0, false);
  let h;
  if (smooth) {
    h = tentBlur(new Float32Array(s), PW, PH, width);
  } else {
    const inside = new Uint8Array(PW * PH);
    for (let p = 0; p < inside.length; p++) inside[p] = s[p] >= 0.5 ? 1 : 0;
    const outside = inside.map((v) => 1 - v);
    const dIn = distanceTo(outside, PW, PH),
      dOut = distanceTo(inside, PW, PH);
    h = new Float32Array(PW * PH);
    for (let p = 0; p < h.length; p++)
      h[p] = chiselHeight(paint, size, inside[p] ? dIn[p] - 0.5 : 0, inside[p] ? 0 : dOut[p] - 0.5);
  }
  const soften = Number(fx.soften) || 0;
  if (soften >= 1) tentBlur(h, PW, PH, soften);
  const a = ((Number(fx.angle) || 0) * Math.PI) / 180;
  const e = ((Number(fx.altitude) || 0) * Math.PI) / 180;
  const [se, ce] = [Math.sin(e), Math.cos(e)];
  const light = [Math.cos(a) * ce, -Math.sin(a) * ce, se];
  const at = (x, y) => (x < 0 || y < 0 || x >= PW || y >= PH ? 0 : h[y * PW + x]);
  const EPS = 1e-4;
  const reachPast = paint === 'both' || (paint === 'outer' && !smooth);
  const onBevel = (x, y) =>
    at(x, y) > EPS ||
    (reachPast &&
      (at(x + 1, y) > EPS || at(x - 1, y) > EPS || at(x, y + 1) > EPS || at(x, y - 1) > EPS));
  // One pair of maps lit with the given depth: inside (region = 1 where the shape is) or outside
  // (region = the bevel beyond the shape's opaque pixels).
  const shade = (d, outsideRegion) => {
    const hi = new Float32Array(W * H),
      sh = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const gx = x + pad,
          gy = y + pad;
        const q = gy * PW + gx;
        const region = outsideRegion
          ? s[q] < 1 - EPS && onBevel(gx, gy)
            ? 1
            : 0
          : s[q] > 0
          ? 1
          : 0;
        if (!region) continue;
        const nx = -(at(gx + 1, gy) - at(gx - 1, gy)) * 0.5 * d;
        const ny = -(at(gx, gy + 1) - at(gx, gy - 1)) * 0.5 * d;
        const k =
          (nx * light[0] + ny * light[1] + light[2]) / Math.sqrt(nx * nx + ny * ny + 1) - se;
        const p = y * W + x;
        if (k > 0) hi[p] = Math.min(1, k / Math.max(1e-3, 1 - se));
        else sh[p] = Math.min(1, -k / Math.max(1e-3, se));
      }
    }
    return [hi, sh];
  };
  const none = new Float32Array(W * H);
  if (paint === 'inner') {
    const [hi, sh] = shade(depth, false);
    return { paint, hi, sh, hiOut: none, shOut: none };
  }
  if (paint === 'outer') {
    const [hiOut, shOut] = shade(depth, true);
    return { paint, hi: none, sh: none, hiOut, shOut };
  }
  // Emboss: the inside half where the shape is, the outside half (Pillow: facing the other way)
  // for the rest of each pixel.
  const [hi, sh] = shade(depth, false);
  const [hiOut, shOut] = shade(fx.style === 'pillow' ? -depth : depth, true);
  for (let p = 0; p < W * H; p++) {
    const k = 1 - Math.min(1, shape[p]);
    hiOut[p] *= k;
    shOut[p] *= k;
  }
  return { paint, hi, sh, hiOut, shOut };
}

// ── Gradient Overlay, Pattern Overlay ────────────────────────────────────────

/** The bounding box [x0, y0, x1, y1) of the pixels where shape is above zero, or null. */
function shapeBounds(shape, W, H) {
  let x0 = W,
    y0 = H,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (shape[y * W + x] <= 0) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  return x0 < x1 ? [x0, y0, x1, y1] : null;
}

/**
 * PhotoCraft gradient_t: the gradient parameter 0..1 at pixel centre (x, y) inside bounds
 * [x0, y0, x1, y1) for a style ('linear', 'radial', 'angle', 'reflected', 'diamond'), an angle in
 * degrees (90 = bottom to top), and a scale (1 = 100 %).
 */
export function gradientT(style, angle, scale, reverse, bounds, x, y) {
  const [bx0, by0, bx1, by1] = bounds;
  const w = Math.max(1, bx1 - bx0),
    h = Math.max(1, by1 - by0);
  const dx = x - (bx0 + w / 2),
    dy = y - (by0 + h / 2);
  const rad = (angle * Math.PI) / 180;
  const [s, c] = [Math.sin(rad), Math.cos(rad)];
  const along = dx * c - dy * s;
  const across = dx * s + dy * c;
  const k = Math.max(1e-3, scale);
  const chord =
    Math.max(1, Math.min(w / Math.max(1e-6, Math.abs(c)), h / Math.max(1e-6, Math.abs(s)))) * k;
  const len = Math.max(1, Math.hypot(c * w, s * h)) * k;
  const corner = 0.5 * (c - s);
  let t;
  if (style === 'reflected') t = Math.abs((along - corner) / (chord / 2));
  else if (style === 'radial') t = Math.hypot(dx, dy) / (len / 2);
  else if (style === 'diamond') t = (Math.abs(along) + Math.abs(across)) / (len / 2);
  else if (style === 'angle') {
    const turn = (rad - Math.atan2(-dy, dx)) / (2 * Math.PI);
    t = turn - Math.floor(turn);
  } else t = (along - corner) / chord + 0.5;
  t = Math.min(1, Math.max(0, t));
  return reverse ? 1 - t : t;
}

// The color [r, g, b, a] 0..1 of a Gradient Overlay at t.
function gradientColorAt(fx, t) {
  const stops = Array.isArray(fx.stops) && fx.stops.length ? fx.stops : DEFAULT_GRADIENT_STOPS;
  const [r, g, b] = sampleStops(stops, t);
  const opacity = Array.isArray(fx.opacityStops) && fx.opacityStops.length ? fx.opacityStops : null;
  return [r, g, b, opacity ? sampleOpacity(opacity, t) : 1];
}

/** A pattern tile { width, height, data } as a plain, JSON-friendly copy for patternOverlay. */
export function patternSnapshot(tile) {
  if (!tile || !(tile.width > 0) || !(tile.height > 0)) return null;
  return { width: tile.width, height: tile.height, data: Array.from(tile.data) };
}

// ── Painting ─────────────────────────────────────────────────────────────────

/**
 * Paint an interior effect on lay (Float32Array RGBA 0..1, alpha relative to the shape): at each
 * pixel inside the shape, colorAt(p) ([r, g, b, a] 0..1) composited in `mode` at
 * k × cov[p] × a (cov null = 1), W3C compositing so a see-through Fill still takes the effect.
 */
function paintLay(lay, inside, colorAt, k, mode, cov = null) {
  const cb = [0, 0, 0];
  for (let p = 0, i = 0; p < inside.length; p++, i += 4) {
    if (!inside[p]) continue;
    const cs = colorAt(p);
    const as = k * (cov ? Math.min(1, Math.max(0, cov[p])) : 1) * cs[3];
    if (as <= 0) continue;
    const ab = lay[i + 3];
    for (let c = 0; c < 3; c++) cb[c] = lay[i + c];
    const b = mode === 'source-over' ? cs : blendRgb(mode, cb, cs);
    const ao = as + ab * (1 - as);
    for (let c = 0; c < 3; c++)
      lay[i + c] = (as * (1 - ab) * cs[c] + as * ab * b[c] + (1 - as) * ab * cb[c]) / ao;
    lay[i + 3] = ao;
  }
}

const unitRgba = (hex) => [...hexRgb(hex).map((v) => v / 255), 1];

// A solid color at coverage × k as its own image, for an exterior effect drawn on the backdrop.
function colorImage(W, H, cov, hex, opacity) {
  const rgb = hexRgb(hex);
  const k = percent(opacity);
  const image = makeImage(W, H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const a = Math.round(cov[p] * k * 255);
    if (a <= 0) continue;
    image.data[i] = rgb[0];
    image.data[i + 1] = rgb[1];
    image.data[i + 2] = rgb[2];
    image.data[i + 3] = a;
  }
  return image;
}

// Source-over of a solid color at per-pixel coverage × k onto straight RGBA bytes.
function paintOver(data, cov, rgb, k) {
  for (let p = 0, i = 0; i < data.length; p++, i += 4) {
    const as = cov[p] * k;
    if (as <= 0) continue;
    const ab = data[i + 3] / 255;
    const ao = as + ab * (1 - as);
    for (let c = 0; c < 3; c++)
      data[i + c] = Math.round((rgb[c] * as + data[i + c] * ab * (1 - as)) / ao);
    data[i + 3] = Math.round(ao * 255);
  }
}

function makeImage(W, H, data = new Uint8ClampedArray(W * H * 4)) {
  return { width: W, height: H, data };
}

// knock_out_exterior: an exterior effect stays behind the shape where its Fill is see-through.
function knockOut(cov, shape, fill) {
  if (fill >= 1) return cov;
  for (let p = 0; p < cov.length; p++) cov[p] *= 1 - shape[p] * (1 - fill);
  return cov;
}

/**
 * The styled layer in two parts: `under`, the exterior effects ([{ image, mode }], Drop Shadow,
 * Outer Glow, then an outer bevel's highlight and shadow), each drawn onto the backdrop in its
 * own blend mode beneath the layer, and `body`, the layer's pixels at its Fill Opacity with
 * Pattern, Gradient, and Color Overlay, Satin, Inner Glow, Inner Shadow, Stroke, then an inner
 * bevel painted on (compose effects.rs order). Effects keep their strength at any Fill.
 * img is { width, height, data } straight RGBA; it is not changed.
 */
export function renderEffectParts(img, styles) {
  const W = img.width,
    H = img.height;
  const s = normalizeStyles(styles);
  const fill = fillOpacityOf(s);
  const effects = !!s && s.enabled !== false;
  if (!effects && fill >= 1) {
    return { under: [], body: makeImage(W, H, new Uint8ClampedArray(img.data)) };
  }
  const N = W * H;
  const shape = new Float32Array(N);
  const inside = new Uint8Array(N);
  // lay: the layer's colors with alpha relative to its shape, Fill where it has pixels.
  const lay = new Float32Array(N * 4);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    shape[p] = img.data[i + 3] / 255;
    if (!img.data[i + 3]) continue;
    inside[p] = 1;
    for (let c = 0; c < 3; c++) lay[i + c] = img.data[i + c] / 255;
    lay[i + 3] = fill;
  }
  const on = (kind) => (effects && s[kind]?.enabled ? s[kind] : null);

  let fx = on('patternOverlay');
  const tile = fx?.pattern;
  if (tile?.width > 0 && tile?.height > 0 && tile.data?.length >= tile.width * tile.height * 4) {
    const scale = Math.max(0.01, (Number(fx.scale) || 100) / 100);
    const origin = fx.link === false ? [0, 0] : shapeBounds(shape, W, H) ?? [0, 0];
    const mod = (v, n) => ((v % n) + n) % n;
    paintLay(
      lay,
      inside,
      (p) => {
        const u = mod(Math.floor(((p % W) + 0.5 - origin[0]) / scale), tile.width);
        const v = mod(Math.floor((((p / W) | 0) + 0.5 - origin[1]) / scale), tile.height);
        const q = (v * tile.width + u) * 4;
        const d = tile.data;
        return [d[q] / 255, d[q + 1] / 255, d[q + 2] / 255, d[q + 3] / 255];
      },
      percent(fx.opacity),
      fx.blendMode || 'source-over'
    );
  }
  fx = on('gradientOverlay');
  const bounds = fx && shapeBounds(shape, W, H);
  if (bounds) {
    const angle = Number(fx.angle) || 0;
    const scale = (Number(fx.scale) || 100) / 100;
    paintLay(
      lay,
      inside,
      (p) => {
        const t = gradientT(
          fx.style,
          angle,
          scale,
          !!fx.reverse,
          bounds,
          (p % W) + 0.5,
          ((p / W) | 0) + 0.5
        );
        return gradientColorAt(fx, t);
      },
      percent(fx.opacity),
      fx.blendMode || 'source-over'
    );
  }
  if ((fx = on('colorOverlay'))) {
    const rgba = unitRgba(fx.color);
    paintLay(lay, inside, () => rgba, percent(fx.opacity), fx.blendMode || 'source-over');
  }
  if ((fx = on('satin'))) {
    const rgba = unitRgba(fx.color);
    const cov = satinCoverage(shape, W, H, fx);
    paintLay(lay, inside, () => rgba, percent(fx.opacity), fx.blendMode || 'multiply', cov);
  }
  for (const kind of ['innerGlow', 'innerShadow']) {
    if (!(fx = on(kind))) continue;
    const cov =
      kind === 'innerGlow'
        ? glowCoverage(shape, W, H, fx, true)
        : shadowCoverage(shape, W, H, fx, true);
    paintLay(lay, inside, () => unitRgba(fx.color), percent(fx.opacity), fx.blendMode, cov);
  }
  const stroke = on('stroke');
  const strokeCov = stroke && stroke.size > 0 ? strokeCoverage(shape, W, H, stroke) : null;
  if (strokeCov) {
    const rgba = unitRgba(stroke.color);
    paintLay(lay, inside, () => rgba, percent(stroke.opacity), 'source-over', strokeCov.inner);
  }
  const bevel = on('bevelEmboss');
  const shading = bevel && bevelShading(shape, W, H, bevel);
  if (shading && shading.paint !== 'outer') {
    const hi = unitRgba(bevel.highlightColor),
      sh = unitRgba(bevel.shadowColor);
    const hk = percent(bevel.highlightOpacity),
      sk = percent(bevel.shadowOpacity);
    paintLay(lay, inside, () => hi, hk, bevel.highlightBlend || 'screen', shading.hi);
    paintLay(lay, inside, () => sh, sk, bevel.shadowBlend || 'multiply', shading.sh);
  }

  // The shape's own alpha, then the outside of the stroke beneath it.
  const body = makeImage(W, H);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (!inside[p]) continue;
    for (let c = 0; c < 3; c++) body.data[i + c] = Math.round(lay[i + c] * 255);
    body.data[i + 3] = Math.round(lay[i + 3] * shape[p] * 255);
  }
  if (strokeCov)
    paintOver(body.data, strokeCov.outer, hexRgb(stroke.color), percent(stroke.opacity));

  const under = [];
  if ((fx = on('dropShadow'))) {
    const cov = knockOut(shadowCoverage(shape, W, H, fx), shape, fill);
    under.push({
      image: colorImage(W, H, cov, fx.color, fx.opacity),
      mode: fx.blendMode || 'multiply'
    });
  }
  if ((fx = on('outerGlow'))) {
    const cov = knockOut(glowCoverage(shape, W, H, fx), shape, fill);
    under.push({
      image: colorImage(W, H, cov, fx.color, fx.opacity),
      mode: fx.blendMode || 'screen'
    });
  }
  if (shading && shading.paint !== 'inner') {
    for (const [cov, color, opacity, mode] of [
      [
        shading.hiOut,
        bevel.highlightColor,
        bevel.highlightOpacity,
        bevel.highlightBlend || 'screen'
      ],
      [shading.shOut, bevel.shadowColor, bevel.shadowOpacity, bevel.shadowBlend || 'multiply']
    ])
      under.push({ image: colorImage(W, H, cov, color, opacity), mode });
  }
  return { under, body };
}

// Source-over of straight RGBA bytes s onto d.
function over(d, s) {
  for (let i = 0; i < d.length; i += 4) {
    const as = s[i + 3] / 255;
    if (as <= 0) continue;
    const ab = d[i + 3] / 255;
    const ao = as + ab * (1 - as);
    for (let c = 0; c < 3; c++)
      d[i + c] = Math.round((s[i + c] * as + d[i + c] * ab * (1 - as)) / ao);
    d[i + 3] = Math.round(ao * 255);
  }
}

/** The layer with its effects as one image: the exterior effects under the body (source-over). */
export function renderEffects(img, styles) {
  const { under, body } = renderEffectParts(img, styles);
  if (!under.length) return body;
  const out = makeImage(img.width, img.height);
  for (const part of [...under.map((u) => u.image), body]) over(out.data, part.data);
  return out;
}
