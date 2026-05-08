// Unit tests for doom/lifecycle.js (Legend-of-DOOM-derived lifecycle).
//
// The module is an IIFE that assigns `window.LoDLifecycle`, so we run it
// inside a fresh jsdom window per test. freshLifecycle() returns that
// singleton plus the `window` so tests can poke at timers / history.
//
// Only the public surface (get / subscribe / mark* / history / etc.) is
// asserted. Internal fields (TERMINAL table, subscriber list) are kept
// private on purpose; tests that relied on them would become brittle the
// moment we rename anything.

import { describe, it } from 'node:test';
// Non-strict assert: `deepEqual` does structural equality without the
// cross-realm Array/Object prototype identity check that strict adds.
// lifecycle.js runs inside a jsdom window, so values we get back have
// jsdom-realm prototypes; structural equality is what we actually care
// about. Primitives still use `.equal` which is strict by default.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIFECYCLE_JS = readFileSync(join(__dirname, '..', 'doom', 'lifecycle.js'), 'utf8');

function freshLifecycle() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/doom/?flavor=legend'
  });
  dom.window.eval(LIFECYCLE_JS);
  return { lc: dom.window.LoDLifecycle, win: dom.window };
}

describe('lifecycle: initial state', () => {
  it('starts in `loading` phase', () => {
    const { lc } = freshLifecycle();
    assert.equal(lc.get(), 'loading');
    assert.equal(lc.detail(), null);
    assert.equal(lc.isTerminal(), false);
    assert.equal(lc.isRunning(), false);
  });

  it('history contains the initial transition', () => {
    const { lc } = freshLifecycle();
    const h = lc.history();
    assert.equal(h.length, 1);
    assert.equal(h[0].from, null);
    assert.equal(h[0].phase, 'loading');
  });

  it("exposes a frozen PHASES list that can't be mutated", () => {
    const { lc } = freshLifecycle();
    assert.deepEqual(Array.from(lc.PHASES), [
      'loading',
      'primed',
      'launching',
      'playing',
      'exited',
      'error'
    ]);
    // Frozen → push throws in strict mode. Swallow and assert the array
    // stayed intact either way (silent-fail in sloppy mode still counts).
    try {
      lc.PHASES.push('zombie');
    } catch (_e) {
      /* expected in strict */
    }
    assert.equal(lc.PHASES.length, 6, 'frozen list did not gain elements');
  });
});

describe('lifecycle: valid transitions', () => {
  it('loading → primed → launching → playing → exited', () => {
    const { lc } = freshLifecycle();
    assert.equal(lc.markPrimed({ iwad: 'freedoom1.wad' }), true);
    assert.equal(lc.get(), 'primed');
    assert.deepEqual(lc.detail(), { iwad: 'freedoom1.wad' });

    assert.equal(lc.markLaunching(), true);
    assert.equal(lc.get(), 'launching');
    assert.equal(lc.isRunning(), true);

    assert.equal(lc.markPlaying(), true);
    assert.equal(lc.get(), 'playing');
    assert.equal(lc.isRunning(), true);

    assert.equal(lc.markExited(0, 'quit'), true);
    assert.equal(lc.get(), 'exited');
    assert.equal(lc.isTerminal(), true);
    assert.equal(lc.isRunning(), false);
  });

  it('loading → error is a terminal transition', () => {
    const { lc } = freshLifecycle();
    assert.equal(lc.markError('coi', { budgetMs: 8000 }), true);
    assert.equal(lc.get(), 'error');
    assert.equal(lc.isTerminal(), true);
    assert.deepEqual(lc.detail(), { reason: 'coi', detail: { budgetMs: 8000 } });
  });

  it('same-phase set is an idempotent no-op', () => {
    const { lc } = freshLifecycle();
    lc.markPrimed({ iwad: 'a' });
    assert.equal(lc.markPrimed({ iwad: 'b' }), false, 'same-phase re-entry returns false');
    // Detail is unchanged because the transition didn\'t apply.
    assert.deepEqual(lc.detail(), { iwad: 'a' });
  });
});

describe('lifecycle: terminal-state lockout', () => {
  it('exited refuses further marks', () => {
    const { lc } = freshLifecycle();
    lc.markPrimed();
    lc.markLaunching();
    lc.markPlaying();
    lc.markExited(0, 'quit');

    assert.equal(lc.markPlaying(), false);
    assert.equal(lc.markError('wasm-abort'), false);
    assert.equal(lc.get(), 'exited', 'phase is still exited');
  });

  it('error refuses further marks', () => {
    const { lc } = freshLifecycle();
    lc.markError('coi');

    assert.equal(lc.markPrimed(), false);
    assert.equal(lc.markLaunching(), false);
    assert.equal(lc.markPlaying(), false);
    assert.equal(lc.markExited(0, 'quit'), false);
    assert.equal(lc.get(), 'error', 'phase is still error');
  });
});

describe('lifecycle: unprime escape hatch', () => {
  it('unprimes from primed → loading', () => {
    const { lc } = freshLifecycle();
    lc.markPrimed({ iwad: 'a' });
    assert.equal(lc.unprime(), true);
    assert.equal(lc.get(), 'loading');
    assert.equal(lc.detail(), null);
  });

  it('unprimes from launching → loading', () => {
    const { lc } = freshLifecycle();
    lc.markPrimed();
    lc.markLaunching();
    assert.equal(lc.unprime(), true);
    assert.equal(lc.get(), 'loading');
  });

  it('refuses to unprime from playing', () => {
    const { lc } = freshLifecycle();
    lc.markPrimed();
    lc.markLaunching();
    lc.markPlaying();
    assert.equal(lc.unprime(), false);
    assert.equal(lc.get(), 'playing');
  });

  it('refuses to unprime from loading', () => {
    const { lc } = freshLifecycle();
    assert.equal(lc.unprime(), false);
  });

  it('refuses to unprime from terminal states', () => {
    const { lc } = freshLifecycle();
    lc.markError('coi');
    assert.equal(lc.unprime(), false);
    assert.equal(lc.get(), 'error');
  });
});

describe('lifecycle: subscribers', () => {
  it('fires on subscribe with current state and null `from`', () => {
    const { lc } = freshLifecycle();
    const calls = [];
    lc.subscribe((state, from) => calls.push({ phase: state.phase, from }));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { phase: 'loading', from: null });
  });

  it('fires on every real transition', () => {
    const { lc } = freshLifecycle();
    const phases = [];
    lc.subscribe((state) => phases.push(state.phase));
    lc.markPrimed();
    lc.markLaunching();
    lc.markPlaying();
    assert.deepEqual(phases, ['loading', 'primed', 'launching', 'playing']);
  });

  it('does NOT fire for idempotent same-phase set', () => {
    const { lc } = freshLifecycle();
    const phases = [];
    lc.subscribe((state) => phases.push(state.phase));
    phases.length = 0; // drop the initial catch-up fire
    lc.markPrimed({ iwad: 'a' });
    lc.markPrimed({ iwad: 'b' }); // same phase
    assert.deepEqual(phases, ['primed'], 'only one transition dispatched');
  });

  it('unsubscribe stops further notifications', () => {
    const { lc } = freshLifecycle();
    const phases = [];
    const unsub = lc.subscribe((state) => phases.push(state.phase));
    phases.length = 0;
    unsub();
    lc.markPrimed();
    assert.deepEqual(phases, []);
  });

  it('subscriber that throws does not break the chain', () => {
    const { lc } = freshLifecycle();
    const good = [];
    lc.subscribe(() => {
      throw new Error('boom');
    });
    lc.subscribe((state) => good.push(state.phase));
    good.length = 0;
    // Should not throw up into the caller.
    assert.doesNotThrow(() => lc.markPrimed());
    assert.deepEqual(good, ['primed']);
  });

  it('subscribers added during dispatch do not fire for the current transition', () => {
    const { lc } = freshLifecycle();
    const lateCalls = [];
    lc.subscribe((state) => {
      if (state.phase === 'primed') {
        lc.subscribe((s) => lateCalls.push(s.phase));
      }
    });
    lc.markPrimed();
    // The late subscriber was registered mid-dispatch; it still gets its
    // initial catch-up fire (with phase='primed') but does NOT re-receive
    // the 'primed' transition that was already being dispatched.
    assert.deepEqual(lateCalls, ['primed']);
    lc.markLaunching();
    assert.deepEqual(lateCalls, ['primed', 'launching']);
  });
});

describe('lifecycle: history', () => {
  it('records every successful transition with monotonic timestamps', () => {
    const { lc } = freshLifecycle();
    lc.markPrimed();
    lc.markLaunching();
    lc.markPlaying();
    const h = lc.history();
    assert.equal(h.length, 4, 'initial + 3 transitions');
    for (let i = 1; i < h.length; i++) {
      assert.ok(h[i].t >= h[i - 1].t, 't is non-decreasing');
    }
    assert.deepEqual(
      h.map((e) => e.phase),
      ['loading', 'primed', 'launching', 'playing']
    );
  });

  it('does NOT record idempotent no-ops', () => {
    const { lc } = freshLifecycle();
    lc.markPrimed();
    const before = lc.history().length;
    lc.markPrimed();
    assert.equal(lc.history().length, before);
  });

  it('does NOT record rejected transitions from terminal state', () => {
    const { lc } = freshLifecycle();
    lc.markError('coi');
    const before = lc.history().length;
    lc.markPlaying();
    assert.equal(lc.history().length, before);
  });
});

describe('lifecycle: invalid phase names', () => {
  // markX functions are the ONLY public way to transition, but confirm
  // they reject invalid phases cleanly via a test that would fail on a
  // future refactor that adds a public `set()` escape hatch.
  it('only the documented markers exist on the public API', () => {
    const { lc } = freshLifecycle();
    const markers = Object.keys(lc).filter((k) => k.startsWith('mark'));
    assert.deepEqual(markers.sort(), [
      'markError',
      'markExited',
      'markLaunching',
      'markPlaying',
      'markPrimed'
    ]);
  });
});
