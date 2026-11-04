// Site catalog integrity: every indexable registry app must appear in
// sitemap.xml and generate-previews.js PAGES. Keep in sync with
// scripts/sync-portfolio-metadata.mjs exclusions.

import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SITE_ORIGIN = 'https://joeheyming.github.io';
const SITEMAP_EXCLUDE_PATHS = new Set([
  '/sega/',
  '/nes/',
  '/legend-of-doom/',
  '/sonic-doom/',
  '/play/guitar/'
]);

function registryToSitePath(appPath) {
  let raw = appPath.startsWith('./') ? appPath.slice(2) : appPath;
  const q = raw.indexOf('?');
  if (q >= 0) raw = raw.slice(0, q);
  if (!raw.endsWith('/')) raw += '/';
  if (!raw.startsWith('/')) raw = `/${raw}`;
  return raw;
}

function isNoindexLander(sitePath) {
  const file = path.join(ROOT, sitePath.replace(/^\//, ''), 'index.html');
  if (!existsSync(file)) return false;
  return /meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(
    readFileSync(file, 'utf8')
  );
}

function indexableSitePaths(apps) {
  const seen = new Set();
  const out = [];
  for (const app of apps) {
    if (!app?.id || !app.path) continue;
    const sitePath = registryToSitePath(app.path);
    if (SITEMAP_EXCLUDE_PATHS.has(sitePath)) continue;
    if (isNoindexLander(sitePath)) continue;
    if (seen.has(sitePath)) continue;
    seen.add(sitePath);
    out.push({ id: app.id, sitePath });
  }
  return out;
}

test('every indexable registry app is in sitemap.xml', () => {
  const apps = JSON.parse(readFileSync(path.join(ROOT, 'apps-registry.json'), 'utf8'));
  const sitemap = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const missing = [];
  for (const { id, sitePath } of indexableSitePaths(apps)) {
    const loc = `${SITE_ORIGIN}${sitePath}`;
    if (!sitemap.includes(`<loc>${loc}</loc>`)) missing.push(`${id} → ${loc}`);
  }
  assert.deepEqual(missing, [], `missing from sitemap:\n${missing.join('\n')}`);
});

test('every indexable registry app is in generate-previews.js PAGES', () => {
  const apps = JSON.parse(readFileSync(path.join(ROOT, 'apps-registry.json'), 'utf8'));
  const previews = readFileSync(path.join(ROOT, 'generate-previews.js'), 'utf8');
  const missing = [];
  for (const { id, sitePath } of indexableSitePaths(apps)) {
    if (sitePath === '/') continue;
    if (!previews.includes(`\${BASE_URL}${sitePath}`)) {
      missing.push(`${id} → ${sitePath}`);
    }
  }
  assert.deepEqual(missing, [], `missing from PAGES:\n${missing.join('\n')}`);
});

test('updated landings keep a sitemap lastmod at least as new as the page', () => {
  const sitemap = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  for (const sitePath of ['/doom/classic/', '/stepmania/songs/']) {
    const loc = `${SITE_ORIGIN}${sitePath}`;
    const at = sitemap.indexOf(`<loc>${loc}</loc>`);
    assert.ok(at >= 0, `${loc} missing from sitemap`);
    const match = sitemap.slice(at, at + 200).match(/<lastmod>([^<]+)<\/lastmod>/);
    assert.ok(match, `${loc} missing lastmod`);
    const committed = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', `${sitePath.slice(1)}index.html`],
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    const committedDay = new Date(committed).toISOString().slice(0, 10);
    assert.ok(
      match[1].slice(0, 10) >= committedDay,
      `${loc} lastmod ${match[1]} is older than its page (${committedDay})`
    );
  }
});

test('excluded redirect stubs stay out of the sitemap', () => {
  const sitemap = readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  for (const sitePath of SITEMAP_EXCLUDE_PATHS) {
    assert.equal(
      sitemap.includes(`<loc>${SITE_ORIGIN}${sitePath}</loc>`),
      false,
      `${sitePath} should not be in sitemap`
    );
  }
});
