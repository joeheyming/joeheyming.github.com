import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { initPropertiesPanel } from '../paint/properties-panel.js';
import { ADJUSTMENTS } from '../paint/adjustments.js';

// The Properties | Adjustments group as index.html ships it: Properties holds an empty paragraph.
function panelDom() {
  const dom = new JSDOM(`<div role="tablist">
    <button id="tab-properties" role="tab" aria-controls="panel-properties"></button>
    <button id="tab-adjustments" role="tab" aria-controls="panel-adjustments"></button>
  </div><div id="panel-properties"><p class="panel-empty"></p></div>
  <div id="panel-adjustments" hidden></div>`);
  globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  return dom.window.document;
}

function mount(doc, layer, undo = [], edits = []) {
  return initPropertiesPanel(
    {
      activeLayer: () => layer,
      size: () => [640, 480],
      pushUndo: (label) => undo.push(label),
      undoTop: () => undo.at(-1),
      onAdjustmentEdit: () => edits.push('adjustment'),
      onMaskEdit: () => edits.push('mask'),
      newAdjustmentLayer() {},
      swatches: () => []
    },
    doc
  );
}

test('init replaces the shipped empty paragraph with a pixel layer size', () => {
  const doc = panelDom();
  const panel = mount(doc, { id: 1, kind: 'pixel', name: 'Background', mask: null });
  const box = doc.getElementById('panel-properties');
  assert.equal(box.querySelector('p.panel-empty'), null, 'init alone drops the placeholder');
  panel.render(true);
  assert.equal(box.querySelector('p.panel-empty'), null);
  const size = box.querySelector('.properties-size');
  assert.ok(size, 'pixel layer shows its size');
  assert.match(size.textContent, /W: 640 px/);
  assert.match(size.textContent, /H: 480 px/);
});

test('an adjustment layer shows its params as controls', () => {
  const doc = panelDom();
  const layer = {
    id: 2,
    kind: 'adjustment',
    adjustmentId: 'brightness',
    params: { brightness: 0, contrast: 0 },
    mask: null
  };
  const panel = mount(doc, layer);
  panel.render(true);
  const box = doc.getElementById('panel-properties');
  assert.equal(box.querySelector('p.panel-empty'), null);
  const fields = box.querySelector('.properties-fields');
  assert.ok(fields, 'adjustment section renders');
  assert.ok(fields.querySelectorAll('input, select').length >= 1, 'at least one control');
  assert.ok(box.textContent.includes(ADJUSTMENTS.brightness.label));
});

test('a masked pixel layer shows Density and Feather that write the layer', () => {
  const doc = panelDom();
  const layer = {
    id: 3,
    kind: 'pixel',
    name: 'Layer 1',
    mask: new Uint8Array(4).fill(255),
    maskEnabled: true
  };
  const undo = [];
  const edits = [];
  const panel = mount(doc, layer, undo, edits);
  panel.render(true);
  const box = doc.getElementById('panel-properties');
  assert.ok(box.querySelector('.properties-size'));
  const rows = [...box.querySelectorAll('.properties-row')];
  assert.deepEqual(
    rows.map((r) => r.querySelector('span').textContent),
    ['Density', 'Feather']
  );
  const [density, feather] = rows.map((r) => r.querySelector('input[type="range"]'));
  density.value = '60';
  density.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(layer.maskDensity, 0.6);
  feather.value = '12';
  feather.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(layer.maskFeather, 12);
  assert.deepEqual(edits, ['mask', 'mask']);
  assert.deepEqual(undo, ['Mask Properties', 'Mask Properties']);
});
