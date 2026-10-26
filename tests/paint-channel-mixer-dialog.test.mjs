import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { applyChannelMixer } from '../paint/adjustments.js';
import { defaultAdjustmentParams } from '../paint/adjustment-layers.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const COLS = ['Red', 'Green', 'Blue', 'Constant'];

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

const rows = (document) => [...document.querySelectorAll('#adjust-modal-fields .adjust-field')];
const byLabel = (document, text) =>
  rows(document).filter((r) => r.querySelector('label').textContent === text);
const visible = (document) => rows(document).filter((r) => !r.hidden);
const visibleSliderKeys = (document) =>
  visible(document)
    .filter((r) => r.querySelector('input[type="range"]'))
    .map((r) => r.dataset.key);
const visibleTotal = (document) => {
  const totals = visible(document).filter((r) => r.querySelector('label').textContent === 'Total');
  assert.equal(totals.length, 1);
  return totals[0].querySelector('.adjust-field-value').textContent;
};

function choose(window, select, value) {
  select.value = value;
  select.dispatchEvent(new window.Event('change'));
}

test('Channel Mixer dialog shows one Output Channel at a time with a Total readout', () => {
  const window = installDom();
  const { document } = window;
  openAdjust(
    'channelMixer',
    { sel: { mode: 'none' } },
    {
      activeCtx: fakeCtx,
      pushUndo() {}
    }
  );

  const outRows = byLabel(document, 'Output Channel');
  assert.equal(outRows.length, 1);
  const output = outRows[0].querySelector('select');
  assert.deepEqual(
    [...output.options].map((o) => o.textContent),
    ['Red', 'Green', 'Blue']
  );
  assert.equal(output.value, 'red');

  assert.deepEqual(
    visibleSliderKeys(document),
    COLS.map((c) => 'red' + c)
  );
  const labels = visible(document)
    .filter((r) => r.querySelector('input[type="range"]'))
    .map((r) => r.querySelector('label').textContent);
  assert.deepEqual(labels, COLS);
  assert.equal(visibleTotal(document), '+100%');
  const mono = () => byLabel(document, 'Monochrome')[0];
  assert.ok(mono() && !mono().hidden);

  choose(window, output, 'green');
  assert.deepEqual(
    visibleSliderKeys(document),
    COLS.map((c) => 'green' + c)
  );
  assert.equal(visibleTotal(document), '+100%');
  assert.ok(!mono().hidden);

  const greenRed = rows(document)
    .find((r) => r.dataset.key === 'greenRed')
    .querySelector('input');
  greenRed.value = '50';
  greenRed.dispatchEvent(new window.Event('input'));
  assert.equal(visibleTotal(document), '+150%');

  choose(window, output, 'red');
  assert.equal(visibleTotal(document), '+100%');
  choose(window, output, 'green');
  assert.equal(greenRed.value, '50');
  assert.equal(visibleTotal(document), '+150%');
  assert.ok(!mono().hidden);
  cancelAdjust();
});

test('Output Channel and Total are dialog-local and leave params and output alone', () => {
  const window = installDom();
  const { document } = window;
  const params = defaultAdjustmentParams('channelMixer');
  assert.equal('outputChannel' in params, false);
  assert.equal('redTotal' in params, false);
  params.greenRed = 50;
  const layer = { adjustmentId: 'channelMixer', params };
  openAdjustLayer(layer, false, {});
  const before = { ...layer.params };
  choose(window, byLabel(document, 'Output Channel')[0].querySelector('select'), 'blue');
  assert.deepEqual(layer.params, before);

  const img = () => ({ width: 1, height: 1, data: new Uint8ClampedArray([200, 40, 30, 255]) });
  const a = img();
  const b = img();
  applyChannelMixer(a, before, null);
  applyChannelMixer(b, { ...before, outputChannel: 'blue' }, null);
  assert.deepEqual([...a.data], [...b.data]);
  cancelAdjust();
});

test('Monochrome lists only Gray with its own row; unchecking restores Red / Green / Blue', () => {
  const window = installDom();
  const { document } = window;
  const params = defaultAdjustmentParams('channelMixer');
  openAdjustLayer({ adjustmentId: 'channelMixer', params }, false, {});
  const output = () => byLabel(document, 'Output Channel')[0].querySelector('select');
  const optionLabels = () => [...output().options].map((o) => o.textContent);
  const mono = byLabel(document, 'Monochrome')[0].querySelector('input');
  const slider = (key) =>
    rows(document)
      .find((r) => r.dataset.key === key)
      .querySelector('input');
  const toggle = (on) => {
    mono.checked = on;
    mono.dispatchEvent(new window.Event('change'));
  };

  choose(window, output(), 'green');
  slider('greenRed').value = '30';
  slider('greenRed').dispatchEvent(new window.Event('input'));

  toggle(true);
  assert.equal(params.monochrome, true);
  assert.deepEqual(optionLabels(), ['Gray']);
  assert.equal(output().value, 'gray');
  assert.deepEqual(
    visibleSliderKeys(document),
    COLS.map((c) => 'gray' + c)
  );
  assert.deepEqual(
    COLS.map((c) => slider('gray' + c).value),
    ['40', '40', '20', '0']
  );
  assert.equal(visibleTotal(document), '+100%');

  slider('grayBlue').value = '60';
  slider('grayBlue').dispatchEvent(new window.Event('input'));
  assert.equal(visibleTotal(document), '+140%');

  toggle(false);
  assert.equal(params.monochrome, false);
  assert.deepEqual(optionLabels(), ['Red', 'Green', 'Blue']);
  assert.equal(output().value, 'red');
  assert.deepEqual(
    visibleSliderKeys(document),
    COLS.map((c) => 'red' + c)
  );
  assert.equal(params.greenRed, 30);
  assert.equal(params.grayBlue, 60);

  toggle(true);
  assert.equal(slider('grayBlue').value, '60');
  assert.equal(visibleTotal(document), '+140%');
  cancelAdjust();
});
