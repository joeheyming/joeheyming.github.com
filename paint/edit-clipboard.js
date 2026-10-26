// Edit menu clipboard and history helpers (PhotoCraft crates/engine/src/edit_cmds.rs and
// extra_cmds.rs paste_into). Pure: paint.js does the pixels, layers, and undo.

import { newLayerMask } from './layer-mask.js';

/**
 * Edit › Toggle Last State (edit_cmds.rs toggle_last_state): redo when there is something to
 * redo, else undo. null when both stacks are empty.
 * @returns {'undo' | 'redo' | null}
 */
export function toggleLastStateDirection(undoStack, redoStack) {
  if (redoStack?.length) return 'redo';
  if (undoStack?.length) return 'undo';
  return null;
}

/** Run Toggle Last State on { undoStack, redoStack, undo(), redo() }; returns the direction. */
export function toggleLastState(history) {
  const dir = toggleLastStateDirection(history.undoStack, history.redoStack);
  if (dir === 'redo') history.redo();
  else if (dir === 'undo') history.undo();
  return dir;
}

// Rust f64::round: halves go away from zero.
function roundHalfAway(v) {
  return Math.sign(v) * Math.round(Math.abs(v));
}

// clamp_shift: move the span b0..b1 by d, changed as little as needed to stay inside c0..c1
// when it fits; a span longer than the canvas starts at c0.
function clampShift(d, b0, b1, c0, c1) {
  const start = b1 - b0 <= c1 - c0 ? Math.min(Math.max(b0 + d, c0), c1 - (b1 - b0)) : c0;
  return start - b0;
}

/**
 * How far a paste moves the clipboard pixels (edit_cmds.rs paste_offset). clip is the copied
 * box { x, y, w, h }, canvas { w, h }. In place (or a clip wholly on the canvas with no center)
 * stays put; otherwise the clip is centred on center ([x, y], default the canvas centre) and,
 * unless clamp is false (Paste Into / Outside), kept on the canvas.
 * @returns {{ dx: number, dy: number }}
 */
export function pasteOffset(clip, canvas, { center = null, inPlace = false, clamp = true } = {}) {
  const x1 = clip.x + clip.w,
    y1 = clip.y + clip.h;
  const onCanvas = clip.x >= 0 && clip.y >= 0 && x1 <= canvas.w && y1 <= canvas.h;
  if (inPlace || (onCanvas && !center)) return { dx: 0, dy: 0 };
  const [cx, cy] = center ?? [canvas.w / 2, canvas.h / 2];
  const dx = roundHalfAway(cx - (clip.x + x1) / 2);
  const dy = roundHalfAway(cy - (clip.y + y1) / 2);
  if (!clamp || clip.w <= 0 || clip.h <= 0) return { dx, dy };
  return {
    dx: clampShift(dx, clip.x, x1, 0, canvas.w),
    dy: clampShift(dy, clip.y, y1, 0, canvas.h)
  };
}

/**
 * The layer mask Paste Into gives the pasted layer: 255 inside the selection, 0 outside.
 * Paste Outside inverts it, so the paste shows everywhere but the selection.
 */
export function pasteIntoMask(selMask, W, H, outside) {
  return newLayerMask(outside ? 'hideSelection' : 'revealSelection', W, H, selMask);
}

/** The centre of a selection box { x, y, w, h }: where Paste Into centres the clipboard. */
export function selectionCenter(sel) {
  return [sel.x + sel.w / 2, sel.y + sel.h / 2];
}
