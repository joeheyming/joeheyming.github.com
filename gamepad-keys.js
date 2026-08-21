// Controller → keyboard bridge for keyboard-driven apps.
//
// Console and TV browsers hand the D-pad to their own on-screen cursor
// instead of the page, so a game listening for `keydown` / ArrowUp never
// hears anything from a controller. The Gamepad API still reports the pad,
// so we poll it and synthesize the arrow / Enter / Escape events the app
// already handles. Nothing else about the app has to change.
//
// Opt-in per page — add `<script src="/gamepad-keys.js"></script>`. Do NOT
// load it on pages that consume the Gamepad API directly (the emulator,
// StepMania, DOOM); they would see both their own reads and these
// synthesized keys.
//
// Synthesized events are untrusted (`isTrusted === false`), so they drive
// page listeners but cannot trigger browser-native default actions like
// scrolling. Apps that call `preventDefault()` still behave normally.
(function () {
  'use strict';

  // Standard-mapping button indices (https://w3c.github.io/gamepad/#remapping).
  const BUTTON_KEYS = {
    12: 'ArrowUp',
    13: 'ArrowDown',
    14: 'ArrowLeft',
    15: 'ArrowRight',
    0: 'Enter', // cross / A
    1: 'Escape' // circle / B
  };

  // Left stick, so a pad with a dead D-pad (or an analog-only remote) works.
  const AXIS_KEYS = [
    { axis: 0, negative: 'ArrowLeft', positive: 'ArrowRight' },
    { axis: 1, negative: 'ArrowUp', positive: 'ArrowDown' }
  ];

  const AXIS_DEADZONE = 0.55;
  // Hold-to-repeat, tuned to feel like OS key repeat rather than a stuck key:
  // discrete games (2048, Snake) should get one move per press, not twenty.
  const REPEAT_DELAY_MS = 420;
  const REPEAT_RATE_MS = 150;

  // Legacy keyCode values for apps that predate `event.code`.
  const LEGACY_CODES = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Enter: 13,
    Escape: 27
  };

  /** @type {Map<string, { nextRepeat: number }>} key → repeat bookkeeping */
  const held = new Map();
  let enabled = true;
  let polling = false;
  let rafId = 0;

  function gamepads() {
    try {
      return navigator.getGamepads ? navigator.getGamepads() : [];
    } catch (_) {
      return [];
    }
  }

  function hasGamepad() {
    return Array.prototype.some.call(gamepads() || [], (pad) => pad && pad.connected);
  }

  /** Deliver to the focused element so normal bubbling reaches document handlers. */
  function eventTarget() {
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return active;
    return document.body || document.documentElement;
  }

  function dispatchKey(type, key) {
    const target = eventTarget();
    if (!target) return;
    const event = new KeyboardEvent(type, {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    // KeyboardEvent's constructor ignores keyCode/which, so attach them after
    // construction for apps still reading the deprecated properties.
    const legacy = LEGACY_CODES[key];
    if (legacy) {
      Object.defineProperty(event, 'keyCode', { value: legacy });
      Object.defineProperty(event, 'which', { value: legacy });
    }
    target.dispatchEvent(event);
  }

  /** Keys currently pressed across every connected pad. */
  function pressedKeys() {
    const keys = new Set();
    for (const pad of gamepads() || []) {
      if (!pad || !pad.connected) continue;

      const buttons = pad.buttons || [];
      for (const index of Object.keys(BUTTON_KEYS)) {
        const button = buttons[Number(index)];
        const down = button && (typeof button === 'object' ? button.pressed : button > 0.5);
        if (down) keys.add(BUTTON_KEYS[index]);
      }

      const axes = pad.axes || [];
      for (const map of AXIS_KEYS) {
        const value = axes[map.axis];
        if (typeof value !== 'number') continue;
        if (value <= -AXIS_DEADZONE) keys.add(map.negative);
        else if (value >= AXIS_DEADZONE) keys.add(map.positive);
      }
    }
    return keys;
  }

  function poll() {
    rafId = 0;
    if (!enabled) {
      polling = false;
      return;
    }

    const now = performance.now();
    const down = pressedKeys();

    for (const key of down) {
      const state = held.get(key);
      if (!state) {
        held.set(key, { nextRepeat: now + REPEAT_DELAY_MS });
        dispatchKey('keydown', key);
      } else if (now >= state.nextRepeat) {
        state.nextRepeat = now + REPEAT_RATE_MS;
        dispatchKey('keydown', key);
      }
    }

    for (const key of Array.from(held.keys())) {
      if (!down.has(key)) {
        held.delete(key);
        dispatchKey('keyup', key);
      }
    }

    if (hasGamepad()) {
      rafId = requestAnimationFrame(poll);
    } else {
      polling = false;
    }
  }

  function start() {
    if (polling || !enabled || !hasGamepad()) return;
    polling = true;
    document.documentElement.dataset.gamepadKeys = 'on';
    rafId = requestAnimationFrame(poll);
  }

  function releaseAll() {
    for (const key of Array.from(held.keys())) {
      held.delete(key);
      dispatchKey('keyup', key);
    }
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    polling = false;
    releaseAll();
    delete document.documentElement.dataset.gamepadKeys;
  }

  window.addEventListener('gamepadconnected', () => {
    if (window.trackEvent) {
      window.trackEvent('gamepad_keys_connected', 'Gamepad', navigator.userAgent.slice(0, 80), 0);
    }
    start();
  });
  window.addEventListener('gamepaddisconnected', () => {
    if (!hasGamepad()) stop();
  });
  // Pads already connected at load only surface after a gesture in some
  // browsers, so try immediately and again on the first interaction.
  window.addEventListener('pointerdown', start, { passive: true });
  window.addEventListener('keydown', start, { passive: true });
  // Dropping focus mid-hold would otherwise leave a key stuck down.
  window.addEventListener('blur', releaseAll);
  start();

  window.gamepadKeys = {
    start,
    stop,
    get isActive() {
      return polling;
    },
    get hasGamepad() {
      return hasGamepad();
    },
    disable() {
      enabled = false;
      stop();
    },
    enable() {
      enabled = true;
      start();
    }
  };
})();
