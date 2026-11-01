// Smoke checks for the song-load failure the proxy pool must not cache
// as "this whole session is broken."

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLoadError } from '../stepmania/js/songLoader.js';
import { playableAudioMime } from '../stepmania/js/songProxyTransport.js';

describe('stepmania song proxy smoke', () => {
  it('turns an exhausted proxy chain into a song-level message', () => {
    const message = formatLoadError(new Error('All proxies failed after 1 attempts: HTTP 404'));
    assert.equal(
      message,
      'Could not download this song through any proxy. Try Retry or another song.'
    );
  });

  it('does not treat a proxy error page as audio', () => {
    const html = new TextEncoder().encode(
      `<!doctype html><title>not found</title>${' '.repeat(1200)}`
    );
    assert.equal(playableAudioMime(html), null);
  });
});
