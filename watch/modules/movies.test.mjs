/**
 * Movies registry tests.
 *
 * The MOVIES array ships empty on purpose — this file exercises the
 * registry shape (typedef invariants, helper functions, tag taxonomy
 * conformance) so a future movie added without those invariants
 * fails CI rather than silently shipping a broken card on the
 * landing page.
 *
 * The non-collision check between SHOWS and MOVIES ids is essential
 * because the per-subject storage layers (prefs, offline) key on a
 * single string id with no `kind` discriminator. A collision would
 * cause continue-watching and saved-offline entries to land on the
 * wrong subject, with surprising UI fallout (the watch view would
 * try to load a series with a movie's saved scrub point, etc.).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SHOWS } from './shows.js';
import { MOVIES, getMovie, hasOnlyCanonicalTags, ALL_TAGS, TAG_GROUPS } from './movies.js';

describe('MOVIES registry', () => {
  it('is an array', () => {
    assert.ok(Array.isArray(MOVIES));
  });

  it('is sorted by id', () => {
    const ids = MOVIES.map((m) => m.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(ids, sorted);
  });

  it('has unique ids', () => {
    const ids = MOVIES.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate movie id detected');
  });

  it('movie ids do not collide with show ids', () => {
    // The prefs / offline storage layers key on `<id>` with no kind
    // discriminator. A collision here would route a movie's saved
    // resume point onto a same-id show (or vice versa), with the
    // continue-watching card linking to the wrong subject. The two
    // registries MUST use disjoint id namespaces.
    const showIds = new Set(SHOWS.map((s) => s.id));
    const collisions = MOVIES.filter((m) => showIds.has(m.id)).map((m) => m.id);
    assert.deepEqual(collisions, [], `movie id(s) collide with show ids: ${collisions.join(', ')}`);
  });
});

describe('MOVIES entries', () => {
  // Every assertion in this block iterates MOVIES — when the array
  // is empty (the default while no movies are registered) each test
  // is a trivial pass, but the shape contract still runs the moment
  // a movie gets added.

  it('each entry has the required string fields', () => {
    for (const m of MOVIES) {
      assert.equal(typeof m.id, 'string', `${m.id}: id missing`);
      assert.ok(m.id.length > 0, `${m.id}: id empty`);
      assert.equal(typeof m.name, 'string', `${m.id}: name missing`);
      assert.equal(typeof m.shortName, 'string', `${m.id}: shortName missing`);
      assert.equal(typeof m.emoji, 'string', `${m.id}: emoji missing`);
      assert.equal(typeof m.accent, 'string', `${m.id}: accent missing`);
      assert.equal(typeof m.tagline, 'string', `${m.id}: tagline missing`);
      assert.equal(typeof m.iaItem, 'string', `${m.id}: iaItem missing`);
      assert.ok(m.iaItem.length > 0, `${m.id}: iaItem empty`);
    }
  });

  it('every entry carries the `kind: "movie"` discriminator', () => {
    // The watch view, catalog builder, and ui.js all branch on
    // `subject.kind === 'movie'`. The MOVIES export stamps it via
    // `.map(...)` so registry authors don't have to set it manually
    // — this test locks that contract in. Regression: the field was
    // previously documented-only (in a "why not kind" comment) and
    // never actually attached to entries, which made every movie URL
    // mis-dispatch through the show catalog builder and surface as
    // "Channel is off the air" in the watch view.
    for (const m of MOVIES) {
      assert.equal(m.kind, 'movie', `${m.id}: missing kind: 'movie' discriminator`);
    }
  });

  it('accent is a hex color', () => {
    for (const m of MOVIES) {
      assert.match(m.accent, /^#[0-9a-f]{3,8}$/i, `${m.id}: accent is not a hex colour`);
    }
  });

  it('tags are drawn from the canonical taxonomy', () => {
    for (const m of MOVIES) {
      assert.ok(Array.isArray(m.tags), `${m.id}: tags is not an array`);
      assert.ok(
        hasOnlyCanonicalTags(m),
        `${m.id}: contains a tag outside TAG_GROUPS — tags=${JSON.stringify(m.tags)}`
      );
    }
  });

  it('has exactly one format tag and one era tag', () => {
    const formatTags = new Set(TAG_GROUPS.format);
    const eraTags = new Set(TAG_GROUPS.era);
    for (const m of MOVIES) {
      const formats = (m.tags || []).filter((t) => formatTags.has(t));
      const eras = (m.tags || []).filter((t) => eraTags.has(t));
      assert.equal(formats.length, 1, `${m.id}: needs exactly one format tag, got ${formats}`);
      assert.equal(eras.length, 1, `${m.id}: needs exactly one era tag, got ${eras}`);
    }
  });

  it('iaFile (when set) is a bare basename', () => {
    for (const m of MOVIES) {
      if (m.iaFile === undefined) continue;
      assert.equal(typeof m.iaFile, 'string', `${m.id}: iaFile not a string`);
      assert.ok(
        !m.iaFile.includes('/'),
        `${m.id}: iaFile should be a basename, not a path: ${m.iaFile}`
      );
    }
  });

  it('imdbId (when set) starts with "tt"', () => {
    for (const m of MOVIES) {
      if (m.imdbId === undefined) continue;
      assert.match(m.imdbId, /^tt\d+$/, `${m.id}: imdbId malformed: ${m.imdbId}`);
    }
  });

  it('posterUrl (when set) is an https URL pointing at an image', () => {
    // `posterUrl` is used directly as the card's <img src>, so we
    // enforce shape rather than semantics — `https://` (mixed-content
    // would silently fail on the prod static site) and a recognisable
    // image suffix. Wikipedia's `upload.wikimedia.org` URLs satisfy
    // both for free.
    for (const m of MOVIES) {
      if (m.posterUrl === undefined) continue;
      assert.equal(typeof m.posterUrl, 'string', `${m.id}: posterUrl not a string`);
      assert.match(m.posterUrl, /^https:\/\//, `${m.id}: posterUrl must be https://`);
      assert.match(
        m.posterUrl,
        /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i,
        `${m.id}: posterUrl missing image extension: ${m.posterUrl}`
      );
    }
  });
});

describe('getMovie', () => {
  it('returns null for unknown ids', () => {
    assert.equal(getMovie('this-movie-does-not-exist'), null);
  });

  it('returns the registry entry for known ids', () => {
    for (const m of MOVIES) {
      assert.equal(getMovie(m.id), m);
    }
  });
});

describe('exported tag taxonomy', () => {
  it('re-exports the canonical ALL_TAGS / TAG_GROUPS from shows', () => {
    // Movies share the show taxonomy so the landing-page chip row
    // works across both grids without duplicate tag-group bookkeeping.
    assert.ok(ALL_TAGS instanceof Set);
    assert.ok(typeof TAG_GROUPS === 'object');
    assert.ok(Array.isArray(TAG_GROUPS.format));
  });
});
