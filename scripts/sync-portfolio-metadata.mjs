#!/usr/bin/env node
/**
 * Sync site discovery projections from apps-registry.json:
 *   1. manifest.json shortcuts (pwaShortcut entries)
 *   2. sitemap.xml URL list
 *   3. missing generate-previews.js PAGES rows
 *
 * Run: npm run sync:catalog   (alias: npm run sync:manifest)
 *
 * Sitemap exclusions match GSC / AGENTS.md policy for redirect stubs
 * and noindex landers. Extra non-registry URLs (home, about, OS) are
 * preserved via SITE_EXTRA_URLS.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(root, 'apps-registry.json');
const manifestPath = join(root, 'manifest.json');
const sitemapPath = join(root, 'sitemap.xml');
const previewsPath = join(root, 'generate-previews.js');

const SITE_ORIGIN = 'https://joeheyming.github.io';

/** Always keep these in the sitemap even if absent from the registry. */
const SITE_EXTRA_URLS = [
  { loc: `${SITE_ORIGIN}/`, changefreq: 'weekly', priority: '1.0' },
  { loc: `${SITE_ORIGIN}/about/`, changefreq: 'monthly', priority: '0.7' },
  { loc: `${SITE_ORIGIN}/os/`, changefreq: 'weekly', priority: '0.8' }
];

/**
 * Redirect / noindex stubs — never project into sitemap or PAGES.
 * Paths are site-root-relative with trailing slash.
 */
const SITEMAP_EXCLUDE_PATHS = new Set([
  '/sega/',
  '/nes/',
  '/legend-of-doom/',
  '/play/guitar/'
]);

const apps = JSON.parse(readFileSync(registryPath, 'utf8'));
if (!Array.isArray(apps)) {
  console.error('apps-registry.json must be a JSON array');
  process.exit(1);
}

function registryToSitePath(appPath) {
  let raw = appPath.startsWith('./') ? appPath.slice(2) : appPath;
  const q = raw.indexOf('?');
  if (q >= 0) raw = raw.slice(0, q);
  if (!raw.endsWith('/')) raw += '/';
  if (!raw.startsWith('/')) raw = `/${raw}`;
  return raw === '//' ? '/' : raw;
}

function isNoindexLander(sitePath) {
  const file = join(root, sitePath.replace(/^\//, ''), 'index.html');
  if (!existsSync(file)) return false;
  return /meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(
    readFileSync(file, 'utf8')
  );
}

function indexableApps() {
  const seen = new Set();
  const out = [];
  for (const app of apps) {
    if (!app?.id || !app.path) continue;
    const sitePath = registryToSitePath(app.path);
    if (SITEMAP_EXCLUDE_PATHS.has(sitePath)) continue;
    if (isNoindexLander(sitePath)) continue;
    if (seen.has(sitePath)) continue;
    seen.add(sitePath);
    out.push({ app, sitePath });
  }
  return out;
}

function syncManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const shortcuts = [];
  const seen = new Set();
  for (const app of apps) {
    if (!app.pwaShortcut) continue;
    const slug = app.path.replace(/^\.\//, '').replace(/\/$/, '').split('?')[0];
    const url = `/${slug}/`;
    if (seen.has(url)) continue;
    seen.add(url);
    shortcuts.push({
      name: app.pwaShortcut.name,
      short_name: app.pwaShortcut.short_name,
      description: app.pwaShortcut.description,
      url
    });
  }
  manifest.shortcuts = shortcuts;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Updated manifest.json with ${shortcuts.length} shortcuts`);
}

function parseExistingSitemap() {
  const xml = readFileSync(sitemapPath, 'utf8');
  const byLoc = new Map();
  for (const match of xml.matchAll(
    /<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]*)<\/lastmod>\s*<changefreq>([^<]*)<\/changefreq>\s*<priority>([^<]*)<\/priority>\s*<\/url>/g
  )) {
    byLoc.set(match[1], {
      loc: match[1],
      lastmod: match[2],
      changefreq: match[3],
      priority: match[4]
    });
  }
  return byLoc;
}

function todayLastmod() {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00+00:00`;
}

function syncSitemap() {
  const existing = parseExistingSitemap();
  const entries = [];
  const seen = new Set();

  for (const extra of SITE_EXTRA_URLS) {
    const prev = existing.get(extra.loc);
    entries.push({
      loc: extra.loc,
      lastmod: prev?.lastmod || todayLastmod(),
      changefreq: prev?.changefreq || extra.changefreq,
      priority: prev?.priority || extra.priority
    });
    seen.add(extra.loc);
  }

  for (const { sitePath } of indexableApps()) {
    const loc = `${SITE_ORIGIN}${sitePath === '/' ? '/' : sitePath}`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    const prev = existing.get(loc);
    entries.push({
      loc,
      lastmod: prev?.lastmod || todayLastmod(),
      changefreq: prev?.changefreq || 'weekly',
      priority: prev?.priority || '0.7'
    });
  }

  entries.sort((a, b) => a.loc.localeCompare(b.loc));

  const body = entries
    .map(
      (e) => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
  writeFileSync(sitemapPath, xml, 'utf8');
  console.log(`Updated sitemap.xml with ${entries.length} URLs`);
}

function previewOutputFor(sitePath, appId) {
  const trimmed = sitePath.replace(/^\/|\/$/g, '');
  if (!trimmed) return 'assets/joe-heyming-og-image.png';
  const parts = trimmed.split('/');
  const leaf = parts[parts.length - 1] || appId;
  return `${trimmed}/${leaf}-preview.png`;
}

function syncPreviewPages() {
  let source = readFileSync(previewsPath, 'utf8');
  const existingUrls = new Set();
  for (const match of source.matchAll(/url:\s*`\$\{BASE_URL\}([^`]+)`/g)) {
    existingUrls.add(match[1]);
  }

  function alreadyCovered(sitePath) {
    for (const u of existingUrls) {
      if (u.split('?')[0] === sitePath) return true;
    }
    return false;
  }

  const additions = [];
  for (const { app, sitePath } of indexableApps()) {
    if (sitePath === '/') continue;
    if (SITEMAP_EXCLUDE_PATHS.has(sitePath)) continue;
    if (alreadyCovered(sitePath)) continue;
    const cleanTitle = String(app.shortName || app.name || app.id)
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .trim()
      .replace(/'/g, "\\'");
    const output = previewOutputFor(sitePath, app.id);
    additions.push(`  {
    url: \`\${BASE_URL}${sitePath}\`,
    output: '${output}',
    title: '${cleanTitle}'
  }`);
  }

  if (!additions.length) {
    console.log('generate-previews.js PAGES already covers the registry');
    return;
  }

  const marker = 'const PAGES = [';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('PAGES array not found in generate-previews.js');
  // Insert before the closing `];` of PAGES — find matching close after start.
  let depth = 0;
  let i = start + marker.length - 1;
  let end = -1;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('Could not find end of PAGES array');

  const before = source.slice(0, end).replace(/\s*$/, '');
  const needsComma = !before.trimEnd().endsWith(',');
  const insertion =
    (needsComma ? ',' : '') + '\n  // --- synced from apps-registry.json ---\n' + additions.join(',\n') + '\n';
  source = before + insertion + source.slice(end);
  writeFileSync(previewsPath, source, 'utf8');
  console.log(`Added ${additions.length} missing PAGES entries to generate-previews.js`);
}

syncManifest();
syncSitemap();
syncPreviewPages();
