import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  appendSimfileTableItemsToContent,
  blockReasonForStyles,
  parseZeniusSearchResults
} from '../stepmania/js/zeniusParsers.js';
import {
  blockReasonForSong,
  rememberUnplayable,
  unplayableReason
} from '../stepmania/js/zeniusLibraryStorage.js';
import { isStructuralSongFailure } from '../stepmania/js/songLoader.js';
import { createZeniusContentCard } from '../stepmania/js/zeniusRender.js';

const store = new Map();

beforeEach(() => {
  store.clear();
  globalThis.DOMParser = new JSDOM('').window.DOMParser;
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
});

describe('listing step styles', () => {
  it('lets a 4-arrow style through and stops doubles-only and 8-arrow styles', () => {
    assert.equal(blockReasonForStyles(['dance-single', 'dance-double']), '');
    assert.equal(blockReasonForStyles(['techno-single4']), '');
    assert.equal(blockReasonForStyles(['dance-double']), 'Doubles only');
    assert.equal(blockReasonForStyles(['ds3ddx-single']), 'Not a 4-arrow chart (ds3ddx-single)');
    assert.equal(blockReasonForStyles([]), '');
  });

  it('does not offer a doubles-only category row as a playable song', () => {
    const html = `<table>
      <tr>
        <td><a href="viewsimfile.php?simfileid=70622">Megascorcher</a></td>
        <td><a href="simfiles_getstepchart.php?simfileid=70622&amp;difficulty=expert&amp;style=dance-double">9</a></td>
      </tr>
      <tr>
        <td><a href="viewsimfile.php?simfileid=1">AMERICAN BOY</a></td>
        <td><a href="simfiles_getstepchart.php?simfileid=1&amp;difficulty=basic&amp;style=dance-single">3</a></td>
        <td><a href="simfiles_getstepchart.php?simfileid=1&amp;difficulty=basic&amp;style=dance-double">8</a></td>
      </tr>
    </table>`;
    const content = { type: '', items: [] };
    appendSimfileTableItemsToContent(new JSDOM(html).window.document, content);
    const doubles = content.items.find((item) => item.simfileId === '70622');
    const single = content.items.find((item) => item.simfileId === '1');
    assert.equal(doubles.playable, false);
    assert.equal(doubles.unplayableReason, 'Doubles only');
    assert.equal(single.playable, true);
    assert.deepEqual(
      single.difficulties.map((d) => d.rating),
      [3]
    );
  });

  it('treats a search row with only a doubles column as unplayable', () => {
    const html = `<table>
      <tr>
        <td><a href="viewsimfile.php?simfileid=70622" title="Megascorcher / A">Megascorcher</a></td>
        <td></td>
        <td>9</td>
        <td><a href="viewsimfilecategory.php?categoryid=1">Pack</a></td>
      </tr>
      <tr>
        <td><a href="viewsimfile.php?simfileid=40" title="Xepher / Tatsh">Xepher</a></td>
        <td>12</td>
        <td>15</td>
        <td></td>
      </tr>
    </table>`;
    const results = parseZeniusSearchResults(html);
    assert.equal(results[0].playable, false);
    assert.equal(results[0].unplayableReason, 'Doubles only');
    assert.equal(results[1].playable, true);
  });
});

describe('songs that failed once we opened them', () => {
  it('remembers a structural refusal and not a proxy failure', () => {
    assert.equal(
      isStructuralSongFailure('This song has no 4-arrow singles (found ds3ddx-single).'),
      true
    );
    assert.equal(isStructuralSongFailure('Could not download this song through any proxy.'), false);
    rememberUnplayable('64090', 'This song has no 4-arrow singles (found ds3ddx-single).');
    assert.equal(
      blockReasonForSong({ simfileId: '64090', playable: true }),
      'This song has no 4-arrow singles (found ds3ddx-single).'
    );
    assert.equal(unplayableReason('1'), '');
  });

  it('renders a blocked song as text instead of a play link', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://localhost:8443/stepmania/'
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    rememberUnplayable('70622', 'Doubles only');
    const card = createZeniusContentCard(
      {
        constructor: { getSimfileMetadata: () => null },
        currentPath: 'categoryid=1'
      },
      {
        type: 'simfile',
        name: 'Megascorcher',
        url: 'viewsimfile.php?simfileid=70622',
        simfileId: '70622',
        playable: false,
        unplayableReason: 'Doubles only',
        difficulties: []
      },
      'categoryid=1'
    );
    assert.equal(card.classList.contains('is-unplayable'), true);
    assert.equal(card.querySelector('a.content-item-body'), null);
    assert.match(card.textContent, /Doubles only/);
    assert.match(card.textContent, /Megascorcher/);
    assert.equal(card.querySelector('.badge-unplayable')?.textContent.trim(), 'Doubles only');
    assert.equal(card.querySelector('.content-item-body').hasAttribute('title'), false);
    assert.equal(card.querySelector('.fav-btn').getAttribute('aria-label'), 'Save Megascorcher');
  });

  it('renders Zenius song names as text', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://localhost:8443/stepmania/'
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    const card = createZeniusContentCard(
      { constructor: { getSimfileMetadata: () => null }, currentPath: 'categoryid=1' },
      {
        type: 'simfile',
        name: '<img src=x onerror=alert(1)>',
        url: 'viewsimfile.php?simfileid=5',
        simfileId: '5',
        difficulties: []
      },
      'categoryid=1'
    );
    assert.equal(card.querySelector('img'), null);
    assert.equal(card.querySelector('h3').textContent, '<img src=x onerror=alert(1)>');
  });
});
