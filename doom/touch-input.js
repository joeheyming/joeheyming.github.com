// UZDoom — mobile touch input layer.
//
// Takes the mobile IIFE that was previously ~350 lines inline in
// index.html and gives it a real shape. Three concerns separated:
//
//   1. BINDINGS — a pure-data table mapping logical actions to
//      KeyboardEvent init fields.
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

import { UZDoomLifecycle } from './lifecycle.js';

// --- Bindings table (data, not code) ------------------------------------
//
// Each entry is a logical action (a key in the BINDINGS object) paired
// with the fields needed to synthesize a browser KeyboardEvent.
//
// Reasoning for specific choices:
//   fire  — Ctrl key, GZDoom default for +attack. We used to also
//           dispatch a synthetic mousedown here because Doom binds
//           +attack to both ctrl and mouse1, and belt-and-suspenders
//           seemed safe. It's not safe anymore: the engine now
//           ships with `+unbind mouse1` on startup argv (see
//           uzdoom-loader.js) to stop SDL2's touch→mouse emulation
//           from firing the weapon on every swipe. So keep FIRE as
//           a keyboard-only action; the mouse1 channel is dead.
//   use   — KeyE, not Space. In modern GZDoom, Space = +jump. This
//           is the single most common landmine when mapping Doom keys.
//   jump  — Space, the GZDoom default for +jump. Mobile users have no
//           keyboard, so we expose it as a dedicated touch button.
//   turn* — Arrow keys. Actual turning (not strafing). `,` and `.` are
//           the +turnleft/+turnright aliases in Doom history but the
//           default menu binds them to Arrows.
//
// Defined before the mobile early-return below so that unit tests on
// non-mobile runtimes (e.g. jsdom in node:test) can import the pure
// pieces from `window.UZDoomTouchInput` without having to mock
// `matchMedia` into a specific shape.

var BINDINGS = {
  forward: { key: 'w', code: 'KeyW', keyCode: 87 },
  back: { key: 's', code: 'KeyS', keyCode: 83 },
  strafeL: { key: 'a', code: 'KeyA', keyCode: 65 },
  strafeR: { key: 'd', code: 'KeyD', keyCode: 68 },
  turnL: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  turnR: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  use: { key: 'e', code: 'KeyE', keyCode: 69 },
  jump: { key: ' ', code: 'Space', keyCode: 32 },
  menu: { key: 'Escape', code: 'Escape', keyCode: 27 },
  confirm: { key: 'Enter', code: 'Enter', keyCode: 13 },
  fire: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  // Backslash → "+altattack". Throws the Castlevania sub-weapon
  // (whip jumps to the held subweapon's altfire state) and triggers
  // alt-fire on any future GZDoom mod that uses it. Held-action
  // semantics match FIRE — keydown on touchstart, keyup on touchend.
  alt: { key: '\\', code: 'Backslash', keyCode: 220 },
  // Apostrophe → "weapnext". Single-tap cycles to the next weapon
  // slot and wraps around at the end. Lets mobile players reach the
  // boomerang/bow in Legend of Doom and beam upgrades in Metroid
  // (which are weapons, not inventory items). The CCMD executes once
  // per keydown — our pressBtn() sends exactly one keydown per tap,
  // so no auto-repeat to worry about.
  weapnext: { key: "'", code: 'Quote', keyCode: 222 }
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
export const UZDoomTouchInput = {
  createSwipeController: createSwipeController,
  bindings: BINDINGS
};

window.UZDoomTouchInput = UZDoomTouchInput;

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

if (isMobile()) {
  document.body.classList.add('mobile');

  // --- Orientation tracking -----------------------------------------------

  var syncOrientation = function () {
    var portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('portrait', portrait);
  };
  syncOrientation();
  window.addEventListener('resize', syncOrientation);
  window.addEventListener('orientationchange', syncOrientation);

  // Suppress iOS long-press magnifier / gesture zoom on the canvas.
  document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
  });

  // --- wireOverlay: DOM layer ---------------------------------------------

  var wireOverlay = function wireOverlay() {
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
    }
    function releaseBtn(btn) {
      var b = held.get(btn);
      if (!b) return;
      held.delete(btn);
      btn.classList.remove('active');
      sendKey('keyup', b);
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

    // --- Canvas touch handling: swipe-to-turn + tap-to-attack ---
    //
    // Tracks ONE primary canvas touch by identifier. Using
    // `e.touches.length` as a guard breaks on multi-touch scenarios
    // like "hold forward, tap to attack": the forward d-pad button
    // counts as an active touch on the document, so `e.touches.length`
    // is 2 and the canvas handler would bail. Indexing by
    // `e.changedTouches[].identifier` instead gives us per-finger
    // state that survives any other fingers the user has down.
    //
    // Tap detection: a touch that stays within TAP_MAX_DIST px and
    // releases within TAP_MAX_MS fires the FIRE binding on release.
    // A touch that moves past the distance clears the tap state so
    // the same gesture becomes a pure swipe-to-turn.
    //
    // Only ONE canvas touch is tracked as "primary" at a time. Extra
    // fingers on the canvas (a two-finger swipe, for example) are
    // ignored; they still flow to SDL2 via the default path, which
    // is fine — SDL's mousedown is unbound and its mousemotion is
    // what we want for mouselook anyway.
    var TAP_MAX_MS = 250;
    var TAP_MAX_DIST = 12;
    var TAP_HOLD_MS = 60; // synthetic keydown → keyup gap

    var primaryTouchId = null;
    var primaryTap = null; // { x, y, at } or null once drag threshold exceeded

    function tapFire() {
      var b = BINDINGS.fire;
      if (!b) return;
      sendKey('keydown', b);
      setTimeout(function () {
        sendKey('keyup', b);
      }, TAP_HOLD_MS);
    }

    function findChangedPrimary(e) {
      if (!e.changedTouches) return null;
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === primaryTouchId) {
          return e.changedTouches[i];
        }
      }
      return null;
    }

    canvas.addEventListener(
      'touchstart',
      function (e) {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        // Block the browser from synthesizing mousedown/click from this
        // touch — otherwise every swipe-to-turn would also fire the weapon
        // (Doom's mouse1=+attack would trigger on the synthesized click,
        // even though we now unbind mouse1 at startup).
        if (e.cancelable) e.preventDefault();
        if (primaryTouchId !== null) return; // already tracking one
        var t = e.changedTouches[0];
        primaryTouchId = t.identifier;
        primaryTap = { x: t.clientX, y: t.clientY, at: Date.now() };
        swipe.start(t.clientX);
      },
      { passive: false }
    );

    canvas.addEventListener(
      'touchmove',
      function (e) {
        var t = findChangedPrimary(e);
        if (!t) return;
        if (primaryTap) {
          var dx = t.clientX - primaryTap.x;
          var dy = t.clientY - primaryTap.y;
          if (dx * dx + dy * dy > TAP_MAX_DIST * TAP_MAX_DIST) {
            // Touch turned into a drag — cancel the tap-to-fire.
            primaryTap = null;
          }
        }
        var emitted = swipe.move(t.clientX);
        if (emitted) e.preventDefault();
      },
      { passive: false }
    );

    canvas.addEventListener(
      'touchend',
      function (e) {
        var t = findChangedPrimary(e);
        if (!t) return;
        if (primaryTap) {
          var dt = Date.now() - primaryTap.at;
          if (dt <= TAP_MAX_MS) tapFire();
        }
        primaryTap = null;
        primaryTouchId = null;
        swipe.end();
      },
      { passive: true }
    );
    canvas.addEventListener(
      'touchcancel',
      function (e) {
        var t = findChangedPrimary(e);
        if (!t) return;
        primaryTap = null;
        primaryTouchId = null;
        swipe.end();
      },
      { passive: true }
    );

    // --- Mouse event swallow ---
    //
    // Defensive belt-and-suspenders: even with touchstart preventDefault,
    // Android Chrome can still emit mouse events in edge cases. This
    // capture-phase swallow blocks them before the engine's own
    // mousedown listener sees them. We no longer programmatically
    // dispatch mouse events ourselves (mouse1 is unbound at startup
    // via argv, so there's nothing to emit), so the `__fromTouchUI`
    // escape hatch is gone — every mouse event reaching here is
    // either a real browser event we want to drop, or nothing.

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

    if (UZDoomLifecycle) {
      UZDoomLifecycle.subscribe(function (state) {
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
  };

  wireOverlay();
}
