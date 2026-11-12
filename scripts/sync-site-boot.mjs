#!/usr/bin/env node
/**
 * Point every page at /site.js for the shared chrome (nav, feedback, share,
 * achievements). A page that still lists those scripts separately gets one
 * /site.js tag in place of the first, carrying its data-nav-size,
 * data-share-fab, and whichever scripts it did without as data-skip.
 *
 * Run: npm run sync:site-boot   (--check exits 1 instead of writing)
 */
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteSiteBoot } from './site-boot.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const pages = globSync('**/*.html', {
  cwd: root,
  exclude: (p) => /^(node_modules|\.git|\.playwright-cli|tests)$/.test(p)
});

/** @type {string[]} */
const stale = [];
for (const page of pages) {
  const file = join(root, page);
  const { html, changed } = rewriteSiteBoot(readFileSync(file, 'utf8'));
  if (!changed) continue;
  stale.push(page);
  if (!check) writeFileSync(file, html);
}

if (check && stale.length) {
  console.error('Pages still list shared scripts separately:\n  ' + stale.join('\n  '));
  console.error('Run: npm run sync:site-boot');
  process.exit(1);
}
console.log(check ? 'site boot: all pages aligned' : `site boot: rewrote ${stale.length} pages`);
