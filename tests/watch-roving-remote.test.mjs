import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const remoteHref = pathToFileURL(join(root, 'remote.js')).href;
const rovingHref = pathToFileURL(join(root, 'watch/modules/roving-tabindex.js')).href;

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
  Object.defineProperty(el, 'offsetTop', { configurable: true, get: () => y });
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

test('right from a poster moves to the next poster, not the chip past its edge', async () => {
  const dom = new JSDOM(
    `<!doctype html><body>
      <button id="satire" type="button">SATIRE</button>
      <div id="grid">
        <a id="alvin" class="tv-show-card" href="?show=alvin-chipmunks">Alvin</a>
        <a id="amazing" class="tv-show-card" href="?show=amazing-stories">Amazing Stories</a>
        <a id="beakman" class="tv-show-card" href="?show=beakmans-world">Beakman's World</a>
      </div>
    </body>`,
    { url: 'https://joeheyming.github.io/watch/' }
  );
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  await import(remoteHref + '?watch-roving=1');
  const { applyRovingTabindex } = await import(rovingHref);

  const satire = window.document.getElementById('satire');
  const alvin = window.document.getElementById('alvin');
  const amazing = window.document.getElementById('amazing');
  const beakman = window.document.getElementById('beakman');
  const grid = window.document.getElementById('grid');
  // Measured on the landing page: Alvin's right edge is 216, Amazing
  // Stories starts at 226, and the SATIRE chip at left 253 sits just
  // past that edge, above the row.
  box(satire, 253, 48, 65, 27);
  box(alvin, 10, 125, 206, 308);
  box(amazing, 226, 125, 206, 309);
  box(beakman, 10, 450, 206, 308);

  const ctrl = applyRovingTabindex(grid, { selector: '.tv-show-card' });
  alvin.focus();
  assert.equal(amazing.getAttribute('tabindex'), '-1');

  const right = key(window, alvin, 'ArrowRight');
  assert.equal(right.heymingHandled, true);
  assert.equal(window.document.activeElement, amazing);

  amazing.focus();
  key(window, amazing, 'ArrowDown');
  assert.equal(window.document.activeElement, beakman);

  alvin.focus();
  const up = key(window, alvin, 'ArrowUp');
  assert.equal(up.heymingHandled, undefined);
  assert.equal(window.document.activeElement, satire);

  const movies = window.document.createElement('div');
  const movie = window.document.createElement('a');
  movie.className = 'tv-show-card';
  movie.href = '?movie=x';
  movie.textContent = 'Movie';
  movies.appendChild(movie);
  window.document.body.appendChild(movies);
  box(movie, 10, 800, 206, 308);
  const moviesCtrl = applyRovingTabindex(movies, { selector: '.tv-show-card' });

  window.document.body.focus();
  const fromBody = key(window, window.document.body, 'ArrowRight');
  assert.equal(fromBody.heymingHandled, true);
  assert.equal(window.document.activeElement, alvin);

  const menu = window.document.createElement('button');
  menu.className = 'heyming-nav-toggle';
  menu.textContent = 'Menu';
  window.document.body.appendChild(menu);
  box(menu, 12, 12, 90, 40);
  menu.focus();
  key(window, menu, 'ArrowDown');
  assert.equal(window.document.activeElement, alvin);
  assert.notEqual(window.document.activeElement, satire);

  moviesCtrl.dispose();
  ctrl.dispose();
});
