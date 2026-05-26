/**
 * Tests for the TVMaze description-builder used by /watch/.
 *
 * `buildMap` is pure: it turns the raw `GET /shows/<id>/episodes` JSON
 * into a `Map<key, EpisodeInfo>` the catalog merge step can consume.
 * The wrapper `loadDescriptions` adds a localStorage cache + a fetch
 * fallback to an empty Map — both of which are deliberately untested
 * here because they're effectively browser-side glue.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildMap, makeKey } from './descriptions.js';

describe('makeKey', () => {
  it('produces a stable zero-padded SxxEyy', () => {
    assert.equal(makeKey(1, 1), 'S01E01');
    assert.equal(makeKey(7, 25), 'S07E25');
    assert.equal(makeKey(0, 2), 'S00E02');
    assert.equal(makeKey(20, 10), 'S20E10');
  });
});

describe('buildMap', () => {
  it('keys entries by SxxEyy and preserves summary, image, airdate, name', () => {
    const map = buildMap([
      {
        season: 1,
        number: 1,
        name: 'Simpsons Roasting on an Open Fire',
        airdate: '1989-12-17',
        summary: '<p>Homer plays Santa to make ends meet.</p>',
        image: {
          medium: 'https://tvmaze.example/medium.jpg',
          original: 'https://tvmaze.example/original.jpg'
        }
      }
    ]);
    assert.equal(map.size, 1);
    const info = map.get('S01E01');
    assert.equal(info.name, 'Simpsons Roasting on an Open Fire');
    assert.equal(info.summary, 'Homer plays Santa to make ends meet.');
    assert.equal(info.image, 'https://tvmaze.example/medium.jpg');
    assert.equal(info.imageHd, 'https://tvmaze.example/original.jpg');
    assert.equal(info.airdate, '1989-12-17');
  });

  it('strips HTML tags from summary and collapses whitespace', () => {
    const map = buildMap([
      {
        season: 1,
        number: 2,
        summary: '<p>First line.</p>\n<p>Second   line   <em>here</em>.</p>'
      }
    ]);
    assert.equal(map.get('S01E02').summary, 'First line. Second line here.');
  });

  it('coerces null fields to null instead of throwing', () => {
    const map = buildMap([
      { season: 1, number: 3, name: null, summary: null, image: null, airdate: null }
    ]);
    const info = map.get('S01E03');
    assert.equal(info.summary, '');
    assert.equal(info.image, null);
    assert.equal(info.imageHd, null);
    assert.equal(info.airdate, null);
    assert.equal(info.name, null);
  });

  it('skips entries with non-numeric season or number', () => {
    const map = buildMap([
      { season: 1, number: 1, name: 'Good' },
      { season: 'x', number: 1, name: 'Bad season' },
      { season: 1, number: 'y', name: 'Bad number' },
      { season: 1, number: 2, name: 'Also good' }
    ]);
    assert.deepEqual(Array.from(map.keys()).sort(), ['S01E01', 'S01E02']);
  });

  it('skips non-object entries silently', () => {
    const map = buildMap([null, 'oops', 42, { season: 1, number: 1, name: 'Only good one' }]);
    assert.equal(map.size, 1);
    assert.equal(map.get('S01E01').name, 'Only good one');
  });
});
