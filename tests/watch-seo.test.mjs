import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readHtml(relativePath) {
  return new JSDOM(readFileSync(path.join(ROOT, relativePath), 'utf8')).window.document;
}

test('homepage exposes a static visible link to Watch', () => {
  const document = readHtml('index.html');
  const link = document.querySelector('a[href="/watch/"]');

  assert.ok(link, 'homepage should contain a server-delivered /watch/ link');
  assert.equal(
    link.closest('[hidden]'),
    null,
    'the /watch/ link should be visible without JavaScript'
  );
  assert.match(link.textContent, /watch/i);
});

test('Watch has stable indexability signals and visible static content', () => {
  const document = readHtml('watch/index.html');
  const robots = document.querySelector('meta[name="robots"]');
  const canonical = document.querySelector('link[rel="canonical"]');
  const about = document.querySelector('.tv-about');

  assert.equal(robots?.getAttribute('content'), 'index, follow');
  assert.equal(canonical?.getAttribute('href'), 'https://joeheyming.github.io/watch/');
  assert.ok(about, 'Watch should include descriptive content outside the JS mount');
  assert.equal(
    about.closest('noscript'),
    null,
    'descriptive content should be visible with JavaScript'
  );
  assert.ok(
    (about.textContent || '').replace(/\s+/g, ' ').trim().length > 250,
    'static description should be substantial'
  );
  assert.equal(
    document.querySelector('#tv-view')?.children.length,
    0,
    'the test should not depend on client rendering'
  );

  const structuredData = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((script) => JSON.parse(script.textContent || '{}'))
    .flatMap((value) => value['@graph'] || [value]);
  assert.equal(
    structuredData.some((entry) => entry['@type'] === 'FAQPage'),
    false,
    'structured data should not describe FAQ content hidden from normal users'
  );

  assert.ok(existsSync(path.join(ROOT, 'watch/index.css')));
  assert.ok(existsSync(path.join(ROOT, 'watch/watch-preview.png')));
});

test('sitemap includes the current canonical Watch URL', () => {
  const xml = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const document = new JSDOM(xml, { contentType: 'application/xml' }).window.document;
  const watchUrl = [...document.querySelectorAll('url')].find(
    (entry) => entry.querySelector('loc')?.textContent === 'https://joeheyming.github.io/watch/'
  );

  assert.ok(watchUrl, 'sitemap should include the canonical Watch URL');
  assert.equal(watchUrl.querySelector('lastmod')?.textContent, '2026-07-20T00:00:00+00:00');
});
