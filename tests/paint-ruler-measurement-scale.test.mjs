// Ruler › Use Measurement Scale (PhotoCraft analysis_ui.rs options_bar Tool::Ruler,
// crates/doc/src/analysis.rs MeasurementScale::factor).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MEASUREMENT_SCALE,
  TOOL_OPTION_SCHEMA,
  measurementScaleFactor
} from '../paint/tools.js';
import { deserializeProject, serializeProject } from '../paint/project.js';

const CM = { pixelLength: 120, logicalLength: 3, units: 'cm' };

test('measurementScaleFactor is logical / pixel length, 1 when the pixel length is 0', () => {
  assert.deepEqual(DEFAULT_MEASUREMENT_SCALE, {
    pixelLength: 1,
    logicalLength: 1,
    units: 'pixels'
  });
  assert.ok(Object.isFrozen(DEFAULT_MEASUREMENT_SCALE));
  assert.equal(measurementScaleFactor(DEFAULT_MEASUREMENT_SCALE), 1);
  assert.equal(measurementScaleFactor({ pixelLength: 120, logicalLength: 3 }), 0.025);
  assert.equal(measurementScaleFactor({ pixelLength: 0, logicalLength: 3 }), 1);
});

test('Use Measurement Scale sits between L2 and Straighten Layer, off by default', () => {
  const keys = TOOL_OPTION_SCHEMA.ruler.map((o) => o.key);
  const at = keys.indexOf('rulerUseScale');
  assert.equal(keys[at - 1], 'rulerL2');
  assert.equal(keys[at + 1], '_rulerStraighten');
  const opt = TOOL_OPTION_SCHEMA.ruler[at];
  assert.equal(opt.type, 'checkbox');
  assert.equal(opt.label, 'Use Measurement Scale');
  assert.equal(opt.default, false);
});

function readouts(values) {
  return Object.fromEntries(
    TOOL_OPTION_SCHEMA.ruler
      .filter((o) => o.type === 'readout')
      .map((o) => [o.label, o.text(values)])
  );
}

test('the readouts switch to the scale units while the checkbox is on; A never scales', () => {
  const ruler = { start: [120, 240], end: [480, 720] };
  const off = readouts({ ruler, measurementScale: CM, rulerUseScale: false });
  assert.deepEqual(off, {
    'X:': '120.00',
    'Y:': '240.00',
    'W:': '360.00',
    'H:': '480.00',
    'A:': '-53.13',
    'L1:': '600.00',
    'L2:': ''
  });
  const on = readouts({ ruler, measurementScale: CM, rulerUseScale: true });
  assert.deepEqual(on, {
    'X:': '3.00',
    'Y:': '6.00',
    'W:': '9.00',
    'H:': '12.00',
    'A:': '-53.13',
    'L1:': '15.00',
    'L2:': ''
  });
  // With a protractor, L2 scales too and A is the angle between the arms.
  const withQ = readouts({
    ruler: { start: [0, 0], end: [240, 0], protractor: [0, -120] },
    measurementScale: CM,
    rulerUseScale: true
  });
  assert.equal(withQ['L1:'], '6.00');
  assert.equal(withQ['L2:'], '3.00');
  assert.equal(withQ['A:'], '90.00');
  // No ruler: every readout is blank either way.
  const none = readouts({ ruler: null, measurementScale: CM, rulerUseScale: true });
  assert.ok(Object.values(none).every((t) => t === ''));
});

test('.paintproj saves the measurement scale and older projects open with the default', async () => {
  const state = { layers: [], objects: [], measurementScale: CM };
  const data = serializeProject(state, 2, 2);
  assert.deepEqual(data.measurementScale, CM);
  let loaded;
  await deserializeProject(JSON.parse(JSON.stringify(data)), (doc) => (loaded = doc));
  assert.deepEqual(loaded.measurementScale, CM);
  delete data.measurementScale;
  await deserializeProject(data, (doc) => (loaded = doc));
  assert.deepEqual(loaded.measurementScale, DEFAULT_MEASUREMENT_SCALE);
  assert.notEqual(loaded.measurementScale, DEFAULT_MEASUREMENT_SCALE);
  assert.ok(!Object.isFrozen(loaded.measurementScale));
});
