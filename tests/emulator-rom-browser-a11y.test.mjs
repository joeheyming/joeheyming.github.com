// Search punctuation, the result-count live region, and where TV focus
// lands after the ROM list paints. jsdom only: no network, no browser.

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
const leanbackSrc = read('emulator/leanback.js');
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
  iaBaseUrl: 'https://archive.org/download/nes-collection',
  controls: [{ label: 'Start', key: 'Enter' }]
};

const AWAKENING = "The Legend of Zelda: Link's Awakening";

const ROMS = [
  {
    name: 'LinksAwakening',
    title: AWAKENING,
    description: 'Game Boy game',
    size: '1 MB',
    downloadUrl: 'https://example.test/awakening.zip',
    fileExtension: '.zip'
  },
  {
    name: 'Ocarina',
    title: 'Legend of Zelda, The - Ocarina of Time (USA) (Rev 1)',
    description: 'N64 game',
    size: '32 MB',
    downloadUrl: 'https://example.test/ocarina.zip',
    fileExtension: '.zip'
  },
  {
    name: 'Zelda',
    title: 'Zelda',
    description: 'Classic NES game: Zelda',
    size: '96 KB',
    downloadUrl: 'https://example.test/zelda.zip',
    fileExtension: '.zip'
  },
  {
    name: 'Metroid',
    title: 'Metroid',
    description: 'Classic NES game: Metroid',
    size: '128 KB',
    downloadUrl: 'https://example.test/metroid.zip',
    fileExtension: '.zip'
  }
];

/**
 * @param {import('jsdom').DOMWindow} window
 * @param {Promise<void> | null} [gate]
 */
function stubIaClient(window, gate) {
  window.InternetArchiveRoms = function StubIa() {
    this.fetchRomList = async () => {
      if (gate) await gate;
      return ROMS.map((rom) => ({ ...rom }));
    };
    this.loadRom = async () => new Uint8Array([1, 2, 3, 4]);
    this.clearListCache = () => {};
  };
}

const PAGE = `<!doctype html><html><body>
  <div id="brand"></div>
  <div id="boot-card"></div>
  <header id="emu-header"><nav id="emu-breadcrumbs"></nav></header>
</body></html>`;

/**
 * @param {() => boolean} ready
 * @param {string} label
 */
async function waitFor(ready, label) {
  for (let i = 0; i < 40; i += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(label);
}

describe('ROM search ignores punctuation and announces the count', () => {
  /** @type {import('jsdom').DOMWindow} */
  let window;

  before(() => {
    const dom = new JSDOM('<!doctype html><body></body>', {
      runScripts: 'outside-only',
      url: 'https://joeheyming.github.io/emulator/nes/'
    });
    window = dom.window;
    window.eval(romAcquireSrc);
    window.eval(leanbackSrc);
    window.eval(romBrowserSrc);
  });

  beforeEach(() => {
    stubIaClient(window);
    window.document.documentElement.dataset.mode = 'web';
    window.EMULATOR_CONSOLES = { nes: NES_CFG };
    window.document.querySelectorAll('rom-browser').forEach((el) => el.remove());
  });

  /**
   * @param {'web' | 'tv'} mode
   */
  async function mount(mode) {
    window.document.documentElement.dataset.mode = mode;
    const el = window.document.createElement('rom-browser');
    el.setAttribute('console', 'nes');
    window.document.body.appendChild(el);
    await el.openBrowser();
    return el;
  }

  it('ranks a plain substring the same way and still matches Link’s Awakening', () => {
    const el = window.document.createElement('rom-browser');
    assert.equal(el.fuzzyScore('Zelda', 'zelda'), 2000);
    assert.equal(el.fuzzyScore('The Legend of Zelda', 'zelda'), 1986);
    assert.equal(el.fuzzyScore('Zelda', 'zlda'), 95);
    assert.equal(el.fuzzyScore('Metroid', 'zeldas awakening'), 0);
    assert.ok(el.fuzzyScore(AWAKENING, 'zeldas awakening') > 0);
    assert.ok(el.fuzzyScore(AWAKENING, 'zelda links') >= 1000);
    assert.ok(el.fuzzyScore(AWAKENING, "zelda: link's") >= 1000);
    assert.ok(
      el.fuzzyScore('The Legend of Zelda: Link\u2019s Awakening', 'links awakening') >= 1000
    );
  });

  it('names the search field and each card, and announces after the debounce', async () => {
    const el = await mount('web');
    const search = el.shadowRoot.getElementById('searchInput');
    const status = el.shadowRoot.getElementById('searchStatus');
    assert.equal(search.getAttribute('aria-label'), 'Search games');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(status.classList.contains('visually-hidden'), true);
    assert.match(el.shadowRoot.querySelector('style').textContent, /\.visually-hidden/);
    assert.equal(status.textContent, '');

    const card = el.shadowRoot.querySelector('.rom-card');
    assert.equal(card.tagName, 'BUTTON');
    assert.match(card.getAttribute('aria-label') || '', /Zelda|Metroid|Awakening|Ocarina/);
    assert.match(card.textContent, new RegExp(card.getAttribute('aria-label').split(':')[0]));

    search.focus();
    search.value = 'zeldas awakening';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(status.textContent, '');
    assert.equal(el.shadowRoot.activeElement, search);

    await new Promise((resolve) => window.setTimeout(resolve, 200));
    assert.equal(status.textContent, '1 result');
    assert.equal(el.shadowRoot.querySelector('.rom-card').getAttribute('aria-label'), AWAKENING);
    assert.equal(el.shadowRoot.activeElement, search);

    el.handleSearch('zelda links');
    assert.equal(status.textContent, '1 result');
    assert.equal(el.shadowRoot.querySelector('.rom-card').getAttribute('aria-label'), AWAKENING);

    el.handleSearch('zelda');
    const labels = [...el.shadowRoot.querySelectorAll('.rom-card')].map((item) =>
      item.getAttribute('aria-label')
    );
    assert.deepEqual(labels, [
      'Zelda',
      'Legend of Zelda, The - Ocarina of Time (USA) (Rev 1)',
      AWAKENING
    ]);
    assert.equal(status.textContent, '3 results');

    el.handleSearch('no such game');
    assert.equal(status.textContent, '0 results');
    el.handleSearch('...');
    assert.equal(el.shadowRoot.querySelectorAll('.rom-card').length, ROMS.length);
    assert.equal(status.textContent, `${ROMS.length} results`);
  });

  it('keeps the search field focused when the list first arrives', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    stubIaClient(window, gate);
    window.document.documentElement.dataset.mode = 'web';
    const el = window.document.createElement('rom-browser');
    el.setAttribute('console', 'nes');
    window.document.body.appendChild(el);
    const search = el.shadowRoot.getElementById('searchInput');
    search.focus();
    const pending = el.openBrowser();
    release();
    await pending;
    assert.equal(el.shadowRoot.querySelectorAll('.rom-card').length, ROMS.length);
    assert.equal(el.shadowRoot.activeElement, search);
  });

  it('exposes the TV search toggle and does not steal the field while typing', async () => {
    const el = await mount('tv');
    const toggle = el.shadowRoot.getElementById('searchToggleBtn');
    const box = el.shadowRoot.getElementById('searchContainer');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-controls'), 'searchContainer');
    assert.equal(box.hasAttribute('hidden'), true);

    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(box.hasAttribute('hidden'), false);
    const search = el.shadowRoot.getElementById('searchInput');
    assert.equal(el.shadowRoot.activeElement, search);

    el.handleSearch('metroid');
    assert.equal(el.shadowRoot.activeElement, search);
    assert.equal(el.shadowRoot.querySelector('.rom-card').getAttribute('aria-label'), 'Metroid');

    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(box.hasAttribute('hidden'), true);
  });

  it('moves TV focus to the first card when the focused card is replaced', async () => {
    const el = await mount('tv');
    const cards = [...el.shadowRoot.querySelectorAll('.rom-card')];
    const awakening = cards.find((card) => card.getAttribute('aria-label') === AWAKENING);
    awakening.focus();
    assert.equal(el.shadowRoot.activeElement, awakening);

    el.handleSearch('metroid');
    const next = el.shadowRoot.activeElement;
    assert.equal(next.classList.contains('rom-card'), true);
    assert.equal(next.getAttribute('aria-label'), 'Metroid');
  });
});

describe('TV focus lands on the first ROM after the list loads', () => {
  /**
   * @param {Promise<void> | null} gate
   */
  function boot(gate) {
    const dom = new JSDOM(PAGE, {
      runScripts: 'outside-only',
      url: 'https://joeheyming.github.io/emulator/nes/?tv=1'
    });
    const { window } = dom;
    if (typeof window.WebAssembly === 'undefined') window.WebAssembly = WebAssembly;
    window.crossOriginIsolated = true;
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {}
    });
    window.eval(consolesSrc);
    window.eval(romAcquireSrc);
    window.eval(leanbackSrc);
    window.eval(romBrowserSrc);
    stubIaClient(window, gate);
    window.eval(launchSrc);
    return window;
  }

  it('focuses the first card when focus is still on the search toggle', async () => {
    const window = boot(null);
    await waitFor(() => {
      const browser = window.document.querySelector('rom-browser');
      return !!browser?.shadowRoot?.activeElement?.classList.contains('rom-card');
    }, 'first card was not focused');
    const browser = window.document.querySelector('rom-browser');
    assert.equal(browser.shadowRoot.activeElement.getAttribute('aria-label'), AWAKENING);
    window.close();
  });

  it('focuses the first card from the boot card and from document.body', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const window = boot(gate);
    await waitFor(() => {
      const browser = window.document.querySelector('rom-browser');
      const toggle = browser?.shadowRoot?.getElementById('searchToggleBtn');
      return !!toggle && browser.shadowRoot.activeElement === toggle;
    }, 'search toggle was not focused while the list loaded');
    const bootCard = window.document.getElementById('boot-card');
    const browser = bootCard.querySelector('rom-browser');

    bootCard.tabIndex = -1;
    bootCard.focus();
    release();
    await waitFor(
      () => browser.shadowRoot.activeElement?.classList.contains('rom-card'),
      'boot card should yield to the first ROM'
    );

    window.close();

    let releaseBody;
    const bodyGate = new Promise((resolve) => {
      releaseBody = resolve;
    });
    const bodyWindow = boot(bodyGate);
    await waitFor(() => {
      const browser = bodyWindow.document.querySelector('rom-browser');
      const toggle = browser?.shadowRoot?.getElementById('searchToggleBtn');
      return !!toggle && browser.shadowRoot.activeElement === toggle;
    }, 'search toggle was not focused while the list loaded');
    const bodyBrowser = bodyWindow.document.querySelector('rom-browser');
    bodyBrowser.shadowRoot.getElementById('searchToggleBtn').blur();
    assert.equal(bodyWindow.document.activeElement, bodyWindow.document.body);
    releaseBody();
    await waitFor(
      () => bodyBrowser.shadowRoot.activeElement?.classList.contains('rom-card'),
      'body should yield to the first ROM'
    );
    bodyWindow.close();
  });

  it('does not steal focus the visitor moved elsewhere', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const window = boot(gate);
    await waitFor(() => {
      const browser = window.document.querySelector('rom-browser');
      const toggle = browser?.shadowRoot?.getElementById('searchToggleBtn');
      return !!toggle && browser.shadowRoot.activeElement === toggle;
    }, 'search toggle was not focused while the list loaded');
    const browser = window.document.querySelector('rom-browser');

    const elsewhere = window.document.createElement('button');
    elsewhere.textContent = 'Elsewhere';
    window.document.body.appendChild(elsewhere);
    elsewhere.focus();
    release();
    await waitFor(
      () => browser.shadowRoot.querySelectorAll('.rom-card').length === ROMS.length,
      'list did not paint'
    );
    assert.equal(window.document.activeElement, elsewhere);
    assert.equal(browser.shadowRoot.activeElement, null);
    window.close();
  });
});
