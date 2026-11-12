// Pages load the shared chrome through one /site.js tag. A page that lists
// nav/feedback/share/achievements itself would drift from the site's loading
// policy, so the sync's --check runs here.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from './import-graph-helpers.mjs';
import { rewriteSiteBoot, siteBootTag } from '../scripts/site-boot.mjs';

const SITE_JS = readFileSync(join(ROOT, 'site.js'), 'utf8');

/**
 * Run site.js from a tag carrying `attrs` and return the scripts it inserted.
 * @param {string} attrs
 */
function insertedBy(attrs) {
  const dom = new JSDOM(
    `<!doctype html><head><script id="site" src="/site.js" ${attrs}></script><meta id="after"></head>`,
    { runScripts: 'outside-only', url: 'https://joeheyming.github.io/x/' }
  );
  const { window } = dom;
  const tag = window.document.getElementById('site');
  Object.defineProperty(window.document, 'currentScript', { value: tag, configurable: true });
  window.eval(SITE_JS);
  /** @type {HTMLScriptElement[]} */
  const inserted = [];
  for (let n = tag.nextElementSibling; n && n.id !== 'after'; n = n.nextElementSibling) {
    inserted.push(/** @type {HTMLScriptElement} */ (n));
  }
  window.close();
  return inserted;
}

describe('site boot', () => {
  it('every page loads the shared chrome through /site.js', () => {
    execFileSync(process.execPath, [join(ROOT, 'scripts/sync-site-boot.mjs'), '--check'], {
      stdio: 'pipe'
    });
  });

  it('inserts the shared scripts in order without blocking the parser', () => {
    const scripts = insertedBy('');
    assert.deepEqual(
      scripts.map((s) => s.getAttribute('src')),
      ['/nav.js', '/feedback.js', '/share.js', '/achievements.js']
    );
    for (const s of scripts) assert.equal(s.async, false, `${s.src} keeps insertion order`);
  });

  it('passes page options through and skips what the page does without', () => {
    const scripts = insertedBy('data-nav-size="compact" data-share-fab="off" data-skip="feedback"');
    assert.deepEqual(
      scripts.map((s) => s.getAttribute('src')),
      ['/nav.js', '/share.js', '/achievements.js']
    );
    assert.equal(scripts[0].getAttribute('data-nav-size'), 'compact');
    assert.equal(scripts[1].getAttribute('data-share-fab'), 'off');
    assert.equal(scripts[2].hasAttribute('data-share-fab'), false);
  });

  it('rewrites separate tags into one, keeping options and position', () => {
    const before = [
      '<head>',
      '  <script src="/analytics.js"></script>',
      '  <script defer src="/nav.js" data-nav-size="compact"></script>',
      '  <script src="/share.js" data-share-fab="off"></script>',
      '  <script src="/page.js"></script>',
      '</head>',
      ''
    ].join('\n');
    const { html, changed } = rewriteSiteBoot(before);
    assert.equal(changed, true);
    assert.equal(
      html,
      [
        '<head>',
        '  <script src="/analytics.js"></script>',
        '  ' +
          siteBootTag({ navSize: 'compact', shareFab: 'off', skip: ['feedback', 'achievements'] }),
        '  <script src="/page.js"></script>',
        '</head>',
        ''
      ].join('\n')
    );
    assert.equal(rewriteSiteBoot(html).changed, false);
  });
});
