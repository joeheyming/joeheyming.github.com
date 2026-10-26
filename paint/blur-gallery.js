// Filter › Blur Gallery (PhotoCraft algo gallery.rs, ui-egui blur_pins.rs): Field Blur, Iris
// Blur, Tilt-Shift, and Spin Blur, edited with pins on the image. A gallery is
// { kind, bounds, pins, selected, drag }: bounds are the filter's (the selection's box, else the
// canvas), pin x / y are fractions of the bounds and radii / focus / transition are fractions of
// their shorter side, as the engine takes them.
//
// Field, Iris, and Tilt-Shift are a spatially varying Gaussian: blurWeightMap gives the σ at each
// pixel and variableBlur interpolates between a stack of Gaussian levels (0, then a geometric
// series up to the largest σ). Spin Blur turns the content inside each ellipse about its centre.

import { gaussBlurN, smoothstep } from './adjustments.js';

export const GALLERY_KINDS = {
  field: { label: 'Field Blur', command: 'filter.blurGallery.fieldBlur' },
  iris: { label: 'Iris Blur', command: 'filter.blurGallery.irisBlur' },
  tilt: { label: 'Tilt-Shift', command: 'filter.blurGallery.tiltShift' },
  spin: { label: 'Spin Blur', command: 'filter.blurGallery.spinBlur' }
};

// The side panel's sliders for the selected pin. scale maps the stored value to the slider.
const BLUR = { key: 'blur', label: 'Blur', min: 0, max: 500, scale: 1, unit: 'px' };
export const GALLERY_FIELDS = {
  field: [BLUR],
  iris: [
    BLUR,
    { key: 'feather', label: 'Feather', min: 0, max: 99, scale: 100, unit: '%' },
    { key: 'roundness', label: 'Roundness', min: 0, max: 100, scale: 1, unit: '' }
  ],
  tilt: [
    BLUR,
    { key: 'focus', label: 'Focus', min: 0, max: 100, scale: 100, unit: '%' },
    { key: 'transition', label: 'Transition', min: 1, max: 100, scale: 100, unit: '%' },
    { key: 'angle', label: 'Angle', min: -90, max: 90, scale: 1, unit: '°' }
  ],
  spin: [{ key: 'blur', label: 'Blur Angle', min: 0, max: 360, scale: 1, unit: '°' }]
};

const DEFAULT_BLUR = 15;
export const MAX_PINS = 64;
const LEVELS = 6;
// Screen sizes (CSS px): a pin's dot, how near a press grabs it, its ring, a shape handle, and
// how near a press must be to a Tilt-Shift line.
const DOT = 5;
const GRAB = 9;
const RING = 24;
const RING_BAND = 5;
const HANDLE = 4.5;
const LINE_GRAB = 5;
const MIN_RADIUS = 0.01;
const MAX_FEATHER = 0.99;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const RAD = Math.PI / 180;

/** Gaussian σ for a gallery blur amount in px (gallery.rs sigma_of). */
export const gallerySigma = (blur) => clamp(Number(blur) || 0, 0, 500) * 0.6;

const shortSide = (b) => Math.max(1, Math.min(b.x1 - b.x0, b.y1 - b.y0));

/** A pin's centre in image pixels. */
export const pinCentre = (p, b) => [b.x0 + p.x * (b.x1 - b.x0), b.y0 + p.y * (b.y1 - b.y0)];

/** The amount the ring sets: blur in px, or Spin's blur angle in degrees. */
export const amountMax = (kind) => (kind === 'spin' ? 360 : 500);

/** A fresh gallery: one pin in the middle of the bounds, selected (blur_pins.rs reset). */
export function newGallery(kind, bounds) {
  const pin = { x: 0.5, y: 0.5, blur: DEFAULT_BLUR };
  if (kind === 'iris') {
    Object.assign(pin, { rx: 0.35, ry: 0.25, angle: 0, roundness: 0, feather: 0.5 });
  }
  if (kind === 'spin') Object.assign(pin, { rx: 0.3, ry: 0.3, angle: 0 });
  if (kind === 'tilt') Object.assign(pin, { angle: 0, focus: 0.1, transition: 0.15 });
  return { kind, bounds: { ...bounds }, pins: [pin], selected: 0, drag: null };
}

// Rotated, normalized coordinates of (x, y) in a pin's ellipse, and its superellipse distance
// with exponent m (gallery.rs pin_distance / PreparedIris::sigma).
function ellipseDistance(p, b, x, y, m) {
  const ss = shortSide(b);
  const [cx, cy] = pinCentre(p, b);
  const s = Math.sin((p.angle || 0) * RAD);
  const c = Math.cos((p.angle || 0) * RAD);
  const dx = x - cx;
  const dy = y - cy;
  const u = (dx * c + dy * s) / (Math.max(p.rx, 1e-3) * ss);
  const v = (-dx * s + dy * c) / (Math.max(p.ry, 1e-3) * ss);
  const e =
    Math.abs(m - 2) < 1e-3 ? Math.hypot(u, v) : (Math.abs(u) ** m + Math.abs(v) ** m) ** (1 / m);
  return { e: Number.isFinite(e) ? e : Infinity, u, v };
}

const irisExponent = (p) => 2 + (clamp(p.roundness ?? 0, 0, 100) / 100) * 6;

/** Field Blur σ at (x, y): the pins' σ by inverse squared distance (gallery.rs field). */
export function fieldSigmaAt(pins, b, x, y) {
  if (!pins.length) return 0;
  let ws = 0;
  let s = 0;
  for (const p of pins) {
    const [px, py] = pinCentre(p, b);
    const w = 1 / ((x - px) ** 2 + (y - py) ** 2 + 1);
    ws += w;
    s += w * gallerySigma(p.blur);
  }
  return s / ws;
}

/** Iris Blur σ at (x, y): sharp inside each pin's core, full outside its shape; sharpest wins. */
export function irisSigmaAt(pins, b, x, y) {
  if (!pins.length) return 0;
  let best = Infinity;
  for (const p of pins) {
    const { e, u, v } = ellipseDistance(p, b, x, y, irisExponent(p));
    // Outside the normalized bounding square the distance is at least one.
    const d = Math.abs(u) >= 1 || Math.abs(v) >= 1 ? Infinity : e;
    const feather = clamp(p.feather ?? 0.5, 0, 0.999);
    best = Math.min(best, gallerySigma(p.blur) * smoothstep(feather, 1, d));
  }
  return best;
}

/** Tilt-Shift σ at (x, y): blur grows with distance past the focus band (gallery.rs tilt_shift). */
export function tiltSigmaAt(p, b, x, y) {
  const ss = shortSide(b);
  const [cx, cy] = pinCentre(p, b);
  const nx = Math.sin((p.angle || 0) * RAD);
  const ny = Math.cos((p.angle || 0) * RAD);
  const d = Math.abs((x - cx) * nx + (y - cy) * ny) / ss;
  const f0 = Math.max(0, p.focus);
  const f1 = f0 + Math.max(1e-3, p.transition);
  return gallerySigma(p.blur) * smoothstep(f0, f1, d);
}

/** Spin Blur's rim weight at (x, y) for one pin: 1 inside, feathered to 0 at the ellipse. */
export function spinWeightAt(p, b, x, y) {
  const { e } = ellipseDistance(p, b, x, y, 2);
  return e >= 1 ? 0 : 1 - smoothstep(0.85, 1, e);
}

/** The largest σ a gallery can ask for (0 for Spin, which is not a Gaussian). */
export function gallerySmax(g) {
  if (g.kind === 'spin') return 0;
  return g.pins.reduce((m, p) => Math.max(m, gallerySigma(p.blur)), 0);
}

/**
 * The per-pixel blur of a gallery over a W x H image, sampled at pixel centres: σ in px for
 * Field, Iris, and Tilt-Shift, and the turn in degrees (times the rim weight) for Spin.
 */
export function blurWeightMap(g, W, H) {
  const out = new Float32Array(W * H);
  const b = g.bounds;
  const pins = g.pins;
  if (!pins.length) return out;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const X = x + 0.5;
      const Y = y + 0.5;
      let v = 0;
      if (g.kind === 'field') v = fieldSigmaAt(pins, b, X, Y);
      else if (g.kind === 'iris') v = irisSigmaAt(pins, b, X, Y);
      else if (g.kind === 'tilt') v = tiltSigmaAt(pins[0], b, X, Y);
      else {
        for (const p of pins) {
          const w = spinWeightAt(p, b, X, Y);
          if (w > 0) {
            v = w * clamp(p.blur, 0, 360);
            break;
          }
        }
      }
      out[y * W + x] = v;
    }
  }
  return out;
}

// Premultiplied RGBA in 0..1.
function premultiplied(d) {
  const p = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    p[i] = (d[i] / 255) * a;
    p[i + 1] = (d[i + 1] / 255) * a;
    p[i + 2] = (d[i + 2] / 255) * a;
    p[i + 3] = a;
  }
  return p;
}

function writePremultiplied(d, i, r, g, b, a, k = 1) {
  const inv = a > 1e-7 ? 1 / a : 0;
  const out = [r * inv, g * inv, b * inv, a];
  for (let c = 0; c < 4; c++) {
    const v = clamp(out[c] * 255, 0, 255);
    d[i + c] = Math.round(d[i + c] + (v - d[i + c]) * k);
  }
}

/**
 * Blur imgData in place with σ per pixel (sigma from blurWeightMap, ≤ smax). Each pixel blends
 * the two Gaussian levels around its σ with hat weights (gallery.rs variable_blur). cache is an
 * optional Map of σ → blurred level, reused while the source stays the same.
 */
export function variableBlur(imgData, sigma, smax, mask = null, cache = null) {
  const W = imgData.width;
  const H = imgData.height;
  const d = imgData.data;
  if (!(smax >= 0.3)) return;
  const lv = [0];
  for (let k = 0; k < LEVELS; k++) lv.push(smax / 2 ** (LEVELS - 1 - k));
  const weight = (k, s) => {
    const c = lv[k];
    if (k > 0 && s >= lv[k - 1] && s <= c) {
      return (s - lv[k - 1]) / Math.max(c - lv[k - 1], 1e-6);
    }
    if (k + 1 < lv.length && s >= c && s <= lv[k + 1]) {
      return (lv[k + 1] - s) / Math.max(lv[k + 1] - c, 1e-6);
    }
    if (k + 1 === lv.length && s >= c) return 1;
    return 0;
  };
  const p = cache?.get('src') ?? premultiplied(d);
  cache?.set('src', p);
  const N = W * H;
  const sig = new Float32Array(N);
  for (let i = 0; i < N; i++) sig[i] = clamp(sigma[i], 0, smax);
  const acc = new Float32Array(N * 4);
  for (let k = 0; k < lv.length; k++) {
    let used = false;
    for (let i = 0; i < N && !used; i++) used = (!mask || mask[i]) && weight(k, sig[i]) > 0;
    if (!used) continue;
    let level = p;
    if (k > 0) {
      level = cache?.get(lv[k]);
      if (!level) {
        level = new Float32Array(p);
        gaussBlurN(level, W, H, 4, lv[k]);
        cache?.set(lv[k], level);
      }
    }
    for (let i = 0; i < N; i++) {
      const w = weight(k, sig[i]);
      if (w <= 0) continue;
      const o = i * 4;
      for (let c = 0; c < 4; c++) acc[o + c] += level[o + c] * w;
    }
  }
  for (let i = 0; i < N; i++) {
    if (mask && !mask[i]) continue;
    const o = i * 4;
    writePremultiplied(d, o, acc[o], acc[o + 1], acc[o + 2], acc[o + 3]);
  }
}

// Bilinear premultiplied sample at (x, y) inside the clip box (fxutil.rs add_sample_premul).
function addSample(src, W, x, y, clip, acc) {
  const fx = clamp(x - 0.5, clip.x0, clip.x1 - 1);
  const fy = clamp(y - 0.5, clip.y0, clip.y1 - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, clip.x1 - 1);
  const y1 = Math.min(y0 + 1, clip.y1 - 1);
  const ax = fx - x0;
  const ay = fy - y0;
  for (const [xx, yy, k] of [
    [x0, y0, (1 - ax) * (1 - ay)],
    [x1, y0, ax * (1 - ay)],
    [x0, y1, (1 - ax) * ay],
    [x1, y1, ax * ay]
  ]) {
    if (k <= 0) continue;
    const i = (yy * W + xx) * 4;
    const a = (src[i + 3] / 255) * k;
    acc[0] += (src[i] / 255) * a;
    acc[1] += (src[i + 1] / 255) * a;
    acc[2] += (src[i + 2] / 255) * a;
    acc[3] += a;
  }
}

/** Spin Blur in place: inside each pin's ellipse, average an arc of blur° about its centre. */
export function spinBlur(imgData, g, mask = null) {
  const W = imgData.width;
  const H = imgData.height;
  const d = imgData.data;
  const b = g.bounds;
  const clip = {
    x0: Math.max(0, b.x0),
    y0: Math.max(0, b.y0),
    x1: Math.min(W, b.x1),
    y1: Math.min(H, b.y1)
  };
  if (clip.x1 <= clip.x0 || clip.y1 <= clip.y0 || !g.pins.length) return;
  const src = new Uint8ClampedArray(d);
  const ss = shortSide(b);
  const acc = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask && !mask[y * W + x]) continue;
      const fx = x + 0.5;
      const fy = y + 0.5;
      for (const p of g.pins) {
        const { e, u, v } = ellipseDistance(p, b, fx, fy, 2);
        if (e >= 1) continue;
        const theta = clamp(p.blur, 0, 360) * RAD;
        const rpx = e * Math.max(p.rx, p.ry) * ss;
        const m = clamp(Math.ceil((theta * rpx) / 2), 2, 64);
        const [cx, cy] = pinCentre(p, b);
        const sa = Math.sin((p.angle || 0) * RAD);
        const ca = Math.cos((p.angle || 0) * RAD);
        acc.fill(0);
        for (let j = 0; j < m; j++) {
          const phi = theta * (j / (m - 1) - 0.5);
          const sp = Math.sin(phi);
          const cp = Math.cos(phi);
          const lu = (u * cp - v * sp) * p.rx * ss;
          const lv = (u * sp + v * cp) * p.ry * ss;
          addSample(src, W, cx + lu * ca - lv * sa, cy + lu * sa + lv * ca, clip, acc);
        }
        const k = 1 - smoothstep(0.85, 1, e);
        writePremultiplied(d, (y * W + x) * 4, acc[0] / m, acc[1] / m, acc[2] / m, acc[3] / m, k);
        break;
      }
    }
  }
}

/** Run a gallery on imgData in place, limited to mask (null = everywhere). */
export function applyBlurGallery(imgData, g, mask = null, cache = null) {
  if (g.kind === 'spin') {
    spinBlur(imgData, g, mask);
    return;
  }
  const sigma = blurWeightMap(g, imgData.width, imgData.height);
  variableBlur(imgData, sigma, gallerySmax(g), mask, cache);
}

// ── On-canvas editing (blur_pins.rs) ─────────────────────────────────────────

const cleanAngle = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const foldBand = (a) => {
  const t = cleanAngle(a);
  return t > 90 ? t - 180 : t < -90 ? t + 180 : t;
};

// Image-space point at normalized (u, v) of a pin's shape.
function shapePoint(p, b, u, v) {
  const ss = shortSide(b);
  const [cx, cy] = pinCentre(p, b);
  const s = Math.sin((p.angle || 0) * RAD);
  const c = Math.cos((p.angle || 0) * RAD);
  const lu = u * p.rx * ss;
  const lv = v * p.ry * ss;
  return [cx + lu * c - lv * s, cy + lu * s + lv * c];
}

/** Iris / Spin outline handles (local 0°, 90°, 180°, 270°), and Iris's four feather dots. */
export function shapeHandles(g, p) {
  const b = g.bounds;
  const outline = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1]
  ].map(([u, v]) => shapePoint(p, b, u, v));
  if (g.kind !== 'iris') return { outline, feather: [] };
  const f = (p.feather ?? 0.5) * Math.SQRT1_2;
  const feather = [
    [f, f],
    [-f, f],
    [-f, -f],
    [f, -f]
  ].map(([u, v]) => shapePoint(p, b, u, v));
  return { outline, feather };
}

/** Tilt-Shift's lines as signed offsets (px) from the centre, and the band's axes. */
export function tiltLines(g, p) {
  const ss = shortSide(g.bounds);
  const n = [Math.sin((p.angle || 0) * RAD), Math.cos((p.angle || 0) * RAD)];
  const along = [n[1], -n[0]];
  return { n, along, focus: p.focus * ss, transition: (p.focus + p.transition) * ss };
}

function setCentre(g, p, x, y) {
  const b = g.bounds;
  p.x = clamp((x - b.x0) / Math.max(1, b.x1 - b.x0), 0, 1);
  p.y = clamp((y - b.y0) / Math.max(1, b.y1 - b.y0), 0, 1);
}

// The grab under (x, y) on the selected pin, or null.
function hitSelected(g, x, y, zoom) {
  const p = g.pins[g.selected];
  if (!p) return null;
  const [cx, cy] = pinCentre(p, g.bounds);
  const near = (q, r) => Math.hypot(x - q[0], y - q[1]) <= r / zoom;
  if (g.kind === 'iris' || g.kind === 'spin') {
    const { outline, feather } = shapeHandles(g, p);
    const i = outline.findIndex((q) => near(q, HANDLE + 3));
    if (i >= 0) return { type: 'radius', handle: i };
    if (feather.some((q) => near(q, HANDLE + 3))) return { type: 'feather' };
  }
  if (g.kind === 'tilt') {
    const { n, focus, transition } = tiltLines(g, p);
    const dots = [1, -1].map((s) => [cx + n[0] * focus * s, cy + n[1] * focus * s]);
    if (dots.some((q) => near(q, HANDLE + 3))) return { type: 'turn' };
    const dist = Math.abs((x - cx) * n[0] + (y - cy) * n[1]);
    if (Math.abs(dist - focus) <= LINE_GRAB / zoom) return { type: 'focus' };
    if (Math.abs(dist - transition) <= LINE_GRAB / zoom) return { type: 'transition' };
  }
  const r = Math.hypot(x - cx, y - cy) * zoom;
  if (r > GRAB && Math.abs(r - RING) <= RING_BAND) {
    return { type: 'amount', last: Math.atan2(y - cy, x - cx), start: p.blur };
  }
  return null;
}

/**
 * Pointer events while the gallery owns the canvas. type is 'down' / 'move' / 'up', (x, y) in
 * image pixels, zoom the view scale (for screen-sized grab radii). Returns true when the pins
 * changed and the image needs rendering again.
 */
/**
 * Session pointer while Blur Gallery owns the canvas. ports: sync(g), render(), drawOverlay().
 */
export function blurGallerySessionPointer(session, type, x, y, zoom, ports = {}) {
  const changed = galleryPointer(session.g, type, x, y, zoom);
  if (type !== 'move' || changed) ports.sync?.(session.g);
  if (changed) ports.render?.();
  else ports.drawOverlay?.();
  return changed;
}

export function galleryPointer(g, type, x, y, zoom = 1) {
  if (type === 'up') {
    g.drag = null;
    return false;
  }
  if (type === 'down') {
    // A pin's dot first: select it and drag it.
    let best = -1;
    let bestD = GRAB / zoom;
    g.pins.forEach((p, i) => {
      const [px, py] = pinCentre(p, g.bounds);
      const dd = Math.hypot(x - px, y - py);
      if (dd <= bestD) {
        best = i;
        bestD = dd;
      }
    });
    if (best >= 0) {
      g.selected = best;
      const [px, py] = pinCentre(g.pins[best], g.bounds);
      g.drag = { type: 'move', dx: px - x, dy: py - y };
      return false;
    }
    // Then the selected pin's ring, shape handles, or band lines.
    const hit = hitSelected(g, x, y, zoom);
    if (hit) {
      g.drag = hit;
      return false;
    }
    // Tilt-Shift has one band: a press elsewhere drags it.
    if (g.kind === 'tilt') {
      const [px, py] = pinCentre(g.pins[0], g.bounds);
      g.drag = { type: 'move', dx: px - x, dy: py - y };
      return false;
    }
    if (g.pins.length >= MAX_PINS) return false;
    // A click elsewhere adds a pin with the selected one's settings.
    const pin = { ...(g.pins[g.selected] ?? newGallery(g.kind, g.bounds).pins[0]) };
    setCentre(g, pin, x, y);
    g.pins.push(pin);
    g.selected = g.pins.length - 1;
    g.drag = { type: 'move', dx: 0, dy: 0 };
    return true;
  }
  const drag = g.drag;
  const p = g.pins[g.selected];
  if (!drag || !p) return false;
  const [cx, cy] = pinCentre(p, g.bounds);
  const ss = shortSide(g.bounds);
  if (drag.type === 'move') setCentre(g, p, x + drag.dx, y + drag.dy);
  else if (drag.type === 'amount') {
    // One turn of the ring is the full range.
    const a = Math.atan2(y - cy, x - cx);
    let da = a - drag.last;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    drag.last = a;
    drag.start += (da / (2 * Math.PI)) * amountMax(g.kind);
    p.blur = Math.round(clamp(drag.start, 0, amountMax(g.kind)));
  } else if (drag.type === 'radius') {
    const r = clamp(Math.hypot(x - cx, y - cy) / ss, MIN_RADIUS, 1);
    if (drag.handle % 2 === 0) p.rx = r;
    else p.ry = r;
    // The handle follows the pointer round, turning the shape.
    const at = Math.atan2(y - cy, x - cx) / RAD - drag.handle * 90;
    p.angle = cleanAngle(at);
  } else if (drag.type === 'feather') {
    const { e } = ellipseDistance(p, g.bounds, x, y, irisExponent(p));
    p.feather = clamp(e, 0, MAX_FEATHER);
  } else if (drag.type === 'turn') {
    p.angle = foldBand(Math.atan2(x - cx, y - cy) / RAD);
  } else if (drag.type === 'focus' || drag.type === 'transition') {
    const { n } = tiltLines(g, p);
    const dist = Math.abs((x - cx) * n[0] + (y - cy) * n[1]) / ss;
    if (drag.type === 'focus') p.focus = clamp(dist, 0, 1);
    else p.transition = clamp(dist - p.focus, 0.01, 1);
  }
  return true;
}

/** Delete / Backspace: remove the selected pin (Tilt-Shift keeps its one band). */
export function removeSelectedPin(g) {
  if (g.kind === 'tilt' || !g.pins[g.selected]) return false;
  g.pins.splice(g.selected, 1);
  g.selected = Math.min(g.selected, g.pins.length - 1);
  return true;
}

/** Set a side-panel field on the selected pin (value in slider units). */
export function setGalleryField(g, key, value) {
  const p = g.pins[g.selected];
  const f = GALLERY_FIELDS[g.kind].find((x) => x.key === key);
  if (!p || !f) return false;
  p[key] = clamp(Number(value), f.min, f.max) / f.scale;
  return true;
}

// ── Overlay ──────────────────────────────────────────────────────────────────

function superellipsePath(ov, g, p) {
  const m = g.kind === 'iris' ? irisExponent(p) : 2;
  ov.beginPath();
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const u = Math.sign(c) * Math.abs(c) ** (2 / m);
    const v = Math.sign(s) * Math.abs(s) ** (2 / m);
    const [x, y] = shapePoint(p, g.bounds, u, v);
    if (i) ov.lineTo(x, y);
    else ov.moveTo(x, y);
  }
  ov.closePath();
}

function drawTilt(ov, g, p, lw) {
  const [cx, cy] = pinCentre(p, g.bounds);
  const { n, along, focus, transition } = tiltLines(g, p);
  const b = g.bounds;
  const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
  const line = (off, dashed) => {
    ov.setLineDash(dashed ? [6 * lw, 4 * lw] : []);
    ov.beginPath();
    ov.moveTo(cx + n[0] * off - along[0] * len, cy + n[1] * off - along[1] * len);
    ov.lineTo(cx + n[0] * off + along[0] * len, cy + n[1] * off + along[1] * len);
    ov.stroke();
  };
  for (const s of [1, -1]) {
    line(focus * s, false);
    line(transition * s, true);
  }
  ov.setLineDash([]);
  for (const s of [1, -1]) {
    ov.beginPath();
    ov.arc(cx + n[0] * focus * s, cy + n[1] * focus * s, HANDLE * lw, 0, 2 * Math.PI);
    ov.fill();
    ov.stroke();
  }
}

/** Draw the pins, the selected pin's ring and amount arc, and its shape handles. */
export function drawGallery(ov, g, zoom = 1) {
  const lw = 1 / zoom;
  ov.save();
  ov.lineWidth = lw;
  ov.strokeStyle = '#ffffff';
  ov.fillStyle = '#ffffff';
  g.pins.forEach((p, i) => {
    const [cx, cy] = pinCentre(p, g.bounds);
    const selected = i === g.selected;
    if (g.kind === 'tilt' && selected) drawTilt(ov, g, p, lw);
    if ((g.kind === 'iris' || g.kind === 'spin') && selected) {
      superellipsePath(ov, g, p);
      ov.stroke();
      const { outline, feather } = shapeHandles(g, p);
      const h = HANDLE * lw;
      for (const [x, y] of outline) {
        ov.fillRect(x - h, y - h, h * 2, h * 2);
        ov.strokeRect(x - h, y - h, h * 2, h * 2);
      }
      for (const [x, y] of feather) {
        ov.beginPath();
        ov.arc(x, y, h * 0.8, 0, 2 * Math.PI);
        ov.fill();
      }
    }
    if (selected) {
      ov.beginPath();
      ov.arc(cx, cy, RING * lw, 0, 2 * Math.PI);
      ov.stroke();
      // The arc is the amount: a full ring is the full range.
      const frac = clamp(p.blur / amountMax(g.kind), 0, 1);
      ov.save();
      ov.strokeStyle = '#378ef0';
      ov.lineWidth = 3 * lw;
      ov.beginPath();
      ov.arc(cx, cy, RING * lw, -Math.PI / 2, -Math.PI / 2 + frac * 2 * Math.PI);
      ov.stroke();
      ov.restore();
    }
    ov.beginPath();
    ov.arc(cx, cy, DOT * lw, 0, 2 * Math.PI);
    ov.fillStyle = selected ? '#378ef0' : '#ffffff';
    ov.fill();
    ov.strokeStyle = '#000000';
    ov.stroke();
    ov.strokeStyle = '#ffffff';
    ov.fillStyle = '#ffffff';
  });
  ov.restore();
}
