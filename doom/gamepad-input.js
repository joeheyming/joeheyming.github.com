// UZDoom — Gamepad API → keyboard / mouse look.
//
// Pair Xbox, PlayStation, or generic pads at the OS (USB or Bluetooth).
// The page then reads them with `navigator.getGamepads()`. Web Bluetooth
// is the wrong API here: those controllers show up as HID/XInput devices
// after OS pairing, not as page-paired BLE GATT gadgets.
//
// Why not `/gamepad-keys.js`? That helper only synthesizes arrows /
// Enter / Escape for menu-driven apps. Doom already consumes the Gamepad
// API inside the Emscripten/SDL glue (`emscripten_sample_gamepad_data`),
// so loading the shared bridge would double-fire. We own the mapping
// here and turn the engine joystick off in `lod-input-binds.cfg`.
//
// Why not let SDL/GZDoom bind the pad natively? The WASM build samples
// pads but default joy binds are unreliable in the browser (no profile,
// no rumble, sensitivity cvars unset). Mapping onto the same BINDINGS
// table as touch-input.js keeps keyboard, touch, and pad in lockstep.

import { UZDoomTouchInput } from './touch-input.js';
import { UZDoomLifecycle } from './lifecycle.js';
import {
  STANDARD_AXES,
  STANDARD_BUTTONS,
  axisCurve,
  axisDigital as normalizeAxisDigital,
  buttonDown as normalizeButtonDown,
  createGamepadController,
  firstConnectedPad
} from '../gamepad-core.js';

export { firstConnectedPad };

export const STICK_DEADZONE = 0.28;
export const LOOK_DEADZONE = 0.18;
export const LOOK_SPEED = 22;
export const TRIGGER_THRESHOLD = 0.35;

// Extra keys the pad needs that the on-screen overlay does not.
// `j` / `[` are installed in uzdoom-loader-engine.js alongside the
// shared WASD / Ctrl / E binds.
const EXTRA_BINDINGS = {
  weapprev: { key: '[', code: 'BracketLeft', keyCode: 219 },
  jumpPad: { key: 'j', code: 'KeyJ', keyCode: 74 },
  speed: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  lookUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  lookDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  map: { key: 'Tab', code: 'Tab', keyCode: 9 }
};

export const KEYS = Object.assign({}, UZDoomTouchInput.bindings, EXTRA_BINDINGS);

// W3C standard mapping: https://w3c.github.io/gamepad/#remapping
// Xbox A/B/X/Y ≡ PlayStation cross/circle/square/triangle.
export const BUTTON_ACTIONS = {
  [STANDARD_BUTTONS.SOUTH]: ['use', 'confirm'], // A / cross — open doors + menu OK
  [STANDARD_BUTTONS.EAST]: ['menu'], // B / circle — back
  [STANDARD_BUTTONS.WEST]: ['map'], // X / square — automap
  [STANDARD_BUTTONS.NORTH]: ['jumpPad'], // Y / triangle — jump (`bind j "+jump"`)
  [STANDARD_BUTTONS.LEFT_BUMPER]: ['weapprev'],
  [STANDARD_BUTTONS.RIGHT_BUMPER]: ['weapnext'],
  [STANDARD_BUTTONS.LEFT_TRIGGER]: ['alt'],
  [STANDARD_BUTTONS.RIGHT_TRIGGER]: ['fire'],
  [STANDARD_BUTTONS.SELECT]: ['menu'],
  [STANDARD_BUTTONS.START]: ['menu'],
  [STANDARD_BUTTONS.LEFT_STICK]: ['speed'],
  [STANDARD_BUTTONS.DPAD_UP]: ['lookUp'],
  [STANDARD_BUTTONS.DPAD_DOWN]: ['lookDown'],
  [STANDARD_BUTTONS.DPAD_LEFT]: ['turnL'],
  [STANDARD_BUTTONS.DPAD_RIGHT]: ['turnR']
};

export function buttonDown(button) {
  return normalizeButtonDown(button, TRIGGER_THRESHOLD);
}

export function axisDigital(value, dead) {
  return normalizeAxisDigital(value, dead == null ? STICK_DEADZONE : dead);
}

export function axisLook(value, dead) {
  return axisCurve(value, dead == null ? LOOK_DEADZONE : dead);
}

/**
 * Pure mapping: one Gamepad-shaped object → held logical actions + look.
 * @param {{ buttons?: unknown[], axes?: number[] } | null | undefined} pad
 */
export function actionsFromPad(pad) {
  var keys = new Set();
  var lookX = 0;
  var lookY = 0;
  if (!pad) return { keys: keys, lookX: lookX, lookY: lookY };

  var buttons = pad.buttons || [];
  for (var index in BUTTON_ACTIONS) {
    if (!buttonDown(buttons[Number(index)])) continue;
    var actions = BUTTON_ACTIONS[index];
    for (var i = 0; i < actions.length; i++) keys.add(actions[i]);
  }

  var axes = pad.axes || [];
  var lx = axisDigital(axes[STANDARD_AXES.LEFT_X]);
  var ly = axisDigital(axes[STANDARD_AXES.LEFT_Y]);
  if (lx < 0) keys.add('strafeL');
  if (lx > 0) keys.add('strafeR');
  if (ly < 0) keys.add('forward');
  if (ly > 0) keys.add('back');

  lookX = axisLook(axes[STANDARD_AXES.RIGHT_X]) * LOOK_SPEED;
  lookY = axisLook(axes[STANDARD_AXES.RIGHT_Y]) * LOOK_SPEED;
  return { keys: keys, lookX: lookX, lookY: lookY };
}

function engineWantsPad() {
  if (window.UZDoomLifecycle && typeof window.UZDoomLifecycle.isRunning === 'function') {
    return window.UZDoomLifecycle.isRunning();
  }
  return false;
}

function eventCanvas() {
  return document.getElementById('canvas') || document.body || document.documentElement;
}

function sendKey(type, binding) {
  if (!binding) return;
  var init = {
    key: binding.key,
    code: binding.code,
    bubbles: true,
    cancelable: true,
    composed: true
  };
  var event = new KeyboardEvent(type, init);
  if (binding.keyCode) {
    try {
      Object.defineProperty(event, 'keyCode', { value: binding.keyCode });
      Object.defineProperty(event, 'which', { value: binding.keyCode });
    } catch (_e) {
      /* some environments freeze these; `code` is enough for modern SDL */
    }
  }
  var canvas = eventCanvas();
  canvas.dispatchEvent(event);
  window.dispatchEvent(new KeyboardEvent(type, init));
}

function sendLook(dx, dy) {
  if (!dx && !dy) return;
  var event = new MouseEvent('mousemove', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: 0,
    clientY: 0
  });
  try {
    Object.defineProperty(event, 'movementX', { value: dx });
    Object.defineProperty(event, 'movementY', { value: dy });
  } catch (_e) {
    /* ignore */
  }
  var canvas = eventCanvas();
  canvas.dispatchEvent(event);
  window.dispatchEvent(event);
}

var held = new Set();

function releaseAll() {
  held.forEach(function (action) {
    sendKey('keyup', KEYS[action]);
  });
  held.clear();
}

function syncKeys(down) {
  down.forEach(function (action) {
    if (held.has(action)) return;
    held.add(action);
    sendKey('keydown', KEYS[action]);
  });
  Array.from(held).forEach(function (action) {
    if (down.has(action)) return;
    held.delete(action);
    sendKey('keyup', KEYS[action]);
  });
}

function handleFrame(pad) {
  if (!engineWantsPad()) {
    releaseAll();
  } else {
    var mapped = actionsFromPad(pad);
    syncKeys(mapped.keys);
    sendLook(mapped.lookX, mapped.lookY);
  }
}

var controller = createGamepadController({
  onFrame: handleFrame,
  onRelease: releaseAll
});

if (UZDoomLifecycle && typeof UZDoomLifecycle.subscribe === 'function') {
  UZDoomLifecycle.subscribe(function (state) {
    var phase = state && state.phase;
    if (phase !== 'launching' && phase !== 'playing') releaseAll();
  });
}

export const UZDoomGamepad = {
  actionsFromPad: actionsFromPad,
  buttonDown: buttonDown,
  axisDigital: axisDigital,
  axisLook: axisLook,
  firstConnectedPad: firstConnectedPad,
  keys: KEYS,
  buttonActions: BUTTON_ACTIONS,
  start: controller.start,
  stop: controller.stop
};

window.UZDoomGamepad = UZDoomGamepad;
