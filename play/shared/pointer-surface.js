/**
 * PointerSurface — pointer-id-keyed tracking over a set of targets, with
 * optional iOS scroll-gesture deferral.
 *
 * The same pattern was implemented six times in /play/ (Keyboard, Stradella,
 * chromatic, drums pads, guitar fretboard, harp strings, steeldrum tongues).
 * Pure mechanism, no semantics — adapters keep their own noteOn/noteOff/
 * pluck/strike vocabulary on top.
 *
 * Usage:
 *
 *   const surface = createPointerSurface(rootEl, {
 *     targetSelector: '.piano-key',
 *     onEnter:   (target, ptrId, event) => synth.noteOn(midiOf(target)),
 *     onLeave:   (target, ptrId, event) => synth.noteOff(midiOf(target)),
 *     onRelease: (target, ptrId, event) => { ... },   // last-entered target
 *     deferScrollOnTouch: true,                       // iOS pan-x integration
 *   });
 *   ...
 *   surface.destroy();   // unbinds all listeners
 *
 * Semantics covered by the three callbacks:
 *
 *   - sustain-on-press   (Keyboard, accordion buttons)
 *       onEnter → noteOn,  onLeave → noteOff,  onRelease → noteOff
 *   - strike-on-enter    (drums pads, steeldrum tongues)
 *       onEnter → strike,  onLeave → noop,     onRelease → noop
 *   - pluck-on-release   (harp strings)
 *       onEnter → noop,    onLeave → noop,     onRelease → pluck
 *   - cross-cell-drag    (guitar fretboard, glissando)
 *       onEnter → pluck,   onLeave → noop,     onRelease → noop
 *
 * `onLeave` is fired during drag (target changes mid-press). `onRelease` is
 * fired exactly once per pointerdown, on pointerup or pointercancel. The
 * release `target` is the last-entered target (or null if the pointer was
 * dragged off).
 *
 * `hitTest` defaults to `document.elementFromPoint(x, y)?.closest(selector)`.
 * Override it for circular / polar geometries (steeldrum tongues, future
 * theremin XY pad).
 */

import { createScrollGesture } from './scroll-gesture.js';

const noop = () => {};

export function createPointerSurface(rootEl, opts = {}) {
  if (!rootEl) throw new Error('createPointerSurface requires a root element');
  const targetSelector = opts.targetSelector;
  if (!targetSelector && !opts.hitTest) {
    throw new Error('createPointerSurface requires { targetSelector } or { hitTest }');
  }

  const onEnter = typeof opts.onEnter === 'function' ? opts.onEnter : noop;
  const onLeave = typeof opts.onLeave === 'function' ? opts.onLeave : noop;
  const onRelease = typeof opts.onRelease === 'function' ? opts.onRelease : noop;
  const preventDefaultOnDown = opts.preventDefaultOnDown !== false;

  const defaultHitTest = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    return el.closest(targetSelector);
  };
  const hitTest = typeof opts.hitTest === 'function' ? opts.hitTest : defaultHitTest;

  const findTargetFromEvent = (event) => {
    if (event.target && event.target.closest && targetSelector) {
      const direct = event.target.closest(targetSelector);
      if (direct) return direct;
    }
    return hitTest(event.clientX, event.clientY);
  };

  // pointerId -> last-entered target (or null when dragged off)
  const active = new Map();

  const scrollGesture = opts.deferScrollOnTouch
    ? createScrollGesture({ tapDelayMs: opts.tapDelayMs ?? 80 })
    : null;

  const enter = (target, ptrId, event) => {
    active.set(ptrId, target);
    if (target) onEnter(target, ptrId, event);
  };

  const leaveCurrent = (ptrId, event) => {
    const prev = active.get(ptrId);
    if (prev) onLeave(prev, ptrId, event);
    active.set(ptrId, null);
  };

  const releaseCurrent = (ptrId, event) => {
    if (!active.has(ptrId)) return;
    const last = active.get(ptrId);
    active.delete(ptrId);
    onRelease(last, ptrId, event);
  };

  const handleDown = (event) => {
    const target = findTargetFromEvent(event);
    if (!target) return;
    try {
      rootEl.setPointerCapture?.(event.pointerId);
    } catch (_) {
      /* ignore — pointer capture is a nice-to-have */
    }
    if (scrollGesture) {
      // Snapshot pointerId for the deferred callbacks; the event itself
      // is reused by the browser between handlers.
      const ptrId = event.pointerId;
      scrollGesture.start(event, {
        play: () => enter(target, ptrId, event),
        release: () => {
          // The gesture committed to scroll *after* play already fired.
          // Treat it as a release with the last-entered target.
          releaseCurrent(ptrId, event);
        }
      });
    } else {
      enter(target, event.pointerId, event);
    }
    if (preventDefaultOnDown && event.pointerType !== 'touch') event.preventDefault();
  };

  const handleMove = (event) => {
    if (!active.has(event.pointerId)) return;
    const next = hitTest(event.clientX, event.clientY);
    const prev = active.get(event.pointerId);
    if (next === prev) return;
    if (prev) onLeave(prev, event.pointerId, event);
    if (next) {
      onEnter(next, event.pointerId, event);
      active.set(event.pointerId, next);
    } else {
      active.set(event.pointerId, null);
    }
  };

  const handleUp = (event) => {
    if (scrollGesture) scrollGesture.end(event.pointerId);
    releaseCurrent(event.pointerId, event);
  };

  const handleCancel = (event) => {
    if (scrollGesture) scrollGesture.cancel(event.pointerId);
    releaseCurrent(event.pointerId, event);
  };

  rootEl.addEventListener('pointerdown', handleDown);
  rootEl.addEventListener('pointermove', handleMove);
  rootEl.addEventListener('pointerup', handleUp);
  rootEl.addEventListener('pointercancel', handleCancel);

  return {
    /** Force-release every active pointer (e.g. when the host re-renders). */
    releaseAll(event = null) {
      for (const ptrId of Array.from(active.keys())) {
        releaseCurrent(ptrId, event);
      }
    },
    /** Pointer-ids currently held over the surface (for inspection). */
    activePointerIds() {
      return Array.from(active.keys());
    },
    /** Remove all listeners. Call before discarding rootEl. */
    destroy() {
      rootEl.removeEventListener('pointerdown', handleDown);
      rootEl.removeEventListener('pointermove', handleMove);
      rootEl.removeEventListener('pointerup', handleUp);
      rootEl.removeEventListener('pointercancel', handleCancel);
      // The scroll gesture has internal timers per pointerId; cancel them.
      if (scrollGesture) {
        for (const ptrId of Array.from(active.keys())) {
          scrollGesture.cancel(ptrId);
        }
      }
      active.clear();
    }
  };
}
