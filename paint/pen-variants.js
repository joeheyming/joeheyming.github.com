// Freeform Pen and Curvature Pen geometry (PhotoCraft vector/src/trace.rs fit_trace and
// vector/src/edit.rs curvature_knots). Both return Paint anchors { x, y, in, out } with absolute
// handles, the format paint/paths.js uses.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};

/** Most pointer samples fitTrace fits; a longer trace is thinned evenly first. */
export const MAX_TRACE_POINTS = 4096;

// The point `window` px of arc length from lp[i], forwards or backwards; an open polyline stops
// at its ends.
function walk(lp, i, window, fwd, closed) {
  const n = lp.length;
  let acc = 0;
  let cur = i;
  for (let s = 0; s < Math.min(n, 256); s++) {
    if (!closed && (fwd ? cur + 1 >= n : cur === 0)) break;
    const nx = fwd ? (cur + 1) % n : (cur + n - 1) % n;
    const d = len(sub(lp[nx], lp[cur]));
    if (!Number.isFinite(d)) break;
    if (acc + d >= window) {
      const t = (window - acc) / Math.max(d, 1e-12);
      return add(lp[cur], mul(sub(lp[nx], lp[cur]), t));
    }
    acc += d;
    cur = nx;
  }
  return lp[cur];
}

// Indices where the trace turns more than 60° over ±window: local minima of the turn cosine.
function corners(lp, window, closed) {
  const n = lp.length;
  if (n < 3) return [];
  const cosThresh = Math.cos((60 * Math.PI) / 180);
  const turn = lp.map((p, i) => {
    if (!closed && (i === 0 || i + 1 === n)) return 1;
    const a = norm(sub(p, walk(lp, i, window, false, closed)));
    const b = norm(sub(walk(lp, i, window, true, closed), p));
    return dot(a, b);
  });
  const out = [];
  const maxSteps = Math.min(n, 256);
  let budget = Math.max(n * 64, 1024);
  for (let i = 0; i < n; i++) {
    if (turn[i] >= cosThresh) continue;
    if (budget === 0) break;
    let isMin = true;
    let acc = 0,
      j = i,
      steps = 0;
    while (acc < window && steps < maxSteps && budget > 0) {
      if (!closed && j + 1 >= n) break;
      const nx = (j + 1) % n;
      acc += len(sub(lp[nx], lp[j]));
      j = nx;
      steps++;
      budget--;
      if (j === i) break;
      if (turn[j] < turn[i]) {
        isMin = false;
        break;
      }
    }
    acc = 0;
    j = i;
    steps = 0;
    while (isMin && acc < window && steps < maxSteps && budget > 0) {
      if (!closed && j === 0) break;
      const pv = (j + n - 1) % n;
      acc += len(sub(lp[j], lp[pv]));
      j = pv;
      steps++;
      budget--;
      if (j === i) break;
      if (turn[j] <= turn[i]) isMin = false;
    }
    if (isMin) out.push(i);
  }
  return out;
}

function bezier(b, t) {
  const u = 1 - t;
  const p = u * u * u,
    q = 3 * u * u * t,
    r = 3 * u * t * t,
    w = t * t * t;
  return [
    p * b[0][0] + q * b[1][0] + r * b[2][0] + w * b[3][0],
    p * b[0][1] + q * b[1][1] + r * b[2][1] + w * b[3][1]
  ];
}

function bezierD1(b, t) {
  const u = 1 - t;
  const q0 = mul(sub(b[1], b[0]), 3),
    q1 = mul(sub(b[2], b[1]), 3),
    q2 = mul(sub(b[3], b[2]), 3);
  return add(add(mul(q0, u * u), mul(q1, 2 * u * t)), mul(q2, t * t));
}

function bezierD2(b, t) {
  const r0 = mul(add(sub(b[2], mul(b[1], 2)), b[0]), 6);
  const r1 = mul(add(sub(b[3], mul(b[2], 2)), b[1]), 6);
  return add(mul(r0, 1 - t), mul(r1, t));
}

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1];
  return total > 0 ? u.map((v) => v / total) : u;
}

// Least-squares inner control points with the end tangents fixed (Schneider's generate).
function generate(pts, u, t1, t2) {
  const p0 = pts[0],
    p3 = pts[pts.length - 1];
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  u.forEach((t, i) => {
    const mt = 1 - t;
    const b1 = 3 * mt * mt * t,
      b2 = 3 * mt * t * t;
    const a1 = mul(t1, b1),
      a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(p0, mt * mt * mt + b1), mul(p3, b2 + t * t * t)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  });
  const det = c00 * c11 - c01 * c01;
  let al = 0,
    ar = 0;
  if (Math.abs(det) > 1e-12) {
    al = (x0 * c11 - x1 * c01) / det;
    ar = (c00 * x1 - c01 * x0) / det;
  }
  const seg = len(sub(p3, p0));
  const eps = 1e-6 * seg;
  if (al < eps || ar < eps) al = ar = seg / 3;
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

function maxError(pts, b, u) {
  let best = 0,
    at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = sub(bezier(b, u[i]), pts[i]);
    const e = dot(d, d);
    if (e >= best) {
      best = e;
      at = i;
    }
  }
  return [best, at];
}

// One Newton-Raphson step per sample toward its nearest curve point.
function reparam(pts, u, b) {
  return pts.map((p, i) => {
    const t = u[i];
    const q = sub(bezier(b, t), p);
    const d1 = bezierD1(b, t),
      d2 = bezierD2(b, t);
    const den = dot(d1, d1) + dot(q, d2);
    return Math.abs(den) < 1e-12 ? t : Math.min(1, Math.max(0, t - dot(q, d1) / den));
  });
}

function fitCubic(pts, t1, t2, err2, out, depth) {
  const n = pts.length;
  if (n === 2 || depth > 40) {
    const d = len(sub(pts[n - 1], pts[0])) / 3;
    out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[n - 1], mul(t2, d)), pts[n - 1]]);
    return;
  }
  let u = chordParams(pts);
  let b = generate(pts, u, t1, t2);
  let [e, split] = maxError(pts, b, u);
  if (e < err2) {
    out.push(b);
    return;
  }
  if (e < err2 * 16) {
    for (let k = 0; k < 6; k++) {
      u = reparam(pts, u, b);
      b = generate(pts, u, t1, t2);
      [e, split] = maxError(pts, b, u);
      if (e < err2) {
        out.push(b);
        return;
      }
    }
  }
  split = Math.min(n - 2, Math.max(1, split));
  let tc = norm(sub(pts[split - 1], pts[split + 1]));
  if (len(tc) < 0.5) tc = norm(sub(pts[split - 1], pts[split]));
  fitCubic(pts.slice(0, split + 1), t1, tc, err2, out, depth + 1);
  fitCubic(pts.slice(split), mul(tc, -1), t2, err2, out, depth + 1);
}

function segmentDistance(q, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-18 ? Math.min(1, Math.max(0, dot(sub(q, a), ab) / l2)) : 0;
  return len(sub(q, add(a, mul(ab, t))));
}

const anchor = (p, i, o) => ({ x: p[0], y: p[1], in: [i[0], i[1]], out: [o[0], o[1]] });

function fitOpen(lp, tol, window) {
  const n = lp.length;
  const cuts = [...new Set([0, ...corners(lp, window, false), n - 1])];
  const segs = [];
  for (let c = 0; c + 1 < cuts.length; c++) {
    const pts = lp.slice(cuts[c], cuts[c + 1] + 1);
    const m = pts.length;
    if (m < 2) continue;
    const a = pts[0],
      b = pts[m - 1];
    if (pts.every((q) => segmentDistance(q, a, b) <= tol)) {
      // A straight run is one straight segment; jittery end tangents would bend it.
      const third = mul(sub(b, a), 1 / 3);
      segs.push([a, add(a, third), sub(b, third), b]);
    } else {
      const reach = Math.max(window, Math.min(2 * window, len(sub(b, a)) / 3));
      const t1 = norm(sub(walk(pts, 0, reach, true, false), a));
      const t2 = norm(sub(walk(pts, m - 1, reach, false, false), b));
      fitCubic(pts, t1, t2, tol * tol, segs, 0);
    }
  }
  const anchors = segs.map((s, i) => anchor(s[0], i === 0 ? s[0] : segs[i - 1][2], s[1]));
  const last = segs[segs.length - 1];
  if (last) anchors.push(anchor(last[3], last[2], last[3]));
  return { closed: false, anchors };
}

function fitClosed(lp, tol, window) {
  const n = lp.length;
  const cs = corners(lp, window, true);
  const segs = [];
  if (!cs.length) {
    // A smooth loop: start at 0 with one tangent across the seam.
    const t = norm(sub(lp[1 % n], lp[n - 1]));
    fitCubic([...lp, lp[0]], t, mul(t, -1), tol * tol, segs, 0);
  } else {
    cs.forEach((c, k) => {
      const end = cs[(k + 1) % cs.length];
      const pts = [lp[c]];
      let j = c;
      do {
        j = (j + 1) % n;
        pts.push(lp[j]);
      } while (j !== end);
      const m = pts.length;
      const t1 = norm(sub(pts[Math.min(1, m - 1)], pts[0]));
      const t2 = norm(sub(pts[Math.max(0, m - 2)], pts[m - 1]));
      fitCubic(pts, t1, t2, tol * tol, segs, 0);
    });
  }
  const m = segs.length;
  const anchors = segs.map((s, i) => anchor(s[0], segs[(i + m - 1) % m][2], s[1]));
  return { closed: true, anchors };
}

/**
 * Fit a freehand trace ([[x, y], …], the Freeform Pen's drag) with cubic Béziers that stay
 * within `tolerance` px (Curve Fit, clamped to 0.1–100, 2 when not finite) of every sample.
 * Turns sharper than 60° become corner anchors. Returns a subpath { closed, anchors }, or null
 * when fewer than two distinct points remain (three when `closed`).
 */
export function fitTrace(points, tolerance = 2, closed = false) {
  const tol = Number.isFinite(tolerance) ? Math.min(100, Math.max(0.1, tolerance)) : 2;
  const window = Math.max(2 * tol, 1.5);
  const minStep = Math.min(tol * 0.25, 0.5);
  const stride = Math.max(1, Math.ceil(points.length / MAX_TRACE_POINTS));
  const lastIdx = points.length - 1;
  const lp = [];
  points.forEach((p, i) => {
    if (i % stride !== 0 && i !== lastIdx) return;
    if (!p.every((v) => Number.isFinite(v) && Math.abs(v) < 1e9)) return;
    const q = [p[0], p[1]];
    const l = lp[lp.length - 1];
    if (l && len(sub(q, l)) < minStep) {
      // The release point is kept: it replaces a sample just before it.
      if (i === lastIdx && lp.length > 1) lp[lp.length - 1] = q;
    } else lp.push(q);
  });
  if (closed) {
    while (lp.length > 3 && len(sub(lp[lp.length - 1], lp[0])) < minStep) lp.pop();
    return lp.length >= 3 ? fitClosed(lp, tol, window) : null;
  }
  return lp.length >= 2 ? fitOpen(lp, tol, window) : null;
}

/**
 * The Freeform Pen's release (vector_ui.rs freeform_finish): the trace closes when it ends
 * within `reach` px of its start and is longer than 4 × reach, then fitTrace at `curveFit`.
 */
export function freeformSubpath(trace, curveFit = 2, reach = 6) {
  if (trace.length < 2) return null;
  const first = trace[0],
    last = trace[trace.length - 1];
  let length = 0;
  for (let i = 1; i < trace.length; i++) length += len(sub(trace[i], trace[i - 1]));
  const closed = len(sub(first, last)) < reach && length > 4 * reach;
  return fitTrace(trace, curveFit, closed);
}

/**
 * The Curvature Pen's anchors through `points`, Catmull-Rom style: an inner point's handles lie
 * along its neighbours' chord, each a third of the distance to the neighbour on its side. The
 * ends of an open path aim at their neighbour's nearer handle. `corners[i]` retracts point i's
 * handles. Coincident points give retracted handles, never NaN.
 */
export function curvatureAnchors(points, corners = [], closed = false) {
  const n = points.length;
  const knots = points.map((p) => [p, p, p]);
  const unit = (a, b) => {
    const l = len(sub(b, a));
    return l > 1e-9 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
  };
  const corner = (i) => !!corners[i];
  const inner = (i) => closed || (i > 0 && i + 1 < n);
  points.forEach((p, i) => {
    if (n < 3 || corner(i) || !inner(i)) return;
    const prev = points[(i + n - 1) % n],
      next = points[(i + 1) % n];
    const d = unit(prev, next) ?? unit(p, next);
    if (!d) return;
    const li = len(sub(p, prev)) / 3,
      lo = len(sub(next, p)) / 3;
    knots[i] = [p, [p[0] - d[0] * li, p[1] - d[1] * li], [p[0] + d[0] * lo, p[1] + d[1] * lo]];
  });
  if (!closed && n >= 3) {
    for (const [end, nb, takeIn] of [
      [0, 1, true],
      [n - 1, n - 2, false]
    ]) {
      if (corner(end)) continue;
      const p = points[end];
      const d = unit(p, takeIn ? knots[nb][1] : knots[nb][2]);
      if (!d) continue;
      const l = len(sub(points[nb], p)) / 3;
      const h = [p[0] + d[0] * l, p[1] + d[1] * l];
      knots[end] = takeIn ? [p, p, h] : [p, h, p];
    }
  }
  return knots.map(([p, i, o]) => anchor(p, i, o));
}
