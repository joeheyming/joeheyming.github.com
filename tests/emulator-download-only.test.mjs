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
import { appWindow, loadClassic } from './load-app-script.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const romAcquireSrc = read('emulator/rom-acquire.js');
const romBrowserSrc = read('emulator/rom-browser.js');
const launchSrc = read('emulator/launch.js');
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
  },
  {
    name: 'Legend of Zelda, The - Ocarina of Time (USA) (Rev 1)',
    title: 'Legend of Zelda, The - Ocarina of Time (USA) (Rev 1)',
    downloadUrl:
      'https://archive.org/download/NintendoEntertainmentSystem/LegendOfZeldaTheOcarinaOfTime.zip',
    fileExtension: '.zip',
    description: 'Classic NES game: Legend of Zelda, The - Ocarina of Time (USA) (Rev 1)',
    size: '32.0 MB'
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
  /** @type {string[]} */
  let pushed;
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
    pushed = [];
    filePickerClicks = 0;
    window.launchEmulator = (source, name) => launched.push(name);
    window.emulatorPushRomQuery = (rom) => pushed.push(rom.name);
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

  it('keeps the region visible and pops the full title as soon as the name is cut off', async () => {
    const el = await mountBrowser(NES_CFG);
    const cards = [...el.shadowRoot.querySelectorAll('.rom-card')];
    const card = cards.find((item) => (item.dataset.fullTitle || '').includes('Ocarina'));
    assert.ok(card);
    assert.equal(
      card.querySelector('.rom-title').textContent,
      'Legend of Zelda, The - Ocarina of Time'
    );
    assert.equal(card.querySelector('.rom-variant').textContent, '(USA) (Rev 1)');

    const pop = el.shadowRoot.querySelector('.rom-title-pop');
    cards[0].dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    assert.equal(pop.hidden, true);

    card.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    assert.equal(pop.hidden, false);
    assert.equal(pop.textContent, card.dataset.fullTitle);

    const plain = cards[1];
    const plainTitle = plain.querySelector('.rom-title');
    Object.defineProperty(plainTitle, 'scrollHeight', { configurable: true, get: () => 48 });
    Object.defineProperty(plainTitle, 'clientHeight', { configurable: true, get: () => 24 });
    plain.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    assert.equal(pop.hidden, false);
    assert.equal(pop.textContent, 'Zelda');
    card.dispatchEvent(new window.Event('pointerover', { bubbles: true }));

    card.dispatchEvent(new window.Event('pointerout', { bubbles: true }));
    assert.equal(pop.hidden, true);

    card.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    assert.equal(pop.hidden, false);
    assert.equal(pop.textContent, 'Legend of Zelda, The - Ocarina of Time (USA) (Rev 1)');

    card.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
    assert.equal(pop.hidden, true);
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
    assert.equal(card.tagName, 'BUTTON');
    assert.equal(card.querySelector('a, [data-action="play-rom"]'), null);

    card.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    assert.deepEqual(pushed, ['Metroid']);
    assert.equal(ia.loadRomCalls, 1);
    assert.deepEqual(launched, ['Metroid.zip']);
    assert.equal(el.shadowRoot.querySelector('.external-download'), null);
  });

  it('keeps the download handoff for disc-sized collections', async () => {
    const el = await mountBrowser(SEGACD_CFG);
    const card = el.shadowRoot.querySelector('.rom-card');
    assert.equal(card.tagName, 'BUTTON');

    card.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    assert.deepEqual(pushed, ['Metroid']);
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
    window = appWindow(PAGE, { url });
    loadClassic(window, 'emulator/consoles.js', 'emulator/rom-acquire.js');
    ia = stubIaClient(window);
    loadClassic(window, 'emulator/launch.js');

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

  it('shows a cartridge screen while a deep-linked ROM is still downloading', async () => {
    window = appWindow(PAGE, { url: 'https://x/emulator/nes/?rom=Zelda' });
    loadClassic(window, 'emulator/consoles.js', 'emulator/rom-acquire.js');
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    window.InternetArchiveRoms = function StubIa() {
      this.fetchRomList = async () => ROMS.map((rom) => ({ ...rom }));
      this.loadRom = () => gate.then(() => new Uint8Array([1, 2, 3, 4]));
      this.clearListCache = () => {};
    };
    loadClassic(window, 'emulator/launch.js');
    window.launchEmulator = () => {};

    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    const crt = window.document.querySelector('#boot-card .rom-crt');
    assert.ok(crt);
    assert.equal(crt.querySelector('.rom-crt-title').textContent, 'Zelda');
    assert.equal(crt.querySelector('.rom-crt-status').textContent, 'Reading cartridge');
    assert.ok(crt.querySelector('.rom-crt-meter'));
    release();
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    window.close();
  });

  it('writes the game id into ?rom= and leaves history.back alone', async () => {
    await bootShell('https://x/emulator/nes/?tv=1');
    let backs = 0;
    window.history.back = () => {
      backs += 1;
    };

    window.emulatorPushRomQuery({ name: 'Super Mario', title: 'Super Mario' });
    const playing = new URL(window.location.href);
    assert.equal(playing.searchParams.get('rom'), 'Super Mario');
    assert.equal(playing.searchParams.get('tv'), '1');
    assert.equal(window.history.state.emulatorRom, 'Super Mario');

    window.emulatorClearRomQuery();
    const cleared = new URL(window.location.href);
    assert.equal(cleared.searchParams.get('rom'), null);
    assert.equal(cleared.searchParams.get('tv'), '1');
    assert.equal(backs, 0);
    assert.doesNotMatch(launchSrc, /history\.back\s*\(/);
  });

  it('starts a recent on this console without reloading the list away', async () => {
    await bootShell('https://x/emulator/nes/');
    const link = window.document.createElement('a');
    link.className = 'play-top-link';
    link.href = '/emulator/nes/?rom=Zelda';
    link.textContent = 'Zelda';
    window.document.body.appendChild(link);

    link.click();
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    assert.equal(new URL(window.location.href).searchParams.get('rom'), 'Zelda');
    assert.equal(ia.loadRomCalls, 1);
    assert.deepEqual(launched, ['Zelda.zip']);
  });

  it('preloads the play scripts only once the visitor points at the game list', async () => {
    await bootShell('https://x/emulator/nes/');
    assert.deepEqual(window.__preloaded, []);
    const card = window.document.getElementById('boot-card');
    card.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    assert.deepEqual(window.__preloaded, [
      '/emulator/socd.js',
      '/emulator/ejs-mount.js',
      '/emulator/play.js'
    ]);
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

  it('keeps the game list in a fixed-height scrolling card', () => {
    assert.match(launchSrc, /class="boot-card-header"/);
    assert.match(launchSrc, /class="boot-card-scroll"/);
    const css = read('emulator/emulator.css');
    assert.match(css, /#boot:has\(\.boot-card-scroll\)/);
    const scrollRule = css.slice(css.indexOf('.boot-card-scroll {'));
    assert.match(scrollRule.slice(0, 180), /overflow-y:\s*auto/);
    assert.match(romBrowserSrc, /@media \(max-width: 480px\)/);
    assert.match(romBrowserSrc, /minmax\(96px, 1fr\)/);
  });

  it('keeps BIOS auto-fetch untouched', () => {
    const biosSrc = read('emulator/bios.js');
    assert.match(biosSrc, /fetchBiosFromIa/);
    assert.match(biosSrc, /fetchBinary(Stream|WithProxy)/);
  });
});
