import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function load(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

describe('ROM byte cache', () => {
  /** @type {Window & typeof globalThis} */
  let window;
  /** @type {ReturnType<typeof cache>} */
  let api;

  before(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      runScripts: 'outside-only',
      url: 'https://joeheyming.github.io/emulator/nes/'
    });
    dom.window.eval(load('emulator/rom-cache.js'));
    dom.window.eval(load('emulator/internet-archive.js'));
    window = dom.window;
    api = window.emulatorRomCache;
  });

  function cache() {
    return api;
  }

  it('drops the oldest files until the new one fits, and refuses a file bigger than the cap', () => {
    const plan = cache().planEviction(
      [
        { key: 'old', size: 60, savedAt: 1 },
        { key: 'mid', size: 50, savedAt: 2 }
      ],
      40,
      100
    );
    assert.equal(plan.store, true);
    assert.deepEqual([...plan.drop], ['old']);
    const tooBig = cache().planEviction([{ key: 'a', size: 10, savedAt: 1 }], 1000, 100);
    assert.equal(tooBig.store, false);
    assert.deepEqual([...tooBig.drop], []);
  });

  it('returns cached bytes without calling the proxy', async () => {
    const bytes = new Uint8Array(64);
    bytes[0] = 1;
    let proxyCalls = 0;
    let directCalls = 0;
    window.emulatorRomCache = {
      ...cache(),
      read: async () => bytes,
      fetchDirect: async () => {
        directCalls += 1;
        return null;
      },
      write: async () => true
    };
    window.proxyService = {
      fetchBinaryWithProxy: async () => {
        proxyCalls += 1;
        return bytes;
      }
    };
    const ia = new window.InternetArchiveRoms({ baseUrl: 'https://example.com/roms' });
    const got = await ia.loadRom({ downloadUrl: 'https://example.com/game.nes' });
    assert.equal(got, bytes);
    assert.equal(proxyCalls, 0);
    assert.equal(directCalls, 0);
  });

  it('uses the proxy when the direct fetch fails', async () => {
    const bytes = new Uint8Array(64);
    bytes[0] = 2;
    let proxyCalls = 0;
    const real = cache();
    window.emulatorRomCache = {
      ...real,
      read: async () => null,
      fetchDirect: async () => null,
      write: async () => true
    };
    window.proxyService = {
      fetchBinaryWithProxy: async () => {
        proxyCalls += 1;
        return bytes;
      }
    };
    const ia = new window.InternetArchiveRoms({ baseUrl: 'https://example.com/roms' });
    const got = await ia.loadRom({ downloadUrl: 'https://example.com/game.nes' });
    assert.equal(got, bytes);
    assert.equal(proxyCalls, 1);
  });

  it('reports byte progress from a direct response and returns null on a CORS refusal', async () => {
    const chunk = new Uint8Array([9, 9, 9, 9]);
    window.fetch = async () => ({
      ok: true,
      headers: { get: (name) => (name === 'content-length' ? '4' : null) },
      body: {
        getReader() {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: chunk };
            },
            cancel: async () => {}
          };
        }
      }
    });
    /** @type {number[]} */
    const seen = [];
    const bytes = await cache().fetchDirect('https://example.com/a.nes', {
      onProgress: (progress) => seen.push(progress.received)
    });
    assert.equal(bytes && bytes.length, 4);
    assert.deepEqual(seen, [4]);

    window.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    assert.equal(await cache().fetchDirect('https://example.com/a.nes', {}), null);
  });
});

describe('weaker hardware and earlier core load', () => {
  it('turns video smoothing off at 4 GB or 4 cores', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      runScripts: 'outside-only',
      url: 'https://joeheyming.github.io/emulator/nes/'
    });
    dom.window.eval(load('emulator/ejs-mount.js'));
    const api = dom.window.emulatorEjsMount;
    assert.equal(api.prefersLightVideo({ deviceMemory: 4, hardwareConcurrency: 8 }), true);
    assert.equal(api.prefersLightVideo({ hardwareConcurrency: 4 }), true);
    assert.equal(api.prefersLightVideo({ deviceMemory: 8, hardwareConcurrency: 8 }), false);
    assert.equal(api.prefersLightVideo({}), false);
    const options = api.applyVideoDefaults(
      { 'save-state-location': 'browser' },
      { deviceMemory: 2 }
    );
    assert.equal(options['video-smoothing'], 'disabled');
    assert.equal(options['save-state-location'], 'browser');
    const heavy = api.applyVideoDefaults(
      { 'save-state-location': 'browser' },
      { hardwareConcurrency: 8 }
    );
    assert.equal(heavy['video-smoothing'], undefined);
  });

  it('preloads the EmulatorJS loader with the play scripts', () => {
    const launch = load('emulator/launch.js');
    assert.match(
      launch,
      /preloadOnIntent\(\s*bootCard,\s*playScripts\(cfg\)\.concat\([\s\S]*cdn\.emulatorjs\.org\/latest\/data\/loader\.js/
    );
  });
});
