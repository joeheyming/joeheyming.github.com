import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ADJUSTMENTS, applyLegacyBrightnessContrast } from '../paint/adjustments.js';
import { defaultAdjustmentParams } from '../paint/adjustment-layers.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function installDom() {
  const { window } = new JSDOM(html);
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  return window;
}

const { openAdjustLayer, cancelAdjust } = await import('../paint/adjust-modal.js');

const px = (...rgba) => ({ width: rgba.length / 4, height: 1, data: new Uint8ClampedArray(rgba) });

function rowByKey(document, key) {
  return document.querySelector(`#adjust-modal-fields .adjust-field[data-key="${key}"]`);
}

test('Brightness / Contrast fields end with a Use Legacy checkbox', () => {
  const [b, c, legacy] = ADJUSTMENTS.brightness.fields;
  assert.equal(ADJUSTMENTS.brightness.fields.length, 3);
  assert.deepEqual([b.key, b.min, b.max, b.default], ['brightness', -150, 150, 0]);
  assert.deepEqual([c.key, c.min, c.max, c.default], ['contrast', -100, 100, 0]);
  assert.deepEqual(
    [legacy.key, legacy.label, legacy.type, legacy.default],
    ['legacy', 'Use Legacy', 'checkbox', false]
  );
  assert.deepEqual(defaultAdjustmentParams('brightness'), {
    brightness: 0,
    contrast: 0,
    legacy: false
  });
});

test('legacy math matches PhotoCraft legacy_brightness_contrast_at', () => {
  const a = px(128, 128, 128, 255);
  applyLegacyBrightnessContrast(a, 40, 30);
  assert.deepEqual([...a.data], [185, 185, 185, 255]);

  const b = px(128, 128, 128, 255);
  applyLegacyBrightnessContrast(b, 0, 80);
  assert.deepEqual([...b.data], [128, 128, 128, 255]);

  // Lowered contrast scales first, then brightness is added: (v - P) * 0.5 + P - 23/255.
  const c = px(128, 128, 128, 255, 255, 0, 200, 255);
  applyLegacyBrightnessContrast(c, -23, -50);
  assert.deepEqual([...c.data], [105, 105, 105, 255, 169, 41, 141, 255]);

  const viaApply = px(128, 128, 128, 255);
  ADJUSTMENTS.brightness.apply(viaApply, { brightness: 40, contrast: 30, legacy: true }, null);
  assert.deepEqual([...viaApply.data], [185, 185, 185, 255]);
});

test('legacy math leaves alpha, transparent and masked-out pixels alone', () => {
  const img = px(100, 100, 100, 77, 0, 0, 0, 0, 50, 60, 70, 255);
  applyLegacyBrightnessContrast(img, 60, 0, new Uint8Array([1, 1, 0]));
  assert.deepEqual([...img.data], [160, 160, 160, 77, 0, 0, 0, 0, 50, 60, 70, 255]);
});

test('unticking Use Legacy clamps contrast up to -50', () => {
  const window = installDom();
  const { document } = window;
  const layer = {
    adjustmentId: 'brightness',
    params: { brightness: 10, contrast: -80, legacy: true }
  };
  openAdjustLayer(layer, false, {});
  const box = rowByKey(document, 'legacy').querySelector('input[type=checkbox]');
  assert.equal(box.checked, true);
  box.checked = false;
  box.dispatchEvent(new window.Event('change'));
  assert.deepEqual(layer.params, { brightness: 10, contrast: -50, legacy: false });
  const row = rowByKey(document, 'contrast');
  assert.equal(row.querySelector('input[type=range]').value, '-50');
  assert.equal(row.querySelector('.adjust-field-value').textContent, '-50');
  cancelAdjust();
});
