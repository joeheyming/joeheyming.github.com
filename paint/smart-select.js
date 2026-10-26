// Edge-aware selection: PhotoCraft's Quick Selection brush and Magnetic Lasso live wire.
// Pure functions over ImageData-like { width, height, data }. Masks are Uint8Array 0/1,
// index y * W + x.

/**
 * Gradient magnitude per pixel, 0..1: the largest Sobel response over R, G, B, A, divided by
 * a full black-to-white step (4 * 255). Edge pixels repeat the border.
 */
export function edgeMap(img) {
  const W = img.width,
    H = img.height,
    d = img.data;
  const out = new Float32Array(W * H);
  const at = (x, y, c) =>
    d[((Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) << 2) + c];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = 0;
      for (let c = 0; c < 4; c++) {
        const gx =
          at(x + 1, y - 1, c) +
          2 * at(x + 1, y, c) +
          at(x + 1, y + 1, c) -
          at(x - 1, y - 1, c) -
          2 * at(x - 1, y, c) -
          at(x - 1, y + 1, c);
        const gy =
          at(x - 1, y + 1, c) +
          2 * at(x, y + 1, c) +
          at(x + 1, y + 1, c) -
          at(x - 1, y - 1, c) -
          2 * at(x, y - 1, c) -
          at(x + 1, y - 1, c);
        const m = Math.hypot(gx, gy);
        if (m > best) best = m;
      }
      out[y * W + x] = Math.min(1, best / 1020);
    }
  }
  return out;
}

// Quick Selection: colour distance (max channel) a pixel may sit from the dab's mean colour,
// and the edge strength past which the selection stops spreading.
export const QUICK_TOLERANCE = 48;
export const QUICK_EDGE = 0.1;

/**
 * One Quick Selection dab of diameter `size` at (cx, cy). The brush disc is always selected;
 * beyond it the selection floods to neighbours within QUICK_TOLERANCE of the disc's mean
 * colour, and never spreads out of a pixel whose edge strength is above QUICK_EDGE. Pixels set
 * in `skip` (already taken by this stroke) are neither returned nor flooded through again.
 * Returns the newly selected mask, or null when the dab misses the canvas.
 */
export function quickSelectDab(img, edges, cx, cy, size, skip = null) {
  const W = img.width,
    H = img.height,
    d = img.data;
  const r = Math.max(0.5, size / 2);
  const x0 = Math.max(0, Math.floor(cx - r)),
    x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)),
    y1 = Math.min(H - 1, Math.ceil(cy + r));
  const disc = [];
  const mean = [0, 0, 0, 0];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      const p = y * W + x;
      disc.push(p);
      for (let c = 0; c < 4; c++) mean[c] += d[p * 4 + c];
    }
  }
  if (!disc.length) {
    const x = Math.floor(cx),
      y = Math.floor(cy);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    disc.push(y * W + x);
    for (let c = 0; c < 4; c++) mean[c] += d[disc[0] * 4 + c];
  }
  for (let c = 0; c < 4; c++) mean[c] /= disc.length;
  const near = (p) => {
    for (let c = 0; c < 4; c++) {
      if (Math.abs(d[p * 4 + c] - mean[c]) > QUICK_TOLERANCE) return false;
    }
    return true;
  };
  const mask = new Uint8Array(W * H);
  const stack = [];
  for (const p of disc) {
    if (skip?.[p]) continue;
    mask[p] = 1;
    stack.push(p);
  }
  while (stack.length) {
    const p = stack.pop();
    if (edges[p] > QUICK_EDGE) continue;
    const x = p % W;
    const next = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W];
    for (const q of next) {
      if (q < 0 || q >= W * H || mask[q] || skip?.[q] || !near(q)) continue;
      mask[q] = 1;
      stack.push(q);
    }
  }
  return mask;
}

/**
 * The strongest edge pixel within `width` of (x, y) whose strength reaches `contrast` (0..1),
 * the nearest on ties, as its pixel centre. Returns (x, y) itself when no edge is that strong.
 */
export function snapToEdge(edges, W, H, x, y, width, contrast) {
  const r = Math.max(1, Math.round(width));
  const px = Math.floor(x),
    py = Math.floor(y);
  let best = -1,
    bestD = Infinity,
    out = [x, y];
  for (let yy = Math.max(0, py - r); yy <= Math.min(H - 1, py + r); yy++) {
    for (let xx = Math.max(0, px - r); xx <= Math.min(W - 1, px + r); xx++) {
      const dd = Math.hypot(xx - px, yy - py);
      if (dd > r) continue;
      const e = edges[yy * W + xx];
      if (e < contrast) continue;
      if (e > best + 1e-6 || (Math.abs(e - best) <= 1e-6 && dd < bestD)) {
        best = e;
        bestD = dd;
        out = [xx + 0.5, yy + 0.5];
      }
    }
  }
  return out;
}

// A binary min-heap of grid indices keyed by `dist`.
function heapPush(heap, dist, i) {
  let k = heap.length;
  heap.push(i);
  while (k > 0) {
    const parent = (k - 1) >> 1;
    if (dist[heap[parent]] <= dist[i]) break;
    heap[k] = heap[parent];
    k = parent;
  }
  heap[k] = i;
}

function heapPop(heap, dist) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    let k = 0;
    const n = heap.length;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && dist[heap[c + 1]] < dist[heap[c]]) c++;
      if (dist[heap[c]] >= dist[last]) break;
      heap[k] = heap[c];
      k = c;
    }
    heap[k] = last;
  }
  return top;
}

/**
 * Magnetic Lasso live wire: the cheapest 8-connected pixel path from `from` to `to` (points in
 * document px), where a step onto a pixel costs 1 - edge for edges at least `contrast` strong
 * and 1 otherwise, plus a little per pixel so the path stays short. The search stays inside the
 * box around both ends grown by `width`. Returns pixel centres from `from` to `to`.
 */
export function liveWire(edges, W, H, from, to, width = 10, contrast = 0.1) {
  const fx = Math.min(W - 1, Math.max(0, Math.floor(from[0]))),
    fy = Math.min(H - 1, Math.max(0, Math.floor(from[1])));
  const tx = Math.min(W - 1, Math.max(0, Math.floor(to[0]))),
    ty = Math.min(H - 1, Math.max(0, Math.floor(to[1])));
  const pad = Math.max(2, Math.round(width));
  const bx = Math.max(0, Math.min(fx, tx) - pad),
    by = Math.max(0, Math.min(fy, ty) - pad);
  const bw = Math.min(W - 1, Math.max(fx, tx) + pad) - bx + 1,
    bh = Math.min(H - 1, Math.max(fy, ty) + pad) - by + 1;
  const n = bw * bh;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const start = (fy - by) * bw + (fx - bx),
    goal = (ty - by) * bw + (tx - bx);
  const cost = (i) => {
    const e = edges[(by + ((i / bw) | 0)) * W + bx + (i % bw)];
    return 0.02 + (e >= contrast ? 1 - e : 1);
  };
  dist[start] = 0;
  const heap = [start];
  while (heap.length) {
    const i = heapPop(heap, dist);
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const x = i % bw,
      y = (i / bw) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
        const j = yy * bw + xx;
        if (done[j]) continue;
        const nd = dist[i] + cost(j) * (dx && dy ? Math.SQRT2 : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          prev[j] = i;
          heapPush(heap, dist, j);
        }
      }
    }
  }
  const path = [];
  for (let i = goal; i >= 0; i = i === start ? -1 : prev[i]) {
    path.push([bx + (i % bw) + 0.5, by + ((i / bw) | 0) + 0.5]);
    if (i !== start && prev[i] < 0) break;
  }
  return path.reverse();
}

/**
 * How far the border runs before a point fastens by itself (document px), PhotoCraft
 * magnetic_lasso_ui.rs spacing: 8 screen px at Frequency 100, 98 at 0.
 */
export function magneticSpacing(frequency, zoom = 1) {
  const f = Number.isFinite(frequency) ? Math.min(100, Math.max(0, frequency)) : 57;
  return (8 + (100 - f) * 0.9) / Math.max(0.01, zoom);
}

/** Arc length of a point path. */
export function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return len;
}
