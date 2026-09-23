// Shared Gamepad API primitives.
//
// This module deliberately stops at normalized controller state. Games decide
// whether that state becomes keyboard events, mouse look, rhythm lanes, or
// direct model updates. Keeping the output semantic prevents two input systems
// from driving the same engine (notably EmulatorJS and UZDoom's SDL layer).

export const STANDARD_BUTTONS = Object.freeze({
  SOUTH: 0,
  EAST: 1,
  WEST: 2,
  NORTH: 3,
  LEFT_BUMPER: 4,
  RIGHT_BUMPER: 5,
  LEFT_TRIGGER: 6,
  RIGHT_TRIGGER: 7,
  SELECT: 8,
  START: 9,
  LEFT_STICK: 10,
  RIGHT_STICK: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  HOME: 16
});

export const STANDARD_AXES = Object.freeze({
  LEFT_X: 0,
  LEFT_Y: 1,
  RIGHT_X: 2,
  RIGHT_Y: 3
});

export const DEFAULT_AXIS_DEADZONE = 0.28;
export const DEFAULT_TRIGGER_THRESHOLD = 0.35;

export function buttonDown(button, threshold = DEFAULT_TRIGGER_THRESHOLD) {
  if (button == null) return false;
  if (typeof button === 'number') return button > threshold;
  return !!(button.pressed || (typeof button.value === 'number' && button.value > threshold));
}

export function axisDigital(value, deadzone = DEFAULT_AXIS_DEADZONE) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value <= -deadzone) return -1;
  if (value >= deadzone) return 1;
  return 0;
}

// Remove the deadzone and apply a curve while preserving -1…1. Squaring the
// normalized magnitude gives fine control near center without losing full
// stick speed at the edge.
export function axisCurve(value, deadzone = DEFAULT_AXIS_DEADZONE, exponent = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const normalized = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  return Math.sign(value) * normalized ** exponent;
}

export function firstConnectedPad(gamepads) {
  const pads = gamepads || [];
  for (let index = 0; index < pads.length; index += 1) {
    const pad = pads[index];
    if (pad && pad.connected !== false) return pad;
  }
  return null;
}

export function readGamepads(navigatorObject = globalThis.navigator) {
  try {
    return typeof navigatorObject?.getGamepads === 'function'
      ? navigatorObject.getGamepads() || []
      : [];
  } catch (_error) {
    return [];
  }
}

export function standardSnapshot(
  pad,
  { stickDeadzone = DEFAULT_AXIS_DEADZONE, triggerThreshold = DEFAULT_TRIGGER_THRESHOLD } = {}
) {
  if (!pad) return null;
  const buttons = pad.buttons || [];
  const axes = pad.axes || [];
  const pressed = (index) => buttonDown(buttons[index], triggerThreshold);

  return {
    pad,
    id: pad.id || '',
    index: typeof pad.index === 'number' ? pad.index : -1,
    mapping: pad.mapping || '',
    buttons: {
      south: pressed(STANDARD_BUTTONS.SOUTH),
      east: pressed(STANDARD_BUTTONS.EAST),
      west: pressed(STANDARD_BUTTONS.WEST),
      north: pressed(STANDARD_BUTTONS.NORTH),
      leftBumper: pressed(STANDARD_BUTTONS.LEFT_BUMPER),
      rightBumper: pressed(STANDARD_BUTTONS.RIGHT_BUMPER),
      leftTrigger: pressed(STANDARD_BUTTONS.LEFT_TRIGGER),
      rightTrigger: pressed(STANDARD_BUTTONS.RIGHT_TRIGGER),
      select: pressed(STANDARD_BUTTONS.SELECT),
      start: pressed(STANDARD_BUTTONS.START),
      leftStick: pressed(STANDARD_BUTTONS.LEFT_STICK),
      rightStick: pressed(STANDARD_BUTTONS.RIGHT_STICK),
      dpadUp: pressed(STANDARD_BUTTONS.DPAD_UP),
      dpadDown: pressed(STANDARD_BUTTONS.DPAD_DOWN),
      dpadLeft: pressed(STANDARD_BUTTONS.DPAD_LEFT),
      dpadRight: pressed(STANDARD_BUTTONS.DPAD_RIGHT),
      home: pressed(STANDARD_BUTTONS.HOME)
    },
    axes: {
      leftX: axisCurve(axes[STANDARD_AXES.LEFT_X], stickDeadzone),
      leftY: axisCurve(axes[STANDARD_AXES.LEFT_Y], stickDeadzone),
      rightX: axisCurve(axes[STANDARD_AXES.RIGHT_X], stickDeadzone),
      rightY: axisCurve(axes[STANDARD_AXES.RIGHT_Y], stickDeadzone)
    }
  };
}

// Own one requestAnimationFrame loop and the browser events needed to wake it.
// The callback receives both the raw pad and a normalized standard snapshot.
// Consumers remain responsible for interpreting actions and releasing held
// state through onRelease.
export function createGamepadController({
  navigatorObject = globalThis.navigator,
  eventTarget = globalThis.window,
  documentObject = globalThis.document,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  onFrame = () => {},
  onConnectionChange = () => {},
  onRelease = () => {},
  snapshotOptions,
  autoStart = true
} = {}) {
  let enabled = true;
  let polling = false;
  let frameId = 0;
  let connectedPad = null;
  let destroyed = false;

  const getPad = () => firstConnectedPad(readGamepads(navigatorObject));

  function publishConnection(pad) {
    const previousIndex =
      connectedPad && typeof connectedPad.index === 'number' ? connectedPad.index : null;
    const nextIndex = pad && typeof pad.index === 'number' ? pad.index : null;
    const changed = !!connectedPad !== !!pad || previousIndex !== nextIndex;
    connectedPad = pad;
    if (changed) onConnectionChange(pad);
  }

  function schedule() {
    if (typeof requestFrame === 'function') frameId = requestFrame(poll);
  }

  function poll(timestamp) {
    frameId = 0;
    if (!enabled || destroyed) {
      polling = false;
      return;
    }

    const pad = getPad();
    publishConnection(pad);
    if (!pad) {
      polling = false;
      onRelease();
      return;
    }

    onFrame(pad, standardSnapshot(pad, snapshotOptions), timestamp);
    schedule();
  }

  function start() {
    if (destroyed || !enabled || polling || !getPad()) return false;
    polling = true;
    schedule();
    return true;
  }

  function release() {
    onRelease();
  }

  function stop() {
    if (frameId && typeof cancelFrame === 'function') cancelFrame(frameId);
    frameId = 0;
    polling = false;
    onRelease();
    publishConnection(null);
  }

  function handleConnected() {
    start();
    // Chromium may dispatch gamepadconnected before getGamepads exposes the
    // new pad. A second animation-frame attempt catches that one-frame race.
    if (!polling && typeof requestFrame === 'function') requestFrame(start);
  }

  function handleDisconnected() {
    const pad = getPad();
    publishConnection(pad);
    if (!pad) stop();
  }

  function handleVisibilityChange() {
    if (documentObject?.hidden) release();
  }

  function addListeners() {
    if (!eventTarget?.addEventListener) return;
    eventTarget.addEventListener('gamepadconnected', handleConnected);
    eventTarget.addEventListener('gamepaddisconnected', handleDisconnected);
    eventTarget.addEventListener('pointerdown', start, { passive: true });
    eventTarget.addEventListener('keydown', start, { passive: true });
    eventTarget.addEventListener('blur', release);
    documentObject?.addEventListener?.('visibilitychange', handleVisibilityChange);
  }

  function removeListeners() {
    if (!eventTarget?.removeEventListener) return;
    eventTarget.removeEventListener('gamepadconnected', handleConnected);
    eventTarget.removeEventListener('gamepaddisconnected', handleDisconnected);
    eventTarget.removeEventListener('pointerdown', start);
    eventTarget.removeEventListener('keydown', start);
    eventTarget.removeEventListener('blur', release);
    documentObject?.removeEventListener?.('visibilitychange', handleVisibilityChange);
  }

  function destroy() {
    if (destroyed) return;
    stop();
    destroyed = true;
    removeListeners();
    if (connectedPad) {
      connectedPad = null;
      onConnectionChange(null);
    }
  }

  addListeners();
  if (autoStart) start();

  return {
    start,
    stop,
    release,
    destroy,
    get isActive() {
      return polling;
    },
    get hasGamepad() {
      return !!getPad();
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
}
