import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, 'achievements.js'), 'utf8');

const TEST_CATALOG = {
  version: 1,
  achievements: [
    {
      id: 'doom:first-action',
      appId: 'doom',
      title: 'Rip and Tear',
      description: 'Start a Doom game.',
      icon: '💀',
      parentId: null,
      x: 0,
      y: 0
    },
    {
      id: 'doom-mods:first-action',
      appId: 'doom-mods',
      title: 'Mod Hunter',
      description: 'Launch a Doom mod.',
      icon: '🛒',
      parentId: 'doom:first-action',
      x: 1,
      y: 0
    }
  ]
};

const TEST_REGISTRY = [
  { id: 'doom', path: './doom/' },
  { id: 'doom-mods', path: './doom/?manual=browse' }
];

function response(value) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(value)
  });
}

function loadRuntime(url = 'https://joeheyming.github.io/doom/') {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
    url
  });
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  });
  dom.window.fetch = (requestUrl) =>
    requestUrl.includes('catalog') ? response(TEST_CATALOG) : response(TEST_REGISTRY);
  dom.window.eval(SOURCE);
  return dom;
}

test('unlocks once and persists a timestamped versioned record', async () => {
  const dom = loadRuntime();
  const service = dom.window.heymingAchievements;
  await service.ready;

  assert.equal(await service.unlockForCurrentApp('first-action'), true);
  assert.equal(await service.unlockForCurrentApp('first-action'), false);

  const saved = JSON.parse(dom.window.localStorage.getItem('heyming.achievements.v1'));
  assert.equal(saved.version, 1);
  assert.match(saved.unlocked['doom:first-action'].unlockedAt, /^\d{4}-\d{2}-\d{2}T/);
  dom.window.close();
});

test('query-specific registry paths resolve before their base app', async () => {
  const dom = loadRuntime('https://joeheyming.github.io/doom/?manual=browse');
  const service = dom.window.heymingAchievements;
  await service.ready;

  assert.equal(service.getCurrentAppId(), 'doom-mods');
  assert.equal(await service.unlockForCurrentApp('first-action'), true);
  assert.equal(service.isUnlocked('doom-mods:first-action'), true);
  dom.window.close();
});

test('malformed storage is ignored safely', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
    url: 'https://joeheyming.github.io/doom/'
  });
  dom.window.localStorage.setItem('heyming.achievements.v1', '{not json');
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.fetch = (requestUrl) =>
    requestUrl.includes('catalog') ? response(TEST_CATALOG) : response(TEST_REGISTRY);
  dom.window.eval(SOURCE);
  await dom.window.heymingAchievements.ready;

  assert.deepEqual(Object.keys(dom.window.heymingAchievements.getUnlocked()), []);
  dom.window.close();
});

test('catalog contains unique IDs, valid parents, and only registry apps', () => {
  const catalog = JSON.parse(readFileSync(path.join(ROOT, 'achievements-catalog.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(path.join(ROOT, 'apps-registry.json'), 'utf8'));
  const ids = new Set(catalog.achievements.map((achievement) => achievement.id));
  const appIds = new Set(catalog.achievements.map((achievement) => achievement.appId));
  const byId = new Map(catalog.achievements.map((achievement) => [achievement.id, achievement]));

  assert.equal(ids.size, catalog.achievements.length);
  for (const achievement of catalog.achievements) {
    assert.equal(typeof achievement.x, 'number');
    assert.equal(typeof achievement.y, 'number');
    if (achievement.parentId !== null) assert.equal(ids.has(achievement.parentId), true);
    const visited = new Set();
    let current = achievement;
    while (current.parentId !== null) {
      assert.equal(visited.has(current.id), false, `cycle at ${achievement.id}`);
      visited.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  const registryIds = new Set(registry.map((app) => app.id));
  for (const appId of appIds) assert.equal(registryIds.has(appId), true, `unknown app ${appId}`);
});

test('every catalog app page loads the shared achievement runtime', () => {
  const catalog = JSON.parse(readFileSync(path.join(ROOT, 'achievements-catalog.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(path.join(ROOT, 'apps-registry.json'), 'utf8'));
  const registryById = new Map(registry.map((app) => [app.id, app]));
  const appIds = new Set(catalog.achievements.map((achievement) => achievement.appId));
  for (const appId of appIds) {
    const app = registryById.get(appId);
    assert.ok(app, `missing registry app ${appId}`);
    const relativePath = app.path.replace(/^\.\//, '').split('?')[0];
    const htmlPath = path.join(ROOT, relativePath, 'index.html');
    assert.equal(existsSync(htmlPath), true, `missing page for ${appId}`);
    const html = readFileSync(htmlPath, 'utf8');
    assert.match(html, /src=["']\/achievements\.js["']/, `${appId} does not load runtime`);
  }
});
