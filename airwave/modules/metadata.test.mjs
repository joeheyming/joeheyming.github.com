/**
 * Tests for airwave/modules/metadata.js — pure URL/ID parsing only.
 * `fetchOEmbed` is skipped here because it touches the network; the
 * `_internals.normalizeOEmbed` helper is exercised separately.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { parseYouTubeId, parsePlaylistId, pickThumbnail, watchUrl, _internals } = await import(
  './metadata.js'
);

describe('parseYouTubeId', () => {
  it('returns the 11-char id for canonical watch URLs', () => {
    assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  });

  it('handles youtu.be short links', () => {
    assert.equal(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
  });

  it('handles embed/shorts/live/v paths', () => {
    assert.equal(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeId('https://www.youtube.com/v/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  });

  it('accepts a bare 11-char id', () => {
    assert.equal(parseYouTubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  });

  it('strips surrounding quotes', () => {
    assert.equal(parseYouTubeId('"dQw4w9WgXcQ"'), 'dQw4w9WgXcQ');
    assert.equal(parseYouTubeId("'dQw4w9WgXcQ'"), 'dQw4w9WgXcQ');
  });

  it('returns null for free-form text', () => {
    assert.equal(parseYouTubeId('how to bake bread'), null);
    assert.equal(parseYouTubeId(''), null);
    assert.equal(parseYouTubeId(null), null);
    assert.equal(parseYouTubeId(undefined), null);
  });

  it('does not match 10-char or 12-char strings', () => {
    assert.equal(parseYouTubeId('dQw4w9WgXc'), null);
    assert.equal(parseYouTubeId('dQw4w9WgXcQQ'), null);
  });

  it('handles a watch URL with leading/trailing whitespace', () => {
    assert.equal(parseYouTubeId('  https://youtu.be/dQw4w9WgXcQ  '), 'dQw4w9WgXcQ');
  });
});

describe('parsePlaylistId', () => {
  it('finds the list= query parameter', () => {
    assert.equal(
      parsePlaylistId('https://www.youtube.com/watch?v=abc&list=PLabcdefghij'),
      'PLabcdefghij'
    );
  });
  it('returns null when no playlist param exists', () => {
    assert.equal(parsePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
    assert.equal(parsePlaylistId('not a url'), null);
  });
});

describe('pickThumbnail', () => {
  it('returns hi-res primary and hq fallback', () => {
    const t = pickThumbnail('dQw4w9WgXcQ');
    assert.equal(t.best, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
    assert.equal(t.fallback, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });
});

describe('watchUrl', () => {
  it('builds the canonical watch URL', () => {
    assert.equal(watchUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

describe('normalizeOEmbed', () => {
  it('falls back to id-derived placeholders when fields are missing', () => {
    const norm = _internals.normalizeOEmbed('dQw4w9WgXcQ', {});
    assert.equal(norm.id, 'dQw4w9WgXcQ');
    assert.equal(norm.title, 'YouTube · dQw4w9WgXcQ');
    assert.equal(norm.author, '');
    assert.equal(norm.thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.equal(norm.thumbnailHi, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg');
    assert.equal(norm.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('keeps the oEmbed thumbnail_url when present', () => {
    const norm = _internals.normalizeOEmbed('abcdefghijk', {
      title: 'Hello',
      author_name: 'Joe',
      thumbnail_url: 'https://example.com/thumb.jpg'
    });
    assert.equal(norm.title, 'Hello');
    assert.equal(norm.author, 'Joe');
    assert.equal(norm.thumbnail, 'https://example.com/thumb.jpg');
  });
});
