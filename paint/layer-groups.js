// Layer groups (PhotoCraft LayerContent::Group; engine commands.rs layer.new.group,
// layer_multi_cmds.rs group_layers, extra_cmds.rs ungroup; compose lib.rs pass-through).
//
// The stack stays one flat array, bottom first. A group is a record with kind 'group' (name,
// visible, opacity, blendMode, collapsed) sitting directly above its children; every layer names
// its group in parentId (null at the top level). layerTree reads the array as a tree and
// normalizeTree writes a tree back in that order, so the commands here edit parentIds and
// positions, then normalize. A parentId that names no group in the array counts as top level.
//
// Compositing walks the tree (compositeTree): a pass-through group composites its children
// straight into the backdrop and, below 100 % opacity, mixes the result with the backdrop it
// started from; any other mode renders the children into their own transparent buffer and blends
// that onto the backdrop. flattenToCanvas (layers.js) runs it on canvases; compositeTreeBytes
// runs it on RGBA bytes.

import { applyAdjustmentLayer, isAdjustmentLayer } from './adjustment-layers.js';
import { compositeMask } from './layer-mask.js';
import { blendRgb } from './retouch.js';
import { drawsStyle, renderEffectParts, renderEffects } from './layer-style.js';

export const PASS_THROUGH = 'pass-through';
export const GROUP_BASE_NAME = 'Group';

export function isGroupLayer(layer) {
  return layer?.kind === 'group';
}

function parentMap(layers) {
  const groups = new Map();
  for (const l of layers) if (isGroupLayer(l)) groups.set(l.id, l);
  return groups;
}

// The group record a layer sits in, or null at the top level.
function parentIn(groups, layer) {
  return layer.parentId != null ? groups.get(layer.parentId) ?? null : null;
}

/**
 * The stack as a tree: [{ layer, children }] bottom first at each level; children is null for a
 * layer that is not a group. A group nested in itself (a broken file) is read as top level.
 */
export function layerTree(layers) {
  const groups = parentMap(layers);
  const nodes = new Map(
    layers.map((l) => [l.id, { layer: l, children: isGroupLayer(l) ? [] : null }])
  );
  const roots = [];
  for (const l of layers) {
    let parent = parentIn(groups, l);
    // A cycle (a group inside its own descendant) would drop the whole loop; lift it out.
    for (let p = parent, seen = new Set([l.id]); p; p = parentIn(groups, p)) {
      if (seen.has(p.id)) {
        parent = null;
        break;
      }
      seen.add(p.id);
    }
    if (parent) nodes.get(parent.id).children.push(nodes.get(l.id));
    else roots.push(nodes.get(l.id));
  }
  return roots;
}

/** The flat array of a tree: each group directly after (above) its children. */
export function flattenTree(nodes, out = []) {
  for (const { layer, children } of nodes) {
    if (children) flattenTree(children, out);
    out.push(layer);
  }
  return out;
}

/**
 * The stack in tree order with every parentId valid (null for the top level). Layers keep
 * their order among siblings.
 */
export function normalizeTree(layers) {
  const roots = layerTree(layers);
  const fix = (nodes, parentId) => {
    for (const { layer, children } of nodes) {
      layer.parentId = parentId;
      if (children) fix(children, layer.id);
    }
  };
  fix(roots, null);
  return flattenTree(roots);
}

/** How many groups hold layers[idx]. */
export function layerDepth(layers, idx) {
  const groups = parentMap(layers);
  let depth = 0;
  for (let p = parentIn(groups, layers[idx]); p && depth < layers.length; p = parentIn(groups, p))
    depth++;
  return depth;
}

/** True when layer sits (at any depth) inside the group with id groupId. */
export function isInsideGroup(layers, layer, groupId) {
  const groups = parentMap(layers);
  for (let p = parentIn(groups, layer), n = 0; p && n < layers.length; p = parentIn(groups, p), n++)
    if (p.id === groupId) return true;
  return false;
}

/** The lowest index of the block layers[idx] heads: idx for a layer, its first child for a group. */
export function blockStart(layers, idx) {
  const layer = layers[idx];
  if (!isGroupLayer(layer)) return idx;
  let start = idx;
  while (start > 0 && isInsideGroup(layers, layers[start - 1], layer.id)) start--;
  return start;
}

/** A layer shows when it and every group holding it are visible. */
export function isEffectivelyVisible(layers, layer) {
  if (layer.visible === false) return false;
  const groups = parentMap(layers);
  for (let p = parentIn(groups, layer), n = 0; p && n < layers.length; p = parentIn(groups, p), n++)
    if (p.visible === false) return false;
  return true;
}

/**
 * The Layers panel's rows, top of the stack first: { idx, depth } for every layer whose groups
 * are all open (layer_tree_ui display_rows).
 */
export function displayRows(layers) {
  const rows = [];
  const walk = (nodes, depth) => {
    for (let k = nodes.length - 1; k >= 0; k--) {
      const { layer, children } = nodes[k];
      rows.push({ idx: layers.indexOf(layer), depth });
      if (children && !layer.collapsed) walk(children, depth + 1);
    }
  };
  walk(layerTree(layers), 0);
  return rows;
}

/** Of the ids, those not inside another listed group (layer_multi_cmds top_level), stack order. */
export function topLevelIds(layers, ids) {
  const picked = layers.filter((l) => ids.includes(l.id));
  return picked
    .filter((l) => !picked.some((g) => isGroupLayer(g) && isInsideGroup(layers, l, g.id)))
    .map((l) => l.id);
}

/**
 * Layer › New › Group…: `group` goes directly above the active layer as its sibling (insert_above),
 * or at the top of an empty stack. Returns the new stack.
 */
export function insertGroupAbove(layers, activeIdx, group) {
  const active = layers[activeIdx];
  group.parentId = active?.parentId ?? null;
  const out = layers.slice();
  out.splice(active ? activeIdx + 1 : out.length, 0, group);
  return normalizeTree(out);
}

/**
 * Layer › Group Layers / New › Group from Layers… (group_layers): the listed layers (groups with
 * everything in them) move into `group`, which takes the topmost one's place. Photoshop makes
 * the group collapsed. Returns { layers } or { error }.
 */
export function groupLayersPlan(layers, ids, group) {
  const top = topLevelIds(layers, ids);
  if (!top.length) return { error: 'no layer selected' };
  const topIdx = layers.findIndex((l) => l.id === top[top.length - 1]);
  group.parentId = layers[topIdx].parentId ?? null;
  group.collapsed = true;
  const out = layers.slice();
  out.splice(topIdx + 1, 0, group);
  for (const l of out) if (top.includes(l.id)) l.parentId = group.id;
  return { layers: normalizeTree(out) };
}

/**
 * Layer › Ungroup Layers (ungroup): the group's children take its place among its siblings and
 * the group goes. Returns { layers, activeId } (the top child, or null for an empty group) or
 * { error }.
 */
export function ungroupPlan(layers, idx) {
  const group = layers[idx];
  if (!isGroupLayer(group)) return { error: 'the active layer is not a group' };
  let activeId = null;
  for (const l of layers) {
    if (l.parentId !== group.id) continue;
    l.parentId = group.parentId ?? null;
    activeId = l.id;
  }
  return { layers: normalizeTree(layers.filter((l) => l !== group)), activeId };
}

/** Indices of layers[idx]'s block (the layer, or a group and everything in it), bottom first. */
export function blockIndices(layers, idx) {
  const out = [];
  for (let i = blockStart(layers, idx); i <= idx; i++) out.push(i);
  return out;
}

/**
 * A Layers row dragged onto another (panels.rs row drop). Dropped on a group's row, the layer
 * goes into that group at the top, unless it is already one of its children: then it comes out
 * and sits directly above the group. Dropped on any other row, it becomes that row's sibling,
 * taking its place (above it when moving up, below it when moving down). A group carries its
 * contents along and cannot go into itself. Returns a plan for applyMovePlan, or null when the
 * move is refused (nothing moves, a group into itself, or below the bottom-locked Background).
 * Nothing changes until the plan is applied, so the caller can push undo in between.
 */
export function moveLayerPlan(layers, from, to, isBackground = () => false) {
  const moving = layers[from];
  const target = layers[to];
  if (!moving || !target || from === to || isBackground(moving)) return null;
  if (isGroupLayer(moving) && isInsideGroup(layers, target, moving.id)) return null;
  const block = blockIndices(layers, from).map((i) => layers[i]);
  const rest = layers.filter((l) => !block.includes(l));
  const t = rest.indexOf(target);
  let at, parentId;
  if (isGroupLayer(target) && moving.parentId === target.id) {
    at = t + 1;
    parentId = target.parentId ?? null;
  } else if (isGroupLayer(target)) {
    at = t;
    parentId = target.id;
  } else {
    at = to > from ? t + 1 : blockStart(rest, t);
    parentId = target.parentId ?? null;
  }
  if (at === 0 && rest.length && isBackground(rest[0])) return null;
  rest.splice(at, 0, ...block);
  return { order: rest, layer: moving, parentId };
}

/** Carry out a moveLayerPlan: the new stack. */
export function applyMovePlan(plan) {
  plan.layer.parentId = plan.parentId;
  return normalizeTree(plan.order);
}

/**
 * Parent ids after layers were removed: a layer whose group went moves up to that group's
 * nearest surviving ancestor. before is the stack before the removal.
 */
export function reparentOrphans(layers, before) {
  const all = new Map(before.map((l) => [l.id, l]));
  const kept = new Set(layers.map((l) => l.id));
  for (const l of layers) {
    let p = l.parentId;
    while (p != null && !kept.has(p)) p = all.get(p)?.parentId ?? null;
    l.parentId = p;
  }
  return normalizeTree(layers);
}

// Tools that never write the target layer's pixels: they still work with a group active.
const GROUP_SAFE_TOOLS = new Set([
  'rectSelect',
  'ellipseSelect',
  'singleRowMarquee',
  'singleColumnMarquee',
  'lasso',
  'polyLasso',
  'magneticLasso',
  'quickSelection',
  'magicWand',
  'crop',
  'perspectiveCrop',
  'eyedropper',
  'ruler',
  'count',
  'text',
  'verticalType',
  'horizontalTypeMask',
  'verticalTypeMask',
  'pen',
  'addAnchorPoint',
  'deleteAnchorPoint',
  'convertPoint',
  'pathSelection',
  'directSelection',
  // The Shape tools make a new shape layer above the target; its pixels are never touched.
  'rect',
  'ellipse',
  'triangle',
  'polygon',
  'line',
  'customShape'
]);

/** True for a tool that never writes the target layer's pixels (selections, crop, eyedropper…). */
export function isPixelSafeTool(toolId) {
  return GROUP_SAFE_TOOLS.has(toolId);
}

/** The status note when a tool cannot paint on the active layer because it is a group, or null. */
export function groupToolRefusal(layer, toolId, label = toolId) {
  if (!isGroupLayer(layer) || GROUP_SAFE_TOOLS.has(toolId)) return null;
  return `Could not use the ${label}: the target layer is a group`;
}

// ── Compositing ──────────────────────────────────────────────────────────────

/**
 * Composite a stack onto `base` bottom to top through `ops`, a backend over some buffer type:
 *   layer(dst, layer)                draw a pixel layer (its opacity, blend mode, enabled mask)
 *   adjust(dst, layer)               run an adjustment layer on dst
 *   create()                         a new transparent buffer
 *   copy(buf)                        a copy of buf
 *   isolate(layer)                   a new buffer holding a pixel layer alone (mask applied)
 *   draw(dst, src, opacity, mode)    blend buffer src onto dst
 *   drawAtop(dst, src, opacity, mode)  blend src onto dst keeping dst's alpha (composite_atop)
 *   mix(dst, before, k)              dst = before + (dst − before) × k (premultiplied)
 *
 * A clipping group (compose lib.rs composite_stack_at) is a base and the clipped siblings
 * directly above it: the base renders alone, each clipped layer blends atop it in its own mode
 * and opacity (Blend Clipped Layers as Group), and the result goes onto the backdrop in the
 * base's mode and opacity. A hidden base hides its clipped layers.
 */
export function compositeTree(nodes, base, ops) {
  for (let i = 0; i < nodes.length; ) {
    const node = nodes[i];
    let j = i + 1;
    if (!node.layer.clipped) while (j < nodes.length && nodes[j].layer.clipped) j++;
    const clipped = nodes.slice(i + 1, j).filter((c) => c.layer.visible !== false);
    i = j;
    if (node.layer.visible === false) continue;
    // An adjustment layer has no pixels for its clipped layers to show on.
    if (clipped.length && !isAdjustmentLayer(node.layer))
      compositeClipGroup(node, clipped, base, ops);
    else compositeNode(node, base, ops);
  }
  return base;
}

function compositeNode({ layer, children }, base, ops) {
  if (children) {
    const opacity = Math.min(1, layer.opacity ?? 1);
    if ((layer.blendMode ?? PASS_THROUGH) === PASS_THROUGH) {
      const before = opacity < 1 ? ops.copy(base) : null;
      compositeTree(children, base, ops);
      if (before) ops.mix(base, before, opacity);
    } else {
      const buf = ops.create();
      compositeTree(children, buf, ops);
      ops.draw(base, buf, opacity, layer.blendMode);
    }
  } else if (isAdjustmentLayer(layer)) {
    ops.adjust(base, layer);
  } else {
    ops.layer(base, layer);
  }
}

// A node rendered on its own: a group's children in a fresh buffer, or a pixel layer.
function isolatedNode({ layer, children }, ops) {
  return children ? compositeTree(children, ops.create(), ops) : ops.isolate(layer);
}

// A group renders isolated here, so Pass Through blends Normal.
function nodeMode(layer) {
  const mode = layer.blendMode || 'source-over';
  return mode === PASS_THROUGH ? 'source-over' : mode;
}

function compositeClipGroup(node, clipped, base, ops) {
  const iso = isolatedNode(node, ops);
  for (const c of clipped) {
    if (isAdjustmentLayer(c.layer)) ops.adjust(iso, c.layer);
    else
      ops.drawAtop(iso, isolatedNode(c, ops), Math.min(1, c.layer.opacity ?? 1), nodeMode(c.layer));
  }
  ops.draw(base, iso, Math.min(1, node.layer.opacity ?? 1), nodeMode(node.layer));
}

// blend.rs composite: src over dst in a blend mode, straight RGBA bytes, src alpha × k.
function blendPixel(dst, i, src, j, k, mode) {
  const as = (src[j + 3] / 255) * k;
  if (as <= 0) return;
  const ab = dst[i + 3] / 255;
  const cb = [dst[i] / 255, dst[i + 1] / 255, dst[i + 2] / 255];
  const cs = [src[j] / 255, src[j + 1] / 255, src[j + 2] / 255];
  const b = blendRgb(mode, cb, cs);
  const ao = as + ab * (1 - as);
  for (let c = 0; c < 3; c++) {
    const v = ((1 - as) * ab * cb[c] + (1 - ab) * as * cs[c] + as * ab * b[c]) / ao;
    dst[i + c] = Math.round(v * 255);
  }
  dst[i + 3] = Math.round(ao * 255);
}

/**
 * blend.rs composite_atop on straight RGBA bytes: src blended onto dst in `mode` at src alpha × k,
 * dst's alpha kept. Rewrites dst.
 */
export function atopBytes(dst, src, k, mode = 'source-over') {
  const cb = [0, 0, 0],
    cs = [0, 0, 0];
  for (let i = 0; i < dst.length; i += 4) {
    const as = (src[i + 3] / 255) * k;
    if (as <= 0 || dst[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      cb[c] = dst[i + c] / 255;
      cs[c] = src[i + c] / 255;
    }
    const b = blendRgb(mode, cb, cs);
    for (let c = 0; c < 3; c++) dst[i + c] = Math.round(((1 - as) * cb[c] + as * b[c]) * 255);
  }
  return dst;
}

function blendBuffer(dst, src, opacity, mode, mask) {
  for (let p = 0, i = 0; i < dst.length; p++, i += 4) {
    const k = mask ? (opacity * mask[p]) / 255 : opacity;
    if (k > 0) blendPixel(dst, i, src, i, k, mode);
  }
}

function layerBytes(layer, W, H) {
  return layer.data?.data ?? layer.data ?? layer.ctx.getImageData(0, 0, W, H).data;
}

/** The byte backend for compositeTree: buffers are RGBA Uint8ClampedArray W * H * 4. */
export function byteCompositeOps(W, H) {
  // A pixel layer alone with its enabled mask applied.
  const masked = (layer) => {
    const out = new Uint8ClampedArray(layerBytes(layer, W, H));
    const mask = compositeMask(layer, W);
    if (mask)
      for (let p = 0; p < W * H; p++) out[p * 4 + 3] = Math.round((out[p * 4 + 3] * mask[p]) / 255);
    return out;
  };
  return {
    layer(dst, layer) {
      const mask = compositeMask(layer, W);
      const mode = layer.blendMode || 'source-over';
      const opacity = Math.min(1, layer.opacity ?? 1);
      if (!drawsStyle(layer)) {
        blendBuffer(dst, layerBytes(layer, W, H), opacity, mode, mask);
        return;
      }
      // Layer styles (layer-style.js): the exterior effects onto the backdrop each in its own
      // mode, then the styled layer in the layer's.
      const parts = renderEffectParts({ width: W, height: H, data: masked(layer) }, layer.styles);
      for (const u of parts.under) blendBuffer(dst, u.image.data, opacity, u.mode, null);
      blendBuffer(dst, parts.body.data, opacity, mode, null);
    },
    adjust: (dst, layer) => applyAdjustmentLayer(dst, layer, W, H),
    create: () => new Uint8ClampedArray(W * H * 4),
    copy: (buf) => new Uint8ClampedArray(buf),
    isolate(layer) {
      const out = masked(layer);
      if (!drawsStyle(layer)) return out;
      return renderEffects({ width: W, height: H, data: out }, layer.styles).data;
    },
    draw: (dst, src, opacity, mode) => blendBuffer(dst, src, opacity, mode || 'source-over', null),
    drawAtop: (dst, src, opacity, mode) => atopBytes(dst, src, opacity, mode),
    mix(dst, before, k) {
      for (let i = 0; i < dst.length; i += 4) {
        const wa = (before[i + 3] / 255) * (1 - k);
        const wb = (dst[i + 3] / 255) * k;
        const a = wa + wb;
        for (let c = 0; c < 3; c++)
          dst[i + c] = a > 0 ? Math.round((before[i + c] * wa + dst[i + c] * wb) / a) : 0;
        dst[i + 3] = Math.round(a * 255);
      }
    }
  };
}

function parseBgRgb(bg) {
  if (!bg) return null;
  if (Array.isArray(bg)) return bg;
  const n = parseInt(String(bg).replace('#', '').slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The stack composited bottom to top into RGBA bytes — the same Seam as flattenToCanvas.
 * bg is [r, g, b], a #hex color, or null for transparency. Every layer must have a unique
 * `id` (layerTree keys on it); pixel layers give bytes as layer.data or through layer.ctx.
 */
export function compositeTreeBytes(layers, W, H, bg = null) {
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].id == null) throw new Error(`compositeTreeBytes: layer ${i} has no id`);
  }
  const rgb = parseBgRgb(bg);
  const out = new Uint8ClampedArray(W * H * 4);
  if (rgb) for (let i = 0; i < out.length; i += 4) out.set([rgb[0], rgb[1], rgb[2], 255], i);
  return compositeTree(layerTree(layers), out, byteCompositeOps(W, H));
}
