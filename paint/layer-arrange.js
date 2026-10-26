// Layer › Arrange, Align and Distribute (PhotoCraft commands.rs arrange, layer_multi_cmds.rs
// reverse / align / distribute; the Move tool's align_bar.rs).
//
// Arrange shifts one layer (a group with its contents) among its siblings; nothing goes below the
// Background, which never moves. Reverse swaps the selected top-level layers' slots. Align and
// Distribute work on content bounds { x0, y0, x1, y1 } (x1 / y1 exclusive) and return whole-pixel
// moves [{ id, dx, dy }]; the caller shifts the pixels.

import { flattenTree, layerTree, topLevelIds } from './layer-groups.js';

export const ALIGN_KINDS = [
  'topEdges',
  'verticalCenters',
  'bottomEdges',
  'leftEdges',
  'horizontalCenters',
  'rightEdges'
];
export const DISTRIBUTE_KINDS = [...ALIGN_KINDS, 'horizontally', 'vertically'];

// [siblings, index] of layer in the tree.
function slotOf(nodes, layer) {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].layer === layer) return [nodes, i];
    const inner = nodes[i].children && slotOf(nodes[i].children, layer);
    if (inner) return inner;
  }
  return null;
}

// A plan from an edited tree: the flat order and each layer's parent id where it now sits.
// Nothing is written until applyArrangePlan, so the caller can push undo in between.
function treePlan(roots) {
  const parents = new Map();
  const walk = (nodes, parentId) => {
    for (const { layer, children } of nodes) {
      parents.set(layer, parentId);
      if (children) walk(children, layer.id);
    }
  };
  walk(roots, null);
  return { order: flattenTree(roots), parents };
}

/** Carry out an arrangePlan / reversePlan: the new stack. */
export function applyArrangePlan(plan) {
  for (const [layer, parentId] of plan.parents) layer.parentId = parentId;
  return plan.order;
}

/**
 * Bring Forward (delta 1), Send Backward (-1), Bring to Front (Infinity), Send to Back
 * (-Infinity) for layers[idx]: a plan for applyArrangePlan, or null when it cannot move (the
 * Background, the end of its siblings, or below the Background).
 */
export function arrangePlan(layers, idx, delta, isBackground = () => false) {
  const layer = layers[idx];
  if (!layer || isBackground(layer)) return null;
  const roots = layerTree(layers);
  const [sib, i] = slotOf(roots, layer);
  const floor = sib === roots && sib.length && isBackground(sib[0].layer) ? 1 : 0;
  const to = Math.max(floor, Math.min(sib.length - 1, i + delta));
  if (to === i) return null;
  sib.splice(to, 0, ...sib.splice(i, 1));
  return treePlan(roots);
}

/**
 * Layer › Arrange › Reverse: the selected top-level layers trade slots, top for bottom. Returns
 * a plan for applyArrangePlan, or { error } (fewer than two, or the Background among them).
 */
export function reversePlan(layers, ids, isBackground = () => false) {
  const top = topLevelIds(layers, ids);
  if (top.length < 2) return { error: 'select two or more layers to reverse' };
  const picked = top.map((id) => layers.find((l) => l.id === id));
  if (picked.some(isBackground)) return { error: "the Background layer can't be moved" };
  const roots = layerTree(layers);
  const slots = picked.map((l) => slotOf(roots, l));
  const nodes = slots.map(([sib, i]) => sib[i]);
  slots.forEach(([sib, i], k) => (sib[i] = nodes[nodes.length - 1 - k]));
  return treePlan(roots);
}

/** Bounds of the pixels with alpha > 0 in RGBA data, or null for an empty layer. */
export function alphaBounds(data, W, H) {
  let x0 = W,
    y0 = H,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!data[(y * W + x) * 4 + 3]) continue;
      if (x < x0) x0 = x;
      if (x >= x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y >= y1) y1 = y + 1;
    }
  }
  return x1 > x0 ? { x0, y0, x1, y1 } : null;
}

/** The smallest rect holding every one given; null when there are none. */
export function unionBounds(rects) {
  const list = rects.filter(Boolean);
  if (!list.length) return null;
  return {
    x0: Math.min(...list.map((r) => r.x0)),
    y0: Math.min(...list.map((r) => r.y0)),
    x1: Math.max(...list.map((r) => r.x1)),
    y1: Math.max(...list.map((r) => r.y1))
  };
}

const vertical = (kind) => /^(top|verticalCenters|bottom)/.test(kind);

// The edge's coordinate, doubled so centres stay integral (Edge::value2).
function value2(kind, r) {
  const [a, b] = vertical(kind) ? [r.y0, r.y1] : [r.x0, r.x1];
  if (kind === 'topEdges' || kind === 'leftEdges') return 2 * a;
  if (kind === 'bottomEdges' || kind === 'rightEdges') return 2 * b;
  return a + b;
}

const move = (kind, id, d) => (vertical(kind) ? { id, dx: 0, dy: d } : { id, dx: d, dy: 0 });

/**
 * What Align aligns to (align "auto"): the selection's bounds when there is one, the canvas for
 * a single selected layer, else the union of the layers' bounds.
 */
export function alignTarget(items, selection, canvas, selectedCount) {
  if (selection) return selection;
  if (selectedCount === 1) return canvas;
  return unionBounds(items.map((it) => it.rect));
}

/** Align: items [{ id, rect }] moved so their `kind` edge meets target's. */
export function alignMoves(items, target, kind) {
  const t2 = value2(kind, target);
  return items.map(({ id, rect }) => move(kind, id, Math.floor((t2 - value2(kind, rect)) / 2)));
}

// Rust f64::round: halves away from zero.
const roundAway = (v) => Math.sign(v) * Math.round(Math.abs(v));

/**
 * Distribute: three or more items spaced so the `kind` edges (or centres) are evenly apart, the
 * outermost staying put; 'horizontally' / 'vertically' equalize the gaps between neighbours.
 * Returns null for fewer than three.
 */
export function distributeMoves(items, kind) {
  const n = items.length;
  if (n < 3) return null;
  if (kind === 'horizontally' || kind === 'vertically') {
    const v = kind === 'vertically';
    const lo = (r) => (v ? r.y0 : r.x0);
    const hi = (r) => (v ? r.y1 : r.x1);
    const sorted = items
      .slice()
      .sort((a, b) => lo(a.rect) + hi(a.rect) - lo(b.rect) - hi(b.rect) || lo(a.rect) - lo(b.rect));
    const span = hi(sorted[n - 1].rect) - lo(sorted[0].rect);
    const total = sorted.reduce((s, { rect }) => s + hi(rect) - lo(rect), 0);
    const gap = (span - total) / (n - 1);
    let cursor = lo(sorted[0].rect);
    return sorted.map(({ id, rect }) => {
      const d = roundAway(cursor) - lo(rect);
      cursor += hi(rect) - lo(rect) + gap;
      return v ? { id, dx: 0, dy: d } : { id, dx: d, dy: 0 };
    });
  }
  const sorted = items.slice().sort((a, b) => value2(kind, a.rect) - value2(kind, b.rect));
  const first = value2(kind, sorted[0].rect);
  const last = value2(kind, sorted[n - 1].rect);
  return sorted.map(({ id, rect }, i) => {
    const want2 = first + ((last - first) * i) / (n - 1);
    return move(kind, id, roundAway((want2 - value2(kind, rect)) / 2));
  });
}
