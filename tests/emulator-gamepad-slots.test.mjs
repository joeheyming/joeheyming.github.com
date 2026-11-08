import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'emulator', 'ejs-mount.js'), 'utf8');

function load() {
  const dom = new JSDOM('<!doctype html><html><body><div id="game"></div></body></html>', {
    url: 'http://localhost/emulator/nes/',
    runScripts: 'outside-only'
  });
  dom.window.eval(source);
  return dom.window;
}

describe('packGamepadSlots', () => {
  let pack;

  beforeEach(() => {
    pack = load().emulatorEjsMount.packGamepadSlots;
  });

  it('moves a DualShock 4 sitting in slot 1 down to slot 0', () => {
    const pad = {
      index: 1,
      id: 'DUALSHOCK 4 Wireless Controller (STANDARD GAMEPAD)',
      mapping: 'standard',
      buttons: [{ pressed: true }],
      axes: [0.2, -0.4, 0, 0]
    };
    const packed = pack([null, pad, null, null]);
    assert.equal(packed[0].index, 0);
    assert.equal(packed[0].id, pad.id);
    assert.equal(packed[0].buttons[0].pressed, true);
    assert.equal(packed[0].axes[1], -0.4);
    assert.equal(packed[1], null);
  });

  it('leaves a pad that is already in slot 0 alone', () => {
    const pad = { index: 0, id: 'already-first' };
    const packed = pack([pad, null]);
    assert.equal(packed[0], pad);
  });
});
