/**
 * Tests for the data-source facade. Currently focused on the per-row
 * hydration resilience added after a malformed `beakmans-world`
 * parserSpec hard-crashed the whole grid: one bad sheet row should
 * skip itself (with a console.error) and let every other row through.
 *
 * The module-level eager prefetch in `data-source.js` fires a real
 * gviz fetch at import time, which is fine here — `getShows()` /
 * `getMovies()` are not called by this file, so the prefetch promise
 * just resolves (or rejects) into the void. We exercise the internals
 * directly via `__testing.hydrateRows`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from './data-source.js';

const { hydrateRows } = __testing;

describe('hydrateRows', () => {
  /** @type {Array<{ args: unknown[] }>} */
  let errorCalls;
  /** @type {typeof console.error} */
  let originalError;

  beforeEach(() => {
    errorCalls = [];
    originalError = console.error;
    console.error = (...args) => {
      errorCalls.push({ args });
    };
  });

  afterEach(() => {
    console.error = originalError;
  });

  it('filters to the requested type before invoking convert', () => {
    /** @type {string[]} */
    const seen = [];
    const out = hydrateRows(
      [
        { id: 'a', type: 'show' },
        { id: 'b', type: 'movie' },
        { id: 'c', type: 'show' }
      ],
      'show',
      (s) => {
        seen.push(/** @type {string} */ (s.id));
        return s.id;
      }
    );
    assert.deepEqual(out, ['a', 'c']);
    assert.deepEqual(seen, ['a', 'c']);
    assert.equal(errorCalls.length, 0);
  });

  it('skips one bad row but keeps the rest of the batch', () => {
    const out = hydrateRows(
      [
        { id: 'good-1', type: 'show' },
        { id: 'beakmans-world', type: 'show' },
        { id: 'good-2', type: 'show' }
      ],
      'show',
      (s) => {
        if (s.id === 'beakmans-world') {
          throw new Error('parserKind=regex but parserSpec is empty');
        }
        return s.id;
      }
    );
    assert.deepEqual(out, ['good-1', 'good-2']);
    assert.equal(errorCalls.length, 1);
    const logged = String(errorCalls[0].args[0]);
    assert.ok(
      logged.includes('beakmans-world'),
      `expected error log to mention the bad row id: ${logged}`
    );
    assert.ok(
      logged.includes('parserSpec is empty'),
      `expected error log to forward the thrown message: ${logged}`
    );
  });

  it('logs once per bad row when multiple rows throw', () => {
    const out = hydrateRows(
      [
        { id: 'bad-1', type: 'movie' },
        { id: 'good', type: 'movie' },
        { id: 'bad-2', type: 'movie' }
      ],
      'movie',
      (s) => {
        if (String(s.id).startsWith('bad-')) throw new Error('boom ' + s.id);
        return s.id;
      }
    );
    assert.deepEqual(out, ['good']);
    assert.equal(errorCalls.length, 2);
  });

  it('survives a row missing an id (logs (no id))', () => {
    const out = hydrateRows([{ type: 'show' }, { id: 'fine', type: 'show' }], 'show', (s) => {
      if (!s.id) throw new Error('row has no id');
      return s.id;
    });
    assert.deepEqual(out, ['fine']);
    assert.equal(errorCalls.length, 1);
    const logged = String(errorCalls[0].args[0]);
    assert.ok(logged.includes('(no id)'), `expected fallback label for id-less rows: ${logged}`);
  });

  it('forwards non-Error throws verbatim through String()', () => {
    const out = hydrateRows([{ id: 'odd', type: 'show' }], 'show', () => {
      // eslint-disable-next-line no-throw-literal
      throw 'plain string thrown';
    });
    assert.deepEqual(out, []);
    assert.equal(errorCalls.length, 1);
    assert.ok(String(errorCalls[0].args[0]).includes('plain string thrown'));
  });
});
