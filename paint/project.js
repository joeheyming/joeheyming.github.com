// Project save/load — serializes the canvas state (size, layers, blend modes,
// opacity, names, color settings, placed objects) into a JSON-friendly object
// whose layer/object pixels are stored as PNG data URLs. Round-trips losslessly
// through download/upload AND through localStorage autosave (subject to quota).

import {
  createAdjustmentLayer,
  createFillLayer,
  createGroupLayer,
  createLayer,
  createSmartLayer,
  createTypeLayer,
  createShapeLayer,
  renderFillLayer,
  syncLayerMask
} from './layers.js';
import { isAdjustmentLayer } from './adjustment-layers.js';
import { cloneFill, isFillLayer } from './fill-layers.js';
import { isSmartLayer, smartFromJSON, smartToJSON } from './smart-objects.js';
import { PASS_THROUGH, layerTree } from './layer-groups.js';
import { isTypeLayer, typeFromJSON, typeToJSON } from './type-layers.js';
import { isShapeLayer, shapeFromJSON, shapeToJSON } from './shapes.js';
import { normalizeVectorMask } from './combine-shapes.js';
import { anyLock, layerLocks } from './layer-locks.js';
import { cloneStyles } from './layer-style.js';
import { decodeMask, encodeMask } from './layer-mask.js';
import { normalizeLinkId } from './layer-link.js';
import { deserializeChannels, serializeChannels } from './channels.js';
import { deserializePaths, serializePaths } from './paths.js';
import { serializeObjects, deserializeObjects } from './objects.js';
import { DEFAULT_DOC_NAME } from './doc-tab.js';
import { normalizeFileInfo } from './file-extras.js';
import { normalizeDocMode } from './image-mode.js';
import { normalizeMeasurementScale } from './measurement.js';
import { normalizeCount } from './count.js';
import { normalizeSamplers } from './samplers.js';
import { normalizeNotes } from './notes.js';
import { normalizeGuides } from './guides.js';
import { deserializeComps, serializeComps } from './layer-comps.js';

// Indexed Color's table: 1 to 256 '#rrggbb' entries, kept only for an indexed document.
function normalizeColorTable(table, mode) {
  if (normalizeDocMode(mode) !== 'indexed' || !Array.isArray(table)) return null;
  const ok = table.length > 0 && table.length <= 256;
  return ok && table.every((c) => /^#[0-9a-f]{6}$/i.test(c))
    ? table.map((c) => c.toLowerCase())
    : null;
}

const PROJECT_VERSION = 1;
const AUTOSAVE_KEY = 'paint.autosave.v1';
// localStorage caps tend to be ~5MB. Don't bother if the serialized payload
// crosses this — we'd just throw a QuotaExceededError. PNG data URLs are
// base64 (4/3 inflation) so this leaves headroom.
const AUTOSAVE_MAX_BYTES = 4 * 1024 * 1024;

export function serializeProject(state, canvasW, canvasH) {
  return {
    version: PROJECT_VERSION,
    docName: state.docName || DEFAULT_DOC_NAME,
    docMode: normalizeDocMode(state.docMode),
    colorTable: state.colorTable ?? null,
    width: canvasW,
    height: canvasH,
    bgColor: state.bgColor,
    fgColor: state.color,
    activeLayerIdx: state.activeLayerIdx,
    // The layer tree, bottom first: a group holds its layers in children (layer-groups.js).
    layers: serializeNodes(layerTree(state.layers)),
    objects: serializeObjects(state.objects),
    fileInfo: normalizeFileInfo(state.fileInfo),
    measurementScale: normalizeMeasurementScale(state.measurementScale),
    count: normalizeCount(state.count),
    samplers: normalizeSamplers(state.samplers),
    notes: normalizeNotes(state.notes),
    guides: normalizeGuides(state.guides),
    // Alpha channels from Select › Save Selection…, only when there are some.
    ...(state.channels?.length ? { channels: serializeChannels(state.channels) } : {}),
    // Pen paths (Work Path and saved paths), only when there are some.
    ...(serializePaths(state.paths) ? { paths: serializePaths(state.paths) } : {}),
    // Layer comps, only when there are some; layers are indices into the flat stack.
    ...(state.layerComps?.length
      ? { layerComps: serializeComps(state.layerComps, savedOrder(layerTree(state.layers))) }
      : {})
  };
}

// The layers in the order deserializeProject rebuilds them (flattenSaved: children, then group).
function savedOrder(nodes, out = []) {
  for (const { layer, children } of nodes) {
    if (children) savedOrder(children, out);
    out.push(layer);
  }
  return out;
}

// Clipping, locks, links, and layer styles are saved only when set, so older readers see nothing new.
function layerFlags(layer) {
  const locks = layerLocks(layer);
  return {
    ...(layer.clipped === true ? { clipped: true } : {}),
    ...(anyLock(locks) ? { locks } : {}),
    ...(normalizeLinkId(layer.linkId) ? { linkId: layer.linkId } : {}),
    ...(cloneStyles(layer.styles) ? { styles: cloneStyles(layer.styles) } : {})
  };
}

function serializeNodes(nodes) {
  return nodes.map(({ layer, children }) =>
    children
      ? {
          kind: 'group',
          name: layer.name,
          opacity: layer.opacity,
          visible: layer.visible,
          blendMode: layer.blendMode || PASS_THROUGH,
          collapsed: layer.collapsed === true,
          ...layerFlags(layer),
          children: serializeNodes(children)
        }
      : {
          name: layer.name,
          opacity: layer.opacity,
          visible: layer.visible,
          blendMode: layer.blendMode || 'source-over',
          ...(layer.background === true ? { background: true } : {}),
          ...layerFlags(layer),
          ...(isAdjustmentLayer(layer)
            ? { kind: 'adjustment', adjustmentId: layer.adjustmentId, params: { ...layer.params } }
            : isFillLayer(layer)
            ? // A fill layer saves its description; its pixels render again on load.
              { kind: 'fill', fill: cloneFill(layer.fill) }
            : isSmartLayer(layer)
            ? // A smart object saves its contents and placement; its pixels render on load.
              { kind: 'smart', smart: smartToJSON(layer.smart, encodePixels) }
            : isTypeLayer(layer)
            ? // A type layer saves its text and style; fillText draws it again on load.
              { kind: 'type', type: typeToJSON(layer.type) }
            : isShapeLayer(layer)
            ? // A shape layer saves its path, fill, and stroke; its pixels draw again on load.
              { kind: 'shape', shape: shapeToJSON(layer.shape) }
            : { dataUrl: layer.canvas.toDataURL('image/png') }),
          ...(layer.mask
            ? {
                mask: encodeMask(layer.mask),
                maskEnabled: layer.maskEnabled !== false,
                maskDensity: layer.maskDensity ?? 1,
                maskFeather: layer.maskFeather ?? 0
              }
            : {}),
          ...(layer.vectorMask ? { vectorMask: normalizeVectorMask(layer.vectorMask) } : {})
        }
  );
}

// Smart object pixels ({ width, height, data }) as PNG data URLs and back.
function encodePixels({ width, height, data }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

async function decodePixels(url) {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { width, height, data } = ctx.getImageData(0, 0, img.width, img.height);
  return { width, height, data };
}

// The saved tree in the stack's flat order (a group's children, then the group), each entry
// pointing at its group's entry. Older files are one flat list with no groups.
function flattenSaved(nodes, parent = null, out = []) {
  for (const node of nodes ?? []) {
    const entry = { node, parent };
    if (node?.kind === 'group') flattenSaved(node.children, entry, out);
    out.push(entry);
  }
  return out;
}

// Restore a serialized project into the live state.
// `apply` is a callback the caller provides to swap in the new layers and
// rewire DOM/UI. Signature: apply({ docName, width, height, layers, bgColor, fgColor, activeLayerIdx, objects, fileInfo, docMode, colorTable, measurementScale, count, samplers, notes, guides, channels, paths, layerComps })
export async function deserializeProject(data, apply) {
  if (!data || data.version !== PROJECT_VERSION) {
    throw new Error('Unknown project version: ' + data?.version);
  }
  const { width, height, layers, bgColor, fgColor, activeLayerIdx } = data;
  const entries = flattenSaved(layers);
  const built = await Promise.all(
    entries.map(async ({ node: l }, i) => {
      const name = l.name || `Layer ${i + 1}`;
      const group = l.kind === 'group';
      const smart = l.kind === 'smart' ? await smartFromJSON(l.smart, decodePixels) : null;
      // Older files have no type layers; a 'type' entry without text opens as a pixel layer.
      const type = l.kind === 'type' ? typeFromJSON(l.type) : null;
      // Older files have no shape layers; a 'shape' entry without a path opens as a pixel layer.
      const shape = l.kind === 'shape' ? shapeFromJSON(l.shape) : null;
      const layer =
        l.kind === 'adjustment'
          ? createAdjustmentLayer(name, l.adjustmentId, l.params || {}, width, height)
          : l.kind === 'fill' && cloneFill(l.fill)
          ? createFillLayer(name, l.fill, width, height)
          : smart
          ? createSmartLayer(name, smart, width, height)
          : type
          ? createTypeLayer(name, type, width, height)
          : shape
          ? createShapeLayer(name, shape, width, height)
          : group
          ? createGroupLayer(name, width, height)
          : createLayer(name, width, height);
      layer.opacity = typeof l.opacity === 'number' ? l.opacity : 1;
      layer.visible = l.visible !== false;
      layer.blendMode = l.blendMode || (group ? PASS_THROUGH : 'source-over');
      if (group) layer.collapsed = l.collapsed === true;
      // Older files have no clipping or locks.
      layer.clipped = l.clipped === true;
      layer.locks = layerLocks(l);
      // Older files have no linked layers.
      const linkId = normalizeLinkId(l.linkId);
      if (linkId) layer.linkId = linkId;
      // Older files have no layer styles.
      layer.styles = group ? null : cloneStyles(l.styles);
      // Older files have no Background: every layer opens as a normal layer.
      layer.background = i === 0 && l.background === true && (l.kind ?? 'pixel') === 'pixel';
      if (l.dataUrl) {
        const img = await loadImage(l.dataUrl);
        layer.ctx.drawImage(img, 0, 0);
      }
      if (l.mask) {
        layer.mask = decodeMask(l.mask, width * height);
        layer.maskEnabled = l.maskEnabled !== false;
        // Files from before Properties › Density / Feather load at 100% and 0 px.
        layer.maskDensity = Number.isFinite(l.maskDensity) ? l.maskDensity : 1;
        layer.maskFeather = Number.isFinite(l.maskFeather) ? l.maskFeather : 0;
        syncLayerMask(layer);
        // A fill made from a selection lays out in its mask's bounds.
        renderFillLayer(layer);
      }
      // Older files have no vector masks.
      layer.vectorMask = normalizeVectorMask(l.vectorMask);
      if (layer.vectorMask) syncLayerMask(layer);
      return layer;
    })
  );
  entries.forEach(({ parent }, i) => {
    built[i].parentId = parent ? built[entries.indexOf(parent)].id : null;
  });
  const objects = await deserializeObjects(data.objects || []);
  apply({
    docName: typeof data.docName === 'string' && data.docName ? data.docName : DEFAULT_DOC_NAME,
    width,
    height,
    bgColor: bgColor || '#ffffff',
    fgColor: fgColor || '#000000',
    activeLayerIdx: typeof activeLayerIdx === 'number' ? activeLayerIdx : 0,
    layers: built,
    objects,
    fileInfo: normalizeFileInfo(data.fileInfo),
    docMode: normalizeDocMode(data.docMode),
    colorTable: normalizeColorTable(data.colorTable, data.docMode),
    measurementScale: normalizeMeasurementScale(data.measurementScale),
    count: normalizeCount(data.count),
    samplers: normalizeSamplers(data.samplers),
    notes: normalizeNotes(data.notes),
    guides: normalizeGuides(data.guides),
    channels: deserializeChannels(data.channels, width * height),
    paths: deserializePaths(data.paths),
    // Older files have no layer comps.
    layerComps: deserializeComps(data.layerComps, built)
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ── File download / upload ───────────────────────────────────────────────────

export function downloadProject(data, filename = 'paint.paintproj') {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function readProjectFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

// ── Autosave (localStorage) ──────────────────────────────────────────────────

let autosaveTimer = null;

export function scheduleAutosave(state, canvasW, canvasH, delayMs = 800) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => doAutosave(state, canvasW, canvasH), delayMs);
}

function doAutosave(state, canvasW, canvasH) {
  try {
    const data = serializeProject(state, canvasW, canvasH);
    const json = JSON.stringify({ savedAt: Date.now(), data });
    if (json.length > AUTOSAVE_MAX_BYTES) {
      // Too big to fit — drop any prior autosave so we don't restore a stale one.
      try {
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    localStorage.setItem(AUTOSAVE_KEY, json);
  } catch (e) {
    // Quota exceeded or storage disabled — fail silently.
  }
}

export function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed; // { savedAt, data }
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}
