// Layer locks and clipping masks (PhotoCraft doc Locks, engine layer_multi_cmds.rs lock_layers,
// extra_cmds.rs toggle_lock_transparency, commands.rs set_clipped, ui-egui
// shortcut_dispatch.rs clip_key_releases).
//
// layer.locks is { transparency, pixels, position, all } (missing on older layers and files:
// nothing locked). A group's locks reach every layer inside it (Document::effective_locks).
// Lock Image Pixels includes Lock Transparent Pixels, so locking the pixels clears that one.
//
// layer.clipped makes a layer clip to the nearest unclipped sibling below it, its base: it shows
// only where the base has alpha (layer-groups.js compositeTree). A clipped layer with no base
// below composites as a normal layer.
//
// Pixel buffers are RGBA bytes (Uint8ClampedArray, length W * H * 4).

import { isGroupLayer, isPixelSafeTool } from './layer-groups.js';

export const LOCK_KEYS = ['transparency', 'pixels', 'position', 'all'];

/** A layer's own locks as a full record (all false when it has none). */
export function layerLocks(layer) {
  const l = layer?.locks ?? {};
  return {
    transparency: l.transparency === true,
    pixels: l.pixels === true,
    position: l.position === true,
    all: l.all === true
  };
}

/** Locks::set: a copy of locks with `key` on or off. */
export function setLock(locks, key, on) {
  const out = { ...layerLocks({ locks }) };
  if (key === 'transparency') out.transparency = on && !out.pixels;
  else if (key === 'pixels') {
    out.pixels = on;
    if (on) out.transparency = false;
  } else if (key === 'position' || key === 'all') out[key] = on;
  return out;
}

/** True when any lock is on. */
export function anyLock(locks) {
  return LOCK_KEYS.some((k) => locks?.[k] === true);
}

/** The layer's locks joined with those of every group holding it. */
export function effectiveLocks(layers, layer) {
  const out = layerLocks(layer);
  const stack = layers ?? [];
  const groups = new Map(stack.filter(isGroupLayer).map((g) => [g.id, g]));
  for (
    let p = groups.get(layer?.parentId), n = 0;
    p && n < stack.length;
    p = groups.get(p.parentId), n++
  ) {
    for (const k of LOCK_KEYS) out[k] = out[k] || p.locks?.[k] === true;
  }
  return out;
}

export function pixelsLocked(layers, layer) {
  const l = effectiveLocks(layers, layer);
  return l.pixels || l.all;
}

export function positionLocked(layers, layer) {
  const l = effectiveLocks(layers, layer);
  return l.position || l.all;
}

/** Lock Transparent Pixels is on and the pixels may still change. */
export function transparencyLocked(layers, layer) {
  const l = effectiveLocks(layers, layer);
  return l.transparency && !l.pixels && !l.all;
}

/**
 * Layer › Lock Layers… (lock_layers): `given` names locks to set ({ key: bool }) on every listed
 * layer; with none given, Lock All toggles (on unless every one is already locked). Returns the
 * new locks per id, so the caller can push undo before applying.
 */
export function lockLayersPlan(layers, ids, given = {}) {
  const targets = layers.filter((l) => ids.includes(l.id));
  let entries = Object.entries(given).filter(
    ([k, v]) => LOCK_KEYS.includes(k) && typeof v === 'boolean'
  );
  if (!entries.length) entries = [['all', !targets.every((l) => layerLocks(l).all)]];
  return targets.map((l) => {
    let locks = layerLocks(l);
    for (const [k, v] of entries) locks = setLock(locks, k, v);
    return { id: l.id, locks };
  });
}

/**
 * `/` (toggle_lock_transparency): Lock Transparent Pixels on or off for the listed layers, the
 * Background left out; any unlocked one means lock them all. null when only the Background is
 * listed.
 */
export function toggleTransparencyPlan(layers, ids, isBackground = () => false) {
  const targets = layers.filter((l) => ids.includes(l.id) && !isBackground(l));
  if (!targets.length) return null;
  const lock = !targets.every((l) => layerLocks(l).transparency);
  return {
    lock,
    plan: targets.map((l) => ({ id: l.id, locks: setLock(layerLocks(l), 'transparency', lock) }))
  };
}

/** Write a lock plan onto the stack. */
export function applyLockPlan(layers, plan) {
  for (const { id, locks } of plan) {
    const layer = layers.find((l) => l.id === id);
    if (layer) layer.locks = { ...locks };
  }
}

// The Move tool moves pixels without repainting them: only Lock Position stops it (paint.js).
const MOVE_TOOL = 'select';

/** The status note when a tool cannot paint because the layer's pixels are locked, or null. */
export function lockToolRefusal(layers, layer, toolId, label = toolId) {
  if (!layer || toolId === MOVE_TOOL || isPixelSafeTool(toolId)) return null;
  if (!pixelsLocked(layers, layer)) return null;
  return `Could not use the ${label}: the layer "${layer.name}" is locked`;
}

/** The tool writes pixels that Lock Transparent Pixels must keep the alpha of. */
export function keepsAlphaFor(layers, layer, toolId) {
  return toolId !== MOVE_TOOL && !isPixelSafeTool(toolId) && transparencyLocked(layers, layer);
}

// ── Clipping ─────────────────────────────────────────────────────────────────

/** The siblings of layers[idx] (same parentId), bottom first, as indices. */
function siblingIndices(layers, idx) {
  const parent = layers[idx]?.parentId ?? null;
  const out = [];
  for (let i = 0; i < layers.length; i++) if ((layers[i].parentId ?? null) === parent) out.push(i);
  return out;
}

/** The index of the layer layers[idx] clips to, or -1 when it has no base (or is not clipped). */
export function clipBaseIndex(layers, idx) {
  if (!layers[idx]?.clipped) return -1;
  const sibs = siblingIndices(layers, idx);
  for (let k = sibs.indexOf(idx) - 1; k >= 0; k--) if (!layers[sibs[k]].clipped) return sibs[k];
  return -1;
}

/** Can layers[idx] clip to the layer below it? It needs a sibling below (not the Background). */
export function canClip(layers, idx) {
  const sibs = siblingIndices(layers, idx);
  return sibs.indexOf(idx) > 0;
}

/** The clipped siblings directly above layers[idx] (clip_group clipped_above), as ids. */
export function clippedAbove(layers, idx) {
  const sibs = siblingIndices(layers, idx);
  const out = [];
  for (let k = sibs.indexOf(idx) + 1; k < sibs.length && layers[sibs[k]].clipped; k++)
    out.push(layers[sibs[k]].id);
  return out;
}

/**
 * clip_key_releases: Create Clipping Mask would release. With one layer selected, that layer is
 * clipped; with several, every one but the lowest is.
 */
export function clipKeyReleases(layers, ids) {
  const picked = layers.filter((l) => ids.includes(l.id));
  if (!picked.length) return false;
  const clips = picked.length === 1 ? picked : picked.slice(1);
  return clips.every((l) => l.clipped === true);
}

/**
 * Layer › Create / Release Clipping Mask (set_clipped): the ids whose clipped flag becomes
 * `clip`. Create clips every selected layer but the lowest (one selected: that layer); Release
 * releases every selected layer and the clipped layers above each, so none is left clipped to a
 * released layer. Layers that cannot clip (nothing below them) are left out.
 */
export function clipPlan(layers, ids, clip) {
  const picked = layers.filter((l) => ids.includes(l.id));
  let targets = clip && picked.length > 1 ? picked.slice(1) : picked;
  if (clip) return targets.filter((l) => canClip(layers, layers.indexOf(l))).map((l) => l.id);
  const out = targets.map((l) => l.id);
  for (const l of targets) {
    if (!l.clipped) continue;
    for (const id of clippedAbove(layers, layers.indexOf(l))) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Set clipped on the listed layers. */
export function applyClipPlan(layers, ids, clip) {
  for (const l of layers) if (ids.includes(l.id)) l.clipped = clip;
}

// ── Lock Transparent Pixels on a stroke ──────────────────────────────────────

/**
 * What painting with Lock Transparent Pixels leaves (composite_atop): before's alpha kept, and
 * the colour the stroke would have given atop it. after is the layer after an ordinary
 * source-over stroke; it is rewritten in place. Where the stroke lowered alpha (an eraser,
 * smudging an edge) the new colour stays and the old alpha comes back.
 */
export function preserveAlpha(before, after) {
  for (let i = 0; i < after.length; i += 4) {
    const ab = before[i + 3];
    if (ab === 0) {
      after[i] = before[i];
      after[i + 1] = before[i + 1];
      after[i + 2] = before[i + 2];
      after[i + 3] = 0;
      continue;
    }
    const ao = after[i + 3];
    if (ao > ab && ab < 255) {
      // Undo the source over: as is the stroke's alpha, and the atop colour is
      // co·ao + (1 − as)(1 − ab)·d over straight 0..1 values.
      const a0 = ab / 255,
        a1 = ao / 255;
      const as = (a1 - a0) / (1 - a0);
      for (let c = 0; c < 3; c++) {
        const v = (after[i + c] / 255) * a1 + (1 - as) * (1 - a0) * (before[i + c] / 255);
        after[i + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
      }
    }
    after[i + 3] = ab;
  }
  return after;
}
