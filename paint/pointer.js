// Paint — pointer-event controller and the in-canvas text-input helper.
// Owns the down/move/up handlers, the text-tool floating input,
// and pen-pressure sniffing. The active-tool plumbing still lives in paint.js;
// this module just dispatches the live pointer events into the active tool.

import { TOOLS } from './tools.js';
import { updateStatus } from './ui.js';
import { updateMove, endMove, isInsideSelection } from './selection.js';
import { hitTestHandle, handleCursor, objectsBounds } from './objects.js';
import { maskGrayHex } from './layer-mask.js';
import { groupToolRefusal } from './layer-groups.js';
import { smartToolRefusal } from './smart-objects.js';
import { typeNeedsRasterize } from './type-layers.js';
import { shapeNeedsRasterize } from './shapes.js';
import { keepsAlphaFor, lockToolRefusal, preserveAlpha } from './layer-locks.js';
import {
  applyView,
  rotateViewAngle,
  viewOf,
  viewPivot,
  viewToDoc,
  zoomToRect
} from './view.js';
import { snapDragPoint } from './snap.js';

const UNDOABLE_ON_DOWN = new Set(['pencil', 'brush', 'eraser', 'fill']);
const DRAG_STROKE_TOOLS = new Set([
  'pencil',
  'brush',
  'mixerBrush',
  'colorReplacement',
  'eraser',
  'backgroundEraser',
  'rect',
  'ellipse',
  'triangle',
  'polygon',
  'line',
  'customShape',
  'gradient',
  'cloneStamp',
  'patternStamp',
  'healingBrush',
  'spotHealing',
  'historyBrush',
  'dodge',
  'burn',
  'sponge',
  'blur',
  'sharpen',
  'smudge'
]);
const SELECTION_TOOLS = new Set([
  'rectSelect',
  'ellipseSelect',
  'singleRowMarquee',
  'singleColumnMarquee',
  'lasso',
  'polyLasso',
  'magneticLasso',
  'quickSelection',
  'magicWand',
  'patch'
]);

/**
 * True when a pointer-down from another button lands mid drag stroke. The press
 * is dropped so the stroke is neither cancelled nor restarted.
 * @param {{ drawing?: boolean, tool: string, strokeButton?: number | null }} state
 * @param {number} button
 */
export function ignoresChordedPress(state, button) {
  return (
    !!state.drawing &&
    DRAG_STROKE_TOOLS.has(state.tool) &&
    state.strokeButton != null &&
    button !== state.strokeButton
  );
}

function statusSizeFor(state) {
  const drag = state.objectDrag;
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
 *   toView: (clientX: number, clientY: number) => number[],
 *   areaSize: () => number[],
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
    refreshLayerPanel,
    toView,
    areaSize
  } = deps;

  function getCanvasCoords(e) {
    // A turned or mirrored view: invert the view transform (the bounding box no longer maps).
    if (state.viewRotation || state.viewFlip) {
      const [x, y] = viewToDoc(viewOf(state), W(), H(), ...toView(e.clientX, e.clientY));
      return { x, y };
    }
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  // The pointer under View › Snap (state.snapDrag, set up by paint.js beginSnap / retargetSnap).
  // Holding Ctrl during a drag turns snapping off for it (snap_ui.rs override_held).
  function snapped(e, x, y) {
    if (!state.snapDrag) return { x, y };
    const r = snapDragPoint(state.snapDrag, x, y, e.ctrlKey && !e.metaKey);
    state.onSnapLines?.(r.smart ?? []);
    return r;
  }

  function endSnap() {
    if (!state.snapDrag) return;
    state.snapDrag = null;
    state.onSnapLines?.([]);
  }

  // Real pen pressure for stylus, neutral 1.0 for mouse/touch.
  function pressureFor(e) {
    if (e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0) {
      return e.pressure;
    }
    return 1;
  }

  // The Type tool's text box: paint.js beginType places it; Enter, a click elsewhere, or the
  // options bar's commit hands its text to commitType (or a legacy text object's editor).
  function commitTextInput() {
    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('text-input'));
    if (!input || input.style.display === 'none') return;
    const text = input.value.replace(/\s+$/, '');
    const editingId = input.dataset.editingObjectId
      ? parseInt(input.dataset.editingObjectId, 10)
      : null;
    const opts = state.toolOptions.text || {};

    input.style.display = 'none';
    input.value = '';

    if (editingId != null && !Number.isNaN(editingId)) {
      const size = opts.size ?? 16;
      const family = opts.family ?? 'sans-serif';
      state.commitTextObjectEdit?.(editingId, text.trim(), {
        fontSpec: `${opts.italic ? 'italic ' : ''}${opts.bold ? 'bold ' : ''}${size}px ${family}`,
        fontSize: size,
        color: opts.color ?? state.color,
        family,
        bold: !!opts.bold,
        italic: !!opts.italic
      });
      delete input.dataset.editingObjectId;
      return;
    }
    state.commitType?.(text);
  }

  // The Zoom tool's rectangle, in client pixels (PhotoCraft draws it as marching ants).
  let zoomMarquee = null;
  function showZoomMarquee(drag) {
    if (!zoomMarquee) {
      zoomMarquee = document.createElement('div');
      zoomMarquee.className = 'zoom-marquee';
      document.body.appendChild(zoomMarquee);
    }
    const [x0, y0] = drag.client;
    const [x1, y1] = drag.clientTo;
    Object.assign(zoomMarquee.style, {
      left: Math.min(x0, x1) + 'px',
      top: Math.min(y0, y1) + 'px',
      width: Math.abs(x1 - x0) + 'px',
      height: Math.abs(y1 - y0) + 'px'
    });
  }
  function hideZoomMarquee() {
    zoomMarquee?.remove();
    zoomMarquee = null;
  }

  // Hand, Zoom, and Rotate View work in view points; true when the press was theirs.
  function viewToolDown(e) {
    if (state.tool !== 'zoom' && state.tool !== 'rotateView') return false;
    const at = toView(e.clientX, e.clientY);
    if (state.tool === 'zoom') {
      state.zoomDrag = { from: at, to: at, client: [e.clientX, e.clientY], out: e.altKey };
      state.zoomDrag.clientTo = state.zoomDrag.client;
    } else {
      state.rotateDrag = { from: at, start: state.viewRotation || 0 };
      overlayCanvas.style.cursor = 'grabbing';
    }
    e.preventDefault();
    overlayCanvas.setPointerCapture(e.pointerId);
    return true;
  }

  function viewToolMove(e) {
    if (state.zoomDrag) {
      state.zoomDrag.to = toView(e.clientX, e.clientY);
      state.zoomDrag.clientTo = [e.clientX, e.clientY];
      state.zoomDrag.out = e.altKey;
      showZoomMarquee(state.zoomDrag);
      return true;
    }
    if (state.rotateDrag) {
      const d = state.rotateDrag;
      const pivot = viewPivot(viewOf(state), W(), H());
      const to = toView(e.clientX, e.clientY);
      state.viewRotation = rotateViewAngle(d.start, pivot, d.from, to, e.shiftKey);
      updateTransform();
      return true;
    }
    return false;
  }

  function viewToolUp() {
    if (state.zoomDrag) {
      const d = state.zoomDrag;
      state.zoomDrag = null;
      hideZoomMarquee();
      const [aw, ah] = areaSize();
      applyView(state, zoomToRect(viewOf(state), W(), H(), d.from, d.to, aw, ah, d.out));
      updateTransform();
      return true;
    }
    if (state.rotateDrag) {
      state.rotateDrag = null;
      overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
      return true;
    }
    return false;
  }

  function onPointerDown(e) {
    // Middle mouse, spacebar held, or the Hand tool = pan.
    const hand = state.tool === 'hand' && e.button === 0;
    if (e.button === 1 || (state.spaceDown && e.button === 0) || hand) {
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

    // A second button during a drag stroke is ignored; the stroke keeps going
    // and finishes on release (PhotoCraft has no opposite-button cancel).
    if (ignoresChordedPress(state, e.button)) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    overlayCanvas.setPointerCapture(e.pointerId);

    if (state.blurGallery) {
      const { x, y } = getCanvasCoords(e);
      state.blurGalleryPointer?.('down', x, y);
      return;
    }

    if (state.liquify) {
      const { x, y } = getCanvasCoords(e);
      state.liquifyPointer?.('down', x, y, pressureFor(e));
      return;
    }

    if (e.button === 0 && viewToolDown(e)) return;

    if (state.freeTransform) {
      const raw = getCanvasCoords(e);
      state.beginSnap?.(raw.x, raw.y);
      const { x, y } = snapped(e, raw.x, raw.y);
      state.freeTransformPointer?.('down', x, y, e.shiftKey, {
        ctrl: e.ctrlKey || e.metaKey,
        alt: e.altKey
      });
      return;
    }

    const isRight = e.button === 2;
    state.activeColor = isRight ? state.bgColor : state.color;
    if (state.pickColor) state.activeColor = state.pickColor(state.activeColor);
    // Painting a layer mask writes the color's luminance.
    if (state.editingMask?.()) state.activeColor = maskGrayHex(state.activeColor);
    state.pressure = pressureFor(e);
    state.shiftKey = e.shiftKey;
    state.altKey = e.altKey;
    // On Mac, Ctrl-click is a right-click — only treat ctrl/meta as a selection
    // modifier on a real left-click, otherwise color-picking with right-click
    // would also subtract from the selection.
    state.ctrlKey = !isRight && (e.ctrlKey || e.metaKey);
    state.strokeButton = e.button;

    const raw = getCanvasCoords(e);
    state.beginSnap?.(raw.x, raw.y);
    const { x, y } = snapped(e, raw.x, raw.y);
    const tool = TOOLS[state.tool];
    // A group has no pixels: painting tools refuse it (layer-groups.js groupToolRefusal).
    const layer = state.layers?.[state.activeLayerIdx];
    const maskEdit = !!state.editingMask?.();
    // Locked pixels refuse painting tools too (layer-locks.js); a mask edit ignores the locks.
    const refusal =
      groupToolRefusal(layer, state.tool, tool.label) ??
      (maskEdit
        ? null
        : smartToolRefusal(layer, state.tool, tool.label) ??
          lockToolRefusal(state.layers, layer, state.tool, tool.label));
    if (refusal) {
      state.showStatusMessage?.(refusal);
      return;
    }
    // Painting a type layer's pixels asks to rasterize it first (PhotoCraft rasterize_prompt.rs).
    if (!maskEdit && typeNeedsRasterize(layer, state.tool)) {
      state.drawing = false;
      state.askRasterizeType?.();
      return;
    }
    if (!maskEdit && shapeNeedsRasterize(layer, state.tool)) {
      state.drawing = false;
      state.askRasterizeShape?.();
      return;
    }

    if (UNDOABLE_ON_DOWN.has(state.tool)) pushUndo(TOOLS[state.tool].label);

    commitTextInput();

    // Lock Transparent Pixels: the stroke paints as usual and its alpha is put back at the end.
    state.alphaLock =
      !maskEdit && keepsAlphaFor(state.layers, layer, state.tool)
        ? { ctx: activeCtx(), before: activeCtx().getImageData(0, 0, W(), H()).data }
        : null;
    tool.onDown(activeCtx(), ov, state, x, y, isRight);
    // A press that started a move snaps the moving box instead of the pointer.
    if (state.drawing || state.sel.mode === 'moving') state.retargetSnap?.(x, y);
    else endSnap();
    if (!state.drawing) finishAlphaLock();
    if (state.editingMask?.()) state.pullMaskEdit?.();
    window.heymingAchievements?.unlockForCurrentApp('first-action');
  }

  function onPointerMove(e) {
    if (state.panning) {
      state.panX = state.panStartX + (e.clientX - state.panStartClientX);
      state.panY = state.panStartY + (e.clientY - state.panStartClientY);
      updateTransform();
      return;
    }
    if (viewToolMove(e)) return;
    state.pressure = pressureFor(e);
    state.shiftKey = e.shiftKey;
    state.altKey = e.altKey;
    state.ctrlKey = e.ctrlKey || e.metaKey;
    const raw = getCanvasCoords(e);
    state.onCanvasHover?.(raw.x, raw.y);
    const { x, y } = snapped(e, raw.x, raw.y);
    updateStatus(x, y, statusSizeFor(state));

    if (state.blurGallery) {
      state.blurGalleryPointer?.('move', x, y);
      return;
    }
    if (state.liquify) {
      state.liquifyPointer?.('move', x, y, pressureFor(e));
      return;
    }
    if (state.freeTransform) {
      state.freeTransformPointer?.('move', x, y, e.shiftKey, {
        ctrl: e.ctrlKey || e.metaKey,
        alt: e.altKey
      });
      state.scheduleComposite?.();
      return;
    }

    // Global floating-selection move (works from any selection tool)
    if (state.sel.mode === 'moving') {
      updateMove(state, activeCtx(), x, y);
      updateStatus(x, y, statusSizeFor(state));
      state.scheduleComposite?.();
      return;
    }

    // Move tool: resize cursor over the selected object's handles, move elsewhere
    if (!state.drawing && state.tool === 'select') {
      const selected =
        state.selectedObjectIds?.length === 1 && state.selectedObjectId != null
          ? state.objects.find((o) => o.id === state.selectedObjectId)
          : null;
      const handle = selected ? hitTestHandle(selected, x, y, state.zoom) : null;
      overlayCanvas.style.cursor = handle ? handleCursor(handle) : 'move';
    } else if (!state.drawing && state.tool === 'crop') {
      overlayCanvas.style.cursor = TOOLS.crop.cursorAt(state, x, y);
    } else if (!state.drawing && state.sel.mode === 'active' && SELECTION_TOOLS.has(state.tool)) {
      const inside = isInsideSelection(state.sel, x, y, overlayCanvas.width);
      overlayCanvas.style.cursor = inside ? 'move' : 'crosshair';
    }

    if (!state.drawing) return;
    TOOLS[state.tool].onMove(activeCtx(), ov, state, x, y);
    if (state.editingMask?.()) state.scheduleMaskPull?.();
    // Under an adjustment layer the stack shows one composite; redraw it (paint.js).
    state.scheduleComposite?.();
    updateStatus(x, y, statusSizeFor(state));
  }

  function onPointerUp(e) {
    if (state.panning) {
      state.panning = false;
      overlayCanvas.style.cursor = TOOLS[state.tool]?.cursor ?? 'crosshair';
      return;
    }
    if (viewToolUp()) return;
    if (state.blurGallery) {
      state.blurGalleryPointer?.('up', 0, 0);
      return;
    }
    if (state.liquify) {
      state.liquifyPointer?.('up', 0, 0);
      return;
    }
    if (state.freeTransform) {
      endSnap();
      state.freeTransformPointer?.('up', 0, 0, false);
      return;
    }
    if (state.sel.mode === 'moving') {
      endSnap();
      endMove(state, activeCtx());
      refreshLayerPanel();
      return;
    }
    if (!state.drawing) {
      endSnap();
      return;
    }
    const raw = getCanvasCoords(e);
    const { x, y } = snapped(e, raw.x, raw.y);
    endSnap();
    const tool = TOOLS[state.tool];

    tool.onUp(activeCtx(), ov, state, x, y);
    if (!state.drawing) finishAlphaLock();
    refreshLayerPanel();
  }

  const W = () => overlayCanvas.width;
  const H = () => overlayCanvas.height;

  function finishAlphaLock() {
    const lock = state.alphaLock;
    if (!lock) return;
    state.alphaLock = null;
    const img = lock.ctx.getImageData(0, 0, W(), H());
    preserveAlpha(lock.before, img.data);
    lock.ctx.putImageData(img, 0, 0);
    state.scheduleComposite?.();
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    commitTextInput
  };
}
