import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS, COMMANDS_BY_ID } from '../paint/commands.js';
import { ADJUSTMENTS } from '../paint/adjustments.js';
import { newLayerMask, maskFromTransparency } from '../paint/layer-mask.js';
import { applyDefringe, applyRemoveMatte } from '../paint/matting.js';
import { historyIconName } from '../paint/history.js';

function image(W, H, pixels) {
  return { width: W, height: H, data: new Uint8ClampedArray(pixels.flat()) };
}
const px = (img, p) => Array.from(img.data.slice(p * 4, p * 4 + 4));

test('Hide Selection masks out the selected pixels and reveals the rest', () => {
  const sel = new Uint8Array([0, 1, 1, 0]);
  assert.deepEqual(Array.from(newLayerMask('hideSelection', 2, 2, sel)), [255, 0, 0, 255]);
});

test('From Transparency moves alpha into the mask and makes the layer opaque', () => {
  const img = image(3, 1, [
    [10, 20, 30, 0],
    [40, 50, 60, 128],
    [70, 80, 90, 255]
  ]);
  const mask = maskFromTransparency(img);
  assert.deepEqual(Array.from(mask), [0, 128, 255]);
  assert.deepEqual(Array.from(img.data), [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]);
});

test('Defringe gives edge pixels the color from inside and keeps alpha', () => {
  // PhotoCraft's defringe_pure_function: transparent, blue fringe, red core × 3.
  const img = image(5, 1, [
    [0, 0, 0, 0],
    [0, 0, 255, 128],
    [255, 0, 0, 255],
    [255, 0, 0, 255],
    [255, 0, 0, 255]
  ]);
  ADJUSTMENTS.defringe.apply(img, { width: 1 }, null);
  assert.deepEqual(px(img, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(img, 1), [255, 0, 0, 128]);
  assert.deepEqual(px(img, 2), [255, 0, 0, 255]);
});

test('Defringe Width grows the core color outward one pixel per round', () => {
  const img = image(5, 1, [
    [0, 0, 0, 0],
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [200, 100, 50, 255],
    [200, 100, 50, 255]
  ]);
  applyDefringe(img, 2);
  assert.deepEqual(px(img, 1), [200, 100, 50, 255]);
  assert.deepEqual(px(img, 2), [200, 100, 50, 255]);
  // A selection keeps the unselected fringe as it was.
  const kept = image(4, 1, [
    [0, 0, 0, 0],
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [255, 0, 0, 255]
  ]);
  applyDefringe(kept, 1, new Uint8Array([1, 0, 1, 1]));
  assert.deepEqual(px(kept, 1), [0, 0, 255, 255]);
  // An opaque layer has no edge to defringe.
  const solid = image(2, 1, [
    [1, 2, 3, 255],
    [4, 5, 6, 255]
  ]);
  applyDefringe(solid, 5);
  assert.deepEqual(Array.from(solid.data), [1, 2, 3, 255, 4, 5, 6, 255]);
});

test('Remove Black Matte divides color by alpha', () => {
  // 50% red over black reads as (128, 0, 0); unpremultiplied it is pure red.
  const img = image(3, 1, [
    [128, 0, 0, 128],
    [100, 60, 20, 255],
    [5, 5, 5, 0]
  ]);
  ADJUSTMENTS.removeBlackMatte.apply(img, {}, null);
  assert.deepEqual(px(img, 0), [255, 0, 0, 128]);
  assert.deepEqual(px(img, 1), [100, 60, 20, 255]);
  assert.deepEqual(px(img, 2), [5, 5, 5, 0]);
});

test('Remove White Matte subtracts the white and divides by alpha', () => {
  // 50% blue over white reads as (127, 127, 255).
  const img = image(2, 1, [
    [127, 127, 255, 128],
    [200, 150, 100, 64]
  ]);
  ADJUSTMENTS.removeWhiteMatte.apply(img, {}, null);
  assert.deepEqual(px(img, 0), [0, 0, 255, 128]);
  // (v - 255 * (1 - a)) / a with a = 64 / 255, clamped.
  const a = 64 / 255;
  const want = [200, 150, 100].map((v) =>
    Math.max(0, Math.min(255, Math.round((v - 255 * (1 - a)) / a)))
  );
  assert.deepEqual(px(img, 1), [...want, 64]);
  // A selection limits the change.
  const masked = image(1, 1, [[128, 0, 0, 128]]);
  applyRemoveMatte(masked, false, new Uint8Array([0]));
  assert.deepEqual(px(masked, 0), [128, 0, 0, 128]);
});

test('the commands sit in Layer › Layer Mask and Layer › Matting and run their ops', () => {
  const calls = [];
  const ctx = {
    addLayerMask: (k) => calls.push(['mask', k]),
    maskFromTransparency: () => calls.push(['fromTransparency']),
    openAdjust: (id) => calls.push(['dialog', id]),
    applyAdjustmentNow: (id) => calls.push(['now', id])
  };
  for (const id of [
    'layer.layerMask.hideSelection',
    'layer.layerMask.fromTransparency',
    'layer.matting.defringe',
    'layer.matting.removeBlackMatte',
    'layer.matting.removeWhiteMatte'
  ]) {
    COMMANDS_BY_ID.get(id).run(ctx);
  }
  assert.deepEqual(calls, [
    ['mask', 'hideSelection'],
    ['fromTransparency'],
    ['dialog', 'defringe'],
    ['now', 'removeBlackMatte'],
    ['now', 'removeWhiteMatte']
  ]);
  assert.deepEqual(ADJUSTMENTS.defringe.fields, [
    { key: 'width', label: 'Width', min: 1, max: 200, default: 1 }
  ]);

  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { document } = new JSDOM(html).window;
  const state = { layers: [{ mask: null }], activeLayerIdx: 0, sel: { mode: 'none' } };
  const refresh = buildMenuBar(document.getElementById('menu-bar'), COMMANDS, { state });
  const menu = document.getElementById('layer-menu-list');
  const matting = menu.querySelector('.has-submenu[data-menu-path="Layer > Matting"]');
  assert.ok(matting, 'Matting submenu missing');
  const labels = [...matting.querySelectorAll('[data-layer]')].map(
    (el) => el.querySelector('.menu-label').textContent
  );
  assert.deepEqual(labels, ['Defringe…', 'Remove Black Matte', 'Remove White Matte']);
  const item = (k) => menu.querySelector(`[data-layer="${k}"]`);
  assert.equal(item('mask-hide-selection').disabled, true, 'needs a selection');
  assert.equal(item('mask-from-transparency').disabled, false);
  state.sel = { mode: 'active', w: 4, h: 4 };
  refresh();
  assert.equal(item('mask-hide-selection').disabled, false);
  state.layers[0] = { kind: 'group', mask: null };
  refresh();
  assert.equal(item('defringe').disabled, true, 'a group has no pixels');
  assert.equal(historyIconName('From Transparency'), 'layer-mask');
});
