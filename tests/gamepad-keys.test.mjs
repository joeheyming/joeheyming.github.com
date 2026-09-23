import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let bridge;

function button(pressed = false) {
  return { pressed, value: pressed ? 1 : 0 };
}

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://joeheyming.github.io/2048/'
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  Object.defineProperty(globalThis, 'navigator', {
    value: Object.assign(dom.window.navigator, { getGamepads: () => [] }),
    configurable: true,
    writable: true
  });
  bridge = await import('../gamepad-keys.js?t=bridge-tests');
});

describe('shared gamepad keyboard bridge', () => {
  it('maps the standard D-pad and face buttons', () => {
    const buttons = Array.from({ length: 16 }, () => button());
    buttons[0] = button(true);
    buttons[14] = button(true);
    const keys = bridge.pressedKeys({ buttons, axes: [0, 0] });
    assert.deepEqual(Array.from(keys).sort(), ['ArrowLeft', 'Enter']);
  });

  it('maps the left stick outside the discrete navigation deadzone', () => {
    const keys = bridge.pressedKeys({
      buttons: [],
      axes: [0.8, -0.8]
    });
    assert.deepEqual(Array.from(keys).sort(), ['ArrowRight', 'ArrowUp']);
  });

  it('ignores analog noise inside the navigation deadzone', () => {
    const keys = bridge.pressedKeys({
      buttons: [],
      axes: [0.2, -0.2]
    });
    assert.equal(keys.size, 0);
  });
});
