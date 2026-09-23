import { createGamepadController } from '../../gamepad-core.js';

const DIRECTION_THRESHOLD = 0.2;
const LOOK_SPEED = 4;

export function pacmanStateFromSnapshot(snapshot) {
  if (!snapshot) {
    return {
      directions: { up: false, down: false, left: false, right: false },
      moveVector: null,
      lookX: 0,
      lookY: 0,
      buttons: new Set()
    };
  }

  const { axes, buttons } = snapshot;
  let x = axes.leftX;
  let y = axes.leftY;

  if (buttons.dpadLeft) x = -1;
  if (buttons.dpadRight) x = 1;
  if (buttons.dpadUp) y = -1;
  if (buttons.dpadDown) y = 1;

  const directions = {
    up: y < -DIRECTION_THRESHOLD,
    down: y > DIRECTION_THRESHOLD,
    left: x < -DIRECTION_THRESHOLD,
    right: x > DIRECTION_THRESHOLD
  };

  const magnitude = Math.hypot(x, y);
  const moveVector =
    magnitude > DIRECTION_THRESHOLD ? { x: x / magnitude, y: -y / magnitude } : null;

  const activeButtons = new Set();
  if (buttons.south) activeButtons.add('primary');
  if (buttons.east) activeButtons.add('menu');
  if (buttons.west) activeButtons.add('restart');
  if (buttons.north) activeButtons.add('camera');
  if (buttons.start) activeButtons.add('startMenu');

  return {
    directions,
    moveVector,
    lookX: axes.rightX * LOOK_SPEED,
    lookY: axes.rightY * LOOK_SPEED,
    buttons: activeButtons
  };
}

export function createPacmanGamepad({
  onMove = () => {},
  onLook = () => {},
  onAction = () => {},
  onConnectionChange = () => {},
  controllerOptions = {}
} = {}) {
  let heldButtons = new Set();

  function release() {
    heldButtons = new Set();
    onMove({ up: false, down: false, left: false, right: false }, null);
  }

  function frame(_pad, snapshot) {
    const state = pacmanStateFromSnapshot(snapshot);
    onMove(state.directions, state.moveVector);
    if (state.lookX || state.lookY) onLook(state.lookX, state.lookY);

    state.buttons.forEach((action) => {
      if (!heldButtons.has(action)) onAction(action);
    });
    heldButtons = state.buttons;
  }

  return createGamepadController({
    ...controllerOptions,
    onFrame: frame,
    onConnectionChange,
    onRelease: release
  });
}
