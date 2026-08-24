// ROM discovery stays searchable; playing does not. Every Internet Archive
// result must be downloaded from Archive and re-entered through the local
// file picker, so nothing in the shell may pull ROM bytes into the page.
//
// These tests drive the real <rom-browser> element and the real deep-link
// path in launch.js against a stub IA client whose loadRom() records any
// call. BIOS auto-fetch (emulator/bios.js) is a separate path and untouched.

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const romAcquireSrc = read('emulator/rom-acquire.js');
const romBrowserSrc = read('emulator/rom-browser.js');
const launchSrc = read('emulator/launch.js');
const consolesSrc = read('emulator/consoles.js');

const NES_CFG = {
  id: 'nes',
  title: 'NES',
  subtitle: 'Nintendo Entertainment System',
  emoji: '🕹️',
  ejsCore: 'nes',
  fileAccept: '.nes,.zip',
  fileExtsLabel: '.nes',
  accentHex: '#dc2626',
  iaBaseUrl: 'https://archive.org/download/NintendoEntertainmentSystem',
  controls: [{ label: 'Start', key: 'Enter' }]
};

const SEGACD_CFG = {
  ...NES_CFG,
  id: 'segacd',
  title: 'Sega CD',
  fileExtsLabel: '.chd',
  iaBaseUrl: 'https://archive.org/download/sega_mega-cd_sega-cd',
  iaExternalDownload: true
};

const ROMS = [
  {
    name: 'Metroid',
    title: 'Metroid',
    downloadUrl: 'https://archive.org/download/NintendoEntertainmentSystem/Metroid.zip',
    fileExtension: '.zip',
    description: 'Classic NES game: Metroid',
    size: '128.0 KB'
  },
  {
    name: 'Zelda',
    title: 'Zelda',
    downloadUrl: 'https://archive.org/download/NintendoEntertainmentSystem/Zelda.zip',
    fileExtension: '.zip',
    description: 'Classic NES game: Zelda',
    size: '96.0 KB'
  }
];

/**
 * Install a stub InternetArchiveRoms whose metadata calls succeed and whose
 * binary fetch is a tripwire.
 * @param {import('jsdom').DOMWindow} window
 * @returns {{ loadRomCalls: number, listCalls: number }}
 */
function stubIaClient(window) {
  const spy = { loadRomCalls: 0, listCalls: 0 };
  window.InternetArchiveRoms = function StubIa() {
    this.fetchRomList = async () => {
      spy.listCalls += 1;
      return ROMS.map((rom) => ({ ...rom }));
    };
    this.loadRom = async () => {
      spy.loadRomCalls += 1;
      throw new Error('loadRom must never be called for a ROM');
    };
    this.clearListCache = () => {};
  };
  return spy;
}

const PAGE = `<!doctype html><html><body>
  <input type="file" id="romFileInput" />
  <input type="file" id="biosFileInput" />
  <div id="boot">
    <div class="brand" id="brand"></div>
    <div class="boot-card" id="boot-card"></div>
  </div>
  <div id="game-container"><div id="game"></div></div>
  <header id="emu-header"><nav id="emu-breadcrumbs"></nav></header>
</body></html>`;

describe('rom-browser hands off downloads instead of loading ROMs', () => {
  /** @type {import('jsdom').DOMWindow} */
  let window;
  /** @type {{ loadRomCalls: number, listCalls: number }} */
  let ia;
  /** @type {string[]} */
  let launched;
  let filePickerClicks;

  /** @param {object} cfg */
  async function mountBrowser(cfg) {
    window.EMULATOR_CONSOLES = { [cfg.id]: cfg };
    const el = window.document.createElement('rom-browser');
    el.setAttribute('console', cfg.id);
    window.document.body.appendChild(el);
    await el.openBrowser();
    return el;
  }

  before(() => {
    const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url: 'https://x/emulator/nes/' });
    window = dom.window;
    window.eval(romAcquireSrc);
    window.eval(romBrowserSrc);
    window.document.getElementById('romFileInput').addEventListener('click', () => {
      filePickerClicks += 1;
    });
  });

  beforeEach(() => {
    ia = stubIaClient(window);
    launched = [];
    filePickerClicks = 0;
    window.launchEmulator = (source, name) => launched.push(name);
    window.document.querySelectorAll('rom-browser').forEach((el) => el.remove());
  });

  it('lists results from collection metadata only', async () => {
    const el = await mountBrowser(NES_CFG);
    const cards = el.shadowRoot.querySelectorAll('.rom-card');
    assert.equal(cards.length, ROMS.length);
    assert.equal(ia.listCalls, 1);
    assert.equal(ia.loadRomCalls, 0);
  });

  it('offers a download handoff on every card, never an in-page play', async () => {
    const el = await mountBrowser(NES_CFG);
    const card = el.shadowRoot.querySelector('.rom-card');

    assert.equal(el.shadowRoot.querySelectorAll('[data-action="play-rom"]').length, 0);
    assert.equal(el.shadowRoot.querySelectorAll('.rom-card[role="button"]').length, 0);

    const getBtn = card.querySelector('[data-action="get-rom"]');
    assert.ok(getBtn, 'card needs a get-rom action');
    assert.equal(getBtn.textContent.trim(), 'Get this ROM');
    assert.equal(card.querySelector('a').getAttribute('href'), ROMS[0].downloadUrl);
  });

  it('shows the Archive link and local picker when a result is picked', async () => {
    const el = await mountBrowser(NES_CFG);
    el.shadowRoot.querySelector('[data-action="get-rom"]').click();

    assert.equal(ia.loadRomCalls, 0, 'picking a ROM must not fetch its bytes');
    assert.deepEqual(launched, [], 'picking a ROM must not start the emulator');

    const panel = el.shadowRoot.querySelector('.external-download');
    assert.ok(panel, 'expected the external download panel');
    assert.equal(panel.querySelector('[data-action="open-ia"]').href, ROMS[0].downloadUrl);
    assert.match(panel.textContent, /never streamed into the page/i);

    panel.querySelector('[data-action="load-local"]').click();
    assert.equal(filePickerClicks, 1, 'handoff must route through the local file picker');
    assert.equal(ia.loadRomCalls, 0);
    assert.deepEqual(launched, []);
  });

  it('keeps the same handoff for disc-sized collections', async () => {
    const el = await mountBrowser(SEGACD_CFG);
    const getBtn = el.shadowRoot.querySelector('[data-action="get-rom"]');
    assert.equal(getBtn.textContent.trim(), 'Get this disc');

    getBtn.click();
    assert.equal(ia.loadRomCalls, 0);
    assert.deepEqual(launched, []);
    assert.ok(el.shadowRoot.querySelector('.external-download'));
  });
});

describe('?rom= deep links resolve to a download, not a launch', () => {
  /** @type {import('jsdom').DOMWindow} */
  let window;
  /** @type {{ loadRomCalls: number, listCalls: number }} */
  let ia;
  /** @type {string[]} */
  let launched;

  /**
   * Boot launch.js against a lander URL and let its COI/WASM settle chain run.
   * @param {string} url
   */
  async function bootShell(url) {
    const dom = new JSDOM(PAGE, { runScripts: 'outside-only', url });
    window = dom.window;
    if (typeof window.WebAssembly === 'undefined') window.WebAssembly = WebAssembly;
    // jsdom ships no matchMedia; launch.js reads it for the dark-mode accent mix.
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {}
    });
    window.eval(consolesSrc);
    window.eval(romAcquireSrc);
    ia = stubIaClient(window);
    window.eval(launchSrc);

    launched = [];
    const shellLaunch = window.launchEmulator;
    assert.equal(typeof shellLaunch, 'function');
    window.launchEmulator = (source, name) => launched.push(name);

    // Boot waits on the COI settle promise, then the IA metadata lookup.
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }

  it('offers the Archive download plus the local picker for a known title', async () => {
    await bootShell('https://x/emulator/nes/?rom=Zelda');

    assert.equal(ia.listCalls, 1, 'deep link should still search collection metadata');
    assert.equal(ia.loadRomCalls, 0, 'deep link must not fetch ROM bytes');
    assert.deepEqual(launched, [], 'deep link must not start the emulator');

    const panel = window.document.querySelector('#boot-card .deeplink-handoff');
    assert.ok(panel, 'expected a deep-link download handoff');
    assert.equal(
      panel.querySelector('#deeplinkDownloadLink').getAttribute('href'),
      ROMS[1].downloadUrl
    );
    assert.ok(panel.querySelector('#deeplinkLoadLocalBtn'));
    assert.match(panel.textContent, /never streamed into the page/i);
    // The regular boot card (browser + file picker) is still underneath.
    assert.ok(window.document.querySelector('#boot-card rom-browser'));
  });

  it('falls back to the boot card when the title is not in the collection', async () => {
    await bootShell('https://x/emulator/nes/?rom=NotARealGame');

    assert.equal(ia.loadRomCalls, 0);
    assert.deepEqual(launched, []);
    assert.equal(window.document.querySelector('.deeplink-handoff'), null);
    const note = window.document.querySelector('#boot-card .deeplink-error');
    assert.ok(note, 'expected an explanatory note');
    assert.match(note.textContent, /Pick a game from the collection/i);
  });
});

describe('emulator shell source has no remote ROM launch path', () => {
  it('never calls loadRom on the IA client', () => {
    for (const [name, src] of [
      ['rom-browser.js', romBrowserSrc],
      ['launch.js', launchSrc]
    ]) {
      assert.ok(!/\.loadRom\s*\(/.test(src), `${name} must not call loadRom`);
    }
  });

  it('never wraps fetched bytes into a ROM File', () => {
    for (const [name, src] of [
      ['rom-browser.js', romBrowserSrc],
      ['launch.js', launchSrc],
      ['rom-acquire.js', romAcquireSrc]
    ]) {
      assert.ok(!src.includes('fileFromRomBytes'), `${name} must not build a ROM File`);
      assert.ok(!/new File\(\s*\[\s*rom/.test(src), `${name} must not build a ROM File`);
    }
  });

  it('leaves launching to the local file picker inside launch.js', () => {
    assert.ok(!romBrowserSrc.includes('launchEmulator'), 'rom-browser must not launch games');
    assert.match(launchSrc, /romFileInput[\s\S]*?launchEmulator|launchEmulator/);
  });

  it('keeps BIOS auto-fetch untouched', () => {
    const biosSrc = read('emulator/bios.js');
    assert.match(biosSrc, /fetchBiosFromIa/);
    assert.match(biosSrc, /fetchBinary(Stream|WithProxy)/);
  });
});
