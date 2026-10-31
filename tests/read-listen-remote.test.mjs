import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('read and listen expose buttons keyboard focus can reach', () => {
  const read = new JSDOM(readFileSync(join(root, 'read/index.html'), 'utf8')).window.document;
  assert.equal(read.getElementById('zone-prev').tagName, 'BUTTON');
  assert.equal(read.getElementById('zone-next').tagName, 'BUTTON');
  assert.equal(read.getElementById('reader-container').hasAttribute('tabindex'), false);
  assert.equal(read.getElementById('reader-controls').hasAttribute('inert'), true);
  assert.ok(read.getElementById('btn-reader-text'));

  const listen = new JSDOM(readFileSync(join(root, 'listen/index.html'), 'utf8')).window.document;
  assert.equal(listen.getElementById('btn-play-pause').tagName, 'BUTTON');
  assert.equal(listen.getElementById('btn-prev').tagName, 'BUTTON');
  assert.equal(listen.getElementById('btn-next').tagName, 'BUTTON');
});

test('arrows turn reader pages and a click starts the audiobook', async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch
  };

  try {
    const readerDom = new JSDOM(
      `<!doctype html><body>
        <div id="reader-view">
          <button type="button" class="page-zone" id="zone-next">Next</button>
          <div id="reader-controls" inert></div>
          <div id="reader-container"></div>
          <button type="button" id="btn-close-reader">Library</button>
        </div>
        <div id="toc-sheet" class="hidden"></div>
      </body>`,
      { url: 'http://localhost/read/' }
    );
    const readerWindow = readerDom.window;
    globalThis.window = readerWindow;
    globalThis.document = readerWindow.document;
    globalThis.Element = readerWindow.Element;
    globalThis.HTMLElement = readerWindow.HTMLElement;

    const { Reader } = await import(pathToFileURL(join(root, 'read/reader.js')).href);
    const container = readerWindow.document.getElementById('reader-container');
    container.scrollTo = () => {};
    const reader = new Reader(container, readerWindow.document.getElementById('reader-controls'));
    reader._stepHeight = 100;
    reader._totalPages = 5;
    reader._currentPage = 1;

    const zone = readerWindow.document.getElementById('zone-next');
    zone.dispatchEvent(
      new readerWindow.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true
      })
    );
    assert.equal(reader._currentPage, 2);

    readerWindow.document.getElementById('reader-view').classList.add('hidden');
    zone.dispatchEvent(
      new readerWindow.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true
      })
    );
    assert.equal(reader._currentPage, 2);

    readerWindow.document.getElementById('reader-view').classList.remove('hidden');
    const library = readerWindow.document.getElementById('btn-close-reader');
    library.dispatchEvent(
      new readerWindow.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true
      })
    );
    assert.equal(reader._currentPage, 2);
    clearInterval(reader._intervalTimer);

    const listenDom = new JSDOM(readFileSync(join(root, 'listen/index.html'), 'utf8'), {
      url: 'http://localhost/listen/'
    });
    const listenWindow = listenDom.window;
    globalThis.window = listenWindow;
    globalThis.document = listenWindow.document;
    globalThis.Element = listenWindow.Element;
    globalThis.HTMLElement = listenWindow.HTMLElement;
    globalThis.localStorage = listenWindow.localStorage;
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.includes('advancedsearch.php')) {
        return {
          ok: true,
          json: async () => ({
            response: {
              docs: [
                {
                  identifier: 'pride_and_prejudice_librivox',
                  title: 'Pride and Prejudice',
                  creator: 'Austen'
                }
              ]
            }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    await import(pathToFileURL(join(root, 'listen/app.js')).href);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const card = listenWindow.document.querySelector('#browse-grid button.book-card');
    assert.ok(card, 'recent audiobook is a button');
    assert.match(card.textContent, /Pride and Prejudice/);

    const audio = listenWindow.document.getElementById('audio-element');
    let plays = 0;
    audio.play = () => {
      plays += 1;
      return Promise.resolve();
    };
    audio.pause = () => {};
    listenWindow.document.getElementById('btn-play-pause').click();
    assert.equal(plays, 1);

    Object.defineProperty(audio, 'duration', { configurable: true, get: () => 100 });
    const seek = listenWindow.document.getElementById('seek-bar');
    seek.value = '500';
    seek.dispatchEvent(new listenWindow.Event('change', { bubbles: true }));
    assert.equal(audio.currentTime, 50);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.Element = previous.Element;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.localStorage = previous.localStorage;
    globalThis.fetch = previous.fetch;
  }
});
