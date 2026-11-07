import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const remoteHref = pathToFileURL(join(root, 'remote.js')).href;
const rovingHref = pathToFileURL(join(root, 'watch/modules/roving-tabindex.js')).href;
const quicknavHref = pathToFileURL(join(root, 'watch/modules/quicknav.js')).href;

function place(el, x, y, w, h, offsetLeft) {
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
  Object.defineProperty(el, 'offsetTop', { configurable: true, get: () => y });
  Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => offsetLeft ?? x });
  Object.defineProperty(el, 'offsetParent', {
    configurable: true,
    get: () => el.ownerDocument.body
  });
}

function key(window, el, name) {
  const event = new window.KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    composed: true
  });
  el.dispatchEvent(event);
  return event;
}

test('the rail opens only from a far-left card and moves vertically', async () => {
  const dom = new JSDOM(
    `<!doctype html><body>
      <aside id="tv-quicknav">
        <a class="tv-quicknav-btn" id="nav-search" data-quicknav="search" href="./#search">Search</a>
        <a class="tv-quicknav-btn" id="nav-shows" data-quicknav="shows" href="./">Shows</a>
        <a class="tv-quicknav-btn" id="nav-movies" data-quicknav="movies" href="./#movies">Movies</a>
      </aside>
      <button id="chip" class="tv-tag-chip">SATIRE</button>
      <div id="shows">
        <div id="grid">
          <a id="alvin" class="tv-show-card" href="?show=alvin-chipmunks">Alvin</a>
          <a id="amazing" class="tv-show-card" href="?show=amazing-stories">Amazing Stories</a>
        </div>
      </div>
      <div id="movies">
        <a id="movie" class="tv-show-card" href="?movie=example">A Movie</a>
      </div>
    </body>`,
    { url: 'https://joeheyming.github.io/watch/', pretendToBeVisual: true }
  );
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.fetch = () => new Promise(() => {});
  await import(remoteHref + '?watch-quicknav=1');
  const { applyRovingTabindex } = await import(rovingHref);
  const { attachQuicknavKeys } = await import(quicknavHref);

  const search = window.document.getElementById('nav-search');
  const shows = window.document.getElementById('nav-shows');
  const movies = window.document.getElementById('nav-movies');
  const chip = window.document.getElementById('chip');
  const alvin = window.document.getElementById('alvin');
  const amazing = window.document.getElementById('amazing');
  const movie = window.document.getElementById('movie');
  place(search, 16, 40, 60, 63);
  place(shows, 16, 160, 60, 63);
  place(movies, 16, 280, 60, 63);
  place(chip, 120, 20, 65, 27);
  place(alvin, 16, 100, 124, 187, 16);
  place(amazing, 160, 100, 124, 187, 160);
  place(movie, 16, 800, 124, 187, 16);

  applyRovingTabindex(window.document.getElementById('grid'), { selector: '.tv-show-card' });
  attachQuicknavKeys();

  alvin.focus();
  key(window, alvin, 'ArrowUp');
  assert.equal(window.document.activeElement, chip);

  alvin.focus();
  const intoRail = key(window, alvin, 'ArrowLeft');
  assert.equal(intoRail.heymingGridNav, true);
  assert.equal(window.document.activeElement, shows);

  key(window, shows, 'ArrowDown');
  assert.equal(window.document.activeElement, movies);
  key(window, movies, 'ArrowDown');
  assert.equal(window.document.activeElement, movies);
  key(window, movies, 'ArrowUp');
  assert.equal(window.document.activeElement, shows);
  key(window, shows, 'ArrowLeft');
  assert.equal(window.document.activeElement, shows);

  key(window, shows, 'ArrowRight');
  assert.equal(window.document.activeElement, alvin);
  movies.focus();
  key(window, movies, 'ArrowRight');
  assert.equal(window.document.activeElement, movie);

  amazing.focus();
  key(window, amazing, 'ArrowLeft');
  assert.equal(window.document.activeElement, alvin);
});
