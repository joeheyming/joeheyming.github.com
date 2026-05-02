// Unit tests for the SwipeController factory in touch-input.js.
//
// Only the pure state machine is exercised. The DOM wiring that uses it
// (touchstart handlers, canvas dispatch, lifecycle subscribe) is covered
// by the Playwright e2e, not here.
//
// Shape: the SwipeController is given an onTurn(action, pressed)
// callback. Tests pass a recorder callback and assert the sequence of
// emitted commands matches expectations for each input pattern.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOUCH_JS = readFileSync(join(__dirname, '..', 'legend-of-doom', 'touch-input.js'), 'utf8');

// One jsdom window shared across tests — cheaper than rebuilding per
// test, and the module\'s exported surface is pure and doesn\'t carry
// per-test state.
let factory;
let bindings;
before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/legend-of-doom/'
  });
  dom.window.eval(TOUCH_JS);
  factory = dom.window.LoDTouchInput.createSwipeController;
  bindings = dom.window.LoDTouchInput.bindings;
});

// Helper: build a controller whose onTurn pushes `{action,pressed}`
// records into `calls`. Tests then inspect `calls` directly.
function recorder(opts) {
  const calls = [];
  const ctl = factory(
    Object.assign(
      {
        // Tight timeouts keep tests fast. We drive Date by calling actual
        // real-time setTimeout for the auto-release — acceptable because
        // HOLD_MAX_MS is 100ms and END_GRACE_MS is 60ms in the defaults.
        threshold: 3,
        holdMaxMs: 100,
        onTurn: (action, pressed) => calls.push({ action, pressed })
      },
      opts || {}
    )
  );
  return { ctl, calls };
}

// Deterministic wait helper. Tests use real timers for the controller\'s
// release schedule; sleep long enough past HOLD_MAX_MS+END_GRACE_MS for
// the auto-release to fire.
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('SwipeController: basic behaviour', () => {
  it('does nothing before start()', () => {
    const { ctl, calls } = recorder();
    ctl.move(100);
    assert.equal(calls.length, 0);
  });

  it('sub-threshold moves do not emit', () => {
    const { ctl, calls } = recorder({ threshold: 10 });
    ctl.start(100);
    ctl.move(105); // +5 px, below threshold of 10
    ctl.move(108); // 100→108=+8, still below
    assert.equal(calls.length, 0);
  });

  it('rightward drag emits turnR pressed', () => {
    const { ctl, calls } = recorder();
    ctl.start(100);
    ctl.move(120); // +20 px
    assert.deepEqual(calls, [{ action: 'turnR', pressed: true }]);
  });

  it('leftward drag emits turnL pressed', () => {
    const { ctl, calls } = recorder();
    ctl.start(100);
    ctl.move(80); // -20 px
    assert.deepEqual(calls, [{ action: 'turnL', pressed: true }]);
  });

  it('same-direction sustained drag emits only one press', () => {
    const { ctl, calls } = recorder();
    ctl.start(100);
    ctl.move(110);
    ctl.move(120);
    ctl.move(130);
    assert.deepEqual(calls, [{ action: 'turnR', pressed: true }]);
  });

  it('move() returns true when a command was emitted, false otherwise', () => {
    // Noise floor: each move() call compares against the last-emitted
    // position, so a slow drag whose per-call delta is below threshold
    // never emits — intentional, so tiny finger tremor while resting on
    // the screen doesn\'t trigger turns.
    const { ctl } = recorder({ threshold: 10 });
    ctl.start(100);
    assert.equal(ctl.move(103), false, 'sub-threshold returns false');
    assert.equal(ctl.move(120), true, 'crossed threshold returns true');
    assert.equal(ctl.move(125), false, 'per-call delta of 5 below threshold of 10');
    assert.equal(ctl.move(140), true, 'per-call delta of 15 above threshold');
  });
});

describe('SwipeController: direction switching', () => {
  it('switches by releasing old direction before pressing new', () => {
    const { ctl, calls } = recorder();
    ctl.start(100);
    ctl.move(120); // right
    // To go back to "left" relative to lastX (now 120), subtract enough
    // to cross threshold. lastX resets on every emit, so next move's
    // dx is measured from 120.
    ctl.move(90); // -30 px from 120
    assert.deepEqual(calls, [
      { action: 'turnR', pressed: true },
      { action: 'turnR', pressed: false },
      { action: 'turnL', pressed: true }
    ]);
  });

  it('introspection getters reflect current direction', () => {
    const { ctl } = recorder();
    ctl.start(100);
    assert.equal(ctl._dir(), null);
    assert.equal(ctl._active(), true);
    ctl.move(120);
    assert.equal(ctl._dir(), 'turnR');
  });
});

describe('SwipeController: end() grace-period release', () => {
  it('end() releases the active direction after the grace period', async () => {
    const { ctl, calls } = recorder();
    ctl.start(100);
    ctl.move(120); // press turnR
    ctl.end();
    // Before the grace period elapses, still pressed.
    await sleep(20);
    assert.deepEqual(calls, [{ action: 'turnR', pressed: true }]);
    // After ≥ END_GRACE_MS (60 ms in module defaults).
    await sleep(80);
    assert.deepEqual(calls, [
      { action: 'turnR', pressed: true },
      { action: 'turnR', pressed: false }
    ]);
  });

  it('end() with no active direction is a no-op', async () => {
    const { ctl, calls } = recorder();
    ctl.end();
    await sleep(80);
    assert.deepEqual(calls, []);
  });
});

describe('SwipeController: clear()', () => {
  it('clear() releases immediately without waiting for grace', () => {
    const { ctl, calls } = recorder();
    ctl.start(100);
    ctl.move(120);
    ctl.clear();
    assert.deepEqual(calls, [
      { action: 'turnR', pressed: true },
      { action: 'turnR', pressed: false }
    ]);
    assert.equal(ctl._dir(), null);
  });

  it('clear() on idle controller does nothing', () => {
    const { ctl, calls } = recorder();
    ctl.clear();
    assert.deepEqual(calls, []);
  });
});

describe('SwipeController: auto-release on stationary hold', () => {
  it('key auto-releases if no move event arrives within the hold window', async () => {
    const { ctl, calls } = recorder({ holdMaxMs: 40 });
    ctl.start(100);
    ctl.move(120); // press turnR, schedules auto-release
    // Each move re-schedules the release; stop issuing moves and wait.
    await sleep(80); // > holdMaxMs + slack
    assert.deepEqual(calls, [
      { action: 'turnR', pressed: true },
      { action: 'turnR', pressed: false }
    ]);
  });
});

describe('BINDINGS table contract', () => {
  it('every BINDINGS entry has key + code + keyCode', () => {
    for (const [name, b] of Object.entries(bindings)) {
      assert.equal(typeof b.key, 'string', `${name}.key is a string`);
      assert.equal(typeof b.code, 'string', `${name}.code is a string`);
      assert.equal(typeof b.keyCode, 'number', `${name}.keyCode is a number`);
      assert.ok(b.keyCode > 0, `${name}.keyCode is positive`);
    }
  });

  it('no binding carries alsoMouse (mouse1 is unbound server-side)', () => {
    // We used to dispatch a synthetic mousedown for FIRE so Doom's
    // default mouse1=+attack fired. Now the engine argv unbinds
    // mouse1 at startup (to stop SDL2's touch→mouse synthesis from
    // triggering +attack on every mobile swipe), and FIRE lives on
    // the Ctrl key only. No binding should carry the old `alsoMouse`
    // escape hatch — if one reappears it almost certainly means
    // someone brought the sword-fires-on-swipe bug back.
    const alsoMouse = Object.entries(bindings)
      .filter(([, b]) => b.alsoMouse)
      .map(([name]) => name);
    assert.deepEqual(alsoMouse, []);
  });

  it('USE is bound to KeyE (not Space)', () => {
    // Regression guard: the single most common GZDoom key-mapping
    // landmine. Space is +jump; USE should be KeyE.
    assert.equal(bindings.use.code, 'KeyE');
    assert.equal(bindings.use.keyCode, 69);
  });

  it('turn bindings exist for both directions (used by SwipeController)', () => {
    assert.ok(bindings.turnL, 'turnL binding exists');
    assert.ok(bindings.turnR, 'turnR binding exists');
    assert.equal(bindings.turnL.code, 'ArrowLeft');
    assert.equal(bindings.turnR.code, 'ArrowRight');
  });
});
