import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ADJUSTMENTS, PHOTO_FILTERS, applyPhotoFilter } from '../paint/adjustments.js';
import { defaultAdjustmentParams } from '../paint/adjustment-layers.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function installDom() {
  const { window } = new JSDOM(html);
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  return window;
}

// A 2 × 2 ImageData-backed context; jsdom has no canvas package.
function fakeCtx() {
  const W = 2,
    H = 2;
  let pixels = new Uint8ClampedArray(W * H * 4).fill(128);
  return {
    canvas: { width: W, height: H },
    getImageData: () => ({ width: W, height: H, data: new Uint8ClampedArray(pixels) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img) => {
      pixels = new Uint8ClampedArray(img.data);
    }
  };
}

const { openAdjust, openAdjustLayer, cancelAdjust } = await import('../paint/adjust-modal.js');

function rowByKey(document, key) {
  return document.querySelector(`#adjust-modal-fields .adjust-field[data-key="${key}"]`);
}

function choose(window, select, value) {
  select.value = value;
  select.dispatchEvent(new window.Event('change'));
}

const PRESETS = [
  ['warming85', 'Warming Filter (85)', '#ec8a00'],
  ['warmingLBA', 'Warming Filter (LBA)', '#fa9600'],
  ['warming81', 'Warming Filter (81)', '#ebb113'],
  ['cooling80', 'Cooling Filter (80)', '#006dff'],
  ['coolingLBB', 'Cooling Filter (LBB)', '#005dff'],
  ['cooling82', 'Cooling Filter (82)', '#00b5ff'],
  ['red', 'Red', '#ea1a1a'],
  ['orange', 'Orange', '#f38417'],
  ['yellow', 'Yellow', '#f9e31c'],
  ['green', 'Green', '#19c919'],
  ['cyan', 'Cyan', '#1dcbea'],
  ['blue', 'Blue', '#1d35ea'],
  ['violet', 'Violet', '#9b1dea'],
  ['magenta', 'Magenta', '#e318e3'],
  ['sepia', 'Sepia', '#ac7a33'],
  ['deepRed', 'Deep Red', '#ff0000'],
  ['deepBlue', 'Deep Blue', '#0022cd'],
  ['deepEmerald', 'Deep Emerald', '#008c00'],
  ['deepYellow', 'Deep Yellow', '#ffd500'],
  ['underwater', 'Underwater', '#00c2b1']
];

test('PHOTO_FILTERS lists PhotoCraft presets in order', () => {
  assert.deepEqual(
    PHOTO_FILTERS.map((f) => [f.value, f.label, f.hex]),
    PRESETS
  );
});

test('Photo Filter opens on Filter with Warming Filter (85) and a preset sets the color', () => {
  const window = installDom();
  const { document } = window;
  let previews = 0;
  openAdjust(
    'photoFilter',
    { sel: { mode: 'none' } },
    { activeCtx: fakeCtx, pushUndo() {}, onPreview: () => previews++ }
  );
  const use = rowByKey(document, 'use').querySelector('select');
  assert.deepEqual(
    [...use.options].map((o) => o.textContent),
    ['Filter', 'Color']
  );
  assert.equal(use.value, 'filter');
  const filter = rowByKey(document, 'filter').querySelector('select');
  assert.deepEqual(
    [...filter.options].map((o) => o.textContent),
    PRESETS.map((p) => p[1])
  );
  assert.equal(filter.value, 'warming85');
  assert.equal(rowByKey(document, 'filter').hidden, false);
  assert.equal(rowByKey(document, 'color').hidden, true);

  const before = previews;
  choose(window, filter, 'cooling80');
  assert.ok(previews > before, 'picking a preset refreshes the preview');
  choose(window, use, 'color');
  assert.equal(rowByKey(document, 'filter').hidden, true);
  assert.equal(rowByKey(document, 'color').hidden, false);
  assert.equal(rowByKey(document, 'color').querySelector('input').value, '#006dff');
  cancelAdjust();
});

test('a preset writes params.color and a custom color opens in Color mode', () => {
  const window = installDom();
  const { document } = window;
  const defaults = defaultAdjustmentParams('photoFilter');
  assert.deepEqual(defaults, { color: '#ec8a00', density: 25, preserveLuminosity: true });

  const layer = { adjustmentId: 'photoFilter', params: { ...defaults } };
  openAdjustLayer(layer, false, {});
  choose(window, rowByKey(document, 'filter').querySelector('select'), 'cooling80');
  assert.deepEqual(layer.params, { color: '#006dff', density: 25, preserveLuminosity: true });
  cancelAdjust();

  const custom = { adjustmentId: 'photoFilter', params: { ...defaults, color: '#123456' } };
  openAdjustLayer(custom, false, {});
  assert.equal(rowByKey(document, 'use').querySelector('select').value, 'color');
  assert.equal(rowByKey(document, 'color').hidden, false);
  assert.equal(rowByKey(document, 'filter').hidden, true);
  assert.equal(rowByKey(document, 'filter').querySelector('select').value, 'warming85');
  assert.equal(custom.params.color, '#123456');
  choose(window, rowByKey(document, 'use').querySelector('select'), 'filter');
  assert.equal(custom.params.color, '#123456');
  assert.equal('use' in custom.params, false);
  assert.equal('filter' in custom.params, false);
  cancelAdjust();

  assert.ok(ADJUSTMENTS.photoFilter.fields.filter((f) => f.local).length === 2);
  const img = () => ({ width: 1, height: 1, data: new Uint8ClampedArray([200, 90, 40, 255]) });
  const a = img();
  const b = img();
  applyPhotoFilter(a, defaults, null);
  applyPhotoFilter(b, { ...defaults, use: 'color', filter: 'red' }, null);
  assert.deepEqual([...a.data], [...b.data]);
});
