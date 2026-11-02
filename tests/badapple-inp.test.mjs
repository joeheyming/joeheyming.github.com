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
      <div id="frame-display">
        <table id="frame-html" hidden><colgroup></colgroup><tbody></tbody></table>
        <div id="frame-css" hidden></div>
      </div>
      <div id="renderer-controls">
        <button data-renderer="html">HTML</button>
        <button data-renderer="css">CSS</button>
        <button data-renderer="canvas">Canvas</button>
      </div>
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

test('Bad Apple expands a run-length grid and leaves plain text alone', () => {
  const { dom } = loadBadApple();
  const decode = dom.window.decodeBadAppleFrame;
  const packed = Array.from({ length: 216 }, () => '470_3@7,').join('\n');
  const lines = decode(packed).split('\n');
  assert.equal(lines.length, 216);
  assert.equal(lines[0], `${'_'.repeat(470)}@@@${','.repeat(7)}`);
  assert.equal(decode('frame'), 'frame');
  dom.window.close();
});

test('Bad Apple draws the same grid as HTML cells or CSS gradients', () => {
  const { dom } = loadBadApple();
  const { window } = dom;
  const { document } = window;
  const packed = Array.from({ length: 216 }, (_, row) => (row === 0 ? '10@470_' : '480_')).join(
    '\n'
  );
  const text = window.decodeBadAppleFrame(packed);

  assert.equal(window.setRenderer('html'), 'html');
  window.paintFrame(text);
  const cells = document.querySelectorAll('#frame-html tbody tr:first-child td');
  assert.equal(cells.length, 2);
  assert.equal(cells[0].getAttribute('bgcolor'), '#ffffff');
  assert.equal(cells[0].getAttribute('colspan'), '10');
  assert.equal(cells[1].getAttribute('bgcolor'), '#000000');
  assert.equal(cells[1].getAttribute('colspan'), '470');
  assert.equal(document.querySelectorAll('#frame-html col').length, 480);
  assert.equal(document.getElementById('frame-html').hidden, false);
  assert.equal(document.getElementById('frame-css').hidden, true);

  assert.equal(window.setRenderer('css'), 'css');
  const row = document.querySelector('#frame-css > div');
  assert.match(row.style.backgroundImage, /linear-gradient\(90deg,/);
  assert.match(row.style.backgroundImage, /#ffffff 0%/);
  assert.equal(document.querySelectorAll('#frame-css > div').length, 216);
  assert.equal(document.getElementById('frame-css').hidden, false);
  assert.equal(document.getElementById('frame-html').hidden, true);
  assert.equal(
    document.querySelector('#renderer-controls button[data-renderer="canvas"]').disabled,
    true
  );

  dom.window.close();
});
