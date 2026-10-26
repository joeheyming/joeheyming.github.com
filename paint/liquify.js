// Filter › Liquify… (PhotoCraft algo/liquify.rs). A displacement field over the canvas: each
// node holds an inverse displacement, so an output pixel p shows the source at p + d(p). Brush
// tools edit the field (Forward Warp drags it along the stroke, Reconstruct and Smooth relax it,
// Twirl / Pucker / Bloat turn and scale it about the brush centre, Freeze / Thaw paint a mask
// that protects nodes), and applyLiquify resamples the layer through it.
//
// Rects are { x0, y0, x1, y1 } in document pixels (x1 / y1 exclusive), or null when empty.

/** Tools in PhotoCraft's strip order, with their icon (liquify_ui.rs tool_icon) and key. */
export const LIQUIFY_TOOLS = [
  { id: 'forwardWarp', label: 'Forward Warp', icon: 'pointer', key: 'w' },
  { id: 'reconstruct', label: 'Reconstruct', icon: 'brush-cleaning', key: 'r' },
  { id: 'smooth', label: 'Smooth', icon: 'droplet', key: 'e' },
  { id: 'twirlCw', label: 'Twirl Clockwise', icon: 'rotate-cw', key: 'c' },
  { id: 'twirlCcw', label: 'Twirl Counterclockwise', icon: 'undo-2', key: null },
  { id: 'pucker', label: 'Pucker', icon: 'scan', key: 's' },
  { id: 'bloat', label: 'Bloat', icon: 'maximize-2', key: 'b' },
  { id: 'pushLeft', label: 'Push Left', icon: 'chevrons-left', key: 'o' },
  { id: 'freeze', label: 'Freeze Mask', icon: 'lock', key: 'f' },
  { id: 'thaw', label: 'Thaw Mask', icon: 'lock-open', key: 'd' }
];

/** Brush options (liquify_ui.rs slider_row ranges) and their defaults. */
export const LIQUIFY_FIELDS = [
  { key: 'size', label: 'Size', min: 1, max: 3000, default: 100 },
  { key: 'density', label: 'Density', min: 0, max: 100, default: 50 },
  { key: 'pressure', label: 'Pressure', min: 0, max: 100, default: 100 },
  { key: 'rate', label: 'Rate', min: 0, max: 100, default: 80 }
];

export function defaultLiquifyOptions() {
  const o = { tool: 'forwardWarp', amount: 100 };
  for (const f of LIQUIFY_FIELDS) o[f.key] = f.default;
  return o;
}

/** Forward Warp and Push Left act along the motion; the rest also act while held still. */
export const isStationary = (tool) => tool !== 'forwardWarp' && tool !== 'pushLeft';

const MAX_FIELD_NODES = 1 << 24;

/** The default field resolution: 2 px per node up to 4 MP, 4 px beyond. */
export function autoCell(bounds) {
  return (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0) <= 4_200_000 ? 2 : 4;
}

/** A zero field over `bounds` with `cell` document pixels per node. */
export function newLiquifyField(bounds, cell = autoCell(bounds)) {
  cell = Math.min(64, Math.max(1, cell));
  const nodes = (c) => [
    Math.ceil((bounds.x1 - bounds.x0) / c) + 2,
    Math.ceil((bounds.y1 - bounds.y0) / c) + 2
  ];
  let [w, h] = nodes(cell);
  while (w * h > MAX_FIELD_NODES) {
    cell *= 2;
    [w, h] = nodes(cell);
  }
  return {
    bounds: { ...bounds },
    cell,
    w,
    h,
    d: new Float32Array(w * h * 2),
    freeze: new Float32Array(w * h),
    cursor: null
  };
}

/** Document position of node (i, j); node 0 sits on the first pixel centre. */
function nodePos(f, i, j) {
  return [f.bounds.x0 + 0.5 + i * f.cell, f.bounds.y0 + 0.5 + j * f.cell];
}

function toGrid(f, x, y) {
  return [(x - f.bounds.x0 - 0.5) / f.cell, (y - f.bounds.y0 - 0.5) / f.cell];
}

export function isIdentityField(f) {
  return f.d.every((v) => v === 0);
}

export function maxDisplacement(f) {
  let m = 0;
  for (let k = 0; k < f.d.length; k += 2) m = Math.max(m, Math.hypot(f.d[k], f.d[k + 1]));
  return m;
}

function bilinear(d, w, h, gx, gy) {
  if (!(gx > -1 && gy > -1 && gx < w && gy < h)) return [0, 0];
  gx = Math.min(Math.max(gx, 0), w - 1);
  gy = Math.min(Math.max(gy, 0), h - 1);
  const i = Math.min(Math.floor(gx), Math.max(0, w - 2));
  const j = Math.min(Math.floor(gy), Math.max(0, h - 2));
  const fx = gx - i;
  const fy = gy - j;
  const i1 = Math.min(i + 1, w - 1);
  const j1 = Math.min(j + 1, h - 1);
  const a = (j * w + i) * 2;
  const b = (j * w + i1) * 2;
  const c = (j1 * w + i) * 2;
  const e = (j1 * w + i1) * 2;
  const l = (k) =>
    (d[a + k] * (1 - fx) + d[b + k] * fx) * (1 - fy) + (d[c + k] * (1 - fx) + d[e + k] * fx) * fy;
  return [l(0), l(1)];
}

/** Bilinear displacement at a document point (zero outside the field). */
export function sampleField(f, x, y) {
  const [gx, gy] = toGrid(f, x, y);
  return bilinear(f.d, f.w, f.h, gx, gy);
}

/** Freeze value at a document point (bilinear, clamped to the field). */
export function freezeAt(f, x, y) {
  let [gx, gy] = toGrid(f, x, y);
  gx = Math.min(Math.max(gx, 0), f.w - 1);
  gy = Math.min(Math.max(gy, 0), f.h - 1);
  const i = Math.min(Math.floor(gx), f.w - 2);
  const j = Math.min(Math.floor(gy), f.h - 2);
  const fx = gx - i;
  const fy = gy - j;
  const at = (i, j) => f.freeze[j * f.w + i];
  return (
    (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) +
    (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy
  );
}

/**
 * A dab's strength at squared distance t2 (in brush radii) for density 0..1: 1 at the centre,
 * fading to 0 with a flat slope at the rim, so dabs never tear the image along their circle.
 */
export function liquifyFalloff(t2, density) {
  t2 = Math.min(Math.max(t2, 0), 1);
  density = Number.isNaN(density) ? 0.5 : Math.min(Math.max(density, 0), 1);
  const feathered = (1 - t2) ** 3;
  const dense = (1 - t2 * t2) ** 2;
  return feathered + (dense - feathered) * density;
}

/** Distance between dabs for brush radius r: a twentieth of the radius. */
const dabSpacing = (r) => Math.max(r * 0.05, 0.5);
/** Per-dab weight of a moving stationary tool, so its effect per distance stays fixed. */
const movingWeight = (r) => dabSpacing(r) / Math.max(r * 0.2, 0.5);

export function unionRect(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1)
  };
}

function intersectRect(a, b) {
  const r = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1)
  };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

/**
 * One dab at c with brush motion delta, its strength scaled by weight. `s` is the brush
 * ({ tool, size, density, pressure, rate }). Returns the document rect it affected.
 */
function dab(f, s, c, delta, pointPressure, weight) {
  const r = Math.max(s.size / 2, 0.5);
  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
  const strength = clamp01(s.pressure / 100) * pointPressure * weight;
  const rate = clamp01(s.rate / 100);
  const density = clamp01(s.density / 100);
  if (strength <= 0) return null;
  const [gx0, gy0] = toGrid(f, c[0] - r, c[1] - r);
  const [gx1, gy1] = toGrid(f, c[0] + r, c[1] + r);
  const i0 = Math.max(Math.floor(gx0), 0);
  const j0 = Math.max(Math.floor(gy0), 0);
  const i1 = Math.min(Math.max(Math.ceil(gx1), -1), f.w - 1);
  const j1 = Math.min(Math.max(Math.ceil(gy1), -1), f.h - 1);
  if (i1 < i0 || j1 < j0) return null;
  const { d, w, h, freeze } = f;
  const tool = s.tool;
  const sign = tool === 'twirlCw' ? 1 : -1;
  // Every node reads the field as it was before this dab; the writes land afterwards.
  const writes = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const p = nodePos(f, i, j);
      const dx = p[0] - c[0];
      const dy = p[1] - c[1];
      const t2 = (dx * dx + dy * dy) / (r * r);
      if (t2 >= 1) continue;
      const idx = j * w + i;
      const kRaw = strength * liquifyFalloff(t2, density);
      if (tool === 'freeze' || tool === 'thaw') {
        const v = tool === 'freeze' ? Math.min(freeze[idx] + kRaw, 1) : Math.max(freeze[idx] - kRaw, 0);
        writes.push(idx, d[idx * 2], d[idx * 2 + 1], v);
        continue;
      }
      const k = kRaw * (1 - freeze[idx]);
      if (k <= 0) continue;
      const cx = d[idx * 2];
      const cy = d[idx * 2 + 1];
      let nx;
      let ny;
      if (tool === 'reconstruct') {
        const a = 1 - k * (0.1 + 0.4 * rate);
        nx = cx * a;
        ny = cy * a;
      } else if (tool === 'smooth') {
        let mx = 0;
        let my = 0;
        for (const [ox, oy] of NEIGHBOURS) {
          const q = (Math.min(Math.max(j + oy, 0), h - 1) * w + Math.min(Math.max(i + ox, 0), w - 1)) * 2;
          mx += d[q] / 8;
          my += d[q + 1] / 8;
        }
        const a = k * (0.1 + 0.4 * rate);
        nx = cx + (mx - cx) * a;
        ny = cy + (my - cy) * a;
      } else {
        let q;
        if (tool === 'forwardWarp') {
          q = [p[0] - k * delta[0], p[1] - k * delta[1]];
        } else if (tool === 'pushLeft') {
          // Left of the stroke direction (y down): (dx, dy) → (dy, -dx).
          q = [p[0] - k * delta[1], p[1] + k * delta[0]];
        } else if (tool === 'twirlCw' || tool === 'twirlCcw') {
          // Content turns by +th, so sample at the point turned by -th.
          const th = k * rate * 0.12 * sign;
          const sn = Math.sin(-th);
          const cs = Math.cos(-th);
          q = [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs];
        } else {
          const a = tool === 'pucker' ? 1 + k * rate * 0.06 : 1 - k * rate * 0.06;
          q = [c[0] + dx * a, c[1] + dy * a];
        }
        const dq = bilinear(d, w, h, (q[0] - p[0]) / f.cell + i, (q[1] - p[1]) / f.cell + j);
        nx = Math.fround(q[0] + dq[0] - p[0]);
        ny = Math.fround(q[1] + dq[1] - p[1]);
      }
      writes.push(idx, nx, ny, freeze[idx]);
    }
  }
  for (let n = 0; n < writes.length; n += 4) {
    const idx = writes[n];
    d[idx * 2] = writes[n + 1];
    d[idx * 2 + 1] = writes[n + 2];
    freeze[idx] = writes[n + 3];
  }
  const pad = Math.ceil(r) + 2;
  return intersectRect(
    {
      x0: Math.floor(c[0]) - pad,
      y0: Math.floor(c[1]) - pad,
      x1: Math.ceil(c[0]) + pad,
      y1: Math.ceil(c[1]) + pad
    },
    f.bounds
  );
}

const NEIGHBOURS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1]
];

/**
 * Session pointer while Liquify owns the canvas.
 * ports: { options, checkpoint(s), dabbed(s, rect), drawOverlay(), setHold(id), clearHold() }.
 */
export function liquifySessionPointer(session, type, x, y, pressure, ports) {
  if (type === 'down') {
    ports.checkpoint?.(session);
    session.down = [x, y, pressure];
    session.at = [x, y];
    ports.dabbed?.(session, strokeBegin(session.field, ports.options, session.down));
    // Stationary tools keep dabbing while the brush is held still (Adapter owns the timer).
    if (isStationary(ports.options.tool)) {
      ports.setHold?.(() => {
        if (!session.down) return;
        ports.dabbed?.(
          session,
          strokeSegment(session.field, ports.options, session.down, session.down)
        );
      });
    }
    return;
  }
  if (type === 'move') {
    session.at = [x, y];
    if (session.down) {
      const p = [x, y, pressure];
      ports.dabbed?.(session, strokeSegment(session.field, ports.options, session.down, p));
      session.down = p;
    } else {
      ports.drawOverlay?.();
    }
    return;
  }
  ports.clearHold?.();
  session.down = null;
}

/** Starts a stroke at p ([x, y, pressure]): stationary tools dab once there. */
export function strokeBegin(f, s, p) {
  f.cursor = { end: [p[0], p[1]], lastDab: [p[0], p[1]], carry: 0 };
  return isStationary(s.tool) ? dab(f, s, [p[0], p[1]], [0, 0], clampP(p[2]), 1) : null;
}

const clampP = (v) => Math.min(Math.max(v ?? 1, 0), 1);

/**
 * Continues a stroke from a to b. Dabs fall every dabSpacing of distance travelled along the
 * whole stroke, carried across segments, so a fast and a slow mouse give the same warp. A
 * stationary tool held still (a equal to b) dabs once at b.
 */
export function strokeSegment(f, s, a, b) {
  let dirty = null;
  const pa = clampP(a[2]);
  const pb = clampP(b[2]);
  const stationary = isStationary(s.tool);
  const c = f.cursor;
  const cur =
    c && c.end[0] === a[0] && c.end[1] === a[1]
      ? c
      : { end: [a[0], a[1]], lastDab: [a[0], a[1]], carry: 0 };
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    f.cursor = cur;
    return stationary ? dab(f, s, [b[0], b[1]], [0, 0], pb, 1) : null;
  }
  if (!Number.isFinite(len)) {
    f.cursor = null;
    return null;
  }
  const r = Math.max(s.size / 2, 0.5);
  const spacing = dabSpacing(r);
  const weight = stationary ? movingWeight(r) : 1;
  const first = Math.min(Math.max(spacing - cur.carry, 0), spacing);
  const slack = spacing * 1e-6;
  if (first > len + slack) {
    f.cursor = { end: [b[0], b[1]], lastDab: cur.lastDab, carry: cur.carry + len };
    return null;
  }
  const lastK = Math.max(Math.floor((len - first + slack) / spacing), 0);
  const at = (dist) => [a[0] + (dx * dist) / len, a[1] + (dy * dist) / len];
  let prev = cur.lastDab;
  for (let k = 0; k <= lastK; k++) {
    const dist = Math.min(first + k * spacing, len);
    const p = at(dist);
    const delta = [p[0] - prev[0], p[1] - prev[1]];
    // Forward Warp centres the dab where the brush was (it drags what is under it).
    const centre = stationary ? p : prev;
    dirty = unionRect(dirty, dab(f, s, centre, delta, pa + ((pb - pa) * dist) / len, weight));
    prev = p;
  }
  const last = Math.min(first + lastK * spacing, len);
  f.cursor = { end: [b[0], b[1]], lastDab: at(last), carry: Math.min(Math.max(len - last, 0), spacing) };
  return dirty;
}

/** Applies a whole stroke (points [x, y] or [x, y, pressure]). Returns the changed rect. */
export function applyLiquifyStroke(f, s, points) {
  f.cursor = null;
  if (!points.length) return null;
  const pts = points.map((p) => [p[0], p[1], p[2] ?? 1]);
  let dirty = strokeBegin(f, s, pts[0]);
  for (let n = 1; n < pts.length; n++) dirty = unionRect(dirty, strokeSegment(f, s, pts[n - 1], pts[n]));
  return dirty;
}

/** The Reconstruct… button: scales the unfrozen field toward zero by amount %. */
export function reconstructAll(f, amount = 100) {
  const k = Math.min(Math.max(amount / 100, 0), 1);
  for (let n = 0; n < f.freeze.length; n++) {
    const m = 1 - k * (1 - f.freeze[n]);
    f.d[n * 2] *= m;
    f.d[n * 2 + 1] *= m;
  }
  return f.bounds;
}

/** Restore All: a zero field. The freeze mask stays. */
export function restoreAll(f) {
  f.d.fill(0);
  f.cursor = null;
  return f.bounds;
}

/** Mask Options › None / All / Invert. */
export function setFreezeAll(f, how) {
  if (how === 'all') f.freeze.fill(1);
  else if (how === 'none') f.freeze.fill(0);
  else for (let n = 0; n < f.freeze.length; n++) f.freeze[n] = 1 - f.freeze[n];
  return f.bounds;
}

function catmullRom(t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2
  ];
}

/** A field axis's clamped node indices and Catmull-Rom weights at grid coordinate g. */
function cubicTaps(g, len) {
  const i = Math.floor(g);
  const wts = catmullRom(g - i);
  return wts.map((wt, k) => [Math.min(Math.max(i - 1 + k, 0), len - 1), wt]);
}

/**
 * Resamples src through the field into dst (both ImageData-like, same size) inside `rect`
 * (default: the field bounds): each pixel shows the source at p + d(p), bicubic field and
 * bicubic premultiplied source, edge pixels repeat. Pixels where `mask` is 0 keep dst.
 */
export function applyLiquify(src, dst, f, mask = null, rect = f.bounds) {
  const W = src.width;
  const b = f.bounds;
  const t = intersectRect(rect, b);
  if (!t) return dst;
  const s = src.data;
  const out = dst.data;
  let hasFreeze = false;
  for (let n = 0; n < f.freeze.length; n++) {
    if (f.freeze[n] > 0) {
      hasFreeze = true;
      break;
    }
  }
  const cols = [];
  for (let x = t.x0; x < t.x1; x++) cols.push(cubicTaps((x - b.x0) / f.cell, f.w));
  const snap = (v) => (Math.abs(v - Math.round(v)) < 1e-7 ? Math.round(v) : v);
  const acc = [0, 0, 0, 0];
  for (let y = t.y0; y < t.y1; y++) {
    const ys = cubicTaps((y - b.y0) / f.cell, f.h);
    for (let x = t.x0; x < t.x1; x++) {
      const p = y * W + x;
      if (mask && !mask[p]) continue;
      const xs = cols[x - t.x0];
      let ddx = 0;
      let ddy = 0;
      for (const [jy, wy] of ys) {
        const row = jy * f.w;
        for (const [ix, wx] of xs) {
          const k = wx * wy;
          ddx += f.d[(row + ix) * 2] * k;
          ddy += f.d[(row + ix) * 2 + 1] * k;
        }
      }
      if (hasFreeze) {
        const m = Math.min(Math.max(freezeAt(f, x + 0.5, y + 0.5), 0), 1);
        if (m > 0) {
          const lin = sampleField(f, x + 0.5, y + 0.5);
          ddx = ddx * (1 - m) + lin[0] * m;
          ddy = ddy * (1 - m) + lin[1] * m;
        }
      }
      const o = p * 4;
      if (ddx === 0 && ddy === 0) {
        out[o] = s[o];
        out[o + 1] = s[o + 1];
        out[o + 2] = s[o + 2];
        out[o + 3] = s[o + 3];
        continue;
      }
      const u = snap(x + ddx);
      const v = snap(y + ddy);
      const ix = Math.floor(u);
      const iy = Math.floor(v);
      const wx = catmullRom(u - ix);
      const wy = catmullRom(v - iy);
      acc.fill(0);
      for (let jj = 0; jj < 4; jj++) {
        const sy = Math.min(Math.max(iy - 1 + jj, b.y0), b.y1 - 1);
        for (let ii = 0; ii < 4; ii++) {
          const k = wx[ii] * wy[jj];
          if (k === 0) continue;
          const sx = Math.min(Math.max(ix - 1 + ii, b.x0), b.x1 - 1);
          const q = (sy * W + sx) * 4;
          const al = s[q + 3] / 255;
          acc[0] += (s[q] / 255) * al * k;
          acc[1] += (s[q + 1] / 255) * al * k;
          acc[2] += (s[q + 2] / 255) * al * k;
          acc[3] += al * k;
        }
      }
      const al = Math.min(Math.max(acc[3], 0), 1);
      out[o + 3] = Math.round(al * 255);
      for (let c = 0; c < 3; c++) {
        out[o + c] = al > 0 ? Math.round(Math.min(Math.max(acc[c] / al, 0), 1) * 255) : 0;
      }
    }
  }
  return dst;
}

/** How far outside a dirty rect the output can change: the cubic field's support. */
export function liquifyRenderPad(f) {
  return Math.ceil(2 * f.cell) + 1;
}
