// Paint — shape layers (PhotoCraft photocraft-vector shapes.rs, doc vector.rs ShapeLayer /
// LiveShape, engine presets/shapes.rs, edit.defineCustomShape, shape_options.rs).
//
// A shape layer keeps layer.shape = { path, fill, stroke, live }: path is a paths.js path, fill
// '#rrggbb' or null (no fill), stroke { color, width, align } or null, and live the parametric
// shape it came from (rect / ellipse / polygon / line) or null for a custom shape. Its pixels are
// drawn from the record until Layer › Rasterize › Shape. Records are never mutated; every edit
// returns a new one, so undo entries and .paintproj can keep the object they were given.

import { pathToPolygon, polygonsMask } from './paths.js';
import { isPixelSafeTool } from './layer-groups.js';
import { hasPathOps, pathCoverage, pathOpsMask } from './combine-shapes.js';
import { createLayer } from './layer-shell.js';

export const SHAPE_KIND = 'shape';

/** Handle length of a quarter-circle cubic, 4/3·(√2 − 1). */
export const KAPPA = 0.5522847498307934;

/** The Shape tools, in PhotoCraft's toolbox order (Tool::Rectangle … Tool::CustomShape). */
export const SHAPE_TOOLS = ['rect', 'ellipse', 'triangle', 'polygon', 'line', 'customShape'];

export const STROKE_ALIGNS = ['inside', 'center', 'outside'];

// PhotoCraft rasterize_prompt.rs Kind::Shape message.
export const RASTERIZE_SHAPE_MESSAGE =
  'This shape layer must be rasterized before proceeding. It will no longer be editable as a ' +
  'shape. Rasterize the shape?';

export function isShapeTool(toolId) {
  return SHAPE_TOOLS.includes(toolId);
}

export function isShapeLayer(layer) {
  return layer?.kind === SHAPE_KIND && !!layer.shape;
}

/**
 * True when toolId would paint the shape layer's pixels, so PhotoCraft asks to rasterize it
 * first. Selections, the eyedropper, the Move tool, and the Shape tools never do.
 */
export function shapeNeedsRasterize(layer, toolId) {
  return isShapeLayer(layer) && toolId !== 'select' && !isPixelSafeTool(toolId);
}

const finite = (v, d) => (Number.isFinite(v) ? v : d);
const anchor = (x, y, inc = [x, y], out = [x, y]) => ({ x, y, in: inc, out });
const closed = (anchors) => ({ name: 'Shape Path', subpaths: [{ closed: true, anchors }] });

/** Corner points as one closed subpath of corner anchors. */
export function polygonPath(pts) {
  return closed(pts.map(([x, y]) => anchor(x, y)));
}

// ── Geometry (shapes.rs) ─────────────────────────────────────────────────────

/** A rect drag from (x0, y0) to (x1, y1) as [x, y, w, h]; `square` keeps w = h (⇧). */
export function dragRect(x0, y0, x1, y1, square = false) {
  let w = x1 - x0,
    h = y1 - y0;
  if (square) {
    const s = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * s;
    h = Math.sign(h || 1) * s;
  }
  return [Math.min(x0, x0 + w), Math.min(y0, y0 + h), Math.abs(w), Math.abs(h)];
}

/**
 * Clamp corner radii [tl, tr, br, bl] so adjacent radii never exceed a side (scaled down
 * uniformly, like CSS border-radius).
 */
export function clampRadii(w, h, radii) {
  const r = radii.map((v) => Math.max(0, finite(v, 0)));
  let f = 1;
  for (const [a, b, side] of [
    [r[0], r[1], w],
    [r[1], r[2], h],
    [r[2], r[3], w],
    [r[3], r[0], h]
  ]) {
    if (a + b > side && a + b > 0) f = Math.min(f, side / (a + b));
  }
  return r.map((v) => v * f);
}

/** Rectangle [x, y, w, h] with corner radii [tl, tr, br, bl], clockwise from the top edge. */
export function rectPath(x, y, w, h, radii = [0, 0, 0, 0]) {
  const [tl, tr, br, bl] = clampRadii(w, h, radii);
  if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) {
    return polygonPath([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h]
    ]);
  }
  const x1 = x + w,
    y1 = y + h;
  const out = [];
  // Each corner's arc from the end of one edge to the start of the next (clockwise).
  const arc = (s, e, cs, ce, r) => {
    if (r <= 0) out.push(anchor(s[0], s[1]));
    else out.push(anchor(s[0], s[1], s, cs), anchor(e[0], e[1], ce, e));
  };
  arc([x1 - tr, y], [x1, y + tr], [x1 - tr + KAPPA * tr, y], [x1, y + tr - KAPPA * tr], tr);
  arc([x1, y1 - br], [x1 - br, y1], [x1, y1 - br + KAPPA * br], [x1 - br + KAPPA * br, y1], br);
  arc([x + bl, y1], [x, y1 - bl], [x + bl - KAPPA * bl, y1], [x, y1 - bl + KAPPA * bl], bl);
  arc([x, y + tl], [x + tl, y], [x, y + tl - KAPPA * tl], [x + tl - KAPPA * tl, y], tl);
  // Start at the top-left arc's end so the first anchor is on the top edge.
  out.unshift(out.pop());
  // Drop repeated anchors (zero-length straight edges), keeping the later out handle.
  const merged = [];
  for (const a of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.x - a.x) < 1e-12 && Math.abs(last.y - a.y) < 1e-12) {
      last.out = a.out;
    } else merged.push({ ...a });
  }
  const first = merged[0],
    last = merged[merged.length - 1];
  if (merged.length > 1 && Math.abs(first.x - last.x) < 1e-12 && Math.abs(first.y - last.y) < 1e-12) {
    first.in = last.in;
    merged.pop();
  }
  return closed(merged);
}

/** Ellipse inscribed in [x, y, w, h], four smooth anchors from the top. */
export function ellipsePath(x, y, w, h) {
  const rx = w / 2,
    ry = h / 2;
  const cx = x + rx,
    cy = y + ry;
  const kx = rx * KAPPA,
    ky = ry * KAPPA;
  return closed([
    anchor(cx, cy - ry, [cx - kx, cy - ry], [cx + kx, cy - ry]),
    anchor(cx + rx, cy, [cx + rx, cy - ky], [cx + rx, cy + ky]),
    anchor(cx, cy + ry, [cx + kx, cy + ry], [cx - kx, cy + ry]),
    anchor(cx - rx, cy, [cx - rx, cy + ky], [cx - rx, cy - ky])
  ]);
}

/**
 * The vertices of a regular polygon (or a star when 0 < starRatio < 1) inscribed in the ellipse
 * of [x, y, w, h], first vertex at the top, clockwise. A star has 2 × sides vertices, the odd
 * ones at starRatio of the outer radius. Sides clamp to 3…100.
 */
export function polygonPoints(x, y, w, h, sides, starRatio = 1) {
  const n = Math.min(100, Math.max(3, Math.round(finite(sides, 5))));
  const rx = w / 2,
    ry = h / 2;
  const cx = x + rx,
    cy = y + ry;
  const star = starRatio > 0 && starRatio < 1;
  const count = star ? n * 2 : n;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const k = star && i % 2 === 1 ? starRatio : 1;
    pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
  }
  return pts;
}

/**
 * A rounded vertex v between prev and next (shapes.rs fillet): the arc's centre, its tangent
 * points `from` / `to`, the radius used (capped so the tangent points stay within half of each
 * edge), and half the vertex's angle. null for r <= 0 or a degenerate vertex.
 */
export function fillet(prev, v, next, r) {
  if (!(r > 0)) return null;
  const unit = (a, b) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    return l > 1e-9 ? [[dx / l, dy / l], l] : null;
  };
  const e1 = unit(v, prev),
    e2 = unit(v, next);
  if (!e1 || !e2) return null;
  const [u1, l1] = e1,
    [u2, l2] = e2;
  const cos = Math.min(1, Math.max(-1, u1[0] * u2[0] + u1[1] * u2[1]));
  const half = Math.acos(cos) / 2;
  if (half < 1e-6 || half > Math.PI / 2 - 1e-6) return null;
  const radius = Math.min(r, (Math.min(l1, l2) / 2) * Math.tan(half));
  const t = radius / Math.tan(half);
  const bx = u1[0] + u2[0],
    by = u1[1] + u2[1];
  const bl = Math.hypot(bx, by);
  if (bl < 1e-9) return null;
  const c = radius / Math.sin(half);
  return {
    centre: [v[0] + (bx / bl) * c, v[1] + (by / bl) * c],
    from: [v[0] + u1[0] * t, v[1] + u1[1] * t],
    to: [v[0] + u2[0] * t, v[1] + u2[1] * t],
    radius,
    halfAngle: half
  };
}

/** Corner points as a closed path with every vertex rounded by radius r (shapes.rs round_corners). */
export function roundedPolygonPath(pts, r) {
  if (!(r > 0)) return polygonPath(pts);
  const n = pts.length;
  const anchors = [];
  for (let i = 0; i < n; i++) {
    const v = pts[i];
    const f = fillet(pts[(i + n - 1) % n], v, pts[(i + 1) % n], r);
    if (!f) {
      anchors.push(anchor(v[0], v[1]));
      continue;
    }
    // The arc as one cubic: handles 4/3 tan(sweep / 4) r long, along the tangents to the vertex.
    const sweep = Math.PI - 2 * f.halfAngle;
    const hl = (4 / 3) * Math.tan(sweep / 4) * f.radius;
    const toward = (a) => {
      const dx = v[0] - a[0],
        dy = v[1] - a[1];
      const l = Math.max(1e-12, Math.hypot(dx, dy));
      return [a[0] + (dx / l) * hl, a[1] + (dy / l) * hl];
    };
    anchors.push(anchor(f.from[0], f.from[1], f.from, toward(f.from)));
    anchors.push(anchor(f.to[0], f.to[1], toward(f.to), f.to));
  }
  return closed(anchors);
}

/** A line from a to b as a filled bar `weight` px thick. */
export function linePath(a, b, weight) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  const hw = Math.max(0, weight) / 2;
  const [nx, ny] = l > 0 ? [(-dy / l) * hw, (dx / l) * hw] : [0, hw];
  return polygonPath([
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny]
  ]);
}

/** The path of a live shape (shapes.rs live_path). */
export function livePath(live) {
  if (live.kind === 'line') return linePath(live.from, live.to, live.weight);
  const [x, y, w, h] = live.rect;
  if (live.kind === 'ellipse') return ellipsePath(x, y, w, h);
  if (live.kind === 'polygon') {
    const pts = polygonPoints(x, y, w, h, live.sides, live.starRatio);
    return roundedPolygonPath(pts, live.cornerRadius);
  }
  return rectPath(x, y, w, h, live.radii);
}

// ── Custom shapes (presets/shapes.rs) ────────────────────────────────────────

/**
 * Parse PhotoCraft's preset path source: M x y, L x y, C x1 y1 x2 y2 x y, Z, and O cx cy r (a
 * circle subpath). Returns a path, or null on a malformed source.
 */
export function parseShapeSource(src) {
  const tok = String(src).trim().split(/[\s,]+/);
  const subpaths = [];
  let cur = null;
  let i = 0;
  const num = () => {
    const v = Number(tok[i++]);
    if (!Number.isFinite(v)) throw new Error('bad number');
    return v;
  };
  const end = (close) => {
    if (cur?.anchors.length) {
      const a = cur.anchors,
        first = a[0],
        last = a[a.length - 1];
      // A closing point on the start folds into it (its in handle survives).
      if (close && a.length > 1 && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
        first.in = last.in;
        a.pop();
      }
      cur.closed = close;
      subpaths.push(cur);
    }
    cur = null;
  };
  try {
    while (i < tok.length) {
      const op = tok[i++];
      if (op === 'M') {
        end(false);
        const x = num(),
          y = num();
        cur = { closed: false, anchors: [anchor(x, y)] };
      } else if (op === 'L' && cur) {
        const x = num(),
          y = num();
        cur.anchors.push(anchor(x, y));
      } else if (op === 'C' && cur) {
        const c1 = [num(), num()],
          c2 = [num(), num()],
          x = num(),
          y = num();
        cur.anchors[cur.anchors.length - 1].out = c1;
        cur.anchors.push(anchor(x, y, c2, [x, y]));
      } else if (op === 'Z') {
        end(true);
      } else if (op === 'O') {
        end(false);
        const cx = num(),
          cy = num(),
          r = num();
        subpaths.push(ellipsePath(cx - r, cy - r, 2 * r, 2 * r).subpaths[0]);
      } else if (op === '!' || op === '') {
        continue;
      } else return null;
    }
  } catch {
    return null;
  }
  end(false);
  return subpaths.length ? { name: 'Shape Path', subpaths } : null;
}

function starSource(n, ratio) {
  const parts = [];
  for (let k = 0; k < 2 * n; k++) {
    const r = k % 2 === 0 ? 50 : 50 * ratio;
    const a = (Math.PI * k) / n - Math.PI / 2;
    parts.push(`${k ? 'L' : 'M'} ${50 + r * Math.cos(a)} ${50 + r * Math.sin(a)}`);
  }
  return parts.join(' ') + ' Z';
}

// PhotoCraft's built-in groups (presets/shapes.rs builtin), in the 100 × 100 box.
const BUILTIN_SOURCES = [
  [
    'Symbols',
    [
      [
        'Heart',
        'M 50 92 C 20 70 0 52 0 30 C 0 12 14 0 28 0 C 40 0 47 8 50 16 C 53 8 60 0 72 0 C 86 0 100 12 100 30 C 100 52 80 70 50 92 Z'
      ],
      ['Star', starSource(5, 0.4)],
      ['Six-Point Star', starSource(6, 0.55)],
      ['Burst', starSource(16, 0.72)],
      ['Check Mark', 'M 5 55 L 20 40 L 38 58 L 82 12 L 97 27 L 38 88 Z'],
      [
        'Cross',
        'M 20 5 L 50 35 L 80 5 L 95 20 L 65 50 L 95 80 L 80 95 L 50 65 L 20 95 L 5 80 L 35 50 L 5 20 Z'
      ],
      [
        'Plus',
        'M 38 0 L 62 0 L 62 38 L 100 38 L 100 62 L 62 62 L 62 100 L 38 100 L 38 62 L 0 62 L 0 38 L 38 38 Z'
      ],
      ['Ring', 'O 50 50 50 ! O 50 50 32'],
      ['Lightning', 'M 58 0 L 18 56 L 44 56 L 34 100 L 82 38 L 55 38 L 70 0 Z'],
      ['Diamond', 'M 50 0 L 90 50 L 50 100 L 10 50 Z']
    ]
  ],
  [
    'Arrows',
    [
      ['Arrow Right', 'M 0 35 L 55 35 L 55 15 L 100 50 L 55 85 L 55 65 L 0 65 Z'],
      ['Arrow Left', 'M 100 35 L 45 35 L 45 15 L 0 50 L 45 85 L 45 65 L 100 65 Z'],
      ['Arrow Up', 'M 35 100 L 35 45 L 15 45 L 50 0 L 85 45 L 65 45 L 65 100 Z'],
      ['Arrow Down', 'M 35 0 L 35 55 L 15 55 L 50 100 L 85 55 L 65 55 L 65 0 Z'],
      [
        'Double Arrow',
        'M 0 50 L 25 20 L 25 38 L 75 38 L 75 20 L 100 50 L 75 80 L 75 62 L 25 62 L 25 80 Z'
      ],
      ['Chevron', 'M 10 0 L 45 0 L 95 50 L 45 100 L 10 100 L 60 50 Z']
    ]
  ],
  [
    'Nature',
    [
      [
        'Cloud',
        'M 25 80 C 10 80 0 70 0 58 C 0 46 10 37 22 37 C 24 20 38 10 54 10 C 70 10 82 20 85 34 C 95 35 100 45 100 57 C 100 70 90 80 78 80 Z'
      ],
      [
        'Raindrop',
        'M 50 0 C 60 25 85 45 85 68 C 85 87 69 100 50 100 C 31 100 15 87 15 68 C 15 45 40 25 50 0 Z'
      ],
      [
        'Tree',
        'M 50 0 L 85 45 L 68 45 L 92 75 L 56 75 L 56 100 L 44 100 L 44 75 L 8 75 L 32 45 L 15 45 Z'
      ]
    ]
  ]
];

export const CUSTOM_SHAPE_GROUP = 'Custom';
export const DEFAULT_CUSTOM_SHAPE = 'Heart';

export const BUILTIN_SHAPE_GROUPS = BUILTIN_SOURCES.map(([name, items]) => ({
  name,
  items: items.map(([n, src]) => ({ name: n, path: parseShapeSource(src) }))
}));

/** Every group the Shapes panel shows: the built-ins, then Define Custom Shape results. */
export function shapeGroups(custom = []) {
  return custom.length
    ? [...BUILTIN_SHAPE_GROUPS, { name: CUSTOM_SHAPE_GROUP, items: custom }]
    : BUILTIN_SHAPE_GROUPS;
}

/** The named shape among the built-ins and `custom`, or null. */
export function findCustomShape(name, custom = []) {
  for (const g of shapeGroups(custom)) {
    const hit = g.items.find((s) => s.name === name);
    if (hit) return hit;
  }
  return null;
}

/** Every shape name, panel order. */
export function customShapeNames(custom = []) {
  return shapeGroups(custom).flatMap((g) => g.items.map((s) => s.name));
}

/**
 * Edit › Define Custom Shape…: `path` saved under `name` (blank → "Shape N"); a name already
 * taken is replaced (edit_menu_cmds.rs define_custom_shape). Returns { list, name }, or null
 * when the path has no anchors.
 */
export function defineCustomShape(list, path, name = '') {
  const subpaths = (path?.subpaths ?? []).filter((sp) => sp.anchors.length);
  if (!subpaths.length) return null;
  const n = String(name ?? '').trim() || `Shape ${list.length + 1}`;
  const entry = { name: n, path: clonePath({ name: n, subpaths }) };
  const at = list.findIndex((s) => s.name === n);
  const next = at >= 0 ? list.map((s, i) => (i === at ? entry : s)) : [...list, entry];
  return { list: next, name: n };
}

/** Control-point bounds [x0, y0, x1, y1] of a path, or null when it is empty. */
export function pathBounds(path) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const sp of path?.subpaths ?? []) {
    for (const a of sp.anchors) {
      for (const [x, y] of [[a.x, a.y], a.in, a.out]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x0 <= x1 ? [x0, y0, x1, y1] : null;
}

/** Map `path` (its control bounds) onto rect [x, y, w, h]; `keep` keeps its aspect, centred. */
export function fitPath(path, rect, keep = false) {
  const b = pathBounds(path);
  if (!b) return clonePath(path);
  const bw = Math.max(1e-9, b[2] - b[0]),
    bh = Math.max(1e-9, b[3] - b[1]);
  let sx = rect[2] / bw,
    sy = rect[3] / bh;
  let ox = rect[0],
    oy = rect[1];
  if (keep) {
    const k = Math.min(sx, sy);
    ox += (rect[2] - bw * k) / 2;
    oy += (rect[3] - bh * k) / 2;
    sx = sy = k;
  }
  const map = ([x, y]) => [ox + (x - b[0]) * sx, oy + (y - b[1]) * sy];
  return mapPath(path, map);
}

function mapPath(path, map) {
  return {
    name: path.name,
    subpaths: path.subpaths.map((sp) => ({
      closed: sp.closed,
      // Layer › Combine Shapes ops (combine-shapes.js) travel with the subpath.
      ...(sp.op ? { op: sp.op } : {}),
      anchors: sp.anchors.map((a) => {
        const [x, y] = map([a.x, a.y]);
        return { x, y, in: map(a.in), out: map(a.out) };
      })
    }))
  };
}

export function clonePath(path) {
  return mapPath(path ?? { name: 'Shape Path', subpaths: [] }, ([x, y]) => [x, y]);
}

/** A path moved by (dx, dy). */
export function translatePath(path, dx, dy) {
  return mapPath(path, ([x, y]) => [x + dx, y + dy]);
}

// ── Shape records ────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;

function normalizeLive(l) {
  if (!l || typeof l !== 'object') return null;
  const nums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  if (l.kind === 'line') {
    if (!nums(l.from, 2) || !nums(l.to, 2)) return null;
    return { kind: 'line', from: [...l.from], to: [...l.to], weight: Math.max(0, finite(l.weight, 3)) };
  }
  if (!nums(l.rect, 4)) return null;
  const rect = [...l.rect];
  if (l.kind === 'ellipse') return { kind: 'ellipse', rect };
  if (l.kind === 'polygon') {
    return {
      kind: 'polygon',
      rect,
      sides: Math.min(100, Math.max(3, Math.round(finite(l.sides, 5)))),
      starRatio: Math.min(1, Math.max(0.01, finite(l.starRatio, 1))),
      cornerRadius: Math.max(0, finite(l.cornerRadius, 0))
    };
  }
  if (l.kind === 'rect') {
    const radii = nums(l.radii, 4) ? l.radii.map((v) => Math.max(0, v)) : [0, 0, 0, 0];
    return { kind: 'rect', rect, radii };
  }
  return null;
}

function normalizeStroke(s) {
  if (!s || typeof s !== 'object') return null;
  const width = Math.min(288, Math.max(0, finite(s.width, 0)));
  if (width <= 0) return null;
  return {
    color: HEX.test(s.color) ? s.color.toLowerCase() : '#000000',
    width,
    align: STROKE_ALIGNS.includes(s.align) ? s.align : 'center'
  };
}

/** A complete shape record from a partial (or saved) one; null when it has no path. */
export function normalizeShape(s) {
  if (!s || typeof s !== 'object') return null;
  const live = normalizeLive(s.live);
  const path = live ? livePath(live) : s.path?.subpaths?.length ? clonePath(s.path) : null;
  if (!path) return null;
  return {
    path,
    fill: HEX.test(s.fill) ? s.fill.toLowerCase() : null,
    stroke: normalizeStroke(s.stroke),
    live
  };
}

/** .paintproj form: the record itself (pixels render again on load). */
export function shapeToJSON(s) {
  return normalizeShape(s);
}

/** The saved form back, or null when it is not a shape record (older files). */
export function shapeFromJSON(json) {
  return normalizeShape(json);
}

/**
 * The shape record a Shape tool drag from (x0, y0) to (x1, y1) makes with tool options `o`
 * (⇧ = `square`, a 1:1 box; for Line, 45° steps come from the caller). fill / stroke colors are
 * the options bar's wells. null for a drag too small to draw or an unknown custom shape.
 */
export function shapeFromDrag(tool, o, x0, y0, x1, y1, { square = false, custom = [] } = {}) {
  const paint = {
    fill: o.fill === false ? null : o.fillColor ?? '#000000',
    stroke:
      o.strokeWidth > 0
        ? { color: o.strokeColor ?? '#000000', width: o.strokeWidth, align: o.strokeAlign }
        : null
  };
  if (tool === 'line') {
    if (Math.hypot(x1 - x0, y1 - y0) < 1) return null;
    return normalizeShape({
      ...paint,
      live: { kind: 'line', from: [x0, y0], to: [x1, y1], weight: o.weight ?? 3 }
    });
  }
  const rect = dragRect(x0, y0, x1, y1, square);
  if (rect[2] < 1 || rect[3] < 1) return null;
  if (tool === 'customShape') {
    const preset = findCustomShape(o.shape ?? DEFAULT_CUSTOM_SHAPE, custom);
    if (!preset) return null;
    return normalizeShape({ ...paint, path: fitPath(preset.path, rect, square) });
  }
  const r = Math.max(0, o.radius ?? 0);
  const live =
    tool === 'ellipse'
      ? { kind: 'ellipse', rect }
      : tool === 'triangle'
      ? { kind: 'polygon', rect, sides: 3, starRatio: 1, cornerRadius: r }
      : tool === 'polygon'
      ? {
          kind: 'polygon',
          rect,
          sides: o.sides ?? 5,
          starRatio: (o.starRatio ?? 100) / 100,
          cornerRadius: 0
        }
      : { kind: 'rect', rect, radii: [r, r, r, r] };
  return normalizeShape({ ...paint, live });
}

/** PhotoCraft's default layer name base for a Shape tool (vector_cmds.rs default_name). */
export function shapeLayerBase(tool) {
  return tool === 'rect'
    ? 'Rectangle'
    : tool === 'ellipse'
    ? 'Ellipse'
    : tool === 'triangle' || tool === 'polygon'
    ? 'Polygon'
    : tool === 'line'
    ? 'Line'
    : 'Shape';
}

/** "<base> N" with the next N no layer name uses. */
export function nextShapeLayerName(base, layers = []) {
  const taken = new Set(layers.map((l) => l.name));
  let n = 1;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * An options-bar edit applied to a shape record (shape_options.rs → shape.edit): Fill, the
 * fill / stroke wells, stroke width and alignment, and the live geometry the shape has (Radius on
 * a rectangle or a triangle, Sides and Star on a polygon, Weight on a line). Returns the new
 * record, or the same one when the key does not apply to it. `wells` gives the colors a fill or
 * stroke that is switched on starts with ({ fillColor, strokeColor, strokeAlign }).
 */
export function editShape(s, key, value, wells = {}) {
  const live = s.live;
  const stroke = s.stroke ?? {
    color: wells.strokeColor ?? '#000000',
    width: 0,
    align: wells.strokeAlign ?? 'center'
  };
  const next = (patch) => normalizeShape({ ...s, ...patch });
  switch (key) {
    case 'fill':
      return next({ fill: value ? s.fill ?? wells.fillColor ?? '#000000' : null });
    case 'fillColor':
      return next({ fill: value });
    case 'strokeColor':
      return s.stroke ? next({ stroke: { ...stroke, color: value } }) : s;
    case 'strokeWidth':
      return next({ stroke: { ...stroke, width: value } });
    case 'strokeAlign':
      return s.stroke ? next({ stroke: { ...stroke, align: value } }) : s;
    case 'radius':
      if (live?.kind === 'rect') return next({ live: { ...live, radii: [value, value, value, value] } });
      if (live?.kind === 'polygon') return next({ live: { ...live, cornerRadius: value } });
      return s;
    case 'sides':
      return live?.kind === 'polygon' && live.sides !== 3
        ? next({ live: { ...live, sides: value } })
        : s;
    case 'starRatio':
      return live?.kind === 'polygon' && live.sides !== 3
        ? next({ live: { ...live, starRatio: value / 100 } })
        : s;
    case 'weight':
      return live?.kind === 'line' ? next({ live: { ...live, weight: value } }) : s;
    default:
      return s;
  }
}

/** A shape moved by (dx, dy), live geometry included. */
export function translateShape(s, dx, dy) {
  const l = s.live;
  const live = !l
    ? null
    : l.kind === 'line'
    ? { ...l, from: [l.from[0] + dx, l.from[1] + dy], to: [l.to[0] + dx, l.to[1] + dy] }
    : { ...l, rect: [l.rect[0] + dx, l.rect[1] + dy, l.rect[2], l.rect[3]] };
  return normalizeShape({ ...s, live, path: translatePath(s.path, dx, dy) });
}

/**
 * The 0/1 mask (y * W + x) of the shape's fill area: even-odd, sampled like scanlineFill, or the
 * Combine Shapes ops when its subpaths carry them.
 */
export function shapeMask(s, W, H) {
  if (hasPathOps(s.path)) return pathOpsMask(s.path, W, H);
  return polygonsMask(pathToPolygon(s.path), W, H);
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/** Trace a path onto a 2D context (beginPath, then each subpath). */
export function tracePath(ctx, path) {
  ctx.beginPath();
  for (const sp of path.subpaths) {
    const a = sp.anchors;
    if (!a.length) continue;
    ctx.moveTo(a[0].x, a[0].y);
    const segs = sp.closed ? a.length : a.length - 1;
    for (let i = 0; i < segs; i++) {
      const s = a[i],
        e = a[(i + 1) % a.length];
      ctx.bezierCurveTo(s.out[0], s.out[1], e.in[0], e.in[1], e.x, e.y);
    }
    if (sp.closed) ctx.closePath();
  }
}

/**
 * Draw a shape record: the fill (even-odd), then the stroke. Inside and Outside strokes are a
 * double-width stroke clipped to the inside or the outside of the path.
 */
export function renderShape(ctx, s) {
  if (s.fill && hasPathOps(s.path)) {
    // Canvas fill rules cannot subtract or intersect components: write the combined coverage.
    const { width, height } = ctx.canvas;
    const cov = pathCoverage(s.path, width, height);
    const img = ctx.createImageData(width, height);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.fill.slice(i, i + 2), 16));
    for (let p = 0; p < cov.length; p++) {
      img.data[p * 4] = r;
      img.data[p * 4 + 1] = g;
      img.data[p * 4 + 2] = b;
      img.data[p * 4 + 3] = cov[p];
    }
    ctx.putImageData(img, 0, 0);
  } else if (s.fill) {
    ctx.fillStyle = s.fill;
    tracePath(ctx, s.path);
    ctx.fill('evenodd');
  }
  const st = s.stroke;
  if (!st || st.width <= 0) return;
  ctx.save();
  if (st.align !== 'center') {
    tracePath(ctx, s.path);
    if (st.align === 'outside') {
      const { width, height } = ctx.canvas;
      ctx.rect(-1, -1, width + 2, height + 2);
    }
    ctx.clip('evenodd');
  }
  ctx.strokeStyle = st.color;
  ctx.lineWidth = st.align === 'center' ? st.width : st.width * 2;
  ctx.lineJoin = 'miter';
  tracePath(ctx, s.path);
  ctx.stroke();
  ctx.restore();
}

/** An SVG path `d` for a path (the Shapes panel thumbnails). */
export function pathToSvgD(path) {
  const r = (v) => Math.round(v * 100) / 100;
  const out = [];
  for (const sp of path.subpaths) {
    const a = sp.anchors;
    if (!a.length) continue;
    out.push(`M${r(a[0].x)} ${r(a[0].y)}`);
    const segs = sp.closed ? a.length : a.length - 1;
    for (let i = 0; i < segs; i++) {
      const s = a[i],
        e = a[(i + 1) % a.length];
      out.push(`C${r(s.out[0])} ${r(s.out[1])} ${r(e.in[0])} ${r(e.in[1])} ${r(e.x)} ${r(e.y)}`);
    }
    if (sp.closed) out.push('Z');
  }
  return out.join('');
}

/**
 * The Shapes panel (Window › Shapes, preset_panels.rs shapes): one swatch per shape, by group.
 * Picking one makes it the Custom Shape tool's shape (opts.onPick(name)).
 */
export function renderShapesPanel(container, custom, current, opts = {}) {
  const doc = container.ownerDocument;
  const SVG = 'http://www.w3.org/2000/svg';
  container.replaceChildren();
  for (const g of shapeGroups(custom)) {
    const head = doc.createElement('div');
    head.className = 'preset-group-name';
    head.textContent = g.name;
    const grid = doc.createElement('div');
    grid.className = 'preset-grid shape-grid';
    for (const sh of g.items) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-swatch shape-swatch';
      btn.title = sh.name;
      btn.dataset.shape = sh.name;
      btn.setAttribute('aria-label', sh.name);
      btn.setAttribute('aria-pressed', String(sh.name === current));
      const svg = doc.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('aria-hidden', 'true');
      const p = doc.createElementNS(SVG, 'path');
      p.setAttribute('d', pathToSvgD(fitPath(sh.path, [6, 6, 88, 88], true)));
      p.setAttribute('fill', 'currentColor');
      p.setAttribute('fill-rule', 'evenodd');
      svg.append(p);
      btn.append(svg);
      btn.addEventListener('click', () => opts.onPick?.(sh.name));
      grid.append(btn);
    }
    container.append(head, grid);
  }
}

/** A shape layer: its canvas draws layer.shape's path, fill, and stroke. */
export function createShapeLayer(name, shape, w, h) {
  const layer = createLayer(name, w, h);
  layer.kind = 'shape';
  layer.shape = normalizeShape(shape);
  renderShapeLayer(layer);
  return layer;
}

/** Redraw a shape layer's canvas from layer.shape. */
export function renderShapeLayer(layer) {
  if (!isShapeLayer(layer)) return;
  const { width, height } = layer.canvas;
  layer.ctx.clearRect?.(0, 0, width, height);
  renderShape(layer.ctx, layer.shape);
  layer.shapeSize = [width, height];
}

/** Re-render every shape layer whose canvas changed size since it was drawn. */
export function refreshShapeLayers(layers) {
  for (const layer of layers) {
    if (!isShapeLayer(layer)) continue;
    const [w, h] = layer.shapeSize ?? [];
    if (w !== layer.canvas.width || h !== layer.canvas.height) renderShapeLayer(layer);
  }
}
