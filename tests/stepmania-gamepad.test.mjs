import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  chartOwnsPad,
  mappingNameForGamepad,
  STANDARD_DANCE_BUTTONS
} from '../stepmania/js/gamepad-map.js';

describe('chartOwnsPad', () => {
  it('leaves the pad to menus while the song card is up', () => {
    const dom = new JSDOM(
      '<!doctype html><body><div id="sm-home"></div><loading-overlay id="loading-overlay"></loading-overlay></body>'
    );
    const { window } = dom;
    globalThis.getComputedStyle = window.getComputedStyle.bind(window);
    const doc = window.document;
    const home = doc.getElementById('sm-home');
    const overlay = doc.getElementById('loading-overlay');
    const root = overlay.attachShadow({ mode: 'open' });
    root.innerHTML = '<div role="dialog" aria-modal="true" id="card">Start</div>';

    assert.equal(chartOwnsPad(doc), false, 'home is showing');
    home.hidden = true;
    assert.equal(chartOwnsPad(doc), false, 'song card is open over the chart');
    overlay.state = 'ready';
    assert.equal(chartOwnsPad(doc), false);
    overlay.state = 'hidden';
    root.getElementById('card').hidden = true;
    assert.equal(chartOwnsPad(doc), true, 'card closed, chart is playing');
    window.close();
  });
});

describe('mappingNameForGamepad', () => {
  it('uses the W3C map for a DualShock 4 Chrome reports as standard', () => {
    assert.equal(
      mappingNameForGamepad({
        id: 'DUALSHOCK 4 Wireless Controller (STANDARD GAMEPAD)',
        mapping: 'standard'
      }),
      'standard'
    );
    assert.deepEqual(
      {
        left: STANDARD_DANCE_BUTTONS.left,
        right: STANDARD_DANCE_BUTTONS.right,
        up: STANDARD_DANCE_BUTTONS.up,
        down: STANDARD_DANCE_BUTTONS.down
      },
      { left: 14, right: 15, up: 12, down: 13 }
    );
    assert.equal(STANDARD_DANCE_BUTTONS.leftAlt, 2);
    assert.equal(STANDARD_DANCE_BUTTONS.downAlt, 0);
  });

  it('keeps a dance pad on its own map', () => {
    assert.equal(mappingNameForGamepad({ id: 'USB Dance Pad', mapping: '' }), 'dancePad');
  });

  it('keeps an unnamed non-standard pad on the dance-pad map', () => {
    assert.equal(mappingNameForGamepad({ id: 'Generic USB Joystick', mapping: '' }), 'dancePad');
  });
});
