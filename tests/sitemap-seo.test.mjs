// Bing SEO report invariants for sitemap pages: a visible h1, a meta
// description long enough for snippets, and no MetaRefresh redirects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_DESCRIPTION = 120;

function sitemapPages() {
  const xml = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return Array.from(xml.matchAll(/<loc>https:\/\/joeheyming\.github\.io(\/[^<]*)<\/loc>/g))
    .map((match) => match[1])
    .filter((page) => page.endsWith('/'));
}

function readPage(page) {
  const file =
    page === '/'
      ? path.join(ROOT, 'index.html')
      : path.join(ROOT, page.replace(/^\//, ''), 'index.html');
  if (!existsSync(file)) return null;
  return {
    file,
    document: new JSDOM(readFileSync(file, 'utf8')).window.document
  };
}

test('sitemap pages have a static h1', () => {
  const offenders = [];
  for (const page of sitemapPages()) {
    const loaded = readPage(page);
    if (!loaded) continue;
    if (!loaded.document.querySelector('h1')) offenders.push(page);
  }
  assert.deepEqual(offenders, [], `sitemap pages missing <h1>:\n${offenders.join('\n')}`);
});

test(`sitemap pages have meta descriptions of at least ${MIN_DESCRIPTION} characters`, () => {
  const offenders = [];
  for (const page of sitemapPages()) {
    const loaded = readPage(page);
    if (!loaded) continue;
    const desc =
      loaded.document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    if (desc.length < MIN_DESCRIPTION) {
      offenders.push(`${page} → ${desc.length} chars`);
    }
  }
  assert.deepEqual(offenders, [], `short meta descriptions:\n${offenders.join('\n')}`);
});

test('sitemap pages do not use MetaRefresh', () => {
  const offenders = [];
  for (const page of sitemapPages()) {
    const loaded = readPage(page);
    if (!loaded) continue;
    if (loaded.document.querySelector('meta[http-equiv="refresh" i]')) offenders.push(page);
  }
  assert.deepEqual(offenders, [], `MetaRefresh tags:\n${offenders.join('\n')}`);
});

test('Game Boy lander is not hidden-text / VideoGame spam', () => {
  const html = readFileSync(path.join(ROOT, 'emulator/gb/index.html'), 'utf8');
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('.seo-intro'), null);
  assert.equal(document.querySelector('meta[name="keywords"]'), null);

  const graph = JSON.parse(
    document.querySelector('script[type="application/ld+json"]')?.textContent || '{}'
  );
  const types = [graph, ...(graph['@graph'] || [])].flatMap((entry) => {
    const t = entry?.['@type'];
    return Array.isArray(t) ? t : t ? [t] : [];
  });
  assert.equal(types.includes('VideoGame'), false);
  assert.equal(types.includes('SoftwareApplication'), true);
});

test('search opportunity pages use intent-led snippets without hidden SEO copy', () => {
  const expectations = [
    {
      page: '/wordle-finder/',
      title: 'Wordle Finder — Answer Finder & Best Next Guess 🔤'
    },
    {
      page: '/periodic-speller/',
      title: 'Periodic Speller — Spell Your Name with Chem Symbols ⚛️'
    }
  ];

  for (const { page, title } of expectations) {
    const loaded = readPage(page);
    assert.ok(loaded, `${page} should have an index.html`);
    assert.equal(loaded.document.title, title);
    assert.equal(loaded.document.querySelector('.seo-intro[hidden]'), null);
  }
});

test('Pac-Man games visibly recommend the level builder', () => {
  for (const page of ['/pacman/', '/pacman-infinite/']) {
    const loaded = readPage(page);
    assert.ok(loaded, `${page} should have an index.html`);
    const link = loaded.document.querySelector('a[href="/pacman-builder/"]:not([hidden] *)');
    assert.ok(link, `${page} should visibly link to /pacman-builder/`);
  }

  const registry = JSON.parse(readFileSync(path.join(ROOT, 'apps-registry.json'), 'utf8'));
  for (const id of ['pacman', 'pacman-infinite']) {
    const app = registry.find((entry) => entry.id === id);
    assert.ok(app?.related?.includes('pacman-builder'), `${id} should recommend pacman-builder`);
  }
});
