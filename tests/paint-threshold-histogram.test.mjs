import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ADJUSTMENTS } from '../paint/adjustments.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

// Install the paint DOM with a canvas getContext('2d') stub that records fillRect and moveTo.
function installDom(calls) {
  const { window } = new JSDOM(html);
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
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
      lineTo: noop,
      stroke: noop,
      moveTo(x, y) {
        calls.push({ canvas, op: 'moveTo', x, y });
      },
      fillRect(x, y, w, h) {
        calls.push({ canvas, op: 'fillRect', x, y, w, h });
      }
    };
  };
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

const { openAdjust, openAdjustLayer, cancelAdjust } = await import('../paint/adjust-modal.js');

test('Threshold Level ranges 1..255 with default 128, and level 0 still applies', () => {
  const [f] = ADJUSTMENTS.threshold.fields;
  assert.equal(f.label, 'Threshold Level');
  assert.equal(f.min, 1);
  assert.equal(f.max, 255);
  assert.equal(f.default, 128);
  const img = { width: 1, height: 1, data: new Uint8ClampedArray([1, 1, 1, 255]) };
  ADJUSTMENTS.threshold.apply(img, { level: 0 }, null);
  assert.deepEqual([...img.data], [255, 255, 255, 255]);
});

test('Threshold draws composite bars above its slider and moves the level marker', () => {
  const calls = [];
  const window = installDom(calls);
  openAdjust('threshold', { sel: { mode: 'none' } }, { activeCtx: fakeCtx, pushUndo() {} });
  const fields = window.document.getElementById('adjust-modal-fields');
  const strip = fields.querySelector('canvas.threshold-histogram');
  assert.ok(strip);
  assert.equal(strip.width, 256);
  assert.equal(strip.height, 90);
  const slider = fields.querySelector('[data-key="level"] input[type="range"]');
  assert.ok(strip.compareDocumentPosition(slider) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(slider.min, '1');
  assert.equal(slider.max, '255');

  const bars = () => calls.filter((c) => c.canvas === strip && c.op === 'fillRect' && c.w === 1);
  const marker = () => calls.filter((c) => c.canvas === strip && c.op === 'moveTo');
  // Composite bins floor((R + G + B) / 3): 20, 60, 210; the transparent pixel is skipped.
  assert.deepEqual(
    bars().map((c) => c.x),
    [20, 60, 210]
  );
  assert.deepEqual(
    marker().map((c) => c.x),
    [(128 / 255) * 256]
  );

  calls.length = 0;
  slider.value = '51';
  slider.dispatchEvent(new window.Event('input'));
  assert.deepEqual(
    marker().map((c) => c.x),
    [(51 / 255) * 256]
  );
  assert.equal(bars().length, 3);
  cancelAdjust();
});

test('Brightness / Contrast has no threshold strip; a Threshold layer draws only the marker', () => {
  const calls = [];
  installDom(calls);
  openAdjust('brightness', { sel: { mode: 'none' } }, { activeCtx: fakeCtx, pushUndo() {} });
  assert.equal(document.querySelector('canvas.threshold-histogram'), null);
  cancelAdjust();

  calls.length = 0;
  openAdjustLayer({ adjustmentId: 'threshold', params: { level: 100 } }, false, {});
  const strip = document.querySelector('canvas.threshold-histogram');
  assert.ok(strip);
  assert.equal(calls.filter((c) => c.op === 'fillRect').length, 0);
  assert.equal(calls.filter((c) => c.canvas === strip && c.op === 'moveTo').length, 1);
  cancelAdjust();
});
