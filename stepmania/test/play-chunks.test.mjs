// The play engine evaluates in groups so one keypress cannot wait on all
// of it. A new module under stepmania/js has to join PLAY_CHUNKS after the
// modules it imports, in a group that stays under 40 KB.

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { resolveLocal, staticImportSpecifiers } from '../../tests/import-graph-helpers.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'js');
const BUDGET = 40_000;

const playSource = readFileSync(path.join(jsDir, 'play.js'), 'utf8');
const chunksStart = playSource.indexOf('export const PLAY_CHUNKS = ');
const chunksEnd = playSource.indexOf(';\n', chunksStart);
/** @type {string[][]} */
const PLAY_CHUNKS = JSON.parse(
  playSource.slice(chunksStart + 'export const PLAY_CHUNKS = '.length, chunksEnd).replace(/'/g, '"')
);

/** @type {Map<string, number>} */
const chunkOf = new Map();
PLAY_CHUNKS.forEach((chunk, index) => {
  for (const name of chunk) chunkOf.set(name, index);
});

/**
 * @param {string} file absolute path
 * @returns {string[]} absolute paths of its static local imports
 */
function localDeps(file) {
  return staticImportSpecifiers(readFileSync(file, 'utf8'))
    .map((spec) => resolveLocal(spec, path.dirname(file)))
    .filter((resolved) => resolved !== null);
}

describe('StepMania play engine loads in chunks', () => {
  it('does not statically import the engine from play.js', () => {
    assert.deepEqual(staticImportSpecifiers(playSource), []);
  });

  it('keeps every group in dependency order and under 40 KB', () => {
    const seen = new Set();
    /** @type {Set<string>} */
    const outside = new Set();
    PLAY_CHUNKS.forEach((chunk, index) => {
      let bytes = 0;
      for (const name of chunk) {
        assert.equal(seen.has(name), false, `${name} is listed twice`);
        seen.add(name);
        const file = path.join(jsDir, name);
        bytes += statSync(file).size;
        for (const dep of localDeps(file)) {
          const rel = path.relative(jsDir, dep);
          if (rel.startsWith('..')) {
            if (!outside.has(dep)) {
              outside.add(dep);
              bytes += statSync(dep).size;
            }
            continue;
          }
          assert.ok(chunkOf.has(rel), `${name} imports ${rel}, which is not in a chunk`);
          assert.ok(
            /** @type {number} */ (chunkOf.get(rel)) <= index,
            `${name} imports ${rel}, which loads in a later chunk`
          );
        }
      }
      assert.ok(bytes <= BUDGET, `chunk ${index} evaluates ${bytes} bytes`);
    });
  });

  it('reaches every module the engine used to import up front', () => {
    const pending = [
      'stepmania.js',
      'mainPageController.js',
      'gamepad.js',
      'fullscreen.js',
      'step-button.js',
      'score-panel.js',
      'loading-overlay.js',
      'game-over-modal.js',
      'settings-sheet.js'
    ];
    const seen = new Set();
    while (pending.length) {
      const name = /** @type {string} */ (pending.pop());
      if (seen.has(name)) continue;
      seen.add(name);
      assert.ok(chunkOf.has(name), `${name} is part of the engine but not in a chunk`);
      for (const dep of localDeps(path.join(jsDir, name))) {
        const rel = path.relative(jsDir, dep);
        if (!rel.startsWith('..')) pending.push(rel);
      }
    }
  });
});
