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
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
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

  it('maps Start to the play key remote.js already understands', () => {
    const buttons = Array.from({ length: 16 }, () => button());
    buttons[9] = button(true);
    const keys = bridge.pressedKeys({ buttons, axes: [] });
    assert.equal(keys.has('MediaPlayPause'), true);
  });

  it('yields while a game owns the pad', () => {
    document.documentElement.dataset.gamepadNav = 'game';
    assert.equal(bridge.gameOwnsGamepad(), true);
    delete document.documentElement.dataset.gamepadNav;
    assert.equal(bridge.gameOwnsGamepad(), false);
  });

  it('focuses the marked control when nothing else has focus', () => {
    const start = document.createElement('a');
    start.href = '/stepmania/';
    start.setAttribute('data-initial-focus', '');
    start.textContent = 'Play';
    document.body.appendChild(start);
    document.body.focus();
    assert.equal(bridge.focusIdleControl(), true);
    assert.equal(document.activeElement, start);
    assert.equal(bridge.focusIdleControl(), false);
    start.remove();
  });

  it('skips a hidden first button instead of eating every arrow', () => {
    const clear = document.createElement('button');
    clear.textContent = '✕';
    clear.style.display = 'none';
    const chip = document.createElement('button');
    chip.textContent = 'SATIRE';
    document.body.append(clear, chip);
    document.body.focus();
    assert.equal(bridge.focusIdleControl(), true);
    assert.equal(document.activeElement, chip);
    chip.remove();

    document.body.focus();
    assert.equal(bridge.focusIdleControl(), false);
    clear.remove();
  });

  it('sends the key to the focused control inside a shadow host', () => {
    const view = document.defaultView;
    class PadHost extends view.HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        const card = view.document.createElement('button');
        card.id = 'card';
        card.textContent = 'Zelda';
        root.appendChild(card);
      }
    }
    view.customElements.define('pad-host', PadHost);
    const host = view.document.createElement('pad-host');
    document.body.appendChild(host);
    const card = host.shadowRoot.getElementById('card');
    card.focus();
    assert.equal(document.activeElement, host);
    let seen = null;
    card.addEventListener('keydown', (event) => {
      seen = event.target;
    });
    bridge.dispatchGamepadKey('keydown', 'ArrowRight');
    assert.equal(seen, card);
    host.remove();
  });

  it('ignores a button that is already held when the page opens', () => {
    const cancel = document.createElement('button');
    let downs = 0;
    cancel.addEventListener('keydown', () => {
      downs += 1;
    });
    document.body.appendChild(cancel);
    cancel.focus();
    bridge.applyGamepadKeys(new Set(['Enter']), 0);
    bridge.applyGamepadKeys(new Set(['Enter']), 500);
    assert.equal(downs, 0);
    bridge.applyGamepadKeys(new Set(), 600);
    bridge.applyGamepadKeys(new Set(['Enter']), 700);
    assert.equal(downs, 1);
    cancel.remove();
  });
});
