import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { buildPalette, PALETTE_COLORS, updateFgSwatch, showColor } from '../paint/ui.js';
import { initDock } from '../paint/dock.js';
import { renderHistoryPanel } from '../paint/history.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('../paint/style.css', import.meta.url), 'utf8');
const dockCss = readFileSync(new URL('../paint/dock.css', import.meta.url), 'utf8');
const css = styleCss + '\n' + dockCss;

function load() {
  const { window } = new JSDOM(html);
  const { document } = window;
  // ui.js and dock.js resolve document at call time, so it stays set until the next load.
  globalThis.document = document;
  return { window, document };
}

const panelOf = (document, tab) => document.getElementById(tab.getAttribute('aria-controls'));

test('#dock replaces the right-panel stack and sits right of the canvas', () => {
  const { document } = load();
  const dock = document.getElementById('dock');
  assert.ok(dock);
  assert.equal(document.querySelector('.right-panel'), null);
  assert.equal(document.querySelector('.panel-section'), null);
  assert.equal(dock.parentElement, document.querySelector('.paint-body'));
  assert.equal(dock.parentElement.lastElementChild, dock);
  assert.ok(document.getElementById('canvas-area').compareDocumentPosition(dock) & 4);
});

test('dock tab labels follow the PhotoCraft panel groups', () => {
  const { document } = load();
  // Character | Paragraph is in the dock too, closed until Type › Panels or Window opens it.
  const groups = [...document.querySelectorAll('#dock > .dock-group:not([hidden])')];
  assert.equal(groups.length, 6);
  const labels = groups.map((g) =>
    [...g.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
  );
  assert.deepEqual(labels, [
    ['Color', 'Swatches', 'Gradients', 'Patterns', 'Shapes'],
    ['Properties', 'Adjustments'],
    ['Navigator', 'Histogram', 'Info'],
    ['History', 'Layer Comps'],
    ['Layers', 'Channels', 'Paths'],
    ['Brushes']
  ]);
  for (const tab of document.querySelectorAll('#dock [role="tab"]')) {
    const panel = panelOf(document, tab);
    assert.ok(panel, tab.id);
    assert.equal(panel.getAttribute('role'), 'tabpanel');
    assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
  }
});

test('Layers is selected on load and holds the layer list; History is its own group', () => {
  const { document } = load();
  const layers = document.getElementById('tab-layers');
  const history = document.getElementById('tab-history');
  assert.equal(layers.getAttribute('aria-selected'), 'true');
  assert.equal(panelOf(document, layers).hidden, false);
  assert.ok(panelOf(document, layers).contains(document.getElementById('layer-list-container')));
  assert.notEqual(layers.closest('.dock-group'), history.closest('.dock-group'));
  assert.equal(history.getAttribute('aria-selected'), 'true');
  assert.equal(panelOf(document, history).hidden, false);
  assert.ok(panelOf(document, history).contains(document.getElementById('history-list-container')));
  assert.ok(panelOf(document, history).contains(document.getElementById('btn-history-source')));

  const color = document.getElementById('tab-color');
  assert.equal(color.getAttribute('aria-selected'), 'true');
  assert.equal(document.getElementById('panel-swatches').hidden, true);
});

test('the Layers group fills the remaining dock height', () => {
  const { document } = load();
  const groups = document.querySelectorAll('#dock > .dock-group');
  const fill = [...groups].filter((g) => g.classList.contains('dock-group-fill'));
  assert.deepEqual(fill, [document.getElementById('tab-layers').closest('.dock-group')]);
  assert.match(css, /--layer-panel-w: 280px;/);
  const rule = (sel) => css.match(new RegExp(`\\n${sel.replace(/\./g, '\\.')} \\{[^}]*\\}`))[0];
  assert.match(rule('.dock'), /flex-direction: column/);
  assert.match(rule('.dock-group'), /flex: 0 1 auto/);
  assert.match(rule('.dock-group-fill'), /flex: 1 1 0%/);
  assert.match(rule('.dock-group-fill .dock-panel'), /flex: 1/);
});

test('clicking a tab switches panels within its group only', () => {
  const { window, document } = load();
  initDock();
  document.getElementById('tab-channels').click();
  assert.equal(document.getElementById('panel-channels').hidden, false);
  assert.equal(document.getElementById('panel-layers').hidden, true);
  assert.equal(document.getElementById('tab-channels').getAttribute('aria-selected'), 'true');
  assert.equal(document.getElementById('tab-layers').getAttribute('aria-selected'), 'false');
  // The other groups are untouched.
  assert.equal(document.getElementById('panel-color').hidden, false);
  assert.equal(document.getElementById('panel-history').hidden, false);

  document
    .getElementById('tab-color')
    .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(document.getElementById('panel-swatches').hidden, false);
  assert.equal(document.getElementById('panel-color').hidden, true);
  assert.equal(document.activeElement, document.getElementById('tab-swatches'));
  assert.equal(document.getElementById('panel-channels').hidden, false);
});

test('Swatches renders the palette and Color shows the fg and bg values', () => {
  const { window, document } = load();
  const state = { color: '#000000', bgColor: '#ffffff' };
  const calls = { fg: [], bg: [] };
  buildPalette(
    state,
    document.getElementById('color-chips'),
    document.getElementById('palette-bar'),
    (c) => calls.fg.push(c),
    (c) => calls.bg.push(c)
  );
  const swatches = document.getElementById('panel-swatches');
  assert.equal(
    swatches.querySelectorAll('.swatch-grid .color-swatch').length,
    PALETTE_COLORS.length
  );
  assert.ok(swatches.querySelector('#color-history'));

  const fgValue = document.getElementById('color-fg-value');
  const bgValue = document.getElementById('color-bg-value');
  assert.ok(document.getElementById('panel-color').contains(fgValue));
  assert.equal(fgValue.textContent, '#000000');
  assert.equal(bgValue.textContent, '#FFFFFF');

  const red = swatches.querySelector('.color-swatch[title="#ff0000"]');
  red.click();
  assert.deepEqual(calls.fg, ['#ff0000']);
  assert.equal(fgValue.textContent, '#FF0000');
  assert.equal(document.getElementById('color-fg-chip').style.background, 'rgb(255, 0, 0)');
  red.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls.bg, ['#ff0000']);
  assert.equal(bgValue.textContent, '#FF0000');

  // Eyedropper and project-load paths go through updateFgSwatch / showColor.
  updateFgSwatch('#123456');
  showColor('bg', '#abcdef');
  assert.equal(fgValue.textContent, '#123456');
  assert.equal(bgValue.textContent, '#ABCDEF');
  assert.equal(document.getElementById('fg-color-input').value, '#123456');
  assert.equal(document.getElementById('bg-color-input').value, '#abcdef');

  // Each Color row opens its color picker.
  const opened = [];
  document.getElementById('fg-color-input').click = () => opened.push('fg');
  document.getElementById('bg-color-input').click = () => opened.push('bg');
  document.getElementById('color-fg-row').click();
  document.getElementById('color-bg-row').click();
  assert.deepEqual(opened, ['fg', 'bg']);
});

test('the history list renders into the History tab', () => {
  const { window, document } = load();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const container = document.getElementById('history-list-container');
  renderHistoryPanel(
    container,
    [{ label: 'Brush' }],
    [],
    () => {},
    () => {}
  );
  const items = document.querySelectorAll('#panel-history .history-item');
  assert.deepEqual(
    [...items].map((el) => el.lastElementChild.textContent),
    ['Brush', 'Open']
  );
});
