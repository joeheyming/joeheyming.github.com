import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { TOOLS, defaultToolOptions, gradientToolPreset } from '../paint/tools.js';
import { cloneDab } from '../paint/retouch.js';
import {
  DEFAULT_CLONE_TRANSFORM,
  cloneSampler,
  cloneTransformMatrix,
  setCloneOffset,
  setCloneTransform
} from '../paint/clone-source.js';
import {
  STYLE_PRESET_GROUPS,
  applyStylePreset,
  findStylePreset,
  stylePresetStyles
} from '../paint/style-presets.js';
import { addPattern, initPresetPanels } from '../paint/preset-panels.js';
import { COMMANDS_BY_ID } from '../paint/commands.js';
import { panelShown, toggleDockPanel } from '../paint/window-panels.js';
import { initDock } from '../paint/dock.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function panelDoc() {
  const { window } = new JSDOM(html);
  initDock(window.document.getElementById('dock'));
  return window;
}

test('clicking a Gradients preset sets the Gradient tool preset option', () => {
  const window = panelDoc();
  const doc = window.document;
  const state = { tool: 'brush', toolOptions: defaultToolOptions() };
  let changed = 0;
  initPresetPanels(state, { onGradientChange: () => changed++ }, doc);
  const swatches = [...doc.querySelectorAll('#panel-gradients [data-gradient]')];
  assert.ok(swatches.length > 3);
  assert.equal(state.toolOptions.gradient.preset, 'Basics/Foreground to Background');
  doc.querySelector('[data-gradient="Basics/Black, White"]').click();
  assert.equal(state.toolOptions.gradient.preset, 'Basics/Black, White');
  assert.equal(gradientToolPreset(state.toolOptions.gradient.preset).name, 'Black, White');
  assert.equal(changed, 1);
  assert.equal(
    doc.querySelector('[data-gradient="Basics/Black, White"]').getAttribute('aria-pressed'),
    'true'
  );
});

test('Patterns lists defined patterns; a click makes one current', () => {
  const window = panelDoc();
  const doc = window.document;
  const state = { toolOptions: defaultToolOptions() };
  const panels = initPresetPanels(state, {}, doc);
  assert.equal(doc.querySelectorAll('#panel-patterns [data-pattern]').length, 0);
  const a = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) };
  const b = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 255, 255]) };
  addPattern(state, a);
  addPattern(state, b);
  panels.renderPatterns();
  assert.equal(state.pattern, b);
  const items = [...doc.querySelectorAll('#panel-patterns [data-pattern]')];
  assert.deepEqual(
    items.map((i) => i.getAttribute('aria-label')),
    ['Pattern 1', 'Pattern 2']
  );
  items[0].click();
  assert.equal(state.pattern, a);
});

test('Styles applies a layer style preset to the active layer', () => {
  const window = panelDoc();
  const doc = window.document;
  const layers = [{ id: 1, kind: 'pixel', styles: null }];
  const state = { toolOptions: defaultToolOptions() };
  initPresetPanels(state, { applyStyle: (p, add) => applyStylePreset(layers, [1], p, add) }, doc);
  const n = STYLE_PRESET_GROUPS.reduce((k, g) => k + g.presets.length, 0);
  assert.equal(doc.querySelectorAll('#style-preset-list [data-style]').length, n);

  doc.querySelector('[data-style="Basics/Drop Shadow"]').click();
  assert.equal(layers[0].styles.dropShadow.enabled, true);
  assert.equal(layers[0].styles.dropShadow.distance, 6);
  assert.equal(layers[0].styles.dropShadow.opacity, 60);

  // Shift-click adds; a plain click replaces.
  doc
    .querySelector('[data-style="Basics/Black Stroke"]')
    .dispatchEvent(new window.MouseEvent('click', { shiftKey: true, bubbles: true }));
  assert.equal(layers[0].styles.stroke.position, 'outside');
  assert.ok(layers[0].styles.dropShadow);
  doc.querySelector('[data-style="Basics/Black Stroke"]').click();
  assert.equal(layers[0].styles.dropShadow, undefined);

  doc.querySelector('[data-style="Basics/Default Style (None)"]').click();
  assert.equal(layers[0].styles, null);

  const chrome = stylePresetStyles(findStylePreset('Text Effects/Chrome'));
  assert.deepEqual(chrome.gradientOverlay.stops, [
    [0, '#3a3f47'],
    [1, '#f4f6f8']
  ]);
  assert.equal(stylePresetStyles(findStylePreset('Text Effects/Hollow')).fillOpacity, 0);
  assert.equal(findStylePreset('Text Effects/Nope'), null);
});

test('clone source W / H scale and angle change the sampled positions', () => {
  const W = 20,
    H = 20;
  const anchor = { x: 10, y: 10 };
  const off = { dx: -8, dy: -8 };
  const id = cloneSampler(anchor, off, DEFAULT_CLONE_TRANSFORM, W, H);
  assert.equal(id(10, 10), 2 * W + 2);
  assert.equal(id(12, 10), 2 * W + 4);

  const wide = setCloneTransform(DEFAULT_CLONE_TRANSFORM, { width: 200 });
  const s = cloneSampler(anchor, off, wide, W, H);
  assert.equal(s(10, 10), 2 * W + 2);
  // 200 % W: two destination pixels per source pixel.
  assert.equal(s(12, 10), 2 * W + 3);
  assert.equal(s(14, 10), 2 * W + 4);

  // Linked W / H scale together.
  const linked = setCloneTransform({ ...DEFAULT_CLONE_TRANSFORM, linked: true }, { width: 50 });
  assert.equal(linked.height, 50);

  // 90° counter-clockwise on screen: a step right in the destination reads a step down.
  const m = cloneTransformMatrix({ ...DEFAULT_CLONE_TRANSFORM, rotation: 90 });
  assert.ok(Math.abs(m[0]) < 1e-9 && Math.abs(m[2] - 1) < 1e-9);
  const turned = cloneSampler(anchor, off, { ...DEFAULT_CLONE_TRANSFORM, rotation: 90 }, W, H);
  assert.equal(turned(12, 10), 4 * W + 2);

  // cloneDab paints through the sampler.
  const src = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) src.set([(p % W) * 10, Math.floor(p / W) * 10, 0, 255], p * 4);
  const dst = new Uint8ClampedArray(src);
  cloneDab(dst, src, W, H, 14.5, 10.5, off.dx, off.dy, 0.5, 1, 1, null, null, s);
  assert.deepEqual([...dst.subarray((10 * W + 14) * 4, (10 * W + 14) * 4 + 3)], [40, 20, 0]);
});

test('Clone Stamp strokes use the Clone Source panel transform', () => {
  const W = 20,
    H = 20;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) data.set([(p % W) * 10, Math.floor(p / W) * 10, 0, 255], p * 4);
  const ctx = {
    canvas: { width: W, height: H },
    getImageData: () => ({ width: W, height: H, data: new Uint8ClampedArray(data) }),
    putImageData(img) {
      data.set(img.data);
    }
  };
  const ov = { canvas: { width: W, height: H }, clearRect() {} };
  const window = panelDoc();
  const doc = window.document;
  const state = {
    tool: 'cloneStamp',
    toolOptions: defaultToolOptions(),
    sel: { mode: 'none' },
    brushSize: 1
  };
  Object.assign(state.toolOptions.cloneStamp, { size: 1, hardness: 100, opacity: 100 });
  const panels = initPresetPanels(state, {}, doc);
  const tool = TOOLS.cloneStamp;
  state.altKey = true;
  tool.onDown(ctx, ov, state, 2.5, 2.5);
  state.altKey = false;
  panels.renderCloneSource();
  assert.match(doc.querySelector('.clone-source-line').textContent, /2, 2/);

  const w = doc.getElementById('clone-source-width');
  w.value = '200';
  w.dispatchEvent(new window.Event('change'));
  assert.equal(state.clone.transform.width, 200);

  tool.onDown(ctx, ov, state, 10.5, 10.5);
  tool.onUp(ctx, ov, state);
  tool.onDown(ctx, ov, state, 12.5, 10.5);
  tool.onUp(ctx, ov, state);
  // The aligned second stroke maps (12, 10) through the anchor at (10, 10): source x 3, not 4.
  assert.deepEqual([...data.subarray((10 * W + 12) * 4, (10 * W + 12) * 4 + 2)], [30, 20]);

  // The panel shows the offset and editing it moves the sample point.
  panels.renderCloneSource();
  assert.equal(doc.getElementById('clone-source-x').value, '-8');
  assert.equal(setCloneOffset(state.clone, -5, -8), true);
  assert.deepEqual(state.clone.source, { x: 5, y: 2 });
});

test('Window › Gradients, Patterns, Styles, Clone Source show their panels', () => {
  const window = panelDoc();
  const doc = window.document;
  for (const name of ['gradients', 'patterns', 'styles', 'cloneSource']) {
    const cmd = COMMANDS_BY_ID.get(`window.panel.${name}`);
    assert.deepEqual(cmd.menu, ['Window']);
    assert.equal(panelShown(name, doc), false);
    assert.equal(toggleDockPanel(name, doc), true);
    assert.equal(panelShown(name, doc), true);
    assert.equal(toggleDockPanel(name, doc), false);
    assert.equal(panelShown(name, doc), false);
  }
});
