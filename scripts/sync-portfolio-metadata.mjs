#!/usr/bin/env node
/**
 * Rewrites manifest.json shortcuts from apps-registry.json (pwaShortcut + path).
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'manifest.json');
const registryPath = join(root, 'apps-registry.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const apps = JSON.parse(readFileSync(registryPath, 'utf8'));
if (!Array.isArray(apps)) {
  console.error('apps-registry.json must be a JSON array');
  process.exit(1);
}

const shortcuts = [];
const seen = new Set();
for (const app of apps) {
  if (!app.pwaShortcut) continue;
  const slug = app.path.replace(/^\.\//, '').replace(/\/$/, '');
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
console.log('Updated manifest.json with', shortcuts.length, 'shortcuts from apps-registry.json');
