import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { bookTextSources, gutenbergMirrorDir, looksLikeBook } = await import(
  pathToFileURL(join(root, 'read/reader.js')).href
);

const book = {
  id: 1342,
  formats: {
    'text/html': 'https://www.gutenberg.org/ebooks/1342.html.images',
    'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/1342.txt.utf-8'
  }
};

test('a gutenberg book is read from a mirror before www.gutenberg.org', () => {
  const sources = bookTextSources(book);
  assert.deepEqual(
    sources.map((source) => source.url),
    [
      'https://gutenberg.pglaf.org/cache/epub/1342/pg1342-images.html',
      'https://gutenberg.pglaf.org/cache/epub/1342/pg1342.txt',
      'https://mirror.csclub.uwaterloo.ca/gutenberg/1/3/4/1342/1342-0.txt',
      'https://www.gutenberg.org/ebooks/1342.html.images',
      'https://www.gutenberg.org/ebooks/1342.txt.utf-8'
    ]
  );
  assert.equal(sources[0].isHtml, true);
  assert.equal(sources[2].isHtml, false);
});

test('mirror directories cover one, two, and many digits', () => {
  assert.equal(gutenbergMirrorDir(9), '0/9');
  assert.equal(gutenbergMirrorDir(84), '8/84');
  assert.equal(gutenbergMirrorDir(100), '1/0/100');
});

test('a plain-text-only book skips the html mirror', () => {
  const sources = bookTextSources({
    id: 84,
    formats: { 'text/plain': 'https://www.gutenberg.org/ebooks/84.txt.utf-8' }
  });
  assert.equal(
    sources.some((source) => source.url.endsWith('.html')),
    false
  );
  assert.equal(sources[0].url, 'https://gutenberg.pglaf.org/cache/epub/84/pg84.txt');
});

test('the maintenance page is not a book', () => {
  const page = `<!DOCTYPE html><title>Temporarily Down for Maintenance</title>${'x'.repeat(2000)}`;
  assert.equal(looksLikeBook(page), false);
  assert.equal(looksLikeBook(`The Project Gutenberg eBook. ${'word '.repeat(400)}`), true);
  assert.equal(looksLikeBook('short'), false);
});

test('the reader stops at the first mirror that returns the book', async () => {
  const dom = new JSDOM(
    '<!doctype html><body><div id="reader"></div><div id="controls"></div></body>',
    {
      url: 'https://joeheyming.github.io/read/'
    }
  );
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const asked = [];
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const prose = `The Project Gutenberg eBook of Pride and Prejudice. ${'It is a truth '.repeat(
    80
  )}`;
  dom.window.proxyService = {
    async fetchWithProxy(url) {
      asked.push(url);
      if (url.startsWith('https://gutenberg.pglaf.org/')) return prose;
      throw new Error('All proxies failed after 4 attempts: Failed to fetch');
    }
  };
  try {
    // Skip the constructor: it starts a save interval that would keep the
    // test process alive. Fetching only needs the prototype methods.
    const { Reader } = await import(pathToFileURL(join(root, 'read/reader.js')).href);
    const reader = Object.create(Reader.prototype);
    const result = await reader._fetchBookText(book);
    assert.equal(result.isHtml, true);
    assert.equal(result.baseUrl, 'https://gutenberg.pglaf.org/cache/epub/1342/pg1342-images.html');
    assert.equal(result.text, prose);
    assert.deepEqual(asked, [result.baseUrl]);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.fetch = previous.fetch;
  }
});

test('a book the reader already left cannot paint over the next one', async () => {
  const dom = new JSDOM(
    '<!doctype html><body><div id="reader"></div><div id="controls"></div></body>',
    { url: 'http://localhost/read/' }
  );
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};

  let releaseFirst;
  const firstSettles = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const prose = (title) => `The Project Gutenberg eBook of ${title}. ${'word '.repeat(400)}`;
  const isFirst = (url) => /\/pg1-|book-1/.test(String(url));
  globalThis.fetch = async (url) => {
    if (isFirst(url)) {
      await firstSettles;
      throw new TypeError('Failed to fetch');
    }
    return { ok: true, text: async () => prose('Second') };
  };
  dom.window.proxyService = {
    async fetchWithProxy(url) {
      if (isFirst(url)) throw new Error('All proxies failed after 4 attempts: Failed to fetch');
      return prose('Second');
    }
  };

  const { Reader } = await import(pathToFileURL(join(root, 'read/reader.js')).href);
  const container = dom.window.document.getElementById('reader');
  const reader = new Reader(container, dom.window.document.getElementById('controls'));
  try {
    const first = reader.loadBook({
      id: 1,
      formats: { 'text/html': 'https://example.test/book-1.html' }
    });
    await reader.loadBook({
      id: 2,
      formats: { 'text/plain': 'https://example.test/book-2.txt' }
    });
    assert.match(container.textContent, /Second/);
    releaseFirst();
    await first;
    assert.match(container.textContent, /Second/);
    assert.doesNotMatch(container.textContent, /All proxies failed/);
  } finally {
    clearInterval(reader._intervalTimer);
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.fetch = previous.fetch;
    globalThis.Element = previous.Element;
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
  }
});
