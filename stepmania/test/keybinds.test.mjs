import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  InputManager,
  KEYBINDS_STORAGE_KEY,
  parseStoredKeyBindings,
  serializeKeyBindings,
  isReservedActionKey,
  keyCodeLabel,
  COLUMNS
} from '../js/inputManager.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    _map: map
  };
}

describe('keybind persistence helpers', () => {
  it('round-trips serialize/parse', () => {
    const bindings = { 74: COLUMNS.LEFT, 75: COLUMNS.DOWN };
    const parsed = parseStoredKeyBindings(serializeKeyBindings(bindings));
    assert.equal(parsed[74], COLUMNS.LEFT);
    assert.equal(parsed[75], COLUMNS.DOWN);
  });

  it('drops reserved action keys from stored data', () => {
    const parsed = parseStoredKeyBindings({ 32: 0, 65: 0 });
    assert.equal(parsed[32], undefined);
    assert.equal(parsed[65], COLUMNS.LEFT);
  });

  it('falls back to defaults on empty/invalid input', () => {
    const parsed = parseStoredKeyBindings(null);
    assert.equal(parsed[65], COLUMNS.LEFT);
    assert.equal(parsed[37], COLUMNS.LEFT);
  });

  it('labels common keys', () => {
    assert.equal(keyCodeLabel(65), 'A');
    assert.equal(keyCodeLabel(37), '←');
    assert.equal(isReservedActionKey(32), true);
    assert.equal(isReservedActionKey(65), false);
  });
});

describe('InputManager bind/unbind/persist', () => {
  /** @type {InputManager} */
  let mgr;
  let storage;

  beforeEach(() => {
    storage = memoryStorage();
    mgr = new InputManager({ forTests: true, storage });
  });

  it('persists a custom bind and reloads it', () => {
    assert.equal(mgr.bindKey(74, COLUMNS.LEFT), true);
    const raw = storage.getItem(KEYBINDS_STORAGE_KEY);
    assert.ok(raw);

    const reloaded = new InputManager({ forTests: true, storage });
    assert.equal(reloaded.getKeyBindings()[74], COLUMNS.LEFT);
    assert.ok(reloaded.getKeysForColumn(COLUMNS.LEFT).includes(74));
  });

  it('unbind removes a key and persists', () => {
    mgr.bindKey(74, COLUMNS.LEFT);
    mgr.unbindKey(74);
    assert.equal(mgr.getKeyBindings()[74], undefined);
    const reloaded = new InputManager({ forTests: true, storage });
    assert.equal(reloaded.getKeyBindings()[74], undefined);
  });

  it('rejects reserved action keys', () => {
    assert.equal(mgr.bindKey(32, COLUMNS.LEFT), false);
    assert.equal(mgr.getKeyBindings()[32], undefined);
  });

  it('reset restores WASD + arrows and persists', () => {
    mgr.bindKey(74, COLUMNS.LEFT);
    mgr.unbindKey(65);
    mgr.resetKeyBindings();
    assert.equal(mgr.getKeyBindings()[65], COLUMNS.LEFT);
    assert.equal(mgr.getKeyBindings()[74], undefined);
    const reloaded = new InputManager({ forTests: true, storage });
    assert.equal(reloaded.getKeyBindings()[65], COLUMNS.LEFT);
  });
});

function keyEvent(keyCode, target, extra = {}) {
  const calls = { prevented: false, stopped: false, immediate: false };
  return {
    calls,
    event: {
      which: keyCode,
      keyCode,
      target,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault() {
        calls.prevented = true;
      },
      stopPropagation() {
        calls.stopped = true;
      },
      stopImmediatePropagation() {
        calls.immediate = true;
      },
      ...extra
    }
  };
}

describe('bound keys swallow page shortcuts', () => {
  /** @type {InputManager} */
  let mgr;

  beforeEach(() => {
    mgr = new InputManager({ forTests: true, storage: memoryStorage() });
  });

  it('F bound to a lane steps and stops other listeners', () => {
    mgr.bindKey(70, COLUMNS.DOWN);
    const steps = [];
    mgr.onStep((col) => steps.push(col));
    const { event, calls } = keyEvent(70, {
      tagName: 'BODY',
      nodeName: 'BODY',
      isContentEditable: false
    });
    mgr._onKeyDown(event);
    assert.deepEqual(steps, [COLUMNS.DOWN]);
    assert.equal(calls.prevented, true);
    assert.equal(calls.stopped, true);
    assert.equal(calls.immediate, true);
    assert.equal(mgr.isColumnKey(event), true);
  });

  it('unbound F is left for the fullscreen shortcut', () => {
    const { event, calls } = keyEvent(70, {
      tagName: 'BODY',
      nodeName: 'BODY',
      isContentEditable: false
    });
    mgr._onKeyDown(event);
    assert.equal(calls.stopped, false);
    assert.equal(calls.immediate, false);
    assert.equal(mgr.isColumnKey(event), false);
  });

  it('still claims F when focus is on a button', () => {
    mgr.bindKey(70, COLUMNS.LEFT);
    const steps = [];
    mgr.onStep((col) => steps.push(col));
    const button = {
      tagName: 'BUTTON',
      nodeName: 'BUTTON',
      nodeType: 1,
      isContentEditable: false
    };
    const { event, calls } = keyEvent(70, button, {
      composedPath() {
        return [button];
      }
    });
    mgr._onKeyDown(event);
    assert.deepEqual(steps, [COLUMNS.LEFT]);
    assert.equal(calls.immediate, true);
  });

  it('does not claim a key while the remap sheet is open', () => {
    mgr.bindKey(70, COLUMNS.DOWN);
    const steps = [];
    mgr.onStep((col) => steps.push(col));
    const { event, calls } = keyEvent(70, {
      tagName: 'SM-SETTINGS-SHEET',
      nodeName: 'SM-SETTINGS-SHEET',
      hidden: false,
      isContentEditable: false
    });
    mgr._onKeyDown(event);
    assert.deepEqual(steps, []);
    assert.equal(calls.immediate, false);
  });

  it('claims a key aimed at the remap sheet after it closes', () => {
    mgr.bindKey(70, COLUMNS.DOWN);
    const steps = [];
    mgr.onStep((col) => steps.push(col));
    const { event, calls } = keyEvent(70, {
      tagName: 'SM-SETTINGS-SHEET',
      nodeName: 'SM-SETTINGS-SHEET',
      hidden: true,
      isContentEditable: false
    });
    mgr._onKeyDown(event);
    assert.deepEqual(steps, [COLUMNS.DOWN]);
    assert.equal(calls.immediate, true);
  });

  it('does not claim Ctrl+F, so browser chords stay intact', () => {
    mgr.bindKey(70, COLUMNS.DOWN);
    const steps = [];
    mgr.onStep((col) => steps.push(col));
    const { event, calls } = keyEvent(
      70,
      { tagName: 'BODY', nodeName: 'BODY', isContentEditable: false },
      { ctrlKey: true }
    );
    mgr._onKeyDown(event);
    assert.deepEqual(steps, []);
    assert.equal(calls.immediate, false);
  });
});
