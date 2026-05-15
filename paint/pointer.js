// Paint — pointer-event controller and the in-canvas text-input helper.
// Owns the down/move/up handlers, the spray timer, the text-tool floating input,
// and pen-pressure sniffing. The active-tool plumbing still lives in paint.js;
// this module just dispatches the live pointer events into the active tool.

import { TOOLS } from './tools.js';
import { updateStatus } from './ui.js';

const UNDOABLE_ON_DOWN = new Set(['pencil', 'brush', 'eraser', 'fill', 'spray']);
const UNDOABLE_ON_UP = new Set(['line', 'rect', 'ellipse']);

/**
 * @param {{
 *   state: any,
 *   overlayCanvas: HTMLCanvasElement,
 *   ov: CanvasRenderingContext2D,
 *   activeCtx: () => CanvasRenderingContext2D,
 *   activeLayer: () => any,
 *   pushUndo: (label?: string) => void,
 *   updateTransform: () => void,
 *   refreshLayerPanel: () => void,
 * }} deps
 */
export function createPointerController(deps) {
  const { state, overlayCanvas, ov, activeCtx, activeLayer, pushUndo, updateTransform, refreshLayerPanel } = deps;

  function getCanvasCoords(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  // Real pen pressure for stylus, neutral 1.0 for mouse/touch.
  function pressureFor(e) {
    if (e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0) {
      return e.pressure;
    }
    return 1;
  }

  function textFontSpec() {
    const opts = state.toolOptions.text || {};
    const sz = opts.size ?? 16;
    const fam = opts.family ?? 'sans-serif';
    const w = opts.bold ? 'bold ' : '';
    const i = opts.italic ? 'italic ' : '';
    return { spec: `${i}${w}${sz}px ${fam}`, size: sz };
  }

  function showTextInput(_ctx, canvasX, canvasY) {
    const area = document.getElementById('canvas-area');
    const areaRect = area.getBoundingClientRect();
    const stackRect = overlayCanvas.getBoundingClientRect();

    const screenX = stackRect.left - areaRect.left + canvasX * state.zoom;
    const screenY = stackRect.top - areaRect.top + canvasY * state.zoom;
    const { spec, size } = textFontSpec();
    const opts = state.toolOptions.text || {};

    const input = /** @type {HTMLInputElement} */ (document.getElementById('text-input'));
    input.style.left = screenX + 'px';
    input.style.top = screenY + 'px';
    input.style.fontFamily = opts.family ?? 'sans-serif';
    input.style.fontSize = (size * state.zoom) + 'px';
    input.style.fontWeight = opts.bold ? 'bold' : 'normal';
    input.style.fontStyle = opts.italic ? 'italic' : 'normal';
    input.style.color = state.activeColor;
    input.value = '';
    input.style.display = 'block';
    input.dataset.canvasX = String(canvasX);
    input.dataset.canvasY = String(canvasY);
    input.dataset.layerId = String(activeLayer().id);
    input.dataset.fontSpec = spec;
    input.dataset.fontSize = String(size);
    input.focus();
  }

  function commitTextInput() {
    const input = /** @type {HTMLInputElement} */ (document.getElementById('text-input'));
    if (!input || input.style.display === 'none') return;
    const text = input.value.trim();
    if (text) {
      const canvasX = parseFloat(input.dataset.canvasX);
      const canvasY = parseFloat(input.dataset.canvasY);
      const layerId = parseInt(input.dataset.layerId, 10);
      const fontSpec = input.dataset.fontSpec || '16px sans-serif';
      const fontSize = parseFloat(input.dataset.fontSize) || 16;
      const layer = state.layers.find((l) => l.id === layerId);
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

  function onPointerDown(e) {
    // Middle mouse OR spacebar held = pan.
    if (e.button === 1 || (state.spaceDown && e.button === 0)) {
      e.preventDefault();
      state.panning = true;
      state.panStartClientX = e.clientX;
      state.panStartClientY = e.clientY;
      state.panStartX = state.panX;
      state.panStartY = state.panY;
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
    if (state.tool === 'spray') {
      state.sprayX = x;
      state.sprayY = y;
    }
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
    refreshLayerPanel();
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    showTextInput,
    commitTextInput,
    doSprayDot
  };
}
