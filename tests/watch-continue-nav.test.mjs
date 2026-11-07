import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const remoteHref = pathToFileURL(join(root, 'remote.js')).href;
const showsHref = pathToFileURL(join(root, 'watch/modules/views/shows-view.js')).href;

function place(el, x, y, w, h) {
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

test('up on a continue card focuses its remove button, then the card above', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://joeheyming.github.io/watch/'
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.localStorage = window.localStorage;
  await import(remoteHref + '?watch-continue=1');
  const { wireRemoveSubNav } = await import(showsHref);

  const chip = window.document.createElement('button');
  chip.className = 'tv-tag-chip';
  chip.textContent = 'SATIRE';
  const above = window.document.createElement('a');
  above.className = 'tv-continue-card';
  above.href = '?show=amazing-stories';
  above.textContent = 'Amazing Stories';
  const card = window.document.createElement('a');
  card.className = 'tv-continue-card';
  card.href = '?show=astro-boy';
  card.textContent = 'Astro Boy';
  const remove = window.document.createElement('button');
  remove.className = 'tv-continue-remove';
  remove.tabIndex = -1;
  remove.textContent = '✕';
  card.appendChild(remove);
  window.document.body.append(chip, above, card);

  // The chip sits between the two cards, closer to Astro Boy than
  // Amazing Stories is. Generic spatial nav would stop on SATIRE.
  place(chip, 200, 230, 65, 27);
  place(above, 10, 100, 220, 120);
  place(card, 10, 280, 220, 140);
  place(remove, 180, 290, 28, 28);

  wireRemoveSubNav(card, remove);
  card.focus();
  const toButton = key(window, card, 'ArrowUp');
  assert.equal(toButton.heymingHandled, true);
  assert.equal(window.document.activeElement, remove);

  const toCard = key(window, remove, 'ArrowUp');
  assert.equal(toCard.heymingHandled, true);
  assert.equal(window.document.activeElement, above);

  remove.focus();
  key(window, remove, 'ArrowDown');
  assert.equal(window.document.activeElement, card);
});
