import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { ADJUSTMENTS, applyGradientMap } from '../paint/adjustments.js';
import {
  addStopAt,
  addStopInWidestGap,
  moveMapStop,
  normalizeStops,
  removeStop,
  sampleStops
} from '../paint/gradient-stops.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

// Install the paint DOM with a 2D context stub that records rect draws.
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
      moveTo: noop,
      lineTo: noop,
      fill: noop,
      stroke: noop,
      fillRect(x, y, w, h) {
        calls.push({ op: 'fill', style: this.fillStyle, x, y, w, h });
      },
      strokeRect(x, y, w, h) {
        calls.push({ op: 'stroke', style: this.strokeStyle, x, y, w, h });
      }
    };
  };
  return window;
}

const { openAdjustLayer, cancelAdjust } = await import('../paint/adjust-modal.js');

// The strip's bar runs from x 8 to 292 (300 wide, inset 8); markers sit below y 26.
const stripX = (loc) => 8 + loc * 284;

function pointer(window, el, type, x, y) {
  el.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

const near = (a, b, eps = 1e-6) =>
  b.forEach((v, i) => assert.ok(Math.abs(a[i] - v) < eps, `${a} vs ${b}`));

test('normalizeStops rounds, clamps, sorts, and falls back below two stops', () => {
  assert.deepEqual(normalizeStops(undefined), [
    [0, '#000000'],
    [1, '#ffffff']
  ]);
  assert.deepEqual(normalizeStops([[0.5, '#ff0000']]), [
    [0, '#000000'],
    [1, '#ffffff']
  ]);
  assert.deepEqual(
    normalizeStops([
      [1.5, '#FFFFFF'],
      [0.12345, 'nope'],
      ['x', '#ff0000'],
      [-1, '#00ff00']
    ]),
    [
      [0, '#00ff00'],
      [0.123, '#000000'],
      [1, '#ffffff']
    ]
  );
});

test('sampleStops interpolates the sorted stops', () => {
  const stops = [
    [1, '#ffffff'],
    [0, '#000000'],
    [0.5, '#ff0000']
  ];
  near(sampleStops(stops, 0.25), [0.5, 0, 0]);
  near(sampleStops(stops, 0.75), [1, 0.5, 0.5]);
  near(sampleStops(stops, 0), [0, 0, 0]);
});

test('moveMapStop keeps the same stop selected when it crosses another', () => {
  const stops = [
    [0, '#000000'],
    [0.5, '#ff0000'],
    [1, '#ffffff']
  ];
  const frozen = JSON.stringify(stops);
  assert.deepEqual(moveMapStop(stops, 0, 0.7), {
    stops: [
      [0.5, '#ff0000'],
      [0.7, '#000000'],
      [1, '#ffffff']
    ],
    index: 1
  });
  // Onto a coincident stop: the later index stays after it, the earlier before it.
  assert.equal(moveMapStop(stops, 2, 0.5).index, 2);
  assert.equal(moveMapStop(stops, 2, 0.5).stops[2][1], '#ffffff');
  assert.equal(moveMapStop(stops, 0, 0.5).index, 0);
  assert.equal(moveMapStop(stops, 0, 0.5).stops[0][1], '#000000');
  assert.equal(moveMapStop(stops, 1, 0.33333).stops[1][0], 0.333);
  assert.equal(JSON.stringify(stops), frozen);
});

test('Add Stop goes halfway along the widest gap in the sampled color', () => {
  const r = addStopInWidestGap([
    [0, '#000000'],
    [0.25, '#000000'],
    [1, '#ffffff']
  ]);
  assert.equal(r.index, 2);
  assert.deepEqual(r.stops[2], [0.625, '#808080']);
  // Equal gaps: the last one wins, as Rust's max_by does.
  const tie = addStopInWidestGap([
    [0, '#000000'],
    [0.5, '#000000'],
    [1, '#ffffff']
  ]);
  assert.deepEqual(tie.stops[tie.index], [0.75, '#808080']);
  const full = Array.from({ length: 64 }, (_, i) => [i / 63, '#000000']);
  assert.equal(addStopAt(full, 0.5), null);
  assert.equal(addStopInWidestGap(full), null);
});

test('removeStop keeps two stops', () => {
  const two = [
    [0, '#000000'],
    [1, '#ffffff']
  ];
  assert.equal(removeStop(two, 0).stops, two);
  const r = removeStop([...two, [1, '#ff0000']], 2);
  assert.equal(r.stops.length, 2);
  assert.equal(r.index, 1);
});

test('a three-stop gradient maps mid grey to the middle stop', () => {
  const img = { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) };
  applyGradientMap(img, {
    stops: [
      [0, '#000000'],
      [0.5, '#ff0000'],
      [1, '#ffffff']
    ]
  });
  near([...img.data], [255, 0, 0, 255], 1.5);
});

test('legacy startColor / endColor params still map as two stops', () => {
  const img = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
  ADJUSTMENTS.gradientMap.apply(img, { startColor: '#ff0000', endColor: '#0000ff' }, null);
  assert.deepEqual([...img.data], [255, 0, 0, 255]);
  const short = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) };
  applyGradientMap(short, { stops: [[0, '#ff0000']] });
  assert.deepEqual([...short.data], [255, 255, 255, 255]);
});

test('clicking the strip adds a stop, dragging moves it, and Cancel keeps the old stops', () => {
  const calls = [];
  const window = installDom(calls);
  const stops = [
    [0, '#000000'],
    [1, '#ffffff']
  ];
  const layer = { adjustmentId: 'gradientMap', params: { stops, reverse: false, dither: false } };
  openAdjustLayer(layer, false, {});
  const fields = window.document.getElementById('adjust-modal-fields');
  const strip = fields.querySelector('canvas.gradient-map-strip');
  assert.ok(strip);
  assert.equal(fields.querySelector('[data-key="startColor"]'), null);
  assert.ok(fields.querySelector('[data-key="reverse"] input[type=checkbox]'));
  assert.ok(fields.querySelector('[data-key="dither"] input[type=checkbox]'));
  const remove = fields.querySelector('.gradient-stop-remove');
  const location = fields.querySelector('.gradient-stop-location');
  const color = fields.querySelector('.gradient-stop-color');
  assert.equal(remove.disabled, true);
  // One marker swatch per stop, the selected one in the accent color.
  const markers = calls.filter((c) => c.op === 'stroke' && c.w === 11);
  assert.equal(markers.length, 2);
  assert.notEqual(markers[0].style, markers[1].style);

  pointer(window, strip, 'pointerdown', stripX(0.25), 10);
  pointer(window, strip, 'pointerup', stripX(0.25), 10);
  assert.notEqual(layer.params.stops, stops);
  assert.deepEqual(layer.params.stops, [
    [0, '#000000'],
    [0.25, '#404040'],
    [1, '#ffffff']
  ]);
  assert.equal(location.value, '25');
  assert.equal(color.value, '#404040');
  assert.equal(remove.disabled, false);

  // Drag the black stop past the new one; it stays selected.
  pointer(window, strip, 'pointerdown', stripX(0), 32);
  pointer(window, strip, 'pointermove', stripX(0.5), 32);
  pointer(window, strip, 'pointerup', stripX(0.5), 32);
  assert.deepEqual(layer.params.stops, [
    [0.25, '#404040'],
    [0.5, '#000000'],
    [1, '#ffffff']
  ]);
  assert.equal(location.value, '50');
  assert.equal(color.value, '#000000');

  remove.click();
  assert.deepEqual(layer.params.stops, [
    [0.25, '#404040'],
    [1, '#ffffff']
  ]);

  cancelAdjust();
  assert.equal(layer.params.stops, stops);
  assert.deepEqual(stops, [
    [0, '#000000'],
    [1, '#ffffff']
  ]);
});

test('a legacy layer edits as two stops, and Cancel drops the added stops key', () => {
  const window = installDom([]);
  const layer = {
    adjustmentId: 'gradientMap',
    params: { startColor: '#ff0000', endColor: '#0000ff', reverse: false, dither: false }
  };
  openAdjustLayer(layer, false, {});
  const fields = window.document.getElementById('adjust-modal-fields');
  assert.equal(fields.querySelector('.gradient-stop-color').value, '#ff0000');
  fields.querySelector('.gradient-stop-add').click();
  assert.deepEqual(layer.params.stops, [
    [0, '#ff0000'],
    [0.5, '#800080'],
    [1, '#0000ff']
  ]);
  cancelAdjust();
  assert.equal('stops' in layer.params, false);
  assert.equal(layer.params.startColor, '#ff0000');
});
