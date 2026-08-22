import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, 'shared/registry-path.js'), 'utf8');

const FIXTURE = [
  { id: 'home', path: './' },
  { id: 'doom', path: './doom/' },
  { id: 'doom-mods', path: './doom/?manual=browse' },
  { id: 'play', path: './play/' },
  { id: 'play-drums', path: './play/drums/' },
  { id: 'nes', path: './emulator/nes/' }
];

function loadApi() {
  const sandbox = {};
  new Function('window', 'globalThis', SOURCE)(sandbox, sandbox);
  return sandbox.HeymingRegistryPath;
}

test('normalizePathname strips index.html and trailing slashes', () => {
  const api = loadApi();
  assert.equal(api.normalizePathname('/doom/index.html'), '/doom');
  assert.equal(api.normalizePathname('/doom/'), '/doom');
  assert.equal(api.normalizePathname('/'), '/');
  assert.equal(api.normalizePathname(''), '/');
});

test('query-specific paths beat the base app', () => {
  const api = loadApi();
  assert.equal(
    api.resolveAppIdFromLocation(FIXTURE, {
      pathname: '/doom/',
      search: '?manual=browse'
    }),
    'doom-mods'
  );
  assert.equal(
    api.resolveAppIdFromLocation(FIXTURE, { pathname: '/doom/', search: '' }),
    'doom'
  );
});

test('nested play hubs resolve to the leaf app', () => {
  const api = loadApi();
  assert.equal(
    api.resolveAppIdFromLocation(FIXTURE, { pathname: '/play/drums/', search: '' }),
    'play-drums'
  );
  assert.equal(
    api.resolveAppIdFromLocation(FIXTURE, { pathname: '/play/', search: '' }),
    'play'
  );
});

test('unknown paths fall back to the first segment or home', () => {
  const api = loadApi();
  assert.equal(
    api.resolveAppIdFromLocation(FIXTURE, { pathname: '/unknown/thing/', search: '' }),
    'unknown'
  );
  assert.equal(api.resolveAppIdFromLocation(FIXTURE, { pathname: '/', search: '' }), 'home');
});

test('custom fallback is used when nothing matches', () => {
  const api = loadApi();
  assert.equal(
    api.resolveAppIdFromLocation(
      FIXTURE,
      { pathname: '/mystery/', search: '' },
      { fallback: () => 'custom-home' }
    ),
    'custom-home'
  );
});
