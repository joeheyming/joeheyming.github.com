import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadAnalytics(url = 'http://localhost/') {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url
  });
  dom.window.eval(readFileSync(path.join(ROOT, 'analytics.js'), 'utf8'));
  return dom;
}

test('suppresses residual Doom IDBFS InvalidStateError, not WASM abort', () => {
  const dom = loadAnalytics();
  const suppress = dom.window.__analyticsShouldSuppressError;

  assert.equal(
    suppress(
      'javascript_error',
      "Uncaught InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing."
    ),
    true
  );
  assert.equal(
    suppress('javascript_error', 'InvalidStateError: The transaction has finished.'),
    true
  );
  assert.equal(
    suppress('javascript_error', 'RuntimeError: Aborted(). Build with -sASSERTIONS for more info.'),
    false
  );
  assert.equal(
    suppress('javascript_error', 'InvalidStateError: The object is in an invalid state.'),
    false
  );
  assert.equal(
    suppress(
      'unhandled_promise_rejection',
      "NotAllowedError: Failed to execute 'requestPointerLock' on 'Element': The user has exited the lock."
    ),
    true
  );
  assert.equal(
    suppress(
      'javascript_error',
      "TypeError: canvas.requestPointerLock is not a function. (In 'canvas.requestPointerLock()')"
    ),
    false
  );
  assert.equal(
    suppress(
      'unhandled_promise_rejection',
      'SecurityError: The root document of this element is not valid.'
    ),
    true
  );
  assert.equal(
    suppress(
      'javascript_error',
      'WrongDocumentError: The root document of this element is not valid.'
    ),
    true
  );
  dom.window.close();
});

function errorEvents(dom) {
  return Array.from(dom.window.dataLayer || [])
    .map((args) => Array.from(args))
    .filter((args) => args[0] === 'event' && args[1] === 'error_occurred');
}

function flushTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('suppresses playback-probe resource errors until the queue gives up', async () => {
  const dom = loadAnalytics('https://example.com/watch/');
  const suppress = dom.window.__analyticsShouldSuppressError;
  const resource = 'https://ia801604.us/download/show/episode.mp4';
  const message = 'Failed to load VIDEO: ia801604.us/episode.mp4';

  assert.equal(suppress('resource_error', message, resource, true), true);
  assert.equal(suppress('resource_error', message, resource, false), false);
  assert.equal(suppress('javascript_error', message, resource, true), false);

  dom.window.console.warn = () => {};
  dom.window.console.error = () => {};
  const video = dom.window.document.createElement('video');
  video.dataset.playbackProbe = '1';
  const source = dom.window.document.createElement('source');
  source.src = resource;
  video.appendChild(source);
  dom.window.document.body.appendChild(video);
  // Media errors do not bubble. Capture on window still sees them.
  source.dispatchEvent(new dom.window.Event('error'));
  delete video.dataset.playbackProbe;
  source.dispatchEvent(new dom.window.Event('error'));
  await flushTick();

  assert.equal(errorEvents(dom).length, 1);
  dom.window.close();
});

test('drops resource errors once the page is going away', async () => {
  const visible = loadAnalytics('https://example.com/');
  visible.window.console.warn = () => {};
  visible.window.console.error = () => {};
  const staying = visible.window.document.createElement('script');
  staying.src = 'https://joeheyming.github.io/nav.js';
  visible.window.document.body.appendChild(staying);
  staying.dispatchEvent(new visible.window.Event('error'));
  await flushTick();
  assert.equal(errorEvents(visible).length, 1);
  visible.window.close();

  const leaving = loadAnalytics('https://example.com/');
  leaving.window.console.warn = () => {};
  leaving.window.console.error = () => {};
  const aborted = leaving.window.document.createElement('script');
  aborted.src = 'https://joeheyming.github.io/nav.js';
  leaving.window.document.body.appendChild(aborted);
  aborted.dispatchEvent(new leaving.window.Event('error'));
  leaving.window.dispatchEvent(new leaving.window.Event('pagehide'));
  await flushTick();
  assert.equal(errorEvents(leaving).length, 0);
  leaving.window.close();
});

test('a shadow-tree image error uses the image url, not the host', async () => {
  const dom = loadAnalytics('https://example.com/emulator/nes/');
  dom.window.console.warn = () => {};
  dom.window.console.error = () => {};
  const host = dom.window.document.createElement('rom-browser');
  const shadow = host.attachShadow({ mode: 'open' });
  const missed = dom.window.document.createElement('img');
  missed.src =
    'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Metroid.png';
  shadow.appendChild(missed);
  dom.window.document.body.appendChild(host);
  missed.dispatchEvent(new dom.window.Event('error', { composed: true }));
  await flushTick();
  assert.equal(errorEvents(dom).length, 0);

  const broken = dom.window.document.createElement('img');
  broken.src = 'https://joeheyming.github.io/emulator/missing-box.png';
  shadow.appendChild(broken);
  broken.dispatchEvent(new dom.window.Event('error', { composed: true }));
  await flushTick();
  const events = errorEvents(dom);
  assert.equal(events.length, 1);
  assert.match(events[0][2].event_label, /IMG: joeheyming.github.io\/missing-box\.png/);
  dom.window.close();
});

test('error events include the registered error_message dimension', () => {
  const dom = loadAnalytics('https://example.com/');
  dom.window.console.error = () => {};
  dom.window.console.warn = () => {};

  dom.window.trackError({
    type: 'javascript_error',
    message: 'The engine stopped unexpectedly',
    stack: 'stack'
  });
  dom.window.trackError({
    type: 'resource_error',
    message: 'Failed to load SCRIPT: cdn.example.com/app.js',
    resource: 'https://cdn.example.com/app.js'
  });

  const events = Array.from(dom.window.dataLayer)
    .map((args) => Array.from(args))
    .filter((args) => args[0] === 'event');
  const exception = events.find((args) => args[1] === 'exception');
  const resourceError = events.find((args) => args[1] === 'error_occurred');

  assert.equal(exception[2].error_message, 'The engine stopped unexpectedly');
  assert.equal(exception[2].event_label, 'javascript_error - The engine stopped unexpectedly');
  assert.equal(resourceError[2].error_message, 'Failed to load SCRIPT: cdn.example.com/app.js');
  assert.equal(
    resourceError[2].event_label,
    'resource_error: Failed to load SCRIPT: cdn.example.com/app.js'
  );
  dom.window.close();
});

test('suppresses Watch archive.org / TVMaze media resource errors, not StepMania empty src', () => {
  const dom = loadAnalytics();
  const suppress = dom.window.__analyticsShouldSuppressError;

  assert.equal(
    suppress(
      'resource_error',
      'Failed to load VIDEO: ia601000.us.archive.org/Foo.mp4',
      'https://ia601000.us.archive.org/0/items/foo/Foo.mp4'
    ),
    true
  );
  assert.equal(
    suppress(
      'resource_error',
      'Failed to load VIDEO: archive.org/download',
      'https://archive.org/download/foo/Foo.ia.mp4'
    ),
    true
  );
  assert.equal(
    suppress(
      'resource_error',
      'Failed to load IMG: static.tvmaze.com/poster.jpg',
      'https://static.tvmaze.com/uploads/images/original_untouched/1/1.jpg'
    ),
    true
  );
  assert.equal(
    suppress(
      'resource_error',
      'Failed to load IMG: thumbnails.libretro.com/Named_Boxarts/Metroid.png',
      'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Metroid.png'
    ),
    true
  );
  assert.equal(
    suppress(
      'resource_error',
      'Failed to load IMG: cdn.thumbnails.libretro.com/Named_Boxarts/Metroid.png',
      'https://cdn.thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/Metroid.png'
    ),
    true
  );
  assert.equal(
    suppress(
      'javascript_error',
      'thumbnails.libretro.com failed',
      'https://thumbnails.libretro.com/Named_Boxarts/Metroid.png'
    ),
    false
  );
  assert.equal(suppress('resource_error', 'Failed to load VIDEO: unknown', ''), false);
  assert.equal(
    suppress(
      'resource_error',
      'Failed to load VIDEO: joeheyming.github.io/bg.webm',
      'https://joeheyming.github.io/stepmania/bg.webm'
    ),
    false
  );
  assert.equal(
    suppress(
      'resource_error',
      'Failed to load IMG: joeheyming.github.io/box.png',
      'https://joeheyming.github.io/emulator/box.png'
    ),
    false
  );
  dom.window.close();
});
