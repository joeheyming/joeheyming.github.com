import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CROP_SHIELD_DEFAULTS, cropShieldFill, drawCropOverlay } from '../paint/crop-frame.js';
import { TOOLS, TOOL_OPTION_SCHEMA, cropToolShield, defaultToolOptions } from '../paint/tools.js';

const CANVAS = [40, 40, 40];

// Records each fillStyle assigned before a fill call.
function recordingOverlay(width = 400, height = 300) {
  const fills = [];
  const target = { canvas: { width, height }, fills, fillStyle: null };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'fill') return () => fills.push(t.fillStyle);
      return () => {};
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    }
  });
}

function cropState(frame = [20, 20, 200, 150]) {
  return { toolOptions: defaultToolOptions(), zoom: 1, cropFrame: frame, cropAngle: 0 };
}

test('CROP_SHIELD_DEFAULTS match PhotoCraft (Photoshop) defaults', () => {
  assert.deepEqual(
    { ...CROP_SHIELD_DEFAULTS },
    {
      showCroppedArea: true,
      enabled: true,
      color: 'canvas',
      customColor: '#000000',
      opacity: 75,
      autoAdjust: true
    }
  );
  assert.ok(Object.isFrozen(CROP_SHIELD_DEFAULTS));
});

test('cropShieldFill: Match Canvas at 75 % is alpha 191', () => {
  assert.deepEqual(cropShieldFill(CROP_SHIELD_DEFAULTS, CANVAS, false), [40, 40, 40, 191]);
});

test('cropShieldFill: Auto Adjust halves the opacity while editing', () => {
  assert.deepEqual(cropShieldFill(CROP_SHIELD_DEFAULTS, CANVAS, true), [40, 40, 40, 96]);
  const fixed = { ...CROP_SHIELD_DEFAULTS, autoAdjust: false };
  assert.deepEqual(cropShieldFill(fixed, CANVAS, true), [40, 40, 40, 191]);
});

test('cropShieldFill: disabled or 0 % draws no shield', () => {
  const off = { ...CROP_SHIELD_DEFAULTS, enabled: false };
  assert.equal(cropShieldFill(off, CANVAS, false), null);
  assert.equal(cropShieldFill(off, CANVAS, true), null);
  assert.equal(cropShieldFill({ ...CROP_SHIELD_DEFAULTS, opacity: 0 }, CANVAS, false), null);
});

test('cropShieldFill: Custom colour and Match Canvas at 100 %', () => {
  const custom = { ...CROP_SHIELD_DEFAULTS, color: 'custom', customColor: '#c80a1e', opacity: 100 };
  assert.deepEqual(cropShieldFill(custom, CANVAS, false), [200, 10, 30, 255]);
  const full = { ...CROP_SHIELD_DEFAULTS, opacity: 100 };
  assert.deepEqual(cropShieldFill(full, [184, 184, 184], false), [184, 184, 184, 255]);
});

test('cropShieldFill: hidden cropped area is the opaque canvas whatever the shield', () => {
  for (const enabled of [true, false]) {
    for (const editing of [true, false]) {
      const s = {
        ...CROP_SHIELD_DEFAULTS,
        showCroppedArea: false,
        enabled,
        color: 'custom',
        customColor: '#ff0000',
        opacity: 10
      };
      assert.deepEqual(cropShieldFill(s, CANVAS, editing), [40, 40, 40, 255]);
    }
  }
});

test('cropShieldFill: stray opacities fall back or clamp', () => {
  for (const [o, want] of [
    [NaN, 191],
    [Infinity, 191],
    [-Infinity, 191],
    [-20, null],
    [250, 255],
    [40, 102]
  ]) {
    const fill = cropShieldFill({ ...CROP_SHIELD_DEFAULTS, opacity: o }, CANVAS, false);
    assert.equal(fill ? fill[3] : null, want, String(o));
  }
});

test('drawCropOverlay shades with the shield fill and skips a null one', () => {
  const ov = recordingOverlay();
  drawCropOverlay(ov, [20, 20, 200, 150]);
  assert.deepEqual(ov.fills, ['rgba(0, 0, 0, 0.749)']);

  const custom = recordingOverlay();
  drawCropOverlay(custom, [20, 20, 200, 150], 1, 0, null, [40, 40, 40, 96]);
  assert.deepEqual(custom.fills, ['rgba(40, 40, 40, 0.3765)']);

  const none = recordingOverlay();
  drawCropOverlay(none, [20, 20, 200, 150], 1, 0, null, null);
  assert.deepEqual(none.fills, []);
});

test('the Crop tool draws its shield from the options and the canvas colour', () => {
  const ov = recordingOverlay();
  const state = { ...cropState(), canvasRgb: CANVAS };
  TOOLS.crop.redraw(ov, state);
  assert.deepEqual(ov.fills, ['rgba(40, 40, 40, 0.749)']);

  state.toolOptions.crop.cropShield = false;
  const off = recordingOverlay();
  TOOLS.crop.redraw(off, state);
  assert.deepEqual(off.fills, []);
});

test('the Crop schema holds the shield fields in PhotoCraft order', () => {
  const schema = TOOL_OPTION_SCHEMA.crop;
  const keys = schema.map((o) => o.key);
  const shield = [
    'cropShieldShow',
    'cropShield',
    'cropShieldColor',
    'cropShieldCustom',
    'cropShieldOpacity',
    'cropShieldAuto'
  ];
  const at = keys.indexOf('cropShieldShow');
  assert.deepEqual(keys.slice(at, at + shield.length), shield);
  const by = Object.fromEntries(schema.map((o) => [o.key, o]));
  assert.equal(by.cropShieldShow.type, 'checkbox');
  assert.equal(by.cropShieldShow.label, 'Show Cropped Area');
  assert.equal(by.cropShield.type, 'checkbox');
  assert.equal(by.cropShield.label, 'Enable Crop Shield');
  assert.deepEqual(
    by.cropShieldColor.options.map((o) => o.label),
    ['Match Canvas', 'Custom']
  );
  assert.equal(by.cropShieldCustom.type, 'color');
  assert.deepEqual(by.cropShieldCustom.shownWhen, { key: 'cropShieldColor', value: 'custom' });
  assert.equal(by.cropShieldOpacity.type, 'number');
  assert.equal(by.cropShieldOpacity.min, 0);
  assert.equal(by.cropShieldOpacity.max, 100);
  assert.equal(by.cropShieldAuto.label, 'Auto Adjust Opacity');
  assert.deepEqual(cropToolShield({ toolOptions: defaultToolOptions() }), {
    ...CROP_SHIELD_DEFAULTS
  });
});

test('H toggles Show Cropped Area only with a frame and no drag', () => {
  const state = { ...cropState(), canvasRgb: CANVAS };
  const ov = recordingOverlay();
  assert.equal(TOOLS.crop.toggleCroppedArea(ov, state), true);
  assert.equal(state.toolOptions.crop.cropShieldShow, false);
  assert.deepEqual(ov.fills, ['rgba(40, 40, 40, 1)']);
  assert.equal(TOOLS.crop.toggleCroppedArea(ov, state), true);
  assert.equal(state.toolOptions.crop.cropShieldShow, true);

  state.cropDrag = { hit: 'move' };
  assert.equal(TOOLS.crop.toggleCroppedArea(ov, state), false);
  assert.equal(state.toolOptions.crop.cropShieldShow, true);

  const empty = { ...cropState(null) };
  assert.equal(TOOLS.crop.toggleCroppedArea(ov, empty), false);
  assert.equal(empty.toolOptions.crop.cropShieldShow, true);
});
