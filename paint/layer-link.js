// Linked layers (PhotoCraft's Layers footer link button): layers that share a linkId move and
// transform together. A layer with no linkId stands alone. Saved in .paintproj.

import { offsetLayerPixels } from './tools.js';
import { transformLayerPixels } from './transform.js';

/** A linkId not used by any layer in the stack. */
export function freshLinkId(layers) {
  const used = new Set(layers.map((l) => l.linkId).filter(Boolean));
  let n = 1;
  while (used.has(`link-${n}`)) n++;
  return `link-${n}`;
}

/**
 * What the link button does for the selected layer ids: { link: true, ids, linkId } links two or
 * more selected layers under one new id; { link: false, ids } unlinks. One selected linked layer
 * unlinks its whole set, and a selection that is already one set unlinks it. null when there is
 * nothing to do (one unlinked layer).
 */
export function linkPlan(layers, ids) {
  const want = new Set(ids);
  const picked = layers.filter((l) => want.has(l.id));
  if (!picked.length) return null;
  const first = picked[0].linkId ?? null;
  const oneSet = first !== null && picked.every((l) => l.linkId === first);
  if (picked.length === 1) {
    if (!first) return null;
    return { link: false, ids: layers.filter((l) => l.linkId === first).map((l) => l.id) };
  }
  if (oneSet) return { link: false, ids: picked.map((l) => l.id) };
  return { link: true, ids: picked.map((l) => l.id), linkId: freshLinkId(layers) };
}

/** Set or clear linkId on the plan's layers; a set left with one member is dissolved. */
export function applyLinkPlan(layers, plan) {
  const ids = new Set(plan.ids);
  for (const l of layers) {
    if (!ids.has(l.id)) continue;
    if (plan.link) l.linkId = plan.linkId;
    else delete l.linkId;
  }
  const counts = new Map();
  for (const l of layers) if (l.linkId) counts.set(l.linkId, (counts.get(l.linkId) ?? 0) + 1);
  for (const l of layers) if (l.linkId && counts.get(l.linkId) < 2) delete l.linkId;
}

/** layer and every layer sharing its linkId, in stack order; [layer] when it is not linked. */
export function linkedLayers(layers, layer) {
  if (!layer) return [];
  if (!layer.linkId) return [layer];
  return layers.filter((l) => l === layer || l.linkId === layer.linkId);
}

/**
 * The other layers a Move or Free Transform of layer carries along: its linked set minus itself,
 * keeping only layers with their own pixels (no groups or adjustment layers). movable(l) can
 * drop more (locked layers).
 */
export function linkedPartners(layers, layer, movable = () => true) {
  return linkedLayers(layers, layer).filter(
    (l) => l !== layer && l.ctx && l.kind !== 'group' && l.kind !== 'adjustment' && movable(l)
  );
}

/**
 * Shift each { layer, src } entry's saved pixels by the same (dx, dy) onto its layer.
 * toImage builds what putImageData takes (ImageData in the browser).
 */
export function offsetLinked(entries, dx, dy, toImage) {
  for (const { layer, src } of entries) {
    const out = offsetLayerPixels(src.data, src.width, src.height, dx, dy);
    layer.ctx.putImageData(toImage(out, src.width, src.height), 0, 0);
  }
}

/** Every partner's whole layer through the Free Transform matrix m (affine or homography). */
export function transformLinked(layers, m, toImage) {
  for (const layer of layers) {
    const { width: W, height: H } = layer.canvas;
    const img = layer.ctx.getImageData(0, 0, W, H);
    const out = transformLayerPixels(img, null, { x: 0, y: 0, w: W, h: H }, m);
    layer.ctx.putImageData(toImage(out.data, W, H), 0, 0);
  }
}

/** A saved linkId (a non-empty string) or null; older .paintproj files have none. */
export function normalizeLinkId(v) {
  return typeof v === 'string' && v ? v : null;
}
