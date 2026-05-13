import { TOOLS, TOOL_OPTION_SCHEMA, floodSelect, scanlineFill, defaultToolOptions } from './tools.js';
import { buildToolbar, buildPalette, updateFgSwatch, updateStatus, updateColorHistory,
         renderToolOptions } from './ui.js';
import { createLayer, insertLayerBefore, removeLayerFromDOM, syncLayerDOM,
         flattenToCanvas, renderLayerPanel, refreshLayerThumbs } from './layers.js';
import { renderHistoryPanel as buildHistoryPanel } from './history.js';
import { ADJUSTMENTS } from './adjustments.js';
import { serializeProject, deserializeProject, downloadProject, readProjectFile,
         scheduleAutosave, readAutosave, clearAutosave } from './project.js';

const MAX_UNDO = 50;

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  tool: 'pencil',
  color: '#000000',
  bgColor: '#ffffff',
  activeColor: '#000000',
  brushSize: 4,
  shapeFill: false,
  toolOptions: defaultToolOptions(),
  drawing: false,
  startX: 0, startY: 0,
  lastX: 0, lastY: 0,

  // Layers
  layers: [],
  activeLayerIdx: 0,

  // Zoom + pan
  zoom: 1,
  panX: 0, panY: 0,
  panning: false,
  panStartClientX: 0, panStartClientY: 0,
  panStartX: 0, panStartY: 0,
  spaceDown: false,

  // Pointer
  pressure: 1,

  // Selection
  sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0, data: null, mask: null, baseData: null },
  selStartMoveX: 0, selStartMoveY: 0, selOrigX: 0, selOrigY: 0,
  lassoPath: [],

  // Clipboard
  clipboard: null,

  // Color history
  colorHistory: [],

  // Spray internals
  sprayTimer: null, sprayX: 0, sprayY: 0,

  // Undo
  undoStack: [],
  redoStack: [],

  // Callbacks (set up after DOM ready)
  onColorChange: null,
  onBgColorChange: null,
  showTextInput: null,
  commitSelection: null,
  doMagicWand: null,
  scanlineFill: null,
};

// ── Canvas / layer helpers ───────────────────────────────────────────────────

const overlayCanvas = document.getElementById('overlay-canvas');
const ov = overlayCanvas.getContext('2d', { willReadFrequently: true });
const stackEl = document.getElementById('canvas-stack');

function canvasW() { return state.layers[0]?.canvas.width ?? 800; }
function canvasH() { return state.layers[0]?.canvas.height ?? 600; }
function activeLayer() { return state.layers[state.activeLayerIdx]; }
function activeCtx() { return activeLayer().ctx; }

function initCanvas() {
  const area = document.getElementById('canvas-area');
  const rect = area.getBoundingClientRect();
  const W = Math.max(Math.floor(rect.width), 400);
  const H = Math.max(Math.floor(rect.height), 300);

  const layer0 = createLayer('Layer 1', W, H);
  layer0.ctx.fillStyle = state.bgColor;
  layer0.ctx.fillRect(0, 0, W, H);
  state.layers.push(layer0);
  insertLayerBefore(layer0, stackEl, overlayCanvas);

  overlayCanvas.width = W;
  overlayCanvas.height = H;
  stackEl.style.width = W + 'px';
  stackEl.style.height = H + 'px';
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
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  stackEl.style.width = W + 'px';
  stackEl.style.height = H + 'px';
}

// ── Undo/Redo ────────────────────────────────────────────────────────────────

function pushUndo(label = 'Draw') {
  const layer = activeLayer();
  const snap = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  state.undoStack.push({ layerId: layer.id, data: snap, label });
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
  updateUndoButtons();
  renderHistoryPanel();
  scheduleAutosave(state, canvasW(), canvasH());
}

function undo() {
  if (!state.undoStack.length) return;
  const entry = state.undoStack.pop();
  const target = state.layers.find(l => l.id === entry.layerId);
  if (!target) { updateUndoButtons(); return; }
  state.redoStack.push({ layerId: entry.layerId, label: entry.label,
    data: target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height) });
  target.ctx.putImageData(entry.data, 0, 0);
  updateUndoButtons();
  refreshLayerPanelUI();
  renderHistoryPanel();
}

function redo() {
  if (!state.redoStack.length) return;
  const entry = state.redoStack.pop();
  const target = state.layers.find(l => l.id === entry.layerId);
  if (!target) { updateUndoButtons(); return; }
  state.undoStack.push({ layerId: entry.layerId, label: entry.label,
    data: target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height) });
  target.ctx.putImageData(entry.data, 0, 0);
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

// ── History panel ────────────────────────────────────────────────────────────

function jumpHistoryUndo(steps) {
  for (let i = 0; i < steps; i++) {
    if (!state.undoStack.length) break;
    const entry = state.undoStack.pop();
    const target = state.layers.find(l => l.id === entry.layerId);
    if (target) {
      state.redoStack.push({ layerId: entry.layerId, label: entry.label,
        data: target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height) });
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
    const target = state.layers.find(l => l.id === entry.layerId);
    if (target) {
      state.undoStack.push({ layerId: entry.layerId, label: entry.label,
        data: target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height) });
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
  buildHistoryPanel(container, state.undoStack, state.redoStack,
    jumpHistoryUndo, jumpHistoryRedo);
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
  const mx = clientX - rect.left, my = clientY - rect.top;
  const prev = state.zoom;
  state.zoom = Math.max(0.1, Math.min(16, prev * factor));
  state.panX = mx - (mx - state.panX) * (state.zoom / prev);
  state.panY = my - (my - state.panY) * (state.zoom / prev);
  updateTransform();
}

// ── Selection helpers ────────────────────────────────────────────────────────

// Collect every mask pixel that touches a non-mask pixel (or the canvas edge).
// Used for true "marching ants" around non-rectangular selections — combined
// Shift/Alt/Cmd magic-wand and lasso picks. We render these as a 1-pixel
// alternating white/black pattern; setLineDash is unusable here because
// per-pixel disjoint subpaths reset the dash pattern at every moveTo.
function buildBoundaryPixels(mask, W, H) {
  const out = [];
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (!mask[row + x]) continue;
      const onEdge =
        (y === 0 || !mask[row - W + x]) ||
        (y === H - 1 || !mask[row + W + x]) ||
        (x === 0 || !mask[row + x - 1]) ||
        (x === W - 1 || !mask[row + x + 1]);
      if (onEdge) out.push(x, y);
    }
  }
  return out;
}

// Marching ants animation
let dashOffset = 0;
function drawSelectionOverlay() {
  const sel = state.sel;
  if (sel.mode === 'none') return;
  if (state.drawing && state.tool !== 'rectSelect' && state.tool !== 'lasso') return;

  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);

  if (sel.mode === 'moving' && sel.data) {
    // Floating content already drawn to canvas in onMove, no extra needed
  }

  // Prefer the real mask outline when we have one — this is what makes
  // multi-region selections (e.g. Shift-click magic wand) actually look right
  // instead of one giant bbox swallowing the empty space between regions.
  const W = ov.canvas.width, H = ov.canvas.height;
  const hasFullMask = sel.mask && sel.mask.length === W * H && sel.mode === 'active';
  if (hasFullMask) {
    if (!sel.boundaryPixels) sel.boundaryPixels = buildBoundaryPixels(sel.mask, W, H);
    const pts = sel.boundaryPixels;
    // Two-pass: alternate white/black on a phase-shifting parity so the ants
    // visibly march without depending on lineDash continuity.
    ov.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      if (((pts[i] + pts[i + 1] + dashOffset) & 7) < 4) ov.rect(pts[i], pts[i + 1], 1, 1);
    }
    ov.fillStyle = '#fff';
    ov.fill();
    ov.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      if (((pts[i] + pts[i + 1] + dashOffset) & 7) >= 4) ov.rect(pts[i], pts[i + 1], 1, 1);
    }
    ov.fillStyle = '#000';
    ov.fill();
    return;
  }

  // Fallback: rectangle bbox or lasso polyline — these still use animated dashes.
  ov.save();
  ov.strokeStyle = '#fff';
  ov.lineWidth = 1;
  ov.setLineDash([4, 4]);
  ov.lineDashOffset = -dashOffset;

  if (sel.lassoPoly && sel.mode === 'active') {
    ov.beginPath();
    ov.moveTo(sel.lassoPoly[0][0], sel.lassoPoly[0][1]);
    for (const [px, py] of sel.lassoPoly) ov.lineTo(px, py);
    ov.closePath();
    ov.stroke();
    // Second pass in black offset by half period
    ov.strokeStyle = '#000';
    ov.lineDashOffset = -dashOffset + 4;
    ov.beginPath();
    ov.moveTo(sel.lassoPoly[0][0], sel.lassoPoly[0][1]);
    for (const [px, py] of sel.lassoPoly) ov.lineTo(px, py);
    ov.closePath();
    ov.stroke();
  } else {
    ov.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
    ov.strokeStyle = '#000';
    ov.lineDashOffset = -dashOffset + 4;
    ov.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
  }
  ov.setLineDash([]);
  ov.restore();
}

// rAF loop for marching ants
let lastDashTime = 0;
function rafLoop(ts) {
  if (ts - lastDashTime > 80) {
    dashOffset = (dashOffset + 1) % 8;
    lastDashTime = ts;
    if (state.sel.mode !== 'none' && !state.drawing) drawSelectionOverlay();
  }
  requestAnimationFrame(rafLoop);
}

function commitSelection() {
  const sel = state.sel;
  if (sel.mode === 'none') return;
  // If floating data was moved, it's already stamped in onMove
  sel.mode = 'none';
  sel.data = null; sel.mask = null; sel.baseData = null;
  sel.lassoPoly = null;
  ov.clearRect(0, 0, ov.canvas.width, ov.canvas.height);
}

// Build an ImageData for clipboard, zeroing non-masked pixels' alpha
function getSelectionImageData(ctx) {
  const sel = state.sel;
  const raw = ctx.getImageData(sel.x, sel.y, sel.w, sel.h);
  if (!sel.mask) return raw;
  const W = ctx.canvas.width;
  for (let row = 0; row < sel.h; row++) {
    for (let col = 0; col < sel.w; col++) {
      const maskIdx = (sel.y + row) * W + (sel.x + col);
      if (!sel.mask[maskIdx]) raw.data[(row * sel.w + col) * 4 + 3] = 0;
    }
  }
  return raw;
}

function copySelection(ctx, cut) {
  const sel = state.sel;
  if (sel.mode !== 'active') return;
  const data = getSelectionImageData(ctx);
  state.clipboard = { data, w: sel.w, h: sel.h, mask: sel.mask ? sel.mask.slice() : null };
  if (cut) {
    pushUndo('Cut');
    if (sel.mask) {
      // Fill only selected pixels with bgColor
      const W = ctx.canvas.width;
      const img = ctx.getImageData(0, 0, W, ctx.canvas.height);
      const [br, bg, bb] = hexToRgb(state.bgColor);
      for (let row = 0; row < sel.h; row++) {
        for (let col = 0; col < sel.w; col++) {
          const maskIdx = (sel.y + row) * W + (sel.x + col);
          if (sel.mask[maskIdx]) {
            const pos = maskIdx * 4;
            img.data[pos] = br; img.data[pos+1] = bg; img.data[pos+2] = bb; img.data[pos+3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    } else {
      ctx.fillStyle = state.bgColor;
      ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
    }
    commitSelection();
  }
}

function pasteClipboard(ctx) {
  if (!state.clipboard) return;
  pushUndo('Paste');
  const { data, w, h, mask } = state.clipboard;
  if (mask) {
    // Paste via temp canvas to handle alpha
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d', { willReadFrequently: true }).putImageData(data, 0, 0);
    ctx.drawImage(tmp, state.sel.x || 0, state.sel.y || 0);
  } else {
    ctx.putImageData(data, state.sel.x || 0, state.sel.y || 0);
  }
  state.sel = { mode: 'active', x: state.sel.x || 0, y: state.sel.y || 0, w, h,
    data: null, mask: null, baseData: null };
}

function deleteSelection(ctx) {
  const sel = state.sel;
  if (sel.mode !== 'active') return;
  pushUndo('Delete');
  if (sel.mask) {
    const W = ctx.canvas.width;
    const img = ctx.getImageData(0, 0, W, ctx.canvas.height);
    const [br, bg, bb] = hexToRgb(state.bgColor);
    for (let row = 0; row < sel.h; row++) {
      for (let col = 0; col < sel.w; col++) {
        const maskIdx = (sel.y + row) * W + (sel.x + col);
        if (sel.mask[maskIdx]) {
          const pos = maskIdx * 4;
          img.data[pos] = br; img.data[pos+1] = bg; img.data[pos+2] = bb; img.data[pos+3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
  }
  commitSelection();
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

// ── Selection mask helpers (for modifier-key combining) ──────────────────────

function selectionToFullMask(sel, W, H) {
  if (sel.mask && sel.mask.length === W * H) return sel.mask.slice();
  const mask = new Uint8Array(W * H);
  if (sel.mode !== 'active') return mask;
  const x0 = Math.max(0, sel.x), y0 = Math.max(0, sel.y);
  const x1 = Math.min(W, sel.x + sel.w), y1 = Math.min(H, sel.y + sel.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
  }
  return mask;
}

function maskBBox(mask, W, H) {
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Combine a freshly-built selection mask with the existing selection per modifier mode.
// Returns { mask, bbox } or sets sel to none if the result is empty.
function applySelectionWithMask(newMask, W, H, mode) {
  let combined = newMask;
  if (mode && state.sel.mode === 'active') {
    const existing = selectionToFullMask(state.sel, W, H);
    combined = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (mode === 'add') combined[i] = (existing[i] || newMask[i]) ? 1 : 0;
      else if (mode === 'subtract') combined[i] = (existing[i] && !newMask[i]) ? 1 : 0;
      else if (mode === 'intersect') combined[i] = (existing[i] && newMask[i]) ? 1 : 0;
    }
  }
  const bbox = maskBBox(combined, W, H);
  if (!bbox) {
    state.sel.mode = 'none';
    state.sel.mask = null; state.sel.data = null; state.sel.baseData = null;
    state.sel.lassoPoly = null;
    return;
  }
  state.sel = {
    mode: 'active',
    x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h,
    mask: combined,
    data: null, baseData: null,
  };
}

function selectionModeFor(state) {
  // Add: Shift OR Cmd/Ctrl (web-multi-select intuition + Photoshop's Shift).
  // Subtract: Alt/Option.
  // Intersect: any add modifier combined with subtract.
  const add = state.shiftKey || state.ctrlKey;
  const sub = state.altKey;
  if (add && sub) return 'intersect';
  if (add) return 'add';
  if (sub) return 'subtract';
  return null;
}

function selectAll() {
  const W = canvasW(), H = canvasH();
  const mask = new Uint8Array(W * H).fill(1);
  state.sel = { mode: 'active', x: 0, y: 0, w: W, h: H, mask, data: null, baseData: null };
  drawSelectionOverlay();
}

function invertSelection() {
  const W = canvasW(), H = canvasH();
  if (state.sel.mode !== 'active') {
    selectAll();
    return;
  }
  const cur = selectionToFullMask(state.sel, W, H);
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inv[i] = cur[i] ? 0 : 1;
  applySelectionWithMask(inv, W, H, null);
  drawSelectionOverlay();
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
    onFlatten: flattenLayers,
  });
}

function addLayer() {
  const w = canvasW(), h = canvasH();
  const name = `Layer ${state.layers.length + 1}`;
  const layer = createLayer(name, w, h);
  state.layers.push(layer);
  // Insert before overlay (last layer canvas is on top, above earlier ones)
  insertLayerBefore(layer, stackEl, overlayCanvas);
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
  const w = canvasW(), h = canvasH();
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

// ── Text tool ────────────────────────────────────────────────────────────────

function textFontSpec() {
  const opts = state.toolOptions.text || {};
  const sz = opts.size ?? 16;
  const fam = opts.family ?? 'sans-serif';
  const w = opts.bold ? 'bold ' : '';
  const i = opts.italic ? 'italic ' : '';
  return { spec: `${i}${w}${sz}px ${fam}`, size: sz };
}

function showTextInput(ctx, canvasX, canvasY) {
  const area = document.getElementById('canvas-area');
  const areaRect = area.getBoundingClientRect();
  const stackRect = overlayCanvas.getBoundingClientRect();

  const screenX = stackRect.left - areaRect.left + canvasX * state.zoom;
  const screenY = stackRect.top - areaRect.top + canvasY * state.zoom;
  const { spec, size } = textFontSpec();
  const opts = state.toolOptions.text || {};

  const input = document.getElementById('text-input');
  input.style.left = screenX + 'px';
  input.style.top = screenY + 'px';
  input.style.fontFamily = opts.family ?? 'sans-serif';
  input.style.fontSize = (size * state.zoom) + 'px';
  input.style.fontWeight = opts.bold ? 'bold' : 'normal';
  input.style.fontStyle = opts.italic ? 'italic' : 'normal';
  input.style.color = state.activeColor;
  input.value = '';
  input.style.display = 'block';
  input.dataset.canvasX = canvasX;
  input.dataset.canvasY = canvasY;
  input.dataset.layerId = activeLayer().id;
  input.dataset.fontSpec = spec;
  input.dataset.fontSize = String(size);
  input.focus();
}

function commitTextInput() {
  const input = document.getElementById('text-input');
  if (input.style.display === 'none') return;
  const text = input.value.trim();
  if (text) {
    const canvasX = parseFloat(input.dataset.canvasX);
    const canvasY = parseFloat(input.dataset.canvasY);
    const layerId = parseInt(input.dataset.layerId);
    const fontSpec = input.dataset.fontSpec || '16px sans-serif';
    const fontSize = parseFloat(input.dataset.fontSize) || 16;
    const layer = state.layers.find(l => l.id === layerId);
    if (layer) {
      pushUndo('Text');
      layer.ctx.font = fontSpec;
      layer.ctx.fillStyle = state.activeColor;
      layer.ctx.globalAlpha = 1;
      layer.ctx.globalCompositeOperation = 'source-over';
      layer.ctx.fillText(text, canvasX, canvasY + fontSize);
    }
  }
  input.style.display = 'none';
  input.value = '';
}

// ── Spray helper ─────────────────────────────────────────────────────────────

function doSprayDot(x, y) {
  const ctx = activeCtx();
  const opts = state.toolOptions.spray || {};
  const radius = (opts.size ?? state.brushSize) * 5;
  const density = Math.max(1, Math.ceil(radius * ((opts.density ?? 80) / 100)));
  ctx.fillStyle = state.activeColor;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < density; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * radius;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    ctx.beginPath();
    ctx.arc(px, py, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Image upload ─────────────────────────────────────────────────────────────

function loadAnyFile(file) {
  const looksLikeProject =
    file.name?.toLowerCase().endsWith('.paintproj') ||
    file.type === 'application/json';
  if (looksLikeProject) {
    readProjectFile(file)
      .then(loadProjectData)
      .catch(err => alert('Could not open project: ' + err.message));
  } else if (file.type?.startsWith('image/')) {
    loadImageFile(file);
  }
}

function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    pushUndo('Upload');
    activeCtx().drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    refreshLayerPanelUI();
  };
  img.src = url;
}

async function loadProjectData(data) {
  await deserializeProject(data, ({ width, height, layers, bgColor, fgColor, activeLayerIdx }) => {
    // Tear down current layers
    for (const l of state.layers) removeLayerFromDOM(l);
    state.layers = layers;
    state.activeLayerIdx = Math.min(activeLayerIdx, layers.length - 1);
    state.bgColor = bgColor;
    state.color = fgColor;
    state.activeColor = fgColor;
    state.undoStack = []; state.redoStack = [];
    // Resize stack DOM
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    stackEl.style.width = width + 'px';
    stackEl.style.height = height + 'px';
    // Mount layers
    for (const layer of state.layers) insertLayerBefore(layer, stackEl, overlayCanvas);
    updateUndoButtons();
    refreshLayerPanelUI();
    renderHistoryPanel();
    updateFgSwatch(state.color);
    state.onBgColorChange?.(state.bgColor);
  });
}

// ── Canvas resize ─────────────────────────────────────────────────────────────

function openResizeModal() {
  const modal = document.getElementById('resize-modal');
  document.getElementById('resize-w').value = canvasW();
  document.getElementById('resize-h').value = canvasH();
  modal.classList.remove('hidden');
}

function closeResizeModal() {
  document.getElementById('resize-modal').classList.add('hidden');
}

function confirmResize() {
  const W = parseInt(document.getElementById('resize-w').value, 10);
  const H = parseInt(document.getElementById('resize-h').value, 10);
  if (!W || !H || W < 1 || H < 1 || W > 8000 || H > 8000) return;
  resizeStack(W, H);
  closeResizeModal();
}

// ── Color history ─────────────────────────────────────────────────────────────

function addToColorHistory(hex) {
  state.colorHistory = [hex, ...state.colorHistory.filter(c => c !== hex)].slice(0, 8);
  updateColorHistory(state.colorHistory, color => {
    state.color = color;
    state.activeColor = color;
    updateFgSwatch(color);
  });
}

// ── Pointer events ────────────────────────────────────────────────────────────

const UNDOABLE_ON_DOWN = new Set(['pencil', 'brush', 'eraser', 'fill', 'spray']);
const UNDOABLE_ON_UP = new Set(['line', 'rect', 'ellipse']);

function getCanvasCoords(e) {
  const rect = overlayCanvas.getBoundingClientRect();
  const scaleX = overlayCanvas.width / rect.width;
  const scaleY = overlayCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function onPointerDown(e) {
  // Middle mouse OR spacebar held = pan
  if (e.button === 1 || (state.spaceDown && e.button === 0)) {
    e.preventDefault();
    state.panning = true;
    state.panStartClientX = e.clientX; state.panStartClientY = e.clientY;
    state.panStartX = state.panX; state.panStartY = state.panY;
    overlayCanvas.setPointerCapture(e.pointerId);
    overlayCanvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0 && e.button !== 2) return;
  e.preventDefault();
  overlayCanvas.setPointerCapture(e.pointerId);

  const isRight = e.button === 2;
  state.activeColor = isRight ? state.bgColor : state.color;
  state.pressure = pressureFor(e);
  state.shiftKey = e.shiftKey;
  state.altKey = e.altKey;
  // On Mac, Ctrl-click is a right-click — only treat ctrl/meta as a selection
  // modifier on a real left-click, otherwise color-picking with right-click
  // would also subtract from the selection.
  state.ctrlKey = !isRight && (e.ctrlKey || e.metaKey);

  const { x, y } = getCanvasCoords(e);
  const tool = TOOLS[state.tool];

  if (UNDOABLE_ON_DOWN.has(state.tool)) pushUndo(TOOLS[state.tool].label);

  commitTextInput();

  tool.onDown(activeCtx(), ov, state, x, y, isRight);
}

function onPointerMove(e) {
  if (state.panning) {
    state.panX = state.panStartX + (e.clientX - state.panStartClientX);
    state.panY = state.panStartY + (e.clientY - state.panStartClientY);
    updateTransform();
    return;
  }
  state.pressure = pressureFor(e);
  const { x, y } = getCanvasCoords(e);
  updateStatus(x, y);
  if (state.tool === 'spray') { state.sprayX = x; state.sprayY = y; }
  if (!state.drawing && state.sel.mode !== 'moving') return;
  TOOLS[state.tool].onMove(activeCtx(), ov, state, x, y);
}

// Real pen pressure for stylus, neutral 1.0 for mouse/touch.
function pressureFor(e) {
  if (e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0) {
    return e.pressure;
  }
  return 1;
}

function onPointerUp(e) {
  if (state.panning) {
    state.panning = false;
    overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
    return;
  }
  if (!state.drawing && state.sel.mode !== 'moving') return;
  const { x, y } = getCanvasCoords(e);
  const tool = TOOLS[state.tool];

  if (UNDOABLE_ON_UP.has(state.tool)) pushUndo(TOOLS[state.tool].label);

  tool.onUp(activeCtx(), ov, state, x, y);
  refreshLayerPanelUI();
}

// ── Clear / Save ──────────────────────────────────────────────────────────────

function clearCanvas() {
  pushUndo('Clear');
  const ctx = activeCtx();
  ctx.fillStyle = state.bgColor;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  commitSelection();
  refreshLayerPanelUI();
}

function savePNG() {
  const flat = flattenToCanvas(state.layers, state.bgColor, canvasW(), canvasH(), { transparentBg: true });
  const link = document.createElement('a');
  link.download = 'paint.png';
  link.href = flat.toDataURL('image/png');
  link.click();
}

function saveJPEG() {
  const flat = flattenToCanvas(state.layers, state.bgColor, canvasW(), canvasH());
  const link = document.createElement('a');
  link.download = 'paint.jpg';
  link.href = flat.toDataURL('image/jpeg', 0.92);
  link.click();
}

function saveProject() {
  const data = serializeProject(state, canvasW(), canvasH());
  downloadProject(data, 'paint.paintproj');
}

// ── Panel resize ─────────────────────────────────────────────────────────────

function initPanelResize() {
  const handle = document.getElementById('panel-resize-handle');
  if (!handle) return;
  const MIN_W = 120, MAX_W = 520;
  let startX = 0, startW = 0;

  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--layer-panel-w'), 10
    ) || 200;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  });

  handle.addEventListener('pointermove', e => {
    if (!handle.classList.contains('dragging')) return;
    // Drag left = wider panel (right panel grows leftward)
    const newW = Math.max(MIN_W, Math.min(MAX_W, startW + (startX - e.clientX)));
    document.documentElement.style.setProperty('--layer-panel-w', newW + 'px');
  });

  const stopDrag = () => handle.classList.remove('dragging');
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
}

// ── Adjustments ──────────────────────────────────────────────────────────────

// Currently-open adjustment session: { id, baseImage, params, mask }.
let adjustSession = null;

function openAdjust(id) {
  const def = ADJUSTMENTS[id];
  if (!def) return;
  closeAdjustMenu();
  const ctx = activeCtx();
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const baseImage = ctx.getImageData(0, 0, W, H);
  const mask = state.sel.mode === 'active' ? selectionToFullMask(state.sel, W, H) : null;
  const params = {};
  for (const f of def.fields) params[f.key] = f.default;
  adjustSession = { id, baseImage, params, mask, ctx, W, H };

  document.getElementById('adjust-modal-title').textContent = def.label;
  const fieldsEl = document.getElementById('adjust-modal-fields');
  fieldsEl.innerHTML = '';

  if (def.fields.length === 0) {
    // No-parameter adjustments — show preview directly without sliders.
    const note = document.createElement('div');
    note.style.fontSize = '13px';
    note.style.color = 'var(--fg-dim)';
    note.textContent = 'Apply ' + def.label + (mask ? ' to selection' : ' to active layer') + '?';
    fieldsEl.appendChild(note);
    previewAdjust();
  } else {
    for (const f of def.fields) {
      const row = document.createElement('div');
      row.className = 'adjust-field';
      const label = document.createElement('label');
      label.textContent = f.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(f.min);
      input.max = String(f.max);
      input.step = String(f.step ?? 1);
      input.value = String(f.default);
      const display = document.createElement('span');
      display.className = 'adjust-field-value';
      display.textContent = String(f.default);
      input.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        adjustSession.params[f.key] = v;
        display.textContent = String(v);
        previewAdjust();
      });
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(display);
      fieldsEl.appendChild(row);
    }
    previewAdjust();
  }

  document.getElementById('adjust-modal').classList.remove('hidden');
}

function previewAdjust() {
  if (!adjustSession) return;
  const { id, baseImage, params, mask, ctx } = adjustSession;
  // Clone base image so the original stays intact between preview redraws.
  const work = ctx.createImageData(baseImage.width, baseImage.height);
  work.data.set(baseImage.data);
  ADJUSTMENTS[id].apply(work, params, mask);
  ctx.putImageData(work, 0, 0);
}

function cancelAdjust() {
  if (adjustSession) {
    adjustSession.ctx.putImageData(adjustSession.baseImage, 0, 0);
  }
  adjustSession = null;
  document.getElementById('adjust-modal').classList.add('hidden');
}

function commitAdjust() {
  if (!adjustSession) return;
  const def = ADJUSTMENTS[adjustSession.id];
  // Restore base, push undo, re-apply for the canonical record.
  adjustSession.ctx.putImageData(adjustSession.baseImage, 0, 0);
  pushUndo(def.label);
  const work = adjustSession.ctx.createImageData(adjustSession.W, adjustSession.H);
  work.data.set(adjustSession.baseImage.data);
  def.apply(work, adjustSession.params, adjustSession.mask);
  adjustSession.ctx.putImageData(work, 0, 0);
  refreshLayerPanelUI();
  adjustSession = null;
  document.getElementById('adjust-modal').classList.add('hidden');
}

function buildAdjustMenu() {
  const list = document.getElementById('adjust-menu-list');
  if (!list) return;
  list.innerHTML = '';
  const order = ['brightness', 'hsl', 'threshold', null, 'invert', 'grayscale', 'sepia', null, 'pixelate'];
  for (const id of order) {
    if (id === null) {
      const sep = document.createElement('div');
      sep.className = 'action-menu-sep';
      list.appendChild(sep);
      continue;
    }
    const def = ADJUSTMENTS[id];
    if (!def) continue;
    const item = document.createElement('button');
    item.className = 'action-menu-item';
    item.textContent = def.label;
    item.addEventListener('click', () => openAdjust(id));
    list.appendChild(item);
  }
}

function toggleAdjustMenu() {
  const list = document.getElementById('adjust-menu-list');
  const btn = document.getElementById('btn-adjust');
  if (!list) return;
  const willOpen = list.classList.contains('hidden');
  list.classList.toggle('hidden', !willOpen);
  btn?.setAttribute('aria-expanded', String(willOpen));
}

function closeAdjustMenu() {
  document.getElementById('adjust-menu-list')?.classList.add('hidden');
  document.getElementById('btn-adjust')?.setAttribute('aria-expanded', 'false');
}

function toggleSaveMenu() {
  const list = document.getElementById('save-menu-list');
  const btn = document.getElementById('btn-save');
  if (!list) return;
  const willOpen = list.classList.contains('hidden');
  list.classList.toggle('hidden', !willOpen);
  btn?.setAttribute('aria-expanded', String(willOpen));
}

function closeSaveMenu() {
  document.getElementById('save-menu-list')?.classList.add('hidden');
  document.getElementById('btn-save')?.setAttribute('aria-expanded', 'false');
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
  document.querySelectorAll('.tool-btn').forEach(b => {
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
  state.doMagicWand = (ctx, x, y) => {
    const opts = state.toolOptions.magicWand || {};
    return floodSelect(ctx, x, y, opts.tolerance ?? 30, opts.contiguous !== false);
  };
  state.scanlineFill = scanlineFill;
  state.showTextInput = showTextInput;
  state.sprayDot = doSprayDot;
  state.applySelectionWithMask = applySelectionWithMask;
  state.selectionModeFor = selectionModeFor;

  // Toolbar
  buildToolbar(TOOLS, state, document.getElementById('tool-buttons'), id => {
    if (state.sel.mode !== 'none' && id !== 'rectSelect' && id !== 'lasso' && id !== 'magicWand') {
      commitSelection();
    }
    commitTextInput();
    setActiveTool(id);
  });

  // Initial tool-options panel for the default tool
  refreshToolOptions();

  // Palette
  buildPalette(state, document.getElementById('palette-bar'),
    color => {
      state.color = color; state.activeColor = color;
      addToColorHistory(color);
    },
    color => { state.bgColor = color; },
  );

  // Eyedropper callbacks
  state.onColorChange = color => {
    state.activeColor = color;
    updateFgSwatch(color);
    addToColorHistory(color);
  };
  state.onBgColorChange = color => {
    const el = document.getElementById('bg-swatch');
    if (el) el.style.background = color;
    const inp = document.getElementById('bg-color-input');
    if (inp) inp.value = color;
  };

  // Canvas pointer events
  overlayCanvas.addEventListener('pointerdown', onPointerDown);
  overlayCanvas.addEventListener('pointermove', onPointerMove);
  overlayCanvas.addEventListener('pointerup', onPointerUp);
  overlayCanvas.addEventListener('pointerleave', e => {
    if (state.panning) { state.panning = false; overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair'; }
    if (state.drawing) onPointerUp(e);
  });
  overlayCanvas.addEventListener('contextmenu', e => e.preventDefault());

  // Zoom via scroll wheel
  document.getElementById('canvas-area').addEventListener('wheel', e => {
    e.preventDefault();
    zoomToward(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

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
    state.zoom = 1; state.panX = 0; state.panY = 0; updateTransform();
  });

  // Action buttons
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-clear').addEventListener('click', clearCanvas);

  // Save dropdown — bare click saves PNG; caret opens menu with PNG/JPEG/Project
  document.getElementById('btn-save')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleSaveMenu();
  });
  document.addEventListener('click', e => {
    const wrap = document.getElementById('save-menu-wrap');
    if (wrap && !wrap.contains(e.target)) closeSaveMenu();
  });
  document.querySelectorAll('#save-menu-list [data-save]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSaveMenu();
      const kind = btn.dataset.save;
      if (kind === 'png') savePNG();
      else if (kind === 'jpeg') saveJPEG();
      else if (kind === 'project') saveProject();
    });
  });
  document.getElementById('btn-resize')?.addEventListener('click', openResizeModal);
  document.getElementById('resize-ok')?.addEventListener('click', confirmResize);
  document.getElementById('resize-cancel')?.addEventListener('click', closeResizeModal);

  // Adjust menu
  buildAdjustMenu();
  document.getElementById('btn-adjust')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleAdjustMenu();
  });
  document.addEventListener('click', e => {
    const wrap = document.getElementById('adjust-menu-wrap');
    if (wrap && !wrap.contains(e.target)) closeAdjustMenu();
  });
  document.getElementById('adjust-ok')?.addEventListener('click', commitAdjust);
  document.getElementById('adjust-cancel')?.addEventListener('click', cancelAdjust);

  // Upload (images and .paintproj projects)
  const uploadInput = document.getElementById('upload-input');
  uploadInput?.addEventListener('change', e => {
    if (e.target.files[0]) { loadAnyFile(e.target.files[0]); e.target.value = ''; }
  });
  document.getElementById('btn-upload')?.addEventListener('click', () => uploadInput?.click());

  // Drag-drop onto canvas
  const area = document.getElementById('canvas-area');
  area.addEventListener('dragover', e => e.preventDefault());
  area.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadAnyFile(file);
  });

  // Text input
  const textInput = document.getElementById('text-input');
  textInput?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { textInput.style.display = 'none'; textInput.value = ''; e.preventDefault(); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextInput(); }
  });
  textInput?.addEventListener('blur', commitTextInput);

  // Accordion panel section toggles
  document.querySelectorAll('.panel-section-header').forEach(header => {
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
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }

    if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); copySelection(activeCtx(), false); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') { e.preventDefault(); copySelection(activeCtx(), true); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); pasteClipboard(activeCtx()); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'a') { e.preventDefault(); selectAll(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'd') { e.preventDefault(); commitSelection(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault(); invertSelection(); return;
    }

    if (e.key === 'Escape') { commitSelection(); commitTextInput(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
      e.preventDefault(); deleteSelection(activeCtx()); return;
    }

    if (inInput) return;

    if (e.code === 'Space' && !state.spaceDown) {
      state.spaceDown = true;
      overlayCanvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }

    const shortcuts = {
      p: 'pencil', b: 'brush', e: 'eraser', s: 'spray', f: 'fill',
      i: 'eyedropper', t: 'text', l: 'line', r: 'rect', o: 'ellipse',
      m: 'rectSelect', g: 'lasso', w: 'magicWand',
    };
    const toolId = shortcuts[e.key.toLowerCase()];
    if (toolId) {
      commitTextInput();
      if (state.sel.mode !== 'none' && !['rectSelect','lasso','magicWand'].includes(toolId)) commitSelection();
      setActiveTool(toolId);
      return;
    }

    if ((e.key === '+' || e.key === '=') && !e.ctrlKey) {
      const a = document.getElementById('canvas-area'), r = a.getBoundingClientRect();
      zoomToward(r.left + r.width / 2, r.top + r.height / 2, 1.25);
    }
    if (e.key === '-' && !e.ctrlKey) {
      const a = document.getElementById('canvas-area'), r = a.getBoundingClientRect();
      zoomToward(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25);
    }
    if (e.key === '0' && !e.ctrlKey) {
      state.zoom = 1; state.panX = 0; state.panY = 0; updateTransform();
    }
  });

  document.addEventListener('keyup', e => {
    if (e.code === 'Space' && state.spaceDown) {
      state.spaceDown = false;
      if (!state.panning) {
        overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
      }
    }
  });

  updateUndoButtons();
  initPanelResize();
  requestAnimationFrame(rafLoop);
  updateTransform();
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
  const ageStr = ageMin < 1 ? 'less than a minute ago' :
                 ageMin === 1 ? '1 minute ago' :
                 ageMin < 60 ? `${ageMin} minutes ago` :
                 `${Math.round(ageMin / 60)} hour(s) ago`;
  if (confirm(`Restore your previous Paint session from ${ageStr}?`)) {
    loadProjectData(auto.data).catch(err => alert('Restore failed: ' + err.message));
  } else {
    clearAutosave();
  }
}

document.addEventListener('DOMContentLoaded', init);
