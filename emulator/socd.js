// SOCD cleaning for the /emulator/ shell.
//
// SOCD is "simultaneous opposing cardinal directions": Left+Right or
// Up+Down arriving at once. A real d-pad pivots on a single dome, so the
// console never sees that state and plenty of games never handle it.
// Metal Slug Advance is the notorious one — Left+Right plus B hangs the
// game outright, leaving the GBA sound registers looping a garbage buffer
// (libretro/vba-next#14, referenced from mgba-emu/mgba#1191). Desktop mGBA
// ships an "Allow opposing input directions" toggle that is off by default;
// EmulatorJS has no equivalent, so the pair reaches the core unfiltered.
//
// EmulatorJS binds `keydown keyup` on its player element, which means a
// capture-phase listener on `window` sees each event first and can drop it
// before the core is told about it.
//
// Resolution is first-press-wins: while a direction is held, a press of its
// opposite is swallowed. Releasing the held one hands over to the opposite
// if it is still physically down, so sliding from Left to Right across an
// overlap keeps moving instead of stalling until the player re-presses.
//
// Installed by ejs-mount.js at game start, not on page load — the boot card,
// ROM browser, and lean-back grid all navigate with the arrow keys and must
// keep seeing both directions.
(function () {
  'use strict';

  const OPPOSITE = {
    ArrowLeft: 'ArrowRight',
    ArrowRight: 'ArrowLeft',
    ArrowUp: 'ArrowDown',
    ArrowDown: 'ArrowUp'
  };

  const KEY_CODES = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40
  };

  const BY_KEY_CODE = {
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown'
  };

  /** Directions physically down, including ones we are suppressing. */
  const held = new Set();
  /** Directions EmulatorJS has been told about. Never holds an opposing pair. */
  const delivered = new Set();
  /** Handover presses we dispatched ourselves, so we don't re-filter them. */
  const synthetic = new WeakSet();

  let installed = false;

  // Engines disagree on which of these three a d-pad press populates, so
  // read all of them rather than assuming `key` (same defensive lookup as
  // 2048/index.js, which has to cope with the PS5 web view).
  function directionOf(event) {
    if (OPPOSITE[event.key]) return event.key;
    if (OPPOSITE[event.code]) return event.code;
    return BY_KEY_CODE[event.keyCode] || null;
  }

  function suppress(event) {
    event.stopImmediatePropagation();
    // Nothing downstream will cancel the arrow key now, and a swallowed
    // press should not scroll the page out from under the canvas.
    event.preventDefault();
  }

  // Re-press `direction` on behalf of the player once its opposite lifts.
  //
  // Deferred to a microtask because we run in the capture phase: dispatching
  // inline would land the press before the release we are reacting to
  // finishes propagating, briefly handing the core the very Left+Right pair
  // this filter exists to prevent.
  function handOver(sourceEvent, direction) {
    const target = sourceEvent.target || document.getElementById('game');
    if (!target || typeof target.dispatchEvent !== 'function') return;
    queueMicrotask(() => {
      // A reset (or a fast release) between scheduling and now makes the
      // handover stale.
      if (!held.has(direction) || delivered.has(direction)) return;
      if (delivered.has(OPPOSITE[direction])) return;
      const keyCode = KEY_CODES[direction];
      let event;
      try {
        event = new KeyboardEvent('keydown', {
          key: direction,
          code: direction,
          keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true
        });
      } catch {
        return;
      }
      synthetic.add(event);
      delivered.add(direction);
      target.dispatchEvent(event);
    });
  }

  function onKey(event) {
    if (synthetic.has(event)) return;
    const direction = directionOf(event);
    if (!direction) return;
    const opposite = OPPOSITE[direction];

    if (event.type === 'keydown') {
      held.add(direction);
      // Auto-repeat of something already delivered: harmless, let it through.
      if (delivered.has(direction)) return;
      if (delivered.has(opposite)) {
        suppress(event);
        return;
      }
      delivered.add(direction);
      return;
    }

    held.delete(direction);
    if (!delivered.has(direction)) {
      // We ate the press, so the core would read this release as a stray
      // "stop moving" and cancel any autofire on that direction.
      suppress(event);
      return;
    }
    delivered.delete(direction);
    if (held.has(opposite)) handOver(event, opposite);
  }

  // Keys released while the tab is in the background never reach us, which
  // would otherwise leave a phantom direction blocking its opposite forever.
  function reset() {
    held.clear();
    delivered.clear();
  }

  function onVisibilityChange() {
    if (document.hidden) reset();
  }

  window.emulatorSocd = {
    install() {
      if (installed) return;
      installed = true;
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('keyup', onKey, true);
      window.addEventListener('blur', reset);
      document.addEventListener('visibilitychange', onVisibilityChange);
    },
    reset
  };
})();
