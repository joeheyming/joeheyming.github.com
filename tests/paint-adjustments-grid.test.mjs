import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ADJUSTMENTS_PANEL, initPropertiesPanel } from '../paint/properties-panel.js';
import { ADJUSTMENTS } from '../paint/adjustments.js';
import { ICONS } from '../paint/icons.js';

function panelDom() {
  const dom = new JSDOM(`<div role="tablist">
    <button id="tab-properties" role="tab" aria-controls="panel-properties"
      aria-selected="false"></button>
    <button id="tab-adjustments" role="tab" aria-controls="panel-adjustments"
      aria-selected="true"></button>
  </div><div id="panel-properties" hidden><p class="panel-empty"></p></div>
  <div id="panel-adjustments"></div>`);
  globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  return dom.window.document;
}

function mount(doc, added) {
  return initPropertiesPanel(
    {
      activeLayer: () => ({ id: 1, kind: 'pixel', name: 'Background', mask: null }),
      size: () => [64, 48],
      pushUndo() {},
      undoTop: () => null,
      onAdjustmentEdit() {},
      onMaskEdit() {},
      newAdjustmentLayer: (id) => added.push(id),
      swatches: () => []
    },
    doc
  );
}

test('every Adjustments panel tile names a real adjustment and icon', () => {
  for (const [id, icon] of ADJUSTMENTS_PANEL) {
    assert.ok(ADJUSTMENTS[id], `${id} is an adjustment`);
    assert.ok(ICONS[icon], `${icon} is an icon`);
  }
});

test('the grid has one button per ADJUSTMENTS_PANEL id, in order', () => {
  const doc = panelDom();
  mount(doc, []);
  const btns = [...doc.querySelectorAll('#panel-adjustments .adjustments-grid button')];
  assert.equal(btns.length, ADJUSTMENTS_PANEL.length);
  assert.deepEqual(
    btns.map((b) => b.dataset.adjustment),
    ADJUSTMENTS_PANEL.map(([id]) => id)
  );
  for (const b of btns) assert.ok(b.querySelector('svg'), `${b.dataset.adjustment} has an icon`);
});

test('clicking a tile adds that adjustment layer once and switches to Properties', () => {
  for (const id of ['brightness', 'levels']) {
    const doc = panelDom();
    const added = [];
    mount(doc, added);
    doc.querySelector(`.adjustments-grid-btn[data-adjustment="${id}"]`).click();
    assert.deepEqual(added, [id]);
    assert.equal(doc.getElementById('tab-properties').getAttribute('aria-selected'), 'true');
    assert.equal(doc.getElementById('panel-properties').hidden, false);
    assert.equal(doc.getElementById('panel-adjustments').hidden, true);
  }
});
