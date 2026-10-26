import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { GRADIENT_PRESET_GROUPS, resolvePresetStops } from '../paint/gradient-presets.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

// Install the paint DOM with a 2D context stub (jsdom has no canvas).
function installDom() {
  const { window } = new JSDOM(html);
  globalThis.document = window.document;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  window.HTMLCanvasElement.prototype.getContext = function () {
    const noop = () => {};
    return {
      canvas: this,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      clearRect: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      fill: noop,
      stroke: noop,
      fillRect: noop,
      strokeRect: noop
    };
  };
  return window;
}

const { openAdjustLayer, cancelAdjust } = await import('../paint/adjust-modal.js');

const findPreset = (groupName, name) =>
  GRADIENT_PRESET_GROUPS.find((g) => g.name === groupName).presets.find((p) => p.name === name);

function choose(window, select, groupName, name) {
  const gi = GRADIENT_PRESET_GROUPS.findIndex((g) => g.name === groupName);
  const pi = GRADIENT_PRESET_GROUPS[gi].presets.findIndex((p) => p.name === name);
  select.value = `${gi}:${pi}`;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('the Basics group holds PhotoCraft’s three presets', () => {
  const basics = GRADIENT_PRESET_GROUPS[0];
  assert.equal(basics.name, 'Basics');
  assert.deepEqual(
    basics.presets.map((p) => p.name),
    ['Foreground to Background', 'Foreground to Transparent', 'Black, White']
  );
  assert.deepEqual(findPreset('Basics', 'Foreground to Background').stops, [
    [0, 'foreground'],
    [1, 'background']
  ]);
  assert.deepEqual(findPreset('Basics', 'Black, White').stops, [
    [0, '#000000'],
    [1, '#ffffff']
  ]);
  assert.deepEqual(
    GRADIENT_PRESET_GROUPS.map((g) => g.name),
    [
      'Basics',
      'Blues',
      'Purples',
      'Pinks',
      'Reds',
      'Oranges',
      'Greens',
      'Browns',
      'Grays',
      'Rainbows'
    ]
  );
});

test('multi-color presets space their stops evenly at i / (n - 1)', () => {
  const blue2 = findPreset('Blues', 'Blue 02');
  assert.deepEqual(blue2.stops, [
    [0, '#1c2a5a'],
    [0.5, '#3f6fd8'],
    [1, '#a8d4ff']
  ]);
  const rainbow = resolvePresetStops(findPreset('Rainbows', 'Rainbow'));
  assert.equal(rainbow.length, 13);
  rainbow.forEach(([t], i) => assert.equal(t, Math.round((i / 12) * 1000) / 1000));
  assert.deepEqual(rainbow[0], [0, '#ec1313']);
  assert.deepEqual(rainbow[12], [1, '#ec13ec']);
});

test('resolvePresetStops resolves foreground / background into a fresh array', () => {
  const p = findPreset('Basics', 'Foreground to Background');
  const stops = resolvePresetStops(p, '#FF0000', '#00ff00');
  assert.deepEqual(stops, [
    [0, '#ff0000'],
    [1, '#00ff00']
  ]);
  assert.notEqual(stops, resolvePresetStops(p, '#ff0000', '#00ff00'));
  stops[0][1] = '#123456';
  assert.equal(p.stops[0][1], 'foreground');
  assert.deepEqual(resolvePresetStops(p), [
    [0, '#000000'],
    [1, '#ffffff']
  ]);
  assert.deepEqual(
    resolvePresetStops(findPreset('Basics', 'Foreground to Transparent'), '#336699'),
    [
      [0, '#336699'],
      [1, '#336699']
    ]
  );
});

test('choosing a preset replaces params.stops, a stop edit reads Custom, and Cancel restores', () => {
  const window = installDom();
  const stops = [
    [0, '#000000'],
    [1, '#ffffff']
  ];
  const layer = { adjustmentId: 'gradientMap', params: { stops, reverse: false, dither: false } };
  let previews = 0;
  openAdjustLayer(layer, false, {
    swatches: () => ['#ff0000', '#0000ff'],
    onPreview: () => previews++
  });
  const fields = window.document.getElementById('adjust-modal-fields');
  const select = fields.querySelector('select.gradient-map-preset');
  assert.ok(select);
  const strip = fields.querySelector('canvas.gradient-map-strip');
  assert.ok(
    select.compareDocumentPosition(strip) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    'preset sits above the stop strip'
  );
  assert.equal(select.options[0].value, 'custom');
  assert.equal(select.options[0].textContent, 'Custom');
  assert.equal(select.value, 'custom');
  assert.deepEqual(
    [...select.querySelectorAll('optgroup')].map((g) => g.label),
    GRADIENT_PRESET_GROUPS.map((g) => g.name)
  );

  const color = fields.querySelector('.gradient-stop-color');
  // Select the second stop so the pick visibly moves the selection back to stop 0.
  fields.querySelector('.gradient-stop-add').click();
  assert.equal(fields.querySelector('.gradient-stop-location').value, '50');

  const before = previews;
  const added = layer.params.stops;
  choose(window, select, 'Basics', 'Foreground to Background');
  assert.notEqual(layer.params.stops, added);
  assert.deepEqual(layer.params.stops, [
    [0, '#ff0000'],
    [1, '#0000ff']
  ]);
  assert.deepEqual(added.length, 3, 'the old array is not mutated');
  assert.equal(color.value, '#ff0000');
  assert.equal(fields.querySelector('.gradient-stop-location').value, '0');
  assert.ok(previews > before);
  assert.notEqual(select.value, 'custom');

  choose(window, select, 'Grays', 'Gray 03');
  assert.deepEqual(layer.params.stops, [
    [0, '#000000'],
    [0.5, '#6c757d'],
    [1, '#ffffff']
  ]);

  color.value = '#112233';
  color.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(select.value, 'custom');
  assert.deepEqual(layer.params.stops[0], [0, '#112233']);

  cancelAdjust();
  assert.equal(layer.params.stops, stops);
  assert.deepEqual(stops, [
    [0, '#000000'],
    [1, '#ffffff']
  ]);
});

test('Foreground / Background fall back to black / white without swatches', () => {
  const window = installDom();
  const layer = {
    adjustmentId: 'gradientMap',
    params: {
      stops: [
        [0, '#ff0000'],
        [1, '#00ff00']
      ],
      reverse: false,
      dither: false
    }
  };
  openAdjustLayer(layer, false, {});
  const select = window.document.querySelector('select.gradient-map-preset');
  choose(window, select, 'Basics', 'Foreground to Background');
  assert.deepEqual(layer.params.stops, [
    [0, '#000000'],
    [1, '#ffffff']
  ]);
  cancelAdjust();
});
