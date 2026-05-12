import { TOOLS, floodSelect, scanlineFill } from './tools.js';
import { buildToolbar, buildPalette, updateFgSwatch, updateStatus, updateColorHistory } from './ui.js';
import { createLayer, insertLayerBefore, removeLayerFromDOM, syncLayerDOM,
         flattenToCanvas, renderLayerPanel, refreshLayerThumbs } from './layers.js';
import { renderHistoryPanel as buildHistoryPanel } from './history.js';

const MAX_UNDO = 50;

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  tool: 'pencil',
  color: '#000000',
  bgColor: '#ffffff',
  activeColor: '#000000',
  brushSize: 4,
  shapeFill: false,
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
const ov = overlayCanvas.getContext('2d');
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

  // Draw dashed selection border
  ov.save();
  ov.strokeStyle = '#fff';
  ov.lineWidth = 1;
  ov.setLineDash([4, 4]);
  ov.lineDashOffset = -dashOffset;

  if (sel.lassoPoly && (sel.mode === 'active')) {
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
    tmp.getContext('2d').putImageData(data, 0, 0);
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

function showTextInput(ctx, canvasX, canvasY) {
  const area = document.getElementById('canvas-area');
  const areaRect = area.getBoundingClientRect();
  const stackRect = overlayCanvas.getBoundingClientRect();

  // Position in screen space (where the canvas pixel is displayed)
  const screenX = stackRect.left - areaRect.left + canvasX * state.zoom;
  const screenY = stackRect.top - areaRect.top + canvasY * state.zoom;

  const input = document.getElementById('text-input');
  input.style.left = screenX + 'px';
  input.style.top = screenY + 'px';
  input.style.fontSize = Math.max(12, state.brushSize * 4 * state.zoom) + 'px';
  input.style.color = state.activeColor;
  input.value = '';
  input.style.display = 'block';
  input.dataset.canvasX = canvasX;
  input.dataset.canvasY = canvasY;
  input.dataset.layerId = activeLayer().id;
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
    const layer = state.layers.find(l => l.id === layerId);
    if (layer) {
      pushUndo('Text');
      layer.ctx.font = `${state.brushSize * 4}px sans-serif`;
      layer.ctx.fillStyle = state.activeColor;
      layer.ctx.globalAlpha = 1;
      layer.ctx.globalCompositeOperation = 'source-over';
      layer.ctx.fillText(text, canvasX, canvasY + state.brushSize * 4);
    }
  }
  input.style.display = 'none';
  input.value = '';
}

// ── Spray helper ─────────────────────────────────────────────────────────────

function doSprayDot(x, y) {
  const ctx = activeCtx();
  const radius = state.brushSize * 5;
  const density = Math.ceil(radius * 0.8);
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
  // Middle mouse = pan
  if (e.button === 1) {
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

  const { x, y } = getCanvasCoords(e);
  const tool = TOOLS[state.tool];

  if (UNDOABLE_ON_DOWN.has(state.tool)) pushUndo(TOOLS[state.tool].label);

  // Commit open text input before any canvas action
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
  const { x, y } = getCanvasCoords(e);
  updateStatus(x, y);
  if (state.tool === 'spray') { state.sprayX = x; state.sprayY = y; }
  if (!state.drawing && state.sel.mode !== 'moving') return;
  TOOLS[state.tool].onMove(activeCtx(), ov, state, x, y);
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

function saveCanvas() {
  const flat = flattenToCanvas(state.layers, state.bgColor, canvasW(), canvasH());
  const link = document.createElement('a');
  link.download = 'paint.png';
  link.href = flat.toDataURL('image/png');
  link.click();
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

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  initCanvas();

  // Inject state callbacks used by tools
  state.commitSelection = commitSelection;
  state.doMagicWand = (ctx, x, y) => floodSelect(ctx, x, y, 30);
  state.scanlineFill = scanlineFill;
  state.showTextInput = showTextInput;
  state.sprayDot = doSprayDot;

  // Toolbar
  buildToolbar(TOOLS, state, document.getElementById('tool-buttons'), id => {
    if (state.sel.mode !== 'none' && id !== 'rectSelect' && id !== 'lasso' && id !== 'magicWand') {
      commitSelection();
    }
    commitTextInput();
    state.tool = id;
    overlayCanvas.style.cursor = TOOLS[id].cursor;
  });

  // Shape fill checkbox
  document.getElementById('shape-fill').addEventListener('change', e => {
    state.shapeFill = e.target.checked;
  });

  // Brush size
  const sizeSlider = document.getElementById('brush-size');
  const sizeDisplay = document.getElementById('size-display');
  sizeSlider.value = state.brushSize;
  sizeDisplay.textContent = state.brushSize;
  sizeSlider.addEventListener('input', e => {
    state.brushSize = parseInt(e.target.value, 10);
    sizeDisplay.textContent = state.brushSize;
  });

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
  document.getElementById('btn-save').addEventListener('click', saveCanvas);
  document.getElementById('btn-resize')?.addEventListener('click', openResizeModal);
  document.getElementById('resize-ok')?.addEventListener('click', confirmResize);
  document.getElementById('resize-cancel')?.addEventListener('click', closeResizeModal);

  // Upload
  const uploadInput = document.getElementById('upload-input');
  uploadInput?.addEventListener('change', e => {
    if (e.target.files[0]) { loadImageFile(e.target.files[0]); e.target.value = ''; }
  });
  document.getElementById('btn-upload')?.addEventListener('click', () => uploadInput?.click());

  // Drag-drop onto canvas
  const area = document.getElementById('canvas-area');
  area.addEventListener('dragover', e => e.preventDefault());
  area.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) loadImageFile(file);
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

    if (e.key === 'Escape') { commitSelection(); commitTextInput(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace' && !inInput) {
      e.preventDefault(); deleteSelection(activeCtx()); return;
    }

    if (inInput) return;

    const shortcuts = {
      p: 'pencil', b: 'brush', e: 'eraser', s: 'spray', f: 'fill',
      i: 'eyedropper', t: 'text', l: 'line', r: 'rect', o: 'ellipse',
      m: 'rectSelect', g: 'lasso', w: 'magicWand',
    };
    const toolId = shortcuts[e.key.toLowerCase()];
    if (toolId) {
      commitTextInput();
      if (state.sel.mode !== 'none' && !['rectSelect','lasso','magicWand'].includes(toolId)) commitSelection();
      state.tool = toolId;
      overlayCanvas.style.cursor = TOOLS[toolId].cursor;
      document.querySelectorAll('.tool-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === toolId);
      });
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

  updateUndoButtons();
  initPanelResize();
  requestAnimationFrame(rafLoop);
  updateTransform();
}

document.addEventListener('DOMContentLoaded', init);
