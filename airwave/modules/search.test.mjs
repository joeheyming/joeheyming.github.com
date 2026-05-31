/**
 * Tests for airwave/modules/search.js — the pure HTML/JSON parsers and
 * the duration parser. Network providers are exercised via the public
 * `searchYouTube` only when a small mocked proxy is plugged in; we
 * don't reach the real internet.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

const { parseYouTubeSearchHtml, parseYtInitialData, searchYouTube, _internals } = await import(
  './search.js'
);

describe('parseDurationLabel', () => {
  it('parses M:SS', () => {
    assert.equal(_internals.parseDurationLabel('3:42'), 222);
  });
  it('parses H:MM:SS', () => {
    assert.equal(_internals.parseDurationLabel('1:02:03'), 3723);
  });
  it('returns null on garbage', () => {
    assert.equal(_internals.parseDurationLabel(''), null);
    assert.equal(_internals.parseDurationLabel('LIVE'), null);
    assert.equal(_internals.parseDurationLabel(null), null);
  });
});

describe('parseYtInitialData', () => {
  it('returns video records from a normal videoRenderer tree', () => {
    const fixture = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId: 'dQw4w9WgXcQ',
                          title: { runs: [{ text: 'Never Gonna Give You Up' }] },
                          ownerText: { runs: [{ text: 'Rick Astley' }] },
                          thumbnail: {
                            thumbnails: [
                              { url: 'https://x/sm.jpg', width: 120, height: 90 },
                              { url: 'https://x/lg.jpg', width: 480, height: 360 }
                            ]
                          },
                          lengthText: { simpleText: '3:32' }
                        }
                      },
                      {
                        // Non-video items should be skipped.
                        channelRenderer: { channelId: 'UC123' }
                      },
                      {
                        videoRenderer: {
                          videoId: 'aaaaaaaaaaa',
                          title: { simpleText: 'Plain title' },
                          longBylineText: { runs: [{ text: 'Author' }] },
                          thumbnail: { thumbnails: [] }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    };

    const results = parseYtInitialData(fixture);
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'dQw4w9WgXcQ');
    assert.equal(results[0].title, 'Never Gonna Give You Up');
    assert.equal(results[0].author, 'Rick Astley');
    assert.equal(results[0].duration, 212);
    assert.equal(results[0].thumbnail, 'https://x/lg.jpg'); // largest

    assert.equal(results[1].id, 'aaaaaaaaaaa');
    assert.equal(results[1].title, 'Plain title');
    assert.equal(results[1].author, 'Author');
    // No thumbnails -> ytimg fallback.
    assert.equal(results[1].thumbnail, 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  });

  it('returns [] on empty/unknown shape', () => {
    assert.deepEqual(parseYtInitialData({}), []);
    assert.deepEqual(parseYtInitialData(null), []);
  });
});

describe('parseYouTubeSearchHtml', () => {
  function wrap(json) {
    return `<html><body><script>var ytInitialData = ${json};</script></body></html>`;
  }

  it('extracts ytInitialData from `var ytInitialData = ...;`', () => {
    const fixture = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId: 'aaaaaaaaaaa',
                          title: { simpleText: 'X' },
                          ownerText: { runs: [{ text: 'Y' }] },
                          thumbnail: {
                            thumbnails: [{ url: 'https://x/t.jpg', width: 1, height: 1 }]
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    };
    const html = wrap(JSON.stringify(fixture));
    const results = parseYouTubeSearchHtml(html);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'aaaaaaaaaaa');
  });

  it('returns [] when the marker is missing', () => {
    assert.deepEqual(parseYouTubeSearchHtml('<html>no marker</html>'), []);
    assert.deepEqual(parseYouTubeSearchHtml(''), []);
    assert.deepEqual(parseYouTubeSearchHtml(null), []);
  });
});

describe('buildProviderSequence', () => {
  beforeEach(() => {
    _internals.forgetWinner();
  });

  it('starts with youtube scrape when no cached winner', () => {
    const seq = _internals.buildProviderSequence();
    assert.equal(seq[0].kind, 'youtube');
    // Then invidious instances, then piped instances.
    assert.ok(seq.some((s) => s.kind === 'invidious'));
    assert.ok(seq.some((s) => s.kind === 'piped'));
  });

  it('hoists cached winner to the front', () => {
    _internals.rememberWinner({
      kind: 'invidious',
      instance: _internals.INVIDIOUS_INSTANCES[0]
    });
    const seq = _internals.buildProviderSequence();
    assert.equal(seq[0].kind, 'invidious');
    assert.equal(seq[0].instance, _internals.INVIDIOUS_INSTANCES[0]);
    // No duplicate later in the sequence.
    const dupes = seq.filter(
      (s) => s.kind === 'invidious' && s.instance === _internals.INVIDIOUS_INSTANCES[0]
    );
    assert.equal(dupes.length, 1);
  });
});

describe('searchYouTube (with mocked proxy)', () => {
  beforeEach(() => {
    _internals.forgetWinner();
  });

  it('returns parsed results when the proxy succeeds (youtube scrape path)', async () => {
    const html = `<script>var ytInitialData = ${JSON.stringify({
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  itemSectionRenderer: {
                    contents: [
                      {
                        videoRenderer: {
                          videoId: 'dQw4w9WgXcQ',
                          title: { simpleText: 'Hit' },
                          ownerText: { runs: [{ text: 'A' }] },
                          thumbnail: { thumbnails: [] },
                          lengthText: { simpleText: '1:00' }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    })};</script>`;

    const proxy = {
      async fetchWithProxy(url) {
        assert.match(url, /youtube\.com\/results/);
        return html;
      }
    };

    const results = await searchYouTube('hit', { proxy });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'dQw4w9WgXcQ');
    assert.equal(results[0].title, 'Hit');
    assert.equal(results[0].duration, 60);
  });

  it('throws ALL_PROVIDERS_FAILED when every step fails', async () => {
    const proxy = {
      async fetchWithProxy() {
        throw new Error('proxy down');
      }
    };

    // Stub global fetch so invidious/piped attempts also fail without
    // touching the network.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network down');
    };

    try {
      await assert.rejects(
        searchYouTube('hit', { proxy }),
        (err) => err && err.code === 'ALL_PROVIDERS_FAILED'
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns [] for empty/whitespace queries without calling providers', async () => {
    const proxy = {
      async fetchWithProxy() {
        throw new Error('should not be called');
      }
    };
    assert.deepEqual(await searchYouTube('   ', { proxy }), []);
    assert.deepEqual(await searchYouTube('', { proxy }), []);
  });
});
