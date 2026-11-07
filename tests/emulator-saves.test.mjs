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

  it('reads a legacy core save when EmulatorJSGetState is missing', () => {
    const dom = boot();
    const heap = new Uint8Array(32);
    heap.set([9, 8, 7, 6], 4);
    const emu = {
      settings: {},
      menuOptionChanged(id, value) {
        this.settings[id] = value;
      },
      gameManager: {
        Module: {
          HEAPU8: heap,
          cwrap() {
            return () => '4|4|1';
          }
        },
        getState() {
          throw new Error('EmulatorJSGetState is not a function');
        }
      }
    };
    assert.equal(dom.window.emulatorEjsMount.keepSavesInBrowser(emu), true);
    const data = emu.gameManager.getState();
    assert.deepEqual(Array.from(data), [9, 8, 7, 6]);
  });

  it('keeps a quick save after the in-memory slot is gone', async () => {
    const dom = boot();
    const files = new Map();
    const stored = new Map();
    const loaded = [];
    const emu = {
      started: true,
      config: { system: 'nes', gameName: 'Zelda.nes' },
      settings: {},
      getBaseFileName() {
        return 'Zelda.nes';
      },
      getSettingValue(id) {
        return this.settings[id];
      },
      menuOptionChanged(id, value) {
        this.settings[id] = value;
      },
      storage: {
        states: {
          put(key, data) {
            stored.set(key, data);
          },
          get(key) {
            return Promise.resolve(stored.get(key));
          }
        }
      },
      gameManager: {
        FS: {
          readFile(path) {
            if (!files.has(path)) throw new Error('missing');
            return files.get(path);
          },
          writeFile(path, data) {
            files.set(path, data);
          }
        },
        quickSave(slot) {
          files.set('/' + slot + '-quick.state', new Uint8Array([7, 8, 9]));
          return true;
        },
        quickLoad(slot) {
          loaded.push(slot);
        }
      },
      frontend: {
        messages: [],
        displayMessage(message, _time, suffix, severity) {
          this.messages.push({ message, suffix, severity });
        }
      }
    };

    assert.equal(dom.window.emulatorEjsMount.keepSavesInBrowser(emu), true);
    dom.window.EJS_emulator = emu;
    assert.equal(dom.window.emulatorEjsMount.saveQuickState(), true);
    assert.equal(stored.has('nes/Zelda.nes/1-quick.state'), true);
    assert.equal(emu.frontend.messages[0].message, 'SAVED STATE TO SLOT');

    files.clear();
    loaded.length = 0;
    const ok = await emu.gameManager.quickLoad(1);
    assert.equal(ok, true);
    assert.deepEqual(Array.from(files.get('/1-quick.state')), [7, 8, 9]);
    assert.deepEqual(loaded, [1]);
  });

  it('saves on F5 and does not steal F5 before the game has started', () => {
    const dom = boot();
    const emu = {
      started: false,
      config: { system: 'gba', gameName: 'Metroid.gba' },
      settings: {},
      getBaseFileName() {
        return 'Metroid.gba';
      },
      menuOptionChanged(id, value) {
        this.settings[id] = value;
      },
      storage: {
        states: {
          put() {},
          get() {
            return Promise.resolve();
          }
        }
      },
      gameManager: {
        saves: 0,
        FS: {
          readFile() {
            return new Uint8Array([1]);
          }
        },
        quickSave() {
          this.saves += 1;
          return true;
        },
        quickLoad() {
          return Promise.resolve(true);
        }
      },
      frontend: { displayMessage() {} }
    };
    dom.window.EJS_emulator = emu;
    dom.window.emulatorEjsMount.keepSavesInBrowser(emu);

    const early = new dom.window.KeyboardEvent('keydown', {
      key: 'F5',
      code: 'F5',
      bubbles: true,
      cancelable: true
    });
    dom.window.dispatchEvent(early);
    assert.equal(early.defaultPrevented, false);
    assert.equal(emu.gameManager.saves, 0);

    emu.started = true;
    const playing = new dom.window.KeyboardEvent('keydown', {
      key: 'F5',
      code: 'F5',
      bubbles: true,
      cancelable: true
    });
    dom.window.dispatchEvent(playing);
    assert.equal(playing.defaultPrevented, true);
    assert.equal(emu.gameManager.saves, 1);
  });
});
