// Genesis, CD, 32X, and Saturn draw six face buttons. EmulatorJS places
// the outer column past the edge of its 130px cluster, so A and X are clipped.
// The replacement layout keeps every face button inside that cluster.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'emulator/ejs-mount.js'), 'utf8');
const css = readFileSync(join(repoRoot, 'emulator/emulator.css'), 'utf8');

// Matches the face-button size in emulator.css. right + this stays in the cluster.
const FACE = 40;
const CLUSTER = 130;

function boot() {
  const dom = new JSDOM('<!doctype html><html><body><div id="game"></div></body></html>', {
    runScripts: 'outside-only'
  });
  dom.window.eval(source);
  return dom;
}

function mount(dom, core) {
  dom.window.emulatorEjsMount.mount({
    cfg: { id: core, ejsCore: core, accentHex: '#e94560' },
    romSource: { name: 'game.bin' },
    romName: 'game.bin'
  });
}

function byId(pad) {
  return Object.fromEntries(pad.map((control) => [control.id, control]));
}

function fits(button) {
  assert.equal(button.location, 'right');
  assert.ok(button.right + FACE <= CLUSTER, button.id + ' sticks out of the cluster');
  assert.ok(button.top + FACE <= CLUSTER, button.id + ' sticks out of the cluster');
}

describe('Sega six-button touch pad', () => {
  it('keeps Genesis A and X inside the right-hand cluster', () => {
    const dom = boot();
    mount(dom, 'segaMD');
    const pad = byId(dom.window.EJS_VirtualGamepadSettings);
    assert.equal(pad.a.input_value, 1);
    assert.equal(pad.b.input_value, 0);
    assert.equal(pad.c.input_value, 8);
    assert.equal(pad.x.input_value, 10);
    assert.equal(pad.y.input_value, 9);
    assert.equal(pad.z.input_value, 11);
    assert.equal(pad.mode.input_value, 2);
    assert.equal(pad.start.input_value, 3);
    assert.deepEqual(Array.from(pad.dpad.inputValues), [4, 5, 6, 7]);
    for (const id of ['a', 'b', 'c', 'x', 'y', 'z']) fits(pad[id]);
  });

  it('uses the same fit for CD and 32X, and Saturn’s own X/Y indexes', () => {
    for (const core of ['segaCD', 'sega32x']) {
      const dom = boot();
      mount(dom, core);
      const pad = byId(dom.window.EJS_VirtualGamepadSettings);
      assert.equal(pad.x.input_value, 10, core);
      assert.equal(pad.y.input_value, 9, core);
      fits(pad.a);
      fits(pad.x);
    }
    const saturn = boot();
    mount(saturn, 'segaSaturn');
    const pad = byId(saturn.window.EJS_VirtualGamepadSettings);
    assert.equal(pad.x.input_value, 9);
    assert.equal(pad.y.input_value, 10);
    assert.equal(pad.l.input_value, 12);
    assert.equal(pad.r.input_value, 13);
    assert.equal(pad.mode, undefined);
    fits(pad.a);
    fits(pad.x);
  });

  it('leaves two-button Sega pads on EmulatorJS’s own layout', () => {
    const dom = boot();
    mount(dom, 'segaGG');
    assert.equal(dom.window.EJS_VirtualGamepadSettings, undefined);
  });

  it('draws the six face buttons at the size the layout was measured for', () => {
    for (const id of ['a', 'b', 'c', 'x', 'y', 'z']) {
      assert.match(css, new RegExp('\\.cs_segaMD\\.b_' + id + ','));
    }
    assert.match(css, /width:\s*40px;/);
  });
});
