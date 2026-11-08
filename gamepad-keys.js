// Controller → the same keys remote.js already handles.
//
// analytics.js loads this on every page. D-pad and the left stick move
// focus, Cross activates, Circle is Back, and Start is play/pause.
// A game that is actually being played sets `data-gamepad-nav="game"`
// on <html> so this bridge lets go of the pad.

import {
  STANDARD_AXES,
  STANDARD_BUTTONS,
  axisDigital,
  buttonDown,
  createGamepadController
} from './gamepad-core.js';

const BUTTON_KEYS = {
  [STANDARD_BUTTONS.DPAD_UP]: 'ArrowUp',
  [STANDARD_BUTTONS.DPAD_DOWN]: 'ArrowDown',
  [STANDARD_BUTTONS.DPAD_LEFT]: 'ArrowLeft',
  [STANDARD_BUTTONS.DPAD_RIGHT]: 'ArrowRight',
  [STANDARD_BUTTONS.SOUTH]: 'Enter',
  [STANDARD_BUTTONS.EAST]: 'Escape',
  [STANDARD_BUTTONS.START]: 'MediaPlayPause'
};

const REPEATABLE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const AXIS_KEYS = [
  { axis: STANDARD_AXES.LEFT_X, negative: 'ArrowLeft', positive: 'ArrowRight' },
  { axis: STANDARD_AXES.LEFT_Y, negative: 'ArrowUp', positive: 'ArrowDown' }
];

const AXIS_DEADZONE = 0.55;
const REPEAT_DELAY_MS = 420;
const REPEAT_RATE_MS = 150;

const LEGACY_CODES = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Enter: 13,
  Escape: 27
};

/** @type {Map<string, { nextRepeat: number }>} */
const held = new Map();

function eventTarget() {
  // document.activeElement stops at a shadow host. The card inside
  // <rom-browser> is the control that should receive the key.
  let el = document.activeElement;
  let guard = 0;
  while (el && el.shadowRoot && el.shadowRoot.activeElement && guard < 8) {
    el = el.shadowRoot.activeElement;
    guard += 1;
  }
  if (el && el.isConnected && el !== document.body && el !== document.documentElement) {
    return el;
  }
  return document.body || document.documentElement;
}

export function dispatchGamepadKey(type, key) {
  const target = eventTarget();
  if (!target) return;
  const event = new KeyboardEvent(type, {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    composed: true
  });
  const legacy = LEGACY_CODES[key];
  if (legacy) {
    Object.defineProperty(event, 'keyCode', { value: legacy });
    Object.defineProperty(event, 'which', { value: legacy });
  }
  target.dispatchEvent(event);
}

export function pressedKeys(pad) {
  const keys = new Set();
  const buttons = pad?.buttons || [];
  for (const index of Object.keys(BUTTON_KEYS)) {
    if (buttonDown(buttons[Number(index)], 0.5)) keys.add(BUTTON_KEYS[index]);
  }

  const axes = pad?.axes || [];
  for (const map of AXIS_KEYS) {
    const direction = axisDigital(axes[map.axis], AXIS_DEADZONE);
    if (direction < 0) keys.add(map.negative);
    if (direction > 0) keys.add(map.positive);
  }
  return keys;
}

function releaseAll() {
  for (const key of Array.from(held.keys())) {
    const state = held.get(key);
    held.delete(key);
    if (!state || !state.quiet) dispatchGamepadKey('keyup', key);
  }
}

// A press that opens this page is still down on the first sample. Acting on
// it clicks whatever landed under focus, which on a ROM link is Cancel.
let armed = false;

export function applyGamepadKeys(down, now) {
  const time = typeof now === 'number' ? now : 0;
  if (!armed) {
    armed = true;
    for (const key of down) {
      held.set(key, { nextRepeat: time + REPEAT_DELAY_MS, quiet: true });
    }
    return;
  }

  for (const key of down) {
    const state = held.get(key);
    if (!state) {
      held.set(key, { nextRepeat: time + REPEAT_DELAY_MS });
      dispatchGamepadKey('keydown', key);
    } else if (!state.quiet && REPEATABLE_KEYS.has(key) && time >= state.nextRepeat) {
      state.nextRepeat = time + REPEAT_RATE_MS;
      dispatchGamepadKey('keydown', key);
    }
  }

  for (const key of Array.from(held.keys())) {
    if (!down.has(key)) {
      const state = held.get(key);
      held.delete(key);
      if (!state || !state.quiet) dispatchGamepadKey('keyup', key);
    }
  }
}

export function gameOwnsGamepad() {
  return document.documentElement.dataset.gamepadNav === 'game';
}

function deepActiveElement() {
  let el = document.activeElement;
  let guard = 0;
  while (el && el.shadowRoot && el.shadowRoot.activeElement && guard < 8) {
    el = el.shadowRoot.activeElement;
    guard += 1;
  }
  return el;
}

// A display:none ✕ or a closed drawer cannot take focus. Counting it as
// a landing would eat every arrow that follows.
function concealed(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.hidden || node.hasAttribute('inert')) return true;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    if (node.parentElement) {
      node = node.parentElement;
      continue;
    }
    const root = node.getRootNode ? node.getRootNode() : null;
    node = root && root.host ? root.host : null;
  }
  return false;
}

function landable(el) {
  if (!el || typeof el.focus !== 'function' || !el.isConnected) return false;
  if (el.disabled) return false;
  if (el.classList && el.classList.contains('heyming-nav-toggle')) return false;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) < 0) return false;
  if (el.closest && el.closest('[data-heyming-manual-arrows]')) return false;
  return !concealed(el);
}

/**
 * Land on the page's first control when nothing else is focused.
 * Returns true only when focus actually moved there. When nothing can
 * take focus the arrow passes through, so a page that places focus on
 * its own (a poster grid) still gets it.
 */
export function focusIdleControl() {
  const active = document.activeElement;
  const idle =
    !active ||
    active === document.body ||
    active === document.documentElement ||
    (active.classList && active.classList.contains('heyming-nav-toggle'));
  if (!idle) return false;
  const candidates = [];
  const start = document.querySelector('[data-initial-focus]');
  if (start) candidates.push(start);
  const nodes = document.querySelectorAll('a[href], button, [role="button"]');
  for (let i = 0; i < nodes.length; i += 1) candidates.push(nodes[i]);
  for (let i = 0; i < candidates.length; i += 1) {
    const el = candidates[i];
    if (!landable(el)) continue;
    try {
      el.focus({ preventScroll: true, focusVisible: true });
    } catch (_) {
      el.focus();
    }
    if (deepActiveElement() === el) return true;
  }
  return false;
}

const controller = createGamepadController({
  onFrame(pad, _snapshot, timestamp) {
    if (gameOwnsGamepad()) {
      releaseAll();
      return;
    }
    let keys = pressedKeys(pad);
    if (focusIdleControl()) {
      keys = new Set(
        Array.from(keys).filter(function (key) {
          return !REPEATABLE_KEYS.has(key);
        })
      );
    }
    applyGamepadKeys(keys, timestamp ?? performance.now());
  },
  onConnectionChange(pad) {
    if (pad) {
      document.documentElement.dataset.gamepadKeys = 'on';
    } else {
      delete document.documentElement.dataset.gamepadKeys;
    }
  },
  onRelease: releaseAll
});

window.gamepadKeys = controller;
