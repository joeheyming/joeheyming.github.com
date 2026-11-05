import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

/**
 * Static `import` specifiers. Dynamic `import()` and comments are ignored.
 * @param {string} source
 * @returns {string[]}
 */
function staticSpecifiers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /** @type {string[]} */
  const specs = [];
  const re = /^\s*import\s+(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let match = re.exec(code);
  while (match) {
    const spec = match[1];
    if (spec) specs.push(spec);
    match = re.exec(code);
  }
  return specs;
}

describe('StepMania boot does not wait on the whole app', () => {
  it('keeps the engine, library, and pack tools off the boot module', () => {
    const specs = staticSpecifiers(read('js/main.js'));
    for (const banned of ['./stepmania.js', './zenius-browser.js', './packIo.js']) {
      assert.equal(specs.includes(banned), false, banned);
    }
    const main = read('js/main.js');
    assert.match(main, /import\('\.\/play\.js'\)/);
    assert.match(main, /import\('\.\/zenius-browser\.js'\)/);
    assert.match(main, /import\('\.\/zeniusEntry\.js'\)/);
  });

  it('opens a zenius chart without the play engine', () => {
    const specs = staticSpecifiers(read('js/zeniusEntry.js'));
    for (const banned of ['./stepmania.js', './play.js', './mainPageController.js']) {
      assert.equal(specs.includes(banned), false, banned);
    }
    const html = read('index.html');
    const prefetch = html.indexOf('__zeniusPagePrefetch');
    const tailwind = html.indexOf('cdn.tailwindcss.com');
    assert.ok(prefetch > 0 && prefetch < tailwind);
  });

  it('loads the catalog UI from the play controller only on demand', () => {
    const source = read('js/mainPageController.js');
    const specs = staticSpecifiers(source);
    assert.equal(specs.includes('./zenius-browser.js'), false);
    assert.match(source, /import\('\.\/zenius-browser\.js'\)/);
  });

  it('marks a phone before the play engine loads', () => {
    const html = read('index.html');
    const body = html.indexOf('<body');
    const mark = html.indexOf("classList.toggle('mobile'");
    const header = html.indexOf('<header');
    assert.ok(body > 0 && mark > body && mark < header);
    assert.match(html, /innerWidth <= 768/);
    assert.match(html, /maxTouchPoints > 0/);
  });

  it('shows the song menu without a splash that can wait forever', () => {
    const html = read('index.html');
    assert.match(html, /id="sm-home"/);
    assert.doesNotMatch(html, /sm-boot-splash/);
    assert.doesNotMatch(html, /whenDefined/);
    assert.doesNotMatch(html, /jszip\.min\.js/);
  });
});
