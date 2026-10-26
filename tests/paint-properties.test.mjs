import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { compositeTreeBytes } from '../paint/layer-groups.js';
import { compositeMask, effectiveMask } from '../paint/layer-mask.js';
import {
  ADJUSTMENTS_PANEL,
  initPropertiesPanel,
  propertiesSections,
  setMaskProperties
} from '../paint/properties-panel.js';
import { ADJUSTMENTS } from '../paint/adjustments.js';
import { historyIconName } from '../paint/history.js';

// A layer whose mask hides the left column fully and reveals the right one.
function maskedLayer() {
  const W = 2,
    H = 1;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
  return {
    id: 1,
    kind: 'pixel',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    data,
    mask: Uint8Array.of(0, 255),
    maskEnabled: true
  };
}

test('density 50% halves how much a mask hides', () => {
  const mask = Uint8Array.of(0, 64, 128, 255);
  const half = effectiveMask(mask, 4, 1, 0.5, 0);
  for (let p = 0; p < mask.length; p++) {
    const hide = 255 - mask[p];
    assert.ok(Math.abs(255 - half[p] - hide / 2) <= 0.5, `pixel ${p}: ${half[p]}`);
  }
  assert.equal(effectiveMask(mask, 4, 1, 1, 0), mask, 'defaults leave the mask itself');
  assert.deepEqual([...effectiveMask(mask, 4, 1, 0, 0)], [255, 255, 255, 255]);
});

test('density is applied at composite time and leaves layer.mask untouched', () => {
  const layer = maskedLayer();
  const full = compositeTreeBytes([layer], 2, 1, '#ffffff');
  assert.deepEqual([...full.slice(0, 4)], [255, 255, 255, 255], 'mask hides the left pixel');
  setMaskProperties(layer, { density: 50 });
  assert.equal(layer.maskDensity, 0.5);
  const half = compositeTreeBytes([layer], 2, 1, '#ffffff');
  // Half the hide: the red layer shows at ~50% over white on the left.
  assert.deepEqual([...half.slice(0, 4)], [255, 127, 127, 255]);
  assert.deepEqual([...half.slice(4, 8)], [255, 0, 0, 255]);
  assert.deepEqual([...layer.mask], [0, 255], 'painted mask is unchanged');
  layer.maskEnabled = false;
  assert.equal(compositeMask(layer, 2), null);
});

test('feather blurs the mask edge non-destructively', () => {
  const W = 16;
  const mask = new Uint8Array(W).map((_, x) => (x < 8 ? 0 : 255));
  const layer = { mask, maskEnabled: true, canvas: { width: W } };
  setMaskProperties(layer, { feather: 2 });
  const soft = compositeMask(layer, W);
  assert.notEqual(soft, mask);
  assert.ok(soft[7] > 0 && soft[8] < 255, `edge ${soft[7]} ${soft[8]}`);
  assert.ok(soft[7] < soft[8]);
  assert.equal(compositeMask(layer, W), soft, 'cached until the mask or settings change');
  assert.equal(mask[7], 0);
});

test('Adjustments panel lists PhotoCraft adjustment layers in its order', () => {
  assert.deepEqual(
    ADJUSTMENTS_PANEL.map(([id]) => id),
    [
      'brightness',
      'levels',
      'curves',
      'exposure',
      'vibrance',
      'hsl',
      'colorBalance',
      'blackWhite',
      'photoFilter',
      'channelMixer',
      'invert',
      'posterize',
      'threshold',
      'gradientMap',
      'selectiveColor',
      'colorLookup'
    ]
  );
  assert.ok(ADJUSTMENTS_PANEL.every(([id]) => ADJUSTMENTS[id]));
});

function panelDom() {
  const dom = new JSDOM(`<div role="tablist">
    <button id="tab-properties" role="tab" aria-controls="panel-properties"></button>
    <button id="tab-adjustments" role="tab" aria-controls="panel-adjustments"></button>
  </div><div id="panel-properties"></div><div id="panel-adjustments" hidden></div>`);
  globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  return dom.window.document;
}

test('grid buttons add adjustment layers and switch to Properties', () => {
  const doc = panelDom();
  const added = [];
  initPropertiesPanel(
    {
      activeLayer: () => null,
      size: () => [2, 1],
      pushUndo() {},
      undoTop: () => null,
      onAdjustmentEdit() {},
      onMaskEdit() {},
      newAdjustmentLayer: (id) => added.push(id)
    },
    doc
  );
  const buttons = [...doc.querySelectorAll('.adjustments-grid-btn')];
  assert.deepEqual(
    buttons.map((b) => b.dataset.adjustment),
    ADJUSTMENTS_PANEL.map(([id]) => id)
  );
  assert.ok(buttons.every((b) => b.querySelector('svg')));
  doc.getElementById('tab-adjustments').setAttribute('aria-selected', 'true');
  buttons[1].click();
  assert.deepEqual(added, ['levels']);
  assert.equal(doc.getElementById('tab-properties').getAttribute('aria-selected'), 'true');
  assert.equal(doc.getElementById('panel-adjustments').hidden, true);
});

test('Properties edits an adjustment layer live and mask density with one undo', () => {
  const doc = panelDom();
  const layer = {
    id: 7,
    kind: 'adjustment',
    adjustmentId: 'exposure',
    params: { exposure: 0, offset: 0, gamma: 1 },
    mask: new Uint8Array(2).fill(255),
    maskEnabled: true
  };
  const undo = [];
  const edits = [];
  const panel = initPropertiesPanel(
    {
      activeLayer: () => layer,
      size: () => [2, 1],
      pushUndo: (label) => undo.push({ label, params: { ...layer.params } }),
      undoTop: () => undo.at(-1),
      onAdjustmentEdit: () => edits.push('adjustment'),
      onMaskEdit: () => edits.push('mask'),
      newAdjustmentLayer() {}
    },
    doc
  );
  assert.deepEqual(propertiesSections(layer), ['adjustment', 'mask']);
  panel.render();
  const box = doc.getElementById('panel-properties');
  const ranges = [...box.querySelectorAll('.properties-fields input[type="range"]')];
  assert.ok(ranges.length > 0, 'adjustment fields render in Properties');
  ranges[0].value = '1';
  ranges[0].dispatchEvent(new doc.defaultView.Event('input'));
  ranges[0].value = '2';
  ranges[0].dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(layer.params[ADJUSTMENTS.exposure.fields[0].key], 2);
  assert.deepEqual(
    undo.map((u) => u.label),
    ['Edit Adjustment Layer']
  );
  assert.equal(undo[0].params[ADJUSTMENTS.exposure.fields[0].key], 0, 'undo holds the old params');
  assert.deepEqual(edits, ['adjustment', 'adjustment']);

  const [density] = box.querySelectorAll('.properties-row input[type="range"]');
  density.value = '50';
  density.dispatchEvent(new doc.defaultView.Event('input'));
  density.value = '40';
  density.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(layer.maskDensity, 0.4);
  assert.deepEqual(
    undo.map((u) => u.label),
    ['Edit Adjustment Layer', 'Mask Properties']
  );
  assert.equal(historyIconName('Mask Properties'), 'layer-mask');
});
