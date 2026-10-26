import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { autoLevelsParams, levelsHistograms } from '../paint/adjustments.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

// Install the paint DOM. With a stub, canvas getContext('2d') returns a recorder of fillRect calls.
function installDom(calls = null) {
  const { window } = new JSDOM(html);
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  if (calls) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      const canvas = this;
      const noop = () => {};
      return {
        canvas,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        clearRect: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        stroke: noop,
        fillRect(x, y, w, h) {
          calls.push({ canvas, fillStyle: this.fillStyle, x, y, w, h });
        }
      };
    };
  }
  return window;
}

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

test('the composite counts each pixel once at floor((R + G + B) / 3)', () => {
  const data = new Uint8ClampedArray([
    10,
    20,
    31,
    255, // 61 / 3 → 20
    255,
    255,
    254,
    255, // 764 / 3 → 254
    0,
    0,
    2,
    9, // 2 / 3 → 0
    90,
    90,
    90,
    0, // transparent: skipped
    100,
    100,
    100,
    255 // masked out below
  ]);
  const img = { width: 5, height: 1, data };
  const h = levelsHistograms(img);
  assert.equal(h.length, 4);
  assert.equal(h[3][20], 1);
  assert.equal(h[3][254], 1);
  assert.equal(h[3][0], 1);
  assert.equal(h[3][90], 0);
  assert.equal(h[3][100], 1);
  assert.equal(
    h[3].reduce((a, v) => a + v, 0),
    4
  );
  // R, G, B stay per-channel counts.
  assert.equal(h[0][10], 1);
  assert.equal(h[2][31], 1);

  const hm = levelsHistograms(img, new Uint8Array([1, 1, 1, 1, 0]));
  assert.equal(hm[3][100], 0);
  assert.equal(
    hm[3].reduce((a, v) => a + v, 0),
    3
  );
});

test('Image menu Auto commands are unchanged by the composite histogram', () => {
  const img = fakeCtx().getImageData();
  const tone = autoLevelsParams(img, 'tone');
  assert.deepEqual([tone.redBlack, tone.redWhite], [10, 200]);
  assert.deepEqual([tone.blueBlack, tone.blueWhite], [30, 220]);
  const contrast = autoLevelsParams(img, 'contrast');
  assert.deepEqual([contrast.greenBlack, contrast.greenWhite], [10, 220]);
  assert.equal(tone.black, 0);
  assert.equal(tone.white, 255);
});

test('Levels RGB Auto reads the composite, not the summed channels', () => {
  const window = installDom();
  openAdjust('levels', { sel: { mode: 'none' } }, { activeCtx: fakeCtx, pushUndo() {} });
  const fields = window.document.getElementById('adjust-modal-fields');
  const auto = [...fields.querySelectorAll('button')].find((b) => b.textContent === 'Auto');
  auto.click();
  const slider = (key) => fields.querySelector(`[data-key="${key}"] input[type="range"]`);
  // Composite bins 20, 60, 210; the summed counts would give 10 and 220.
  assert.equal(slider('black').value, '20');
  assert.equal(slider('white').value, '210');
  cancelAdjust();
});

test('the Curves graph draws histogram bars behind the grid and redraws per channel', () => {
  const calls = [];
  const window = installDom(calls);
  openAdjust('curves', { sel: { mode: 'none' } }, { activeCtx: fakeCtx, pushUndo() {} });
  const fields = window.document.getElementById('adjust-modal-fields');
  const graph = fields.querySelector('canvas.curve-graph');
  assert.ok(graph);
  // Histogram bars are one bin wide (256 / 256) with x at the bin; control points are 6 × 6.
  const bars = () => calls.filter((c) => c.canvas === graph && c.w === 1);
  const barX = () => bars().map((c) => c.x);
  // RGB → composite bins 20, 60, 210.
  assert.deepEqual(barX(), [20, 60, 210]);
  assert.ok(calls.some((c) => c.canvas === graph && c.w === 6));

  calls.length = 0;
  const select = fields.querySelector('select');
  select.value = 'red';
  select.dispatchEvent(new window.Event('change'));
  assert.deepEqual(barX(), [10, 50, 200]);

  calls.length = 0;
  graph.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 128, clientY: 64 }));
  assert.deepEqual(barX(), [10, 50, 200]);
  cancelAdjust();
});

test('Brightness / Contrast and Curves adjustment layers draw no histogram', async () => {
  const calls = [];
  installDom(calls);
  openAdjust('brightness', { sel: { mode: 'none' } }, { activeCtx: fakeCtx, pushUndo() {} });
  const fields = document.getElementById('adjust-modal-fields');
  assert.equal(fields.querySelector('canvas.levels-histogram'), null);
  assert.equal(fields.querySelector('canvas.curve-graph'), null);
  assert.equal(calls.length, 0);
  cancelAdjust();

  const { openAdjustLayer } = await import('../paint/adjust-modal.js');
  const { defaultAdjustmentParams } = await import('../paint/adjustment-layers.js');
  const layer = { adjustmentId: 'curves', params: defaultAdjustmentParams('curves') };
  openAdjustLayer(layer, false, {});
  assert.ok(document.querySelector('canvas.curve-graph'));
  assert.equal(calls.filter((c) => c.w === 1).length, 0);
  assert.ok(calls.some((c) => c.w === 6));
  cancelAdjust();
});
