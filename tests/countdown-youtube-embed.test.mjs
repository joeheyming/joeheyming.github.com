import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildYouTubeEmbedUrl,
  isLeanbackBrowser,
  youtubeWatchUrl
} from '../countdown/components/youtube-embed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAVIA_UA =
  'Mozilla/5.0 (Linux; Android 9; BRAVIA 4K GB) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.116 Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test('embed url carries origin so WebViews that omit Referer can still identify the page', () => {
  const url = new URL(
    buildYouTubeEmbedUrl('3Uo0JAUWijM', {
      autoplay: true,
      start: 13,
      origin: 'https://joeheyming.github.io'
    })
  );
  assert.equal(url.hostname, 'www.youtube.com');
  assert.equal(url.pathname, '/embed/3Uo0JAUWijM');
  assert.equal(url.searchParams.get('origin'), 'https://joeheyming.github.io');
  assert.equal(url.searchParams.get('enablejsapi'), '1');
  assert.equal(url.searchParams.get('autoplay'), '1');
  assert.equal(url.searchParams.get('playsinline'), '1');
  assert.equal(url.searchParams.get('start'), '13');
  assert.equal(url.searchParams.get('rel'), '0');
});

test('watch url is the link a TV browser can hand to the YouTube app', () => {
  assert.equal(youtubeWatchUrl('3Uo0JAUWijM'), 'https://www.youtube.com/watch?v=3Uo0JAUWijM');
});

test('leanback detection matches Bravia and ignores a desktop browser', () => {
  assert.equal(isLeanbackBrowser(BRAVIA_UA), true);
  assert.equal(isLeanbackBrowser('SonyDTV/1.0'), true);
  assert.equal(isLeanbackBrowser('Mozilla/5.0 (Linux; Android TV)'), true);
  assert.equal(isLeanbackBrowser(DESKTOP_UA), false);
  assert.equal(isLeanbackBrowser(''), false);
});

test('player omits credentialless unless the page is isolated, and surfaces embed errors', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://joeheyming.github.io/countdown/',
    pretendToBeVisual: true
  });
  let userAgent = DESKTOP_UA;
  Object.defineProperty(dom.window.navigator, 'userAgent', {
    configurable: true,
    get: () => userAgent
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.customElements = dom.window.customElements;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.crossOriginIsolated = false;

  const playerUrl = pathToFileURL(path.join(ROOT, 'countdown/components/youtube-player.js')).href;
  await import(playerUrl);

  const player = dom.window.document.createElement('youtube-player');
  player.id = 'countdownPlayer';
  dom.window.document.body.appendChild(player);
  player.play('3Uo0JAUWijM', true);

  const iframe = player.querySelector('iframe');
  assert.ok(iframe);
  assert.equal(iframe.hasAttribute('credentialless'), false);
  assert.equal(iframe.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
  assert.equal(new URL(iframe.src).searchParams.get('origin'), 'https://joeheyming.github.io');
  assert.equal(player.querySelector('[data-embed-controls]').hidden, true);

  globalThis.crossOriginIsolated = true;
  player.play('3Uo0JAUWijM', true);
  assert.equal(player.querySelector('iframe').hasAttribute('credentialless'), true);
  globalThis.crossOriginIsolated = false;

  const frame = player.querySelector('iframe');
  dom.window.dispatchEvent(
    new dom.window.MessageEvent('message', {
      data: JSON.stringify({ event: 'onError', info: 153 }),
      origin: 'https://www.youtube.com',
      source: frame.contentWindow
    })
  );

  const watch = player.querySelector('[data-embed-watch]');
  assert.equal(watch.hidden, false);
  assert.equal(watch.getAttribute('href'), 'https://www.youtube.com/watch?v=3Uo0JAUWijM');
  assert.equal(player.querySelector('[data-embed-controls]').hidden, false);
  assert.match(player.querySelector('[data-embed-message]').textContent, /error 153/);

  userAgent = BRAVIA_UA;
  player.play('9jK-NcRmVcw', true);
  const playButton = player.querySelector('[data-embed-play]');
  assert.equal(playButton.hidden, false);
  assert.equal(player.querySelector('[data-embed-controls]').hidden, false);
  const tvWatch = player.querySelector('[data-embed-watch]');
  assert.equal(tvWatch.getAttribute('target'), null);
  assert.equal(tvWatch.getAttribute('href'), 'https://www.youtube.com/watch?v=9jK-NcRmVcw');
});
