/**
 * Unit tests for the three bespoke JS parsers in `parsers-js.js`.
 *
 * These are the shows whose filename-to-episode mapping can't be
 * expressed as a {@link ParserSpec} in the sheet (alphabetic-suffix
 * arithmetic, item-id branching, segment doubling). Everything else
 * is a sheet `parserKind='regex'` or `parserKind='generic'` and
 * gets coverage through `parser-specs.test.mjs` + the integration
 * smoke tests against the live sheet.
 *
 * Test fixtures here were salvaged from the old `shows.test.mjs`
 * — the inline SHOWS array (and the parsers attached to it) was
 * deleted when the registry moved into the sheet, but the regression
 * cases for the three bespoke parsers are still worth keeping local.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { JS_PARSERS, getJsParser } from './parsers-js.js';

const parseDnD = JS_PARSERS['dnd'];
const parseGiJoe = JS_PARSERS['gi-joe'];
const parseSpiderMan = JS_PARSERS['spider-man'];

describe('getJsParser', () => {
  it('returns the registered parser for each bespoke show id', () => {
    assert.equal(typeof getJsParser('dnd'), 'function');
    assert.equal(typeof getJsParser('gi-joe'), 'function');
    assert.equal(typeof getJsParser('spider-man'), 'function');
  });

  it('returns null for unknown ids', () => {
    assert.equal(getJsParser('simpsons'), null);
    assert.equal(getJsParser(''), null);
    assert.equal(getJsParser('does-not-exist'), null);
  });
});

describe('parseDnD', () => {
  it('parses the canonical "S01E01 (Title)" form', () => {
    assert.deepEqual(parseDnD('Dungeons and Dragons - S01E01 (The Night of No Tomorrow).mp4'), {
      season: 1,
      episode: 1,
      title: 'The Night of No Tomorrow'
    });
  });

  it('parses two-digit episode numbers and parens with punctuation', () => {
    assert.deepEqual(parseDnD('Dungeons and Dragons - S01E13 (P-R-E-S-T-O Spells Disaster).mp4'), {
      season: 1,
      episode: 13,
      title: 'P-R-E-S-T-O Spells Disaster'
    });
  });

  it('maps the reconstructed "Requiem" two-parter (E07a + E07b) onto E07 and E08', () => {
    assert.deepEqual(parseDnD('Dungeons and Dragons - S03E07a (Requiem).mp4'), {
      season: 3,
      episode: 7,
      title: 'Requiem (Part 1)'
    });
    assert.deepEqual(parseDnD('Dungeons and Dragons - S03E07b (Requiem).mp4'), {
      season: 3,
      episode: 8,
      title: 'Requiem (Part 2)'
    });
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseDnD('cover.jpg'), null);
    assert.equal(parseDnD('Dungeons and Dragons (2023).mp4'), null);
    assert.equal(parseDnD('Dungeons and Dragons - extras.mp4'), null);
  });
});

describe('parseGiJoe', () => {
  it('maps the MASS Device mini-series (item gi-joe-1, mini 1) into S0E1..E5', () => {
    assert.deepEqual(parseGiJoe('1-1. The M.A.S.S. Device Part 1.mp4', 'gi-joe-1'), {
      season: 0,
      episode: 1,
      title: 'The M.A.S.S. Device Part 1'
    });
    assert.deepEqual(parseGiJoe('1-5. The M.A.S.S. Device Part 5.mp4', 'gi-joe-1'), {
      season: 0,
      episode: 5,
      title: 'The M.A.S.S. Device Part 5'
    });
  });

  it('maps the Revenge of Cobra mini-series (item gi-joe-1, mini 2) into S0E6..E10', () => {
    assert.deepEqual(parseGiJoe('2-1. The Revenge of Cobra Part 1.mp4', 'gi-joe-1'), {
      season: 0,
      episode: 6,
      title: 'The Revenge of Cobra Part 1'
    });
    assert.deepEqual(parseGiJoe('2-5. The Revenge Of Cobra Part 5.mp4', 'gi-joe-1'), {
      season: 0,
      episode: 10,
      title: 'The Revenge Of Cobra Part 5'
    });
  });

  it('parses gi-joe-2 (1985 regular series) as season 1', () => {
    assert.deepEqual(parseGiJoe('1. The Pyramid of Darkness Part 1.mp4', 'gi-joe-2'), {
      season: 1,
      episode: 1,
      title: 'The Pyramid of Darkness Part 1'
    });
    assert.deepEqual(parseGiJoe("55. There's No Place Like Springfield Part 2.mp4", 'gi-joe-2'), {
      season: 1,
      episode: 55,
      title: "There's No Place Like Springfield Part 2"
    });
  });

  it('parses gi-joe-3 (1986 second season) as season 2', () => {
    assert.deepEqual(parseGiJoe('1. Arise, Serpentor, Arise! Part 1.mp4', 'gi-joe-3'), {
      season: 2,
      episode: 1,
      title: 'Arise, Serpentor, Arise! Part 1'
    });
  });

  it('rejects the bundled movie file (G.I. Joe The Movie ships as type=movie in the sheet)', () => {
    // `G.I. Joe The Movie.mp4` ships in the `gi-joe-3` IA item
    // alongside S2. The parser regex `^(\d+)\. (.*)\.mp4` does NOT
    // match the movie filename, so it gets dropped from the show
    // catalog — intentional, the movie is exposed as a separate
    // `type='movie'` subject (`?movie=gi-joe-the-movie`).
    assert.equal(parseGiJoe('G.I. Joe The Movie.mp4', 'gi-joe-3'), null);
    assert.equal(parseGiJoe('G.I. Joe The Movie.mp4', 'gi-joe-2'), null);
  });

  it('returns null for unrelated files', () => {
    assert.equal(parseGiJoe('cover.jpg', 'gi-joe-2'), null);
    assert.equal(parseGiJoe('G.I. Joe - Spy Troops.mp4', 'gi-joe-2'), null);
  });
});

describe('parseSpiderMan', () => {
  it('parses S1 A/B segments into doubled episode slots (slot*2-1, slot*2)', () => {
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/1A - The Power Of Dr. Octopus.mp4'), {
      season: 1,
      episode: 1,
      title: 'The Power Of Dr. Octopus'
    });
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/1B - Sub-Zero For Spidey.mp4'), {
      season: 1,
      episode: 2,
      title: 'Sub-Zero For Spidey'
    });
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/10A - The Revenge Of Dr. Magneto.mp4'), {
      season: 1,
      episode: 19,
      title: 'The Revenge Of Dr. Magneto'
    });
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/10B - The Sinister Prime Minister.mp4'), {
      season: 1,
      episode: 20,
      title: 'The Sinister Prime Minister'
    });
  });

  it('parses S1 solo segments (no letter) into the A position, leaving a B gap', () => {
    // Slot 3 ("The Menace Of Mysterio") aired without a B half;
    // we map it to ep 5 (= 3*2-1), the corresponding ep 6 stays
    // empty in the catalog — that gap signals the broadcast's
    // own single-segment status.
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/3 - The Menace Of Mysterio.mp4'), {
      season: 1,
      episode: 5,
      title: 'The Menace Of Mysterio'
    });
    assert.deepEqual(parseSpiderMan('Season 1 (1967-1968)/8 - Horn Of The Rhino.mp4'), {
      season: 1,
      episode: 15,
      title: 'Horn Of The Rhino'
    });
  });

  it('parses S2 (full 22-min episodes) using the slot number directly', () => {
    // S2 aired 22-minute episodes with no segmentation, so we don't
    // double the slot number — slot 1 = ep 1, slot 19 = ep 19.
    assert.deepEqual(parseSpiderMan('Season 2 (1968-1969)/1 - The Origin Of Spiderman.mp4'), {
      season: 2,
      episode: 1,
      title: 'The Origin Of Spiderman'
    });
    assert.deepEqual(parseSpiderMan('Season 2 (1968-1969)/19 - To Cage A Spider.mp4'), {
      season: 2,
      episode: 19,
      title: 'To Cage A Spider'
    });
  });

  it('parses S3 mixed A/B + solo files, matching the S1 doubling formula', () => {
    assert.deepEqual(parseSpiderMan('Season 3 (1970)/1A - The Winged Thing.mp4'), {
      season: 3,
      episode: 1,
      title: 'The Winged Thing'
    });
    assert.deepEqual(parseSpiderMan('Season 3 (1970)/9B - The Madness Of Mysterio.mp4'), {
      season: 3,
      episode: 18,
      title: 'The Madness Of Mysterio'
    });
    assert.deepEqual(parseSpiderMan('Season 3 (1970)/13 - Trip To Tomorrow.mp4'), {
      season: 3,
      episode: 25,
      title: 'Trip To Tomorrow'
    });
  });

  it('returns null for unrelated files', () => {
    // No "/Season N " path component → no way to derive season.
    assert.equal(parseSpiderMan('1A - Pilot.mp4'), null);
    assert.equal(parseSpiderMan('cover.jpg'), null);
    // Title-less filenames don't parse (no separator hyphen).
    assert.equal(parseSpiderMan('Season 1 (1967-1968)/1A.mp4'), null);
  });
});
