import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  DOCK_TABS_KEY,
  dropDockTab,
  initDock,
  placeDockTab,
  tabInsertIndex
} from '../paint/dock.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function memoryStorage(init = {}) {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    data
  };
}

function load(storage) {
  const { window } = new JSDOM(html);
  const dock = window.document.getElementById('dock');
  return { window, document: window.document, dock, storage };
}

test('tabInsertIndex uses the midpoint of each tab', () => {
  const tabs = [
    { getBoundingClientRect: () => ({ left: 0, width: 40 }) },
    { getBoundingClientRect: () => ({ left: 40, width: 50 }) }
  ];
  assert.equal(tabInsertIndex(tabs, 10), 0);
  assert.equal(tabInsertIndex(tabs, 30), 1);
  assert.equal(tabInsertIndex(tabs, 70), 2);
});

test('a tab and its panel move into another group, and Layers keeps the fill', () => {
  const storage = memoryStorage();
  const { document, dock } = load(storage);
  initDock(dock, storage);
  const channels = document.getElementById('tab-channels');
  const historyList = document.getElementById('tab-history').closest('[role="tablist"]');
  placeDockTab(channels, historyList, 1, storage);

  const historyTabs = [...historyList.querySelectorAll('[role="tab"]')].map((t) => t.id);
  assert.deepEqual(historyTabs, ['tab-history', 'tab-channels', 'tab-layer-comps']);
  const historyGroup = historyList.closest('.dock-group');
  assert.ok(historyGroup.contains(document.getElementById('panel-channels')));
  assert.equal(channels.getAttribute('aria-selected'), 'true');

  const layersGroup = document.getElementById('panel-layers').closest('.dock-group');
  assert.ok(layersGroup.classList.contains('dock-group-fill'));
  assert.equal(historyGroup.classList.contains('dock-group-fill'), false);

  const saved = JSON.parse(storage.data.get(DOCK_TABS_KEY));
  assert.deepEqual(saved['History panel'], ['tab-history', 'tab-channels', 'tab-layer-comps']);
});

test('moving the Layers tab carries the fill height to the destination group', () => {
  const { document, dock } = load(memoryStorage());
  initDock(dock, memoryStorage());
  const layers = document.getElementById('tab-layers');
  const colorList = document.getElementById('tab-color').closest('[role="tablist"]');
  placeDockTab(layers, colorList, 0, null);
  const colorGroup = colorList.closest('.dock-group');
  assert.ok(colorGroup.classList.contains('dock-group-fill'));
  assert.ok(colorGroup.contains(document.getElementById('panel-layers')));
  const old = document.getElementById('tab-channels').closest('.dock-group');
  assert.equal(old.classList.contains('dock-group-fill'), false);
});

test('dropping on a tab row uses the pointer, and the order comes back on the next load', () => {
  const storage = memoryStorage();
  const { window, document, dock } = load(storage);
  initDock(dock, storage);
  const paths = document.getElementById('tab-paths');
  const layers = document.getElementById('tab-layers');
  document.elementFromPoint = () => layers;
  layers.getBoundingClientRect = () => ({ left: 0, width: 40, top: 0, height: 20 });
  assert.equal(dropDockTab(paths, 10, 8, storage), true);
  const ids = [...layers.closest('[role="tablist"]').querySelectorAll('[role="tab"]')].map(
    (t) => t.id
  );
  assert.equal(ids[0], 'tab-paths');

  const again = load(storage);
  initDock(again.dock, storage);
  const restored = [
    ...again.document
      .getElementById('tab-layers')
      .closest('[role="tablist"]')
      .querySelectorAll('[role="tab"]')
  ].map((t) => t.id);
  assert.deepEqual(restored, ids);
  assert.ok(window);
});

test('a drag that lands off the tab rows does not move the tab', () => {
  const { document, dock } = load(memoryStorage());
  initDock(dock, memoryStorage());
  document.elementFromPoint = () => document.body;
  const paths = document.getElementById('tab-paths');
  const before = paths.parentElement;
  assert.equal(dropDockTab(paths, 0, 0, null), false);
  assert.equal(paths.parentElement, before);
});
