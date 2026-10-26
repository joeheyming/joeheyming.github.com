// Multi-layer selection and the commands that act on several layers (PhotoCraft
// layer_multi_cmds.rs layer_select / select_all_layers / merge_layers, edit_cmds.rs
// merge_visible, extra_cmds.rs delete_where "Delete Hidden Layers").
//
// The selection is a list of layer ids next to the active layer: Ctrl/Cmd-click toggles a row,
// Shift-click selects the range from the anchor. Stack plans name indices into `layers`
// (bottom first); applyMergePlan carries one out with a `flatten(layers)` canvas from the caller.

import { isAdjustmentLayer } from './adjustment-layers.js';
import { isBackgroundLayer } from './layer-new.js';
import {
  blockIndices,
  isEffectivelyVisible,
  isGroupLayer,
  reparentOrphans
} from './layer-groups.js';

// The indices of the listed layers with everything inside listed groups, bottom first.
function withContents(layers, indices) {
  const out = new Set();
  for (const i of indices) for (const j of blockIndices(layers, i)) out.add(j);
  return [...out].sort((a, b) => a - b);
}

/**
 * A Layers row click (layer_select). sel is { ids, active, anchor } (layer ids); mode is
 * 'replace', 'toggle' (Ctrl/Cmd), or 'range' (Shift); order is the stack's ids. Returns the
 * next { ids, active, anchor }.
 */
export function clickLayerSelection(sel, id, mode, order) {
  const ids = sel.ids.filter((x) => order.includes(x));
  if (mode === 'toggle') {
    if (!ids.includes(id)) return { ids: [...ids, id], active: id, anchor: id };
    // Photoshop keeps at least the clicked layer targeted.
    if (ids.length === 1) return { ids, active: sel.active, anchor: sel.anchor };
    const rest = ids.filter((x) => x !== id);
    const active = sel.active === id ? rest[rest.length - 1] : sel.active;
    return { ids: rest, active, anchor: active };
  }
  if (mode === 'range') {
    const anchor = order.includes(sel.anchor)
      ? sel.anchor
      : order.includes(sel.active)
      ? sel.active
      : id;
    const a = order.indexOf(anchor),
      b = order.indexOf(id);
    return { ids: order.slice(Math.min(a, b), Math.max(a, b) + 1), active: id, anchor };
  }
  return { ids: [id], active: id, anchor: id };
}

/**
 * The selection for the current stack: sel.active is the active layer's id when the selection
 * was made; once something else changes the active layer (a new layer, an undo) the selection
 * is that layer alone. Ids no longer in the stack drop out. An empty list is Deselect Layers.
 */
export function syncLayerSelection(layers, activeIdx, sel) {
  const id = layers[activeIdx]?.id ?? null;
  if (!sel || sel.active !== id) return { ids: id === null ? [] : [id], active: id, anchor: id };
  const order = layers.map((l) => l.id);
  return { ids: sel.ids.filter((x) => order.includes(x)), active: id, anchor: sel.anchor };
}

/** syncLayerSelection over the app state's selectedLayers (Set), layerSelectionFor, layerAnchor. */
export function stateLayerSelection(state) {
  const sel = state.selectedLayers
    ? { ids: [...state.selectedLayers], active: state.layerSelectionFor, anchor: state.layerAnchor }
    : null;
  return syncLayerSelection(state.layers ?? [], state.activeLayerIdx, sel);
}

/** Select › All Layers: every layer but the Background (select_all_layers). */
export function allLayerIds(layers) {
  return layers.filter((l) => !isBackgroundLayer(l)).map((l) => l.id);
}

/**
 * Layer › Merge Layers with two or more selected: the visible ones composite into one layer at
 * the top selected layer's slot, named after it; hidden selected layers are discarded. With the
 * Background selected the result stays the Background at the bottom. A selected group merges
 * with everything in it (its pass-through or blend mode and opacity apply); the result is never
 * a group. Returns { keep, remove, sources, name } or { error }.
 */
export function mergeLayersPlan(layers, ids) {
  const listed = [];
  layers.forEach((l, i) => ids.includes(l.id) && listed.push(i));
  if (listed.length < 2) return { error: 'Merge Layers needs two or more layers' };
  const picked = withContents(layers, listed);
  const sources = picked.filter((i) => isEffectivelyVisible(layers, layers[i]));
  if (!sources.some((i) => !isGroupLayer(layers[i])))
    return { error: 'the selected layers are all hidden' };
  const content = picked.filter((i) => !isGroupLayer(layers[i]));
  const keep = isBackgroundLayer(layers[content[0]]) ? content[0] : content[content.length - 1];
  return { keep, remove: picked.filter((i) => i !== keep), sources, name: layers[keep].name };
}

/**
 * Layer › Merge Visible: every visible layer composites into the lowest visible one, which
 * keeps its name; hidden layers stay where they are. Visible groups merge too; a hidden layer
 * inside one moves up to the group's place. Returns a plan or { error }.
 */
export function mergeVisiblePlan(layers) {
  const sources = [];
  layers.forEach((l, i) => isEffectivelyVisible(layers, l) && sources.push(i));
  const content = sources.filter((i) => !isGroupLayer(layers[i]));
  if (content.length < 2) return { error: 'there are not enough visible layers to merge' };
  const keep = content[0];
  return { keep, remove: sources.filter((i) => i !== keep), sources, name: layers[keep].name };
}

/**
 * Layer › Delete › Hidden Layers: indices to remove (a hidden group with everything in it), or
 * { error } when none would be left.
 */
export function hiddenLayersPlan(layers) {
  const hidden = [];
  layers.forEach((l, i) => !l.visible && hidden.push(i));
  const remove = withContents(layers, hidden);
  if (remove.length === layers.length) return { error: 'a document must keep at least one layer' };
  return { remove };
}

/**
 * Carry out a merge plan on `layers` in place. flatten(sourceLayers) returns a canvas of those
 * layers composited over transparency. The kept layer becomes a plain, visible, Normal, 100 %
 * pixel layer with no mask (the composite already carries masks, opacity, blend modes and
 * adjustments). Layers left in a merged group move up to its place. Returns { merged, removed }
 * so the caller can update the DOM.
 */
export function applyMergePlan(layers, plan, flatten) {
  const before = layers.slice();
  const merged = layers[plan.keep];
  const flat = flatten(plan.sources.map((i) => layers[i]));
  const { width, height } = merged.canvas;
  if (isAdjustmentLayer(merged)) {
    merged.kind = 'pixel';
    delete merged.adjustmentId;
    delete merged.params;
  }
  merged.ctx.putImageData(flat.getContext('2d').getImageData(0, 0, width, height), 0, 0);
  merged.name = plan.name;
  merged.visible = true;
  merged.opacity = 1;
  merged.blendMode = 'source-over';
  merged.mask = null;
  merged.maskEnabled = true;
  const removed = removeLayersAt(layers, plan.remove);
  layers.splice(0, layers.length, ...reparentOrphans(layers, before));
  return { merged, removed };
}

/** Remove the layers at `indices` in place; returns the removed records. */
export function removeLayersAt(layers, indices) {
  const removed = indices.map((i) => layers[i]);
  for (const i of [...indices].sort((a, b) => b - a)) layers.splice(i, 1);
  return removed;
}
