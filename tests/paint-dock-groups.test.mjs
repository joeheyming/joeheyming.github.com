import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { bindDockBrushSize, initDock } from '../paint/dock.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function load() {
  const { window } = new JSDOM(html);
  return { window, document: window.document };
}

const GROUPS = [
  ['Color', 'Swatches', 'Gradients', 'Patterns', 'Shapes'],
  ['Properties', 'Adjustments'],
  ['Navigator', 'Histogram', 'Info'],
  ['History', 'Layer Comps'],
  ['Layers', 'Channels', 'Paths'],
  ['Brushes']
];

// Still static placeholders. Gradients / Patterns / Shapes are empty shells filled by JS.
const EMPTY = ['Properties', 'Adjustments', 'Navigator', 'Histogram', 'Info'];

test('#dock is six section.dock-group elements with the PhotoCraft tab rows', () => {
  const { document } = load();
  const dock = document.getElementById('dock');
  // Character | Paragraph is in the dock too, hidden until Type › Panels or Window opens it.
  const groups = [...dock.querySelectorAll(':scope > .dock-group:not([hidden])')];
  assert.equal(groups.length, 6);
  for (const g of groups) {
    assert.equal(g.tagName, 'SECTION');
    assert.ok(g.classList.contains('dock-group'));
  }
  assert.deepEqual(
    groups.map((g) => [...g.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())),
    GROUPS
  );
  // Only the first tab of each row is selected; Color and Layers are among them.
  for (const g of groups) {
    const selected = [...g.querySelectorAll('[role="tab"]')].filter(
      (t) => t.getAttribute('aria-selected') === 'true'
    );
    assert.equal(selected.length, 1);
  }
  assert.equal(document.getElementById('tab-color').getAttribute('aria-selected'), 'true');
  assert.equal(document.getElementById('tab-layers').getAttribute('aria-selected'), 'true');
  assert.deepEqual(
    groups.map((g) => g.classList.contains('dock-group-fill')),
    [false, false, false, false, true, false]
  );
});

test('the new panels are tabpanels holding only an empty p.panel-empty', () => {
  const { document } = load();
  for (const name of EMPTY) {
    const tab = document.getElementById(`tab-${name.toLowerCase()}`);
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    assert.equal(panel.getAttribute('role'), 'tabpanel', name);
    assert.equal(panel.children.length, 1, name);
    const p = panel.firstElementChild;
    assert.equal(p.tagName, 'P', name);
    assert.ok(p.classList.contains('panel-empty'), name);
    assert.equal(p.textContent.trim(), '', name);
  }
});

test('existing contents moved into their groups', () => {
  const { document } = load();
  const inPanel = (id, tab) =>
    document.getElementById(`panel-${tab}`).contains(document.getElementById(id));
  assert.ok(inPanel('palette-bar', 'swatches'));
  assert.ok(inPanel('color-fg-value', 'color'));
  assert.ok(inPanel('layer-list-container', 'layers'));
  assert.ok(inPanel('history-list-container', 'history'));
  assert.ok(inPanel('btn-history-source', 'history'));
  const history = document.getElementById('tab-history').closest('[role="tablist"]');
  assert.equal(history.querySelectorAll('[role="tab"]').length, 2);
});

test('Brushes has a search input and a Size range bound to state.brushSize', () => {
  const { window, document } = load();
  initDock(document.getElementById('dock'));
  const panel = document.getElementById('panel-brushes');
  assert.equal(panel.querySelector('input[type="search"]')?.id, 'brush-search');
  const range = document.getElementById('dock-brush-size');
  assert.ok(panel.contains(range));
  assert.equal(range.type, 'range');

  const state = { brushSize: 12 };
  const seen = [];
  const sync = bindDockBrushSize(state, (s) => seen.push(s), document);
  assert.equal(range.value, '12');
  assert.equal(document.getElementById('dock-brush-size-value').textContent, '12 px');

  range.value = '30';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(state.brushSize, 30);
  assert.deepEqual(seen, [30]);
  assert.equal(document.getElementById('dock-brush-size-value').textContent, '30 px');

  state.brushSize = 7;
  sync();
  assert.equal(range.value, '7');
  assert.equal(document.getElementById('dock-brush-size-value').textContent, '7 px');
});
