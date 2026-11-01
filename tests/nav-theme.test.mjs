import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAV_SOURCE = readFileSync(path.join(ROOT, 'nav.js'), 'utf8');

function bootNav(savedTheme) {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta name="theme-color" content="#0e1217"></head><body></body></html>',
    {
      url: 'https://joeheyming.github.io/2048/',
      pretendToBeVisual: true,
      runScripts: 'dangerously'
    }
  );
  const { window } = dom;
  window.matchMedia = (query) => ({
    matches: query === '(prefers-color-scheme: dark)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  });
  window.fetch = () => Promise.reject(new Error('offline'));
  if (savedTheme) window.localStorage.setItem('hos-theme', savedTheme);
  const script = window.document.createElement('script');
  script.textContent = NAV_SOURCE;
  window.document.body.appendChild(script);
  // jsdom is still "loading" when the script is injected, so nav.js
  // waits for DOMContentLoaded instead of inserting the drawer immediately.
  if (window.document.readyState === 'loading') {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  return window;
}

function checkedValue(window) {
  const on = window.document.querySelector('.heyming-nav-theme-option[aria-checked="true"]');
  return on ? on.getAttribute('data-theme-value') : null;
}

test('drawer theme control defaults to dark without writing storage', () => {
  const window = bootNav();
  assert.equal(checkedValue(window), 'dark');
  assert.equal(window.document.documentElement.dataset.theme, 'dark');
  assert.equal(window.localStorage.getItem('hos-theme'), null);
  const group = window.document.querySelector('.heyming-nav-theme');
  assert.equal(group.getAttribute('role'), 'radiogroup');
  assert.ok(window.document.querySelector('.heyming-nav-drawer-footer').contains(group));
});

test('clicking Light persists and updates the document theme', () => {
  const window = bootNav();
  window.document.querySelector('[data-theme-value="light"]').click();
  assert.equal(window.document.documentElement.dataset.theme, 'light');
  assert.equal(window.localStorage.getItem('hos-theme'), 'light');
  assert.equal(checkedValue(window), 'light');
  assert.equal(
    window.document.querySelector('meta[name="theme-color"]').getAttribute('content'),
    '#fafafa'
  );
});

test('Auto clears the explicit theme and restores a saved choice on the next boot', () => {
  const window = bootNav('light');
  assert.equal(checkedValue(window), 'light');
  window.document.querySelector('[data-theme-value="auto"]').click();
  assert.equal(window.document.documentElement.hasAttribute('data-theme'), false);
  assert.equal(window.localStorage.getItem('hos-theme'), 'auto');

  const next = bootNav('auto');
  assert.equal(checkedValue(next), 'auto');
  assert.equal(next.document.documentElement.hasAttribute('data-theme'), false);
});
