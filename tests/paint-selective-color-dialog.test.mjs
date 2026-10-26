import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ADJUSTMENTS, SELECTIVE_RANGES, applySelectiveColor } from '../paint/adjustments.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const INKS = ['Cyan', 'Magenta', 'Yellow', 'Black'];

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

function fieldRows(document) {
  return [...document.querySelectorAll('#adjust-modal-fields .adjust-field')];
}

function visibleRangeKeys(document) {
  return fieldRows(document)
    .filter((row) => !row.hidden && row.querySelector('input[type="range"]'))
    .map((row) => row.dataset.key);
}

function colorsSelect(document) {
  const row = fieldRows(document).find((r) => r.querySelector('label').textContent === 'Colors');
  return row?.querySelector('select');
}

function choose(window, select, value) {
  select.value = value;
  select.dispatchEvent(new window.Event('change'));
}

test('Selective Color dialog shows one Colors range at a time', () => {
  const window = installDom();
  const { document } = window;
  const state = { sel: { mode: 'none' } };
  openAdjust('selectiveColor', state, { activeCtx: fakeCtx, pushUndo() {} });

  const selects = fieldRows(document).filter(
    (r) => r.querySelector('label').textContent === 'Colors'
  );
  assert.equal(selects.length, 1);
  const colors = colorsSelect(document);
  assert.deepEqual(
    [...colors.options].map((o) => o.value),
    SELECTIVE_RANGES
  );
  assert.deepEqual(
    [...colors.options].map((o) => o.textContent),
    ['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas', 'Whites', 'Neutrals', 'Blacks']
  );
  assert.equal(colors.value, 'reds');
  assert.deepEqual(
    visibleRangeKeys(document),
    INKS.map((ink) => 'reds' + ink)
  );
  const labels = fieldRows(document)
    .filter((row) => !row.hidden && row.querySelector('input[type="range"]'))
    .map((row) => row.querySelector('label').textContent);
  assert.deepEqual(labels, INKS);

  const method = () =>
    fieldRows(document).find((r) => r.querySelector('label').textContent === 'Method');
  assert.ok(method() && !method().hidden);

  // Set Reds Cyan, switch to Neutrals and back: the value stays in the row and the params.
  const redsCyan = fieldRows(document).find((r) => r.dataset.key === 'redsCyan');
  const slider = redsCyan.querySelector('input');
  slider.value = '40';
  slider.dispatchEvent(new window.Event('input'));

  choose(window, colors, 'neutrals');
  assert.deepEqual(
    visibleRangeKeys(document),
    INKS.map((ink) => 'neutrals' + ink)
  );
  assert.equal(redsCyan.hidden, true);
  assert.equal(redsCyan.style.display, 'none');
  assert.ok(!method().hidden);

  choose(window, colors, 'reds');
  assert.deepEqual(
    visibleRangeKeys(document),
    INKS.map((ink) => 'reds' + ink)
  );
  assert.equal(redsCyan.querySelector('input').value, '40');
  assert.ok(!method().hidden);
  cancelAdjust();
});

test('the Colors choice is dialog-local and leaves layer params and output alone', () => {
  const window = installDom();
  const { document } = window;
  const params = {};
  for (const f of ADJUSTMENTS.selectiveColor.fields) if (!f.local) params[f.key] = f.default;
  params.redsCyan = 25;
  const layer = { adjustmentId: 'selectiveColor', params };
  openAdjustLayer(layer, false, {});
  const before = { ...layer.params };
  choose(window, colorsSelect(document), 'blues');
  assert.deepEqual(layer.params, before);
  assert.equal('colors' in layer.params, false);

  const img = () => ({ width: 1, height: 1, data: new Uint8ClampedArray([200, 40, 30, 255]) });
  const a = img();
  const b = img();
  applySelectiveColor(a, before, null);
  applySelectiveColor(b, { ...before, colors: 'blues' }, null);
  assert.deepEqual([...a.data], [...b.data]);
  cancelAdjust();
});
