import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadAnalytics() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/'
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
  assert.equal(suppress('resource_error', 'Failed to load VIDEO: unknown', ''), false);
  assert.equal(
    suppress(
      'resource_error',
      'Failed to load VIDEO: joeheyming.github.io/bg.webm',
      'https://joeheyming.github.io/stepmania/bg.webm'
    ),
    false
  );
  dom.window.close();
});
