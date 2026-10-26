// Image › Image Size… (PhotoCraft sizing.rs image_size, algo resample.rs). Pure helpers: the
// separable resampler and the dialog's unit and Constrain Proportions math.

/** The Resample choices the dialog lists (PhotoCraft's labels). */
export const RESAMPLE_METHODS = [
  { value: 'bicubic', label: 'Bicubic (smooth gradients)' },
  { value: 'nearest', label: 'Nearest Neighbor (hard edges)' },
  { value: 'bilinear', label: 'Bilinear' }
];

/** Width / Height units. */
export const SIZE_UNITS = [
  { value: 'px', label: 'Pixels' },
  { value: 'percent', label: 'Percent' }
];

// Keys cubic at a = −0.5 (Catmull-Rom).
function cubicWeight(x) {
  x = Math.abs(x);
  if (x < 1) return 1.5 * x * x * x - 2.5 * x * x + 1;
  if (x < 2) return -0.5 * (x * x * x - 5 * x * x + 8 * x - 4);
  return 0;
}

const clampIndex = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);

// Each output sample's source taps along one axis: { idx: Int32Array, w: Float32Array } per
// output, source indices clamped so the image repeats its edge.
function axisTaps(n, m, kernel) {
  const s = m / n;
  const taps = [];
  for (let o = 0; o < m; o++) {
    const idx = [];
    const w = [];
    if (kernel === 'box') {
      // The plain average of the source span output o covers.
      const a = o / s;
      const b = (o + 1) / s;
      for (let i = Math.floor(a); i < Math.ceil(b); i++) {
        const cover = Math.min(b, i + 1) - Math.max(a, i);
        if (cover > 0) {
          idx.push(clampIndex(i, n));
          w.push(cover * s);
        }
      }
    } else {
      const u = Math.min(Math.max((o + 0.5) / s - 0.5, 0), n - 1);
      if (kernel === 'nearest') {
        idx.push(clampIndex(Math.floor((o + 0.5) / s), n));
        w.push(1);
      } else if (kernel === 'bilinear') {
        const j = Math.floor(u);
        idx.push(j, clampIndex(j + 1, n));
        w.push(1 - (u - j), u - j);
      } else {
        const j = Math.floor(u);
        let sum = 0;
        for (let i = j - 1; i <= j + 2; i++) {
          const k = cubicWeight(u - i);
          idx.push(clampIndex(i, n));
          w.push(k);
          sum += k;
        }
        for (let k = 0; k < w.length; k++) w[k] /= sum;
      }
    }
    taps.push({ idx: Int32Array.from(idx), w: Float32Array.from(w) });
  }
  return taps;
}

// The passes one axis takes from n to m samples. Reducing by more than 2× box-prefilters:
// Bilinear averages straight to the target, Bicubic averages to twice the target first.
function axisPlan(n, m, method) {
  if (n === m) return [];
  if (method === 'nearest' || m * 2 >= n) return [[n, m, method]];
  if (method === 'bilinear') return [[n, m, 'box']];
  return [
    [n, 2 * m, 'box'],
    [2 * m, m, 'bicubic']
  ];
}

// One separable pass over premultiplied RGBA floats.
function pass(buf, W, H, n, m, kernel, horizontal) {
  const taps = axisTaps(n, m, kernel);
  const OW = horizontal ? m : W;
  const OH = horizontal ? H : m;
  const out = new Float32Array(OW * OH * 4);
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const t = taps[horizontal ? x : y];
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let k = 0; k < t.idx.length; k++) {
        const i = (horizontal ? y * W + t.idx[k] : t.idx[k] * W + x) * 4;
        const wk = t.w[k];
        r += buf[i] * wk;
        g += buf[i + 1] * wk;
        b += buf[i + 2] * wk;
        a += buf[i + 3] * wk;
      }
      const o = (y * OW + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
}

/**
 * Resample img to newW × newH px with 'nearest', 'bilinear', or 'bicubic' (Keys a = −0.5),
 * separably and in premultiplied alpha, repeating edge pixels. Nearest copies exact colors.
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
export function resample(img, newW, newH, method = 'bicubic') {
  const { width: W, height: H, data } = img;
  const w = Math.max(1, Math.round(newW));
  const h = Math.max(1, Math.round(newH));
  let buf = new Float32Array(W * H * 4);
  for (let i = 0; i < buf.length; i += 4) {
    const a = data[i + 3] / 255;
    buf[i] = data[i] * a;
    buf[i + 1] = data[i + 1] * a;
    buf[i + 2] = data[i + 2] * a;
    buf[i + 3] = a;
  }
  let cw = W;
  let ch = H;
  for (const [n, m, kernel] of axisPlan(W, w, method)) {
    buf = pass(buf, cw, ch, n, m, kernel, true);
    cw = m;
  }
  for (const [n, m, kernel] of axisPlan(H, h, method)) {
    buf = pass(buf, cw, ch, n, m, kernel, false);
    ch = m;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    // Cubic lobes can overshoot: keep alpha in 0..1 and color under it.
    const a = Math.min(1, Math.max(0, buf[i + 3]));
    if (a <= 0) continue;
    const top = 255 * a;
    out[i] = Math.min(top, Math.max(0, buf[i])) / a;
    out[i + 1] = Math.min(top, Math.max(0, buf[i + 1])) / a;
    out[i + 2] = Math.min(top, Math.max(0, buf[i + 2])) / a;
    out[i + 3] = a * 255;
  }
  return { width: w, height: h, data: out };
}

/** Pixels → the dialog's unit (PhotoCraft to_unit). */
export function toUnit(px, unit, orig) {
  return unit === 'percent' ? (px / Math.max(1, orig)) * 100 : px;
}

/** The dialog's unit → pixels (PhotoCraft from_unit). */
export function fromUnit(v, unit, orig) {
  return unit === 'percent' ? (v * orig) / 100 : v;
}

/**
 * The size after editing one side (PhotoCraft image_size): the edited side is at least 1 px,
 * and with Constrain Proportions the other follows the original aspect, rounded.
 * @param {{ origW: number, origH: number, width: number, height: number,
 *   edited: 'width' | 'height', constrain: boolean }} p
 */
export function linkedSize({ origW, origH, width, height, edited, constrain }) {
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));
  if (constrain) {
    if (edited === 'width') h = Math.max(1, Math.round((w * origH) / Math.max(1, origW)));
    else w = Math.max(1, Math.round((h * origW) / Math.max(1, origH)));
  }
  return { width: w, height: h };
}
