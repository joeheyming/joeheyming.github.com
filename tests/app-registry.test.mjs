import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = readFileSync(path.join(ROOT, 'shared/app-registry.js'), 'utf8');
const PATHS = readFileSync(path.join(ROOT, 'shared/registry-path.js'), 'utf8');

const ENTRIES = [
  { id: 'doom', path: './doom/', related: ['emulator'] },
  { id: 'doom-mods', path: './doom/?manual=browse' },
  { id: 'hidden', path: './hidden/', listed: false },
  { id: 'hub', path: './hub/', navKeepQueryChildren: true },
  { id: 'hub-child', path: './hub/?view=child' },
  { id: 'emulator', path: './emulator/' }
];

function load(window) {
  if (!window.AppModule && typeof window.fetch !== 'function') {
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }
  new Function('window', 'globalThis', PATHS)(window, window);
  new Function('window', 'globalThis', CLIENT)(window, window);
  return window.HeymingRegistry;
}

test('hrefFor keeps the query string on a site-absolute path', () => {
  const api = load({});
  assert.equal(api.hrefFor({ path: './doom/?manual=browse' }), '/doom/?manual=browse');
  assert.equal(api.hrefFor({ path: './play/drums/' }), '/play/drums/');
  assert.equal(api.hrefFor({ id: 'orphan' }), '/orphan/');
});

test('the drawer and the gallery hide the same query variants', () => {
  const api = load({});
  const nav = api.listed(ENTRIES, 'nav').map((app) => app.id);
  const gallery = api.listed(ENTRIES, 'gallery').map((app) => app.id);
  assert.deepEqual(nav, gallery);
  assert.deepEqual(nav, ['doom', 'hub', 'hub-child', 'emulator']);
  assert.throws(() => api.listed(ENTRIES, 'other'), /Unknown registry surface/);
});

test('current and related come from the registry', () => {
  const api = load({});
  const match = api.current(ENTRIES, { pathname: '/doom/', search: '?manual=browse' });
  assert.equal(match && match.id, 'doom-mods');
  assert.deepEqual(
    api.related(ENTRIES, 'doom').map((app) => app.id),
    ['emulator']
  );
});

test('ready fetches the registry once', async () => {
  let fetches = 0;
  const window = {
    fetch() {
      fetches += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(ENTRIES)
      });
    }
  };
  const api = load(window);
  const [first, second] = await Promise.all([api.ready, api.ready]);
  assert.equal(fetches, 1);
  assert.equal(first, second);
  assert.equal(first.length, ENTRIES.length);
});

test('ready reuses AppModule and does not fetch again', async () => {
  let fetches = 0;
  const window = {
    AppModule: {
      getAllApps() {
        return ENTRIES;
      }
    },
    fetch() {
      fetches += 1;
      return Promise.reject(new Error('should not fetch'));
    }
  };
  const api = load(window);
  assert.equal(await api.ready, ENTRIES);
  assert.equal(fetches, 0);
});

test('a failed load rejects once and warns once', async () => {
  const warnings = [];
  const window = {
    console: {
      warn(...args) {
        warnings.push(args);
      }
    },
    fetch() {
      return Promise.resolve({ ok: false, status: 404 });
    }
  };
  const api = load(window);
  await assert.rejects(api.ready, (error) => error.name === 'RegistryLoadError');
  await assert.rejects(api.ready, (error) => error.name === 'RegistryLoadError');
  assert.equal(warnings.length, 1);
});

test('nav, share, and achievements no longer fetch the registry themselves', () => {
  for (const file of ['nav.js', 'share.js', 'achievements.js']) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(source.includes("fetch('/apps-registry.json'"), false, file);
  }
  const home = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const clientAt = home.indexOf('src="/shared/app-registry.js"');
  const indexAt = home.indexOf('src="/index.js"');
  assert.ok(clientAt !== -1 && clientAt < indexAt);
});
