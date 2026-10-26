// Image › Mode › Indexed Color, Color Table and Bitmap (PhotoCraft algo/src/quantize.rs and
// engine/src/mode_cmds.rs). Every function works on RGBA bytes in place and is pure apart from
// that, so the tests can assert pixels directly.
//
// Palettes: Exact (every colour, at most 256), Uniform (an equal-step RGB grid) and Adaptive
// (RGB median cut weighted by frequency, Heckbert 1982, then two Lloyd passes). Dither: None or
// Diffusion (Floyd & Steinberg 1976, scaled by Amount). Bitmap: 50% Threshold or Diffusion
// Dither on the gray composite.

export const INDEXED_PALETTES = [
  { value: 'exact', label: 'Exact' },
  { value: 'uniform', label: 'Uniform' },
  { value: 'adaptive', label: 'Local (Adaptive)' }
];

export const INDEXED_DITHERS = [
  { value: 'none', label: 'None' },
  { value: 'diffusion', label: 'Diffusion' }
];

export const BITMAP_METHODS = [
  { value: 'threshold', label: '50% Threshold' },
  { value: 'diffusion', label: 'Diffusion Dither' }
];

const hex2 = (v) => v.toString(16).padStart(2, '0');

/** '#rrggbb' for an [r, g, b] byte triple. */
export function rgbHex([r, g, b]) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** [r, g, b] bytes for '#rrggbb'. */
export function hexRgb(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Unique opaque (alpha ≥ 128) colours with their counts, sorted by packed colour. */
function histogram(d) {
  const counts = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => a[0] - b[0])
    .map(([k, n]) => ({ c: [(k >> 16) & 255, (k >> 8) & 255, k & 255], n }));
}

/** Widest axis of a box and its split score (extent · √weight); null when it cannot split. */
function splitScore(box) {
  if (box.length <= 1) return null;
  let axis = 0;
  let extent = -1;
  for (let a = 0; a < 3; a++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of box) {
      if (p.c[a] < lo) lo = p.c[a];
      if (p.c[a] > hi) hi = p.c[a];
    }
    if (hi - lo > extent) {
      axis = a;
      extent = hi - lo;
    }
  }
  const w = box.reduce((s, p) => s + p.n, 0);
  return { axis, score: extent * Math.sqrt(w) };
}

/** Median cut into at most n boxes; returns the weighted box means (floats). */
export function medianCut(points, n) {
  if (!points.length || n <= 0) return [];
  const boxes = [points.slice()];
  const scores = [splitScore(points)];
  while (boxes.length < n) {
    let bi = -1;
    let best = -1;
    scores.forEach((s, i) => {
      if (s && s.score > best) {
        bi = i;
        best = s.score;
      }
    });
    if (bi < 0 || best <= 0) break;
    const { axis } = scores[bi];
    const box = boxes.splice(bi, 1)[0];
    scores.splice(bi, 1);
    box.sort((p, q) => p.c[axis] - q.c[axis]);
    const total = box.reduce((s, p) => s + p.n, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.length; i++) {
      acc += box[i].n;
      if (acc * 2 >= total) {
        cut = Math.min(Math.max(i + 1, 1), box.length - 1);
        break;
      }
    }
    const rest = box.splice(cut);
    boxes.push(box, rest);
    scores.push(splitScore(box), splitScore(rest));
  }
  return boxes.map((b) => {
    const w = b.reduce((s, p) => s + p.n, 0);
    return [0, 1, 2].map((a) => b.reduce((s, p) => s + p.c[a] * p.n, 0) / w);
  });
}

/** Index of the palette entry nearest c (squared RGB distance; the first wins a tie). */
export function nearestIndex(table, r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < table.length; i++) {
    const t = table[i];
    const d = (t[0] - r) ** 2 + (t[1] - g) ** 2 + (t[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
      if (d === 0) break;
    }
  }
  return best;
}

/** Lloyd refinement of float centres over weighted points. */
function kmeans(points, centers, iters) {
  for (let it = 0; it < iters; it++) {
    const sum = centers.map(() => [0, 0, 0]);
    const cnt = centers.map(() => 0);
    for (const p of points) {
      const i = nearestIndex(centers, p.c[0], p.c[1], p.c[2]);
      for (let a = 0; a < 3; a++) sum[i][a] += p.c[a] * p.n;
      cnt[i] += p.n;
    }
    centers.forEach((c, i) => {
      if (cnt[i] > 0) for (let a = 0; a < 3; a++) c[a] = sum[i][a] / cnt[i];
    });
  }
}

/** Up to n colours on an equal-step RGB grid (at least 2 levels per channel). */
export function uniformPalette(n) {
  const k = Math.max(2, Math.floor(Math.cbrt(n) + 1e-9));
  const lv = (i) => Math.round((i / (k - 1)) * 255);
  const out = [];
  for (let r = 0; r < k; r++) {
    for (let g = 0; g < k; g++) for (let b = 0; b < k; b++) out.push([lv(r), lv(g), lv(b)]);
  }
  return out;
}

/**
 * The colour table for an image. Exact throws when the image has more than 256 colours.
 * @returns {number[][]} [r, g, b] byte entries
 */
export function buildPalette(imgData, palette = 'adaptive', colors = 256) {
  colors = Math.min(256, Math.max(2, Math.round(colors) || 256));
  const hist = palette === 'uniform' ? [] : histogram(imgData.data);
  let table;
  if (palette === 'exact') {
    if (hist.length > 256) {
      throw new Error(`The image has ${hist.length} colors; Exact needs 256 or fewer.`);
    }
    table = hist.map((h) => h.c);
  } else if (palette === 'uniform') {
    table = uniformPalette(Math.max(colors, 8)).slice(0, Math.max(colors, 8));
  } else if (hist.length <= colors) {
    table = hist.map((h) => h.c);
  } else {
    const centers = medianCut(hist, colors);
    kmeans(hist, centers, 2);
    table = centers.map((c) => c.map((v) => Math.min(255, Math.max(0, Math.round(v)))));
  }
  const seen = new Set();
  table = table.filter((c) => {
    const k = rgbHex(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (palette === 'uniform') table = table.slice(0, colors);
  return table.length ? table : [[0, 0, 0]];
}

/**
 * Maps every pixel of an opaque image to its table entry, in place, with the chosen dither.
 * Returns the index per pixel.
 */
export function mapToTable(imgData, table, dither = 'none', amount = 75) {
  const { width: W, height: H, data: d } = imgData;
  const indices = new Uint8Array(W * H);
  const a = Math.min(1, Math.max(0, amount / 100));
  const diffuse = dither === 'diffusion' && a > 0;
  // Error rows ping-pong; x is offset by one so x − 1 never leaves the row.
  let cur = new Float32Array((W + 2) * 3);
  let next = new Float32Array((W + 2) * 3);
  for (let y = 0; y < H; y++) {
    if (diffuse) {
      [cur, next] = [next, cur];
      next.fill(0);
    }
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const i = p * 4;
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];
      if (diffuse) {
        const e = (x + 1) * 3;
        r = Math.min(255, Math.max(0, r + cur[e]));
        g = Math.min(255, Math.max(0, g + cur[e + 1]));
        b = Math.min(255, Math.max(0, b + cur[e + 2]));
      }
      const k = nearestIndex(table, r, g, b);
      const t = table[k];
      indices[p] = k;
      if (diffuse) {
        const err = [(r - t[0]) * a, (g - t[1]) * a, (b - t[2]) * a];
        for (let q = 0; q < 3; q++) {
          cur[(x + 2) * 3 + q] += (err[q] * 7) / 16;
          next[x * 3 + q] += (err[q] * 3) / 16;
          next[(x + 1) * 3 + q] += (err[q] * 5) / 16;
          next[(x + 2) * 3 + q] += err[q] / 16;
        }
      }
      d[i] = t[0];
      d[i + 1] = t[1];
      d[i + 2] = t[2];
      d[i + 3] = 255;
    }
  }
  return indices;
}

/**
 * Image › Mode › Indexed Color on a flattened (opaque) image, in place.
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} imgData
 * @param {{ palette?: string, colors?: number, dither?: string, amount?: number }} opts
 * @returns {{ indices: Uint8Array, table: string[] }} table entries as '#rrggbb'
 */
export function quantizeIndexed(imgData, opts = {}) {
  const { palette = 'adaptive', colors = 256, dither = 'diffusion', amount = 75 } = opts;
  const table = buildPalette(imgData, palette, colors);
  const indices = mapToTable(imgData, table, dither, amount);
  return { indices, table: table.map(rgbHex) };
}

/**
 * Color Table: every pixel takes its old entry's new colour (pixels keep their index, which is
 * the nearest entry of the old table, as in PhotoCraft color_table). In place.
 */
export function recolorTable(imgData, oldTable, newTable) {
  const oldRgb = oldTable.map(hexRgb);
  const newRgb = newTable.map(hexRgb);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const k = nearestIndex(oldRgb, d[i], d[i + 1], d[i + 2]);
    const c = newRgb[k] ?? newRgb[nearestIndex(newRgb, d[i], d[i + 1], d[i + 2])];
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
  }
  return imgData;
}

/** The table entry nearest a colour, as '#rrggbb'. */
export function nearestTableColor(table, hex) {
  if (!table?.length) return hex;
  const rgb = table.map(hexRgb);
  const [r, g, b] = hexRgb(hex);
  return rgbHex(rgb[nearestIndex(rgb, r, g, b)]);
}

/**
 * Image › Mode › Bitmap on a flattened gray image, in place: every pixel becomes 0 or 255 and
 * opaque. 50% Threshold keeps gray ≥ ½; Diffusion Dither spreads the error Floyd-Steinberg.
 */
export function toBitmap(imgData, method = 'diffusion') {
  const { width: W, height: H, data: d } = imgData;
  const gray = new Float32Array(W * H);
  for (let p = 0; p < gray.length; p++) {
    const i = p * 4;
    gray[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const old = gray[p];
      const v = old >= 0.5 ? 1 : 0;
      gray[p] = v;
      if (method !== 'diffusion') continue;
      const e = old - v;
      if (x + 1 < W) gray[p + 1] += (e * 7) / 16;
      if (y + 1 < H) {
        if (x > 0) gray[p + W - 1] += (e * 3) / 16;
        gray[p + W] += (e * 5) / 16;
        if (x + 1 < W) gray[p + W + 1] += e / 16;
      }
    }
  }
  for (let p = 0; p < gray.length; p++) {
    const i = p * 4;
    d[i] = d[i + 1] = d[i + 2] = gray[p] ? 255 : 0;
    d[i + 3] = 255;
  }
  return imgData;
}
