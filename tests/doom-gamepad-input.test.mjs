// Unit tests for the Gamepad API mapper in doom/gamepad-input.js.
// Pure mapping only — no SDL, no live controller.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HREF = pathToFileURL(join(__dirname, '..', 'doom', 'gamepad-input.js')).href;

let api;

function button(pressed, value) {
  return { pressed: !!pressed, value: value == null ? (pressed ? 1 : 0) : value };
}

function pad(partial) {
  const buttons = [];
  for (let i = 0; i < 16; i++) buttons[i] = button(false);
  const axes = [0, 0, 0, 0];
  return Object.assign({ connected: true, buttons: buttons, axes: axes, id: 'test-pad' }, partial);
}

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body><canvas id="canvas"></canvas></body></html>', {
    url: 'http://localhost/doom/?flavor=classic'
  });
  const w = dom.window;
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.matchMedia =
    typeof w.matchMedia === 'function'
      ? w.matchMedia.bind(w)
      : function () {
          return {
            matches: false,
            addEventListener: function () {},
            removeEventListener: function () {}
          };
        };
  Object.defineProperty(globalThis, 'navigator', {
    value: w.navigator,
    configurable: true,
    writable: true,
    enumerable: true
  });
  w.navigator.getGamepads = function () {
    return [];
  };
  await import(HREF + '?t=gamepad-mapper-tests');
  api = w.UZDoomGamepad;
});

describe('actionsFromPad', () => {
  it('exports a mapper', () => {
    assert.equal(typeof api.actionsFromPad, 'function');
  });

  it('is idle when no pad is present', () => {
    const mapped = api.actionsFromPad(null);
    assert.equal(mapped.keys.size, 0);
    assert.equal(mapped.lookX, 0);
    assert.equal(mapped.lookY, 0);
  });

  it('maps A to use + confirm and RT to fire', () => {
    const p = pad();
    p.buttons[0] = button(true);
    p.buttons[7] = button(true, 1);
    const mapped = api.actionsFromPad(p);
    assert.equal(mapped.keys.has('use'), true);
    assert.equal(mapped.keys.has('confirm'), true);
    assert.equal(mapped.keys.has('fire'), true);
  });

  it('maps left stick to WASD-style move actions', () => {
    const p = pad();
    p.axes[0] = -0.9;
    p.axes[1] = -0.9;
    const mapped = api.actionsFromPad(p);
    assert.equal(mapped.keys.has('strafeL'), true);
    assert.equal(mapped.keys.has('forward'), true);
    assert.equal(mapped.keys.has('strafeR'), false);
    assert.equal(mapped.keys.has('back'), false);
  });

  it('ignores stick noise inside the deadzone', () => {
    const p = pad();
    p.axes[0] = 0.1;
    p.axes[1] = -0.1;
    const mapped = api.actionsFromPad(p);
    assert.equal(mapped.keys.size, 0);
  });

  it('turns analog look into a scaled look vector', () => {
    const p = pad();
    p.axes[2] = 1;
    p.axes[3] = -1;
    const mapped = api.actionsFromPad(p);
    assert.ok(mapped.lookX > 10);
    assert.ok(mapped.lookY < -10);
  });

  it('maps Start to the menu action', () => {
    const p = pad();
    p.buttons[9] = button(true);
    const mapped = api.actionsFromPad(p);
    assert.equal(mapped.keys.has('menu'), true);
  });
});

describe('firstConnectedPad', () => {
  it('skips holes in the GamepadList', () => {
    const a = pad({ id: 'xbox' });
    assert.equal(api.firstConnectedPad([null, a]).id, 'xbox');
    assert.equal(api.firstConnectedPad([]), null);
  });
});
