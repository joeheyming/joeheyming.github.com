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
 * fired exactly once per pointerdown, on pointerup, pointercancel, or
 * lostpointercapture. The release `target` is the last-entered target (or
 * null if the pointer was dragged off). Duplicate end events are ignored.
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

  // Pointers whose press has *committed* — their `play()` (or direct
  // `enter()` when there's no tap-vs-pan deferral) has already fired
  // and the host has been told the note is on. While at least one
  // pointer is in this state we suppress native scroll on touchmove
  // (see `handleTouchMove`) so a held-then-dragged finger can scrub
  // across targets without the browser hijacking the gesture for pan.
  // Lazy swipes (released before `tapDelayMs`, or moved off before
  // the timer fired) never enter this set and continue to scroll
  // natively as before.
  const committed = new Set();

  const commit = (ptrId) => {
    committed.add(ptrId);
  };

  const uncommit = (ptrId) => {
    committed.delete(ptrId);
  };

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
    uncommit(ptrId);
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
        play: () => {
          commit(ptrId);
          enter(target, ptrId, event);
        },
        release: () => {
          // The gesture committed to scroll *after* play already fired.
          // Treat it as a release with the last-entered target.
          releaseCurrent(ptrId, event);
        }
      });
    } else {
      // No tap-vs-pan deferral: every press commits immediately.
      // Pages that don't pass `deferScrollOnTouch` are typically the
      // ones without a scrolling ancestor (drums, harp, steeldrum), so
      // suppressing touchmove is a no-op there — but it costs us
      // nothing to keep the bookkeeping consistent.
      commit(event.pointerId);
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

  // Capture can drop without a paired pointerup/cancel (DOM rebuild,
  // another element steals capture, OS gesture takeover). Treat it the
  // same as cancel so held notes don't stick. Safe if pointerup already
  // ran — releaseCurrent is idempotent.
  const handleLostCapture = (event) => {
    if (scrollGesture) scrollGesture.cancel(event.pointerId);
    releaseCurrent(event.pointerId, event);
  };

  // Native-scroll suppression for committed pointers.
  //
  // The host instruments use `touch-action: pan-x` (piano keyboard) or
  // `pan-x pan-y` (Stradella / chromatic buttons) on the playable
  // elements so a *lazy* swipe scrolls the keyboard natively with
  // momentum — that's the QoL ask. The cost is that once a press has
  // committed (held > tapDelayMs), the moment the player drags
  // sideways to scrub across notes the browser interprets the same
  // motion as a pan and fires `pointercancel`, which cuts the held
  // note. The result on a phone: you can tap individual buttons fine,
  // but you can't drag from C-bass over to G-bass — the gesture
  // always gets hijacked into a scroll partway through.
  //
  // Fix: once any pointer is in committed state, preventDefault on
  // every touchmove. The browser stops trying to scroll, no
  // pointercancel arrives, and our pointermove keeps firing the
  // host's drag-cross logic. Pointers that *haven't* committed (the
  // press is still inside the tap-vs-pan window, or the user lifted
  // before the timer fired) bypass this entirely — touchmove is left
  // alone and the browser scrolls just like before.
  //
  // Listener has to be `passive: false` so we're allowed to
  // preventDefault. This must be set up at addEventListener time and
  // can't be flipped per-event, so we keep it always-on and gate the
  // preventDefault on `committed.size`.
  const handleTouchMove = (event) => {
    if (committed.size === 0) return;
    if (event.cancelable) event.preventDefault();
  };

  rootEl.addEventListener('pointerdown', handleDown);
  rootEl.addEventListener('pointermove', handleMove);
  rootEl.addEventListener('pointerup', handleUp);
  rootEl.addEventListener('pointercancel', handleCancel);
  rootEl.addEventListener('lostpointercapture', handleLostCapture);
  rootEl.addEventListener('touchmove', handleTouchMove, { passive: false });

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
      rootEl.removeEventListener('lostpointercapture', handleLostCapture);
      rootEl.removeEventListener('touchmove', handleTouchMove);
      // The scroll gesture has internal timers per pointerId; cancel them.
      if (scrollGesture) {
        for (const ptrId of Array.from(active.keys())) {
          scrollGesture.cancel(ptrId);
        }
      }
      active.clear();
      committed.clear();
    }
  };
}
