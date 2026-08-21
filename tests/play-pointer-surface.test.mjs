/**
 * PointerSurface — press/hold/release semantics used by piano, synth,
 * accordion, etc. Mirrors the interview "Play Piano" acceptance criteria:
 * pointerdown activates; pointerup / pointercancel / lostpointercapture
 * release; chords via simultaneous pointer ids.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPointerSurface } from '../play/shared/pointer-surface.js';

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="root">
      <button type="button" class="key" data-note="C">C</button>
      <button type="button" class="key" data-note="D">D</button>
    </div>
  </body></html>`);
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  // elementFromPoint isn't implemented in JSDOM — hit-test via the event
  // target's closest() path that findTargetFromEvent prefers.
  window.document.elementFromPoint = () => null;
  return { window, document: window.document, root: window.document.getElementById('root') };
}

function dispatch(el, type, props = {}) {
  const event = new el.ownerDocument.defaultView.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: 0,
    clientY: 0,
    ...props
  });
  // JSDOM Event targets don't always set target before dispatch; set it
  // on a plain object when the host reads event.target in capture handlers
  // that fire before retargeting. For bubble listeners on root, target is set.
  el.dispatchEvent(event);
  return event;
}

describe('createPointerSurface', () => {
  let root;
  let surface;
  let entered;
  let left;
  let released;

  beforeEach(() => {
    ({ root } = setupDom());
    entered = [];
    left = [];
    released = [];
    surface = createPointerSurface(root, {
      targetSelector: '.key',
      onEnter: (target, ptrId) => entered.push({ note: target.dataset.note, ptrId }),
      onLeave: (target, ptrId) => left.push({ note: target.dataset.note, ptrId }),
      onRelease: (target, ptrId) =>
        released.push({ note: target ? target.dataset.note : null, ptrId })
    });
  });

  afterEach(() => {
    surface?.destroy();
    surface = null;
  });

  it('pointerdown activates a key; pointerup releases it', () => {
    const keyC = root.querySelector('[data-note="C"]');
    dispatch(keyC, 'pointerdown', { pointerId: 1 });
    assert.deepEqual(entered, [{ note: 'C', ptrId: 1 }]);
    assert.equal(released.length, 0);

    dispatch(keyC, 'pointerup', { pointerId: 1 });
    assert.deepEqual(released, [{ note: 'C', ptrId: 1 }]);
  });

  it('pointercancel clears an active key', () => {
    const keyC = root.querySelector('[data-note="C"]');
    dispatch(keyC, 'pointerdown', { pointerId: 2 });
    dispatch(keyC, 'pointercancel', { pointerId: 2 });
    assert.deepEqual(released, [{ note: 'C', ptrId: 2 }]);
  });

  it('lostpointercapture clears an active key', () => {
    const keyC = root.querySelector('[data-note="C"]');
    dispatch(keyC, 'pointerdown', { pointerId: 3 });
    dispatch(root, 'lostpointercapture', { pointerId: 3 });
    assert.deepEqual(released, [{ note: 'C', ptrId: 3 }]);
  });

  it('lostpointercapture after pointerup does not double-release', () => {
    const keyC = root.querySelector('[data-note="C"]');
    dispatch(keyC, 'pointerdown', { pointerId: 4 });
    dispatch(keyC, 'pointerup', { pointerId: 4 });
    dispatch(root, 'lostpointercapture', { pointerId: 4 });
    assert.equal(released.length, 1);
  });

  it('supports two pointer-held keys at once (chords)', () => {
    const keyC = root.querySelector('[data-note="C"]');
    const keyD = root.querySelector('[data-note="D"]');
    dispatch(keyC, 'pointerdown', { pointerId: 10 });
    dispatch(keyD, 'pointerdown', { pointerId: 11 });
    assert.deepEqual(entered, [
      { note: 'C', ptrId: 10 },
      { note: 'D', ptrId: 11 }
    ]);
    assert.equal(surface.activePointerIds().sort().join(','), '10,11');

    dispatch(keyC, 'pointerup', { pointerId: 10 });
    dispatch(keyD, 'pointerup', { pointerId: 11 });
    assert.deepEqual(released, [
      { note: 'C', ptrId: 10 },
      { note: 'D', ptrId: 11 }
    ]);
  });

  it('releaseAll clears every active pointer', () => {
    const keyC = root.querySelector('[data-note="C"]');
    const keyD = root.querySelector('[data-note="D"]');
    dispatch(keyC, 'pointerdown', { pointerId: 20 });
    dispatch(keyD, 'pointerdown', { pointerId: 21 });
    surface.releaseAll();
    assert.equal(released.length, 2);
    assert.deepEqual(surface.activePointerIds(), []);
  });

  it('a repeated pointerdown without a pointerup releases the previous key', () => {
    const keyC = root.querySelector('[data-note="C"]');
    const keyD = root.querySelector('[data-note="D"]');
    dispatch(keyC, 'pointerdown', { pointerId: 30 });
    dispatch(keyD, 'pointerdown', { pointerId: 30 });

    // C must be left, or the host holds a note forever.
    assert.deepEqual(left, [{ note: 'C', ptrId: 30 }]);
    assert.deepEqual(entered, [
      { note: 'C', ptrId: 30 },
      { note: 'D', ptrId: 30 }
    ]);
    dispatch(keyD, 'pointerup', { pointerId: 30 });
    assert.deepEqual(released, [{ note: 'D', ptrId: 30 }]);
  });
});

/**
 * Drag-across-keys tracking has to stay correct even when a host callback
 * throws. A synth on a browser that refuses to construct an AudioContext
 * throws on every note-on, and the surface must not respond by stranding
 * keys in their pressed state.
 */
describe('createPointerSurface drag tracking', () => {
  let root;
  let surface;
  let entered;
  let left;
  let released;
  let throwOn;

  beforeEach(() => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div id="root">
        <button type="button" class="key" data-note="C">C</button>
        <button type="button" class="key" data-note="D">D</button>
        <button type="button" class="key" data-note="E">E</button>
      </div>
    </body></html>`);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    root = dom.window.document.getElementById('root');

    // Map an x coordinate onto a key so pointermove can hit-test: 0 → C,
    // 10 → D, 20 → E.
    const byX = { 0: 'C', 10: 'D', 20: 'E' };
    dom.window.document.elementFromPoint = (x) =>
      root.querySelector(`[data-note="${byX[x]}"]`) || null;

    entered = [];
    left = [];
    released = [];
    throwOn = null;
    surface = createPointerSurface(root, {
      targetSelector: '.key',
      onEnter: (target, ptrId) => {
        entered.push({ note: target.dataset.note, ptrId });
        if (throwOn === target.dataset.note) throw new Error('synth unavailable');
      },
      onLeave: (target, ptrId) => left.push({ note: target.dataset.note, ptrId }),
      onRelease: (target, ptrId) =>
        released.push({ note: target ? target.dataset.note : null, ptrId })
    });
  });

  afterEach(() => {
    surface?.destroy();
    surface = null;
  });

  it('dragging across keys leaves the old key and enters the new one', () => {
    const keyC = root.querySelector('[data-note="C"]');
    dispatch(keyC, 'pointerdown', { pointerId: 40, clientX: 0 });
    dispatch(root, 'pointermove', { pointerId: 40, clientX: 10 });

    assert.deepEqual(left, [{ note: 'C', ptrId: 40 }]);
    assert.deepEqual(entered, [
      { note: 'C', ptrId: 40 },
      { note: 'D', ptrId: 40 }
    ]);

    dispatch(root, 'pointerup', { pointerId: 40, clientX: 10 });
    assert.deepEqual(released, [{ note: 'D', ptrId: 40 }]);
  });

  it('keeps tracking the newly entered key when onEnter throws', () => {
    const keyC = root.querySelector('[data-note="C"]');
    throwOn = 'D';

    dispatch(keyC, 'pointerdown', { pointerId: 41, clientX: 0 });
    // JSDOM reports the listener exception rather than rethrowing, so the
    // dispatch itself does not need a try/catch here.
    dispatch(root, 'pointermove', { pointerId: 41, clientX: 10 });

    // The release must name D — the key actually under the pointer. Tracking
    // C would strand D in its pressed state permanently.
    dispatch(root, 'pointerup', { pointerId: 41, clientX: 10 });
    assert.deepEqual(released, [{ note: 'D', ptrId: 41 }]);
  });

  it('a whole drag of throwing keys strands nothing', () => {
    const keyC = root.querySelector('[data-note="C"]');
    throwOn = 'D';

    dispatch(keyC, 'pointerdown', { pointerId: 42, clientX: 0 });
    dispatch(root, 'pointermove', { pointerId: 42, clientX: 10 });
    dispatch(root, 'pointermove', { pointerId: 42, clientX: 20 });

    // D threw on enter, but the surface still left it on the way to E.
    assert.deepEqual(left, [
      { note: 'C', ptrId: 42 },
      { note: 'D', ptrId: 42 }
    ]);
    dispatch(root, 'pointerup', { pointerId: 42, clientX: 20 });
    assert.deepEqual(released, [{ note: 'E', ptrId: 42 }]);
  });
});
