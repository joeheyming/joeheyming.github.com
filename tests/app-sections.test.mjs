import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, 'shared/app-sections.js'), 'utf8');

function loadApi() {
  const sandbox = {};
  new Function('window', 'globalThis', SOURCE)(sandbox, sandbox);
  return sandbox.HeymingAppSections;
}

test('consoles carve out of games', () => {
  const api = loadApi();
  assert.equal(
    api.sectionForApp({ id: 'nes', category: 'game', subCategory: 'console' }).id,
    'consoles'
  );
  assert.equal(api.sectionForApp({ id: '2048', category: 'game' }).id, 'games');
});

test('play family lands in music, not tools', () => {
  const api = loadApi();
  assert.equal(api.sectionForApp({ id: 'play', category: 'utility' }).id, 'music');
  assert.equal(api.sectionForApp({ id: 'play-drums', category: 'entertainment' }).id, 'music');
  assert.equal(api.sectionForApp({ id: 'calculator', category: 'utility' }).id, 'tools');
});

test('tierFor reads appTier only', () => {
  const api = loadApi();
  assert.equal(api.tierFor({ id: 'doom', appTier: 'experience' }), 'experience');
  assert.equal(api.tierFor({ id: 'unknown' }), 'app');
});

test('groupApps first-match leaves nothing for later sections', () => {
  const api = loadApi();
  const { buckets, unsectioned } = api.groupApps([
    { id: 'nes', category: 'game', subCategory: 'console' },
    { id: '2048', category: 'game' },
    { id: 'mystery', category: 'weird' }
  ]);
  assert.equal(buckets.consoles.length, 1);
  assert.equal(buckets.games.length, 1);
  assert.equal(unsectioned.length, 1);
});
