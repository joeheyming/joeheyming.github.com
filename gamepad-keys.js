// Controller → keyboard bridge for keyboard-driven apps.
//
// Opt in with `<script type="module" src="/gamepad-keys.js"></script>`.
// Apps that consume the Gamepad API directly (EmulatorJS, StepMania, Doom,
// Pac-Man) must not load this bridge or both input paths will fire.

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
  [STANDARD_BUTTONS.EAST]: 'Escape'
};

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
  const active = document.activeElement;
  if (active && active !== document.body && document.contains(active)) return active;
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
    held.delete(key);
    dispatchGamepadKey('keyup', key);
  }
}

function syncKeys(down, now) {
  for (const key of down) {
    const state = held.get(key);
    if (!state) {
      held.set(key, { nextRepeat: now + REPEAT_DELAY_MS });
      dispatchGamepadKey('keydown', key);
    } else if (now >= state.nextRepeat) {
      state.nextRepeat = now + REPEAT_RATE_MS;
      dispatchGamepadKey('keydown', key);
    }
  }

  for (const key of Array.from(held.keys())) {
    if (!down.has(key)) {
      held.delete(key);
      dispatchGamepadKey('keyup', key);
    }
  }
}

const controller = createGamepadController({
  onFrame(pad, _snapshot, timestamp) {
    syncKeys(pressedKeys(pad), timestamp ?? performance.now());
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
