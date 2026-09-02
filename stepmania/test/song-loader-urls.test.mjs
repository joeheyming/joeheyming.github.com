import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveZeniusUrl, formatLoadError } from '../js/songLoader.js';

describe('resolveZeniusUrl', () => {
  it('resolves root-relative hrefs against zenius-i-vanisher.com', () => {
    assert.equal(
      resolveZeniusUrl('/v5.2/download.php?file=song.ogg'),
      'https://zenius-i-vanisher.com/v5.2/download.php?file=song.ogg'
    );
  });

  it('resolves page-relative hrefs against /v5.2/', () => {
    assert.equal(
      resolveZeniusUrl('download.php?type=ogg&simfileid=1'),
      'https://zenius-i-vanisher.com/v5.2/download.php?type=ogg&simfileid=1'
    );
  });

  it('keeps already-absolute https URLs', () => {
    const href = 'https://zenius-i-vanisher.com/v5.2/files/track.mp3';
    assert.equal(resolveZeniusUrl(href), href);
  });

  it('resolves protocol-relative URLs without concatenating the host twice', () => {
    assert.equal(
      resolveZeniusUrl('//zenius-i-vanisher.com/files/a.ogg'),
      'https://zenius-i-vanisher.com/files/a.ogg'
    );
  });

  it('decodes HTML &amp; in query strings', () => {
    assert.equal(
      resolveZeniusUrl('/v5.2/download.php?type=mp3&amp;simfileid=9'),
      'https://zenius-i-vanisher.com/v5.2/download.php?type=mp3&simfileid=9'
    );
  });

  it('rejects non-http(s) protocols', () => {
    assert.equal(resolveZeniusUrl('javascript:alert(1)'), null);
    assert.equal(resolveZeniusUrl('ftp://zenius-i-vanisher.com/x.mp3'), null);
  });

  it('returns null for empty or non-string input', () => {
    assert.equal(resolveZeniusUrl(''), null);
    assert.equal(resolveZeniusUrl(null), null);
  });
});

describe('formatLoadError', () => {
  it('rewrites protocol proxy errors', () => {
    assert.match(formatLoadError(new Error('Error protocol')), /bad file URL/i);
  });

  it('rewrites corsproxy paywall bodies', () => {
    assert.match(
      formatLoadError(new Error('This content type is not allowed on the free plan')),
      /proxy blocked/i
    );
  });

  it('rewrites all-proxies-failed chains', () => {
    assert.match(
      formatLoadError(new Error('All proxies failed after 2 attempts: timeout')),
      /any proxy/i
    );
  });

  it('uses a fallback when the error is empty', () => {
    assert.match(formatLoadError(null), /could not download/i);
  });
});
