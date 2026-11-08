import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { lookupZeniusTitles } from '../analytics/zenius-titles.mjs';
import { refreshHomeLists, togglePopularList } from '../stepmania/js/homeScreen.js';
import {
  clearPopularSongsCache,
  loadPopularSongs,
  popularSongEntries
} from '../stepmania/js/popularSongs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a zenius id becomes a song you can start, and a missing title stays off the list', async () => {
  const entries = await loadPopularSongs(5, {
    enable: async () => ({
      whenReady: async () => {},
      top: () => [
        { id: 'zenius-26360', name: 'zenius 26360' },
        { id: 'zenius-9', name: 'zenius 9' },
        { id: 'local-pack', name: 'My Pack' }
      ]
    }),
    lookup: async (ids) => {
      assert.deepEqual(ids, ['26360', '9']);
      return new Map([['26360', 'Gargoyle']]);
    }
  });
  assert.deepEqual(
    entries.map((entry) => entry.title),
    ['Gargoyle']
  );
  assert.equal(entries[0].simfileId, '26360');
  assert.match(entries[0].zeniusUrl, /simfileid=26360$/);
});

test('a title already stored on the count is kept', () => {
  const entries = popularSongEntries([{ id: 'zenius-3', name: 'Max 300' }], new Map());
  assert.equal(entries[0].title, 'Max 300');
  assert.equal(entries[0].simfileId, '3');
});

test('an empty tally produces no songs', async () => {
  const entries = await loadPopularSongs(5, {
    enable: async () => ({
      whenReady: async () => {},
      top: () => []
    }),
    lookup: async () => {
      throw new Error('should not look up titles');
    }
  });
  assert.deepEqual(entries, []);
});

test('the home screen leads with songs people play, each one a start link', async () => {
  const home = readFileSync(path.join(ROOT, 'stepmania/index.html'), 'utf8');
  const popularAt = home.indexOf('id="sm-home-popular"');
  const browseAt = home.indexOf('id="sm-home-browse"');
  const recentAt = home.indexOf('id="sm-home-recent"');
  assert.ok(popularAt > 0 && popularAt < browseAt && browseAt < recentAt);

  const browser = readFileSync(path.join(ROOT, 'stepmania/js/zeniusRender.js'), 'utf8');
  const playedAt = browser.indexOf('id="zenius-popular-block"');
  const recentChipsAt = browser.indexOf('id="zenius-recent-block"');
  assert.ok(playedAt > 0 && playedAt < recentChipsAt);

  const dom = new JSDOM(
    `<!doctype html><body>
      <section id="sm-home-popular" hidden>
        <h4 class="sm-home-heading">
          <button type="button" id="sm-home-popular-more" class="sm-home-more" aria-expanded="false">
            Played a lot
            <span class="sm-home-more-hint" id="sm-home-popular-hint" hidden>Show more</span>
          </button>
        </h4>
        <div id="sm-home-popular-chips"></div>
      </section>
      <button id="sm-home-browse">Browse songs</button>
      <div id="sm-home-recent"></div>
      <div id="sm-home-saved"></div>
    </body>`,
    { url: 'https://joeheyming.github.io/stepmania/' }
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;

  clearPopularSongsCache();
  await lookupZeniusTitles(['4242'], {
    fetchText: async () => '<h1>Gargoyle</h1>',
    storage: null
  });
  window.heymingAnalytics = { enable: async () => {} };
  window.heymingCounts = {
    whenReady: async () => {},
    top: () => [{ id: 'zenius-4242', name: 'zenius 4242' }]
  };

  await refreshHomeLists();
  const section = document.getElementById('sm-home-popular');
  assert.equal(section.hidden, false);
  const link = section.querySelector('a.sm-home-chip');
  assert.equal(link.textContent, 'Gargoyle');
  assert.equal(link.getAttribute('data-play-link'), 'sm-home-popular');
  assert.equal(link.getAttribute('data-play-name'), 'Gargoyle');
  assert.match(decodeURIComponent(link.getAttribute('href')), /simfileid=4242/);
  assert.equal(document.getElementById('sm-home-popular-hint').hidden, true);

  clearPopularSongsCache();
  window.heymingCounts.top = () =>
    Array.from({ length: 7 }, (_, index) => ({
      id: `zenius-${index + 1}`,
      name: `Song ${index + 1}`
    }));
  await refreshHomeLists();
  const chips = () => document.querySelectorAll('#sm-home-popular-chips a');
  const hint = document.getElementById('sm-home-popular-hint');
  assert.equal(chips().length, 5);
  assert.equal(hint.hidden, false);
  assert.equal(hint.textContent, 'Show more');

  await togglePopularList();
  assert.equal(chips().length, 7);
  assert.equal(hint.textContent, 'Show less');
  assert.equal(
    document.getElementById('sm-home-popular-more').getAttribute('aria-expanded'),
    'true'
  );

  await togglePopularList();
  assert.equal(chips().length, 5);
  assert.equal(hint.textContent, 'Show more');
});
