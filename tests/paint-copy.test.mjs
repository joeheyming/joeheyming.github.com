import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../paint/style.css', import.meta.url), 'utf8');
const { document } = new JSDOM(html).window;

const BANNED = /ms[\s-]?paint|microsoft paint/i;

function meta(attr, name) {
  return document.querySelector(`meta[${attr}="${name}"]`)?.getAttribute('content') ?? '';
}

test('page copy no longer calls Paint an MS Paint clone', () => {
  const copy = [
    document.title,
    meta('name', 'description'),
    meta('property', 'og:title'),
    meta('property', 'og:description'),
    meta('name', 'twitter:title'),
    meta('name', 'twitter:description'),
    document.querySelector('script[type="application/ld+json"]').textContent
  ];
  for (const text of copy) {
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, BANNED);
  }
  assert.doesNotMatch(document.body.textContent, BANNED);
  assert.doesNotMatch(html, /MS Paint clone/i);
});

test('title follows the Paint — phrase pattern and social titles match', () => {
  const title = document.title;
  assert.match(title, /^Paint — \S/);
  assert.ok(title.includes('Paint'));
  assert.ok(title.includes('—'));
  assert.equal(meta('property', 'og:title'), title);
  assert.equal(meta('name', 'twitter:title'), title);
});

test('JSON-LD still parses and keeps the Paint name', () => {
  const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
  const app = ld['@graph'].find((n) => n['@type'] === 'SoftwareApplication');
  assert.equal(app.name, 'Paint');
  assert.ok(!app.alternateName.some((n) => BANNED.test(n)));
});

test('the title row is gone and the menu bar still clears the nav toggle', () => {
  assert.equal(document.querySelector('.paint-header'), null);
  assert.equal(document.querySelector('.paint-seo-intro'), null);
  // The static h1 stays for Search, visually hidden rather than a title row.
  const h1 = document.querySelector('h1.paint-sr-title');
  assert.match(h1.textContent, /Paint/);
  assert.match(css, /\.paint-sr-title \{[^}]*position: absolute;[^}]*clip: rect\(0 0 0 0\);/);
  const rule = css.match(/\.menu-bar \{[^}]*\}/)[0];
  // Left padding clears the nav toggle; right clears share/feedback (0 80px 0 120px).
  const pad = Number(rule.match(/padding:\s*0 \d+px 0 (\d+)px/)[1]);
  assert.ok(pad >= 120, `menu bar padding ${pad}px`);
});
