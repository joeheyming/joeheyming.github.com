// PSP has no touchscreen. A finger drives the on-screen pad, and that pad
// only listens for touch events. A Windows touchscreen often sends pointer
// events instead, so the bridge replays a finger or pen as touch.

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
    pointerId: { value: props.pointerId },
    pageX: { value: props.clientX },
    pageY: { value: props.clientY }
  });
  return ev;
}

function mount(dom, id) {
  dom.window.emulatorEjsMount.mount({
    cfg: { id, ejsCore: id, accentHex: '#475569' },
    romSource: { name: 'game.' + id },
    romName: 'game.' + id
  });
}

describe('PSP touch controls', () => {
  it('gives PSP an on-screen pad with the face buttons and the analog stick', () => {
    const dom = boot('<div id="game"></div>');
    mount(dom, 'psp');
    const pad = dom.window.EJS_VirtualGamepadSettings;
    const byId = Object.fromEntries(pad.map((control) => [control.id, control]));
    assert.equal(byId.cross.input_value, 0);
    assert.equal(byId.circle.input_value, 8);
    assert.equal(byId.square.input_value, 1);
    assert.equal(byId.triangle.input_value, 9);
    assert.equal(byId.l.input_value, 10);
    assert.equal(byId.r.input_value, 11);
    assert.deepEqual(Array.from(byId.stick.inputValues), [16, 17, 18, 19]);
    assert.equal(byId.stick.joystickInput, true);
    assert.deepEqual(Array.from(byId.dpad.inputValues), [4, 5, 6, 7]);
  });

  it('leaves other consoles on EmulatorJS’s own pad', () => {
    const dom = boot('<div id="game"></div>');
    mount(dom, 'nes');
    assert.equal(dom.window.EJS_VirtualGamepadSettings, undefined);
    assert.equal(dom.window.EJS_defaultOptions['virtual-gamepad'], undefined);
    assert.equal(dom.window.document.getElementById('game').dataset.pspTouch, undefined);
  });

  it('shows the pad when the device has a touchscreen', () => {
    const dom = boot('<div id="game"></div>');
    delete dom.window.ontouchstart;
    Object.defineProperty(dom.window.navigator, 'maxTouchPoints', { value: 1 });
    mount(dom, 'psp');
    assert.equal(dom.window.EJS_defaultOptions['virtual-gamepad'], 'enabled');
    assert.equal(dom.window.EJS_defaultOptions['save-state-location'], 'browser');
  });

  it('keeps the pad hidden on a mouse-only desktop', () => {
    const dom = boot('<div id="game"></div>');
    delete dom.window.ontouchstart;
    Object.defineProperty(dom.window.navigator, 'maxTouchPoints', { value: 0 });
    mount(dom, 'psp');
    assert.equal(dom.window.EJS_defaultOptions['virtual-gamepad'], undefined);
  });

  it('replays a finger as touch start, move, and end', () => {
    const dom = boot('<div id="game"><button type="button">×</button></div>');
    const { window } = dom;
    const button = window.document.querySelector('button');
    const seen = [];
    button.addEventListener('touchstart', (ev) =>
      seen.push(['start', ev.targetTouches[0].clientX, ev.targetTouches[0].clientY])
    );
    button.addEventListener('touchmove', (ev) =>
      seen.push(['move', ev.targetTouches[0].clientX, ev.targetTouches[0].clientY])
    );
    button.addEventListener('touchend', (ev) => seen.push(['end', ev.targetTouches.length]));

    assert.equal(window.emulatorEjsMount.installPspTouch(), true);
    button.dispatchEvent(
      pointer(window, 'pointerdown', {
        pointerType: 'touch',
        pointerId: 4,
        clientX: 12,
        clientY: 30
      })
    );
    button.dispatchEvent(
      pointer(window, 'pointermove', {
        pointerType: 'touch',
        pointerId: 4,
        clientX: 18,
        clientY: 36
      })
    );
    button.dispatchEvent(
      pointer(window, 'pointerup', { pointerType: 'touch', pointerId: 4, clientX: 18, clientY: 36 })
    );

    assert.deepEqual(seen, [
      ['start', 12, 30],
      ['move', 18, 36],
      ['end', 0]
    ]);
  });

  it('does not add a second touch when the browser already sent one', () => {
    const dom = boot('<div id="game"><button type="button">×</button></div>');
    const { window } = dom;
    const button = window.document.querySelector('button');
    let starts = 0;
    button.addEventListener('touchstart', () => {
      starts += 1;
    });
    window.emulatorEjsMount.installPspTouch();
    button.dispatchEvent(new window.Event('touchstart', { bubbles: true }));
    button.dispatchEvent(
      pointer(window, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 2, clientY: 3 })
    );
    assert.equal(starts, 1);
  });

  it('leaves a mouse click alone', () => {
    const dom = boot('<div id="game"><button type="button">×</button></div>');
    const { window } = dom;
    const button = window.document.querySelector('button');
    let starts = 0;
    button.addEventListener('touchstart', () => {
      starts += 1;
    });
    window.emulatorEjsMount.installPspTouch();
    button.dispatchEvent(
      pointer(window, 'pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 2, clientY: 3 })
    );
    assert.equal(starts, 0);
  });
});

describe('PSP drag-to-aim', () => {
  function bootAim() {
    const dom = boot(
      '<div id="game"><div class="ejs_canvas_parent"><canvas></canvas></div>' +
        '<button type="button">×</button></div>'
    );
    const calls = [];
    dom.window.EJS_emulator = {
      gameManager: { simulateInput: (player, index, value) => calls.push([player, index, value]) }
    };
    assert.equal(dom.window.emulatorEjsMount.installPspDragAim(), true);
    return { dom, calls, canvas: dom.window.document.querySelector('canvas') };
  }

  const last = (calls, index) => [...calls].reverse().find((c) => c[1] === index)?.[2];

  it('pushes the stick the way the finger drags, from where it landed', () => {
    const { dom, calls, canvas } = bootAim();
    const { window } = dom;
    canvas.dispatchEvent(
      pointer(window, 'pointerdown', {
        pointerType: 'touch',
        pointerId: 1,
        clientX: 200,
        clientY: 200
      })
    );
    // 45px left and 90px down of the start: half stick left, full stick down.
    canvas.dispatchEvent(
      pointer(window, 'pointermove', {
        pointerType: 'touch',
        pointerId: 1,
        clientX: 155,
        clientY: 290
      })
    );
    assert.equal(last(calls, 17), Math.round(0x7fff * 0.5));
    assert.equal(last(calls, 16), 0);
    assert.equal(last(calls, 18), 0x7fff);
    assert.equal(last(calls, 19), 0);
  });

  it('clamps a long drag to full deflection', () => {
    const { dom, calls, canvas } = bootAim();
    const { window } = dom;
    canvas.dispatchEvent(
      pointer(window, 'pointerdown', {
        pointerType: 'touch',
        pointerId: 1,
        clientX: 400,
        clientY: 400
      })
    );
    canvas.dispatchEvent(
      pointer(window, 'pointermove', {
        pointerType: 'touch',
        pointerId: 1,
        clientX: 400,
        clientY: 0
      })
    );
    assert.equal(last(calls, 19), 0x7fff);
  });

  it('centres the stick on release, and a drag is not a tap', () => {
    const { dom, calls, canvas } = bootAim();
    const { window } = dom;
    canvas.dispatchEvent(
      pointer(window, 'pointerdown', {
        pointerType: 'touch',
        pointerId: 1,
        clientX: 50,
        clientY: 50
      })
    );
    canvas.dispatchEvent(
      pointer(window, 'pointermove', {
        pointerType: 'touch',
        pointerId: 1,
        clientX: 150,
        clientY: 50
      })
    );
    canvas.dispatchEvent(
      pointer(window, 'pointerup', {
        pointerType: 'touch',
        pointerId: 1,
        clientX: 150,
        clientY: 50
      })
    );
    for (const index of [16, 17, 18, 19]) assert.equal(last(calls, index), 0);
    assert.equal(
      calls.some((c) => c[1] === 0),
      false
    );
  });

  it('turns a quick tap into a Cross press', async () => {
    const { dom, calls, canvas } = bootAim();
    const { window } = dom;
    canvas.dispatchEvent(
      pointer(window, 'pointerdown', {
        pointerType: 'touch',
        pointerId: 1,
        clientX: 50,
        clientY: 50
      })
    );
    canvas.dispatchEvent(
      pointer(window, 'pointerup', { pointerType: 'touch', pointerId: 1, clientX: 51, clientY: 50 })
    );
    assert.deepEqual(
      calls.filter((c) => c[1] === 0),
      [[0, 0, 1]]
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(
      calls.filter((c) => c[1] === 0),
      [
        [0, 0, 1],
        [0, 0, 0]
      ]
    );
  });

  it('also works once EmulatorJS makes the canvas ignore the pointer', () => {
    const { dom, calls } = bootAim();
    const { window } = dom;
    const wrapper = window.document.querySelector('.ejs_canvas_parent');
    wrapper.dispatchEvent(
      pointer(window, 'pointerdown', {
        pointerType: 'touch',
        pointerId: 2,
        clientX: 10,
        clientY: 10
      })
    );
    wrapper.dispatchEvent(
      pointer(window, 'pointermove', {
        pointerType: 'touch',
        pointerId: 2,
        clientX: 100,
        clientY: 10
      })
    );
    assert.equal(last(calls, 16), 0x7fff);
  });

  it('leaves the on-screen buttons alone', () => {
    const { dom, calls } = bootAim();
    const { window } = dom;
    const button = window.document.querySelector('button');
    button.dispatchEvent(
      pointer(window, 'pointerdown', {
        pointerType: 'touch',
        pointerId: 3,
        clientX: 10,
        clientY: 10
      })
    );
    button.dispatchEvent(
      pointer(window, 'pointermove', {
        pointerType: 'touch',
        pointerId: 3,
        clientX: 90,
        clientY: 10
      })
    );
    assert.deepEqual(calls, []);
  });

  it('installs when the PSP core mounts', () => {
    const dom = boot('<div id="game"></div>');
    mount(dom, 'psp');
    assert.equal(dom.window.document.getElementById('game').dataset.pspDrag, 'on');
  });
});
