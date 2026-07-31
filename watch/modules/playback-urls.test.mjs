/**
 * Playback URL queue — alternate hosts / .ia.mp4 siblings for Watch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCdnFileUrls,
  buildDownloadUrl,
  buildPlaybackQueue,
  extractIaLocation,
  iaDerivativeFileName
} from './playback-urls.js';

describe('iaDerivativeFileName', () => {
  it('maps plain mp4 to .ia.mp4 sibling', () => {
    assert.equal(iaDerivativeFileName('S01/E01 Title.mp4'), 'S01/E01 Title.ia.mp4');
  });
  it('returns null for already-derivative or non-mp4', () => {
    assert.equal(iaDerivativeFileName('E01.ia.mp4'), null);
    assert.equal(iaDerivativeFileName('readme.txt'), null);
  });
});

describe('extractIaLocation', () => {
  it('collects unique servers + dir', () => {
    const loc = extractIaLocation({
      dir: '/21/items/demo',
      server: 'ia800308.us.archive.org',
      workable_servers: ['ia800308.us.archive.org', 'ia600308.us.archive.org'],
      d1: 'ia600308.us.archive.org',
      d2: 'https://ia800308.us.archive.org'
    });
    assert.deepEqual(loc, {
      dir: '/21/items/demo',
      servers: ['ia800308.us.archive.org', 'ia600308.us.archive.org']
    });
  });
  it('returns null without dir', () => {
    assert.equal(extractIaLocation({ server: 'ia800308.us.archive.org' }), null);
  });
});

describe('buildCdnFileUrls', () => {
  it('joins host + dir + encoded file', () => {
    const urls = buildCdnFileUrls(
      { dir: '/30/items/demo', servers: ['ia802304.us.archive.org'] },
      'The Simpsons S01, E01 - Title.mp4'
    );
    assert.equal(
      urls[0],
      'https://ia802304.us.archive.org/30/items/demo/The%20Simpsons%20S01%2C%20E01%20-%20Title.mp4'
    );
  });
});

describe('buildPlaybackQueue', () => {
  it('orders canonical → alternates → synthetic .ia → CDN mirrors', () => {
    const ep = {
      url: buildDownloadUrl('demo', 'E01.mp4'),
      file: 'E01.mp4',
      iaItem: 'demo',
      urlAlternates: [buildDownloadUrl('demo', 'E01.ia.mp4')]
    };
    const catalog = {
      iaLocations: {
        demo: {
          dir: '/1/items/demo',
          servers: ['ia800001.us.archive.org', 'ia600001.us.archive.org']
        }
      }
    };
    const q = buildPlaybackQueue(ep, catalog);
    assert.equal(q[0], ep.url);
    assert.equal(q[1], ep.urlAlternates[0]);
    // synthetic .ia is same as alternate — deduped
    assert.ok(q.includes('https://ia800001.us.archive.org/1/items/demo/E01.mp4'));
    assert.ok(q.includes('https://ia600001.us.archive.org/1/items/demo/E01.mp4'));
    assert.ok(q.includes('https://ia800001.us.archive.org/1/items/demo/E01.ia.mp4'));
    assert.equal(new Set(q).size, q.length);
  });

  it('returns empty for missing url', () => {
    assert.deepEqual(buildPlaybackQueue(/** @type {any} */ ({})), []);
  });
});
