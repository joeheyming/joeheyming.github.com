import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { count, note, readProgress } from '../play-progress.js';

function memory() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    }
  };
}

describe('play progress', () => {
  it('counts distinct ids and ignores a repeat', () => {
    const storage = memory();
    assert.equal(note(storage, 'doom', 'classic'), 1);
    assert.equal(note(storage, 'doom', 'classic'), 1);
    assert.equal(note(storage, 'doom', 'sigil'), 2);
    assert.equal(count(storage, 'doom'), 2);
    assert.equal(count(storage, 'stepmania'), 0);
  });

  it('keeps each app in its own bucket', () => {
    const storage = memory();
    note(storage, 'emulator', 'nes');
    note(storage, 'emulator', 'gba');
    note(storage, 'stepmania', 'nes');
    const progress = readProgress(storage);
    assert.deepEqual(progress.emulator, ['gba', 'nes']);
    assert.deepEqual(progress.stepmania, ['nes']);
  });

  it('drops an unknown bucket and a blank id', () => {
    const storage = memory();
    assert.equal(note(storage, 'watch', 'show'), 0);
    assert.equal(note(storage, 'doom', '   '), 0);
    assert.deepEqual(readProgress(storage).doom, []);
  });
});
