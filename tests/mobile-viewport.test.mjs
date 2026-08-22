// Every indexed page must opt into the device-width viewport, or mobile
// browsers fall back to a ~980px desktop canvas and Search flags the page
// as not mobile-friendly.
//
// This replaces the old 86-page Playwright sweep. The meta tag is in the
// served HTML, so no browser is needed to check it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Directory-style sitemap URLs, as site-root-relative paths. */
function sitemapPages() {
  const xml = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return Array.from(xml.matchAll(/<loc>https:\/\/joeheyming\.github\.io(\/[^<]*)<\/loc>/g))
    .map((match) => match[1])
    .filter((page) => page.endsWith('/'));
}

test('sitemap lists pages to check', () => {
  assert.ok(sitemapPages().length > 0, 'sitemap should contain directory-style URLs');
});

test('every sitemap page ships the device-width viewport', () => {
  const offenders = [];

  for (const page of sitemapPages()) {
    const file = path.join(ROOT, page.replace(/^\//, ''), 'index.html');
    if (!existsSync(file)) continue;

    const document = new JSDOM(readFileSync(file, 'utf8')).window.document;
    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';

    if (!viewport.includes('width=device-width')) {
      offenders.push(`${page} → ${viewport || '(no viewport meta)'}`);
    }
  }

  assert.deepEqual(offenders, [], `pages missing width=device-width:\n${offenders.join('\n')}`);
});
