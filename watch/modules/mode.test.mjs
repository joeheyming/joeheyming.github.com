/**
 * Tests for the /watch/ mode-detection module.
 *
 * `mode.js`'s side-effect block touches `document` and `window`, but
 * `detectMode()` is a pure function — we exercise it directly with
 * synthetic environment objects so every detection branch is covered
 * without spinning a JSDOM. The side-effect block is bypassed because
 * `typeof document === 'undefined'` in node.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { detectMode } = await import('./mode.js');

describe('detectMode', () => {
  it('defaults to web mode with no signals', () => {
    const r = detectMode({ search: '', userAgent: 'Mozilla/5.0', nativeFlag: false });
    assert.equal(r.isTv, false);
    assert.equal(r.source, null);
  });

  it('honours ?tv=1 query param', () => {
    const r = detectMode({ search: '?tv=1', userAgent: 'Mozilla/5.0', nativeFlag: false });
    assert.equal(r.isTv, true);
    assert.equal(r.source, 'queryParam');
  });

  it('?tv=0 stays web', () => {
    const r = detectMode({ search: '?tv=0', userAgent: 'Mozilla/5.0', nativeFlag: false });
    assert.equal(r.isTv, false);
  });

  it('honours window.__WATCH_TV__ native bridge flag', () => {
    const r = detectMode({ search: '', userAgent: 'Mozilla/5.0', nativeFlag: true });
    assert.equal(r.isTv, true);
    assert.equal(r.source, 'nativeBridge');
  });

  it('?tv=1 wins over native bridge (manual override is highest priority)', () => {
    const r = detectMode({ search: '?tv=1', userAgent: 'Mozilla/5.0', nativeFlag: true });
    assert.equal(r.source, 'queryParam');
  });

  it('detects Sony Bravia user agent', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH22 Build/STR1.190001.001) AppleWebKit/537.36 Chrome/148.0.7778.215';
    const r = detectMode({ search: '', userAgent: ua, nativeFlag: false });
    assert.equal(r.isTv, true);
    assert.equal(r.source, 'userAgent');
  });

  it('detects Tizen / Samsung TV user agent', () => {
    const ua =
      'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 SamsungBrowser/2.3 Chrome/76.0.3809.146';
    const r = detectMode({ search: '', userAgent: ua, nativeFlag: false });
    assert.equal(r.isTv, true);
    assert.equal(r.source, 'userAgent');
  });

  it('detects LG WebOS user agent', () => {
    const ua = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/87.0.4280.88';
    const r = detectMode({ search: '', userAgent: ua, nativeFlag: false });
    assert.equal(r.isTv, true);
    assert.equal(r.source, 'userAgent');
  });

  it('detects HbbTV user agent', () => {
    const ua = 'HbbTV/1.5.1 (; Sony; KDL-50W829B;;) Opera/9.80';
    const r = detectMode({ search: '', userAgent: ua, nativeFlag: false });
    assert.equal(r.isTv, true);
    assert.equal(r.source, 'userAgent');
  });

  it('does not false-positive on a regular Chrome desktop UA', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
    const r = detectMode({ search: '', userAgent: ua, nativeFlag: false });
    assert.equal(r.isTv, false);
  });

  it('does not false-positive on iPhone Safari', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
    const r = detectMode({ search: '', userAgent: ua, nativeFlag: false });
    assert.equal(r.isTv, false);
  });

  it('handles empty / undefined env fields without throwing', () => {
    const r = detectMode({ search: undefined, userAgent: undefined, nativeFlag: undefined });
    assert.equal(r.isTv, false);
    assert.equal(r.source, null);
  });

  it('preview catalog (?preview=1) uses the TV-app shell', () => {
    const r = detectMode({
      search: '?preview=1',
      userAgent: 'Mozilla/5.0',
      nativeFlag: false
    });
    assert.equal(r.isTv, true);
    assert.equal(r.source, 'previewCatalog');
  });

  it('Googlebot preview catalog uses the TV-app shell', () => {
    const r = detectMode({
      search: '',
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      nativeFlag: false
    });
    assert.equal(r.isTv, true);
    assert.equal(r.source, 'previewCatalog');
  });
});
