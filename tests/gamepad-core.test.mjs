import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  STANDARD_BUTTONS,
  axisCurve,
  axisDigital,
  buttonDown,
  createGamepadController,
  firstConnectedPad,
  standardSnapshot
} from '../gamepad-core.js';

function button(pressed = false, value = pressed ? 1 : 0) {
  return { pressed, value };
}

function pad(overrides = {}) {
  return {
    id: 'Standard test controller',
    index: 0,
    connected: true,
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, () => button()),
    axes: [0, 0, 0, 0],
    ...overrides
  };
}

describe('gamepad normalization', () => {
  it('normalizes object and numeric button values', () => {
    assert.equal(buttonDown(button(true)), true);
    assert.equal(buttonDown(button(false, 0.8)), true);
    assert.equal(buttonDown(0.8), true);
    assert.equal(buttonDown(null), false);
  });

  it('applies digital and curved analog deadzones', () => {
    assert.equal(axisDigital(0.1), 0);
    assert.equal(axisDigital(-0.8), -1);
    assert.equal(axisDigital(0.8), 1);
    assert.equal(axisCurve(0.1), 0);
    assert.equal(axisCurve(1), 1);
    assert.equal(axisCurve(-1), -1);
    assert.ok(axisCurve(0.6) > 0 && axisCurve(0.6) < 0.6);
  });

  it('skips holes and disconnected entries', () => {
    const connected = pad({ index: 2 });
    assert.equal(firstConnectedPad([null, pad({ connected: false }), connected]), connected);
    assert.equal(firstConnectedPad([]), null);
  });

  it('builds a named W3C-standard snapshot', () => {
    const controller = pad();
    controller.buttons[STANDARD_BUTTONS.SOUTH] = button(true);
    controller.buttons[STANDARD_BUTTONS.RIGHT_TRIGGER] = button(false, 0.9);
    controller.axes = [-1, 1, 0.5, -0.5];

    const snapshot = standardSnapshot(controller);
    assert.equal(snapshot.buttons.south, true);
    assert.equal(snapshot.buttons.rightTrigger, true);
    assert.equal(snapshot.buttons.east, false);
    assert.equal(snapshot.axes.leftX, -1);
    assert.equal(snapshot.axes.leftY, 1);
    assert.ok(snapshot.axes.rightX > 0);
    assert.ok(snapshot.axes.rightY < 0);
  });
});

describe('gamepad controller lifecycle', () => {
  it('owns one frame loop and releases when the pad disappears', () => {
    let currentPads = [pad()];
    const frames = [];
    const connections = [];
    let releases = 0;
    let nextId = 0;
    const queued = new Map();

    const controller = createGamepadController({
      navigatorObject: { getGamepads: () => currentPads },
      eventTarget: null,
      documentObject: null,
      requestFrame(callback) {
        nextId += 1;
        queued.set(nextId, callback);
        return nextId;
      },
      cancelFrame(id) {
        queued.delete(id);
      },
      onFrame(raw, snapshot) {
        frames.push({ raw, snapshot });
      },
      onConnectionChange(connected) {
        connections.push(connected ? connected.id : null);
      },
      onRelease() {
        releases += 1;
      }
    });

    assert.equal(controller.isActive, true);
    assert.equal(queued.size, 1);

    const first = queued.entries().next().value;
    queued.delete(first[0]);
    first[1](10);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].snapshot.id, 'Standard test controller');
    assert.deepEqual(connections, ['Standard test controller']);
    assert.equal(queued.size, 1);

    currentPads = [];
    const second = queued.entries().next().value;
    queued.delete(second[0]);
    second[1](20);
    assert.equal(controller.isActive, false);
    assert.deepEqual(connections, ['Standard test controller', null]);
    assert.equal(releases, 1);
  });

  it('can be disabled and re-enabled without duplicate loops', () => {
    const queued = [];
    const controller = createGamepadController({
      navigatorObject: { getGamepads: () => [pad()] },
      eventTarget: null,
      documentObject: null,
      requestFrame(callback) {
        queued.push(callback);
        return queued.length;
      },
      cancelFrame() {}
    });

    assert.equal(queued.length, 1);
    assert.equal(controller.start(), false);
    assert.equal(queued.length, 1);
    controller.disable();
    assert.equal(controller.isActive, false);
    controller.enable();
    assert.equal(controller.isActive, true);
    assert.equal(queued.length, 2);
  });
});
