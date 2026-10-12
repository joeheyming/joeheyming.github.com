// melonDS reads the stylus from the mouse device. A Windows touchscreen
// never produces those events, so the bridge replays touch and pen as mouse.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'emulator/ejs-mount.js'), 'utf8');

function boot(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    runScripts: 'outside-only'
  });
  dom.window.eval(source);
  return dom;
}

function pointer(window, type, props) {
  const ev = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: props.clientX,
    clientY: props.clientY,
    screenX: props.screenX || 0,
    screenY: props.screenY || 0
  });
  Object.defineProperties(ev, {
    pointerType: { value: props.pointerType },
    pointerId: { value: props.pointerId }
  });
  return ev;
}

describe('NDS touchscreen stylus', () => {
  it('replays a finger on the canvas as mouse down, move, and up', () => {
    const dom = boot('<div id="game"><canvas class="ejs-canvas-no-pointer"></canvas></div>');
    const { window } = dom;
    const canvas = window.document.querySelector('canvas');
    const seen = [];
    canvas.addEventListener('mousedown', (ev) =>
      seen.push(['down', ev.clientX, ev.clientY, ev.buttons])
    );
    canvas.addEventListener('mousemove', (ev) =>
      seen.push(['move', ev.clientX, ev.clientY, ev.buttons])
    );
    canvas.addEventListener('mouseup', (ev) =>
      seen.push(['up', ev.clientX, ev.clientY, ev.buttons])
    );

    assert.equal(window.emulatorEjsMount.installNdsStylus(), true);
    assert.equal(canvas.classList.contains('ejs-canvas-no-pointer'), false);
    assert.equal(canvas.style.touchAction, 'none');

    canvas.dispatchEvent(
      pointer(window, 'pointerdown', {
        pointerType: 'touch',
        pointerId: 3,
        clientX: 40,
        clientY: 80
      })
    );
    canvas.dispatchEvent(
      pointer(window, 'pointermove', {
        pointerType: 'touch',
        pointerId: 3,
        clientX: 48,
        clientY: 90
      })
    );
    canvas.dispatchEvent(
      pointer(window, 'pointerup', { pointerType: 'touch', pointerId: 3, clientX: 48, clientY: 90 })
    );

    assert.deepEqual(seen, [
      ['move', 40, 80, 1],
      ['down', 40, 80, 1],
      ['move', 48, 90, 1],
      ['up', 48, 90, 0]
    ]);
  });

  it('leaves a trackpad click as a single mouse event', () => {
    const dom = boot('<div id="game"><canvas></canvas></div>');
    const { window } = dom;
    const canvas = window.document.querySelector('canvas');
    let downs = 0;
    canvas.addEventListener('mousedown', () => {
      downs += 1;
    });
    window.emulatorEjsMount.installNdsStylus();
    canvas.dispatchEvent(
      pointer(window, 'pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 5, clientY: 5 })
    );
    canvas.dispatchEvent(
      new window.MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 })
    );
    assert.equal(downs, 1);
  });

  it('does not turn a touch on a button into a stylus press', () => {
    const dom = boot('<div id="game"><canvas></canvas><button type="button">Save</button></div>');
    const { window } = dom;
    const canvas = window.document.querySelector('canvas');
    const button = window.document.querySelector('button');
    let downs = 0;
    canvas.addEventListener('mousedown', () => {
      downs += 1;
    });
    window.emulatorEjsMount.installNdsStylus();
    button.dispatchEvent(
      pointer(window, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 1, clientY: 1 })
    );
    assert.equal(downs, 0);
  });

  it('drops the compatibility mouse event Chrome fires after a touch', () => {
    const dom = boot('<div id="game"><canvas></canvas></div>');
    const { window } = dom;
    const canvas = window.document.querySelector('canvas');
    let downs = 0;
    canvas.addEventListener('mousedown', () => {
      downs += 1;
    });
    window.emulatorEjsMount.installNdsStylus();
    const compat = new window.MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 2,
      clientY: 3
    });
    Object.defineProperty(compat, 'sourceCapabilities', { value: { firesTouchEvents: true } });
    canvas.dispatchEvent(compat);
    assert.equal(downs, 0);
  });

  it('strips the no-pointer class if EmulatorJS adds it after launch', async () => {
    const dom = boot('<div id="game"><canvas></canvas></div>');
    const { window } = dom;
    const canvas = window.document.querySelector('canvas');
    window.emulatorEjsMount.installNdsStylus();
    canvas.classList.add('ejs-canvas-no-pointer');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(canvas.classList.contains('ejs-canvas-no-pointer'), false);
  });

  it('installs the bridge when the DS core mounts', () => {
    const dom = boot('<div id="game"></div>');
    dom.window.emulatorEjsMount.mount({
      cfg: { id: 'nds', ejsCore: 'nds', accentHex: '#e11d48' },
      romSource: { name: 'game.nds' },
      romName: 'game.nds'
    });
    assert.equal(dom.window.document.getElementById('game').dataset.ndsStylus, 'on');
  });
});
