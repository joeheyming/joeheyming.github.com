// AudioManager.setPlaybackRate and friends. audioManager.js is SSR-safe
// (the `window.audioManager` debug hook is guarded), so we can import it
// directly under node --test without jsdom.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { audioManager } from '../js/audioManager.js';

/**
 * Construct a fake HTMLAudioElement that records property writes. Modeled
 * after the subset of HTMLMediaElement audioManager.setPlaybackRate
 * touches: `playbackRate`, `preservesPitch`, `mozPreservesPitch`,
 * `webkitPreservesPitch`.
 */
function makeFakeAudio(overrides = {}) {
  const calls = { setters: [] };
  const target = {
    _playbackRate: 1,
    _preservesPitch: true,
    _moz: undefined,
    _webkit: undefined,
    addEventListener() {},
    removeEventListener() {},
    play() {
      return Promise.resolve();
    },
    pause() {},
    load() {},
    get currentTime() {
      return 0;
    },
    set currentTime(_) {},
    get duration() {
      return 0;
    },
    get paused() {
      return true;
    },
    innerHTML: '',
    ...overrides
  };
  Object.defineProperty(target, 'playbackRate', {
    configurable: true,
    get() {
      return target._playbackRate;
    },
    set(v) {
      target._playbackRate = v;
      calls.setters.push(['playbackRate', v]);
    }
  });
  Object.defineProperty(target, 'preservesPitch', {
    configurable: true,
    get() {
      return target._preservesPitch;
    },
    set(v) {
      target._preservesPitch = v;
      calls.setters.push(['preservesPitch', v]);
    }
  });
  Object.defineProperty(target, 'mozPreservesPitch', {
    configurable: true,
    get() {
      return target._moz;
    },
    set(v) {
      target._moz = v;
      calls.setters.push(['mozPreservesPitch', v]);
    }
  });
  Object.defineProperty(target, 'webkitPreservesPitch', {
    configurable: true,
    get() {
      return target._webkit;
    },
    set(v) {
      target._webkit = v;
      calls.setters.push(['webkitPreservesPitch', v]);
    }
  });
  return { element: target, calls };
}

describe('AudioManager — rate mod', () => {
  beforeEach(() => {
    // Reset to a known good baseline. audioManager is a singleton so any
    // residue from a prior test would leak in.
    audioManager.element = null;
    audioManager._playbackRate = 1.0;
    audioManager._preservePitch = true;
  });

  describe('clamping', () => {
    it('passes through valid rates unchanged (besides 2-decimal rounding)', () => {
      assert.equal(audioManager.setPlaybackRate(1.25), 1.25);
      assert.equal(audioManager.setPlaybackRate(0.75), 0.75);
      assert.equal(audioManager.setPlaybackRate(1.0), 1.0);
    });

    it('clamps to [0.5, 2.0] when pitch is preserved', () => {
      assert.equal(audioManager.setPlaybackRate(0.1, true), 0.5);
      assert.equal(audioManager.setPlaybackRate(5.0, true), 2.0);
    });

    it('clamps to [0.5, 3.0] when pitch is not preserved', () => {
      assert.equal(audioManager.setPlaybackRate(0.1, false), 0.5);
      // 2.5 should pass through when pitch is free
      assert.equal(audioManager.setPlaybackRate(2.5, false), 2.5);
      // 5.0 still hits the 3.0 ceiling
      assert.equal(audioManager.setPlaybackRate(5.0, false), 3.0);
    });

    it('rounds to two decimal places to avoid floating-point creep', () => {
      // Stepping by 0.05 ten times should land exactly on 1.5, not
      // 1.4999999999999998. (Tests the rounding in setPlaybackRate.)
      audioManager.setPlaybackRate(1.0);
      for (let i = 0; i < 10; i++) {
        audioManager.setPlaybackRate(audioManager.playbackRate + 0.05);
      }
      assert.equal(audioManager.playbackRate, 1.5);
    });
  });

  describe('caching across loads', () => {
    it('stores rate as JS state independent of any element', () => {
      audioManager.setPlaybackRate(1.25);
      assert.equal(audioManager.playbackRate, 1.25);
      assert.equal(audioManager.preservesPitch, true);
    });

    it('uses cached preservePitch when the second arg is omitted', () => {
      audioManager.setPlaybackRate(1.25, false);
      assert.equal(audioManager.preservesPitch, false);

      audioManager.setPlaybackRate(0.75); // no preservePitch arg → reuse
      assert.equal(audioManager.preservesPitch, false);
      assert.equal(audioManager.playbackRate, 0.75);
    });

    it('range tightens to [0.5, 2.0] when re-enabling pitch preservation', () => {
      audioManager.setPlaybackRate(2.8, false);
      assert.equal(audioManager.playbackRate, 2.8);

      // Re-enabling pitch preserve should clamp the next call back down
      audioManager.setPlaybackRate(2.8, true);
      assert.equal(audioManager.playbackRate, 2.0);
    });
  });

  describe('element binding', () => {
    it('writes to playbackRate and all three preserve-pitch variants', () => {
      const { element, calls } = makeFakeAudio();
      audioManager.element = element;

      audioManager.setPlaybackRate(1.5, true);

      const setters = calls.setters;
      assert.deepEqual(
        setters.find((c) => c[0] === 'playbackRate'),
        ['playbackRate', 1.5]
      );
      assert.deepEqual(
        setters.find((c) => c[0] === 'preservesPitch'),
        ['preservesPitch', true]
      );
      assert.deepEqual(
        setters.find((c) => c[0] === 'mozPreservesPitch'),
        ['mozPreservesPitch', true]
      );
      assert.deepEqual(
        setters.find((c) => c[0] === 'webkitPreservesPitch'),
        ['webkitPreservesPitch', true]
      );
    });

    it('survives a setter that throws (older Safari read-only properties)', () => {
      const { element } = makeFakeAudio();
      Object.defineProperty(element, 'preservesPitch', {
        set() {
          throw new Error('read-only on this build of Safari');
        },
        get() {
          return true;
        }
      });
      audioManager.element = element;

      // Should not throw — the try/catch in setPlaybackRate swallows it.
      const rate = audioManager.setPlaybackRate(1.25);
      assert.equal(rate, 1.25);
      // The cached JS state still updated even though the property set
      // threw, so future loads will retry on a working element.
      assert.equal(audioManager.playbackRate, 1.25);
    });

    it('is a no-op on element bindings when no element is attached', () => {
      audioManager.element = null;
      // Doesn't throw, doesn't crash
      const rate = audioManager.setPlaybackRate(1.5);
      assert.equal(rate, 1.5);
      assert.equal(audioManager.playbackRate, 1.5);
    });
  });

  describe('getRateRange', () => {
    it('returns the appropriate max for the current pitch-preserve mode', () => {
      audioManager.setPlaybackRate(1.0, true);
      assert.deepEqual(audioManager.getRateRange(), { min: 0.5, max: 2.0 });

      audioManager.setPlaybackRate(1.0, false);
      assert.deepEqual(audioManager.getRateRange(), { min: 0.5, max: 3.0 });
    });
  });
});
