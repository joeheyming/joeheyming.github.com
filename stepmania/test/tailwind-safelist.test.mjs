// The Tailwind Play CDN compiles on the main thread. On this page that
// compile was a multi-second task, which is the phone INP. The utilities
// live in stepmania-utilities.css instead. A slash or variant class the
// page uses has to be in that file; the CDN is not around to invent it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { collectStepmaniaClasses } from './tailwind-classes.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const css = readFileSync(path.join(root, 'stepmania-utilities.css'), 'utf8');

describe('StepMania Tailwind sheet', () => {
  it('does not load the compiler', () => {
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
    assert.doesNotMatch(html, /sm-tailwind-safelist/);
    const link = html.indexOf('stepmania-utilities.css');
    const body = html.indexOf('<body');
    assert.ok(link !== -1 && link < body);
  });

  it('loads after the page sheets so preflight [hidden] wins ties', () => {
    const link = html.indexOf('stepmania-utilities.css');
    for (const sheet of ['css/screen.css', '/brand.css']) {
      const at = html.indexOf(sheet);
      assert.ok(at !== -1 && at < link, `${sheet} must load before stepmania-utilities.css`);
    }
    assert.match(css, /\[hidden\]:where\(:not\(\[hidden=until-found\]\)\)\{display:none\}/);
  });

  it('covers the layout utilities', () => {
    for (const sel of [
      '.flex{',
      '.h-screen',
      '.bg-surface-0{',
      '.text-sm-arrow-left',
      '.bg-success\\/20',
      '.bg-surface-0\\/50',
      '.border-success\\/30'
    ]) {
      assert.ok(css.includes(sel), sel);
    }
  });

  it('includes every slash or variant class the page uses', () => {
    const missing = [];
    for (const cls of collectStepmaniaClasses(root)) {
      if (!cls.includes('/') && !cls.includes(':')) continue;
      const escaped = '.' + cls.replace(/([:./[\]%])/g, '\\$1');
      if (!css.includes(escaped)) missing.push(cls);
    }
    assert.deepEqual(missing, []);
  });
});
