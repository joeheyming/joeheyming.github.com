import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  DOCK_HEIGHTS_KEY,
  DOCK_MIN,
  LAYERS_MIN,
  initDock,
  splitDock,
  syncDockSplits
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

// Color, Properties, Navigator, History, Layers, Brushes
const HEIGHTS = [100, 80, 90, 60, 400, 70];
const TOTAL = HEIGHTS.reduce((a, b) => a + b, 0);
const sum = (a) => a.reduce((x, y) => x + y, 0);

test('splitDock grows a group and takes the height from Layers', () => {
  const out = splitDock(HEIGHTS, 0, 40, TOTAL, DOCK_MIN);
  assert.equal(out[0], 140);
  assert.equal(out[4], 360);
  assert.deepEqual([out[1], out[2], out[3], out[5]], [80, 90, 60, 70]);
  assert.equal(sum(out), TOTAL);
  assert.deepEqual(HEIGHTS, [100, 80, 90, 60, 400, 70], 'input is not mutated');
});

test('splitDock never shrinks a group below min', () => {
  const out = splitDock(HEIGHTS, 1, -500, TOTAL, DOCK_MIN);
  assert.equal(out[1], DOCK_MIN);
  assert.equal(DOCK_MIN, 36);
  assert.equal(out[4], 400 + 80 - DOCK_MIN, 'leftover height stays on Layers');
  assert.equal(sum(out), TOTAL);
});

test('splitDock never shrinks Layers below 180', () => {
  const out = splitDock(HEIGHTS, 3, 1000, TOTAL, DOCK_MIN);
  assert.equal(LAYERS_MIN, 180);
  assert.equal(out[4], LAYERS_MIN);
  assert.equal(out[3], 60 + 400 - LAYERS_MIN);
  assert.equal(sum(out), TOTAL);
});

test('the split under Layers trades height with the group below it', () => {
  const grow = splitDock(HEIGHTS, 4, 30, TOTAL, DOCK_MIN);
  assert.equal(grow[5], 40);
  assert.equal(grow[4], 430);
  const floor = splitDock(HEIGHTS, 4, 500, TOTAL, DOCK_MIN);
  assert.equal(floor[5], DOCK_MIN);
  const shrink = splitDock(HEIGHTS, 4, -1000, TOTAL, DOCK_MIN);
  assert.equal(shrink[4], LAYERS_MIN);
  assert.equal(sum(shrink), TOTAL);
});

function load(storage) {
  const { window } = new JSDOM(html);
  const dock = window.document.getElementById('dock');
  initDock(dock, storage);
  return { window, document: window.document, dock };
}

test('a jsdom #dock gets a .dock-split before the Layers group, none on the last', () => {
  const { document, dock } = load(memoryStorage());
  const layers = document.getElementById('tab-layers').closest('.dock-group');
  const visible = [...dock.querySelectorAll(':scope > .dock-group:not([hidden])')];
  const before = visible[visible.indexOf(layers) - 1];
  const split = before.querySelector(':scope > .dock-split');
  assert.ok(split, 'split on the History group');
  assert.equal(split.hidden, false);
  assert.ok(
    split.compareDocumentPosition(layers) & document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING
  );
  for (const g of visible.slice(0, -1)) {
    assert.equal(g.querySelector(':scope > .dock-split').hidden, false);
  }
  assert.equal(visible.at(-1).querySelector(':scope > .dock-split').hidden, true);
  // Hiding the last group moves the "no split" spot up to the new last group.
  visible.at(-1).hidden = true;
  syncDockSplits(dock);
  assert.equal(visible.at(-2).querySelector(':scope > .dock-split').hidden, true);
});

test('dragging a split sets the height, saves it, and double-click restores the default', () => {
  const storage = memoryStorage();
  const { window, document, dock } = load(storage);
  const groups = [...dock.querySelectorAll(':scope > .dock-group:not([hidden])')];
  groups.forEach((g, i) => {
    g.getBoundingClientRect = () => ({ height: HEIGHTS[i] });
  });
  Object.defineProperty(dock, 'clientHeight', { value: TOTAL });
  const color = groups[0];
  const split = color.querySelector(':scope > .dock-split');
  const ev = (type, clientY) => {
    const e = new window.MouseEvent(type, { clientY, bubbles: true });
    e.pointerId = 1;
    return e;
  };
  split.dispatchEvent(ev('pointerdown', 100));
  split.dispatchEvent(ev('pointermove', 150));
  split.dispatchEvent(ev('pointerup', 150));
  assert.equal(color.style.flex, '0 1 150px');
  assert.equal(color.style.maxHeight, '150px');
  const key = color.getAttribute('aria-label');
  assert.deepEqual(JSON.parse(storage.data.get(DOCK_HEIGHTS_KEY)), { [key]: 150 });

  const again = load(storage);
  const color2 = again.dock.querySelector(':scope > .dock-group');
  assert.equal(color2.style.flex, '0 1 150px', 'applies on the next load');

  split.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(color.style.flex, '');
  assert.deepEqual(JSON.parse(storage.data.get(DOCK_HEIGHTS_KEY)), {});
  assert.ok(document);
});
