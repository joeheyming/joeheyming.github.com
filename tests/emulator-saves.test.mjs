// GBA (and every other console) used to download a save state and then fail
// to load that file back. Saves stay in this browser, and importing a battery
// file restarts the core so the game actually reads it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'emulator/ejs-mount.js'), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only'
  });
  dom.window.eval(source);
  return dom;
}

describe('emulator save location', () => {
  it('asks EmulatorJS to keep save states in the browser', () => {
    const dom = boot();
    dom.window.emulatorEjsMount.mount({
      cfg: { ejsCore: 'gba', accentHex: '#7c3aed' },
      romSource: { name: 'game.gba' },
      romName: 'game.gba'
    });
    assert.equal(dom.window.EJS_defaultOptions['save-state-location'], 'browser');
  });

  it('restarts after an imported battery save so the game loads it', () => {
    const dom = boot();
    const gm = {
      loaded: 0,
      restarted: 0,
      loadSaveFiles() {
        this.loaded += 1;
      },
      restart() {
        this.restarted += 1;
      }
    };
    const emu = {
      settings: {},
      gameManager: gm,
      menuOptionChanged(id, value) {
        this.settings[id] = value;
      }
    };
    assert.equal(dom.window.emulatorEjsMount.keepSavesInBrowser(emu), true);
    gm.loadSaveFiles();
    gm.loadSaveFiles();
    assert.equal(emu.settings['save-state-location'], 'browser');
    assert.equal(gm.loaded, 2);
    assert.equal(gm.restarted, 2);
  });
});
