// Pages that replaced the Tailwind Play CDN with a compiled sheet. The CDN
// injected its <style> at the end of <head>, so preflight's
// `[hidden] { display: none }` won ties with page classes like
// `.sm-home { display: flex }`. Loaded earlier, the page class wins and a
// hidden overlay stays on screen.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = /<link rel="stylesheet" href="[^"]*(?:tailwind|stepmania-utilities)\.css" \/>/;

function pagesWithSheet() {
  const pages = ['index.html'];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const file = path.join(entry.name, 'index.html');
    if (existsSync(path.join(root, file))) pages.push(file);
  }
  return pages.filter((file) => SHEET.test(readFileSync(path.join(root, file), 'utf8')));
}

describe('compiled Tailwind sheet order', () => {
  const pages = pagesWithSheet();

  it('finds the pages that moved off the CDN', () => {
    assert.ok(pages.length >= 10, `only found ${pages.join(', ')}`);
  });

  for (const file of pages) {
    it(`${file} loads its Tailwind sheet after every other stylesheet in <head>`, () => {
      const html = readFileSync(path.join(root, file), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      const sheet = head.search(SHEET);
      assert.ok(sheet !== -1, 'Tailwind sheet is not in <head>');
      const after = head.slice(sheet).replace(SHEET, '');
      assert.doesNotMatch(after, /rel="stylesheet"|<style[\s>]/);
    });
  }
});
