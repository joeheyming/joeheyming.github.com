/**
 * Tests for the Google Sheet loader used by /watch/.
 *
 * Mirrors the convention of `descriptions.test.mjs`: cover the pure
 * parsing helpers exhaustively, plus the subject→ShowConfig/MovieConfig
 * transforms that turn a raw sheet row into the shape `catalog.js`
 * consumes. The network-touching `loadSubjects` path is smoke-tested
 * by hand against the live sheet (open the site, watch the gviz
 * request fire in devtools, confirm the landing grid populates).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGvizResponse,
  rowsToObjects,
  escapeSqlValue,
  buildGvizUrl,
  splitTags,
  parseIaItem,
  makeShowParser,
  makeAcceptFile,
  subjectToShowConfig,
  subjectToMovieConfig,
  __testing
} from './sheets-loader.js';

describe('buildGvizUrl', () => {
  it('points at the live sheet with sane defaults', () => {
    const url = buildGvizUrl('subjects');
    const u = new URL(url);
    assert.equal(u.hostname, 'docs.google.com');
    assert.ok(u.pathname.includes(__testing.SHEET_ID));
    assert.equal(u.searchParams.get('sheet'), 'subjects');
    assert.equal(u.searchParams.get('tqx'), 'out:json');
    assert.equal(u.searchParams.get('headers'), '1');
    assert.equal(u.searchParams.get('tq'), null);
  });

  it('encodes a SQL fragment when provided', () => {
    const url = buildGvizUrl('episodes', "select * where A='simpsons'");
    const u = new URL(url);
    assert.equal(u.searchParams.get('tq'), "select * where A='simpsons'");
  });
});

describe('escapeSqlValue', () => {
  it('passes simple ids through unchanged', () => {
    assert.equal(escapeSqlValue('simpsons'), 'simpsons');
    assert.equal(escapeSqlValue('star-trek-tng'), 'star-trek-tng');
  });

  it('doubles up single quotes to match gviz string-literal syntax', () => {
    assert.equal(escapeSqlValue("O'Brien"), "O''Brien");
    assert.equal(escapeSqlValue("'leading"), "''leading");
    assert.equal(escapeSqlValue("trailing'"), "trailing''");
  });

  it('coerces non-strings', () => {
    assert.equal(escapeSqlValue(42), '42');
    assert.equal(escapeSqlValue(null), 'null');
  });
});

describe('parseGvizResponse', () => {
  // Build a realistic gviz payload — the wrapper is exactly what
  // docs.google.com emits, down to the /*O_o*/ cookie prefix.
  function wrap(obj) {
    return '/*O_o*/\ngoogle.visualization.Query.setResponse(' + JSON.stringify(obj) + ');';
  }

  it('strips the jsonp wrapper and returns the inner table', () => {
    const text = wrap({
      version: '0.6',
      reqId: '0',
      status: 'ok',
      sig: '1',
      table: { cols: [{ label: 'id', type: 'string' }], rows: [{ c: [{ v: 'a' }] }] }
    });
    const table = parseGvizResponse(text);
    assert.equal(table.cols[0].label, 'id');
    assert.equal(table.rows[0].c[0].v, 'a');
  });

  it('tolerates a payload without the /*O_o*/ cookie prefix', () => {
    const text =
      'google.visualization.Query.setResponse({"status":"ok","table":{"cols":[],"rows":[]}});';
    const table = parseGvizResponse(text);
    assert.deepEqual(table.cols, []);
    assert.deepEqual(table.rows, []);
  });

  it('throws on missing wrapper parens', () => {
    assert.throws(() => parseGvizResponse('not jsonp at all'), /missing jsonp wrapper/);
  });

  it('throws with the detailed message when status !== ok', () => {
    const text = wrap({
      status: 'error',
      errors: [{ message: 'invalid_query', detailed_message: "column 'Z' does not exist" }],
      table: { cols: [], rows: [] }
    });
    assert.throws(() => parseGvizResponse(text), /column 'Z' does not exist/);
  });

  it('throws when the table is missing', () => {
    const text = wrap({ status: 'ok' });
    assert.throws(() => parseGvizResponse(text), /missing \.table/);
  });
});

describe('rowsToObjects', () => {
  it('keys output objects by cols[i].label', () => {
    const out = rowsToObjects({
      cols: [
        { label: 'id', type: 'string' },
        { label: 'name', type: 'string' },
        { label: 'tvmazeId', type: 'number' }
      ],
      rows: [
        { c: [{ v: 'simpsons' }, { v: 'The Simpsons' }, { v: 456 }] },
        { c: [{ v: 'futurama' }, { v: 'Futurama' }, { v: 461 }] }
      ]
    });
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { id: 'simpsons', name: 'The Simpsons', tvmazeId: 456 });
    assert.deepEqual(out[1], { id: 'futurama', name: 'Futurama', tvmazeId: 461 });
  });

  it('falls back to col.id when label is missing, and to colN if both are', () => {
    const out = rowsToObjects({
      cols: [{ id: 'A' }, {}],
      rows: [{ c: [{ v: 'one' }, { v: 'two' }] }]
    });
    assert.deepEqual(out[0], { A: 'one', col1: 'two' });
  });

  it('represents empty cells as null (not undefined)', () => {
    const out = rowsToObjects({
      cols: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
      rows: [{ c: [{ v: 'x' }, null, { v: 'z' }] }]
    });
    assert.deepEqual(out[0], { a: 'x', b: null, c: 'z' });
    // Keep the key present so callers don't need optional-chaining for
    // every field — `row.b === null` is more honest than `row.b === undefined`.
    assert.ok('b' in out[0]);
  });

  it('drops rows that are entirely empty', () => {
    const out = rowsToObjects({
      cols: [{ label: 'a' }, { label: 'b' }],
      rows: [
        { c: [{ v: 'real' }, { v: 'data' }] },
        { c: [null, null] },
        { c: [{ v: '' }, { v: '' }] }
      ]
    });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { a: 'real', b: 'data' });
  });

  it('tolerates malformed inputs without throwing', () => {
    assert.deepEqual(rowsToObjects({}), []);
    assert.deepEqual(rowsToObjects({ cols: [], rows: null }), []);
    assert.deepEqual(
      rowsToObjects({ cols: [{ label: 'x' }], rows: [null, {}, { c: 'notarray' }] }),
      []
    );
  });
});

describe('splitTags', () => {
  it('splits a comma-separated tag list', () => {
    assert.deepEqual(splitTags('animation,adult,comedy'), ['animation', 'adult', 'comedy']);
  });
  it('trims whitespace and drops empties', () => {
    assert.deepEqual(splitTags(' a ,, b ,  '), ['a', 'b']);
  });
  it('returns [] for empty input', () => {
    assert.deepEqual(splitTags(''), []);
    assert.deepEqual(splitTags(null), []);
  });
});

describe('parseIaItem', () => {
  it('returns a bare string for single-item shows', () => {
    assert.equal(parseIaItem('simpsons-classic'), 'simpsons-classic');
  });
  it('returns an array for multi-item shows', () => {
    assert.deepEqual(parseIaItem('gi-joe-1,gi-joe-2,gi-joe-3'), [
      'gi-joe-1',
      'gi-joe-2',
      'gi-joe-3'
    ]);
  });
  it('returns "" for empty input', () => {
    assert.equal(parseIaItem(''), '');
    assert.equal(parseIaItem(null), '');
  });
});

describe('makeShowParser', () => {
  it('parserKind=generic returns null (catalog.js falls back to TVMaze + generic matcher)', () => {
    assert.equal(makeShowParser({ id: 'x', parserKind: 'generic' }), null);
  });

  it('parserKind=regex compiles the parserSpec JSON into a working parser', () => {
    const spec = {
      attempts: [
        {
          regex: { source: '^Show S(\\d{1,2})E(\\d{1,2}) - (.+)\\.mp4$', flags: 'i' },
          seasonGroup: 1,
          episodeGroup: 2,
          titleGroup: 3
        }
      ]
    };
    const parser = makeShowParser({
      id: 'x',
      parserKind: 'regex',
      parserSpec: JSON.stringify(spec)
    });
    assert.deepEqual(parser('Show S03E07 - Foo.mp4'), { season: 3, episode: 7, title: 'Foo' });
    assert.equal(parser('not-a-match'), null);
  });

  it('parserKind=regex throws on empty parserSpec', () => {
    assert.throws(
      () => makeShowParser({ id: 'x', parserKind: 'regex', parserSpec: '' }),
      /parserKind=regex but parserSpec is empty/
    );
  });

  it('parserKind=regex throws on invalid JSON', () => {
    assert.throws(
      () => makeShowParser({ id: 'x', parserKind: 'regex', parserSpec: 'not json' }),
      /not valid JSON/
    );
  });

  it('parserKind=js looks up the bespoke parser by id', () => {
    const parser = makeShowParser({ id: 'dnd', parserKind: 'js' });
    assert.equal(typeof parser, 'function');
    // Don't re-test dnd parser shape here; parsers-js.test.mjs owns
    // the bespoke-parser test matrix.
  });

  it('parserKind=js throws for an unknown id', () => {
    assert.throws(
      () => makeShowParser({ id: 'never-registered', parserKind: 'js' }),
      /no entry in.*parsers-js\.js/
    );
  });

  it('throws on an unknown parserKind', () => {
    assert.throws(
      () => makeShowParser({ id: 'x', parserKind: 'lambda-calculus' }),
      /unknown parserKind=lambda-calculus/
    );
  });
});

describe('makeAcceptFile', () => {
  const sample = (name) => ({ name });

  it("default ('') accepts plain .mp4 but rejects .ia.mp4", () => {
    const accept = makeAcceptFile('');
    assert.equal(accept(sample('ep01.mp4')), true);
    assert.equal(accept(sample('ep01.ia.mp4')), false);
    assert.equal(accept(sample('ep01.mkv')), false);
  });

  it('any-mp4 accepts both flavors', () => {
    const accept = makeAcceptFile('any-mp4');
    assert.equal(accept(sample('ep01.mp4')), true);
    assert.equal(accept(sample('ep01.ia.mp4')), true);
    assert.equal(accept(sample('ep01.mkv')), false);
  });

  it('ia-mp4-only accepts only .ia.mp4', () => {
    const accept = makeAcceptFile('ia-mp4-only');
    assert.equal(accept(sample('ep01.mp4')), false);
    assert.equal(accept(sample('ep01.ia.mp4')), true);
  });

  it('throws on an unknown kind', () => {
    assert.throws(() => makeAcceptFile('webm-only'), /unknown acceptFile kind/);
  });
});

describe('subjectToShowConfig', () => {
  it('produces a ShowConfig-shaped object with iaItem as a string for single-item shows', () => {
    const cfg = subjectToShowConfig({
      id: 'simpsons',
      type: 'show',
      name: 'The Simpsons',
      shortName: 'Simpsons',
      emoji: '🍩',
      accent: '#fbbf24',
      tags: 'animation,comedy,90s',
      tagline: 'America\u2019s favourite yellow family',
      iaItem: 'simpsons-classic',
      tvmazeId: 83,
      imdbId: 'tt0096697',
      posterUrl: '',
      parserKind: 'generic',
      parserSpec: '',
      acceptFile: ''
    });
    assert.equal(cfg.id, 'simpsons');
    assert.equal(cfg.iaItem, 'simpsons-classic');
    assert.deepEqual(cfg.tags, ['animation', 'comedy', '90s']);
    assert.equal(cfg.tvmazeId, 83);
    assert.equal(cfg.parser, null);
    assert.equal(typeof cfg.acceptFile, 'function');
  });

  it('returns an array for multi-item shows', () => {
    const cfg = subjectToShowConfig({
      id: 'gi-joe',
      type: 'show',
      name: 'G.I. Joe',
      tags: '',
      iaItem: 'gi-joe-1,gi-joe-2,gi-joe-3',
      tvmazeId: 6880,
      parserKind: 'js',
      parserSpec: '',
      acceptFile: ''
    });
    assert.deepEqual(cfg.iaItem, ['gi-joe-1', 'gi-joe-2', 'gi-joe-3']);
    assert.equal(typeof cfg.parser, 'function');
  });

  it('refuses to transform a movie row', () => {
    assert.throws(
      () => subjectToShowConfig({ id: 'x', type: 'movie' }),
      /type=movie, expected 'show'/
    );
  });
});

describe('subjectToMovieConfig', () => {
  it('produces a MovieConfig-shaped object with kind=movie', () => {
    const cfg = subjectToMovieConfig({
      id: 'simpsons-movie',
      type: 'movie',
      name: 'The Simpsons Movie',
      shortName: 'Simpsons Movie',
      emoji: '🎥',
      accent: '#facc15',
      tags: 'animation,comedy,movie',
      tagline: '',
      iaItem: 'the-simpsons-movie',
      iaFile: 'The Simpsons Movie.mp4',
      tvmazeId: 0,
      imdbId: 'tt0462538',
      posterUrl: '',
      parserKind: 'movie-file',
      parserSpec: '',
      acceptFile: ''
    });
    assert.equal(cfg.kind, 'movie');
    assert.equal(cfg.iaItem, 'the-simpsons-movie');
    assert.equal(cfg.iaFile, 'The Simpsons Movie.mp4');
    assert.equal(typeof cfg.acceptFile, 'function');
  });

  it('refuses to transform a show row', () => {
    assert.throws(
      () => subjectToMovieConfig({ id: 'x', type: 'show' }),
      /type=show, expected 'movie'/
    );
  });
});
