import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { histogramBars, levelsDialogAuto } from '../paint/adjustments.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function installDom() {
  const { window } = new JSDOM(html);
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  return window;
}

// A 4 × 1 ImageData-backed context; jsdom has no canvas package.
function fakeCtx() {
  const W = 4,
    H = 1;
  let pixels = new Uint8ClampedArray([
    10, 20, 30, 255, 50, 60, 70, 255, 200, 210, 220, 255, 0, 0, 0, 0
  ]);
  return {
    canvas: { width: W, height: H },
    getImageData: () => ({ width: W, height: H, data: new Uint8ClampedArray(pixels) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img) => {
      pixels = new Uint8ClampedArray(img.data);
    }
  };
}

const { openAdjust, cancelAdjust } = await import('../paint/adjust-modal.js');

const bins = (entries) => {
  const h = new Array(256).fill(0);
  for (const [i, v] of entries) h[i] = v;
  return h;
};

test('levelsDialogAuto guards an empty histogram to [0, 255]', () => {
  assert.deepEqual(levelsDialogAuto(new Array(256).fill(0)), [0, 255]);
});

test('levelsDialogAuto on a single full bin stops lo at the bin and hi at lo + 2', () => {
  assert.deepEqual(levelsDialogAuto(bins([[100, 5000]])), [100, 102]);
});

test('levelsDialogAuto lo stops at 253 and hi at lo + 2', () => {
  assert.deepEqual(levelsDialogAuto(bins([[255, 10]])), [253, 255]);
  assert.deepEqual(levelsDialogAuto(bins([[0, 10]])), [0, 2]);
});

test('levelsDialogAuto clips a 0.1% tail at each end', () => {
  // 10000 pixels: clip = 10. Ten dark and ten bright outliers are clipped; eleven are not.
  const h = bins([
    [3, 10],
    [10, 9980],
    [250, 10]
  ]);
  assert.deepEqual(levelsDialogAuto(h), [10, 10 + 2]);
  const wide = bins([
    [3, 10],
    [10, 4990],
    [200, 4990],
    [250, 10]
  ]);
  assert.deepEqual(levelsDialogAuto(wide), [10, 200]);
  const kept = bins([
    [3, 11],
    [10, 4979],
    [200, 4999],
    [250, 11]
  ]);
  assert.deepEqual(levelsDialogAuto(kept), [3, 250]);
});

test('histogramBars scales to 1.1 × the largest bin', () => {
  const bars = histogramBars(
    bins([
      [0, 100],
      [128, 55],
      [255, 0]
    ]),
    512,
    110
  );
  assert.equal(bars.length, 256);
  assert.equal(bars[0].x, 1);
  assert.equal(bars[255].x, 511);
  assert.ok(Math.abs(bars[0].height - 100) < 1e-9);
  assert.ok(Math.abs(bars[128].height - 55) < 1e-9);
  assert.equal(bars[255].height, 0);
  // An empty histogram scales against 1, so every bar is zero.
  assert.ok(histogramBars(new Array(256).fill(0), 256, 110).every((b) => b.height === 0));
});

test('the Levels dialog renders the histogram and Auto; Auto sets the channel points', () => {
  const window = installDom();
  const { document } = window;
  openAdjust('levels', { sel: { mode: 'none' } }, { activeCtx: fakeCtx, pushUndo() {} });
  const fields = document.getElementById('adjust-modal-fields');
  const canvas = fields.querySelector('canvas.levels-histogram');
  assert.ok(canvas);
  assert.equal(canvas.height, 110);
  const auto = [...fields.querySelectorAll('button')].find((b) => b.textContent === 'Auto');
  assert.ok(auto);
  const rows = [...fields.querySelectorAll('.adjust-field')];
  assert.ok(
    rows.indexOf(canvas.closest('.adjust-field')) < rows.findIndex((r) => r.dataset.key === 'black')
  );
  const slider = (key) => fields.querySelector(`[data-key="${key}"] input[type="range"]`);

  // RGB: three opaque pixels on the composite (20, 60, 210), clip 0 → darkest 20, brightest 210.
  auto.click();
  assert.equal(slider('black').value, '20');
  assert.equal(slider('white').value, '210');
  assert.equal(slider('gamma').value, '1');

  const select = rows.find((r) => r.dataset.key === 'channel').querySelector('select');
  select.value = 'green';
  select.dispatchEvent(new window.Event('change'));
  auto.click();
  assert.equal(slider('greenBlack').value, '20');
  assert.equal(slider('greenWhite').value, '210');
  assert.equal(slider('redBlack').value, '0');
  cancelAdjust();
});

test('Brightness / Contrast has no histogram or Auto button', () => {
  installDom();
  openAdjust('brightness', { sel: { mode: 'none' } }, { activeCtx: fakeCtx, pushUndo() {} });
  const fields = document.getElementById('adjust-modal-fields');
  assert.equal(fields.querySelector('canvas.levels-histogram'), null);
  assert.equal(
    [...fields.querySelectorAll('button')].some((b) => b.textContent === 'Auto'),
    false
  );
  cancelAdjust();
});
