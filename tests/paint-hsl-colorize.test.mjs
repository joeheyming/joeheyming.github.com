import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ADJUSTMENTS, applyHueSatLight } from '../paint/adjustments.js';
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

const px = (...rgba) => ({ width: rgba.length / 4, height: 1, data: new Uint8ClampedArray(rgba) });

function rowByKey(document, key) {
  return document.querySelector(`#adjust-modal-fields .adjust-field[data-key="${key}"]`);
}

function tick(window, box, checked) {
  box.checked = checked;
  box.dispatchEvent(new window.Event('change'));
}

test('Hue / Saturation gains a Colorize checkbox after Lightness', () => {
  const keys = ADJUSTMENTS.hsl.fields.map((f) => f.key);
  const box = ADJUSTMENTS.hsl.fields.find((f) => f.key === 'colorize');
  assert.ok(keys.indexOf('colorize') > keys.indexOf('lightness'));
  assert.equal(box.label, 'Colorize');
  assert.equal(box.type, 'checkbox');
  assert.equal(box.default, false);
  const params = defaultAdjustmentParams('hsl');
  assert.equal(params.colorize, false);
  assert.equal(params.hue, 0);
  assert.equal(params.saturation, 0);
  assert.equal(params.lightness, 0);
});

test('colorize builds the color at the lightened lightness', () => {
  const img = px(0, 0, 0, 255);
  applyHueSatLight(img, 0, 100, 30, true);
  assert.deepEqual([...img.data], [153, 0, 0, 255]);
  const viaApply = px(0, 0, 0, 255);
  ADJUSTMENTS.hsl.apply(viaApply, { hue: 0, saturation: 100, lightness: 30, colorize: true }, null);
  assert.deepEqual([...viaApply.data], [153, 0, 0, 255]);
});

test('colorize wraps the hue and uses |saturation|', () => {
  const a = px(200, 90, 40, 255, 10, 200, 120, 255);
  const b = px(200, 90, 40, 255, 10, 200, 120, 255);
  applyHueSatLight(a, -60, 50, -20, true);
  applyHueSatLight(b, 300, -50, -20, true);
  assert.deepEqual([...a.data], [...b.data]);
});

test('colorize leaves alpha and masked-out pixels alone', () => {
  const img = px(200, 90, 40, 77, 10, 200, 120, 255);
  applyHueSatLight(img, 120, 60, 0, true, new Uint8Array([1, 0]));
  assert.equal(img.data[3], 77);
  assert.deepEqual([...img.data.slice(4)], [10, 200, 120, 255]);
  // 200/90/40 has HSL lightness 120/255; hue 120 at 60% saturation.
  assert.deepEqual([...img.data.slice(0, 3)], [48, 192, 48]);
});

test('colorize off matches the plain hue shift', () => {
  const a = px(200, 90, 40, 255);
  const b = px(200, 90, 40, 255);
  applyHueSatLight(a, 40, 25, -10, false);
  ADJUSTMENTS.hsl.apply(b, { hue: 40, saturation: 25, lightness: -10 }, null);
  assert.deepEqual([...a.data], [...b.data]);
});

test('ticking Colorize at 0 saturation starts it at 25 and keeps an explicit value', () => {
  const window = installDom();
  const { document } = window;
  let previews = 0;
  openAdjust(
    'hsl',
    { sel: { mode: 'none' } },
    { activeCtx: fakeCtx, pushUndo() {}, onPreview: () => previews++ }
  );
  const box = rowByKey(document, 'colorize').querySelector('input[type=checkbox]');
  assert.equal(box.checked, false);
  const sat = rowByKey(document, 'saturation');
  const before = previews;
  tick(window, box, true);
  assert.equal(sat.querySelector('input[type=range]').value, '25');
  assert.equal(sat.querySelector('.adjust-field-value').textContent, '25');
  assert.ok(previews > before, 'ticking Colorize refreshes the preview');
  cancelAdjust();

  const layer = {
    adjustmentId: 'hsl',
    params: { ...defaultAdjustmentParams('hsl'), saturation: -40 }
  };
  openAdjustLayer(layer, false, {});
  tick(window, rowByKey(document, 'colorize').querySelector('input'), true);
  assert.deepEqual(layer.params, {
    ...defaultAdjustmentParams('hsl'),
    saturation: -40,
    colorize: true
  });
  cancelAdjust();
});
