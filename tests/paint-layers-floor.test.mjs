import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { DOCK_MIN, LAYERS_FLOOR, protectLayersHeight } from '../paint/dock.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function sized(el, h) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => h });
  el.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: h, width: 0, height: h });
}

/** #dock at 500px: Layers (the fill) at `fillH`, four other visible groups at 100 each. */
function load(fillH) {
  const { window } = new JSDOM(html);
  const dock = window.document.getElementById('dock');
  sized(dock, 500);
  const fill = dock.querySelector(':scope > .dock-group-fill');
  sized(fill, fillH);
  const others = [...dock.querySelectorAll(':scope > .dock-group:not(.dock-group-fill)')];
  // Six groups in the HTML; hide one so four siblings stay visible.
  others[others.length - 1].hidden = true;
  const visible = others.slice(0, 4);
  for (const g of visible) sized(g, 100);
  return { dock, fill, visible, hidden: others[others.length - 1] };
}

function cap(g) {
  const m = /^0 1 (\d+)px$/.exec(g.style.flex);
  if (m) return Number(m[1]);
  return g.style.maxHeight ? parseFloat(g.style.maxHeight) : 100;
}

test('a short Layers group shrinks its siblings until it can reach LAYERS_FLOOR', () => {
  assert.equal(LAYERS_FLOOR, 220);
  assert.equal(DOCK_MIN, 36);
  const { dock, visible, hidden } = load(100);
  protectLayersHeight(dock);
  const caps = visible.map(cap);
  for (const [i, g] of visible.entries()) {
    if (g.style.flex) assert.match(g.style.flex, /^0 1 \d+px$/, `group ${i} stays shrinkable`);
    assert.ok(caps[i] >= DOCK_MIN, `group ${i} keeps DOCK_MIN`);
  }
  assert.ok(visible.some((g) => g.style.flex || g.style.maxHeight), 'some sibling was capped');
  const othersTotal = caps.reduce((a, b) => a + b, 0);
  assert.ok(500 - othersTotal >= LAYERS_FLOOR, `fill can grow to ${500 - othersTotal}`);
  assert.deepEqual(caps, [36, 44, 100, 100]);
  assert.equal(hidden.style.flex, '', 'hidden groups are left alone');
});

test('a Layers group already at the floor leaves its siblings alone', () => {
  const { dock, visible } = load(LAYERS_FLOOR);
  protectLayersHeight(dock);
  for (const g of visible) {
    assert.equal(g.style.flex, '');
    assert.equal(g.style.maxHeight, '');
  }
});
