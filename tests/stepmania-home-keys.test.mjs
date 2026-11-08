import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE = pathToFileURL(join(ROOT, 'remote.js')).href;
const HOME = pathToFileURL(join(ROOT, 'stepmania/js/homeScreen.js')).href;
const INPUT = pathToFileURL(join(ROOT, 'stepmania/js/inputManager.js')).href;

function box(el, x, y, w, h) {
  el.getBoundingClientRect = () => ({
    x,
    y,
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    toJSON() {
      return {};
    }
  });
}

function press(window, el, key, keyCode) {
  const event = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    composed: true
  });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  Object.defineProperty(event, 'which', { value: keyCode });
  el.dispatchEvent(event);
  return event;
}

test('home screen arrows move between controls and do not step', async () => {
  const dom = new JSDOM(
    `<!doctype html><body>
      <div id="sm-home">
        <button type="button" id="sm-home-browse">Browse songs</button>
        <a id="charts" href="/stepmania/songs/">Top charts</a>
        <button type="button" id="sm-home-open-pack">Open pack</button>
      </div>
      <zenius-browser id="zenius"></zenius-browser>
      <share-button id="share"></share-button>
      <feedback-button id="feedback"></feedback-button>
      <button type="button" id="restart-btn">Restart</button>
      <button type="button" id="settings-btn">Keys</button>
      <button type="button" id="fullscreen-toggle">fullscreen</button>
    </body>`,
    { url: 'https://joeheyming.github.io/stepmania/' }
  );
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.customElements = window.customElements;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.localStorage = window.localStorage;

  class ZeniusBrowser extends window.HTMLElement {
    constructor() {
      super();
      this.tabIndex = 0;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<button type="button" id="open-zenius-browser">Songs</button>' +
        '<div hidden><button type="button" id="secret">Secret</button></div>';
    }
  }
  class ShareButton extends window.HTMLElement {
    constructor() {
      super();
      this.tabIndex = 0;
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<button type="button" id="share-btn">Share</button>';
    }
  }
  class FeedbackButton extends window.HTMLElement {
    constructor() {
      super();
      this.tabIndex = 0;
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<button type="button" id="feedback-btn">Feedback</button>';
    }
  }
  window.customElements.define('zenius-browser', ZeniusBrowser);
  window.customElements.define('share-button', ShareButton);
  window.customElements.define('feedback-button', FeedbackButton);

  await import(REMOTE + '?stepmania-home=1');
  const { bindHomeScreen } = await import(HOME);
  const { InputManager } = await import(INPUT);

  bindHomeScreen();
  assert.equal(window.document.activeElement.id, 'sm-home-browse');
  const manager = new InputManager({ forTests: true, storage: window.localStorage });
  const steps = [];
  const toggles = [];
  manager.onStep((col) => steps.push(col));
  manager.onTogglePlay(() => toggles.push('play'));
  manager.init();

  const browse = window.document.getElementById('sm-home-browse');
  const charts = window.document.getElementById('charts');
  const zenius = window.document.getElementById('zenius');
  const songs = zenius.shadowRoot.getElementById('open-zenius-browser');
  const secret = zenius.shadowRoot.getElementById('secret');
  const shareHost = window.document.getElementById('share');
  const share = shareHost.shadowRoot.getElementById('share-btn');
  const feedbackHost = window.document.getElementById('feedback');
  const restart = window.document.getElementById('restart-btn');
  const settings = window.document.getElementById('settings-btn');
  const fullscreen = window.document.getElementById('fullscreen-toggle');

  box(browse, 205, 468, 148, 44);
  box(charts, 360, 468, 122, 44);
  box(window.document.getElementById('sm-home-open-pack'), 490, 468, 123, 44);
  box(zenius, 147, 132, 91, 40);
  box(songs, 147, 132, 91, 40);
  box(secret, 147, 80, 91, 40);
  box(shareHost, 246, 132, 81, 40);
  box(share, 246, 132, 81, 40);
  box(feedbackHost, 335, 132, 108, 40);
  box(restart, 451, 132, 90, 40);
  box(settings, 559, 132, 79, 40);
  box(fullscreen, 762, 205, 44, 44);

  const intoMenu = press(window, window.document.body, 'ArrowDown', 40);
  assert.equal(intoMenu.defaultPrevented, true);
  assert.equal(window.document.activeElement, browse);
  assert.deepEqual(steps, []);

  press(window, browse, 'ArrowRight', 39);
  assert.equal(window.document.activeElement, charts);
  assert.deepEqual(steps, []);

  charts.focus();
  press(window, charts, 'ArrowLeft', 37);
  assert.equal(window.document.activeElement, browse);

  press(window, browse, 'ArrowUp', 38);
  assert.equal(window.document.activeElement, fullscreen);

  press(window, fullscreen, 'ArrowLeft', 37);
  assert.equal(window.document.activeElement, settings);

  press(window, settings, 'ArrowLeft', 37);
  assert.equal(window.document.activeElement, restart);

  press(window, restart, 'ArrowLeft', 37);
  assert.equal(window.document.activeElement, feedbackHost);

  press(window, feedbackHost, 'ArrowLeft', 37);
  assert.equal(window.document.activeElement, shareHost);

  const aboveShare = press(window, shareHost, 'ArrowUp', 38);
  assert.equal(aboveShare.defaultPrevented, true);
  assert.notEqual(zenius.shadowRoot.activeElement, secret);

  shareHost.focus();
  press(window, shareHost, 'ArrowLeft', 37);
  assert.equal(window.document.activeElement, zenius);

  browse.focus();
  const space = press(window, browse, ' ', 32);
  assert.equal(space.defaultPrevented, false);
  assert.deepEqual(toggles, []);

  const home = window.document.getElementById('sm-home');
  home.hidden = true;
  const step = press(window, window.document.body, 'ArrowDown', 40);
  assert.equal(step.defaultPrevented, true);
  assert.deepEqual(steps, [1]);

  browse.focus();
  const onButton = press(window, browse, 'ArrowDown', 40);
  assert.equal(onButton.defaultPrevented, true);
  assert.deepEqual(steps, [1]);

  manager.destroy();
  dom.window.close();
});
