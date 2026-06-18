/**
 * Tests for the declarative parser-spec compiler + the serialize/parse
 * round-trip used to ferry specs through a Google Sheet cell.
 *
 * Coverage focuses on the schema's edge cases (constantSeason vs
 * seasonGroup vs seasonFromPath, titleTemplate vs titleGroup, path vs
 * basename matching, reject filters, transforms) in isolation, and
 * the JSON round-trip's idempotency. Per-show parser correctness is
 * exercised by the live sheet (each row's `parserSpec` cell drives
 * the actual `/watch/` catalog), not duplicated as fixtures here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compileSpec, serializeSpec, parseSpec, compileSerialized } from './parser-specs.js';

describe('compileSpec — basic seasonGroup + episodeGroup + titleGroup', () => {
  const parse = compileSpec({
    attempts: [
      {
        regex: /^Show S(\d{1,2})E(\d{1,3}) - (.+)\.mp4$/i,
        seasonGroup: 1,
        episodeGroup: 2,
        titleGroup: 3
      }
    ]
  });

  it('extracts season, episode, and title', () => {
    assert.deepEqual(parse('Show S03E07 - The Big One.mp4'), {
      season: 3,
      episode: 7,
      title: 'The Big One'
    });
  });

  it('returns null on a non-matching filename', () => {
    assert.equal(parse('something_else.mp4'), null);
  });

  it('trims whitespace around the captured title by default', () => {
    assert.equal(parse('Show S01E02 -    Padded   .mp4').title, 'Padded');
  });
});

describe('compileSpec — constantSeason', () => {
  const parse = compileSpec({
    attempts: [
      {
        regex: /^Ep (\d{1,3}) (.+)\.mp4$/i,
        constantSeason: 1,
        episodeGroup: 1,
        titleGroup: 2
      }
    ]
  });

  it('seeds season=1 when the filename has no season token', () => {
    assert.deepEqual(parse('Ep 14 Some Title.mp4'), {
      season: 1,
      episode: 14,
      title: 'Some Title'
    });
  });
});

describe('compileSpec — titleTemplate', () => {
  const parse = compileSpec({
    attempts: [
      {
        regex: /^Show\.S(\d{2})E(\d{2})\.480p\.mp4$/,
        seasonGroup: 1,
        episodeGroup: 2,
        titleTemplate: 'Episode {episode}'
      }
    ]
  });

  it('synthesises a placeholder title with {episode} substituted', () => {
    assert.equal(parse('Show.S04E12.480p.mp4').title, 'Episode 12');
  });
});

describe('compileSpec — seasonFromPath via pathSeasonRegex', () => {
  const parse = compileSpec({
    pathSeasonRegex: /\/S\s(\d+)\//,
    attempts: [
      {
        regex: /^EP (\d+) (.+)\.mp4$/i,
        seasonFromPath: 1,
        episodeGroup: 1,
        titleGroup: 2
      }
    ]
  });

  it('pulls the season from a directory name', () => {
    assert.deepEqual(parse('Harvey Birdman/S 2/EP 04 Whirlwind Heat.mp4'), {
      season: 2,
      episode: 4,
      title: 'Whirlwind Heat'
    });
  });

  it('rejects files outside any season directory (pathSeasonRegex miss)', () => {
    assert.equal(parse('EP 04 Whirlwind Heat.mp4'), null);
  });
});

describe('compileSpec — pathReject / basenameReject', () => {
  const parse = compileSpec({
    pathReject: /\/Extras\//,
    basenameReject: /^Disclaimer\.mp4$/i,
    attempts: [
      {
        regex: /^EP (\d+) (.+)\.mp4$/i,
        constantSeason: 1,
        episodeGroup: 1,
        titleGroup: 2
      }
    ]
  });

  it('drops files inside an /Extras/ path', () => {
    assert.equal(parse('Show/Extras/EP 01 Bonus.mp4'), null);
  });

  it('drops files whose basename matches the rejecter', () => {
    assert.equal(parse('Show/Disclaimer.mp4'), null);
  });

  it('keeps everything else', () => {
    assert.deepEqual(parse('Show/EP 03 Real Episode.mp4'), {
      season: 1,
      episode: 3,
      title: 'Real Episode'
    });
  });
});

describe('compileSpec — multiple attempts, first-match-wins', () => {
  const parse = compileSpec({
    attempts: [
      { regex: /^A\.S(\d)E(\d)\.mp4$/, seasonGroup: 1, episodeGroup: 2, titleTemplate: 'A' },
      { regex: /^B\.S(\d)E(\d)\.mp4$/, seasonGroup: 1, episodeGroup: 2, titleTemplate: 'B' }
    ]
  });

  it('picks the first attempt that matches', () => {
    assert.equal(parse('A.S1E1.mp4').title, 'A');
    assert.equal(parse('B.S2E3.mp4').title, 'B');
    assert.equal(parse('C.S1E1.mp4'), null);
  });
});

describe('compileSpec — title transforms', () => {
  it('underscores_to_spaces converts every underscore', () => {
    const parse = compileSpec({
      attempts: [
        {
          regex: /^(\d+)_(.+)\.mp4$/,
          constantSeason: 1,
          episodeGroup: 1,
          titleGroup: 2,
          titleTransforms: ['underscores_to_spaces']
        }
      ]
    });
    assert.equal(parse('05_a_perfect_circle.mp4').title, 'a perfect circle');
  });

  it('dots_to_spaces converts every dot', () => {
    const parse = compileSpec({
      attempts: [
        {
          regex: /^(\d+)\.(.+)\.mp4$/,
          constantSeason: 1,
          episodeGroup: 1,
          titleGroup: 2,
          titleTransforms: ['dots_to_spaces']
        }
      ]
    });
    assert.equal(parse('05.fast.cars.and.freedom.mp4').title, 'fast cars and freedom');
  });
});

describe('compileSpec — matchPath', () => {
  const parse = compileSpec({
    attempts: [
      {
        regex: /\/Season(\d+)\/(\d+) (.+)\.mp4$/,
        matchPath: true,
        seasonGroup: 1,
        episodeGroup: 2,
        titleGroup: 3
      }
    ]
  });

  it('matches against the full path when matchPath is true', () => {
    assert.deepEqual(parse('Show/Season3/07 The Match.mp4'), {
      season: 3,
      episode: 7,
      title: 'The Match'
    });
  });
});

describe('serializeSpec / parseSpec round-trip', () => {
  it('a serialize→JSON→parse→compile cycle produces an equivalent parser', () => {
    /** @type {import('./parser-specs.js').ParserSpec} */
    const original = {
      pathReject: /\/Extras\//,
      attempts: [
        {
          regex: /^Boondocks S(\d) E(\d{1,2}) (.+)\.mp4$/i,
          seasonGroup: 1,
          episodeGroup: 2,
          titleGroup: 3,
          titleTransforms: ['trim']
        }
      ]
    };
    const json = JSON.stringify(serializeSpec(original));
    const rebuilt = compileSpec(parseSpec(JSON.parse(json)));
    const inline = compileSpec(original);

    const inputs = [
      'Boondocks S1 E03 The Garden Party.mp4',
      'Boondocks/Extras/BTS.mp4',
      'unrelated.mp4',
      'Boondocks S2 E11 Stinkmeaner Strikes Back.mp4'
    ];
    for (const input of inputs) {
      assert.deepEqual(rebuilt(input), inline(input), `mismatch on ${input}`);
    }
  });

  it('serializeSpec drops absent optional fields (no null cruft in the cell)', () => {
    const json = serializeSpec({
      attempts: [{ regex: /^X(\d)\.mp4$/, constantSeason: 1, episodeGroup: 1 }]
    });
    assert.deepEqual(Object.keys(json), ['attempts']);
    assert.deepEqual(Object.keys(json.attempts[0]), ['regex', 'episodeGroup', 'constantSeason']);
  });

  it('serializeSpec is idempotent: feed already-serialized regexes back through', () => {
    const once = serializeSpec({
      attempts: [{ regex: /abc/i, constantSeason: 1, episodeGroup: 1 }]
    });
    const twice = serializeSpec(/** @type {any} */ (once));
    assert.deepEqual(twice, once);
  });

  it('parseSpec accepts already-RegExp values (idempotent)', () => {
    /** @type {any} */
    const hybrid = {
      attempts: [{ regex: /xyz/i, constantSeason: 1, episodeGroup: 1 }]
    };
    const parsed = parseSpec(hybrid);
    assert.ok(parsed.attempts[0].regex instanceof RegExp);
    assert.equal(parsed.attempts[0].regex.source, 'xyz');
    assert.equal(parsed.attempts[0].regex.flags, 'i');
  });

  it('compileSerialized is the parse+compile shorthand', () => {
    const json = JSON.parse(
      JSON.stringify(
        serializeSpec({
          attempts: [
            {
              regex: /^Show S(\d)E(\d) - (.+)\.mp4$/,
              seasonGroup: 1,
              episodeGroup: 2,
              titleGroup: 3
            }
          ]
        })
      )
    );
    const parser = compileSerialized(json);
    assert.deepEqual(parser('Show S1E2 - Hello.mp4'), { season: 1, episode: 2, title: 'Hello' });
  });

  it('parseSpec throws on missing required fields', () => {
    assert.throws(() => parseSpec(null), /expected an object/);
    assert.throws(
      () => parseSpec({ attempts: [{ regex: 'not a regex shape', episodeGroup: 1 }] }),
      /expected.*source.*flags|expected RegExp/
    );
  });
});
