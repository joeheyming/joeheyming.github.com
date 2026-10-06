import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveZeniusUrl,
  formatLoadError,
  chooseAudioUrl,
  fetchZeniusSimfile
} from '../js/songLoader.js';
import { sniffAudioMime } from '../js/songProxyTransport.js';

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

describe('chooseAudioUrl', () => {
  const refuseOgg = (type) => (type.startsWith('audio/ogg') ? '' : 'probably');

  it('prefers ogg when the browser can play it', () => {
    const chosen = chooseAudioUrl('song.ogg', 'song.mp3', () => 'probably');
    assert.equal(chosen.url, 'song.ogg');
    assert.equal(chosen.alternateUrl, 'song.mp3');
  });

  it('prefers mp3 when ogg is unsupported', () => {
    const chosen = chooseAudioUrl('song.ogg', 'song.mp3', refuseOgg);
    assert.equal(chosen.url, 'song.mp3');
    assert.equal(chosen.alternateUrl, 'song.ogg');
  });

  it('keeps the only available file', () => {
    assert.equal(chooseAudioUrl('song.ogg', null, refuseOgg).url, 'song.ogg');
    assert.equal(chooseAudioUrl(null, 'song.mp3', () => '').url, 'song.mp3');
  });
});

describe('fetchZeniusSimfile', () => {
  it('loads modern Zenius pages that only provide an SSC chart', async () => {
    const fetchedUrls = [];
    const transport = {
      async fetchText(url) {
        fetchedUrls.push(url);
        if (url.includes('viewsimfile.php')) {
          return `
            <h1>Modern Song</h1>
            <a href="/simfiles/Modern%20Song/Modern%20Song.ssc">SSC</a>
            <a href="/simfiles/Modern%20Song/Modern%20Song.ogg">OGG</a>
          `;
        }
        return '#TITLE:Modern Song;\\n#NOTEDATA:;';
      },
      async fetchBinary() {
        throw new Error('not used');
      }
    };

    const result = await fetchZeniusSimfile('70606', transport);

    assert.equal(result.title, 'Modern Song');
    assert.match(result.audioUrl, /Modern%20Song\.ogg$/);
    assert.equal(result.simfileText, '#TITLE:Modern Song;\\n#NOTEDATA:;');
    assert.match(fetchedUrls[1], /Modern%20Song\.ssc$/);
  });
});

describe('sniffAudioMime', () => {
  it('recognizes ogg, id3, and wav headers', () => {
    assert.equal(sniffAudioMime(Uint8Array.from([0x4f, 0x67, 0x67, 0x53])), 'audio/ogg');
    assert.equal(sniffAudioMime(Uint8Array.from([0x49, 0x44, 0x33, 0x04])), 'audio/mpeg');
    const wav = new Uint8Array(12);
    wav.set(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]));
    assert.equal(sniffAudioMime(wav), 'audio/wav');
  });

  it('rejects an html error page', () => {
    assert.equal(sniffAudioMime(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c])), null);
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
