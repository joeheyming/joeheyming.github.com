// The Tailwind CDN recompiles every stylesheet when a light-DOM class shows
// up that it has not seen yet. That compile is the multi-second task behind
// StepMania's field INP. The safelist element is scanned on the first build,
// and the loader then ignores later class changes.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { collectStepmaniaClasses } from './tailwind-classes.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

describe('StepMania Tailwind safelist', () => {
  it('lists every class the page can put on a light-DOM node', () => {
    const marker = 'id="sm-tailwind-safelist"';
    const at = html.indexOf(marker);
    assert.notEqual(at, -1, 'index.html is missing #sm-tailwind-safelist');
    const classAt = html.indexOf('class="', at);
    const classEnd = html.indexOf('"', classAt + 'class="'.length);
    const listed = html
      .slice(classAt + 'class="'.length, classEnd)
      .split(/\s+/)
      .filter(Boolean);
    const expected = collectStepmaniaClasses(root);
    assert.deepEqual(listed, expected);
  });

  it('stops the CDN from rebuilding once that list is in the document', () => {
    const loader = html.indexOf('https://cdn.tailwindcss.com/3.4.16');
    const watch = html.indexOf('sm-tailwind-safelist');
    assert.ok(
      watch !== -1 && watch < loader,
      'the observer guard must be installed before the CDN'
    );
    assert.match(html, /tailwindWatch && compiled/);
  });

  it('puts the safelist ahead of the first body script', () => {
    const div = html.indexOf('id="sm-tailwind-safelist"');
    const script = html.indexOf('<script>', html.indexOf('<body'));
    assert.ok(div !== -1 && div < script);
  });
});
