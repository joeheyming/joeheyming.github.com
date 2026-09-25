import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const {
  NavigationHistory,
  decorateHtml,
  isSameOrigin,
  normalizeAddress
} = require('../surf/navigation.js');

describe('Surf address handling', () => {
  it('adds HTTPS to a bare host', () => {
    assert.equal(
      normalizeAddress('example.com/docs', 'https://joeheyming.github.io/surf/'),
      'https://example.com/docs'
    );
  });

  it('resolves site-relative addresses', () => {
    assert.equal(
      normalizeAddress('../about/', 'https://joeheyming.github.io/surf/'),
      'https://joeheyming.github.io/about/'
    );
  });

  it('rejects non-web schemes and spaces', () => {
    assert.throws(() => normalizeAddress('javascript:alert(1)'), /HTTP and HTTPS/);
    assert.throws(() => normalizeAddress('not a url'), /spaces/);
  });

  it('separates this origin from the rest of the web', () => {
    const base = 'https://joeheyming.github.io/surf/';
    assert.equal(isSameOrigin('https://joeheyming.github.io/about/', base), true);
    assert.equal(isSameOrigin('https://www.google.com/', base), false);
  });
});

describe('Surf page decoration', () => {
  it('adds a base URL and link-navigation bridge', () => {
    const output = decorateHtml(
      '<html><head><title>Example</title></head><body><a href="next">Next</a></body></html>',
      'https://example.com/guides/start'
    );

    assert.match(output, /<base href="https:\/\/example\.com\/guides\/start">/);
    assert.match(output, /type: 'surf-navigate'/);
    assert.ok(output.indexOf('<base') < output.indexOf('<title>'));
  });

  it('stands in for storage the sandbox refuses', () => {
    const output = decorateHtml('<html><head></head></html>', 'https://example.com/');

    assert.match(output, /'localStorage', 'sessionStorage'/);
    assert.ok(output.indexOf('localStorage') < output.indexOf('</head>'));
  });

  it('routes GET form submissions back through Surf', () => {
    const output = decorateHtml('<html><head></head></html>', 'https://www.google.com/');

    assert.match(output, /addEventListener\('submit'/);
    assert.match(output, /URLSearchParams\(new FormData\(form\)\)/);
  });

  it('keeps a page-provided base URL', () => {
    const output = decorateHtml(
      '<head><base href="https://cdn.example/"></head>',
      'https://example.com/'
    );

    assert.equal(output.match(/<base\b/g)?.length, 1);
    assert.match(output, /https:\/\/cdn\.example\//);
  });
});

describe('Surf navigation history', () => {
  it('moves backward and forward and drops a forward branch', () => {
    const history = new NavigationHistory();
    history.push({ url: 'https://one.example/' });
    history.push({ url: 'https://two.example/' });

    assert.equal(history.back().url, 'https://one.example/');
    assert.equal(history.canGoForward, true);

    history.push({ url: 'https://three.example/' });
    assert.equal(history.canGoForward, false);
    assert.equal(history.current.url, 'https://three.example/');
  });

  it('replaces the current pending entry after a page loads', () => {
    const history = new NavigationHistory();
    history.push({ url: 'https://example.com/', html: '' });
    history.replace({ url: 'https://example.com/', html: '<h1>Loaded</h1>' });

    assert.equal(history.entries.length, 1);
    assert.equal(history.current.html, '<h1>Loaded</h1>');
  });
});

describe('Surf document shell', () => {
  it('includes browser controls and keeps previews isolated', () => {
    const html = readFileSync(new URL('../surf/index.html', import.meta.url), 'utf8');
    const document = new JSDOM(html).window.document;
    const frame = document.querySelector('#html-frame');

    assert.ok(document.querySelector('#address-input'));
    assert.ok(document.querySelector('#btn-back'));
    assert.ok(document.querySelector('#file-input'));
    assert.equal(frame.getAttribute('sandbox'), 'allow-forms allow-scripts');
    assert.equal(frame.getAttribute('sandbox').includes('allow-same-origin'), false);
  });
});
