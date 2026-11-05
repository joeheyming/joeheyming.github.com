// A stuck COI worker clears on a normal refresh. The page should take that
// reload itself, once, and only then show the error card.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const coi = readFileSync(path.join(ROOT, 'doom/coi.js'), 'utf8');
const worker = readFileSync(path.join(ROOT, 'coi-serviceworker.js'), 'utf8');

test('Doom reloads once when isolation is stuck, then shows the card', () => {
  const timeout = coi.slice(coi.indexOf('if (elapsed() >= budget)'));
  const recoverAt = timeout.indexOf('reloadOnceForStuckWorker()');
  const errorAt = timeout.indexOf('showCoiError()');
  assert.ok(
    recoverAt >= 0 && errorAt > recoverAt,
    'recovery reload must run before the error card'
  );
  assert.match(coi, /coi-recover-reload/);
  assert.match(coi, /sessionStorage\.removeItem\(ATTEMPTS_KEY\)/);
  assert.match(coi, /window\.location\.reload\(\)/);
});

test('the service worker only bypass-reloads once, then recovers instead of stopping', () => {
  assert.match(worker, /attempt === 0 &&/);
  const giveUp = worker.slice(worker.indexOf('attempt >= MAX_ATTEMPTS'));
  const recoverAt = giveUp.indexOf('coi-recover-reload');
  const stopAt = giveUp.indexOf("classList.remove('coi-pending')");
  assert.ok(recoverAt >= 0 && stopAt > recoverAt, 'give-up must reload once before it stops');
  assert.match(giveUp, /window\.location\.reload\(\)/);
});
