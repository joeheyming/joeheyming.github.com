// modules/interactions.js
//
// Shared pointer-event helpers for the overlay items (text boxes,
// stickers). Each helper attaches `pointerdown`/`move`/`up` listeners
// to a draggable element and reports back position/size/rotation
// changes to the caller, which then updates state.
//
// Positions are computed in stage-relative fractions (0..1), so the
// caller can apply them directly to state without knowing about
// display pixels.

/**
 * Make an element draggable inside a stage container.
 * Calls onDrag({ x, y }) on every pointermove (fractions of stage).
 */
export function makeDraggable(el, stageEl, getStart, onDrag, onEnd) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Allow nested handle elements to handle their own drags first.
    if (e.target.closest('.text-box-handle')) return;
    // Don't trap when user is editing text inside the contentEditable
    if (e.target.isContentEditable) return;

    e.preventDefault();
    el.setPointerCapture(e.pointerId);

    const stageRect = stageEl.getBoundingClientRect();
    const start = getStart(); // { x, y } as fractions
    const startPointer = {
      x: (e.clientX - stageRect.left) / stageRect.width,
      y: (e.clientY - stageRect.top) / stageRect.height
    };

    const onMove = (ev) => {
      const dx = (ev.clientX - stageRect.left) / stageRect.width - startPointer.x;
      const dy = (ev.clientY - stageRect.top) / stageRect.height - startPointer.y;
      onDrag({ x: start.x + dx, y: start.y + dy });
    };

    const onUp = (ev) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      onEnd?.();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}

/**
 * Make a resize handle that grows its parent box from the bottom-right corner.
 * Calls onResize({ w, h }) on every pointermove.
 */
export function makeResize(handle, stageEl, getStart, onResize, onEnd) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);

    const stageRect = stageEl.getBoundingClientRect();
    const start = getStart(); // { x, y, w, h }
    const startPointer = {
      x: (e.clientX - stageRect.left) / stageRect.width,
      y: (e.clientY - stageRect.top) / stageRect.height
    };

    const onMove = (ev) => {
      const px = (ev.clientX - stageRect.left) / stageRect.width;
      const py = (ev.clientY - stageRect.top) / stageRect.height;
      const w = Math.max(0.05, start.w + (px - startPointer.x));
      const h = Math.max(0.03, start.h + (py - startPointer.y));
      onResize({ w, h });
    };

    const onUp = (ev) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      onEnd?.();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

/**
 * Make a rotation handle that rotates its parent around its center.
 * Calls onRotate(degrees) on every pointermove.
 */
export function makeRotate(handle, parentEl, stageEl, onRotate, onEnd) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);

    // Compute parent center in viewport space ONCE at drag start. The
    // box's center doesn't change during rotation, so this is stable.
    const rect = parentEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const onMove = (ev) => {
      // atan2 returns radians measured counter-clockwise from +x axis.
      // We want clockwise degrees from straight-up, so adjust:
      const rad = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      const deg = (rad * 180) / Math.PI + 90; // +90 → 0deg points up
      onRotate(deg);
    };

    const onUp = (ev) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      onEnd?.();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}
