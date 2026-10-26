// Pen tool paths and the Paths panel (PhotoCraft vector_ui.rs paths panel, path.fill /
// path.stroke / path.toSelection / select.toWorkPath). A path is { name, subpaths }: each subpath
// is { closed, anchors }, an anchor { x, y, in: [x, y], out: [x, y] } with absolute cubic Bézier
// handles (a corner point has both handles on the anchor). Paths are never mutated; every edit
// returns a new path, so undo entries and .paintproj can keep the object they were given.

export const WORK_PATH_NAME = 'Work Path';

/** A corner anchor at (x, y). */
export function cornerAnchor(x, y) {
  return { x, y, in: [x, y], out: [x, y] };
}

/** An empty path named `name`. */
export function emptyPath(name = WORK_PATH_NAME) {
  return { name, subpaths: [] };
}

/** The next free "Path N" name among the saved paths. */
export function nextPathName(saved = []) {
  const taken = new Set(saved.map((p) => p.name));
  let n = 1;
  while (taken.has(`Path ${n}`)) n++;
  return `Path ${n}`;
}

// Points along one cubic from (p0, c1, c2, p3), p0 excluded. Wang's formula picks the number of
// line segments that keeps the polyline within `tolerance` px of the curve.
function flattenCubic(p0, c1, c2, p3, tolerance, out) {
  const ddx = Math.max(Math.abs(p0[0] - 2 * c1[0] + c2[0]), Math.abs(c1[0] - 2 * c2[0] + p3[0]));
  const ddy = Math.max(Math.abs(p0[1] - 2 * c1[1] + c2[1]), Math.abs(c1[1] - 2 * c2[1] + p3[1]));
  const n = Math.max(1, Math.ceil(Math.sqrt((3 * Math.hypot(ddx, ddy)) / (4 * tolerance))));
  for (let i = 1; i <= n; i++) {
    const t = i / n,
      u = 1 - t;
    const a = u * u * u,
      b = 3 * u * u * t,
      c = 3 * u * t * t,
      d = t * t * t;
    out.push([
      a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
      a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]
    ]);
  }
}

/**
 * Flatten a path to polygons, one [[x, y], …] per subpath, within `tolerance` px of the curves.
 * A closed subpath includes its closing segment and does not repeat its first point.
 */
export function pathToPolygon(path, tolerance = 0.25) {
  const tol = Math.max(0.01, Number(tolerance) || 0.25);
  const polys = [];
  for (const sp of path?.subpaths ?? []) {
    const a = sp.anchors;
    if (!a.length) continue;
    const pts = [[a[0].x, a[0].y]];
    const segs = sp.closed ? a.length : a.length - 1;
    for (let i = 0; i < segs; i++) {
      const s = a[i],
        e = a[(i + 1) % a.length];
      flattenCubic([s.x, s.y], s.out, e.in, [e.x, e.y], tol, pts);
    }
    if (sp.closed && pts.length > 1) pts.pop();
    polys.push(pts);
  }
  return polys;
}

/**
 * Even-odd fill of polygons as a 0/1 mask, sampled like scanlineFill (row y, columns
 * ceil(x0)…floor(x1)), so a single polygon gives exactly scanlineFill's mask.
 */
export function polygonsMask(polys, W, H) {
  const mask = new Uint8Array(W * H);
  const rings = polys.filter((p) => p.length >= 3);
  if (!rings.length) return mask;
  for (let y = 0; y < H; y++) {
    const xs = [];
    for (const path of rings) {
      for (let i = 0; i < path.length; i++) {
        const [x1, y1] = path[i];
        const [x2, y2] = path[(i + 1) % path.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i += 2) {
      const x0 = Math.max(0, Math.ceil(xs[i]));
      const x1 = Math.min(W - 1, Math.floor(xs[i + 1]));
      for (let x = x0; x <= x1; x++) mask[y * W + x] = 1;
    }
  }
  return mask;
}

/** Fill Path / Load Path as Selection: the path's interior (open subpaths close implicitly). */
export function pathMask(path, W, H, tolerance = 0.25) {
  return polygonsMask(pathToPolygon(path, tolerance), W, H);
}

// ── Pen ──────────────────────────────────────────────────────────────────────

/**
 * A Pen press at (x, y). `continuing` means the path's last subpath is the one being drawn: a
 * press within `closeRadius` of its first anchor (two or more anchors) closes it, any other adds
 * a corner anchor. Otherwise the press starts a new subpath. Returns { path, closed, anchor },
 * anchor being the index a drag from this press shapes.
 */
export function penPress(path, x, y, { continuing = false, closeRadius = 6 } = {}) {
  const subpaths = (path?.subpaths ?? []).slice();
  const last = subpaths[subpaths.length - 1];
  const base = { ...(path ?? emptyPath()), subpaths };
  if (continuing && last && !last.closed && last.anchors.length) {
    const first = last.anchors[0];
    if (last.anchors.length >= 2 && Math.hypot(x - first.x, y - first.y) <= closeRadius) {
      subpaths[subpaths.length - 1] = { ...last, closed: true };
      return { path: base, closed: true, anchor: 0 };
    }
    const anchors = [...last.anchors, cornerAnchor(x, y)];
    subpaths[subpaths.length - 1] = { ...last, anchors };
    return { path: base, closed: false, anchor: anchors.length - 1 };
  }
  subpaths.push({ closed: false, anchors: [cornerAnchor(x, y)] });
  return { path: base, closed: false, anchor: 0 };
}

/**
 * A Pen drag to (x, y) after a press: anchor `index` of the last subpath becomes a smooth point,
 * its out handle at the pointer and its in handle mirrored through the anchor.
 */
export function penDrag(path, index, x, y) {
  const subpaths = path.subpaths.slice();
  const last = subpaths[subpaths.length - 1];
  const a = last?.anchors[index];
  if (!a) return path;
  const anchors = last.anchors.slice();
  anchors[index] = { x: a.x, y: a.y, in: [2 * a.x - x, 2 * a.y - y], out: [x, y] };
  subpaths[subpaths.length - 1] = { ...last, anchors };
  return { ...path, subpaths };
}

// ── Path Selection, Direct Selection, and the anchor tools ──────────────────
// PhotoCraft vector/src/edit.rs. Anchors are addressed [subpath, anchor]; every edit returns a new
// path and leaves a bad index unchanged.

const retracted = (a, h) => Math.hypot(a[h][0] - a.x, a[h][1] - a.y) < 1e-9;

/** A smooth point: both handles pulled out and pointing opposite ways along one line. */
export function isSmoothAnchor(a) {
  if (retracted(a, 'in') || retracted(a, 'out')) return false;
  const ix = a.in[0] - a.x,
    iy = a.in[1] - a.y,
    ox = a.out[0] - a.x,
    oy = a.out[1] - a.y;
  const cross = ix * oy - iy * ox;
  const tol = 1e-6 * Math.hypot(ix, iy) * Math.hypot(ox, oy);
  return ix * ox + iy * oy < 0 && Math.abs(cross) <= tol;
}

// path with anchor [s, k] replaced by f(anchor), or path itself when there is no such anchor.
function mapAnchor(path, s, k, f) {
  const sp = path?.subpaths[s];
  if (!sp?.anchors[k]) return path;
  const anchors = sp.anchors.slice();
  anchors[k] = f(anchors[k]);
  const subpaths = path.subpaths.slice();
  subpaths[s] = { ...sp, anchors };
  return { ...path, subpaths };
}

const shifted = (a, dx, dy) => ({
  x: a.x + dx,
  y: a.y + dy,
  in: [a.in[0] + dx, a.in[1] + dy],
  out: [a.out[0] + dx, a.out[1] + dy]
});

/** The point at t of the cubic from anchor a (via a.out and b.in) to anchor b. */
export function segmentPoint(a, b, t) {
  const u = 1 - t;
  const p = u * u * u,
    q = 3 * u * u * t,
    r = 3 * u * t * t,
    w = t * t * t;
  return [
    p * a.x + q * a.out[0] + r * b.in[0] + w * b.x,
    p * a.y + q * a.out[1] + r * b.in[1] + w * b.y
  ];
}

// The anchor index ending the segment that leaves anchor k of sp, or -1.
function segmentEnd(sp, k) {
  const n = sp?.anchors.length ?? 0;
  if (k < 0 || k >= n) return -1;
  if (k + 1 < n) return k + 1;
  return sp.closed && n > 1 ? 0 : -1;
}

/**
 * The part of `path` within `tol` of (x, y): one of `handles` ([s, k, 'in' | 'out'], drawn on top),
 * else the nearest anchor, else the nearest segment. Returns { type: 'handle', s, k, h },
 * { type: 'anchor', s, k }, { type: 'segment', s, k, t } (the segment leaving anchor k), or null.
 */
export function hitPath(path, x, y, tol, handles = []) {
  if (!path) return null;
  let best = null,
    bd = tol;
  for (const [s, k, h] of handles) {
    const a = path.subpaths[s]?.anchors[k];
    const d = a ? Math.hypot(a[h][0] - x, a[h][1] - y) : Infinity;
    if (d <= bd) {
      bd = d;
      best = { type: 'handle', s, k, h };
    }
  }
  if (best) return best;
  path.subpaths.forEach((sp, s) =>
    sp.anchors.forEach((a, k) => {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d <= bd) {
        bd = d;
        best = { type: 'anchor', s, k };
      }
    })
  );
  if (best) return best;
  // Segments: the nearest of 64 samples, refined once around it (edit.rs hit).
  const N = 64;
  path.subpaths.forEach((sp, s) => {
    for (let k = 0; k < sp.anchors.length; k++) {
      const e = segmentEnd(sp, k);
      if (e < 0) continue;
      const a = sp.anchors[k],
        b = sp.anchors[e];
      const dist = (t) => {
        const [px, py] = segmentPoint(a, b, t);
        return Math.hypot(px - x, py - y);
      };
      let bt = 0.5,
        sd = Infinity;
      for (let i = 0; i <= N; i++) {
        const d = dist(i / N);
        if (d < sd) [sd, bt] = [d, i / N];
      }
      const c = bt;
      for (let i = 0; i <= 16; i++) {
        const t = Math.min(1, Math.max(0, c - 1 / N + (2 / N) * (i / 16)));
        const d = dist(t);
        if (d < sd) [sd, bt] = [d, t];
      }
      if (sd <= bd) {
        bd = sd;
        best = { type: 'segment', s, k, t: bt };
      }
    }
  });
  return best;
}

/**
 * The subpath index a Path Selection press at (x, y) picks: one whose outline is within `tol`,
 * else the last (frontmost) whose interior holds the point, else -1.
 */
export function subpathAt(path, x, y, tol) {
  const hit = hitPath(path, x, y, tol);
  if (hit) return hit.s;
  const polys = pathToPolygon(path);
  const subs = (path?.subpaths ?? []).filter((sp) => sp.anchors.length);
  for (let i = polys.length - 1; i >= 0; i--) {
    const poly = polys[i];
    let inside = false;
    for (let j = 0, m = poly.length - 1; j < poly.length; m = j++) {
      const [x1, y1] = poly[j],
        [x2, y2] = poly[m];
      if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) inside = !inside;
    }
    if (inside) return path.subpaths.indexOf(subs[i]);
  }
  return -1;
}

/** Path Selection: subpaths `list` (indices) moved by (dx, dy) with their handles. */
export function moveSubpaths(path, list, dx, dy) {
  const pick = new Set(list);
  return {
    ...path,
    subpaths: path.subpaths.map((sp, s) =>
      pick.has(s) ? { ...sp, anchors: sp.anchors.map((a) => shifted(a, dx, dy)) } : sp
    )
  };
}

/** Direct Selection: anchors `list` ([s, k] pairs) moved by (dx, dy) with their handles. */
export function moveAnchors(path, list, dx, dy) {
  const pick = new Set(list.map(([s, k]) => `${s},${k}`));
  return {
    ...path,
    subpaths: path.subpaths.map((sp, s) => ({
      ...sp,
      anchors: sp.anchors.map((a, k) => (pick.has(`${s},${k}`) ? shifted(a, dx, dy) : a))
    }))
  };
}

/**
 * Put handle `h` of anchor [s, k] at (x, y). A smooth point turns its other handle to stay
 * collinear, keeping its length, unless `independent` (⌥ / Convert Point) makes it a corner.
 */
export function moveHandle(path, s, k, h, x, y, independent = false) {
  return mapAnchor(path, s, k, (a) => {
    const smooth = !independent && isSmoothAnchor(a);
    const next = { ...a, [h]: [x, y] };
    if (!smooth) return next;
    const o = h === 'in' ? 'out' : 'in';
    const len = Math.hypot(a[o][0] - a.x, a[o][1] - a.y);
    const d = Math.hypot(x - a.x, y - a.y);
    if (d > 1e-9) next[o] = [a.x - ((x - a.x) / d) * len, a.y - ((y - a.y) / d) * len];
    return next;
  });
}

/**
 * Direct Selection on a segment: drag the segment leaving [s, k] at t by (dx, dy). A straight
 * segment moves with its two anchors; a curve reshapes so the point at t follows the pointer,
 * the nearer handle moving more (edit.rs bend_segment). Smooth end points stay smooth.
 */
export function bendSegment(path, s, k, t, dx, dy) {
  const sp = path?.subpaths[s];
  const e = segmentEnd(sp, k);
  if (e < 0) return path;
  const a = sp.anchors[k],
    b = sp.anchors[e];
  if (retracted(a, 'out') && retracted(b, 'in')) {
    return moveAnchors(
      path,
      [
        [s, k],
        [s, e]
      ],
      dx,
      dy
    );
  }
  const tt = Number.isFinite(t) ? Math.min(0.95, Math.max(0.05, t)) : 0.5;
  const u = 1 - tt;
  const f = 1 / (3 * tt * u * (u * u + tt * tt));
  const w1 = u * f,
    w2 = tt * f;
  let out = moveHandle(path, s, k, 'out', a.out[0] + dx * w1, a.out[1] + dy * w1);
  out = moveHandle(out, s, e, 'in', b.in[0] + dx * w2, b.in[1] + dy * w2);
  return out;
}

const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/**
 * Add Anchor Point: split the segment leaving [s, k] at t (0 < t < 1). A curve is split by
 * de Casteljau, so the shape does not change and the new anchor is smooth; a straight segment
 * gets a corner on the line. Returns { path, anchor: [s, index] } or null when nothing changed.
 */
export function addAnchor(path, s, k, t) {
  const sp = path?.subpaths[s];
  const e = segmentEnd(sp, k);
  if (e < 0 || !(t > 0 && t < 1)) return null;
  const a = sp.anchors[k],
    b = sp.anchors[e];
  const anchors = sp.anchors.slice();
  let add;
  if (retracted(a, 'out') && retracted(b, 'in')) {
    const [x, y] = segmentPoint(a, b, t);
    add = cornerAnchor(x, y);
  } else {
    const p0 = [a.x, a.y],
      p3 = [b.x, b.y];
    const p01 = lerp(p0, a.out, t),
      p12 = lerp(a.out, b.in, t),
      p23 = lerp(b.in, p3, t);
    const p012 = lerp(p01, p12, t),
      p123 = lerp(p12, p23, t);
    const [x, y] = lerp(p012, p123, t);
    anchors[k] = { ...a, out: p01 };
    anchors[e] = { ...anchors[e], in: p23 };
    add = { x, y, in: p012, out: p123 };
  }
  anchors.splice(k + 1, 0, add);
  const subpaths = path.subpaths.slice();
  subpaths[s] = { ...sp, anchors };
  return { path: { ...path, subpaths }, anchor: [s, k + 1] };
}

/**
 * Delete Anchor Point: remove anchor [s, k]; its neighbours join with one segment keeping the
 * previous out handle and the next in handle. A subpath's last anchor takes the subpath with it.
 * The path's only anchor is refused (null): delete the path instead.
 */
export function deleteAnchor(path, s, k) {
  const sp = path?.subpaths[s];
  if (!sp?.anchors[k]) return null;
  const total = path.subpaths.reduce((n, p) => n + p.anchors.length, 0);
  if (total <= 1) return null;
  const subpaths = path.subpaths.slice();
  if (sp.anchors.length <= 1) subpaths.splice(s, 1);
  else subpaths[s] = { ...sp, anchors: sp.anchors.filter((_, i) => i !== k) };
  return { ...path, subpaths };
}

/**
 * Convert Point: with no `out`, anchor [s, k] becomes a corner with both handles on the anchor (a
 * click); with `out` [x, y], a smooth point with that out handle and its mirror (a drag).
 */
export function convertPoint(path, s, k, out = null) {
  return mapAnchor(path, s, k, (a) =>
    out
      ? { x: a.x, y: a.y, in: [2 * a.x - out[0], 2 * a.y - out[1]], out: [out[0], out[1]] }
      : cornerAnchor(a.x, a.y)
  );
}

/** Anchors inside the box (a Direct Selection marquee), in path order. */
export function anchorsInBox(path, x0, y0, x1, y1) {
  const lx = Math.min(x0, x1),
    hx = Math.max(x0, x1),
    ly = Math.min(y0, y1),
    hy = Math.max(y0, y1);
  const out = [];
  (path?.subpaths ?? []).forEach((sp, s) =>
    sp.anchors.forEach((a, k) => {
      if (a.x >= lx && a.x <= hx && a.y >= ly && a.y <= hy) out.push([s, k]);
    })
  );
  return out;
}

/** Every anchor of subpath s (⌥-click with Direct Selection). */
export function subpathAnchors(path, s) {
  return (path?.subpaths[s]?.anchors ?? []).map((_, k) => [s, k]);
}

/**
 * The handles a Direct Selection overlay shows: those of each selected anchor that are pulled
 * out (a retracted handle sits on its anchor, so a press there takes the anchor).
 */
export function shownHandles(path, selected) {
  return selected.flatMap(([s, k]) => {
    const a = path?.subpaths[s]?.anchors[k];
    return a ? ['in', 'out'].filter((h) => !retracted(a, h)).map((h) => [s, k, h]) : [];
  });
}

// ── Make Work Path from Selection ────────────────────────────────────────────

// Douglas–Peucker over pts[i..j] (open), pushing kept indices.
function simplifyRun(pts, i, j, tol, keep) {
  const [ax, ay] = pts[i],
    [bx, by] = pts[j];
  const len = Math.hypot(bx - ax, by - ay);
  let far = -1,
    best = tol;
  for (let k = i + 1; k < j; k++) {
    const [px, py] = pts[k];
    const d =
      len > 0
        ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
        : Math.hypot(px - ax, py - ay);
    if (d > best) {
      best = d;
      far = k;
    }
  }
  if (far < 0) return;
  simplifyRun(pts, i, far, tol, keep);
  keep.push(far);
  simplifyRun(pts, far, j, tol, keep);
}

/** A closed ring with points that stray no more than `tol` px from the original dropped. */
export function simplifyRing(pts, tol) {
  if (pts.length <= 3) return pts.slice();
  let far = 1,
    best = -1;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]);
    if (d > best) {
      best = d;
      far = k;
    }
  }
  const ring = [...pts, pts[0]];
  const keep = [0];
  simplifyRun(ring, 0, far, tol, keep);
  keep.push(far);
  simplifyRun(ring, far, pts.length, tol, keep);
  return keep.map((k) => pts[k]);
}

/**
 * The outlines of a 0/1 mask as closed rings of pixel-corner points, each pixel's edge walked
 * clockwise (holes come out the other way), straight runs merged into one segment.
 */
export function traceMask(mask, W, H) {
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  const V = W + 1;
  const edges = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = y0 * V + x0;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(y1 * V + x1);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!on(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const rings = [];
  for (const [start, outs] of edges) {
    while (outs.length) {
      const ring = [start];
      let v = outs.pop();
      while (v !== start) {
        ring.push(v);
        const next = edges.get(v);
        if (!next?.length) break;
        v = next.pop();
      }
      const pts = ring.map((k) => [k % V, Math.floor(k / V)]);
      // Keep only the corners.
      const corners = pts.filter((p, i) => {
        const a = pts[(i + pts.length - 1) % pts.length],
          b = pts[(i + 1) % pts.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      if (corners.length >= 3) rings.push(corners);
    }
  }
  return rings;
}

/** Make Work Path from Selection: the selection's outlines as corner anchors (tolerance px). */
export function selectionToPath(mask, W, H, tolerance = 2) {
  const tol = Math.max(0.5, Math.min(10, Number(tolerance) || 2));
  const subpaths = traceMask(mask, W, H).map((ring) => ({
    closed: true,
    anchors: simplifyRing(ring, tol).map(([x, y]) => cornerAnchor(x, y))
  }));
  return { name: WORK_PATH_NAME, subpaths };
}

// ── Panel state and .paintproj ───────────────────────────────────────────────

/** A document's paths: the Work Path (or null), the saved paths, and the targeted row. */
export function emptyPaths() {
  return { work: null, saved: [], target: null };
}

/** The targeted path: 'work' is the Work Path, a number a saved path, null none. */
export function targetPath(paths) {
  if (paths?.target === 'work') return paths.work;
  return typeof paths?.target === 'number' ? (paths.saved[paths.target] ?? null) : null;
}

/** paths with the targeted path replaced by `path` (a missing target becomes the Work Path). */
export function withTargetPath(paths, path) {
  if (typeof paths.target === 'number' && paths.saved[paths.target]) {
    const saved = paths.saved.slice();
    saved[paths.target] = path;
    return { ...paths, saved };
  }
  return { ...paths, work: { ...path, name: WORK_PATH_NAME }, target: 'work' };
}

/**
 * The New Path button: a targeted Work Path is saved as "Path N"; otherwise an empty "Path N" is
 * added. Either way the new saved path is targeted.
 */
export function newPath(paths) {
  const name = nextPathName(paths.saved);
  if (paths.target === 'work' && paths.work) {
    const saved = [...paths.saved, { ...paths.work, name }];
    return { work: null, saved, target: paths.saved.length };
  }
  return { ...paths, saved: [...paths.saved, emptyPath(name)], target: paths.saved.length };
}

/**
 * Double-click rename (path.rename): `key` 'work' saves the Work Path under `name`; a saved index
 * renames that path. Either way the renamed path is targeted. A blank name, an unchanged saved
 * name, or a missing path returns `paths` itself.
 */
export function renamePath(paths, key, name) {
  const next = String(name ?? '').trim();
  if (!next) return paths;
  if (key === 'work') {
    if (!paths.work) return paths;
    const saved = [...paths.saved, { ...paths.work, name: next }];
    return { work: null, saved, target: paths.saved.length };
  }
  const path = typeof key === 'number' ? paths.saved[key] : null;
  if (!path || path.name === next) return paths;
  const saved = paths.saved.slice();
  saved[key] = { ...path, name: next };
  return { ...paths, saved, target: key };
}

/** The first free "<name> copy N" (N ≥ 1) among the saved paths. */
export function duplicatePathName(saved, name) {
  const taken = new Set((saved ?? []).map((p) => p.name));
  let n = 1;
  while (taken.has(`${name} copy ${n}`)) n++;
  return `${name} copy ${n}`;
}

/** Duplicate Path: a copy of saved path `key` is appended; the Work Path and target stay. */
export function duplicatePath(paths, key) {
  const path = typeof key === 'number' ? paths.saved[key] : null;
  if (!path) return paths;
  const copy = { ...path, name: duplicatePathName(paths.saved, path.name) };
  return { ...paths, saved: [...paths.saved, copy] };
}

/** A path row's right-click menu (vector_ui.rs path_context_actions), in PhotoCraft order. */
export function pathRowActions(key) {
  const own =
    key === 'work'
      ? [{ action: 'save', label: 'Save Path' }]
      : [
          { action: 'duplicate', label: 'Duplicate Path' },
          { action: 'rename', label: 'Rename Path…' }
        ];
  return [
    { action: 'load', label: 'Make Selection' },
    { action: 'fill', label: 'Fill Path' },
    { action: 'stroke', label: 'Stroke Path…' },
    ...own,
    { action: 'delete', label: 'Delete Path' }
  ];
}

/** The Delete Path button: the targeted path goes and nothing is targeted. */
export function deleteTargetPath(paths) {
  if (paths.target === 'work') return { ...paths, work: null, target: null };
  if (typeof paths.target !== 'number') return paths;
  return { ...paths, saved: paths.saved.filter((_, i) => i !== paths.target), target: null };
}

const finite = (v) => (Number.isFinite(v) ? v : 0);
const pair = (p, x, y) =>
  Array.isArray(p) && p.length === 2 ? [finite(Number(p[0])), finite(Number(p[1]))] : [x, y];

function readPath(p, name) {
  if (!p || !Array.isArray(p.subpaths)) return null;
  return {
    name: typeof p.name === 'string' && p.name ? p.name : name,
    subpaths: p.subpaths
      .filter((sp) => sp && Array.isArray(sp.anchors))
      .map((sp) => ({
        closed: !!sp.closed,
        anchors: sp.anchors.map((a) => {
          const x = finite(Number(a?.x)),
            y = finite(Number(a?.y));
          return { x, y, in: pair(a?.in, x, y), out: pair(a?.out, x, y) };
        })
      }))
  };
}

/** .paintproj form, or null when there are no paths. */
export function serializePaths(paths) {
  if (!paths || (!paths.work && !paths.saved.length)) return null;
  return { work: paths.work, saved: paths.saved };
}

/** Paths from a .paintproj; older files have none. */
export function deserializePaths(saved) {
  if (!saved || typeof saved !== 'object') return emptyPaths();
  const work = readPath(saved.work, WORK_PATH_NAME);
  const list = Array.isArray(saved.saved) ? saved.saved : [];
  return {
    work: work && { ...work, name: WORK_PATH_NAME },
    saved: list.map((p, i) => readPath(p, `Path ${i + 1}`)).filter(Boolean),
    target: null
  };
}

// ── Overlay and panel ────────────────────────────────────────────────────────

/**
 * Draw a path's outline and anchors on the overlay; `rubber` is the Pen's next-segment preview.
 * `selected` anchors ([s, k], Direct Selection) are filled and show their handles.
 */
export function drawPathOverlay(ov, path, px = 1, rubber = null, selected = []) {
  if (!path) return;
  ov.save();
  ov.lineWidth = px;
  ov.strokeStyle = '#378ef0';
  ov.beginPath();
  for (const poly of pathToPolygon(path, 0.5 * px)) {
    ov.moveTo(poly[0][0], poly[0][1]);
    for (const [x, y] of poly) ov.lineTo(x, y);
  }
  path.subpaths.forEach((sp) => {
    if (sp.closed && sp.anchors.length) ov.lineTo(sp.anchors[0].x, sp.anchors[0].y);
  });
  if (rubber) {
    const sp = path.subpaths[path.subpaths.length - 1];
    const a = sp?.anchors[sp.anchors.length - 1];
    if (a && !sp.closed) {
      ov.moveTo(a.x, a.y);
      ov.bezierCurveTo(a.out[0], a.out[1], rubber[0], rubber[1], rubber[0], rubber[1]);
    }
  }
  ov.stroke();
  const s = 3 * px;
  const pick = new Set(selected.map(([i, k]) => `${i},${k}`));
  ov.fillStyle = '#378ef0';
  path.subpaths.forEach((sp, i) =>
    sp.anchors.forEach((a, k) => {
      if (!pick.has(`${i},${k}`)) return;
      ov.beginPath();
      ov.moveTo(a.in[0], a.in[1]);
      ov.lineTo(a.x, a.y);
      ov.lineTo(a.out[0], a.out[1]);
      ov.stroke();
      for (const [hx, hy] of [a.in, a.out]) {
        ov.beginPath();
        ov.arc(hx, hy, 2.5 * px, 0, 2 * Math.PI);
        ov.fill();
      }
    })
  );
  path.subpaths.forEach((sp, i) =>
    sp.anchors.forEach((a, k) => {
      ov.fillStyle = pick.has(`${i},${k}`) ? '#378ef0' : '#fff';
      ov.fillRect(a.x - s, a.y - s, 2 * s, 2 * s);
      ov.strokeRect(a.x - s, a.y - s, 2 * s, 2 * s);
    })
  );
  ov.restore();
}

// vector_ui.rs PathRename: the row's label becomes a text field until Enter, blur, or Escape.
/**
 * A path's outline fitted into a size × size thumbnail at the document's aspect ratio, centred
 * (vector_ui.rs thumb()): [{ points, closed }] per non-empty subpath.
 */
export function pathThumbLines(path, W, H, size) {
  if (!(W > 0) || !(H > 0)) return [];
  const s = Math.min(size / W, size / H);
  const ox = (size - W * s) / 2,
    oy = (size - H * s) / 2;
  const subpaths = (path?.subpaths ?? []).filter((sp) => sp.anchors.length);
  return pathToPolygon(path).map((poly, i) => ({
    points: poly.map(([x, y]) => [ox + x * s, oy + y * s]),
    closed: !!subpaths[i].closed
  }));
}

/** channels_panel load_operation: Shift adds, Alt subtracts, Shift+Alt intersects. */
export function pathLoadMode(e) {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return 'replace';
}

export { renderPathsPanel } from './paths-panel.js';
