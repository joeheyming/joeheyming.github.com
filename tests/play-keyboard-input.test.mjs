/**
 * Shared QWERTY input for piano / synth / accordion — interview-aligned
 * press/hold semantics: ignore key-repeat, case-insensitive letter maps,
 * chords via simultaneous holds, unknown keys ignored.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT_HREF = pathToFileURL(join(__dirname, '..', 'play', 'shared', 'input.js')).href;

function setupDom() {
  const dom = new JSDOM(
    `<!doctype html><html><body>
    <div class="piano-key" data-midi="60" tabindex="0"></div>
  </body></html>`,
    { url: 'http://localhost/play/piano/' }
  );
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  // input.js uses `instanceof HTMLElement` — Node's global lacks it unless
  // we bridge from the JSDOM window.
  globalThis.HTMLElement = window.HTMLElement;
  // attachKeyboardInput listens on window for blur/focus + AudioContext resume
  window.AudioContext = class {
    constructor() {
      this.state = 'running';
    }
    resume() {
      return Promise.resolve();
    }
  };
  window.webkitAudioContext = window.AudioContext;
  return window;
}

function dispatchKey(window, type, { key, code, repeat = false } = {}) {
  const event = new window.KeyboardEvent(type, {
    key,
    code: code || `Key${String(key || '').toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    repeat
  });
  // JSDOM KeyboardEvent.repeat is often not settable via init — force it.
  Object.defineProperty(event, 'repeat', { value: repeat, configurable: true });
  window.document.dispatchEvent(event);
  return event;
}

describe('attachKeyboardInput', () => {
  let window;
  let played;
  let released;
  let keyboard;
  let synth;

  beforeEach(async () => {
    window = setupDom();
    played = [];
    released = [];
    keyboard = {
      midiForKbd(rawKey) {
        const map = { a: 60, s: 62, d: 64, f: 65 };
        const offset = map[String(rawKey || '').toLowerCase()];
        return offset === undefined ? null : offset;
      },
      pressVisual() {},
      setSustain() {},
      addToSustain() {},
      clearActiveVisuals() {}
    };
    synth = {
      noteOn(midi) {
        played.push(midi);
      },
      noteOff(midi) {
        released.push(midi);
      },
      allOff() {}
    };
    // Cache-bust so each file run re-binds against the fresh document.
    const mod = await import(`${INPUT_HREF}?t=${Date.now()}-${Math.random()}`);
    mod.attachKeyboardInput({
      keyboard,
      synth,
      sustainEl: null,
      announceNote() {}
    });
  });

  afterEach(() => {
    // Leave globals; next beforeEach replaces them.
  });

  it('keydown activates the mapped note; keyup releases it', () => {
    dispatchKey(window, 'keydown', { key: 'a' });
    assert.deepEqual(played, [60]);
    dispatchKey(window, 'keyup', { key: 'a' });
    assert.deepEqual(released, [60]);
  });

  it('supports chords via two keydowns', () => {
    dispatchKey(window, 'keydown', { key: 'a' });
    dispatchKey(window, 'keydown', { key: 's' });
    assert.deepEqual(played, [60, 62]);
    dispatchKey(window, 'keyup', { key: 'a' });
    dispatchKey(window, 'keyup', { key: 's' });
    assert.deepEqual(released, [60, 62]);
  });

  it('unknown key leaves all notes inactive', () => {
    dispatchKey(window, 'keydown', { key: 'q' });
    assert.deepEqual(played, []);
  });

  it('repeat: true keydown does not double-activate', () => {
    dispatchKey(window, 'keydown', { key: 'a', repeat: false });
    dispatchKey(window, 'keydown', { key: 'a', repeat: true });
    assert.deepEqual(played, [60]);
  });

  it('lowercase f maps the same as F', () => {
    dispatchKey(window, 'keydown', { key: 'f' });
    assert.deepEqual(played, [65]);
    dispatchKey(window, 'keyup', { key: 'f' });
    assert.deepEqual(released, [65]);
  });

  it('Shift letter keydown still releases on unshifted keyup', () => {
    // keydown while Shift held reports "A"; releasing Shift then A reports "a".
    dispatchKey(window, 'keydown', { key: 'A' });
    assert.deepEqual(played, [60]);
    dispatchKey(window, 'keyup', { key: 'a' });
    assert.deepEqual(released, [60]);
  });
});
