import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createPacmanGamepad, pacmanStateFromSnapshot } from '../pacman/js/gamepad-input.js';

function snapshot(overrides = {}) {
  return {
    axes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
    buttons: {
      south: false,
      east: false,
      west: false,
      north: false,
      start: false,
      dpadUp: false,
      dpadDown: false,
      dpadLeft: false,
      dpadRight: false
    },
    ...overrides
  };
}

function rawPad(overrides = {}) {
  return {
    id: 'Pac-Man test pad',
    index: 0,
    connected: true,
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
    ...overrides
  };
}

describe('Pac-Man gamepad mapping', () => {
  it('maps left stick movement into cardinal state and a world vector', () => {
    const state = pacmanStateFromSnapshot(
      snapshot({ axes: { leftX: -0.8, leftY: -0.6, rightX: 0, rightY: 0 } })
    );
    assert.equal(state.directions.left, true);
    assert.equal(state.directions.up, true);
    assert.ok(state.moveVector.x < 0);
    assert.ok(state.moveVector.y > 0);
    assert.ok(Math.abs(Math.hypot(state.moveVector.x, state.moveVector.y) - 1) < 0.0001);
  });

  it('lets the D-pad override analog movement and maps right-stick look', () => {
    const state = pacmanStateFromSnapshot(
      snapshot({
        axes: { leftX: 0.8, leftY: 0, rightX: 0.5, rightY: -0.25 },
        buttons: {
          ...snapshot().buttons,
          dpadLeft: true
        }
      })
    );
    assert.equal(state.directions.left, true);
    assert.equal(state.directions.right, false);
    assert.equal(state.lookX, 2);
    assert.equal(state.lookY, -1);
  });

  it('maps face and menu buttons to semantic actions', () => {
    const state = pacmanStateFromSnapshot(
      snapshot({
        buttons: {
          ...snapshot().buttons,
          south: true,
          north: true,
          start: true
        }
      })
    );
    assert.deepEqual(Array.from(state.buttons).sort(), ['camera', 'primary', 'startMenu']);
  });
});

describe('Pac-Man controller adapter', () => {
  it('edge-triggers actions while streaming movement every frame', () => {
    const controllerPad = rawPad();
    controllerPad.buttons[0] = { pressed: true, value: 1 };
    controllerPad.axes[0] = 1;
    const queue = [];
    const actions = [];
    const moves = [];

    createPacmanGamepad({
      onAction: (action) => actions.push(action),
      onMove: (directions, vector) => moves.push({ directions, vector }),
      controllerOptions: {
        navigatorObject: { getGamepads: () => [controllerPad] },
        eventTarget: null,
        documentObject: null,
        requestFrame(callback) {
          queue.push(callback);
          return queue.length;
        },
        cancelFrame() {}
      }
    });

    queue.shift()(10);
    queue.shift()(20);
    assert.deepEqual(actions, ['primary']);
    assert.equal(moves.length, 2);
    assert.equal(moves[0].directions.right, true);
    assert.ok(moves[0].vector.x > 0);
  });

  it('releases movement when the controller disappears', () => {
    let pads = [rawPad({ axes: [-1, 0, 0, 0] })];
    const queue = [];
    const moves = [];

    createPacmanGamepad({
      onMove: (directions, vector) => moves.push({ directions, vector }),
      controllerOptions: {
        navigatorObject: { getGamepads: () => pads },
        eventTarget: null,
        documentObject: null,
        requestFrame(callback) {
          queue.push(callback);
          return queue.length;
        },
        cancelFrame() {}
      }
    });

    queue.shift()(10);
    pads = [];
    queue.shift()(20);
    assert.equal(moves.at(-1).vector, null);
    assert.deepEqual(moves.at(-1).directions, {
      up: false,
      down: false,
      left: false,
      right: false
    });
  });
});
