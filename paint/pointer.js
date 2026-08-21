// Paint — pointer-event controller and the in-canvas text-input helper.
// Owns the down/move/up handlers, the spray timer, the text-tool floating input,
// and pen-pressure sniffing. The active-tool plumbing still lives in paint.js;
// this module just dispatches the live pointer events into the active tool.

import { TOOLS } from './tools.js';
import { updateStatus } from './ui.js';
import { updateMove, endMove, isInsideSelection } from './selection.js';
import { hitTestHandle, handleCursor, objectsBounds } from './objects.js';

const UNDOABLE_ON_DOWN = new Set(['pencil', 'brush', 'eraser', 'fill', 'spray']);
const UNDOABLE_ON_UP = new Set(['line', 'rect', 'ellipse']);
const SELECTION_TOOLS = new Set(['rectSelect', 'lasso', 'magicWand']);

function statusSizeFor(state) {
  const drag = state.objectDrag;
  if (drag?.mode === 'marquee') {
    const w = Math.abs((drag.x ?? drag.startX) - drag.startX);
    const h = Math.abs((drag.y ?? drag.startY) - drag.startY);
    if (w >= 1 && h >= 1) return { w, h };
  }
  if (drag?.mode === 'resize') {
    const obj = state.objects?.find((o) => o.id === drag.id);
    if (obj && obj.w >= 1 && obj.h >= 1) return { w: obj.w, h: obj.h };
  }
  if (drag?.mode === 'move' && drag.ids?.length) {
    const moved = drag.ids.map((id) => state.objects?.find((o) => o.id === id)).filter(Boolean);
    const bounds = objectsBounds(moved);
    if (bounds) return { w: bounds.w, h: bounds.h };
  }
  if (state.selectedObjectIds?.length > 1) {
    const selected = state.selectedObjectIds
      .map((id) => state.objects?.find((o) => o.id === id))
      .filter(Boolean);
    const bounds = objectsBounds(selected);
    if (bounds) return { w: bounds.w, h: bounds.h };
  } else if (state.selectedObjectId != null) {
    const obj = state.objects?.find((o) => o.id === state.selectedObjectId);
    if (obj && obj.w >= 1 && obj.h >= 1) return { w: obj.w, h: obj.h };
  }
  const sel = state.sel;
  if (
    sel &&
    (sel.mode === 'drawing' || sel.mode === 'active' || sel.mode === 'moving') &&
    sel.w >= 1 &&
    sel.h >= 1
  ) {
    return { w: sel.w, h: sel.h };
  }
  return null;
}

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
  const {
    state,
    overlayCanvas,
    ov,
    activeCtx,
    activeLayer,
    pushUndo,
    updateTransform,
    refreshLayerPanel
  } = deps;

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

    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('text-input'));
    input.style.left = screenX + 'px';
    input.style.top = screenY + 'px';
    input.style.fontFamily = opts.family ?? 'sans-serif';
    input.style.fontSize = size * state.zoom + 'px';
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
    delete input.dataset.editingObjectId;
    input.focus();
  }

  function commitTextInput() {
    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('text-input'));
    if (!input || input.style.display === 'none') return;
    const text = input.value.trim();
    const editingId = input.dataset.editingObjectId
      ? parseInt(input.dataset.editingObjectId, 10)
      : null;
    const canvasX = parseFloat(input.dataset.canvasX);
    const canvasY = parseFloat(input.dataset.canvasY);
    const fontSpec = input.dataset.fontSpec || '16px sans-serif';
    const fontSize = parseFloat(input.dataset.fontSize) || 16;
    const opts = state.toolOptions.text || {};

    input.style.display = 'none';
    input.value = '';

    if (editingId != null && !Number.isNaN(editingId)) {
      state.commitTextObjectEdit?.(editingId, text, {
        fontSpec,
        fontSize,
        color: state.activeColor,
        family: opts.family ?? 'sans-serif',
        bold: !!opts.bold,
        italic: !!opts.italic
      });
      delete input.dataset.editingObjectId;
      return;
    }

    if (!text) return;
    state.placeTextObject?.({
      text,
      canvasX,
      canvasY,
      fontSpec,
      fontSize,
      color: state.activeColor,
      family: opts.family ?? 'sans-serif',
      bold: !!opts.bold,
      italic: !!opts.italic
    });
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

    // Opposite mouse button cancels an in-progress stroke (JS Paint)
    if (
      state.drawing &&
      ((state.strokeButton === 0 && e.button === 2) ||
        (state.strokeButton === 2 && e.button === 0)) &&
      state.cancelStroke?.()
    ) {
      e.preventDefault();
      return;
    }

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
    state.strokeButton = e.button;

    const { x, y } = getCanvasCoords(e);
    const tool = TOOLS[state.tool];

    if (UNDOABLE_ON_DOWN.has(state.tool)) pushUndo(TOOLS[state.tool].label);

    commitTextInput();

    tool.onDown(activeCtx(), ov, state, x, y, isRight);
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  }

  function onPointerMove(e) {
    if (state.panning) {
      state.panX = state.panStartX + (e.clientX - state.panStartClientX);
      state.panY = state.panStartY + (e.clientY - state.panStartClientY);
      updateTransform();
      return;
    }
    state.pressure = pressureFor(e);
    state.shiftKey = e.shiftKey;
    state.altKey = e.altKey;
    state.ctrlKey = e.ctrlKey || e.metaKey;
    const { x, y } = getCanvasCoords(e);
    updateStatus(x, y, statusSizeFor(state));
    if (state.tool === 'spray') {
      state.sprayX = x;
      state.sprayY = y;
    }

    // Global floating-selection move (works from any selection tool)
    if (state.sel.mode === 'moving') {
      updateMove(state, activeCtx(), x, y);
      updateStatus(x, y, statusSizeFor(state));
      return;
    }

    // Move / resize cursor when hovering selectable content
    if (!state.drawing && state.tool === 'select') {
      const selected =
        state.selectedObjectIds?.length === 1 && state.selectedObjectId != null
          ? state.objects.find((o) => o.id === state.selectedObjectId)
          : null;
      let cursor = 'default';
      if (selected) {
        const handle = hitTestHandle(selected, x, y, state.zoom);
        if (handle) cursor = handleCursor(handle);
      }
      if (cursor === 'default') {
        const hit = state.objects?.some(
          (o) => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h && !o._hiddenWhileEdit
        );
        cursor = hit ? 'move' : 'crosshair';
      }
      overlayCanvas.style.cursor = cursor;
    } else if (!state.drawing && state.sel.mode === 'active' && SELECTION_TOOLS.has(state.tool)) {
      const inside = isInsideSelection(state.sel, x, y, overlayCanvas.width);
      overlayCanvas.style.cursor = inside ? 'move' : 'crosshair';
    }

    if (!state.drawing) return;
    TOOLS[state.tool].onMove(activeCtx(), ov, state, x, y);
    updateStatus(x, y, statusSizeFor(state));
  }

  function onPointerUp(e) {
    if (state.panning) {
      state.panning = false;
      overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
      return;
    }
    if (state.sel.mode === 'moving') {
      endMove(state, activeCtx());
      refreshLayerPanel();
      return;
    }
    if (!state.drawing) return;
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
