// Paint — Layer › Combine Shapes and Layer › Vector Mask (PhotoCraft engine vector_cmds.rs
// combine_shapes / merge_components / vector_mask_*, vector raster.rs inside, lib.rs
// CompiledVectorMask).
//
// A subpath may carry op: 'combine' | 'subtract' | 'intersect' | 'exclude'. The path's components
// apply in order (the first always combines, raster.rs inside); a subpath without an op joins the
// component before it, even-odd, so a path with no ops fills exactly as before. Merge Shape
// Components bakes the ops into plain outlines traced from the combined coverage.
//
// A vector mask is layer.vectorMask = { path, inverted, enabled }: the path's anti-aliased
// coverage hides the layer outside it. An empty path reveals all (Hide All is the empty path
// inverted). Records are never mutated; every command returns a new one.

import { cornerAnchor, pathToPolygon, simplifyRing, traceMask } from './paths.js';

export const PATH_OPS = ['combine', 'subtract', 'intersect', 'exclude'];

/** Layer › Combine Shapes command suffixes and the op each sets (vector_cmds.rs specs). */
export const COMBINE_SHAPE_OPS = [
  ['unite', 'combine', 'Unite Shapes'],
  ['subtractFrontShape', 'subtract', 'Subtract Front Shape'],
  ['intersectShapeAreas', 'intersect', 'Intersect Shape Areas'],
  ['excludeOverlappingShapes', 'exclude', 'Exclude Overlapping Shapes']
];

/** True when some subpath after the first carries an op (the fill follows the op rules). */
export function hasPathOps(path) {
  return !!path?.subpaths?.some((sp, i) => i > 0 && PATH_OPS.includes(sp.op));
}

const copySubpath = (sp, op = sp.op) => ({
  closed: sp.closed,
  ...(PATH_OPS.includes(op) ? { op } : {}),
  anchors: sp.anchors.map((a) => ({ x: a.x, y: a.y, in: [...a.in], out: [...a.out] }))
});

/**
 * One shape layer's Combine Shapes (shape.edit op): every subpath but the first takes `op`.
 */
export function setComponentOps(path, op) {
  return {
    name: path.name,
    subpaths: path.subpaths.map((sp, i) => copySubpath(sp, i === 0 ? sp.op : op))
  };
}

/**
 * Several shape layers' Combine Shapes (merge_shape_layers): their paths bottom-to-top as one.
 * The bottom path keeps its ops; every subpath of the paths above takes `op`, or with op null
 * (Merge Shape Components) each path's first subpath combines and the rest keep their own.
 */
export function combinePaths(paths, op) {
  const [first, ...rest] = paths;
  const subpaths = first.subpaths.map((sp) => copySubpath(sp));
  for (const p of rest) {
    p.subpaths.forEach((sp, j) => {
      subpaths.push(copySubpath(sp, op ?? (j === 0 ? 'combine' : sp.op)));
    });
  }
  return { name: first.name, subpaths };
}

// ── Scanline booleans ────────────────────────────────────────────────────────

/** The path's components: [{ op, polys }], polys flattened, joined subpaths in one component. */
function components(path, tolerance) {
  const out = [];
  for (const sp of path?.subpaths ?? []) {
    if (!sp.anchors.length) continue;
    const [poly] = pathToPolygon({ subpaths: [sp] }, tolerance);
    if (out.length && !PATH_OPS.includes(sp.op)) out[out.length - 1].polys.push(poly);
    else out.push({ op: out.length ? sp.op : 'combine', polys: [poly] });
  }
  return out;
}

/** Even-odd inside intervals [[a, b], …] of polygons on the horizontal line y. */
function ringSpans(polys, y) {
  const xs = [];
  for (const poly of polys) {
    if (poly.length < 3) continue;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
  }
  xs.sort((a, b) => a - b);
  const spans = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] > xs[i]) spans.push([xs[i], xs[i + 1]]);
  return spans;
}

const within = (spans, x) => spans.some(([a, b]) => x >= a && x < b);

/** Interval boolean of two sorted span lists (raster.rs inside, one row). */
export function combineSpans(a, b, op) {
  const ts = [...new Set([...a.flat(), ...b.flat()])].sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const m = (ts[i] + ts[i + 1]) / 2;
    const u = within(a, m),
      v = within(b, m);
    const on =
      op === 'subtract' ? u && !v : op === 'intersect' ? u && v : op === 'exclude' ? u !== v : u || v;
    if (!on) continue;
    const last = out[out.length - 1];
    if (last && last[1] === ts[i]) last[1] = ts[i + 1];
    else out.push([ts[i], ts[i + 1]]);
  }
  return out;
}

function rowSpans(comps, y) {
  let acc = [];
  for (const c of comps) acc = combineSpans(acc, ringSpans(c.polys, y), c.op);
  return acc;
}

/**
 * The combined fill of a path with its ops as a 0/1 mask (y * W + x), each pixel sampled at its
 * centre, so a square from (0, 0) to (10, 10) covers exactly 100 pixels.
 */
export function pathOpsMask(path, W, H, tolerance = 0.25) {
  const mask = new Uint8Array(W * H);
  const comps = components(path, tolerance);
  if (!comps.length) return mask;
  for (let y = 0; y < H; y++) {
    for (const [a, b] of rowSpans(comps, y + 0.5)) {
      const x0 = Math.max(0, Math.ceil(a - 0.5));
      const x1 = Math.min(W, Math.ceil(b - 0.5));
      mask.fill(1, y * W + x0, y * W + Math.max(x0, x1));
    }
  }
  return mask;
}

/**
 * Anti-aliased coverage 0…255 (y * W + x) of a path with its ops: four sample rows per pixel,
 * each span's exact horizontal overlap. `inverted` swaps inside and outside.
 */
export function pathCoverage(path, W, H, inverted = false, tolerance = 0.25) {
  const SUB = 4;
  const acc = new Float32Array(W * H);
  const comps = components(path, tolerance);
  for (let y = 0; y < H && comps.length; y++) {
    for (let k = 0; k < SUB; k++) {
      for (const [sa, sb] of rowSpans(comps, y + (k + 0.5) / SUB)) {
        const a = Math.max(0, sa),
          b = Math.min(W, sb);
        for (let x = Math.floor(a); x < b; x++) {
          acc[y * W + x] += Math.min(b, x + 1) - Math.max(a, x);
        }
      }
    }
  }
  const out = new Uint8Array(W * H);
  for (let p = 0; p < out.length; p++) {
    const v = Math.round((255 * Math.min(SUB, acc[p])) / SUB);
    out[p] = inverted ? 255 - v : v;
  }
  return out;
}

/** Signed shoelace area of one ring. */
export function ringArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** The area a path without ops encloses: its rings' signed areas summed (holes run backward). */
export function pathArea(path, tolerance = 0.25) {
  return Math.abs(pathToPolygon(path, tolerance).reduce((s, r) => s + ringArea(r), 0));
}

/**
 * Layer › Combine Shapes › Merge Shape Components (bake_components): the combined coverage traced
 * at `scale`× back into plain closed outlines, simplified within `tolerance` px. No ops remain.
 */
export function mergeShapeComponents(path, { scale = 4, tolerance = 0.1 } = {}) {
  const pts = (path?.subpaths ?? []).flatMap((sp) => sp.anchors.flatMap((a) => [[a.x, a.y], a.in, a.out]));
  if (!pts.length) return { name: path?.name ?? 'Shape Path', subpaths: [] };
  const bx = Math.floor(Math.min(...pts.map((p) => p[0]))) - 1;
  const by = Math.floor(Math.min(...pts.map((p) => p[1]))) - 1;
  const bw = Math.ceil(Math.max(...pts.map((p) => p[0]))) + 1 - bx;
  const bh = Math.ceil(Math.max(...pts.map((p) => p[1]))) + 1 - by;
  // Keep the trace under ~40 M samples.
  const K = Math.max(1, Math.min(scale, Math.floor(Math.sqrt(4e7 / Math.max(1, bw * bh)))));
  const map = ([x, y]) => [(x - bx) * K, (y - by) * K];
  const up = {
    subpaths: path.subpaths.map((sp) => ({
      closed: sp.closed,
      op: sp.op,
      anchors: sp.anchors.map((a) => {
        const [x, y] = map([a.x, a.y]);
        return { x, y, in: map(a.in), out: map(a.out) };
      })
    }))
  };
  const W = bw * K,
    H = bh * K;
  const rings = traceMask(pathOpsMask(up, W, H, 0.25 * K), W, H);
  return {
    name: path.name,
    subpaths: rings.map((ring) => ({
      closed: true,
      anchors: simplifyRing(ring, tolerance * K).map(([x, y]) => cornerAnchor(x / K + bx, y / K + by))
    }))
  };
}

// ── Vector masks ─────────────────────────────────────────────────────────────

/** A vector mask record: Reveal All (empty path), Hide All (empty, inverted), or a path. */
export function newVectorMask(kind, path = null) {
  const subpaths = kind === 'path' ? (path?.subpaths ?? []).map((sp) => copySubpath(sp)) : [];
  return {
    path: { name: 'Vector Mask', subpaths },
    inverted: kind === 'hideAll',
    enabled: true
  };
}

/** A complete vector mask from a saved one, or null (older files and layers have none). */
export function normalizeVectorMask(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.path?.subpaths)) return null;
  return {
    path: {
      name: 'Vector Mask',
      subpaths: v.path.subpaths
        .filter((sp) => sp && Array.isArray(sp.anchors))
        .map((sp) => copySubpath(sp))
    },
    inverted: v.inverted === true,
    enabled: v.enabled !== false
  };
}

// An empty path reveals all, unlike an empty fill path (lib.rs CompiledVectorMask::new).
function maskValues(vm, W, H) {
  const empty = !vm.path.subpaths.some((sp) => sp.anchors.length);
  return empty
    ? new Uint8Array(W * H).fill(vm.inverted ? 0 : 255)
    : pathCoverage(vm.path, W, H, vm.inverted);
}

/** True when the layer has a vector mask that is switched on. */
export function vectorMaskActive(layer) {
  return !!layer?.vectorMask && layer.vectorMask.enabled !== false;
}

/**
 * The vector mask's values 0…255 over the canvas (CompiledVectorMask::render), or null when the
 * layer has none or it is disabled. Cached on the layer per record and size.
 */
export function vectorMaskValues(layer, W, H) {
  if (!vectorMaskActive(layer)) return null;
  const vm = layer.vectorMask;
  const c = layer.vectorMaskCache;
  if (c && c.vm === vm && c.W === W && c.H === H) return c.out;
  const out = maskValues(vm, W, H);
  layer.vectorMaskCache = { vm, W, H, out };
  return out;
}

/** Two 0…255 masks multiplied (either may be null). */
export function multiplyMasks(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = new Uint8Array(a.length);
  for (let p = 0; p < out.length; p++) out[p] = Math.round((a[p] * b[p]) / 255);
  return out;
}

/**
 * Layer › Rasterize › Vector Mask: the layer's pixel mask (Reveal All when it has none) times
 * the vector mask's values. A disabled vector mask leaves the pixel mask as it is.
 */
export function rasterizeVectorMask(layer, W, H) {
  const base = layer.mask ?? new Uint8Array(W * H).fill(255);
  const vm = layer.vectorMask;
  if (!vm || vm.enabled === false) return base.slice();
  return multiplyMasks(base, maskValues(vm, W, H));
}

/**
 * What a Layer › Combine Shapes command does (combine_targets / merge_shape_layers): with two or
 * more shape layers in `ids`, they merge into the top-most ({ keep, path, remove }, bottom-to-top
 * as `layers` is); otherwise the active shape layer's own components take `op`. op null is Merge
 * Shape Components, which bakes the result. null when there is no shape layer to act on.
 */
export function combineShapesPlan(layers, ids, activeIdx, op) {
  const isShape = (l) => l?.kind === 'shape' && !!l.shape;
  const picked = layers.filter((l) => ids.has(l.id) && isShape(l));
  if (picked.length > 1) {
    const path = combinePaths(
      picked.map((l) => l.shape.path),
      op
    );
    return {
      keep: picked[picked.length - 1],
      path: op === null ? mergeShapeComponents(path) : path,
      remove: picked.slice(0, -1)
    };
  }
  const layer = layers[activeIdx];
  if (!isShape(layer)) return null;
  const path = layer.shape.path;
  return {
    keep: layer,
    path: op === null ? mergeShapeComponents(path) : setComponentOps(path, op),
    remove: []
  };
}
