// Legend of DOOM — mobile touch input layer.
//
// Takes the mobile IIFE that was previously ~350 lines inline in
// index.html and gives it a real shape. Three concerns separated:
//
//   1. BINDINGS — a pure-data table mapping logical actions to
//      KeyboardEvent init fields (plus an `alsoMouse` flag for FIRE,
//      which also needs a synthetic mousedown so Doom's default
//      mouse1=+attack binding fires).
//
//      Changing a key now means editing one row, not hunting through
//      an IIFE. When USE was wrongly bound to Space (+jump in modern
//      GZDoom), the fix landed here; the next time upstream remaps
//      something, it lives here too.
//
//   2. SwipeController — a pure-JS state machine for "horizontal drag
//      on canvas → ArrowLeft/ArrowRight with auto-release." Takes
//      start/move/end events and emits turn commands. No DOM reads,
//      no `canvas.dispatchEvent` — purely testable with recorded calls.
//
//   3. wireOverlay() — the DOM layer. Queries #touch-ui + #canvas,
//      wires the BINDINGS table to onscreen buttons, attaches
//      visualViewport pinning (for iOS Safari landscape chrome), stubs
//      pointer lock, installs the mouse-event swallow, hooks blur to
//      release stuck keys, and subscribes to the lifecycle to hide/show
//      the overlay based on phase.
//
// Mobile detection: "coarse pointer primary AND no fine pointer
// anywhere" — this avoids the false positive on touch-capable laptops
// (MacBook, Surface) that have both a touchscreen and a trackpad.
// Desktop with touchscreen keeps the full keyboard+mouse experience.
//
// Depends on: lifecycle.js (subscribes to `playing` / post-playing).
//             Degrades gracefully if missing — overlay just stays
//             hidden because the subscription never fires.
(function () {
  'use strict';

  // --- Bindings table (data, not code) ------------------------------------
  //
  // Each entry is a logical action (a key in the BINDINGS object) paired
  // with the fields needed to synthesize a browser KeyboardEvent. `alsoMouse`
  // triggers a synthetic left-button mousedown/mouseup on the canvas — used
  // by FIRE because Doom binds +attack to both Ctrl and mouse1, and
  // synthetic modifier-only KeyboardEvents don't reliably reach SDL2
  // through the WASM pthread bridge.
  //
  // Reasoning for specific choices:
  //   fire  — data-key 'Control' + KeyE mouse1 fallback. GZDoom default.
  //   use   — KeyE, not Space. In modern GZDoom, Space = +jump. This is
  //           the single most common landmine when mapping Doom keys.
  //   turn* — Arrow keys. Actual turning (not strafing). `,` and `.` are
  //           the +turnleft/+turnright aliases in Doom history but the
  //           default menu binds them to Arrows.
  //
  // Defined before the mobile early-return below so that unit tests on
  // non-mobile runtimes (e.g. jsdom in node:test) can import the pure
  // pieces from `window.LoDTouchInput` without having to mock
  // `matchMedia` into a specific shape.

  var BINDINGS = {
    forward: { key: 'w', code: 'KeyW', keyCode: 87 },
    back: { key: 's', code: 'KeyS', keyCode: 83 },
    strafeL: { key: 'a', code: 'KeyA', keyCode: 65 },
    strafeR: { key: 'd', code: 'KeyD', keyCode: 68 },
    turnL: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    turnR: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    use: { key: 'e', code: 'KeyE', keyCode: 69 },
    menu: { key: 'Escape', code: 'Escape', keyCode: 27 },
    confirm: { key: 'Enter', code: 'Enter', keyCode: 13 },
    fire: { key: 'Control', code: 'ControlLeft', keyCode: 17, alsoMouse: true }
  };

  // --- SwipeController: pure state machine --------------------------------
  //
  // Input: `onTurn(action, pressed)` callback where action is 'turnL'|'turnR'
  // and pressed is true/false. Output: stream of onTurn calls.
  //
  // Behaviour: horizontal drag exceeding THRESHOLD px/event flips the turn
  // key on; after HOLD_MAX_MS of no movement the key flips off. A direction
  // switch during an active drag releases the opposite key before pressing
  // the new one (so the engine never sees both arrows held). `end()` adds
  // a short grace period so a fast final flick still produces a visible
  // turn before releasing.
  //
  // Intentionally DOM-free — `wireOverlay` passes a callback that does
  // the actual dispatch. Lets tests exercise direction switching, auto-
  // release timing, and `end` semantics without a canvas.

  function createSwipeController(opts) {
    var onTurn = opts.onTurn;
    var THRESHOLD = opts.threshold != null ? opts.threshold : 3;
    var HOLD_MAX_MS = opts.holdMaxMs != null ? opts.holdMaxMs : 100;
    var HOLD_MIN_MS = 15;
    var END_GRACE_MS = 60;

    var active = false;
    var lastX = 0;
    var dir = null; // 'turnL' | 'turnR' | null
    var releaseTimer = null;

    function clearKeyNow() {
      if (releaseTimer) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      if (dir) {
        onTurn(dir, false);
        dir = null;
      }
    }

    return {
      start: function (x) {
        active = true;
        lastX = x;
      },
      // Returns true if a command was emitted (caller can e.preventDefault
      // to stop the browser from rubber-banding the page).
      move: function (x) {
        if (!active) return false;
        var dx = x - lastX;
        if (Math.abs(dx) < THRESHOLD) return false;
        var want = dx < 0 ? 'turnL' : 'turnR';
        if (dir !== want) {
          if (dir) onTurn(dir, false);
          onTurn(want, true);
          dir = want;
        }
        if (releaseTimer) clearTimeout(releaseTimer);
        var hold = Math.min(Math.abs(dx) * 5, HOLD_MAX_MS);
        if (hold < HOLD_MIN_MS) hold = HOLD_MIN_MS;
        releaseTimer = setTimeout(clearKeyNow, hold);
        lastX = x;
        return true;
      },
      end: function () {
        active = false;
        if (releaseTimer) clearTimeout(releaseTimer);
        releaseTimer = setTimeout(clearKeyNow, END_GRACE_MS);
      },
      // Immediate release — used on blur / tab-hidden / lifecycle exit
      // so the player doesn't keep spinning after leaving.
      clear: clearKeyNow,
      // Introspection for tests.
      _dir: function () {
        return dir;
      },
      _active: function () {
        return active;
      }
    };
  }

  // --- Public export (before the mobile gate) -----------------------------
  //
  // Exposed unconditionally so that unit tests in jsdom (which reports a
  // `fine` pointer and thus fails the mobile check) can still reach
  // createSwipeController / BINDINGS. No DOM wiring has run yet, so this
  // is inert on desktop — desktop users get the exports and nothing else.
  window.LoDTouchInput = {
    createSwipeController: createSwipeController,
    bindings: BINDINGS
  };

  // --- Mobile detection ---------------------------------------------------

  function isMobile() {
    var coarseOnly =
      window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches &&
      !window.matchMedia('(any-pointer: fine)').matches;
    var isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    return coarseOnly || isMobileUA;
  }

  if (!isMobile()) return;
  document.body.classList.add('mobile');

  // --- Orientation tracking -----------------------------------------------

  function syncOrientation() {
    var portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('portrait', portrait);
  }
  syncOrientation();
  window.addEventListener('resize', syncOrientation);
  window.addEventListener('orientationchange', syncOrientation);

  // Suppress iOS long-press magnifier / gesture zoom on the canvas.
  document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
  });

  // --- wireOverlay: DOM layer ---------------------------------------------

  function wireOverlay() {
    var canvas = document.getElementById('canvas');
    var touchUi = document.getElementById('touch-ui');
    if (!canvas || !touchUi) {
      setTimeout(wireOverlay, 120);
      return;
    }

    // --- visualViewport pinning ---
    //
    // iOS Safari landscape has translucent chrome that covers the bottom
    // ~40px of the layout viewport. position:fixed/inset:0 anchors to the
    // LAYOUT viewport, so bottom:14px ended up under the chrome. Sizing
    // #touch-ui to window.visualViewport gives us the actually-visible
    // rectangle; the action buttons at `bottom: 14px` of that rectangle
    // are always on screen.
    if (window.visualViewport) {
      var vv = window.visualViewport;
      var syncVV = function () {
        touchUi.style.top = vv.offsetTop + 'px';
        touchUi.style.left = vv.offsetLeft + 'px';
        touchUi.style.width = vv.width + 'px';
        touchUi.style.height = vv.height + 'px';
      };
      syncVV();
      vv.addEventListener('resize', syncVV);
      vv.addEventListener('scroll', syncVV);
      // iOS occasionally reports stale dimensions on the first resize
      // after rotation — second sync on the next frame catches up.
      window.addEventListener('orientationchange', function () {
        requestAnimationFrame(syncVV);
        setTimeout(syncVV, 250);
      });
    }

    // --- Pointer lock stub ---
    //
    // uzdoom-loader.js adds a canvas.click handler that calls
    // canvas.requestPointerLock(). On touch devices pointer lock is
    // either unsupported or triggers a permission prompt, neither of
    // which belongs here. Stub it to a no-op. The engine's init code
    // does `canvas.requestPointerLock = canvas["requestPointerLock"] || …`,
    // and our truthy stub wins that ||-chain, so the stub survives
    // engine initialization.
    try {
      canvas.requestPointerLock = function () {};
      Object.defineProperty(canvas, 'requestPointerLock', {
        value: function () {},
        writable: true,
        configurable: true
      });
    } catch (_e) {
      /* some browsers refuse the redefine; the first line
                      still applied and is good enough. */
    }

    // --- Dispatch helpers ---

    function sendKey(type, b) {
      var init = {
        key: b.key,
        code: b.code,
        keyCode: b.keyCode,
        which: b.keyCode,
        bubbles: true,
        cancelable: true
      };
      canvas.dispatchEvent(new KeyboardEvent(type, init));
      // Some SDL2 builds only register on window; dispatch there too
      // so the engine picks up events regardless of target.
      window.dispatchEvent(new KeyboardEvent(type, init));
    }

    // Programmatic mouse dispatch for FIRE. The event is tagged with
    // __fromTouchUI so swallowMouse (below) lets it through instead of
    // squashing it as a touch-synthesized click.
    function sendMouse(type) {
      var rect = canvas.getBoundingClientRect();
      var ev = new MouseEvent(type, {
        button: 0,
        buttons: type === 'mousedown' ? 1 : 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
        view: window
      });
      ev.__fromTouchUI = true;
      canvas.dispatchEvent(ev);
    }

    // --- Button wiring ---
    //
    // Maps a button element's data-action attribute to a BINDINGS entry.
    // Held state is tracked per-button so sliding a finger off, blurring
    // the tab, or canceling a touch releases the key (no stuck-forward).

    var held = new Map();

    function pressBtn(btn) {
      if (held.has(btn)) return;
      var action = btn.dataset.action;
      var b = BINDINGS[action];
      if (!b) return;
      held.set(btn, b);
      btn.classList.add('active');
      sendKey('keydown', b);
      if (b.alsoMouse) sendMouse('mousedown');
    }
    function releaseBtn(btn) {
      var b = held.get(btn);
      if (!b) return;
      held.delete(btn);
      btn.classList.remove('active');
      sendKey('keyup', b);
      if (b.alsoMouse) sendMouse('mouseup');
    }
    function releaseAllButtons() {
      held.forEach(function (_b, btn) {
        releaseBtn(btn);
      });
      swipe.clear();
    }

    var buttons = touchUi.querySelectorAll('.touch-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener(
        'touchstart',
        function (e) {
          e.preventDefault();
          pressBtn(btn);
        },
        { passive: false }
      );
      btn.addEventListener(
        'touchend',
        function (e) {
          e.preventDefault();
          releaseBtn(btn);
        },
        { passive: false }
      );
      btn.addEventListener(
        'touchcancel',
        function (e) {
          e.preventDefault();
          releaseBtn(btn);
        },
        { passive: false }
      );
      // Pointer fallback for styluses / trackpads.
      btn.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return;
        pressBtn(btn);
      });
      btn.addEventListener('pointerup', function () {
        releaseBtn(btn);
      });
      btn.addEventListener('pointercancel', function () {
        releaseBtn(btn);
      });
      btn.addEventListener('pointerleave', function () {
        releaseBtn(btn);
      });
      btn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
      });
    });

    // --- Swipe-to-turn on canvas ---

    var swipe = createSwipeController({
      onTurn: function (action, pressed) {
        sendKey(pressed ? 'keydown' : 'keyup', BINDINGS[action]);
      }
    });

    canvas.addEventListener(
      'touchstart',
      function (e) {
        if (!e.touches || e.touches.length !== 1) return;
        // Block the browser from synthesizing mousedown/click from this
        // touch — otherwise every swipe-to-turn would also fire the weapon
        // (Doom's mouse1=+attack would trigger on the synthesized click).
        if (e.cancelable) e.preventDefault();
        swipe.start(e.touches[0].clientX);
      },
      { passive: false }
    );

    canvas.addEventListener(
      'touchmove',
      function (e) {
        if (!e.touches || e.touches.length !== 1) return;
        var emitted = swipe.move(e.touches[0].clientX);
        if (emitted) e.preventDefault();
      },
      { passive: false }
    );

    canvas.addEventListener(
      'touchend',
      function () {
        swipe.end();
      },
      { passive: true }
    );
    canvas.addEventListener(
      'touchcancel',
      function () {
        swipe.end();
      },
      { passive: true }
    );

    // --- Mouse event swallow ---
    //
    // Defensive belt-and-suspenders: even with touchstart preventDefault,
    // Android Chrome can still emit mouse events in edge cases. This
    // capture-phase swallow blocks them before the engine's own
    // mousedown listener sees them. Programmatic dispatches from
    // sendMouse() carry __fromTouchUI and are let through.

    function swallowMouse(e) {
      if (e.__fromTouchUI) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    }
    canvas.addEventListener('mousedown', swallowMouse, true);
    canvas.addEventListener('mouseup', swallowMouse, true);
    canvas.addEventListener('click', swallowMouse, true);

    // --- Stuck-key guards ---

    window.addEventListener('blur', releaseAllButtons);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) releaseAllButtons();
    });

    // --- Landscape-hint dismiss ---

    var dismissBtn = document.getElementById('landscapeDismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        var hint = document.getElementById('landscape-hint');
        if (hint) hint.style.display = 'none';
      });
    }

    // --- Lifecycle subscription ---
    //
    // Show the overlay on `playing`, hide on anything else. Catches the
    // post-exit case too (engine quits → overlay goes away). Replaces
    // the old MutationObserver on #boot.classList, which was a proxy
    // for the same signal.

    if (window.LoDLifecycle) {
      window.LoDLifecycle.subscribe(function (state) {
        if (state.phase === 'playing') {
          touchUi.classList.remove('hidden');
          touchUi.setAttribute('aria-hidden', 'false');
        } else {
          touchUi.classList.add('hidden');
          touchUi.setAttribute('aria-hidden', 'true');
          releaseAllButtons();
        }
      });
    } else {
      // Fallback: observe the boot overlay like the old code did. Means
      // touch-input.js can be loaded before lifecycle.js during unusual
      // boot orders without breaking the site outright.
      var boot = document.getElementById('boot');
      if (boot) {
        var reveal = function () {
          if (boot.classList.contains('hidden')) {
            touchUi.classList.remove('hidden');
            touchUi.setAttribute('aria-hidden', 'false');
          }
        };
        new MutationObserver(reveal).observe(boot, {
          attributes: true,
          attributeFilter: ['class']
        });
        reveal();
      }
    }
  }

  wireOverlay();
})();
