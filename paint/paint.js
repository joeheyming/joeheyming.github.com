import {
  TOOLS,
  TOOL_OPTION_SCHEMA,
  floodSelect,
  floodSelectInk,
  scanlineFill,
  defaultToolOptions
} from './tools.js';
import {
  buildToolbar,
  buildPalette,
  updateFgSwatch,
  updateColorHistory,
  renderToolOptions,
  updateStatus
} from './ui.js';
import {
  createLayer,
  insertLayerBefore,
  removeLayerFromDOM,
  syncLayerDOM,
  flattenToCanvas,
  renderLayerPanel
} from './layers.js';
import { renderHistoryPanel as buildHistoryPanel } from './history.js';
import {
  deserializeProject,
  readProjectFile,
  scheduleAutosave,
  readAutosave,
  clearAutosave
} from './project.js';
import {
  startSelectionAnimation,
  commitSelection as doCommitSelection,
  copySelection as doCopySelection,
  pasteClipboard as doPasteClipboard,
  deleteSelection as doDeleteSelection,
  applySelectionWithMask as doApplySelectionWithMask,
  selectAll as doSelectAll,
  invertSelection as doInvertSelection,
  selectionModeFor,
  imageDataToPngBlob,
  writePngBlobToClipboard,
  activatePlacedSelection as doActivatePlacedSelection,
  drawSelectionOverlay,
  tryBeginMove,
  constrainLine,
  constrainSquare,
  hexToRgb,
  flipSelection as doFlipSelection
} from './selection.js';
import {
  openAdjust as doOpenAdjust,
  cancelAdjust,
  commitAdjust,
  buildAdjustMenu as doBuildAdjustMenu,
  toggleAdjustMenu,
  closeAdjustMenu
} from './adjust-modal.js';
import { installOSBridge } from './os-bridge.js';
import {
  toggleFileMenu,
  closeFileMenu,
  openFilenameModal,
  confirmFilenameModal,
  closeFilenameModal,
  openResizeModal as openResizeModalUI,
  closeResizeModal,
  confirmResize as confirmResizeUI,
  downloadPNG,
  downloadJPEG,
  downloadProjectFile,
  exportPNGBlob
} from './file-menu.js';
import { createPointerController } from './pointer.js';
import {
  cloneObjects,
  createTextObject,
  createImageObjectFromImage,
  createImageObjectFromImageData,
  hitTestObject,
  hitTestHandle,
  handleCursor,
  findObject,
  updateTextObject,
  moveObject,
  resizeObjectFromHandle,
  renderObjects,
  objectsBounds,
  objectsIntersectingRect
} from './objects.js';

const MAX_UNDO = 50;

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  tool: 'select',
  color: '#000000',
  bgColor: '#ffffff',
  activeColor: '#000000',
  brushSize: 4,
  shapeFill: false,
  toolOptions: defaultToolOptions(),
  drawing: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,

  // Layers
  layers: [],
  activeLayerIdx: 0,

  // Zoom + pan
  zoom: 1,
  panX: 0,
  panY: 0,
  panning: false,
  panStartClientX: 0,
  panStartClientY: 0,
  panStartX: 0,
  panStartY: 0,
  spaceDown: false,

  // Pointer
  pressure: 1,

  // Selection
  sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0, data: null, mask: null, baseData: null },
  selStartMoveX: 0,
  selStartMoveY: 0,
  selOrigX: 0,
  selOrigY: 0,
  lassoPath: [],

  // Clipboard
  clipboard: null,

  // Google Drawings-style placed objects (text / images)
  objects: [],
  /** @type {number[]} */
  selectedObjectIds: [],
  /** Primary / last-selected id (kept in sync with selectedObjectIds). */
  selectedObjectId: null,
  objectDrag: null,

  // Color history
  colorHistory: [],

  // Spray internals
  sprayTimer: null,
  sprayX: 0,
  sprayY: 0,

  // Undo
  undoStack: [],
  redoStack: [],

  // Callbacks (set up after DOM ready)
  onColorChange: null,
  onBgColorChange: null,
  showTextInput: null,
  commitSelection: null,
  doMagicWand: null,
  scanlineFill: null
};

// ── Canvas / layer helpers ───────────────────────────────────────────────────

const overlayCanvas = document.getElementById('overlay-canvas');
const ov = overlayCanvas.getContext('2d', { willReadFrequently: true });
const objectsCanvas = document.getElementById('objects-canvas');
const stackEl = document.getElementById('canvas-stack');

/** Ref element for inserting layer canvases (below objects + overlay). */
function layerInsertRef() {
  return objectsCanvas || overlayCanvas;
}

function redrawObjects() {
  if (!objectsCanvas) return;
  renderObjects(objectsCanvas, state.objects, state.selectedObjectIds, state.zoom);
}

function canvasW() {
  return state.layers[0]?.canvas.width ?? 800;
}
function canvasH() {
  return state.layers[0]?.canvas.height ?? 600;
}
function activeLayer() {
  return state.layers[state.activeLayerIdx];
}
function activeCtx() {
  return activeLayer().ctx;
}

function defaultCanvasSize(area) {
  const rect = area.getBoundingClientRect();
  // Prefer the available area; only fall back to 400×300 when layout
  // hasn't measured yet (rect can be 0 during early init).
  const W = Math.floor(rect.width) > 0 ? Math.floor(rect.width) : 400;
  const H = Math.floor(rect.height) > 0 ? Math.floor(rect.height) : 300;
  return { W, H };
}

function initCanvas() {
  const area = document.getElementById('canvas-area');
  const { W, H } = defaultCanvasSize(area);

  const layer0 = createLayer('Layer 1', W, H);
  layer0.ctx.fillStyle = state.bgColor;
  layer0.ctx.fillRect(0, 0, W, H);
  state.layers.push(layer0);
  insertLayerBefore(layer0, stackEl, layerInsertRef());

  if (objectsCanvas) {
    objectsCanvas.width = W;
    objectsCanvas.height = H;
  }
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  stackEl.style.width = W + 'px';
  stackEl.style.height = H + 'px';
  redrawObjects();
}

function resizeStack(W, H) {
  for (const layer of state.layers) {
    const old = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    layer.canvas.width = W;
    layer.canvas.height = H;
    if (layer === state.layers[0]) {
      layer.ctx.fillStyle = state.bgColor;
      layer.ctx.fillRect(0, 0, W, H);
    }
    layer.ctx.putImageData(old, 0, 0);
  }
  if (objectsCanvas) {
    objectsCanvas.width = W;
    objectsCanvas.height = H;
  }
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  stackEl.style.width = W + 'px';
  stackEl.style.height = H + 'px';
  redrawObjects();
}

// ── Undo/Redo ────────────────────────────────────────────────────────────────

function pushUndo(label = 'Draw') {
  const layer = activeLayer();
  const snap = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  state.undoStack.push({
    layerId: layer.id,
    data: snap,
    label,
    objects: cloneObjects(state.objects),
    selectedObjectIds: state.selectedObjectIds.slice(),
    selectedObjectId: state.selectedObjectId
  });
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
  updateUndoButtons();
  renderHistoryPanel();
  scheduleAutosave(state, canvasW(), canvasH());
}

function undo() {
  if (!state.undoStack.length) return;
  const entry = state.undoStack.pop();
  const target = state.layers.find((l) => l.id === entry.layerId);
  if (!target) {
    updateUndoButtons();
    return;
  }
  state.redoStack.push({
    layerId: entry.layerId,
    label: entry.label,
    data: target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height),
    objects: cloneObjects(state.objects),
    selectedObjectIds: state.selectedObjectIds.slice(),
    selectedObjectId: state.selectedObjectId
  });
  target.ctx.putImageData(entry.data, 0, 0);
  if (entry.objects) {
    state.objects = entry.objects;
    setObjectSelection(
      entry.selectedObjectIds || (entry.selectedObjectId != null ? [entry.selectedObjectId] : [])
    );
    redrawObjects();
  }
  updateUndoButtons();
  refreshLayerPanelUI();
  renderHistoryPanel();
}

function redo() {
  if (!state.redoStack.length) return;
  const entry = state.redoStack.pop();
  const target = state.layers.find((l) => l.id === entry.layerId);
  if (!target) {
    updateUndoButtons();
    return;
  }
  state.undoStack.push({
    layerId: entry.layerId,
    label: entry.label,
    data: target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height),
    objects: cloneObjects(state.objects),
    selectedObjectIds: state.selectedObjectIds.slice(),
    selectedObjectId: state.selectedObjectId
  });
  target.ctx.putImageData(entry.data, 0, 0);
  if (entry.objects) {
    state.objects = entry.objects;
    setObjectSelection(
      entry.selectedObjectIds || (entry.selectedObjectId != null ? [entry.selectedObjectId] : [])
    );
    redrawObjects();
  }
  updateUndoButtons();
  refreshLayerPanelUI();
  renderHistoryPanel();
}

function updateUndoButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = state.undoStack.length === 0;
  if (r) r.disabled = state.redoStack.length === 0;
}

/** Right-button cancel of an in-progress stroke (JS Paint). Undoable via Redo. */
function cancelInProgressStroke() {
  const strokeTools = new Set(['pencil', 'brush', 'eraser', 'line', 'rect', 'ellipse', 'spray']);
  if (!state.drawing || !strokeTools.has(state.tool)) return false;
  if (state.sprayTimer) {
    clearInterval(state.sprayTimer);
    state.sprayTimer = null;
  }
  state.drawing = false;
  state.strokeButton = null;
  state.stabX = null;
  state.stabY = null;
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  const ctx = activeCtx();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // Freehand tools push undo on down — undo restores pre-stroke and parks
  // the partial stroke on the redo stack (so cancel is redoable).
  const pushedOnDown = new Set(['pencil', 'brush', 'eraser', 'spray']);
  if (pushedOnDown.has(state.tool) && state.undoStack.length) {
    undo();
  }
  return true;
}

// ── History panel ────────────────────────────────────────────────────────────

function jumpHistoryUndo(steps) {
  for (let i = 0; i < steps; i++) {
    if (!state.undoStack.length) break;
    const entry = state.undoStack.pop();
    const target = state.layers.find((l) => l.id === entry.layerId);
    if (target) {
      state.redoStack.push({
        layerId: entry.layerId,
        label: entry.label,
        data: target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height)
      });
      target.ctx.putImageData(entry.data, 0, 0);
    }
  }
  updateUndoButtons();
  refreshLayerPanelUI();
  renderHistoryPanel();
}

function jumpHistoryRedo(steps) {
  for (let i = 0; i < steps; i++) {
    if (!state.redoStack.length) break;
    const entry = state.redoStack.pop();
    const target = state.layers.find((l) => l.id === entry.layerId);
    if (target) {
      state.undoStack.push({
        layerId: entry.layerId,
        label: entry.label,
        data: target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height)
      });
      target.ctx.putImageData(entry.data, 0, 0);
    }
  }
  updateUndoButtons();
  refreshLayerPanelUI();
  renderHistoryPanel();
}

function renderHistoryPanel() {
  const container = document.getElementById('history-list-container');
  if (!container) return;
  buildHistoryPanel(container, state.undoStack, state.redoStack, jumpHistoryUndo, jumpHistoryRedo);
}

// ── Zoom / Pan ───────────────────────────────────────────────────────────────

function updateTransform() {
  stackEl.style.transform = `translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`;
  const zoomEl = document.getElementById('zoom-display');
  if (zoomEl) zoomEl.textContent = Math.round(state.zoom * 100) + '%';
}

function zoomToward(clientX, clientY, factor) {
  const area = document.getElementById('canvas-area');
  const rect = area.getBoundingClientRect();
  const mx = clientX - rect.left,
    my = clientY - rect.top;
  const prev = state.zoom;
  state.zoom = Math.max(0.1, Math.min(16, prev * factor));
  state.panX = mx - (mx - state.panX) * (state.zoom / prev);
  state.panY = my - (my - state.panY) * (state.zoom / prev);
  updateTransform();
}

// ── Selection helpers ────────────────────────────────────────────────────────
// The actual implementations live in `./selection.js`. The wrappers below
// inject the shared `state`, the overlay context `ov`, and a couple of
// closures so the rest of paint.js can keep its no-arg call sites unchanged.

function commitSelection() {
  doCommitSelection(state, ov, activeCtx());
}
async function copySelection(ctx, cut) {
  const copied = doCopySelection(state, ov, ctx, cut, pushUndo);
  if (copied && state.clipboard?.data) {
    const blob = await imageDataToPngBlob(state.clipboard.data);
    await writePngBlobToClipboard(blob);
    return;
  }
  if (!cut) {
    // No selection — copy the full flattened document to the OS clipboard
    const blob = await exportPNGBlob(state, canvasW(), canvasH());
    await writePngBlobToClipboard(blob);
  }
}
/** Visible viewport center in canvas pixel coords (accounts for pan/zoom). */
function viewportPasteOrigin(pasteW, pasteH) {
  const area = document.getElementById('canvas-area');
  if (!area) return { x: 0, y: 0 };
  const rect = area.getBoundingClientRect();
  // Center of visible area in canvas coords
  const cx = (rect.width / 2 - state.panX) / state.zoom;
  const cy = (rect.height / 2 - state.panY) / state.zoom;
  return {
    x: Math.round(cx - pasteW / 2),
    y: Math.round(cy - pasteH / 2)
  };
}
function pasteClipboard(ctx) {
  const clip = state.clipboard;
  if (!clip) return;
  // Prefer Drawings-style image object for pasted bitmaps
  if (clip.data && !clip.localMask) {
    pushUndo('Paste');
    commitSelection();
    const origin = viewportPasteOrigin(clip.w, clip.h);
    const obj = createImageObjectFromImageData(clip.data, origin.x, origin.y);
    state.objects.push(obj);
    setObjectSelection([obj.id]);
    redrawObjects();
    setActiveTool('select');
    return;
  }
  const origin = viewportPasteOrigin(clip.w, clip.h);
  if (!doPasteClipboard(state, ctx, pushUndo, origin.x, origin.y)) return;
  selectPlacedContent();
}
async function pasteImageFile(file) {
  try {
    pushUndo('Paste');
    commitSelection();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const origin = viewportPasteOrigin(
        img.naturalWidth || img.width,
        img.naturalHeight || img.height
      );
      const obj = createImageObjectFromImage(img, origin.x, origin.y);
      state.objects.push(obj);
      setObjectSelection([obj.id]);
      URL.revokeObjectURL(url);
      redrawObjects();
      setActiveTool('select');
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  } catch (err) {
    console.warn('Could not paste image', err);
  }
}
/** After raster placement, switch to object Select when possible. */
function selectPlacedContent() {
  setActiveTool('select');
  drawSelectionOverlay(state, ov);
}

// ── Object select (Google Drawings-style, multi-select) ───────────────────────

function setObjectSelection(ids) {
  const unique = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (id == null || seen.has(id)) continue;
    if (!findObject(state.objects, id)) continue;
    seen.add(id);
    unique.push(id);
  }
  state.selectedObjectIds = unique;
  state.selectedObjectId = unique.length ? unique[unique.length - 1] : null;
}

function deselectObject() {
  setObjectSelection([]);
  state.objectDrag = null;
  ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  redrawObjects();
}

function beginObjectSelect(x, y) {
  commitSelection();
  const additive = !!state.shiftKey;

  // Resize handles only when a single object is selected
  if (state.selectedObjectIds.length === 1) {
    const selected = findObject(state.objects, state.selectedObjectId);
    const handle = selected ? hitTestHandle(selected, x, y, state.zoom) : null;
    if (handle && selected) {
      state.objectDrag = {
        id: selected.id,
        mode: 'resize',
        handle,
        startX: x,
        startY: y,
        start: {
          x: selected.x,
          y: selected.y,
          w: selected.w,
          h: selected.h,
          fontSize: selected.fontSize,
          canvasX: selected.canvasX,
          canvasY: selected.canvasY,
          fontSpec: selected.fontSpec
        },
        moved: false
      };
      state.drawing = true;
      overlayCanvas.style.cursor = handleCursor(handle);
      redrawObjects();
      return;
    }
  }

  const hit = hitTestObject(state.objects, x, y);
  if (!hit) {
    // Empty space — start marquee (click without drag may lift ink / clear)
    state.objectDrag = {
      mode: 'marquee',
      startX: x,
      startY: y,
      x,
      y,
      additive,
      moved: false
    };
    state.drawing = true;
    if (!additive) {
      setObjectSelection([]);
      redrawObjects();
    }
    return;
  }

  // Double-click text → re-edit (only when already the sole selection)
  const now = performance.now();
  if (
    hit.type === 'text' &&
    state.selectedObjectIds.length === 1 &&
    state.selectedObjectId === hit.id &&
    state._lastObjectClickId === hit.id &&
    now - (state._lastObjectClickAt || 0) < 400
  ) {
    state._lastObjectClickAt = 0;
    openTextObjectEditor(hit);
    return;
  }
  state._lastObjectClickId = hit.id;
  state._lastObjectClickAt = now;

  if (additive) {
    if (state.selectedObjectIds.includes(hit.id)) {
      setObjectSelection(state.selectedObjectIds.filter((id) => id !== hit.id));
      state.objectDrag = null;
      state.drawing = false;
      redrawObjects();
      return;
    }
    setObjectSelection([...state.selectedObjectIds, hit.id]);
  } else if (!state.selectedObjectIds.includes(hit.id)) {
    setObjectSelection([hit.id]);
  }
  // Clicking an already-selected object without Shift keeps the multi-selection

  const moveIds = state.selectedObjectIds.includes(hit.id)
    ? state.selectedObjectIds.slice()
    : [hit.id];
  state.objectDrag = {
    mode: 'move',
    ids: moveIds,
    startX: x,
    startY: y,
    origins: moveIds.map((id) => {
      const o = findObject(state.objects, id);
      return { id, x: o.x, y: o.y };
    }),
    moved: false
  };
  state.drawing = true;
  redrawObjects();
}

/**
 * Lift connected non-background pixels under (x,y) into a movable image object.
 * @returns {import('./objects.js').ImageObject | null}
 */
function liftDrawingAt(x, y) {
  const ctx = activeCtx();
  const result = floodSelectInk(ctx, x, y, state.bgColor, 28);
  if (!result || result.w < 1 || result.h < 1) return null;
  // Ignore near-full-canvas accidental selects (clicked a near-bg shade)
  if (result.w * result.h > canvasW() * canvasH() * 0.85) return null;

  pushUndo('Select Drawing');
  const { mask, x: bx, y: by, w, h } = result;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const raw = ctx.getImageData(bx, by, w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (!mask[(by + row) * W + (bx + col)]) {
        raw.data[(row * w + col) * 4 + 3] = 0;
      }
    }
  }

  // Punch the lifted pixels out of the layer
  const full = ctx.getImageData(0, 0, W, H);
  const isBase = state.activeLayerIdx === 0;
  const [br, bg, bb] = hexToRgb(state.bgColor);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const mi = (by + row) * W + (bx + col);
      if (!mask[mi]) continue;
      const pos = mi * 4;
      if (isBase) {
        full.data[pos] = br;
        full.data[pos + 1] = bg;
        full.data[pos + 2] = bb;
        full.data[pos + 3] = 255;
      } else {
        full.data[pos] = 0;
        full.data[pos + 1] = 0;
        full.data[pos + 2] = 0;
        full.data[pos + 3] = 0;
      }
    }
  }
  ctx.putImageData(full, 0, 0);

  const obj = createImageObjectFromImageData(raw, bx, by);
  state.objects.push(obj);
  setObjectSelection([obj.id]);
  redrawObjects();
  refreshLayerPanelUI();
  return obj;
}

function dragObjectSelect(x, y) {
  const drag = state.objectDrag;
  if (!drag) return;

  if (drag.mode === 'marquee') {
    drag.x = x;
    drag.y = y;
    if (Math.abs(x - drag.startX) > 2 || Math.abs(y - drag.startY) > 2) drag.moved = true;
    ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const left = Math.min(drag.startX, x);
    const top = Math.min(drag.startY, y);
    const w = Math.abs(x - drag.startX);
    const h = Math.abs(y - drag.startY);
    ov.save();
    ov.strokeStyle = '#1a73e8';
    ov.fillStyle = 'rgba(26, 115, 232, 0.12)';
    ov.lineWidth = 1;
    ov.setLineDash([4, 3]);
    ov.fillRect(left, top, w, h);
    ov.strokeRect(left + 0.5, top + 0.5, w, h);
    ov.restore();
    updateStatus(x, y, w >= 1 && h >= 1 ? { w, h } : null);
    return;
  }

  if (drag.mode === 'resize') {
    const obj = findObject(state.objects, drag.id);
    if (!obj) return;
    if (!drag.moved) {
      pushUndo('Resize Object');
      drag.moved = true;
    }
    // Google Drawings: Shift locks aspect ratio. Also accept Ctrl/Cmd.
    const lockAspect = !!(state.shiftKey || state.ctrlKey);
    resizeObjectFromHandle(obj, drag.handle, x, y, drag.start, lockAspect);
    redrawObjects();
    updateStatus(x, y, { w: obj.w, h: obj.h });
    return;
  }

  // Group move
  const dx = x - drag.startX;
  const dy = y - drag.startY;
  if (!drag.moved && (Math.round(dx) !== 0 || Math.round(dy) !== 0)) {
    pushUndo(drag.ids.length > 1 ? 'Move Objects' : 'Move Object');
    drag.moved = true;
  }
  for (const orig of drag.origins) {
    const obj = findObject(state.objects, orig.id);
    if (!obj) continue;
    moveObject(obj, Math.round(orig.x + dx), Math.round(orig.y + dy));
  }
  redrawObjects();
  const moved = drag.ids.map((id) => findObject(state.objects, id)).filter(Boolean);
  const bounds = objectsBounds(moved);
  if (bounds) updateStatus(x, y, { w: bounds.w, h: bounds.h });
}

function endObjectSelect(x, y) {
  const drag = state.objectDrag;
  if (drag?.mode === 'marquee') {
    ov.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (drag.moved) {
      const hits = objectsIntersectingRect(state.objects, drag.startX, drag.startY, drag.x, drag.y);
      const hitIds = hits.map((o) => o.id);
      if (drag.additive) {
        const merged = new Set(state.selectedObjectIds);
        for (const id of hitIds) merged.add(id);
        setObjectSelection([...merged]);
      } else {
        setObjectSelection(hitIds);
      }
      redrawObjects();
    } else if (!drag.additive) {
      // Click empty — try lifting ink, else stay deselected
      const lifted = liftDrawingAt(x ?? drag.startX, y ?? drag.startY);
      if (lifted) {
        state.objectDrag = null;
        state.drawing = false;
        return;
      }
      setObjectSelection([]);
      redrawObjects();
    }
  }
  state.objectDrag = null;
  state.drawing = false;
}

function deleteSelectedObject() {
  if (!state.selectedObjectIds.length) return false;
  pushUndo(state.selectedObjectIds.length > 1 ? 'Delete Objects' : 'Delete Object');
  const remove = new Set(state.selectedObjectIds);
  state.objects = state.objects.filter((o) => !remove.has(o.id));
  setObjectSelection([]);
  redrawObjects();
  return true;
}

function openTextObjectEditor(obj) {
  // Remove from canvas temporarily while editing (hide by not rendering selected...
  // keep in list but show textarea over it)
  const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('text-input'));
  if (!input) return;
  const area = document.getElementById('canvas-area');
  const areaRect = area.getBoundingClientRect();
  const stackRect = overlayCanvas.getBoundingClientRect();
  const screenX = stackRect.left - areaRect.left + obj.canvasX * state.zoom;
  const screenY = stackRect.top - areaRect.top + obj.canvasY * state.zoom;
  input.style.left = screenX + 'px';
  input.style.top = screenY + 'px';
  input.style.fontFamily = obj.family || 'sans-serif';
  input.style.fontSize = obj.fontSize * state.zoom + 'px';
  input.style.fontWeight = obj.bold ? 'bold' : 'normal';
  input.style.fontStyle = obj.italic ? 'italic' : 'normal';
  input.style.color = obj.color;
  input.value = obj.text;
  input.style.display = 'block';
  input.dataset.editingObjectId = String(obj.id);
  input.dataset.canvasX = String(obj.canvasX);
  input.dataset.canvasY = String(obj.canvasY);
  input.dataset.layerId = '';
  input.dataset.fontSpec = obj.fontSpec;
  input.dataset.fontSize = String(obj.fontSize);
  // Hide the object while editing so we don't see double text
  obj._hiddenWhileEdit = true;
  redrawObjects();
  input.focus();
  input.select();
}

function placeTextObject(partial) {
  pushUndo('Text');
  const obj = createTextObject(partial);
  state.objects.push(obj);
  setObjectSelection([obj.id]);
  redrawObjects();
  setActiveTool('select');
}

function commitTextObjectEdit(objectId, text, style) {
  const obj = findObject(state.objects, objectId);
  if (!obj || obj.type !== 'text') return;
  pushUndo('Edit Text');
  if (!text) {
    state.objects = state.objects.filter((o) => o.id !== objectId);
    setObjectSelection([]);
  } else {
    updateTextObject(obj, text, style);
    obj._hiddenWhileEdit = false;
    setObjectSelection([obj.id]);
  }
  redrawObjects();
  setActiveTool('select');
}
function deleteSelection(ctx) {
  doDeleteSelection(state, ov, ctx, pushUndo);
}
function applySelectionWithMask(newMask, W, H, mode) {
  doApplySelectionWithMask(state, newMask, W, H, mode);
}
function selectAll() {
  doSelectAll(state, ov, canvasW(), canvasH());
}
function invertSelection() {
  doInvertSelection(state, ov, canvasW(), canvasH());
}

// ── Layer panel ───────────────────────────────────────────────────────────────

function refreshLayerPanelUI() {
  const container = document.getElementById('layer-list-container');
  if (!container) return;
  renderLayerPanel(state.layers, state.activeLayerIdx, container, {
    onAdd: addLayer,
    onDelete: deleteLayer,
    onActivate: setActiveLayer,
    onToggleVisible: toggleLayerVisible,
    onOpacityChange: setLayerOpacity,
    onBlendModeChange: setLayerBlendMode,
    onMoveUp: moveLayerUp,
    onMoveDown: moveLayerDown,
    onRename: () => refreshLayerPanelUI(),
    onFlatten: flattenLayers
  });
}

function addLayer() {
  const w = canvasW(),
    h = canvasH();
  const name = `Layer ${state.layers.length + 1}`;
  const layer = createLayer(name, w, h);
  state.layers.push(layer);
  // Insert before overlay (last layer canvas is on top, above earlier ones)
  insertLayerBefore(layer, stackEl, layerInsertRef());
  state.activeLayerIdx = state.layers.length - 1;
  refreshLayerPanelUI();
}

function deleteLayer(idx) {
  if (state.layers.length <= 1) return;
  removeLayerFromDOM(state.layers[idx]);
  state.layers.splice(idx, 1);
  state.activeLayerIdx = Math.min(state.activeLayerIdx, state.layers.length - 1);
  refreshLayerPanelUI();
}

function setActiveLayer(idx) {
  state.activeLayerIdx = idx;
  refreshLayerPanelUI();
}

function toggleLayerVisible(idx) {
  state.layers[idx].visible = !state.layers[idx].visible;
  syncLayerDOM(state.layers[idx]);
  refreshLayerPanelUI();
}

function setLayerOpacity(idx, opacity) {
  state.layers[idx].opacity = opacity;
  syncLayerDOM(state.layers[idx]);
  refreshLayerPanelUI();
}

function setLayerBlendMode(idx, blendMode) {
  state.layers[idx].blendMode = blendMode;
  syncLayerDOM(state.layers[idx]);
  refreshLayerPanelUI();
}

function moveLayerUp(idx) {
  if (idx >= state.layers.length - 1) return;
  [state.layers[idx], state.layers[idx + 1]] = [state.layers[idx + 1], state.layers[idx]];
  // Re-order DOM: insert the higher layer after the lower one
  const refEl = state.layers[idx].canvas.nextSibling;
  stackEl.insertBefore(state.layers[idx + 1].canvas, refEl);
  if (state.activeLayerIdx === idx) state.activeLayerIdx = idx + 1;
  else if (state.activeLayerIdx === idx + 1) state.activeLayerIdx = idx;
  refreshLayerPanelUI();
}

function moveLayerDown(idx) {
  if (idx <= 0) return;
  [state.layers[idx], state.layers[idx - 1]] = [state.layers[idx - 1], state.layers[idx]];
  stackEl.insertBefore(state.layers[idx - 1].canvas, state.layers[idx].canvas);
  if (state.activeLayerIdx === idx) state.activeLayerIdx = idx - 1;
  else if (state.activeLayerIdx === idx - 1) state.activeLayerIdx = idx;
  refreshLayerPanelUI();
}

function flattenLayers() {
  pushUndo('Flatten');
  const w = canvasW(),
    h = canvasH();
  const flat = flattenToCanvas(state.layers, state.bgColor, w, h);
  // Remove all layers except the first
  for (let i = state.layers.length - 1; i >= 1; i--) {
    removeLayerFromDOM(state.layers[i]);
  }
  state.layers.length = 1;
  state.layers[0].ctx.clearRect(0, 0, w, h);
  state.layers[0].ctx.drawImage(flat, 0, 0);
  state.activeLayerIdx = 0;
  refreshLayerPanelUI();
}

/** Crop canvas to the active selection bounding box (all layers + objects). */
function cropToSelection() {
  const sel = state.sel;
  if (sel.mode !== 'active' || sel.w < 1 || sel.h < 1) return;
  const sx = Math.max(0, Math.round(sel.x));
  const sy = Math.max(0, Math.round(sel.y));
  const sw = Math.min(Math.round(sel.w), canvasW() - sx);
  const sh = Math.min(Math.round(sel.h), canvasH() - sy);
  if (sw < 1 || sh < 1) return;
  // Stamp any floating content before cropping
  commitSelection();
  pushUndo('Crop');
  for (const layer of state.layers) {
    const cropped = layer.ctx.getImageData(sx, sy, sw, sh);
    layer.canvas.width = sw;
    layer.canvas.height = sh;
    layer.ctx.putImageData(cropped, 0, 0);
  }
  // Shift objects into the cropped frame; drop those fully outside
  const kept = [];
  for (const o of state.objects) {
    const nx = o.x - sx;
    const ny = o.y - sy;
    if (nx + o.w <= 0 || ny + o.h <= 0 || nx >= sw || ny >= sh) continue;
    o.x = nx;
    o.y = ny;
    if (o.type === 'text') {
      o.canvasX = (o.canvasX ?? o.x + sx) - sx;
      o.canvasY = (o.canvasY ?? o.y + sy) - sy;
    }
    kept.push(o);
  }
  state.objects = kept;
  setObjectSelection([]);
  overlayCanvas.width = sw;
  overlayCanvas.height = sh;
  if (objectsCanvas) {
    objectsCanvas.width = sw;
    objectsCanvas.height = sh;
  }
  stackEl.style.width = sw + 'px';
  stackEl.style.height = sh + 'px';
  // Clear selection — it no longer maps to the new canvas
  state.sel.mode = 'none';
  state.sel.data = null;
  state.sel.mask = null;
  state.sel.baseData = null;
  scheduleAutosave(state, sw, sh);
  redrawObjects();
  refreshLayerPanelUI();
}

function flipHorizontal() {
  doFlipSelection(state, activeCtx(), pushUndo, true);
  drawSelectionOverlay(state, ov);
  refreshLayerPanelUI();
}
function flipVertical() {
  doFlipSelection(state, activeCtx(), pushUndo, false);
  drawSelectionOverlay(state, ov);
  refreshLayerPanelUI();
}

// ── Image upload ─────────────────────────────────────────────────────────────

function loadAnyFile(file) {
  const looksLikeProject =
    file.name?.toLowerCase().endsWith('.paintproj') || file.type === 'application/json';
  if (looksLikeProject) {
    readProjectFile(file)
      .then(loadProjectData)
      .catch((err) => alert('Could not open project: ' + err.message));
  } else if (file.type?.startsWith('image/')) {
    loadImageFile(file);
  }
}

function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    pushUndo('Upload');
    commitSelection();
    const origin = viewportPasteOrigin(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height
    );
    const obj = createImageObjectFromImage(img, origin.x, origin.y);
    state.objects.push(obj);
    setObjectSelection([obj.id]);
    URL.revokeObjectURL(url);
    redrawObjects();
    setActiveTool('select');
    refreshLayerPanelUI();
  };
  img.src = url;
}

async function loadProjectData(data) {
  await deserializeProject(
    data,
    ({ width, height, layers, bgColor, fgColor, activeLayerIdx, objects }) => {
      // Tear down current layers
      for (const l of state.layers) removeLayerFromDOM(l);
      state.layers = layers;
      state.activeLayerIdx = Math.min(activeLayerIdx, layers.length - 1);
      state.bgColor = bgColor;
      state.color = fgColor;
      state.activeColor = fgColor;
      state.objects = objects || [];
      setObjectSelection([]);
      state.undoStack = [];
      state.redoStack = [];
      // Resize stack DOM
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      stackEl.style.width = width + 'px';
      stackEl.style.height = height + 'px';
      // Mount layers
      for (const layer of state.layers) insertLayerBefore(layer, stackEl, layerInsertRef());
      if (objectsCanvas) {
        objectsCanvas.width = width;
        objectsCanvas.height = height;
      }
      updateUndoButtons();
      refreshLayerPanelUI();
      renderHistoryPanel();
      updateFgSwatch(state.color);
      state.onBgColorChange?.(state.bgColor);
      redrawObjects();
    }
  );
}

// ── Color history ─────────────────────────────────────────────────────────────

function addToColorHistory(hex) {
  state.colorHistory = [hex, ...state.colorHistory.filter((c) => c !== hex)].slice(0, 8);
  updateColorHistory(state.colorHistory, (color) => {
    state.color = color;
    state.activeColor = color;
    updateFgSwatch(color);
  });
}

// ── Pointer controller (lives in ./pointer.js) ───────────────────────────────

const pointer = createPointerController({
  state,
  overlayCanvas,
  ov,
  activeCtx,
  activeLayer,
  pushUndo,
  updateTransform,
  refreshLayerPanel: refreshLayerPanelUI
});

// ── Clear / new project ──────────────────────────────────────────────────────

function clearCanvas() {
  pushUndo('Clear');
  const ctx = activeCtx();
  ctx.fillStyle = state.bgColor;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  commitSelection();
  refreshLayerPanelUI();
}

function newProject() {
  if (state.undoStack.length > 0 && !confirm('Start a new project? Unsaved changes will be lost.'))
    return;
  for (const l of state.layers) removeLayerFromDOM(l);
  state.layers = [];
  state.undoStack = [];
  state.redoStack = [];
  state.activeLayerIdx = 0;
  const area = document.getElementById('canvas-area');
  const { W, H } = defaultCanvasSize(area);
  const layer0 = createLayer('Layer 1', W, H);
  layer0.ctx.fillStyle = state.bgColor;
  layer0.ctx.fillRect(0, 0, W, H);
  state.layers.push(layer0);
  insertLayerBefore(layer0, stackEl, layerInsertRef());
  if (objectsCanvas) {
    objectsCanvas.width = W;
    objectsCanvas.height = H;
  }
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  stackEl.style.width = W + 'px';
  stackEl.style.height = H + 'px';
  state.objects = [];
  setObjectSelection([]);
  redrawObjects();
  updateUndoButtons();
  refreshLayerPanelUI();
  renderHistoryPanel();
  clearAutosave();
}

// ── Panel resize ─────────────────────────────────────────────────────────────

function initPanelResize() {
  const handle = document.getElementById('panel-resize-handle');
  if (!handle) return;
  const MIN_W = 120,
    MAX_W = 520;
  let startX = 0,
    startW = 0;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--layer-panel-w'),
        10
      ) || 200;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  });

  handle.addEventListener('pointermove', (e) => {
    if (!handle.classList.contains('dragging')) return;
    // Drag left = wider panel (right panel grows leftward)
    const newW = Math.max(MIN_W, Math.min(MAX_W, startW + (startX - e.clientX)));
    document.documentElement.style.setProperty('--layer-panel-w', newW + 'px');
  });

  const stopDrag = () => handle.classList.remove('dragging');
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
}

// ── Canvas pixel-size resize handle ──────────────────────────────────────────

const CANVAS_SIZE_MIN = 1;
const CANVAS_SIZE_MAX = 8000;

function initCanvasResizeHandle() {
  const handle = document.getElementById('canvas-resize-handle');
  const ghost = document.getElementById('canvas-resize-ghost');
  const label = document.getElementById('canvas-resize-label');
  if (!handle || !ghost) return;

  let dragging = false;
  let startClientX = 0;
  let startClientY = 0;
  let startW = 0;
  let startH = 0;
  let previewW = 0;
  let previewH = 0;

  function clampSize(n) {
    return Math.max(CANVAS_SIZE_MIN, Math.min(CANVAS_SIZE_MAX, Math.round(n)));
  }

  function showPreview(w, h) {
    ghost.classList.remove('hidden');
    ghost.style.width = w + 'px';
    ghost.style.height = h + 'px';
    if (label) {
      label.classList.remove('hidden');
      label.textContent = `${w} × ${h}`;
    }
    handle.setAttribute('aria-valuenow', String(w));
    handle.setAttribute('aria-valuetext', `${w} by ${h}`);
    const status = document.getElementById('status-coords');
    if (status) status.textContent = `${w} × ${h}`;
  }

  function hidePreview() {
    ghost.classList.add('hidden');
    label?.classList.add('hidden');
  }

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startW = canvasW();
    startH = canvasH();
    previewW = startW;
    previewH = startH;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    showPreview(previewW, previewH);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startClientX) / state.zoom;
    const dy = (e.clientY - startClientY) / state.zoom;
    previewW = clampSize(startW + dx);
    previewH = clampSize(startH + dy);
    showPreview(previewW, previewH);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    hidePreview();
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (previewW === startW && previewH === startH) return;
    commitSelection();
    pushUndo('Resize');
    resizeStack(previewW, previewH);
    scheduleAutosave(state, canvasW(), canvasH());
  }

  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

// ── Adjustments ──────────────────────────────────────────────────────────────
// Modal lifecycle (open / preview / cancel / commit) and the action-menu
// open/close helpers live in `./adjust-modal.js`. paint.js owns the wiring
// to its own state + helpers via this thin wrapper layer.

function openAdjust(id) {
  doOpenAdjust(id, state, {
    activeCtx,
    pushUndo,
    onCommit: refreshLayerPanelUI
  });
}

function buildAdjustMenu() {
  doBuildAdjustMenu(openAdjust);
}

// ── Tool activation + options panel ──────────────────────────────────────────

function setActiveTool(id) {
  state.tool = id;
  overlayCanvas.style.cursor = TOOLS[id].cursor;
  // Pull the tool's own size/fill into the global mirrors so existing
  // tool implementations keep working without each one rewriting.
  const opts = state.toolOptions[id] || {};
  if (typeof opts.size === 'number') state.brushSize = opts.size;
  if (typeof opts.fill === 'boolean') state.shapeFill = opts.fill;
  refreshToolOptions();
  document.querySelectorAll('.tool-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === id);
  });
}

function refreshToolOptions() {
  const container = document.getElementById('tool-options');
  if (!container) return;
  const id = state.tool;
  const schema = TOOL_OPTION_SCHEMA[id] || [];
  const values = state.toolOptions[id] || {};
  renderToolOptions(schema, values, container, (key, value) => {
    state.toolOptions[id][key] = value;
    if (key === 'size' && typeof value === 'number') state.brushSize = value;
    if (key === 'fill' && typeof value === 'boolean') state.shapeFill = value;
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  initCanvas();

  // Inject state callbacks used by tools
  state.commitSelection = commitSelection;
  state.cropToSelection = cropToSelection;
  state.cancelStroke = cancelInProgressStroke;
  state.pushUndo = pushUndo;
  state.tryBeginMove = tryBeginMove;
  state.constrainLine = constrainLine;
  state.constrainSquare = constrainSquare;
  state.afterPlaceSelection = selectPlacedContent;
  state.activatePlacedSelection = (ctx, x, y, w, h, baseData, localMask) =>
    doActivatePlacedSelection(state, ctx, x, y, w, h, baseData, localMask);
  state.beginObjectSelect = beginObjectSelect;
  state.dragObjectSelect = dragObjectSelect;
  state.endObjectSelect = endObjectSelect;
  state.placeTextObject = placeTextObject;
  state.commitTextObjectEdit = commitTextObjectEdit;
  state.doMagicWand = (ctx, x, y) => {
    const opts = state.toolOptions.magicWand || {};
    return floodSelect(ctx, x, y, opts.tolerance ?? 30, opts.contiguous !== false);
  };
  state.scanlineFill = scanlineFill;
  state.showTextInput = pointer.showTextInput;
  state.sprayDot = pointer.doSprayDot;
  state.applySelectionWithMask = applySelectionWithMask;
  state.selectionModeFor = selectionModeFor;

  // Toolbar
  buildToolbar(TOOLS, state, document.getElementById('tool-buttons'), (id) => {
    if (state.sel.mode !== 'none' && id !== 'rectSelect' && id !== 'lasso' && id !== 'magicWand') {
      commitSelection();
    }
    pointer.commitTextInput();
    setActiveTool(id);
  });

  // Initial tool-options panel for the default tool
  refreshToolOptions();

  // Palette
  buildPalette(
    state,
    document.getElementById('palette-bar'),
    (color) => {
      state.color = color;
      state.activeColor = color;
      addToColorHistory(color);
    },
    (color) => {
      state.bgColor = color;
    }
  );

  // Eyedropper callbacks
  state.onColorChange = (color) => {
    state.activeColor = color;
    updateFgSwatch(color);
    addToColorHistory(color);
  };
  state.onBgColorChange = (color) => {
    const el = document.getElementById('bg-swatch');
    if (el) el.style.background = color;
    const inp = document.getElementById('bg-color-input');
    if (inp) inp.value = color;
  };

  // Canvas pointer events
  overlayCanvas.addEventListener('pointerdown', pointer.onPointerDown);
  overlayCanvas.addEventListener('pointermove', pointer.onPointerMove);
  overlayCanvas.addEventListener('pointerup', pointer.onPointerUp);
  overlayCanvas.addEventListener('pointerleave', (e) => {
    if (state.panning) {
      state.panning = false;
      overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
    }
    if (state.drawing) pointer.onPointerUp(e);
  });
  overlayCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Zoom via scroll wheel
  document.getElementById('canvas-area').addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomToward(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    },
    { passive: false }
  );

  // Zoom buttons
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    const area = document.getElementById('canvas-area');
    const r = area.getBoundingClientRect();
    zoomToward(r.left + r.width / 2, r.top + r.height / 2, 1.25);
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    const area = document.getElementById('canvas-area');
    const r = area.getBoundingClientRect();
    zoomToward(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25);
  });
  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    updateTransform();
  });

  // Action buttons
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-clear').addEventListener('click', clearCanvas);

  // File menu
  document.getElementById('btn-file')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFileMenu();
  });
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('file-menu-wrap');
    if (wrap && !wrap.contains(e.target)) closeFileMenu();
  });
  const uploadInput = document.getElementById('upload-input');
  document.querySelectorAll('#file-menu-list [data-file]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeFileMenu();
      const kind = btn.dataset.file;
      if (kind === 'new') newProject();
      else if (kind === 'open-computer') uploadInput?.click();
      else if (kind === 'save-png')
        openFilenameModal('untitled.png', (f) => downloadPNG(f, state, canvasW(), canvasH()));
      else if (kind === 'save-jpeg')
        openFilenameModal('untitled.jpg', (f) => downloadJPEG(f, state, canvasW(), canvasH()));
      else if (kind === 'save-project')
        openFilenameModal('untitled.paintproj', (f) =>
          downloadProjectFile(f, state, canvasW(), canvasH())
        );
    });
  });

  document.getElementById('btn-post')?.addEventListener('click', async () => {
    try {
      const blob = await exportPNGBlob(state, canvasW(), canvasH());
      if (!blob) throw new Error('Could not export drawing');
      const { share } = await import('/posts/share-client.js');
      await share({
        text: 'Paint\n\nMade with [Paint](https://joeheyming.github.io/paint/).',
        attachments: [blob]
      });
    } catch (err) {
      console.warn('Could not share Paint as a post', err);
    }
  });

  // Filename modal
  document.getElementById('filename-ok')?.addEventListener('click', confirmFilenameModal);
  document.getElementById('filename-cancel')?.addEventListener('click', closeFilenameModal);
  document.getElementById('filename-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmFilenameModal();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFilenameModal();
    }
  });

  // Resize modal
  document
    .getElementById('btn-resize')
    ?.addEventListener('click', () => openResizeModalUI(canvasW(), canvasH()));
  document.getElementById('resize-ok')?.addEventListener('click', () =>
    confirmResizeUI((W, H) => {
      commitSelection();
      pushUndo('Resize');
      resizeStack(W, H);
      scheduleAutosave(state, W, H);
    })
  );
  document.getElementById('resize-cancel')?.addEventListener('click', closeResizeModal);

  document.getElementById('btn-crop')?.addEventListener('click', cropToSelection);
  document.getElementById('btn-flip-h')?.addEventListener('click', flipHorizontal);
  document.getElementById('btn-flip-v')?.addEventListener('click', flipVertical);

  // Adjust menu
  buildAdjustMenu();
  document.getElementById('btn-adjust')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAdjustMenu();
  });
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('adjust-menu-wrap');
    if (wrap && !wrap.contains(e.target)) closeAdjustMenu();
  });
  document.getElementById('adjust-ok')?.addEventListener('click', commitAdjust);
  document.getElementById('adjust-cancel')?.addEventListener('click', cancelAdjust);

  // File input change — triggered by "Open from Computer" in file menu
  uploadInput?.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      loadAnyFile(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Drag-drop onto canvas
  const area = document.getElementById('canvas-area');
  area.addEventListener('dragover', (e) => e.preventDefault());
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadAnyFile(file);
  });

  // Text input
  const textInput = document.getElementById('text-input');
  textInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      textInput.style.display = 'none';
      textInput.value = '';
      e.preventDefault();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      pointer.commitTextInput();
    }
  });
  textInput?.addEventListener('blur', pointer.commitTextInput);

  // Accordion panel section toggles
  document.querySelectorAll('.panel-section-header').forEach((header) => {
    header.addEventListener('click', () => {
      const section = header.parentElement;
      const collapsing = !section.classList.contains('collapsed');
      section.classList.toggle('collapsed', collapsing);
      if (!collapsing) section.classList.add('expanded');
      if (collapsing) section.classList.remove('expanded');
    });
  });

  // Layer panel init
  refreshLayerPanelUI();
  renderHistoryPanel();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    const inInput =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      !!document.activeElement?.isContentEditable;

    // While typing in an input, only Escape is handled specially — leave
    // Ctrl+Z/A/C/V to the browser for text editing.
    if (inInput) {
      if (e.key === 'Escape') {
        const textInput = document.getElementById('text-input');
        if (textInput && textInput.style.display !== 'none') {
          textInput.style.display = 'none';
          textInput.value = '';
          e.preventDefault();
        }
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      redo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      void copySelection(activeCtx(), false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
      e.preventDefault();
      void copySelection(activeCtx(), true);
      return;
    }
    // Paste is handled by the `paste` event so OS image clipboard data is available.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'd') {
      e.preventDefault();
      commitSelection();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      invertSelection();
      return;
    }

    if (e.key === 'Escape') {
      // Cancel text edit without saving if textarea open
      const textInput = document.getElementById('text-input');
      if (textInput && textInput.style.display !== 'none') {
        const editingId = textInput.dataset.editingObjectId;
        if (editingId) {
          const obj = findObject(state.objects, parseInt(editingId, 10));
          if (obj) obj._hiddenWhileEdit = false;
          delete textInput.dataset.editingObjectId;
          redrawObjects();
        }
        textInput.style.display = 'none';
        textInput.value = '';
        e.preventDefault();
        return;
      }
      commitSelection();
      deselectObject();
      setActiveTool('select');
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (deleteSelectedObject()) return;
      deleteSelection(activeCtx());
      return;
    }

    if (e.code === 'Space' && !state.spaceDown) {
      state.spaceDown = true;
      overlayCanvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }

    const shortcuts = {
      v: 'select',
      escape: 'select',
      p: 'pencil',
      b: 'brush',
      e: 'eraser',
      s: 'spray',
      f: 'fill',
      i: 'eyedropper',
      t: 'text',
      l: 'line',
      r: 'rect',
      o: 'ellipse',
      m: 'rectSelect',
      g: 'lasso',
      w: 'magicWand'
    };
    const toolId = shortcuts[e.key.toLowerCase()];
    if (toolId) {
      pointer.commitTextInput();
      if (
        state.sel.mode !== 'none' &&
        !['rectSelect', 'lasso', 'magicWand', 'select'].includes(toolId)
      )
        commitSelection();
      setActiveTool(toolId);
      return;
    }

    if ((e.key === '+' || e.key === '=') && !e.ctrlKey) {
      const a = document.getElementById('canvas-area'),
        r = a.getBoundingClientRect();
      zoomToward(r.left + r.width / 2, r.top + r.height / 2, 1.25);
    }
    if (e.key === '-' && !e.ctrlKey) {
      const a = document.getElementById('canvas-area'),
        r = a.getBoundingClientRect();
      zoomToward(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25);
    }
    if (e.key === '0' && !e.ctrlKey) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      updateTransform();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && state.spaceDown) {
      state.spaceDown = false;
      if (!state.panning) {
        overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
      }
    }
  });

  updateUndoButtons();
  initPanelResize();
  initCanvasResizeHandle();

  // OS + in-app paste (must use the paste event so clipboardData images are available)
  document.addEventListener('paste', (e) => {
    const tag = document.activeElement?.tagName;
    const inInput =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      document.activeElement?.isContentEditable;
    if (inInput) return;

    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type?.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void pasteImageFile(file);
            return;
          }
        }
      }
    }
    if (state.clipboard) {
      e.preventDefault();
      pasteClipboard(activeCtx());
    }
  });
  startSelectionAnimation(state, ov);
  updateTransform();

  installOSBridge({
    state,
    getDims: () => ({ w: canvasW(), h: canvasH() }),
    activeCtx,
    pushUndo,
    refreshLayerPanel: refreshLayerPanelUI,
    closeFileMenu,
    loadProjectData
  });

  maybeOfferRestore();
}

function maybeOfferRestore() {
  const auto = readAutosave();
  if (!auto?.data) return;
  // Only offer if the autosaved project differs from a fresh empty canvas
  // (more than just the initial single blank layer).
  const layerCount = auto.data.layers?.length ?? 0;
  if (layerCount === 0) return;
  const ageMin = Math.round((Date.now() - (auto.savedAt ?? 0)) / 60000);
  const ageStr =
    ageMin < 1
      ? 'less than a minute ago'
      : ageMin === 1
      ? '1 minute ago'
      : ageMin < 60
      ? `${ageMin} minutes ago`
      : `${Math.round(ageMin / 60)} hour(s) ago`;
  if (confirm(`Restore your previous Paint session from ${ageStr}?`)) {
    loadProjectData(auto.data).catch((err) => alert('Restore failed: ' + err.message));
  } else {
    clearAutosave();
  }
}

document.addEventListener('DOMContentLoaded', init);
