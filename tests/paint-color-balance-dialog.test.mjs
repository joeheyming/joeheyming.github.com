import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ADJUSTMENTS, COLOR_BALANCE_TONES, applyColorBalance } from '../paint/adjustments.js';
import { defaultAdjustmentParams } from '../paint/adjustment-layers.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
const AXES = ['R', 'G', 'B'];
const LABELS = ['Cyan · Red', 'Magenta · Green', 'Yellow · Blue'];

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

function visibleSliders(document) {
  return fieldRows(document).filter(
    (row) => !row.hidden && row.querySelector('input[type="range"]')
  );
}

function rowByLabel(document, text) {
  return fieldRows(document).find((r) => r.querySelector('label').textContent === text);
}

function choose(window, select, value) {
  select.value = value;
  select.dispatchEvent(new window.Event('change'));
}

test('Color Balance dialog shows one Tone at a time', () => {
  const window = installDom();
  const { document } = window;
  openAdjust('colorBalance', { sel: { mode: 'none' } }, { activeCtx: fakeCtx, pushUndo() {} });

  const tone = rowByLabel(document, 'Tone').querySelector('select');
  assert.deepEqual(
    [...tone.options].map((o) => o.value),
    COLOR_BALANCE_TONES
  );
  assert.deepEqual(
    [...tone.options].map((o) => o.textContent),
    ['Shadows', 'Midtones', 'Highlights']
  );
  assert.equal(tone.value, 'midtones');
  assert.deepEqual(
    visibleSliders(document).map((r) => r.dataset.key),
    AXES.map((c) => 'midtones' + c)
  );
  assert.deepEqual(
    visibleSliders(document).map((r) => r.querySelector('label').textContent),
    LABELS
  );
  const preserve = () => rowByLabel(document, 'Preserve Luminosity');
  assert.ok(preserve() && !preserve().hidden);

  choose(window, tone, 'shadows');
  const shadowsR = fieldRows(document).find((r) => r.dataset.key === 'shadowsR');
  const slider = shadowsR.querySelector('input');
  slider.value = '-35';
  slider.dispatchEvent(new window.Event('input'));

  choose(window, tone, 'highlights');
  assert.deepEqual(
    visibleSliders(document).map((r) => r.dataset.key),
    AXES.map((c) => 'highlights' + c)
  );
  assert.equal(shadowsR.hidden, true);
  assert.ok(!preserve().hidden);

  choose(window, tone, 'shadows');
  assert.deepEqual(
    visibleSliders(document).map((r) => r.dataset.key),
    AXES.map((c) => 'shadows' + c)
  );
  assert.equal(shadowsR.querySelector('input').value, '-35');
  cancelAdjust();
});

test('the Tone choice is dialog-local and leaves params and output alone', () => {
  const window = installDom();
  const { document } = window;
  const defaults = defaultAdjustmentParams('colorBalance');
  assert.equal('tone' in defaults, false);
  const keys = COLOR_BALANCE_TONES.flatMap((t) => AXES.map((c) => t + c));
  assert.deepEqual(Object.keys(defaults).sort(), [...keys, 'preserveLuminosity'].sort());
  assert.ok(ADJUSTMENTS.colorBalance.fields.find((f) => f.key === 'tone').local);

  const params = { ...defaults, midtonesR: 30, shadowsB: -20 };
  const layer = { adjustmentId: 'colorBalance', params };
  openAdjustLayer(layer, false, {});
  const before = { ...layer.params };
  choose(window, rowByLabel(document, 'Tone').querySelector('select'), 'highlights');
  assert.deepEqual(layer.params, before);
  assert.equal('tone' in layer.params, false);

  const img = () => ({ width: 1, height: 1, data: new Uint8ClampedArray([200, 90, 40, 255]) });
  const a = img();
  const b = img();
  applyColorBalance(a, before, null);
  applyColorBalance(b, { ...before, tone: 'highlights' }, null);
  assert.deepEqual([...a.data], [...b.data]);
  cancelAdjust();
});
