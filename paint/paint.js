import { TOOLS, TOOL_OPTION_SCHEMA, floodSelect, scanlineFill, defaultToolOptions } from './tools.js';
import { buildToolbar, buildPalette, updateFgSwatch, updateColorHistory,
         renderToolOptions } from './ui.js';
import { createLayer, insertLayerBefore, removeLayerFromDOM, syncLayerDOM,
         flattenToCanvas, renderLayerPanel } from './layers.js';
import { renderHistoryPanel as buildHistoryPanel } from './history.js';
import { deserializeProject, readProjectFile,
         scheduleAutosave, readAutosave, clearAutosave } from './project.js';
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
} from './selection.js';
import {
  openAdjust as doOpenAdjust,
  cancelAdjust,
  commitAdjust,
  buildAdjustMenu as doBuildAdjustMenu,
  toggleAdjustMenu,
  closeAdjustMenu,
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
} from './file-menu.js';
import { createPointerController } from './pointer.js';

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
// The actual implementations live in `./selection.js`. The wrappers below
// inject the shared `state`, the overlay context `ov`, and a couple of
// closures so the rest of paint.js can keep its no-arg call sites unchanged.

function commitSelection() { doCommitSelection(state, ov); }
function copySelection(ctx, cut) { doCopySelection(state, ov, ctx, cut, pushUndo); }
function pasteClipboard(ctx) { doPasteClipboard(state, ctx, pushUndo); }
function deleteSelection(ctx) { doDeleteSelection(state, ov, ctx, pushUndo); }
function applySelectionWithMask(newMask, W, H, mode) {
  doApplySelectionWithMask(state, newMask, W, H, mode);
}
function selectAll() { doSelectAll(state, ov, canvasW(), canvasH()); }
function invertSelection() { doInvertSelection(state, ov, canvasW(), canvasH()); }

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

// ── Color history ─────────────────────────────────────────────────────────────

function addToColorHistory(hex) {
  state.colorHistory = [hex, ...state.colorHistory.filter(c => c !== hex)].slice(0, 8);
  updateColorHistory(state.colorHistory, color => {
    state.color = color;
    state.activeColor = color;
    updateFgSwatch(color);
  });
}

// ── Pointer controller (lives in ./pointer.js) ───────────────────────────────

const pointer = createPointerController({
  state, overlayCanvas, ov, activeCtx, activeLayer,
  pushUndo, updateTransform,
  refreshLayerPanel: refreshLayerPanelUI,
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
  if (state.undoStack.length > 0 && !confirm('Start a new project? Unsaved changes will be lost.')) return;
  for (const l of state.layers) removeLayerFromDOM(l);
  state.layers = [];
  state.undoStack = [];
  state.redoStack = [];
  state.activeLayerIdx = 0;
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
  updateUndoButtons();
  refreshLayerPanelUI();
  renderHistoryPanel();
  clearAutosave();
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
// Modal lifecycle (open / preview / cancel / commit) and the action-menu
// open/close helpers live in `./adjust-modal.js`. paint.js owns the wiring
// to its own state + helpers via this thin wrapper layer.

function openAdjust(id) {
  doOpenAdjust(id, state, {
    activeCtx,
    pushUndo,
    onCommit: refreshLayerPanelUI,
  });
}

function buildAdjustMenu() { doBuildAdjustMenu(openAdjust); }

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
  state.showTextInput = pointer.showTextInput;
  state.sprayDot = pointer.doSprayDot;
  state.applySelectionWithMask = applySelectionWithMask;
  state.selectionModeFor = selectionModeFor;

  // Toolbar
  buildToolbar(TOOLS, state, document.getElementById('tool-buttons'), id => {
    if (state.sel.mode !== 'none' && id !== 'rectSelect' && id !== 'lasso' && id !== 'magicWand') {
      commitSelection();
    }
    pointer.commitTextInput();
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
  overlayCanvas.addEventListener('pointerdown', pointer.onPointerDown);
  overlayCanvas.addEventListener('pointermove', pointer.onPointerMove);
  overlayCanvas.addEventListener('pointerup', pointer.onPointerUp);
  overlayCanvas.addEventListener('pointerleave', e => {
    if (state.panning) { state.panning = false; overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair'; }
    if (state.drawing) pointer.onPointerUp(e);
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

  // File menu
  document.getElementById('btn-file')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleFileMenu();
  });
  document.addEventListener('click', e => {
    const wrap = document.getElementById('file-menu-wrap');
    if (wrap && !wrap.contains(e.target)) closeFileMenu();
  });
  const uploadInput = document.getElementById('upload-input');
  document.querySelectorAll('#file-menu-list [data-file]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeFileMenu();
      const kind = btn.dataset.file;
      if (kind === 'new') newProject();
      else if (kind === 'open-computer') uploadInput?.click();
      else if (kind === 'save-png') openFilenameModal('untitled.png', f => downloadPNG(f, state, canvasW(), canvasH()));
      else if (kind === 'save-jpeg') openFilenameModal('untitled.jpg', f => downloadJPEG(f, state, canvasW(), canvasH()));
      else if (kind === 'save-project') openFilenameModal('untitled.paintproj', f => downloadProjectFile(f, state, canvasW(), canvasH()));
    });
  });

  // Filename modal
  document.getElementById('filename-ok')?.addEventListener('click', confirmFilenameModal);
  document.getElementById('filename-cancel')?.addEventListener('click', closeFilenameModal);
  document.getElementById('filename-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); confirmFilenameModal(); }
    if (e.key === 'Escape') { e.preventDefault(); closeFilenameModal(); }
  });

  // Resize modal
  document.getElementById('btn-resize')?.addEventListener('click', () => openResizeModalUI(canvasW(), canvasH()));
  document.getElementById('resize-ok')?.addEventListener('click', () => confirmResizeUI(resizeStack));
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

  // File input change — triggered by "Open from Computer" in file menu
  uploadInput?.addEventListener('change', e => {
    if (e.target.files[0]) { loadAnyFile(e.target.files[0]); e.target.value = ''; }
  });

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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pointer.commitTextInput(); }
  });
  textInput?.addEventListener('blur', pointer.commitTextInput);

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

    if (e.key === 'Escape') { commitSelection(); pointer.commitTextInput(); return; }
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
      pointer.commitTextInput();
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
  startSelectionAnimation(state, ov);
  updateTransform();

  installOSBridge({
    state,
    getDims: () => ({ w: canvasW(), h: canvasH() }),
    activeCtx,
    pushUndo,
    refreshLayerPanel: refreshLayerPanelUI,
    closeFileMenu,
    loadProjectData,
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
