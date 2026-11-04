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
  });

  it('loads the catalog UI from the play controller only on demand', () => {
    const source = read('js/mainPageController.js');
    const specs = staticSpecifiers(source);
    assert.equal(specs.includes('./zenius-browser.js'), false);
    assert.match(source, /import\('\.\/zenius-browser\.js'\)/);
  });

  it('shows the song menu without a splash that can wait forever', () => {
    const html = read('index.html');
    assert.match(html, /id="sm-home"/);
    assert.doesNotMatch(html, /sm-boot-splash/);
    assert.doesNotMatch(html, /whenDefined/);
    assert.doesNotMatch(html, /jszip\.min\.js/);
  });
});
