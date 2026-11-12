// Bytes a big app's page downloads before any click. Anything past the
// first screen belongs behind import() or an ensureX() loader; a static
// import or a new <script src> that drags it back in fails here.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eagerScripts, staticImportSpecifiers, totalBytes } from './import-graph-helpers.mjs';

// Lower a budget when a change moves bytes out of the eager set; never
// raise one to make room for code the first screen does not need.
const BUDGETS = {
  'doom/': 225_000,
  'stepmania/': 285_000,
  'emulator/': 280_000,
  'emulator/nes/': 378_000,
  'play/': 135_000,
  'watch/': 295_000
};

describe('eager-load budget', () => {
  for (const [page, budget] of Object.entries(BUDGETS)) {
    it(`${page} stays within ${budget} eager bytes`, () => {
      const files = eagerScripts(page);
      const total = totalBytes(files);
      const listing = files.map((f) => `  ${f.bytes}\t${f.file}`).join('\n');
      assert.ok(total <= budget, `${page} loads ${total} bytes before any click:\n${listing}`);
    });
  }
});

describe('staticImportSpecifiers', () => {
  it('follows static imports and re-exports but not import()', () => {
    const specs = staticImportSpecifiers(
      [
        "import a from './a.js';",
        "import { b, c } from '../b.js';",
        "import './side-effect.js';",
        "export { d } from '/d.js';",
        "const lazy = import('./lazy.js');",
        "/* import x from './commented.js'; */"
      ].join('\n')
    );
    assert.deepEqual(specs, ['./a.js', '../b.js', './side-effect.js', '/d.js']);
  });
});
