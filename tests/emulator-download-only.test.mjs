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
      return new Uint8Array([1, 2, 3, 4]);
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

  it('requests libretro box art for the ROM filename and drops a miss', async () => {
    const el = await mountBrowser({
      ...NES_CFG,
      iaThumbnailSystems: ['Nintendo - Game Boy', 'Nintendo - Game Boy Color']
    });
    const card = el.shadowRoot.querySelector('.rom-card');
    const img = card.querySelector('.rom-art');
    assert.ok(img);
    assert.equal(img.hidden, true);
    assert.equal(img.getAttribute('alt'), '');
    assert.equal(
      img.getAttribute('src'),
      'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Metroid.png'
    );

    img.dispatchEvent(new window.Event('error'));
    assert.match(img.getAttribute('src'), /Game%20Boy%20Color\/Named_Boxarts\/Metroid\.png$/);

    img.dispatchEvent(new window.Event('load'));
    assert.equal(img.hidden, false);

    img.dispatchEvent(new window.Event('error'));
    assert.equal(card.querySelector('.rom-art'), null);
  });

  it('paints the collection inline and leaves Backspace to the search field', async () => {
    const el = await mountBrowser(NES_CFG);
    assert.equal(el.hidden, false);
    assert.equal(el.shadowRoot.getElementById('openBrowserBtn'), null);
    assert.equal(el.shadowRoot.getElementById('browserModal'), null);
    assert.equal(el.shadowRoot.querySelectorAll('.rom-card').length, ROMS.length);

    const search = el.shadowRoot.getElementById('searchInput');
    search.focus();
    const inField = new window.KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      composed: true,
      cancelable: true
    });
    search.dispatchEvent(inField);
    assert.equal(inField.defaultPrevented, false);
    assert.equal(el.shadowRoot.querySelectorAll('.rom-card').length, ROMS.length);
  });

  it('lists results from collection metadata only', async () => {
    const el = await mountBrowser(NES_CFG);
    const cards = el.shadowRoot.querySelectorAll('.rom-card');
    assert.equal(cards.length, ROMS.length);
    assert.equal(ia.listCalls, 1);
    assert.equal(ia.loadRomCalls, 0);
  });

  it('plays a cartridge in the page from the card', async () => {
    const el = await mountBrowser(NES_CFG);
    const card = el.shadowRoot.querySelector('.rom-card');
    const play = card.querySelector('[data-action="play-rom"]');
    assert.equal(play.textContent.trim(), 'Play in browser');
    assert.equal(card.querySelector('a').textContent.trim(), 'Download instead');
    assert.equal(card.querySelector('a').getAttribute('href'), ROMS[0].downloadUrl);

    play.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    assert.equal(ia.loadRomCalls, 1);
    assert.deepEqual(launched, ['Metroid.zip']);
    assert.equal(el.shadowRoot.querySelector('.external-download'), null);
  });

  it('keeps the download handoff for disc-sized collections', async () => {
    const el = await mountBrowser(SEGACD_CFG);
    const play = el.shadowRoot.querySelector('[data-action="play-rom"]');
    assert.equal(play.textContent.trim(), 'Get this disc');

    play.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    assert.equal(ia.loadRomCalls, 0);
    assert.deepEqual(launched, []);
    const panel = el.shadowRoot.querySelector('.external-download');
    assert.ok(panel);
    assert.match(panel.textContent, /too large to load in the page/i);
  });
});

describe('?rom= deep links launch cartridges and hand off discs', () => {
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

  it('fetches a known cartridge and starts it', async () => {
    await bootShell('https://x/emulator/nes/?rom=Zelda');

    assert.equal(ia.listCalls, 1, 'deep link should search collection metadata');
    assert.equal(ia.loadRomCalls, 1, 'deep link should fetch the ROM bytes');
    assert.deepEqual(launched, ['Zelda.zip']);
    assert.equal(window.document.querySelector('.deeplink-handoff'), null);
  });

  it('falls back to the boot card when the title is not in the collection', async () => {
    await bootShell('https://x/emulator/nes/?rom=NotARealGame');

    assert.equal(ia.loadRomCalls, 0);
    assert.deepEqual(launched, []);
    assert.equal(window.document.querySelector('.deeplink-handoff'), null);
    const note = window.document.querySelector('#boot-card .deeplink-error');
    assert.ok(note, 'expected an explanatory note');
    assert.match(note.textContent, /Pick a ROM from the collection/i);
  });
});

describe('emulator shell launches streamed ROMs and still fetches BIOS', () => {
  it('calls loadRom from the browser and from deep links', () => {
    assert.match(romBrowserSrc, /\.loadRom\s*\(/);
    assert.match(launchSrc, /\.loadRom\s*\(/);
    assert.match(romAcquireSrc, /fileFromRomBytes/);
  });

  it('keeps disc consoles on the download handoff', () => {
    assert.match(romBrowserSrc, /iaExternalDownload && !cfg\.iaAllowInBrowser/);
    assert.match(launchSrc, /iaExternalDownload && !cfg\.iaAllowInBrowser/);
  });

  it('keeps BIOS auto-fetch untouched', () => {
    const biosSrc = read('emulator/bios.js');
    assert.match(biosSrc, /fetchBiosFromIa/);
    assert.match(biosSrc, /fetchBinary(Stream|WithProxy)/);
  });
});
