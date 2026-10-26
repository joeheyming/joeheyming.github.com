import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  BRUSH_SETTINGS_DEFAULTS,
  brushSettingsOf,
  rand01,
  strokeDabs
} from '../paint/brush-dynamics.js';
import { paintTipDab } from '../paint/retouch.js';
import { TOOLS, defaultToolOptions } from '../paint/tools.js';
import {
  BRUSH_PRESETS_KEY,
  GENERAL_BRUSHES,
  TOOL_PRESETS_KEY,
  applyBrushPreset,
  applyToolPreset,
  brushPresets,
  loadPresets,
  savePresets,
  toolPresetFrom
} from '../paint/brush-presets.js';
import { initBrushPanel } from '../paint/brush-panel.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';
import { panelShown, toggleDockPanel } from '../paint/window-panels.js';
import { initDock } from '../paint/dock.js';

const W = 40,
  H = 40;

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

function white() {
  return new Uint8ClampedArray(W * H * 4).fill(255);
}

const px = (d, x, y) => d[(y * W + x) * 4];

test('spacing 25% lays a dab every quarter diameter, carrying the rest across segments', () => {
  const b = brushSettingsOf({ spacing: 25 });
  const dabs = strokeDabs(b, [
    [10, 20],
    [30, 20],
    [32, 20],
    [36, 20]
  ], 20);
  assert.deepEqual(
    dabs.map((d) => d.x),
    [10, 15, 20, 25, 30, 35]
  );
  assert.ok(dabs.every((d) => d.y === 20 && d.radius === 10 && d.roundness === 1));
  // 50% spacing halves the dab count.
  const wide = strokeDabs(brushSettingsOf({ spacing: 50 }), [
    [10, 20],
    [30, 20]
  ], 20);
  assert.deepEqual(
    wide.map((d) => d.x),
    [10, 20, 30]
  );
});

test('roundness 50% paints an ellipse; Angle 90 turns it upright', () => {
  const dab = (angle) => {
    const dst = white();
    const src = new Uint8ClampedArray(dst);
    const d = { x: 20, y: 20, radius: 10, angle, roundness: 0.5, flow: 1, ceil: 1 };
    paintTipDab(dst, src, W, H, d, 1, 1, [0, 0, 0], false, null, new Float32Array(W * H));
    return dst;
  };
  const flat = dab(0);
  assert.equal(px(flat, 27, 19), 0, 'inside along the long axis');
  assert.equal(px(flat, 19, 27), 255, 'outside along the short axis');
  assert.equal(px(flat, 19, 23), 0, 'inside the short semi-axis');
  const upright = dab(90);
  assert.equal(px(upright, 19, 27), 0);
  assert.equal(px(upright, 27, 19), 255);
});

test('jitters are seeded: same seed, same dabs; within the PhotoCraft bounds', () => {
  const b = brushSettingsOf({
    shapeDynamics: true,
    sizeJitter: 100,
    minDiameter: 25,
    angleJitter: 50,
    scattering: true,
    scatter: 100,
    bothAxes: true,
    count: 3,
    transfer: true,
    opacityJitter: 100,
    flowJitter: 50
  });
  const pts = [
    [5, 20],
    [35, 20]
  ];
  const a = strokeDabs(b, pts, 20, 1, 7);
  assert.deepEqual(strokeDabs(b, pts, 20, 1, 7), a);
  assert.notDeepEqual(strokeDabs(b, pts, 20, 1, 8), a);
  assert.equal(a.length % 3, 0);
  for (const d of a) {
    assert.ok(d.radius >= 2.5 && d.radius <= 10);
    assert.ok(Math.abs(d.angle) <= 90);
    assert.ok(Math.abs(d.y - 20) <= d.radius);
    assert.ok(d.ceil >= 0 && d.ceil <= 1 && d.flow >= 0.5 && d.flow <= 1);
  }
  assert.ok(new Set(a.map((d) => d.radius)).size > 1);
  const r = rand01(1, 2, 3);
  assert.ok(r >= 0 && r < 1);
  assert.equal(rand01(1, 2, 3), r);
});

function pixelCtx() {
  const buf = white();
  return {
    buf,
    canvas: { width: W, height: H },
    getImageData: () => ({ width: W, height: H, data: new Uint8ClampedArray(buf) }),
    putImageData(img, ox, oy, dx, dy, dw, dh) {
      for (let y = dy; y < dy + dh; y++) {
        const i = (y * W + dx) * 4;
        buf.set(img.data.subarray(i, i + dw * 4), i);
      }
    }
  };
}

test('the Brush tool paints through Brush Settings: a flat tip leaves the rows above white', () => {
  const state = {
    brushSize: 10,
    activeColor: '#000000',
    toolOptions: { brush: { ...defaultToolOptions().brush, size: 10 } },
    brushSettings: brushSettingsOf({ roundness: 20 })
  };
  const ctx = pixelCtx();
  TOOLS.brush.onDown(ctx, null, state, 5.5, 20.5);
  TOOLS.brush.onMove(ctx, null, state, 35.5, 20.5);
  TOOLS.brush.onUp(ctx, null, state);
  assert.equal(px(ctx.buf, 20, 20), 0);
  assert.equal(px(ctx.buf, 20, 17), 255);
  state.brushSettings = brushSettingsOf();
  const round = pixelCtx();
  TOOLS.brush.onDown(round, null, state, 5.5, 20.5);
  TOOLS.brush.onMove(round, null, state, 35.5, 20.5);
  assert.equal(px(round.buf, 20, 17), 0);
});

test('brush presets and tool presets save to storage and reapply', () => {
  const storage = memoryStorage();
  assert.deepEqual(
    GENERAL_BRUSHES.map((p) => p.name).slice(0, 2),
    ['Hard Round', 'Soft Round']
  );
  const state = { tool: 'brush', toolOptions: defaultToolOptions(), brushSettings: null };
  applyBrushPreset(state, GENERAL_BRUSHES.find((p) => p.name === 'Calligraphy Flat'));
  assert.equal(state.toolOptions.brush.size, 28);
  assert.equal(state.brushSettings.roundness, 20);
  assert.equal(state.brushSettings.angle, 45);

  savePresets(BRUSH_PRESETS_KEY, [{ name: 'Mine', size: 9, hardness: 50, settings: {} }], storage);
  assert.equal(brushPresets(storage).at(-1).name, 'Mine');

  const preset = toolPresetFrom(state, 'brush', 'Brush 1');
  savePresets(TOOL_PRESETS_KEY, [preset], storage);
  state.toolOptions.brush.size = 3;
  state.brushSettings = brushSettingsOf();
  const [loaded] = loadPresets(TOOL_PRESETS_KEY, storage);
  assert.equal(applyToolPreset(state, loaded), 'brush');
  assert.equal(state.toolOptions.brush.size, 28);
  assert.equal(state.brushSettings.roundness, 20);
  assert.deepEqual(Object.keys(BRUSH_SETTINGS_DEFAULTS).sort(), Object.keys(state.brushSettings).sort());
});

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

test('Brushes panel lists presets; Brush Settings and Tool Presets sections work from Window', () => {
  const { window } = new JSDOM(html);
  const doc = window.document;
  initDock(doc.getElementById('dock'));
  const storage = memoryStorage();
  const state = { tool: 'brush', toolOptions: defaultToolOptions(), brushSettings: null };
  let selected = null;
  initBrushPanel(state, { selectTool: (id) => (selected = id), toolLabel: () => 'Brush' }, doc, storage);

  const presets = [...doc.querySelectorAll('#brush-preset-list [data-preset]')];
  assert.equal(presets.length, GENERAL_BRUSHES.length);
  doc.querySelector('[data-preset="Soft Round"]').click();
  assert.equal(state.toolOptions.brush.hardness, 0);

  const search = doc.getElementById('brush-search');
  search.value = 'calli';
  search.dispatchEvent(new window.Event('input'));
  assert.deepEqual(
    [...doc.querySelectorAll('#brush-preset-list [data-preset]')].map((b) => b.dataset.preset),
    ['Calligraphy Flat']
  );

  doc.getElementById('btn-new-brush-preset').click();
  assert.equal(loadPresets(BRUSH_PRESETS_KEY, storage).length, 1);

  const spacing = doc.querySelector('#brush-settings-fields [data-setting="spacing"]');
  spacing.value = '50';
  spacing.dispatchEvent(new window.Event('input'));
  assert.equal(state.brushSettings.spacing, 50);

  doc.getElementById('btn-new-tool-preset').click();
  const saved = loadPresets(TOOL_PRESETS_KEY, storage);
  assert.equal(saved[0].name, 'Brush 1');
  assert.equal(saved[0].brush.spacing, 50);
  state.brushSettings.spacing = 10;
  doc.querySelector('[data-tool-preset="Brush 1"]').click();
  assert.equal(selected, 'brush');
  assert.equal(state.brushSettings.spacing, 50);

  // Window › Brush Settings / Tool Presets open their section in the Brushes panel.
  for (const name of ['brushSettings', 'toolPresets']) {
    const cmd = COMMANDS_BY_ID.get(`window.panel.${name}`);
    assert.deepEqual(cmd.menu, ['Window']);
    assert.equal(panelShown(name, doc), false);
    assert.equal(toggleDockPanel(name, doc), true);
    assert.equal(doc.getElementById(`section-${name}`).open, true);
    assert.equal(panelShown(name, doc), true);
    assert.equal(toggleDockPanel(name, doc), false);
    assert.equal(panelShown(name, doc), false);
  }
  assert.equal(COMMANDS_BY_ID.get('window.panel.brushSettings').shortcut, 'F5');
});
