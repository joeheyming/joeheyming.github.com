// Perspective Crop options bar (PhotoCraft perspective_crop_ui.rs options_bar, draw_overlay
// perspective_crop_grid, the_options_bar_swap_button_swaps_w_and_h).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, TOOL_OPTION_SCHEMA, defaultToolOptions } from '../paint/tools.js';

const schema = TOOL_OPTION_SCHEMA.perspectiveCrop;
const field = (key) => schema.find((o) => o.key === key);

// What paint.js refreshToolOptions does with a patch: W and H land on the Crop tool's options.
function applyPatch(state, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'cropW' || k === 'cropH') state.toolOptions.crop[k] = v;
    else state.toolOptions.perspectiveCrop[k] = v;
  }
}

function barValues(state, docSize) {
  return {
    ...state.toolOptions.perspectiveCrop,
    cropW: state.toolOptions.crop.cropW,
    cropH: state.toolOptions.crop.cropH,
    docSize
  };
}

// A stub overlay context that counts moveTo / lineTo calls and ignores every other call.
function overlay(width = 200, height = 150) {
  const target = { canvas: { width, height }, segments: 0 };
  target.lineTo = () => target.segments++;
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => {}),
    set: (t, key, value) => ((t[key] = value), true)
  });
}

test('the bar lists W, swap, H, Front Image, Clear, Show Grid, then cancel and commit', () => {
  const rows = schema.filter((o) => o.type !== 'hint');
  assert.deepEqual(
    rows.map((o) => o.key),
    [
      'cropW',
      '_pcropSwap',
      'cropH',
      '_pcropFront',
      '_pcropClear',
      'pcropGrid',
      '_pcropCancel',
      '_pcropCommit'
    ]
  );
  assert.equal(field('_pcropSwap').type, 'iconAction');
  assert.equal(field('_pcropSwap').title, 'Swaps height and width');
  assert.equal(field('_pcropFront').label, 'Front Image');
  assert.equal(field('_pcropClear').label, 'Clear');
  assert.equal(field('pcropGrid').type, 'checkbox');
  assert.equal(field('pcropGrid').label, 'Show Grid');
  assert.equal(defaultToolOptions().perspectiveCrop.pcropGrid, true);
  assert.ok(!('_pcropFront' in defaultToolOptions().perspectiveCrop), 'actions hold no value');
});

test('swap exchanges the Crop W and H while the Crop Ratio is not W x H', () => {
  const state = { toolOptions: defaultToolOptions() };
  Object.assign(state.toolOptions.crop, { cropW: '4', cropH: '6' });
  const ratio = state.toolOptions.crop.ratio;
  applyPatch(state, field('_pcropSwap').patch(barValues(state, [200, 150])));
  assert.equal(state.toolOptions.crop.cropW, '6');
  assert.equal(state.toolOptions.crop.cropH, '4');
  assert.equal(state.toolOptions.crop.ratio, ratio);
});

test('Front Image fills the document size and Clear empties both fields', () => {
  const state = { toolOptions: defaultToolOptions() };
  applyPatch(state, field('_pcropFront').patch(barValues(state, [200, 150])));
  assert.equal(state.toolOptions.crop.cropW, '200');
  assert.equal(state.toolOptions.crop.cropH, '150');
  applyPatch(state, field('_pcropClear').patch(barValues(state, [200, 150])));
  assert.equal(state.toolOptions.crop.cropW, '');
  assert.equal(state.toolOptions.crop.cropH, '');
});

test('Show Grid off draws only the outline, fewer segments than with the grid', () => {
  const quad = [
    [20, 10],
    [120, 10],
    [120, 90],
    [20, 90]
  ];
  const draw = (grid) => {
    const state = { toolOptions: defaultToolOptions(), zoom: 1, perspectiveQuad: quad };
    state.toolOptions.perspectiveCrop.pcropGrid = grid;
    const ov = overlay();
    TOOLS.perspectiveCrop.onUp(null, ov, state, 0, 0);
    return ov.segments;
  };
  const withGrid = draw(true);
  const without = draw(false);
  assert.equal(without, 3, 'the outline alone is moveTo + three lineTo');
  assert.ok(withGrid > without, `${withGrid} > ${without}`);
});
