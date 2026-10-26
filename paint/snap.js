// Paint — View › Extras, Show, Snap, and Snap To (PhotoCraft crates/ui-egui/src/view_cmds.rs Show /
// SnapTo, snap_ui.rs, and crates/engine/src/snap.rs).
//
// The view flags live on the app state: state.extras (the ⌘H master switch), state.show (the
// Show submenu, Guides is state.showGuides), state.snap (⇧⌘;) and state.snapTo. An overlay is
// visible only while Extras and its own flag are on (ViewOptions::shows).
//
// Snapping is pure geometry: snapTargets builds vertical (x) and horizontal (y) lines from the
// document bounds, guides, grid, and other layers; snapPoint pulls a point onto the nearest line
// on each axis and snapRect finds the correction that lines up a moving box's edge or centre.
// Distances are in document pixels; the threshold is SNAP_PX screen pixels over the zoom.

// snap_ui.rs SNAP_PX.
export const SNAP_PX = 8;
// pixel_grid.rs MIN_ZOOM: the pixel grid shows above 500%.
export const PIXEL_GRID_MIN_ZOOM = 5;

// view_cmds.rs Show::default (Photoshop defaults). The grid is off until View › Show › Grid.
export const DEFAULT_SHOW = Object.freeze({
  layerEdges: false,
  selectionEdges: true,
  grid: false,
  smartGuides: true,
  pixelGrid: true,
  brushPreview: true
});

export const SHOW_KEYS = Object.keys(DEFAULT_SHOW);

export const DEFAULT_SNAP_TO = Object.freeze({
  guides: true,
  grid: true,
  layers: true,
  documentBounds: true
});

export const SNAP_TO_KEYS = Object.keys(DEFAULT_SNAP_TO);

// prefs.rs GuidesGridAndSlices: a gridline every inch (72 px at 72 ppi) with 4 subdivisions.
export const DEFAULT_GRID = Object.freeze({ every: 72, subdivisions: 4 });

/** The view-flag part of a fresh document window. */
export function defaultExtras() {
  return {
    extras: true,
    show: { ...DEFAULT_SHOW },
    snap: true,
    snapTo: { ...DEFAULT_SNAP_TO },
    grid: { ...DEFAULT_GRID },
    pixelArtPreview: false
  };
}

/** Is the overlay with Show flag `key` ('guides' too) on screen: Extras and the flag on? */
export function shows(state, key) {
  if (state.extras === false) return false;
  if (key === 'guides') return state.showGuides !== false;
  return !!(state.show ?? DEFAULT_SHOW)[key];
}

/** Every Show overlay's visibility; with Extras off all of them are false. */
export function visibleExtras(state) {
  const out = { guides: shows(state, 'guides') };
  for (const k of SHOW_KEYS) out[k] = shows(state, k);
  return out;
}

/** The pixel grid draws only above PIXEL_GRID_MIN_ZOOM. */
export function pixelGridVisible(state) {
  return shows(state, 'pixelGrid') && state.zoom > PIXEL_GRID_MIN_ZOOM;
}

/** View › Extras (⌘H). */
export function toggleExtras(state) {
  state.extras = state.extras === false;
}

/** View › Show › <key>: flips the flag; showing an item turns Extras back on. */
export function toggleShow(state, key) {
  if (key === 'guides') {
    state.showGuides = state.showGuides === false;
    if (state.showGuides) state.extras = true;
    return;
  }
  if (!SHOW_KEYS.includes(key)) throw new Error(`unknown Show item ${key}`);
  state.show = { ...(state.show ?? DEFAULT_SHOW), [key]: !(state.show ?? DEFAULT_SHOW)[key] };
  if (state.show[key]) state.extras = true;
}

/** View › Show › All: every item, Extras, the grid, and the guides on. */
export function showAll(state) {
  state.show = Object.fromEntries(SHOW_KEYS.map((k) => [k, true]));
  state.showGuides = true;
  state.extras = true;
}

/** View › Snap (⇧⌘;). */
export function toggleSnap(state) {
  state.snap = state.snap === false;
}

/** View › Snap To › <key>. */
export function toggleSnapTo(state, key) {
  if (!SNAP_TO_KEYS.includes(key)) throw new Error(`unknown Snap To item ${key}`);
  const cur = state.snapTo ?? DEFAULT_SNAP_TO;
  state.snapTo = { ...cur, [key]: !cur[key] };
}

/** View › Snap To › All (or None). */
export function snapToAll(state, on = true) {
  state.snapTo = Object.fromEntries(SNAP_TO_KEYS.map((k) => [k, on]));
}

/** View › Pixel Art Preview. */
export function togglePixelArtPreview(state) {
  state.pixelArtPreview = !state.pixelArtPreview;
}

/** Grid subdivision spacing in document pixels (gridline spacing over the subdivisions). */
export function gridStep(grid = DEFAULT_GRID) {
  const every = Number.isFinite(grid?.every) && grid.every > 0 ? grid.every : DEFAULT_GRID.every;
  const sub = Math.max(1, Math.round(grid?.subdivisions ?? DEFAULT_GRID.subdivisions));
  return every / sub;
}

/** Preferences › Guides, Grid & Slices values, clamped as prefs.rs does (1 to 100 subdivisions). */
export function normalizeGrid(g) {
  const every = Number(g?.every);
  const sub = Math.round(Number(g?.subdivisions));
  return {
    every: Number.isFinite(every) && every >= 1 ? Math.min(every, 10000) : DEFAULT_GRID.every,
    subdivisions: Number.isFinite(sub) && sub >= 1 ? Math.min(sub, 100) : DEFAULT_GRID.subdivisions
  };
}

/**
 * The target families snapping uses now (snap_ui.rs options), or null while View › Snap is off.
 * Guides snap only while shown, the grid only while View › Show › Grid is on.
 */
export function snapOptions(state) {
  if (state.snap === false) return null;
  const st = state.snapTo ?? DEFAULT_SNAP_TO;
  return {
    guides: st.guides && shows(state, 'guides'),
    grid: st.grid && !!(state.show ?? DEFAULT_SHOW).grid,
    layers: st.layers,
    document: st.documentBounds
  };
}

function addRect(t, r, edge, center) {
  const xs = [r[1], r[3]],
    ys = [r[0], r[2]];
  t.x.push({ pos: r[0], kind: edge, span: xs });
  t.x.push({ pos: r[2], kind: edge, span: xs });
  t.x.push({ pos: (r[0] + r[2]) / 2, kind: center, span: xs });
  t.y.push({ pos: r[1], kind: edge, span: ys });
  t.y.push({ pos: r[3], kind: edge, span: ys });
  t.y.push({ pos: (r[1] + r[3]) / 2, kind: center, span: ys });
}

/**
 * Snap targets on a W × H document (snap.rs from_document). `guides` is { vertical, horizontal },
 * `layerRects` the [x0, y0, x1, y1] bounds of the other visible layers, `step` the grid spacing.
 * Returns { x, y, grid, extent }: x holds vertical lines, y horizontal ones.
 */
export function snapTargets({ W, H, opts, guides = null, layerRects = [], step = 0 }) {
  const t = { x: [], y: [], grid: null, extent: [0, 0, W, H] };
  if (!opts) return t;
  if (opts.document) addRect(t, [0, 0, W, H], 'documentEdge', 'documentCenter');
  if (opts.guides && guides) {
    for (const g of guides.vertical) t.x.push({ pos: g, kind: 'guide', span: [0, H] });
    for (const g of guides.horizontal) t.y.push({ pos: g, kind: 'guide', span: [0, W] });
  }
  if (opts.grid && Number.isFinite(step) && step > 0) t.grid = step;
  if (opts.layers) for (const r of layerRects) addRect(t, r, 'layerEdge', 'layerCenter');
  return t;
}

/** Smart guides: layer-to-layer and document-centre alignments only (SnapKind::is_smart). */
export function smartTargets(t) {
  const keep = (g) => g.kind === 'layerEdge' || g.kind === 'layerCenter' || g.kind === 'documentCenter';
  return { x: t.x.filter(keep), y: t.y.filter(keep), grid: null, extent: t.extent };
}

/** The closest target to `v` within `tol` on one axis; guides win ties (snap.rs nearest). */
export function nearestTarget(t, vertical, v, tol) {
  let best = null;
  let bestD = Infinity;
  const consider = (g) => {
    const d = Math.abs(g.pos - v);
    if (d > tol) return;
    const better =
      !best ||
      d < bestD - 1e-9 ||
      (Math.abs(d - bestD) <= 1e-9 && g.kind === 'guide' && best.kind !== 'guide');
    if (better) {
      best = g;
      bestD = d;
    }
  };
  (vertical ? t.x : t.y).forEach(consider);
  if (t.grid) {
    const span = vertical ? [t.extent[1], t.extent[3]] : [t.extent[0], t.extent[2]];
    consider({ pos: Math.round(v / t.grid) * t.grid, kind: 'grid', span });
  }
  return best;
}

// An alignment line through target `g` covering its span and the snapped object (a..b).
function line(vertical, g, a, b) {
  return {
    vertical,
    pos: g.pos,
    from: Math.min(g.span[0], a, b),
    to: Math.max(g.span[1], a, b),
    kind: g.kind
  };
}

/**
 * Snap a point [x, y]: each axis independently onto its nearest target within `threshold`
 * document pixels. Returns { point, lines }.
 */
export function snapPoint(point, targets, threshold) {
  const out = [point[0], point[1]];
  const lines = [];
  const gx = nearestTarget(targets, true, point[0], threshold);
  if (gx) {
    out[0] = gx.pos;
    lines.push(line(true, gx, point[1], point[1]));
  }
  const gy = nearestTarget(targets, false, point[1], threshold);
  if (gy) {
    out[1] = gy.pos;
    lines.push(line(false, gy, out[0], out[0]));
  }
  return { point: out, lines };
}

/**
 * Snap a moving rectangle [x0, y0, x1, y1] (snap.rs snap_rect): on each axis the edge or centre
 * closest to a target decides the correction. Returns { delta: [dx, dy], lines } with a line for
 * every anchor that lines up after the correction.
 */
export function snapRect(r, targets, threshold) {
  const delta = [0, 0];
  const lines = [];
  for (const [axis, vertical] of [
    [0, true],
    [1, false]
  ]) {
    const a = r[axis],
      b = r[axis + 2];
    const anchors = [a, (a + b) / 2, b];
    let best = null;
    for (const v of anchors) {
      const g = nearestTarget(targets, vertical, v, threshold);
      if (g && (best == null || Math.abs(g.pos - v) < Math.abs(best))) best = g.pos - v;
    }
    if (best == null) continue;
    delta[axis] = best;
    const other = vertical ? [r[1], r[3]] : [r[0], r[2]];
    const list = vertical ? targets.x : targets.y;
    for (const v of anchors) {
      const moved = v + best;
      let hit = list
        .filter((g) => Math.abs(g.pos - moved) < 1e-6)
        .sort((p, q) => (p.kind === 'guide' ? 0 : 1) - (q.kind === 'guide' ? 0 : 1))[0];
      if (!hit && targets.grid) {
        const g = Math.round(moved / targets.grid) * targets.grid;
        if (Math.abs(g - moved) < 1e-6) hit = { pos: moved, kind: 'grid', span: other };
      }
      if (hit) lines.push(line(vertical, hit, other[0], other[1]));
    }
  }
  return { delta, lines };
}

/**
 * A drag's snapping (snap_ui.rs ActiveSnap). `mode` 'point' snaps the pointer itself (marquee
 * and crop corners, transform handles); 'rect' snaps `rect` moved by the pointer's travel from
 * `start` (the Move tool, a selection being dragged). `smart` holds the smart-guide targets.
 */
export function beginSnapDrag(mode, start, targets, threshold, rect = null, smart = null) {
  return { mode, start: [start[0], start[1]], targets, threshold, rect, smart };
}

/**
 * Where the pointer at (x, y) lands under `drag`: { x, y, lines }. `off` (Ctrl held during the
 * drag) leaves it where it is.
 */
export function snapDragPoint(drag, x, y, off = false) {
  if (!drag || off) return { x, y, lines: [] };
  if (drag.mode === 'point') {
    const { point, lines } = snapPoint([x, y], drag.targets, drag.threshold);
    return { x: point[0], y: point[1], lines };
  }
  const dx = x - drag.start[0],
    dy = y - drag.start[1];
  const r = drag.rect;
  const moved = [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy];
  const { delta, lines } = snapRect(moved, drag.targets, drag.threshold);
  // Smart guides: the layer alignments the box makes once it has snapped.
  const shifted = moved.map((v, i) => v + delta[i % 2]);
  const smart = drag.smart ? snapRect(shifted, drag.smart, 1e-6).lines : [];
  return { x: x + delta[0], y: y + delta[1], lines, smart };
}

/** Snap tolerance in document pixels at `zoom`. */
export function snapThreshold(zoom) {
  return SNAP_PX / Math.max(zoom, 0.01);
}

