// Layer management — panel + stack orchestration. Kind create/render lives in kind Modules;
// createLayer / syncLayerMask are re-exported from layer-shell / layer-dom for stable imports.

import {
  applyLayerMask,
  compositeMask,
  maskAlphaRgba,
  maskToRgba,
  newLayerMask
} from './layer-mask.js';
import {
  ADJUSTMENT_LAYER_IDS,
  applyAdjustmentLayer,
  createAdjustmentLayer,
  isAdjustmentLayer
} from './adjustment-layers.js';
import { ADJUSTMENTS } from './adjustments.js';
import {
  FILL_LAYER_TYPES,
  cloneFill,
  createFillLayer,
  isFillLayer,
  refreshFillLayers,
  renderFill,
  renderFillLayer
} from './fill-layers.js';
import { syncLayerDOM, syncLayerMask } from './layer-dom.js';
import { createLayer } from './layer-shell.js';
import { iconSvg } from './icons.js';
import { openPopupMenu } from './popup-menu.js';
import { anyLock, clipBaseIndex, layerLocks } from './layer-locks.js';
import { FILTER_KINDS, defaultLayerFilter, layerFilterShows } from './layer-filter.js';
import {
  PASS_THROUGH,
  atopBytes,
  compositeTree,
  displayRows,
  isGroupLayer,
  layerTree
} from './layer-groups.js';
import {
  canHaveStyle,
  cloneStyles,
  drawsStyle,
  fillOpacityOf,
  hasLayerStyle,
  renderEffectParts,
  renderEffects
} from './layer-style.js';
import {
  cloneSmart,
  createSmartLayer,
  isSmartLayer,
  refreshSmartLayers,
  renderSmart,
  renderSmartLayer
} from './smart-objects.js';
import {
  createTypeLayer,
  isTypeLayer,
  normalizeType,
  refreshTypeLayers,
  renderType,
  renderTypeLayer
} from './type-layers.js';
import {
  createShapeLayer,
  isShapeLayer,
  normalizeShape,
  refreshShapeLayers,
  renderShape,
  renderShapeLayer
} from './shapes.js';
import { normalizeVectorMask, vectorMaskActive } from './combine-shapes.js';

export { createLayer } from './layer-shell.js';
export { syncLayerDOM, syncLayerMask } from './layer-dom.js';
export { createFillLayer, renderFillLayer, refreshFillLayers } from './fill-layers.js';
export { createAdjustmentLayer } from './adjustment-layers.js';
export { createSmartLayer, renderSmartLayer, refreshSmartLayers } from './smart-objects.js';
export { createTypeLayer, renderTypeLayer, refreshTypeLayers } from './type-layers.js';
export { createShapeLayer, renderShapeLayer, refreshShapeLayers } from './shapes.js';

// Blend modes mapped to canvas globalCompositeOperation values.
// CSS mix-blend-mode uses the same names (with 'normal' = 'source-over').
export const BLEND_MODES = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' }
];

// A group's Mode list: Pass Through (the default) and then the layer modes.
export const GROUP_BLEND_MODES = [{ value: PASS_THROUGH, label: 'Pass Through' }, ...BLEND_MODES];

/**
 * A layer group (layer-groups.js): no pixels of its own (its canvas stays empty and hidden),
 * Pass Through by default, open in the Layers panel unless collapsed.
 */
export function createGroupLayer(name, w, h) {
  const layer = createLayer(name, w, h);
  layer.kind = 'group';
  layer.blendMode = PASS_THROUGH;
  layer.collapsed = false;
  syncLayerDOM(layer);
  return layer;
}

/** Copy pixels, opacity, visibility, blend mode, and mask from src onto dst. */
export function copyLayerContents(src, dst) {
  const { width, height } = src.canvas;
  dst.ctx.putImageData(src.ctx.getImageData(0, 0, width, height), 0, 0);
  dst.opacity = src.opacity;
  dst.visible = src.visible;
  dst.blendMode = src.blendMode || 'source-over';
  dst.kind = src.kind || 'pixel';
  if (isAdjustmentLayer(src)) {
    dst.adjustmentId = src.adjustmentId;
    dst.params = { ...src.params };
  }
  if (isFillLayer(src)) {
    dst.fill = cloneFill(src.fill);
    dst.fillSize = src.fillSize?.slice();
  }
  if (isSmartLayer(src)) {
    dst.smart = cloneSmart(src.smart);
    dst.smartSize = src.smartSize?.slice();
  }
  if (isTypeLayer(src)) {
    dst.type = normalizeType(src.type);
    dst.typeSize = src.typeSize?.slice();
  }
  if (isShapeLayer(src)) {
    dst.shape = normalizeShape(src.shape);
    dst.shapeSize = src.shapeSize?.slice();
  }
  if (isGroupLayer(src)) dst.collapsed = src.collapsed === true;
  dst.clipped = src.clipped === true;
  dst.locks = layerLocks(src);
  dst.styles = cloneStyles(src.styles);
  dst.mask = src.mask ? src.mask.slice() : null;
  dst.maskEnabled = src.maskEnabled !== false;
  dst.maskDensity = src.maskDensity ?? 1;
  dst.maskFeather = src.maskFeather ?? 0;
  dst.vectorMask = normalizeVectorMask(src.vectorMask);
  if (dst.mask || src.mask || dst.vectorMask) syncLayerMask(dst);
  return dst;
}

/** The canvas the composite draws: the layer, or a copy with its enabled mask applied. */
export function layerSource(layer) {
  const { width, height } = layer.canvas;
  const shown = compositeMask(layer, width);
  if (!shown) return layer.canvas;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const masked = applyLayerMask(layer.ctx.getImageData(0, 0, width, height), shown);
  const img = ctx.createImageData(width, height);
  img.data.set(masked.data);
  ctx.putImageData(img, 0, 0);
  return out;
}

function imageCanvas(img) {
  const c = blankCanvas(img.width, img.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const out = ctx.createImageData(img.width, img.height);
  out.data.set(img.data);
  ctx.putImageData(out, 0, 0);
  return c;
}

function sourcePixels(layer) {
  const { width, height } = layer.canvas;
  return layerSource(layer)
    .getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, width, height);
}

/**
 * A layer with live effects as canvases: { under: [{ canvas, mode }], body }, or null when it
 * draws none (layer-style.js renderEffectParts).
 */
export function styledLayerParts(layer) {
  if (!drawsStyle(layer)) return null;
  const { under, body } = renderEffectParts(sourcePixels(layer), layer.styles);
  return {
    under: under.map((u) => ({ canvas: imageCanvas(u.image), mode: u.mode })),
    body: imageCanvas(body)
  };
}

/** The canvas a layer shows alone: its masked pixels, with its effects when it has any. */
export function styledLayerSource(layer) {
  if (!drawsStyle(layer)) return layerSource(layer);
  return imageCanvas(renderEffects(sourcePixels(layer), layer.styles));
}

/**
 * True when the layer at idx has a layer below it to merge into: its sibling directly below,
 * neither of them a group, the one below not an adjustment, fill, smart, or type layer.
 */
export function canMergeDown(layers, idx) {
  if (!(idx > 0 && idx < layers.length)) return false;
  const [below, layer] = [layers[idx - 1], layers[idx]];
  if (isGroupLayer(layer) || isGroupLayer(below) || isAdjustmentLayer(below)) return false;
  // A fill, smart, or type layer's pixels are rendered from its record; nothing merges into them.
  if (isFillLayer(below) || isSmartLayer(below) || isTypeLayer(below) || isShapeLayer(below)) {
    return false;
  }
  return (below.parentId ?? null) === (layer.parentId ?? null);
}

/**
 * Composite src onto dst using src's opacity and blend mode. A hidden src
 * leaves dst unchanged. Returns dst.
 */
export function compositeLayerOnto(src, dst) {
  if (!src.visible || isGroupLayer(src)) return dst;
  const ctx = dst.ctx;
  if (isAdjustmentLayer(src)) {
    // Merging an adjustment layer down bakes it into the pixels below.
    const { width, height } = dst.canvas;
    const img = ctx.getImageData(0, 0, width, height);
    applyAdjustmentLayer(img.data, src, width, height);
    ctx.putImageData(img, 0, 0);
    return dst;
  }
  ctx.save();
  ctx.globalAlpha = src.opacity;
  // A layer clipped to the one it merges into (its base) shows only where that one has alpha.
  const mode = src.blendMode || 'source-over';
  const atop = src.clipped && !dst.clipped && mode === 'source-over';
  // Merging bakes the layer's effects into the pixels: the exterior ones first, each in its mode.
  const parts = styledLayerParts(src);
  for (const u of atop ? [] : parts?.under ?? []) {
    ctx.globalCompositeOperation = u.mode;
    ctx.drawImage(u.canvas, 0, 0);
  }
  ctx.globalCompositeOperation = atop ? 'source-atop' : mode;
  ctx.drawImage(parts ? parts.body : layerSource(src), 0, 0);
  ctx.restore();
  return dst;
}

export function insertLayerBefore(layer, stackEl, refEl) {
  stackEl.insertBefore(layer.canvas, refEl);
  syncLayerDOM(layer);
}

export function removeLayerFromDOM(layer) {
  layer.canvas.remove();
}

function blankCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function drawWith(ctx, src, opacity, mode) {
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = mode || 'source-over';
  ctx.drawImage(src, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// The canvas backend for compositeTree (layer-groups.js): buffers are canvases.
function canvasCompositeOps(w, h) {
  const ctxOf = (c) => c.getContext('2d', { willReadFrequently: true });
  return {
    layer(dst, layer) {
      const parts = styledLayerParts(layer);
      for (const u of parts?.under ?? []) drawWith(ctxOf(dst), u.canvas, layer.opacity, u.mode);
      drawWith(ctxOf(dst), parts ? parts.body : layerSource(layer), layer.opacity, layer.blendMode);
    },
    adjust(dst, layer) {
      const ctx = ctxOf(dst);
      const img = ctx.getImageData(0, 0, w, h);
      applyAdjustmentLayer(img.data, layer, w, h);
      ctx.putImageData(img, 0, 0);
    },
    create: () => blankCanvas(w, h),
    copy(buf) {
      const c = blankCanvas(w, h);
      ctxOf(c).drawImage(buf, 0, 0);
      return c;
    },
    isolate(layer) {
      const c = blankCanvas(w, h);
      ctxOf(c).drawImage(styledLayerSource(layer), 0, 0);
      return c;
    },
    draw: (dst, src, opacity, mode) => drawWith(ctxOf(dst), src, opacity, mode),
    drawAtop(dst, src, opacity, mode) {
      const ctx = ctxOf(dst);
      if ((mode || 'source-over') === 'source-over') {
        drawWith(ctx, src, opacity, 'source-atop');
        return;
      }
      const img = ctx.getImageData(0, 0, w, h);
      atopBytes(img.data, ctxOf(src).getImageData(0, 0, w, h).data, opacity, mode);
      ctx.putImageData(img, 0, 0);
    },
    mix(dst, before, k) {
      // The group's result at k over the backdrop it started from.
      const after = this.copy(dst);
      const ctx = ctxOf(dst);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(before, 0, 0);
      drawWith(ctx, after, k, 'source-over');
    }
  };
}

// Returns a flat offscreen canvas compositing all visible layers,
// applying each layer's blendMode via globalCompositeOperation. An adjustment
// layer runs on the composite so far (adjustment-layers.js); groups composite their
// children as layer-groups.js compositeTree describes.
// opts.objects — optional placed text/image objects drawn on top.
export function flattenToCanvas(layers, bgColor, w, h, opts = {}) {
  const flat = blankCanvas(w, h);
  const flatCtx = flat.getContext('2d', { willReadFrequently: true });
  if (opts.transparentBg !== true) {
    flatCtx.fillStyle = bgColor;
    flatCtx.fillRect(0, 0, w, h);
  }
  compositeTree(layerTree(layers), flat, canvasCompositeOps(w, h));
  if (opts.objects?.length && opts.drawObjects) {
    opts.drawObjects(flatCtx, opts.objects);
  }
  return flat;
}

// The Layers panel (PhotoCraft panels.rs): the filter row, the active layer's blend mode and
// Opacity above the list, rows of eye / thumbnail / mask thumbnail / name, and the icon footer.
export function renderLayerPanel(layers, activeIdx, container, callbacks) {
  // Typing in the Name filter re-renders the panel; keep the field focused across it.
  const typing = container.querySelector('.layer-filter-name') === document.activeElement;
  container.innerHTML = '';
  const active = layers[activeIdx];
  const filter =
    callbacks.layerFilter && typeof callbacks.layerFilter === 'object'
      ? callbacks.layerFilter
      : defaultLayerFilter();

  container.appendChild(layerFilterRow(filter, callbacks));
  container.appendChild(layerPanelHeader(active, activeIdx, callbacks));

  const list = document.createElement('div');
  list.className = 'layer-list';
  let dragFrom = -1;
  const clipBases = new Set(layers.map((_, k) => clipBaseIndex(layers, k)));

  // Render top-to-bottom (last in array = top visually); a group's children sit indented under
  // it and a collapsed group hides them (layer-groups.js displayRows).
  for (const { idx: i, depth } of displayRows(layers)) {
    const layer = layers[i];
    if (!layerFilterShows(filter, layer)) continue;
    const group = isGroupLayer(layer);
    const isActive = i === activeIdx;
    // callbacks.selectedIds (a Set of layer ids) is the multi-selection; without it the active
    // row is the selection.
    const isSelected =
      callbacks.selectedIds instanceof Set ? callbacks.selectedIds.has(layer.id) : isActive;

    const row = document.createElement('div');
    row.className =
      'layer-row' + (isActive && isSelected ? ' active' : '') + (isSelected ? ' selected' : '');
    row.tabIndex = 0;
    row.setAttribute('aria-selected', String(isSelected));
    row.dataset.index = String(i);
    row.style.setProperty('--layer-depth', String(depth));
    if (depth) row.dataset.depth = String(depth);
    const adjustment = isAdjustmentLayer(layer);
    // A fill layer edits like an adjustment layer: its mask is the target, double-click edits.
    const fill = isFillLayer(layer);

    const visBtn = document.createElement('button');
    visBtn.className = 'layer-vis-btn';
    visBtn.title = 'Toggle visibility';
    visBtn.setAttribute('aria-label', layer.visible ? 'Hide layer' : 'Show layer');
    visBtn.setAttribute('aria-pressed', String(layer.visible));
    visBtn.appendChild(iconSvg(layer.visible ? 'eye' : 'eye-off', 14));
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onToggleVisible(i);
    });

    // A group row: the disclosure triangle and a folder in place of the thumbnail.
    let disclosure = null;
    if (group) {
      row.classList.add('layer-group-row');
      row.setAttribute('aria-expanded', String(!layer.collapsed));
      disclosure = document.createElement('button');
      disclosure.className = 'layer-disclosure';
      const verb = layer.collapsed ? 'Expand' : 'Collapse';
      disclosure.title = `${verb} group`;
      disclosure.setAttribute('aria-label', `${verb} group ${layer.name}`);
      disclosure.appendChild(iconSvg(layer.collapsed ? 'chevron-right' : 'chevron-down', 12));
      disclosure.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onToggleCollapsed?.(i);
      });
    }

    const thumb = group ? document.createElement('span') : document.createElement('canvas');
    thumb.className = group ? 'layer-thumb layer-group-icon' : 'layer-thumb';
    if (group) thumb.appendChild(iconSvg(layer.collapsed ? 'folder' : 'folder-open', 18));
    else {
      thumb.width = 32;
      thumb.height = 24;
      drawLayerThumb(thumb, layer);
    }
    const maskTarget = isActive && callbacks.maskTarget && layer.mask;
    thumb.classList.toggle('target', isActive && !!layer.mask && !maskTarget);
    // A smart object's thumbnail carries PhotoCraft's smart badge (style.css .layer-thumb.smart).
    thumb.classList.toggle('smart', isSmartLayer(layer));
    thumb.title = adjustment
      ? 'Double-click to edit the adjustment'
      : fill
      ? 'Double-click to edit the fill'
      : isSmartLayer(layer)
      ? 'Smart object'
      : isTypeLayer(layer)
      ? 'Type layer'
      : isShapeLayer(layer)
      ? 'Shape layer'
      : 'Edit layer pixels';
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (adjustment || fill) callbacks.onTargetMask?.(i);
      else callbacks.onTargetLayer?.(i);
    });

    let maskThumb = null;
    if (layer.mask) {
      maskThumb = document.createElement('canvas');
      maskThumb.className =
        'layer-mask-thumb' +
        (maskTarget ? ' target' : '') +
        (layer.maskEnabled === false ? ' disabled' : '');
      maskThumb.width = 32;
      maskThumb.height = 24;
      maskThumb.title = 'Layer mask (click to edit, Shift-click to disable / enable)';
      maskThumb.setAttribute('aria-label', `${layer.name} layer mask`);
      drawMaskThumb(maskThumb, layer);
      maskThumb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.shiftKey) callbacks.onToggleMask?.(i);
        else callbacks.onTargetMask?.(i);
      });
    }

    // A clipped row is indented behind PhotoCraft's clip glyph; its base's name is underlined.
    let clipGlyph = null;
    if (clipBaseIndex(layers, i) >= 0) {
      row.classList.add('layer-clipped');
      clipGlyph = document.createElement('span');
      clipGlyph.className = 'layer-clip-glyph';
      clipGlyph.title = 'Clipped to the layer below';
      clipGlyph.appendChild(iconSvg('clip-below', 12));
    } else if (clipBases.has(i)) {
      row.classList.add('layer-clip-base');
    }
    // A linked layer shows PhotoCraft's link glyph after its name (layer-link.js).
    let linkGlyph = null;
    if (layer.linkId) {
      linkGlyph = document.createElement('span');
      linkGlyph.className = 'layer-link-glyph';
      linkGlyph.title = 'Linked';
      linkGlyph.appendChild(iconSvg('link-2', 12));
    }
    let lockGlyph = null;
    if (anyLock(layerLocks(layer))) {
      lockGlyph = document.createElement('span');
      lockGlyph.className = 'layer-lock-glyph';
      lockGlyph.title = 'Locked';
      lockGlyph.appendChild(iconSvg('lock', 12));
    }

    // PhotoCraft's fx badge on a layer with a style; double-click opens Layer Style.
    let fxBadge = null;
    if (hasLayerStyle(layer)) {
      fxBadge = document.createElement('button');
      fxBadge.className = 'layer-fx-badge';
      if (layer.styles.enabled === false) fxBadge.classList.add('hidden-effects');
      fxBadge.title = 'Layer style (double-click to edit)';
      fxBadge.setAttribute('aria-label', `${layer.name} layer style`);
      fxBadge.appendChild(iconSvg('fx', 14));
      fxBadge.addEventListener('click', (e) => e.stopPropagation());
      fxBadge.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        callbacks.onActivate(i);
        callbacks.onLayerStyle?.();
      });
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'layer-name';
    nameEl.textContent = layer.name;
    nameEl.title = 'Double-click to rename';
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      beginRename(nameEl, layer, i, callbacks);
    });

    row.appendChild(visBtn);
    if (clipGlyph) row.appendChild(clipGlyph);
    if (disclosure) row.appendChild(disclosure);
    row.appendChild(thumb);
    if (maskThumb) row.appendChild(maskThumb);
    row.appendChild(nameEl);
    if (fxBadge) row.appendChild(fxBadge);
    if (linkGlyph) row.appendChild(linkGlyph);
    if (lockGlyph) row.appendChild(lockGlyph);
    // Alt-click on the line between this row and the one below toggles clipping (Photoshop's
    // clip cursor, PhotoCraft clip_line_ui); the row stands for the upper layer of that pair.
    row.addEventListener('click', (e) => {
      if (e.altKey && typeof callbacks.onToggleClip === 'function') callbacks.onToggleClip(i);
      else callbacks.onActivate(i, e);
    });
    if (adjustment) row.addEventListener('dblclick', () => callbacks.onEditAdjustment?.(i));
    if (fill) row.addEventListener('dblclick', () => callbacks.onEditFill?.(i));

    // Drag a row onto another to restack, as in PhotoCraft.
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      dragFrom = i;
      e.dataTransfer?.setData('text/plain', layer.name);
    });
    row.addEventListener('dragover', (e) => {
      if (dragFrom >= 0 && dragFrom !== i) e.preventDefault();
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      // Onto a group's row the layer goes into the group (layer-groups.js moveLayerPlan).
      if (dragFrom >= 0 && dragFrom !== i) callbacks.onMove?.(dragFrom, i);
      dragFrom = -1;
    });
    row.addEventListener('dragend', () => (dragFrom = -1));

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      callbacks.onActivate(i);
      openPopupMenu(document.body, e.clientX, e.clientY, [
        {
          label: group ? 'Duplicate Group' : 'Duplicate Layer',
          run: () => callbacks.onDuplicate(i)
        },
        {
          label: group ? 'Delete Group' : 'Delete Layer',
          run: () => callbacks.onDelete(i),
          disabled: layers.length <= 1
        },
        {
          label: 'Merge Down',
          run: () => callbacks.onMergeDown(i),
          disabled: !canMergeDown(layers, i)
        },
        { label: 'Flatten Image', run: () => callbacks.onFlatten() }
      ]);
    });

    list.appendChild(row);
  }

  container.appendChild(list);
  container.appendChild(layerPanelFooter(layers, active, activeIdx, callbacks));
  if (typing) {
    const input = container.querySelector('.layer-filter-name');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

// PhotoCraft's filter row (layer_filter_ui.rs bar): the Kind / Name / Mode dropdown, then that
// type's controls. Every change reports the next filter through callbacks.onFilterChange.
function layerFilterRow(filter, callbacks) {
  const row = document.createElement('div');
  row.className = 'layer-filter-row';
  const change = (patch) => callbacks.onFilterChange?.({ ...filter, ...patch });

  const by = document.createElement('select');
  by.className = 'layer-filter-by';
  by.title = 'Filter by';
  by.setAttribute('aria-label', 'Filter by');
  for (const [value, label] of [
    ['kind', 'Kind'],
    ['name', 'Name'],
    ['mode', 'Mode']
  ]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    by.appendChild(opt);
  }
  by.value = filter.by;
  by.addEventListener('change', () => change({ by: by.value }));
  row.appendChild(by);

  if (filter.by === 'name') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-filter-name';
    input.placeholder = 'Search';
    input.setAttribute('aria-label', 'Filter by name');
    input.value = filter.name;
    input.addEventListener('input', () => change({ name: input.value }));
    row.appendChild(input);
  } else if (filter.by === 'mode') {
    const mode = document.createElement('select');
    mode.className = 'layer-filter-mode';
    mode.setAttribute('aria-label', 'Filter by blend mode');
    for (const { value, label } of GROUP_BLEND_MODES) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      mode.appendChild(opt);
    }
    mode.value = filter.mode;
    mode.addEventListener('change', () => change({ mode: mode.value }));
    row.appendChild(mode);
  } else {
    for (const { kind, icon, tip } of FILTER_KINDS) {
      const on = filter.kinds.includes(kind);
      const btn = document.createElement('button');
      btn.className = 'layer-filter-kind';
      btn.dataset.kind = kind;
      btn.title = tip;
      btn.setAttribute('aria-label', tip);
      btn.setAttribute('aria-pressed', String(on));
      btn.appendChild(iconSvg(icon, 14));
      btn.addEventListener('click', () =>
        change({ kinds: on ? filter.kinds.filter((k) => k !== kind) : [...filter.kinds, kind] })
      );
      row.appendChild(btn);
    }
  }
  return row;
}

function layerPanelHeader(layer, idx, callbacks) {
  const header = document.createElement('div');
  header.className = 'layer-panel-header';

  const blendEl = document.createElement('select');
  blendEl.className = 'layer-blend';
  blendEl.title = 'Blend mode';
  blendEl.setAttribute('aria-label', 'Blend mode');
  for (const { value, label } of isGroupLayer(layer) ? GROUP_BLEND_MODES : BLEND_MODES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    blendEl.appendChild(opt);
  }
  blendEl.value = layer?.blendMode || 'source-over';
  // Adjustment layers composite through their own mix; they keep Normal.
  blendEl.disabled = !layer || isAdjustmentLayer(layer);
  blendEl.addEventListener('change', () => callbacks.onBlendModeChange(idx, blendEl.value));

  const opacityLabel = document.createElement('label');
  opacityLabel.className = 'layer-opacity-wrap';
  opacityLabel.append('Opacity:');
  const opacityEl = document.createElement('input');
  opacityEl.type = 'number';
  opacityEl.min = '0';
  opacityEl.max = '100';
  opacityEl.step = '1';
  opacityEl.className = 'layer-opacity';
  opacityEl.value = String(Math.round((layer?.opacity ?? 1) * 100));
  opacityEl.setAttribute('aria-label', 'Opacity');
  opacityEl.addEventListener('change', () => {
    const v = parseInt(opacityEl.value, 10);
    if (!Number.isFinite(v)) return;
    callbacks.onOpacityChange(idx, Math.max(0, Math.min(100, v)) / 100);
  });
  opacityLabel.append(opacityEl, '%');

  header.append(blendEl, opacityLabel, layerLockRow(layer, idx, callbacks));
  return header;
}

// PhotoCraft's Lock: row (panels.rs): transparent pixels, image pixels, position, all.
const LOCK_BUTTONS = [
  ['transparency', 'grid-3x3', 'Lock transparent pixels'],
  ['pixels', 'brush', 'Lock image pixels'],
  ['position', 'move', 'Lock position'],
  ['all', 'lock', 'Lock all']
];

function layerLockRow(layer, idx, callbacks) {
  const row = document.createElement('div');
  row.className = 'layer-lock-row';
  row.append('Lock:');
  const locks = layerLocks(layer);
  for (const [key, icon, label] of LOCK_BUTTONS) {
    const btn = document.createElement('button');
    btn.className = 'layer-lock-btn';
    btn.dataset.lock = key;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(locks[key]));
    // The pixel lock covers the transparency one (Locks::set), so that button greys out.
    btn.disabled = !layer || (key === 'transparency' && locks.pixels);
    btn.appendChild(iconSvg(icon, 14));
    btn.addEventListener('click', () => callbacks.onLockChange?.(idx, key, !locks[key]));
    row.appendChild(btn);
  }
  // Fill: fades the layer's own pixels and leaves its effects (Blending Options' Fill Opacity).
  const fillLabel = document.createElement('label');
  fillLabel.className = 'layer-fill-wrap';
  fillLabel.append('Fill:');
  const fillEl = document.createElement('input');
  fillEl.type = 'number';
  fillEl.min = '0';
  fillEl.max = '100';
  fillEl.step = '1';
  fillEl.className = 'layer-fill';
  fillEl.value = String(Math.round(fillOpacityOf(layer?.styles) * 100));
  fillEl.setAttribute('aria-label', 'Fill');
  fillEl.disabled = !canHaveStyle(layer);
  fillEl.addEventListener('change', () => {
    const v = parseInt(fillEl.value, 10);
    if (!Number.isFinite(v)) return;
    callbacks.onFillChange?.(idx, Math.max(0, Math.min(100, v)) / 100);
  });
  fillLabel.append(fillEl, '%');
  row.appendChild(fillLabel);
  return row;
}

// PhotoCraft's footer, left to right: link, fx, add mask, new fill or adjustment layer, new
// group, new layer, delete.
function layerShortcut(spec) {
  const nav = globalThis.navigator;
  const mac = /Mac|iPhone|iPad/.test(`${nav?.platform || ''} ${nav?.userAgent || ''}`);
  const parts = spec.split('+');
  const key = parts.pop();
  if (!mac) return [...parts.map((m) => (m === 'Cmd' ? 'Ctrl' : m)), key].join('+');
  const sym = { Cmd: '⌘', Alt: '⌥', Shift: '⇧' };
  return (
    ['Alt', 'Shift', 'Cmd']
      .filter((m) => parts.includes(m))
      .map((m) => sym[m])
      .join('') + key
  );
}

function layerPanelFooter(layers, active, activeIdx, callbacks) {
  const footer = document.createElement('div');
  footer.className = 'layer-panel-footer';
  const button = (action, icon, label, disabled, onClick) => {
    const btn = document.createElement('button');
    btn.className = 'layer-footer-btn';
    btn.dataset.action = action;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.disabled = disabled;
    btn.appendChild(iconSvg(icon, 16));
    btn.addEventListener('click', onClick);
    footer.appendChild(btn);
    return btn;
  };

  // Links the selected layers, or unlinks the active layer's set (layer-link.js linkPlan).
  button('link', 'link-2', 'Link layers', !layers.length, () => callbacks.onLink?.());
  button('fx', 'fx', 'Add a layer style', !canHaveStyle(active), () => callbacks.onLayerStyle?.());
  const canMask = !!active && !active.mask && !isAdjustmentLayer(active) && !isGroupLayer(active);
  button('mask', 'layer-mask', 'Add a mask (from the selection; Alt inverts)', !canMask, (e) =>
    callbacks.onAddMask?.(e.altKey)
  );
  const adjBtn = button(
    'adjustment',
    'adjustment-layer',
    'Create new fill or adjustment layer',
    false,
    () => {
      const r = adjBtn.getBoundingClientRect();
      openPopupMenu(
        document.body,
        r.left,
        r.top,
        [
          // PhotoCraft lists the three fill layers first, then the adjustments.
          ...FILL_LAYER_TYPES.map((t) => ({
            label: t.label,
            run: () => callbacks.onNewFill?.(t.type)
          })),
          ...ADJUSTMENT_LAYER_IDS.map((id) => ({
            label: ADJUSTMENTS[id].label,
            run: () => callbacks.onNewAdjustment?.(id)
          }))
        ],
        true
      );
    }
  );
  adjBtn.setAttribute('aria-haspopup', 'menu');
  // Shift-click, or several layers selected, groups them (panels.rs); else a new empty group.
  button('group', 'folder', 'Create a new group', false, (e) => callbacks.onNewGroup?.(e.shiftKey));
  button('new', 'square-plus', `Create a new layer (${layerShortcut('Cmd+Shift+N')})`, false, () =>
    callbacks.onAdd()
  );
  button('delete', 'trash', 'Delete layer', layers.length <= 1, () =>
    callbacks.onDelete(activeIdx)
  );
  return footer;
}

// Swap the name for a text field; Enter or blur keeps the edit, Escape drops it.
function beginRename(nameEl, layer, idx, callbacks) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'layer-name-input';
  input.value = layer.name;
  input.setAttribute('aria-label', 'Layer name');
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const val = input.value.trim();
    input.replaceWith(nameEl);
    if (keep && val && val !== layer.name) {
      layer.name = val;
      nameEl.textContent = val;
      callbacks.onRename(idx, val);
    }
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  nameEl.replaceWith(input);
  input.focus();
  input.select();
}

function drawLayerThumb(thumbCanvas, layer) {
  const tc = thumbCanvas.getContext('2d');
  tc.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);
  // Checkerboard for transparency
  tc.fillStyle = '#888';
  for (let y = 0; y < thumbCanvas.height; y += 4) {
    for (let x = ((y / 4) % 2) * 4; x < thumbCanvas.width; x += 8) {
      tc.fillRect(x, y, 4, 4);
    }
  }
  tc.fillStyle = '#ccc';
  for (let y = 0; y < thumbCanvas.height; y += 4) {
    for (let x = ((y / 4 + 1) % 2) * 4; x < thumbCanvas.width; x += 8) {
      tc.fillRect(x, y, 4, 4);
    }
  }
  if (isAdjustmentLayer(layer)) {
    // PhotoCraft's adjustment layer glyph: a half-filled circle.
    const r = thumbCanvas.height / 2 - 3;
    const cx = thumbCanvas.width / 2,
      cy = thumbCanvas.height / 2;
    tc.fillStyle = '#fff';
    tc.beginPath();
    tc.arc(cx, cy, r, 0, Math.PI * 2);
    tc.fill();
    tc.fillStyle = '#222';
    tc.beginPath();
    tc.arc(cx, cy, r, Math.PI / 2, (Math.PI * 3) / 2);
    tc.fill();
    return;
  }
  tc.globalAlpha = layer.opacity;
  tc.drawImage(layer.canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  tc.globalAlpha = 1;
}

function drawMaskThumb(thumbCanvas, layer) {
  const tc = thumbCanvas.getContext('2d');
  const { width: w, height: h } = thumbCanvas;
  tc.clearRect(0, 0, w, h);
  if (layer.maskCanvas) tc.drawImage(layer.maskCanvas, 0, 0, w, h);
  if (layer.maskEnabled === false) {
    // PhotoCraft's red X over a disabled mask.
    tc.strokeStyle = '#e53935';
    tc.lineWidth = 2;
    tc.beginPath();
    tc.moveTo(0, 0);
    tc.lineTo(w, h);
    tc.moveTo(w, 0);
    tc.lineTo(0, h);
    tc.stroke();
  }
}

export function refreshLayerThumbs(layers, container) {
  // Rows name their layer by index; group rows and rows inside collapsed groups have no canvas.
  for (const row of container.querySelectorAll('.layer-row')) {
    const thumb = row.querySelector('canvas.layer-thumb');
    const layer = layers[Number(row.dataset.index)];
    if (thumb && layer) drawLayerThumb(thumb, layer);
  }
}
