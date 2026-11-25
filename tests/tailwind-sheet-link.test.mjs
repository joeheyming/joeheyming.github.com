// Each committed tailwind.css is compiled from one page's markup. A page that
// links another page's sheet (easy with <base href="../">) loses utilities it
// depends on, e.g. Heyming OS's setup wizard lost `inset-0` and collapsed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from './import-graph-helpers.mjs';

const ORIGIN = 'https://joeheyming.github.io';

function pagesWithLocalSheet() {
  const dirs = [
    '',
    ...readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  ];
  return dirs.filter(
    (dir) =>
      existsSync(path.join(ROOT, dir, 'tailwind.css')) &&
      existsSync(path.join(ROOT, dir, 'index.html'))
  );
}

describe('tailwind.css links', () => {
  for (const dir of pagesWithLocalSheet()) {
    it(`${dir || '/'} links its own compiled sheet`, () => {
      const html = readFileSync(path.join(ROOT, dir, 'index.html'), 'utf8');
      const pageUrl = `${ORIGIN}/${dir ? `${dir}/` : ''}`;
      const dom = new JSDOM(html, { url: pageUrl });
      const hrefs = [...dom.window.document.querySelectorAll('link[rel="stylesheet"]')]
        .map((link) => /** @type {HTMLLinkElement} */ (link).href)
        .filter((href) => href.endsWith('/tailwind.css'));
      if (hrefs.length === 0) return;
      const expected = `${ORIGIN}/${dir ? `${dir}/` : ''}tailwind.css`;
      assert.deepEqual(hrefs, [expected]);
    });
  }
});
