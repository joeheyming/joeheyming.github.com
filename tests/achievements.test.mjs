import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, 'achievements.js'), 'utf8');
const REGISTRY_PATH = readFileSync(path.join(ROOT, 'shared/registry-path.js'), 'utf8');

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
    },
    {
      id: 'doom:map-cleared',
      appId: 'doom',
      title: 'Map Cleared',
      description: 'Clear a Doom map.',
      icon: '🏁',
      parentId: 'doom:first-action',
      requiresId: 'doom:first-action',
      tier: 2,
      x: 0,
      y: 1
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

function readJavaScriptTree(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return readJavaScriptTree(entryPath);
      return entry.isFile() && entry.name.endsWith('.js') ? readFileSync(entryPath, 'utf8') : [];
    })
    .join('\n');
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
  new Function('window', 'globalThis', REGISTRY_PATH)(dom.window, dom.window);
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

test('level 2 requires level 1 and a blocked action must be retried', async () => {
  const dom = loadRuntime();
  const service = dom.window.heymingAchievements;
  const events = [];
  dom.window.trackEvent = (...args) => events.push(args);
  await service.ready;

  assert.equal(await service.unlock('doom:map-cleared'), false);
  assert.equal(await service.unlock('doom:map-cleared'), false);
  assert.equal(service.isUnlocked('doom:map-cleared'), false);
  assert.equal(
    events.filter(([name]) => name === 'achievement_unlock_blocked').length,
    1,
    'blocked analytics should be deduplicated per page'
  );

  assert.equal(await service.unlock('doom:first-action'), true);
  assert.equal(service.isUnlocked('doom:map-cleared'), false, 'blocked actions are not queued');
  assert.equal(await service.unlock('doom:map-cleared'), true);
  assert.equal(service.isUnlocked('doom:map-cleared'), true);
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
  new Function('window', 'globalThis', REGISTRY_PATH)(dom.window, dom.window);
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
    const tier = achievement.tier ?? 1;
    assert.equal(tier === 1 || tier === 2, true, `invalid tier for ${achievement.id}`);
    if (tier === 2) {
      const levelOneId = `${achievement.appId}:first-action`;
      assert.equal(achievement.requiresId, levelOneId, `invalid requirement for ${achievement.id}`);
      assert.equal(achievement.parentId, levelOneId, `invalid parent for ${achievement.id}`);
      assert.equal(ids.has(levelOneId), true, `missing level 1 for ${achievement.id}`);
    } else {
      assert.equal(achievement.requiresId ?? null, null, `level 1 is gated: ${achievement.id}`);
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

test('catalog coordinates stay on the tree lattice without crowding', () => {
  const catalog = JSON.parse(readFileSync(path.join(ROOT, 'achievements-catalog.json'), 'utf8'));
  // Columns sit 190px apart and rows 160px apart, and renderRegions() pads each
  // app box by 76px/66px around its nodes.
  const MIN_COLUMN_GAP = 170;
  const MIN_ROW_GAP = 150;
  const REGION_PAD_X = 76;
  const REGION_PAD_Y = 66;
  const nodes = catalog.achievements;

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const apart =
        Math.abs(nodes[i].x - nodes[j].x) >= MIN_COLUMN_GAP ||
        Math.abs(nodes[i].y - nodes[j].y) >= MIN_ROW_GAP;
      assert.equal(apart, true, `${nodes[i].id} and ${nodes[j].id} are packed too closely`);
    }
  }

  const regions = new Map();
  for (const node of nodes) {
    const region = regions.get(node.appId) || {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity
    };
    region.left = Math.min(region.left, node.x - REGION_PAD_X);
    region.right = Math.max(region.right, node.x + REGION_PAD_X);
    region.top = Math.min(region.top, node.y - REGION_PAD_Y);
    region.bottom = Math.max(region.bottom, node.y + REGION_PAD_Y);
    regions.set(node.appId, region);
  }

  for (const node of nodes) {
    for (const [appId, region] of regions) {
      if (appId === node.appId) continue;
      const inside =
        node.x >= region.left &&
        node.x <= region.right &&
        node.y >= region.top &&
        node.y <= region.bottom;
      assert.equal(inside, false, `${node.id} sits inside the ${appId} region`);
    }
  }

  const entries = [...regions.entries()];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [appA, a] = entries[i];
      const [appB, b] = entries[j];
      const overlaps =
        Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
        Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
      assert.equal(overlaps, false, `${appA} and ${appB} regions overlap`);
    }
  }
});

test('every level 2 achievement has a matching trigger in its app', () => {
  const catalog = JSON.parse(readFileSync(path.join(ROOT, 'achievements-catalog.json'), 'utf8'));
  const registry = JSON.parse(readFileSync(path.join(ROOT, 'apps-registry.json'), 'utf8'));
  const registryById = new Map(registry.map((app) => [app.id, app]));

  for (const achievement of catalog.achievements.filter((item) => item.tier === 2)) {
    const app = registryById.get(achievement.appId);
    assert.ok(app, `missing registry app ${achievement.appId}`);
    const relativePath = app.path.replace(/^\.\//, '').split('?')[0];
    const source = readJavaScriptTree(path.join(ROOT, relativePath));
    const slug = achievement.id.slice(achievement.appId.length + 1);
    assert.equal(
      source.includes(`unlockForCurrentApp('${slug}')`),
      true,
      `missing trigger for ${achievement.id}`
    );
  }
});
