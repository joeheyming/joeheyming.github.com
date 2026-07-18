import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadBadApple() {
  const source = readFileSync(path.join(ROOT, 'badapple/index.html'), 'utf8');
  const script = source.match(/<script>\s*(const audio =[\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'Bad Apple playback script should be present');

  const dom = new JSDOM(
    `<!doctype html>
      <button id="playBtn">▶ Play</button>
      <audio id="audio"></audio>
      <div id="progress-bar"><div id="progress-fill"></div></div>
      <span id="time-display"></span>
      <div id="frame-display"></div>
      <div id="speed-controls"></div>
      <input id="volume-slider" value="1">
      <share-button></share-button>`,
    { runScripts: 'outside-only', url: 'https://joeheyming.github.io/badapple/' }
  );

  const yieldResolvers = [];
  const frameRequests = [];
  const { window } = dom;
  const audio = window.document.getElementById('audio');

  window.yieldToMain = () => new Promise((resolve) => yieldResolvers.push(resolve));
  window.fetch = (url) =>
    new Promise((resolve) => {
      frameRequests.push({ url, resolve });
    });
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  audio.play = () => Promise.resolve();
  audio.pause = () => {};
  Object.defineProperty(audio, 'duration', { configurable: true, value: 200 });

  window.eval(script);

  return { dom, frameRequests, yieldResolvers };
}

test('Bad Apple paints playback and seek state before bounded preloading', async () => {
  const { dom, frameRequests, yieldResolvers } = loadBadApple();
  const { window } = dom;
  const { document } = window;
  const audio = document.getElementById('audio');
  const playBtn = document.getElementById('playBtn');
  const progressBar = document.getElementById('progress-bar');

  const playPromise = window.play();
  assert.equal(playBtn.textContent, '⏸ Pause');
  assert.equal(playBtn.disabled, true);
  assert.equal(frameRequests.length, 0);

  yieldResolvers.shift()();
  await playPromise;
  assert.equal(playBtn.disabled, false);
  assert.equal(frameRequests.length, 5, 'only one preload batch should be active');

  window.preloadFrames(1, 60);
  window.preloadFrames(1, 60);
  assert.equal(frameRequests.length, 5, 'overlapping preloads should share the active worker');

  progressBar.getBoundingClientRect = () => ({ left: 0, width: 100 });
  const staleSeekPromise = window.seek({ clientX: 50 });
  const latestSeekPromise = window.seek({ clientX: 75 });
  assert.equal(audio.currentTime, 150);
  assert.equal(document.getElementById('progress-fill').style.width, '75%');
  assert.equal(document.getElementById('time-display').textContent, '2:30 / 3:20');
  assert.equal(frameRequests.length, 5);

  yieldResolvers.shift()();
  yieldResolvers.shift()();
  await Promise.all([staleSeekPromise, latestSeekPromise]);
  assert.equal(frameRequests.length, 5, 'seek should not create a concurrent preload batch');

  frameRequests.slice(0, 5).forEach(({ resolve }) => {
    resolve({ ok: true, text: async () => '<pre>frame</pre>' });
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    frameRequests.slice(5, 10).map(({ url }) => url),
    ['frame/4471.html', 'frame/4472.html', 'frame/4473.html', 'frame/4474.html', 'frame/4475.html'],
    'the latest seek range should replace stale queued preloads'
  );

  dom.window.close();
});
