// Pure pixel adjustments — every function takes an ImageData and the params,
// and mutates the data in place. Caller is responsible for getImageData /
// putImageData and undo bookkeeping.

// ── Color-space helpers ──────────────────────────────────────────────────────

// Standard luminance for grayscale/desaturation (Rec.709).
const LUMA_R = 0.2126, LUMA_G = 0.7152, LUMA_B = 0.0722;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
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

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// ── Adjustments ──────────────────────────────────────────────────────────────

// Brightness in [-100, 100] — adds a constant to RGB.
export function applyBrightness(imgData, amount, mask = null) {
  const d = imgData.data;
  const add = amount * 2.55;
  const W = imgData.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    d[i]     = clamp(d[i]     + add);
    d[i + 1] = clamp(d[i + 1] + add);
    d[i + 2] = clamp(d[i + 2] + add);
  }
}

// Contrast in [-100, 100]. Standard sigmoid-free contrast formula.
export function applyContrast(imgData, amount, mask = null) {
  const d = imgData.data;
  const factor = (259 * (amount + 255)) / (255 * (259 - amount));
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    d[i]     = clamp(factor * (d[i]     - 128) + 128);
    d[i + 1] = clamp(factor * (d[i + 1] - 128) + 128);
    d[i + 2] = clamp(factor * (d[i + 2] - 128) + 128);
  }
}

// Hue (-180..180), Saturation (-100..100), Lightness (-100..100).
export function applyHueSatLight(imgData, hue, sat, light, mask = null) {
  const d = imgData.data;
  const hShift = hue / 360;
  const sScale = 1 + sat / 100;
  const lShift = light / 100;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    h = (h + hShift) % 1;
    if (h < 0) h += 1;
    s = Math.max(0, Math.min(1, s * sScale));
    l = Math.max(0, Math.min(1, l + lShift));
    const [r, g, b] = hslToRgb(h, s, l);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}

export function applyInvert(imgData, mask = null) {
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    d[i]     = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
}

export function applyGrayscale(imgData, mask = null) {
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    const y = d[i] * LUMA_R + d[i + 1] * LUMA_G + d[i + 2] * LUMA_B;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
}

export function applySepia(imgData, mask = null) {
  const d = imgData.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i]     = clamp(0.393 * r + 0.769 * g + 0.189 * b);
    d[i + 1] = clamp(0.349 * r + 0.686 * g + 0.168 * b);
    d[i + 2] = clamp(0.272 * r + 0.534 * g + 0.131 * b);
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

// Pixelate: average each NxN block. block=1 is a no-op.
export function applyPixelate(imgData, block, mask = null) {
  if (block <= 1) return;
  const d = imgData.data;
  const W = imgData.width, H = imgData.height;
  for (let by = 0; by < H; by += block) {
    for (let bx = 0; bx < W; bx += block) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const xMax = Math.min(bx + block, W), yMax = Math.min(by + block, H);
      for (let y = by; y < yMax; y++) {
        for (let x = bx; x < xMax; x++) {
          const i = (y * W + x) * 4;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++;
        }
      }
      r = r / n | 0; g = g / n | 0; b = b / n | 0; a = a / n | 0;
      for (let y = by; y < yMax; y++) {
        for (let x = bx; x < xMax; x++) {
          const i = (y * W + x) * 4, p = y * W + x;
          if (mask && !mask[p]) continue;
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
        }
      }
    }
  }
}

// ── Adjustments registry — drives the menu + dialog ──────────────────────────

export const ADJUSTMENTS = {
  brightness: {
    label: 'Brightness / Contrast',
    fields: [
      { key: 'brightness', label: 'Brightness', min: -100, max: 100, default: 0 },
      { key: 'contrast',   label: 'Contrast',   min: -100, max: 100, default: 0 },
    ],
    apply(img, params, mask) {
      applyBrightness(img, params.brightness, mask);
      applyContrast(img, params.contrast, mask);
    },
  },
  hsl: {
    label: 'Hue / Saturation',
    fields: [
      { key: 'hue',        label: 'Hue',        min: -180, max: 180, default: 0 },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100, default: 0 },
      { key: 'lightness',  label: 'Lightness',  min: -100, max: 100, default: 0 },
    ],
    apply(img, params, mask) {
      applyHueSatLight(img, params.hue, params.saturation, params.lightness, mask);
    },
  },
  threshold: {
    label: 'Threshold',
    fields: [
      { key: 'level', label: 'Level', min: 0, max: 255, default: 128 },
    ],
    apply(img, params, mask) {
      applyThreshold(img, params.level, mask);
    },
  },
  pixelate: {
    label: 'Pixelate',
    fields: [
      { key: 'block', label: 'Block size', min: 2, max: 64, default: 8 },
    ],
    apply(img, params, mask) {
      applyPixelate(img, params.block, mask);
    },
  },
  invert: {
    label: 'Invert',
    fields: [],
    apply(img, params, mask) { applyInvert(img, mask); },
  },
  grayscale: {
    label: 'Grayscale',
    fields: [],
    apply(img, params, mask) { applyGrayscale(img, mask); },
  },
  sepia: {
    label: 'Sepia',
    fields: [],
    apply(img, params, mask) { applySepia(img, mask); },
  },
};
