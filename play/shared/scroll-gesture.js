/**
 * Tap-vs-scroll gesture deferral for touch input on instrument surfaces.
 *
 * Pairs with `touch-action: pan-x` on the playable elements (keys / fret
 * cells / accordion buttons): the browser handles horizontal scroll
 * natively (so the user gets momentum + inertia for free), and we just
 * defer the press long enough that a swipe doesn't accidentally fire a
 * note before the browser commits to scrolling.
 *
 * Lifecycle:
 *   - On `pointerdown` for a touch pointer the host calls `start(event,
 *     { play, release })` instead of pressing the button directly. We
 *     schedule a `tapDelayMs` timer; when it fires (or pointerup arrives
 *     first — the "tap" case) we invoke `play()`. For mouse / pen the
 *     press runs synchronously inside `start()` — there's no tap-vs-pan
 *     ambiguity.
 *
 *   - When the browser commits to native horizontal scroll it sends
 *     `pointercancel`. The host calls `cancel(event.pointerId)`; we
 *     clear the pending timer (no play happens) and, if `play` already
 *     fired, call `release()` to undo it. Result: a clean swipe never
 *     produces a note even if it started on a button.
 *
 *   - On `pointerup` the host calls `end(event.pointerId)`. If `play`
 *     hasn't fired yet that's a tap → fire it synchronously so the
 *     host's normal pointerup release runs against a "playing" state.
 */
export function createScrollGesture({ tapDelayMs = 80 } = {}) {
  // pointerId -> { played, play, release, timer }
  const states = new Map();

  const firePlay = (state) => {
    if (state.played || !state.play) return;
    state.played = true;
    if (state.timer != null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.play();
  };

  return {
    start(event, opts = {}) {
      const play = typeof opts.play === 'function' ? opts.play : null;
      const release = typeof opts.release === 'function' ? opts.release : null;

      // Mouse / pen: no tap-vs-pan ambiguity, press immediately.
      if (event.pointerType !== 'touch') {
        if (play) play();
        return;
      }

      const state = { played: false, play, release, timer: null };

      if (play && tapDelayMs > 0) {
        state.timer = setTimeout(() => {
          state.timer = null;
          firePlay(state);
        }, tapDelayMs);
      } else if (play) {
        firePlay(state);
      }

      states.set(event.pointerId, state);
    },

    /**
     * pointercancel — the browser took over the gesture (typically for
     * native scroll). Cancel the pending play; if it already fired,
     * call `release` to undo it so the host's `activeButtons`-style
     * tracking stays consistent.
     */
    cancel(pointerId) {
      const state = states.get(pointerId);
      if (!state) return;
      if (state.timer != null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.played && state.release) {
        state.release();
      }
      states.delete(pointerId);
    },

    /**
     * pointerup. If the gesture was a tap (timer hadn't fired yet),
     * synchronously fire the deferred play so the host's normal release
     * logic on pointerup has something to release.
     */
    end(pointerId) {
      const state = states.get(pointerId);
      if (!state) return;
      firePlay(state);
      states.delete(pointerId);
    },

    /** Whether the deferred play has fired (i.e. the host can safely
     * run its drag-to-play logic on pointermove). */
    hasPlayed(pointerId) {
      return states.get(pointerId)?.played === true;
    }
  };
}
