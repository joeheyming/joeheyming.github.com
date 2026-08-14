/**
 * Tests for the fictional SEO/OG preview catalog.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ALL_TAGS } from './shows.js';
import { getPreviewCatalog, getPreviewHome, shouldUsePreviewCatalog } from './preview-catalog.js';

describe('shouldUsePreviewCatalog', () => {
  it('matches Googlebot user agents', () => {
    assert.equal(
      shouldUsePreviewCatalog({
        userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        search: ''
      }),
      true
    );
  });

  it('matches Google-InspectionTool (Search Console live test)', () => {
    assert.equal(
      shouldUsePreviewCatalog({
        userAgent: 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)',
        search: ''
      }),
      true
    );
  });

  it('matches ?preview=1 for OG screenshot generation', () => {
    assert.equal(
      shouldUsePreviewCatalog({
        userAgent: 'Mozilla/5.0',
        search: '?preview=1'
      }),
      true
    );
  });

  it('matches bingbot user agents', () => {
    assert.equal(
      shouldUsePreviewCatalog({
        userAgent: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
        search: ''
      }),
      true
    );
  });

  it('matches DuckDuckBot user agents', () => {
    assert.equal(
      shouldUsePreviewCatalog({
        userAgent: 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
        search: ''
      }),
      true
    );
  });

  it('does not match ordinary browsers', () => {
    assert.equal(
      shouldUsePreviewCatalog({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        search: ''
      }),
      false
    );
  });
});

describe('getPreviewHome', () => {
  it('returns a hero billboard and horizontal rails', () => {
    const home = getPreviewHome();
    assert.ok(home.hero.headline);
    assert.ok(home.hero.cta);
    assert.equal(home.rails.length, 2);
    assert.equal(home.rails[0].id, 'popular-genres');
    assert.equal(home.rails[1].id, 'decades');
    assert.ok(home.rails[0].items.length >= 6);
    assert.ok(home.rails[1].items.length >= 4);
    assert.ok(home.rails[0].items.some((t) => t.id === 'genre-animation'));
  });
});

describe('getPreviewCatalog', () => {
  it('returns show tiles with no movies and valid tags', () => {
    const { shows, movies, byId } = getPreviewCatalog();
    assert.ok(shows.length >= 8);
    assert.equal(movies.length, 0);
    assert.equal(byId.get('genre-animation')?.name, 'Animation');
    assert.equal(byId.get('genre-anthology')?.emoji, '🎭');
    for (const show of shows) {
      assert.equal(show.tvmazeId, 0);
      assert.equal(show.parser, null);
      for (const tag of show.tags) {
        assert.ok(ALL_TAGS.has(tag), `unexpected tag "${tag}" on ${show.id}`);
      }
    }
  });
});
