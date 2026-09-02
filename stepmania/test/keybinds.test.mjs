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
