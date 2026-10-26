// Whole-stack undo snapshots (PhotoCraft history records the document, not one layer).
// Structure commands (new / delete / duplicate / merge / flatten / reorder / canvas size)
// store one of these; brush strokes keep the single-layer snapshot via layerSnapshot.

import { isAdjustmentLayer } from './adjustment-layers.js';
import { cloneFill, isFillLayer } from './fill-layers.js';
import { cropMask } from './layer-mask.js';
import { syncLayerMask } from './layer-dom.js';
import { cloneStyles } from './layer-style.js';
import { isShapeLayer, normalizeShape } from './shapes.js';
import { cloneSmart, isSmartLayer } from './smart-objects.js';
import { isTypeLayer, normalizeType } from './type-layers.js';

// pushUndo labels whose entry carries a stack snapshot.
export const STACK_UNDO_LABELS = new Set([
  'New Layer',
  'Delete Layer',
  'Duplicate layer',
  'Merge down',
  'Merge Layers',
  'Merge Visible',
  'Delete Hidden Layers',
  'Flatten',
  'Move Layer Up',
  'Move Layer Down',
  'New Adjustment Layer',
  'New Color Fill Layer',
  'New Gradient Fill Layer',
  'New Pattern Fill Layer',
  'Convert to Smart Object',
  'New Smart Object via Copy',
  'Convert to Layers',
  'Rasterize Smart Object',
  'New Type Layer',
  'Rasterize Type',
  'New Shape Layer',
  'Rasterize Shape',
  'Unite Shapes',
  'Subtract Front Shape',
  'Intersect Shape Areas',
  'Exclude Overlapping Shapes',
  'Merge Shape Components',
  'Add Vector Mask',
  'Delete Vector Mask',
  'Enable Vector Mask',
  'Disable Vector Mask',
  'Rasterize Vector Mask',
  'Rasterize Layer',
  'Rasterize All Layers',
  'Resize',
  'Image Size',
  'Crop',
  'Trim',
  'Grayscale',
  'RGB Color',
  'Indexed Color',
  'Bitmap',
  'Color Table',
  'Perspective Crop',
  'Rotate Canvas',
  'Flip Canvas Horizontal',
  'Flip Canvas Vertical',
  'Revert',
  'Place Embedded',
  'Delete All Empty Layers',
  'Flatten All Masks',
  'Paste Into',
  'Paste Outside',
  'Layer Via Copy',
  'Layer Via Cut',
  'Layer From Background',
  'Background From Layer',
  'New Group',
  'Group Layers',
  'Ungroup Layers',
  'Duplicate Group',
  'Delete Group',
  'Create Clipping Mask',
  'Release Clipping Mask',
  'Lock Layers',
  'Lock Transparent Pixels',
  'Unlock Transparent Pixels',
  'Arrange',
  'Reverse',
  'Align',
  'Distribute',
  'Layer Style',
  'Fill Opacity',
  'Paste Layer Style',
  'Apply Style',
  'Clear Layer Style',
  'Hide All Effects',
  'Link Layers',
  'Unlink Layers',
  'Apply Layer Comp'
]);

export function isStackUndoLabel(label) {
  return STACK_UNDO_LABELS.has(label);
}

function copyPixels(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

function copyRecord(r) {
  return {
    ...r,
    pixels: r.pixels ? copyPixels(r.pixels) : null,
    mask: r.mask ? r.mask.slice() : null,
    locks: { ...r.locks },
    styles: cloneStyles(r.styles),
    ...(r.params ? { params: { ...r.params } } : {}),
    ...(r.fill ? { fill: cloneFill(r.fill) } : {}),
    ...(r.smart ? { smart: cloneSmart(r.smart) } : {}),
    ...(r.type ? { type: normalizeType(r.type) } : {}),
    ...(r.shape ? { shape: normalizeShape(r.shape) } : {})
  };
}

/**
 * Deep copy of the layer stack. Pixel data is read through layer.ctx (or layer.data),
 * so later edits to the live layers do not reach the snapshot.
 */
export function snapshotStack(layers, activeIdx) {
  const first = layers[0];
  const width = first?.canvas?.width ?? first?.data?.width ?? 0;
  const height = first?.canvas?.height ?? first?.data?.height ?? 0;
  const records = layers.map((layer) => {
    const w = layer.canvas?.width ?? width;
    const h = layer.canvas?.height ?? height;
    const src = layer.ctx ? layer.ctx.getImageData(0, 0, w, h) : layer.data;
    const record = {
      id: layer.id,
      kind: layer.kind || 'pixel',
      name: layer.name,
      opacity: layer.opacity ?? 1,
      visible: layer.visible !== false,
      blendMode: layer.blendMode || 'source-over',
      pixels: src ? copyPixels(src) : null,
      mask: layer.mask ? layer.mask.slice() : null,
      maskEnabled: layer.maskEnabled !== false,
      maskDensity: layer.maskDensity ?? 1,
      maskFeather: layer.maskFeather ?? 0,
      // Vector mask records are never mutated, so the snapshot can share one.
      vectorMask: layer.vectorMask ?? null,
      background: layer.background === true,
      parentId: layer.parentId ?? null,
      clipped: layer.clipped === true,
      linkId: layer.linkId ?? null,
      locks: { ...layer.locks },
      styles: cloneStyles(layer.styles)
    };
    if (record.kind === 'group') record.collapsed = layer.collapsed === true;
    if (record.kind === 'adjustment') {
      record.adjustmentId = layer.adjustmentId;
      record.params = { ...layer.params };
    }
    if (record.kind === 'fill') record.fill = cloneFill(layer.fill);
    if (record.kind === 'smart') record.smart = cloneSmart(layer.smart);
    if (record.kind === 'type') record.type = normalizeType(layer.type);
    if (record.kind === 'shape') record.shape = normalizeShape(layer.shape);
    return record;
  });
  return { width, height, activeIdx, layers: records };
}

/**
 * Plain records for paint.js to remount: { width, height, activeIdx, layers }. Each call
 * returns fresh copies, so the snapshot can be restored again (redo after undo).
 */
export function restoreStack(snapshot) {
  const count = snapshot.layers.length;
  return {
    width: snapshot.width,
    height: snapshot.height,
    activeIdx: Math.max(0, Math.min(snapshot.activeIdx, count - 1)),
    layers: snapshot.layers.map(copyRecord)
  };
}

/** Single-layer undo entry fields (pixels + mask + kind payload). */
export function layerSnapshot(layer) {
  return {
    data: layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height),
    mask: layer.mask ? layer.mask.slice() : null,
    maskEnabled: layer.maskEnabled !== false,
    maskDensity: layer.maskDensity ?? 1,
    maskFeather: layer.maskFeather ?? 0,
    // An erase or transform that turns the Background into Layer 0 undoes with its pixels.
    name: layer.name,
    background: layer.background === true,
    ...(isAdjustmentLayer(layer) ? { params: { ...layer.params } } : {}),
    ...(isFillLayer(layer) ? { fill: cloneFill(layer.fill) } : {}),
    ...(isSmartLayer(layer) ? { smart: cloneSmart(layer.smart) } : {}),
    ...(isTypeLayer(layer) ? { type: normalizeType(layer.type) } : {}),
    ...(isShapeLayer(layer) ? { shape: normalizeShape(layer.shape) } : {})
  };
}

/** Apply a single-layer undo entry onto a live layer (mask resized if canvas size drifted). */
export function restoreLayerSnapshot(layer, entry) {
  layer.ctx.putImageData(entry.data, 0, 0);
  if (entry.params && isAdjustmentLayer(layer)) layer.params = { ...entry.params };
  if (entry.fill && isFillLayer(layer)) {
    layer.fill = cloneFill(entry.fill);
    layer.fillSize = [entry.data.width, entry.data.height];
  }
  if (entry.smart && isSmartLayer(layer)) {
    layer.smart = cloneSmart(entry.smart);
    layer.smartSize = [entry.data.width, entry.data.height];
  }
  if (entry.type && isTypeLayer(layer)) {
    layer.type = normalizeType(entry.type);
    layer.typeSize = [entry.data.width, entry.data.height];
  }
  if (entry.shape && isShapeLayer(layer)) {
    layer.shape = normalizeShape(entry.shape);
    layer.shapeSize = [entry.data.width, entry.data.height];
  }
  if ('background' in entry) {
    layer.name = entry.name;
    layer.background = entry.background;
  }
  if (!('mask' in entry)) return;
  const { width: W, height: H } = layer.canvas;
  let mask = entry.mask ? entry.mask.slice() : null;
  // Undo across a canvas-size change restores pixels at the top-left; keep the mask in step.
  if (mask && mask.length !== W * H) {
    mask = cropMask(mask, entry.data.width, entry.data.height, 0, 0, W, H);
  }
  layer.mask = mask;
  layer.maskEnabled = entry.maskEnabled;
  layer.maskDensity = entry.maskDensity ?? 1;
  layer.maskFeather = entry.maskFeather ?? 0;
  syncLayerMask(layer);
}
