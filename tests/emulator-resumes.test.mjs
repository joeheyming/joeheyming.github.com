import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(readFileSync(join(root, 'emulator/resumes.js'), 'utf8'));
  return dom.window.emulatorResumes;
}

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

describe('emulator resumes', () => {
  it('remembers one row per console and file, newest first', () => {
    const api = boot();
    const storage = memory();
    assert.equal(
      api.remember(storage, { console: 'NES', file: 'Zelda.nes', title: 'Zelda', shot: 'nope' }),
      true
    );
    api.remember(storage, {
      console: 'nes',
      file: 'Metroid.nes',
      title: 'Metroid',
      shot: 'data:image/jpeg;base64,abc'
    });
    api.remember(storage, { console: 'nes', file: 'Zelda.nes', title: 'The Legend of Zelda' });
    const rows = api.read(storage);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].file, 'Zelda.nes');
    assert.equal(rows[0].title, 'The Legend of Zelda');
    assert.equal(rows[0].shot, '');
    assert.equal(rows[1].shot, 'data:image/jpeg;base64,abc');
  });

  it('matches a card by file name and builds a resume link', () => {
    const api = boot();
    const storage = memory();
    api.remember(storage, { console: 'gba', file: 'Metroid.gba', title: 'Metroid Fusion' });
    const hit = api.forRom(storage, 'gba', { name: 'Metroid.gba', title: 'Something else' });
    assert.equal(hit && hit.title, 'Metroid Fusion');
    assert.equal(api.forRom(storage, 'nes', { name: 'Metroid.gba' }), null);
    assert.equal(api.href(hit), '/emulator/gba/?rom=Metroid.gba&resume=1');
  });
});
