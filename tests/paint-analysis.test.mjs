// Image › Analysis › Set Measurement Scale… and the Count tool (PhotoCraft analysis_ui.rs,
// engine analysis_cmds.rs set_scale / count.*, crates/doc/src/analysis.rs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { TOOLS, TOOL_GROUPS, TOOL_OPTION_SCHEMA, toolForKey } from '../paint/tools.js';
import {
  DEFAULT_MEASUREMENT_SCALE,
  measurementScaleFactor,
  measurementScaleFromDialog,
  measurementScaleText
} from '../paint/measurement.js';
import { initMeasurementScaleDialog } from '../paint/measurement-scale-dialog.js';
import { countTotal, emptyCount, normalizeCount, setCountGroupColor } from '../paint/count.js';
import { COMMANDS } from '../paint/commands.js';
import { deserializeProject, serializeProject } from '../paint/project.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function scaleDialog() {
  const { window } = new JSDOM(html);
  const doc = window.document;
  const got = [];
  const dialog = initMeasurementScaleDialog({ onOk: (f) => got.push(f), doc });
  const $ = (id) => doc.getElementById(id);
  const set = (id, v) => {
    $(id).value = v;
    $(id).dispatchEvent(new window.Event('input'));
  };
  return { dialog, doc, got, $, set };
}

test('Set Measurement Scale… opens with the document scale and OK feeds the Ruler factor', () => {
  const { dialog, got, $, set } = scaleDialog();
  dialog.open(DEFAULT_MEASUREMENT_SCALE);
  assert.equal($('measurement-scale-modal').classList.contains('hidden'), false);
  assert.equal($('measurement-scale-preset').value, 'default');
  assert.equal($('measurement-scale-pixel').disabled, true);
  assert.equal($('measurement-scale-text').textContent, '1 pixels = 1.0000 pixels');

  set('measurement-scale-preset', 'custom');
  set('measurement-scale-pixel', '120');
  set('measurement-scale-logical', '3');
  set('measurement-scale-units', 'cm');
  assert.equal($('measurement-scale-pixel').disabled, false);
  assert.equal($('measurement-scale-text').textContent, '120 pixels = 3.0000 cm');
  $('measurement-scale-ok').click();
  assert.equal($('measurement-scale-modal').classList.contains('hidden'), true);
  assert.deepEqual(got, [{ preset: 'custom', pixelLength: 120, logicalLength: 3, units: 'cm' }]);

  const { scale } = measurementScaleFromDialog(got[0], DEFAULT_MEASUREMENT_SCALE);
  assert.deepEqual(scale, { pixelLength: 120, logicalLength: 3, units: 'cm' });
  assert.equal(measurementScaleFactor(scale), 0.025);
  // The Ruler readouts use the new factor while Use Measurement Scale is on.
  const l1 = TOOL_OPTION_SCHEMA.ruler.find((o) => o.key === 'rulerL1');
  const values = { ruler: { start: [0, 0], end: [240, 0] }, measurementScale: scale };
  assert.equal(l1.text({ ...values, rulerUseScale: true }), '6.00');
  assert.equal(l1.text({ ...values, rulerUseScale: false }), '240.00');

  // Reopening a custom scale shows Custom and its values; Cancel sends nothing.
  dialog.open(scale);
  assert.equal($('measurement-scale-preset').value, 'custom');
  assert.equal($('measurement-scale-units').value, 'cm');
  $('measurement-scale-cancel').click();
  assert.equal(got.length, 1);
});

test('the Default preset resets the scale; bad lengths and empty units are refused', () => {
  const cm = { pixelLength: 120, logicalLength: 3, units: 'cm' };
  const reset = measurementScaleFromDialog({ preset: 'default', pixelLength: 9 }, cm).scale;
  assert.deepEqual(reset, DEFAULT_MEASUREMENT_SCALE);
  assert.equal(measurementScaleFactor(reset), 1);
  for (const bad of [
    { preset: 'custom', pixelLength: 0, logicalLength: 1, units: 'cm' },
    { preset: 'custom', pixelLength: 10, logicalLength: -2, units: 'cm' },
    { preset: 'custom', pixelLength: NaN, logicalLength: 1, units: 'cm' },
    { preset: 'custom', pixelLength: 10, logicalLength: 1, units: '  ' }
  ]) {
    const r = measurementScaleFromDialog(bad, cm);
    assert.ok(r.error, JSON.stringify(bad));
    assert.equal(r.scale, undefined);
  }
  // Missing values keep the current scale's.
  assert.deepEqual(measurementScaleFromDialog({ preset: 'custom', units: 'mm' }, cm).scale, {
    pixelLength: 120,
    logicalLength: 3,
    units: 'mm'
  });
  assert.equal(
    measurementScaleText({ pixelLength: 100, logicalLength: 2.5, units: 'cm' }),
    '100 pixels = 2.5000 cm'
  );
});

function fakeOverlay() {
  const calls = [];
  const ov = {
    canvas: { width: 100, height: 100 },
    calls,
    save() {},
    restore() {},
    clearRect: () => calls.push(['clear']),
    beginPath() {},
    arc: (x, y, r) => calls.push(['arc', x, y, r]),
    fill() {},
    fillText: (t, x, y) => calls.push(['text', t, x, y])
  };
  return ov;
}

const points = (state) => state.count.groups.flatMap((g) => g.points);

function click(state, ov, x, y, alt = false, upAt = [x, y]) {
  state.altKey = alt;
  TOOLS.count.onDown(null, ov, state, x, y);
  TOOLS.count.onUp(null, ov, state, ...upAt);
}

test('Count tool: clicks add numbered markers, ⌥-click removes one, a drag moves one', () => {
  const ov = fakeOverlay();
  let changes = 0;
  const state = { count: emptyCount(), zoom: 1, onCountChange: () => changes++ };
  click(state, ov, 10, 10);
  click(state, ov, 50, 20);
  click(state, ov, 80, 70);
  assert.deepEqual(points(state), [
    [10, 10],
    [50, 20],
    [80, 70]
  ]);
  assert.equal(state.count.groups.length, 1);
  assert.equal(state.count.groups[0].name, 'Count Group 1');
  assert.equal(state.count.groups[0].color, '#ff0000');
  assert.equal(changes, 3);
  // The overlay draws each marker with its number.
  const texts = ov.calls.filter((c) => c[0] === 'text').slice(-3);
  assert.deepEqual(
    texts.map((c) => c[1]),
    ['1', '2', '3']
  );

  // A plain click on a marker does not add another.
  click(state, ov, 51, 21);
  assert.equal(countTotal(state.count), 3);
  // ⌥-click within reach of marker 2 removes it; marker 3 becomes 2.
  click(state, ov, 53, 23, true);
  assert.deepEqual(points(state), [
    [10, 10],
    [80, 70]
  ]);
  // ⌥-click on empty space adds nothing.
  click(state, ov, 30, 90, true);
  assert.equal(countTotal(state.count), 2);
  // Drag marker 1 to (20, 40).
  click(state, ov, 10, 10, false, [20, 40]);
  assert.deepEqual(points(state), [
    [20, 40],
    [80, 70]
  ]);
  // Hit reach is 7 screen px: at zoom 4, 3 document px away misses.
  state.zoom = 4;
  click(state, ov, 23, 40);
  assert.equal(countTotal(state.count), 3);
});

test('Count options bar: the readout counts, Clear empties the group, Color recolours it', () => {
  const ov = fakeOverlay();
  const state = { count: emptyCount(), zoom: 1 };
  const bar = Object.fromEntries(TOOL_OPTION_SCHEMA.count.map((o) => [o.key, o]));
  assert.equal(bar.countTotal.text({ count: state.count }), '0');
  click(state, ov, 5, 5);
  click(state, ov, 40, 40);
  assert.equal(bar.countTotal.text({ count: state.count }), '2');

  state.count = setCountGroupColor(state.count, '#00ff00');
  assert.equal(state.count.groups[0].color, '#00ff00');

  const patch = bar._countClear.patch({ count: state.count });
  assert.equal(patch._countAction, 'clear');
  assert.equal(patch.countEmpty, true);
  assert.equal(bar.countTotal.text({ count: patch.count }), '0');
  TOOLS.count.clear(ov, state);
  assert.equal(countTotal(state.count), 0);
  assert.equal(state.count.groups[0].color, '#00ff00');
  // The next click restarts at 1.
  click(state, ov, 9, 9);
  assert.deepEqual(points(state), [[9, 9]]);
});

test('Count Tool sits with Eyedropper and Ruler on I; Image › Analysis › Count Tool selects it', () => {
  assert.deepEqual(TOOL_GROUPS[5], ['eyedropper', 'colorSampler', 'ruler', 'note', 'count']);
  assert.equal(TOOLS.count.icon, 'circle-dot');
  assert.equal(toolForKey('I', true, 'note'), 'count');

  const cmd = COMMANDS.find((c) => c.id === 'image.analysis.countTool');
  assert.deepEqual(cmd.menu, ['Image', 'Analysis']);
  assert.equal(cmd.label, 'Count Tool');
  const state = { tool: 'brush' };
  cmd.run({ selectTool: (id) => (state.tool = id) });
  assert.equal(state.tool, 'count');
  assert.equal(cmd.checked(state), true);

  const scale = COMMANDS.find((c) => c.id === 'image.analysis.setMeasurementScale');
  assert.equal(scale.label, 'Set Measurement Scale…');
  let opened = 0;
  scale.run({ setMeasurementScale: () => opened++ });
  assert.equal(opened, 1);
});

test('count markers round-trip through .paintproj; older files open with none', async () => {
  const count = {
    groups: [
      {
        name: 'Count Group 1',
        color: '#0099ff',
        markerSize: 1,
        labelSize: 8,
        visible: true,
        points: [
          [3, 4],
          [10.5, 2]
        ]
      }
    ],
    active: 0
  };
  const data = serializeProject(
    { layers: [], activeLayerIdx: 0, objects: [], count, measurementScale: null },
    8,
    8
  );
  assert.deepEqual(data.count, count);
  let got;
  await deserializeProject(JSON.parse(JSON.stringify(data)), (p) => (got = p));
  assert.deepEqual(got.count, count);
  const { count: _drop, ...old } = data;
  await deserializeProject(old, (p) => (got = p));
  assert.deepEqual(got.count, emptyCount());
  assert.deepEqual(
    normalizeCount({
      groups: [
        {
          points: [
            [1, NaN],
            [2, 3]
          ]
        }
      ]
    }).groups[0].points,
    [[2, 3]]
  );
});
