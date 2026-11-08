import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE = pathToFileURL(join(ROOT, 'remote.js')).href;

/**
 * @param {Window & typeof globalThis} window
 * @param {EventTarget} target
 * @param {string} key
 * @param {KeyboardEventInit} [init]
 */
function press(window, target, key, init = {}) {
  const event = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * jsdom leaves keyCode at 0 unless it is set by hand. Lane input reads it.
 * @param {Window & typeof globalThis} window
 * @param {string} key
 * @param {number} keyCode
 */
function laneKey(window, key, keyCode) {
  const event = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    composed: true
  });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  Object.defineProperty(event, 'which', { value: keyCode });
  return event;
}

describe('stepmania overlays with remote.js', () => {
  /** @type {JSDOM} */
  let dom;
  /** @type {Document} */
  let doc;
  let backCalls = 0;

  before(async () => {
    dom = new JSDOM(
      `<!doctype html><html><head><style>
        game-over-modal { display: none; }
        game-over-modal.visible { display: flex; }
      </style></head><body>
        <div id="sm-home" hidden></div>
        <button type="button" id="opener">Opener</button>
        <loading-overlay id="loading-overlay"></loading-overlay>
        <game-over-modal id="game-over-modal"></game-over-modal>
      </body></html>`,
      { url: 'https://localhost:8443/stepmania/', pretendToBeVisual: true }
    );
    const { window } = dom;
    doc = window.document;
    window.history.back = () => {
      backCalls += 1;
    };
    Object.assign(globalThis, {
      window,
      document: doc,
      HTMLElement: window.HTMLElement,
      Element: window.Element,
      customElements: window.customElements,
      localStorage: window.localStorage,
      getComputedStyle: window.getComputedStyle.bind(window),
      CSSStyleSheet: class {
        async replace() {}
      },
      fetch: async () => new Response('/* test */')
    });
    Object.defineProperty(window.ShadowRoot.prototype, 'adoptedStyleSheets', {
      configurable: true,
      get() {
        return this._adoptedStyleSheets || [];
      },
      set(sheets) {
        this._adoptedStyleSheets = sheets;
      }
    });
    await import(REMOTE + '?stepmania-overlays-remote=1');
    await import('../stepmania/js/loading-overlay.js');
    await import('../stepmania/js/game-over-modal.js');
    await import('../stepmania/js/difficulty-selector.js');
    await import('../stepmania/js/zenius-browser.js');
    await import('../stepmania/js/settings-sheet.js');
  });

  after(() => {
    dom.window.close();
  });

  describe('chart chips', () => {
    /** @type {HTMLElement & { showReadyToPlay: Function, shadowRoot: ShadowRoot }} */
    let overlay;
    /** @type {number[]} */
    let changes = [];

    before(() => {
      overlay = /** @type {typeof overlay} */ (doc.getElementById('loading-overlay'));
      overlay.showReadyToPlay({
        songTitle: 'Xepher',
        charts: [
          { difficulty: 'Easy', rating: 4 },
          { difficulty: 'Hard', rating: 9 },
          { difficulty: 'Challenge', rating: 14 }
        ],
        currentDifficulty: 1,
        onDifficultyChange: (/** @type {number} */ index) => changes.push(index)
      });
    });

    const chip = (/** @type {number} */ i) =>
      overlay.shadowRoot.querySelector(`.chart-choice[data-index="${i}"]`);
    const checked = () =>
      [...overlay.shadowRoot.querySelectorAll('.chart-choice')].map((el) =>
        el.getAttribute('aria-checked')
      );

    it('is a named radiogroup with roving tabindex', () => {
      const group = overlay.shadowRoot.getElementById('chart-list');
      assert.equal(group.getAttribute('role'), 'radiogroup');
      assert.equal(group.getAttribute('aria-label'), 'Difficulty');
      assert.deepEqual(
        [...overlay.shadowRoot.querySelectorAll('.chart-choice')].map((el) =>
          el.getAttribute('role')
        ),
        ['radio', 'radio', 'radio']
      );
      assert.deepEqual(checked(), ['false', 'true', 'false']);
      assert.deepEqual(
        [...overlay.shadowRoot.querySelectorAll('.chart-choice')].map((el) => el.tabIndex),
        [-1, 0, -1]
      );
    });

    it('Right and Left change the chart, wrap, and claim the key from remote.js', () => {
      chip(1).focus();
      const right = press(dom.window, chip(1), 'ArrowRight');
      assert.equal(right.heymingHandled, true);
      assert.equal(right.defaultPrevented, true);
      assert.deepEqual(checked(), ['false', 'false', 'true']);
      assert.equal(overlay.shadowRoot.activeElement, chip(2));
      assert.equal(chip(2).tabIndex, 0);
      assert.equal(chip(1).tabIndex, -1);
      assert.equal(
        overlay.shadowRoot.getElementById('play-btn').textContent,
        'Start · Challenge 14'
      );

      press(dom.window, chip(2), 'ArrowRight');
      assert.deepEqual(checked(), ['true', 'false', 'false']);
      press(dom.window, chip(0), 'ArrowLeft');
      assert.deepEqual(checked(), ['false', 'false', 'true']);
      assert.deepEqual(changes, [2, 0, 2]);
    });

    it('Home and End jump to the ends', () => {
      const home = press(dom.window, chip(2), 'Home');
      assert.equal(home.heymingHandled, true);
      assert.equal(overlay.shadowRoot.activeElement, chip(0));
      press(dom.window, chip(0), 'End');
      assert.equal(overlay.shadowRoot.activeElement, chip(2));
    });

    it('leaves Up and Down to remote.js', () => {
      chip(2).focus();
      const down = press(dom.window, chip(2), 'ArrowDown');
      assert.notEqual(down.heymingHandled, true);
      assert.deepEqual(checked(), ['false', 'false', 'true']);
    });

    it('Enter on a chart starts it, and waits when the audio is still coming', () => {
      const started = [];
      overlay.showReadyToPlay({
        songTitle: 'Beethoven Virus',
        charts: [
          { difficulty: 'Beginner', rating: 3 },
          { difficulty: 'Easy', rating: 5 }
        ],
        currentDifficulty: 0,
        onPlay: () => started.push(overlay.chartIndex),
        onDifficultyChange: (/** @type {number} */ index) => changes.push(index)
      });
      chip(0).click();
      assert.deepEqual(started, [0]);

      const pointer = new dom.window.MouseEvent('click', { bubbles: true, detail: 1 });
      chip(1).dispatchEvent(pointer);
      assert.deepEqual(started, [0], 'a pointer click only highlights the chart');
      assert.equal(chip(1).getAttribute('aria-checked'), 'true');

      overlay.showReadyToPlay({
        songTitle: 'Beethoven Virus',
        charts: [{ difficulty: 'Beginner', rating: 3 }],
        audioReady: false,
        onPlay: () => started.push('later')
      });
      chip(0).click();
      assert.deepEqual(started, [0]);
      overlay.markAudioReady();
      assert.deepEqual(started, [0, 'later']);

      overlay.showReadyToPlay({
        songTitle: 'Xepher',
        charts: [
          { difficulty: 'Easy', rating: 4 },
          { difficulty: 'Hard', rating: 9 },
          { difficulty: 'Challenge', rating: 14 }
        ],
        currentDifficulty: 2,
        onDifficultyChange: (/** @type {number} */ index) => changes.push(index)
      });
    });

    it('ignores arrows when focus is not on a chip', () => {
      overlay.shadowRoot.getElementById('play-btn').focus();
      const right = press(dom.window, overlay.shadowRoot.getElementById('play-btn'), 'ArrowRight');
      assert.notEqual(right.heymingHandled, true);
      assert.deepEqual(checked(), ['false', 'false', 'true']);
    });

    it('stops listening once removed from the page', () => {
      const before = changes.length;
      chip(2).focus();
      overlay.remove();
      press(dom.window, chip(2), 'ArrowLeft');
      assert.equal(changes.length, before);
      doc.body.appendChild(overlay);
      overlay.hide();
    });
  });

  describe('game over modal', () => {
    /** @type {HTMLElement & { show: Function, hide: Function, shadowRoot: ShadowRoot }} */
    let modal;
    let closed = 0;

    before(() => {
      modal = /** @type {typeof modal} */ (doc.getElementById('game-over-modal'));
    });

    it('has dialog semantics tied to its title', () => {
      const content = modal.shadowRoot.querySelector('.game-over-content');
      assert.equal(content.getAttribute('role'), 'dialog');
      assert.equal(content.getAttribute('aria-modal'), 'true');
      const labelledBy = content.getAttribute('aria-labelledby');
      assert.ok(labelledBy);
      assert.equal(modal.shadowRoot.getElementById(labelledBy).tagName, 'H2');
    });

    it('releases the pad to menus only while it is visible', async () => {
      const { chartOwnsPad } = await import('../stepmania/js/gamepad-map.js');
      // jsdom ignores styles inside shadow roots, so hide the song card by its host.
      doc.getElementById('loading-overlay').hidden = true;
      assert.equal(chartOwnsPad(doc), true);
      doc.getElementById('opener').focus();
      modal.show({ onClose: () => (closed += 1) });
      assert.equal(chartOwnsPad(doc), false);
      modal.hide();
      assert.equal(chartOwnsPad(doc), true);
      assert.equal(closed, 1);
    });

    it('focuses Play Again on show and restores focus when Escape closes it', () => {
      const opener = doc.getElementById('opener');
      opener.focus();
      closed = 0;
      modal.show({ onClose: () => (closed += 1) });
      assert.equal(modal.shadowRoot.activeElement, modal.shadowRoot.querySelector('.restart-btn'));

      const escape = press(dom.window, modal, 'Escape');
      assert.equal(escape.defaultPrevented, true);
      assert.equal(modal.visible, false);
      assert.equal(closed, 1);
      assert.equal(backCalls, 0);
      assert.equal(doc.activeElement, opener);
    });

    it('keeps Tab and Shift+Tab inside the three buttons', () => {
      modal.show();
      const buttons = [...modal.shadowRoot.querySelectorAll('.buttons button')];
      assert.equal(buttons.length, 3);
      buttons[2].focus();
      const forward = press(dom.window, buttons[2], 'Tab');
      assert.equal(forward.defaultPrevented, true);
      assert.equal(modal.shadowRoot.activeElement, buttons[0]);
      const backward = press(dom.window, buttons[0], 'Tab', { shiftKey: true });
      assert.equal(backward.defaultPrevented, true);
      assert.equal(modal.shadowRoot.activeElement, buttons[2]);
      buttons[1].focus();
      const middle = press(dom.window, buttons[1], 'Tab');
      assert.equal(middle.defaultPrevented, false);
      modal.hide();
    });

    it('does not stack key listeners across shows', () => {
      let closes = 0;
      modal.show({ onClose: () => (closes += 1) });
      modal.show({ onClose: () => (closes += 1) });
      press(dom.window, modal, 'Escape');
      assert.equal(closes, 1);
      press(dom.window, modal, 'Escape');
      assert.equal(closes, 1);
    });
  });

  describe('settings sheet', () => {
    it('is named, keeps focus across re-renders, and returns focus on close', () => {
      const sheet = /** @type {HTMLElement & { open: Function, close: Function }} */ (
        doc.createElement('sm-settings-sheet')
      );
      doc.body.appendChild(sheet);
      const opener = doc.getElementById('opener');
      opener.focus();
      sheet.open();
      const dialog = sheet.shadowRoot.querySelector('[role="dialog"]');
      assert.equal(
        sheet.shadowRoot.getElementById(dialog.getAttribute('aria-labelledby')).tagName,
        'H2'
      );
      assert.equal(sheet.shadowRoot.activeElement, sheet.shadowRoot.getElementById('close-btn'));

      sheet.shadowRoot.querySelector('[data-scroll="down"]').focus();
      sheet.shadowRoot.querySelector('[data-scroll="down"]').click();
      assert.equal(
        sheet.shadowRoot.activeElement,
        sheet.shadowRoot.querySelector('[data-scroll="down"]')
      );
      sheet.shadowRoot.getElementById('reset-btn').focus();
      sheet.shadowRoot.getElementById('reset-btn').click();
      assert.equal(sheet.shadowRoot.activeElement, sheet.shadowRoot.getElementById('reset-btn'));

      sheet.close();
      assert.equal(doc.activeElement, opener);
      sheet.remove();
    });
  });

  describe('difficulty selector', () => {
    it('reports one change per pick after repeated setCharts', () => {
      const selector = /** @type {HTMLElement & { setCharts: Function, setOnChange: Function }} */ (
        doc.createElement('difficulty-selector')
      );
      doc.body.appendChild(selector);
      /** @type {number[]} */
      const picks = [];
      selector.setOnChange((/** @type {number} */ index) => picks.push(index));
      const charts = [
        { difficulty: 'Easy', rating: 3 },
        { difficulty: 'Hard', rating: 8 }
      ];
      selector.setCharts(charts);
      selector.setCharts(charts);
      const select = /** @type {HTMLSelectElement} */ (
        selector.shadowRoot.getElementById('difficulty-select')
      );
      assert.equal(select.getAttribute('aria-label'), 'Difficulty');
      select.value = '1';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      assert.deepEqual(picks, [1]);
    });
  });

  describe('zenius local filter', () => {
    it('matches apostrophes, case, and spacing', async () => {
      const { normalizeSearchText, matchesSearchText } = await import(
        '../stepmania/js/searchText.js'
      );
      assert.equal(normalizeSearchText('  Don’t   STOP`  '), 'dont stop');
      assert.equal(matchesSearchText("Don't Stop", 'dont stop'), true);
      assert.equal(matchesSearchText('Dont Stop', "don't stop"), true);
      assert.equal(matchesSearchText("Don't Stop", 'stop dont'), false);
    });

    it('filters the cached list through the normalized match and announces the count', async () => {
      const { ZENIUS_BROWSER_SHADOW_HTML } = await import('../stepmania/js/zeniusRender.js');
      const proto = dom.window.customElements.get('zenius-browser').prototype;
      const host = doc.createElement('div');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = ZENIUS_BROWSER_SHADOW_HTML;
      const status = root.getElementById('search-status');
      assert.equal(status.getAttribute('role'), 'status');
      assert.equal(status.classList.contains('sr-only'), true);

      const url = 'https://zenius-i-vanisher.com/v5.2/viewsimfilecategory.php?categoryid=7';
      /** @type {Array<{ name: string }>} */
      let shown = [];
      const fake = {
        shadowRoot: root,
        currentPath: 'categoryid=7',
        getCurrentUrl: () => url,
        cache: new Map([
          [
            url,
            {
              items: [
                { type: 'simfile', name: "Don't Stop" },
                { type: 'simfile', name: 'Starlight' }
              ]
            }
          ]
        ]),
        displaySearchResults: (/** @type {Array<{ name: string }>} */ results) => {
          shown = results;
        },
        announceResultCount: proto.announceResultCount
      };
      proto.handleSearch.call(fake, 'dont stop');
      assert.deepEqual(
        shown.map((item) => item.name),
        ["Don't Stop"]
      );
      assert.equal(status.textContent, '1 result');
      proto.handleSearch.call(fake, 'zzz');
      assert.equal(status.textContent, '0 results');
    });
  });

  it('does not turn arrows into steps while a shadow overlay covers the chart', async () => {
    const { InputManager } = await import('../stepmania/js/inputManager.js');
    const overlay =
      /** @type {HTMLElement & { showReadyToPlay: Function, hide: Function, state: string }} */ (
        doc.getElementById('loading-overlay')
      );
    overlay.hidden = false;
    overlay.showReadyToPlay({
      songTitle: 'Xepher',
      charts: [{ difficulty: 'Easy', rating: 4 }],
      currentDifficulty: 0
    });
    const manager = new InputManager({ forTests: true, storage: dom.window.localStorage });
    /** @type {number[]} */
    const steps = [];
    manager.onStep((col) => steps.push(col));

    const covered = laneKey(dom.window, 'ArrowDown', 40);
    manager._onKeyDown(covered);
    assert.equal(covered.defaultPrevented, false);
    assert.deepEqual(steps, []);

    overlay.hide();
    const playing = laneKey(dom.window, 'ArrowDown', 40);
    manager._onKeyDown(playing);
    assert.equal(playing.defaultPrevented, true);
    assert.deepEqual(steps, [1]);

    const modal = /** @type {HTMLElement & { show: Function, hide: Function }} */ (
      doc.getElementById('game-over-modal')
    );
    modal.show({});
    const overModal = laneKey(dom.window, 'ArrowLeft', 37);
    manager._onKeyDown(overModal);
    assert.equal(overModal.defaultPrevented, false);
    assert.deepEqual(steps, [1]);
    modal.hide();
    overlay.hidden = true;
  });
});

describe('stepmania score column', () => {
  it('is a named region, not a focus stop that traps the remote', () => {
    const html = readFileSync(join(ROOT, 'stepmania/index.html'), 'utf8');
    const match = html.match(/<div\s+class="score-panel[\s\S]*?>/);
    assert.ok(match, 'score column markup is present');
    assert.doesNotMatch(match[0], /tabindex/);
    assert.match(match[0], /role="region"/);
    assert.match(match[0], /aria-label="Score and controls"/);
    assert.match(html, /class="mb-6 score-compact" hidden>/);
    const css = readFileSync(join(ROOT, 'stepmania/css/screen.css'), 'utf8');
    assert.match(css, /score-panel:not\(:defined\)\s*\{\s*display:\s*none;/);
  });
});
