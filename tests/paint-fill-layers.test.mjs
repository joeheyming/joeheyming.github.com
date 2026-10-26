import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS } from '../paint/commands.js';
import {
  FILL_LAYER_TYPES,
  defaultFill,
  fillFrame,
  nextFillName,
  renderFill
} from '../paint/fill-layers.js';
import { historyIconName } from '../paint/history.js';
import { restoreStack, snapshotStack, isStackUndoLabel } from '../paint/stack-history.js';

// Layer › New Fill Layer (PhotoCraft compose render_fill): Solid Color, Gradient, and Pattern
// fill layers render their pixels from a description at the canvas size.

// layers.js / project.js need document.createElement('canvas'): a byte-backed stub whose
// pixels reset when the canvas is resized, as a real canvas does.
function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    className: '',
    dataset: {},
    style: {},
    pixels: null,
    getContext() {
      return ctx;
    },
    toDataURL() {
      return '';
    }
  };
  const ensure = () => {
    if (!canvas.pixels || canvas.pixels.length !== canvas.width * canvas.height * 4) {
      canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    }
  };
  const ctx = {
    canvas,
    createImageData(w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    getImageData(x, y, w, h) {
      ensure();
      return { width: w, height: h, data: canvas.pixels.slice() };
    },
    putImageData(img) {
      ensure();
      canvas.pixels.set(img.data);
    },
    drawImage() {}
  };
  return canvas;
}

const stubDocument = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    return fakeCanvas();
  }
};
globalThis.document = stubDocument;

const { createFillLayer, createLayer, refreshFillLayers, renderFillLayer, canMergeDown } =
  await import('../paint/layers.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');

const px = (img, x, y) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const layerPx = (layer, x, y) => px({ width: layer.canvas.width, data: layer.canvas.pixels }, x, y);

test('a Solid Color fill is the color at every pixel, opaque', () => {
  const img = renderFill({ type: 'solid', color: '#336699' }, 3, 2);
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 3; x++) assert.deepEqual(px(img, x, y), [0x33, 0x66, 0x99, 255]);
});

test('a Gradient fill runs foreground to background, bottom to top at 90°', () => {
  const fill = defaultFill('gradient', { fg: '#000000', bg: '#ffffff' });
  const img = renderFill(fill, 2, 4);
  const column = [0, 1, 2, 3].map((y) => px(img, 0, y)[0]);
  // Top is the background end, bottom toward the foreground, in even steps (gradient_t measures
  // from the pixel corner).
  assert.deepEqual(column, [255, 191, 128, 64]);
  assert.deepEqual(px(img, 1, 0), [255, 255, 255, 255]);
  // Reverse swaps the ends; 0° runs left to right.
  const reversed = renderFill({ ...fill, reverse: true }, 2, 4);
  assert.deepEqual(
    [0, 3].map((y) => px(reversed, 0, y)[0]),
    [0, 191]
  );
  const across = renderFill({ ...fill, angle: 0 }, 4, 1);
  assert.deepEqual(
    [0, 1, 2, 3].map((x) => px(across, x, 0)[0]),
    [0, 64, 128, 191]
  );
});

test('a Gradient fill made from a selection lays out in the selection bounds', () => {
  const W = 4,
    H = 4;
  // The selection is the right half of the canvas.
  const mask = Uint8Array.from({ length: W * H }, (_, p) => (p % W >= 2 ? 255 : 0));
  assert.deepEqual(fillFrame(mask, W, H), [2, 0, 4, 4]);
  const fill = { ...defaultFill('gradient', { fg: '#000000', bg: '#ffffff' }), angle: 0 };
  const img = renderFill(fill, W, H, mask);
  assert.deepEqual(
    [2, 3].map((x) => px(img, x, 0)[0]),
    [0, 128]
  );
  // Without the selection the same gradient spans the whole width.
  assert.deepEqual(
    [2, 3].map((x) => px(renderFill(fill, W, H), x, 0)[0]),
    [128, 191]
  );
});

test('a Pattern fill tiles the pattern from the corner, scaled', () => {
  // A 2 × 1 tile: red then blue.
  const tile = { width: 2, height: 1, data: [255, 0, 0, 255, 0, 0, 255, 255] };
  const fill = defaultFill('pattern', { pattern: tile });
  const img = renderFill(fill, 4, 2);
  const reds = (im) => [0, 1, 2, 3].map((x) => px(im, x, 1)[0]);
  assert.deepEqual(reds(img), [255, 0, 255, 0]);
  assert.deepEqual(reds(renderFill({ ...fill, scale: 200 }, 4, 2)), [255, 255, 0, 0]);
  // No pattern tile: transparent.
  assert.deepEqual(px(renderFill({ type: 'pattern', pattern: null }, 1, 1), 0, 0), [0, 0, 0, 0]);
});

test('a fill layer carries its fill and a Reveal All mask; nothing merges into it', () => {
  const layer = createFillLayer('Color Fill 1', { type: 'solid', color: '#ff0000' }, 3, 2);
  assert.equal(layer.kind, 'fill');
  assert.deepEqual(layer.fill, { type: 'solid', color: '#ff0000' });
  assert.equal(layer.mask.length, 6);
  assert.ok(layer.mask.every((v) => v === 255));
  assert.deepEqual(layerPx(layer, 2, 1), [255, 0, 0, 255]);
  const above = createLayer('Layer 1', 3, 2);
  assert.equal(canMergeDown([layer, above], 1), false);
});

test('fill layers re-render at the new size after Canvas Size', () => {
  const solid = createFillLayer('Color Fill 1', { type: 'solid', color: '#00ff00' }, 2, 2);
  const gradient = createFillLayer(
    'Gradient Fill 1',
    defaultFill('gradient', { fg: '#000000', bg: '#ffffff' }),
    2,
    2
  );
  // Canvas Size: the canvas grows and its pixels are cleared, as resizeStack leaves them.
  for (const l of [solid, gradient]) {
    l.canvas.width = 4;
    l.canvas.height = 4;
    l.canvas.pixels = new Uint8ClampedArray(64);
  }
  refreshFillLayers([solid, gradient]);
  assert.deepEqual(layerPx(solid, 3, 3), [0, 255, 0, 255]);
  // The gradient spans the new height.
  assert.deepEqual(
    [0, 1, 2, 3].map((y) => layerPx(gradient, 3, y)[0]),
    [255, 191, 128, 64]
  );
  // Unchanged sizes are left alone.
  solid.canvas.pixels.fill(7);
  refreshFillLayers([solid]);
  assert.equal(solid.canvas.pixels[0], 7);
  renderFillLayer(solid);
  assert.equal(solid.canvas.pixels[0], 0);
});

test('Layer › New Fill Layer lists Solid Color, Gradient, Pattern and runs newFillLayer', () => {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { document } = new JSDOM(html).window;
  const prevDoc = globalThis.document;
  globalThis.document = document;
  try {
    buildMenuBar(document.getElementById('menu-bar'), COMMANDS, {
      mac: false,
      state: { layers: [], sel: { ids: [] } }
    });
    const menu = document.getElementById('layer-menu-list');
    const group = menu.querySelector('.has-submenu[data-menu-path="Layer > New Fill Layer"]');
    assert.ok(group, 'New Fill Layer submenu missing');
    const items = [...group.querySelectorAll('[data-layer^="fill-"]')];
    assert.deepEqual(
      items.map((el) => el.querySelector('.menu-label').textContent),
      ['Solid Color…', 'Gradient…', 'Pattern…']
    );
    const calls = [];
    for (const t of FILL_LAYER_TYPES) {
      COMMANDS.find((c) => c.id === `layer.newFillLayer.${t.id}`).run({
        newFillLayer: (type) => calls.push(type)
      });
    }
    assert.deepEqual(calls, ['solid', 'gradient', 'pattern']);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('new fill layers are named and recorded as PhotoCraft does', () => {
  const layers = [{ name: 'Background' }, { name: 'Color Fill 1' }, { name: 'Color Fill 3' }];
  assert.equal(nextFillName(layers, 'Color Fill'), 'Color Fill 4');
  assert.equal(nextFillName(layers, 'Pattern Fill'), 'Pattern Fill 1');
  assert.deepEqual(
    FILL_LAYER_TYPES.map((t) => t.undo),
    ['New Color Fill Layer', 'New Gradient Fill Layer', 'New Pattern Fill Layer']
  );
  for (const t of FILL_LAYER_TYPES) {
    assert.ok(isStackUndoLabel(t.undo));
    assert.notEqual(historyIconName(t.undo), 'diamond');
  }
  assert.notEqual(historyIconName('Edit Fill Layer'), 'diamond');
});

test('a stack snapshot keeps a copy of the fill', () => {
  const layer = createFillLayer('Color Fill 1', { type: 'solid', color: '#123456' }, 2, 1);
  const snap = snapshotStack([layer], 0);
  layer.fill.color = '#ffffff';
  const { layers } = restoreStack(snap);
  assert.equal(layers[0].kind, 'fill');
  assert.deepEqual(layers[0].fill, { type: 'solid', color: '#123456' });
});

test('.paintproj saves the fill, not pixels, and renders it again on load', async () => {
  const w = 4,
    h = 2;
  const bg = createLayer('Background', w, h);
  const tile = { width: 2, height: 1, data: [255, 0, 0, 255, 0, 0, 255, 255] };
  const pattern = createFillLayer(
    'Pattern Fill 1',
    defaultFill('pattern', { pattern: tile }),
    w,
    h
  );
  pattern.opacity = 0.5;
  const state = { bgColor: '#ffffff', color: '#000000', activeLayerIdx: 1, layers: [bg, pattern] };
  state.objects = [];
  const data = JSON.parse(JSON.stringify(serializeProject(state, w, h)));
  assert.equal(data.layers[1].kind, 'fill');
  assert.equal(data.layers[1].dataUrl, undefined);
  assert.equal(data.layers[1].fill.type, 'pattern');

  let restored = null;
  await deserializeProject(data, (out) => (restored = out));
  const loaded = restored.layers[1];
  assert.equal(loaded.kind, 'fill');
  assert.equal(loaded.opacity, 0.5);
  assert.deepEqual(
    [0, 1, 2, 3].map((x) => layerPx(loaded, x, 0)[2]),
    [0, 255, 0, 255]
  );
  assert.ok(loaded.mask.every((v) => v === 255));
  // Older files have no fill layers; a 'fill' entry without a fill opens as a pixel layer.
  data.layers[1].fill = null;
  await deserializeProject(data, (out) => (restored = out));
  assert.equal(restored.layers[1].kind, 'pixel');
});

test('the Layers footer lists the fill layers first; double-clicking a fill thumbnail edits it', async () => {
  const { window } = new JSDOM('<!doctype html><body><div id="layers"></div></body>');
  globalThis.document = window.document;
  try {
    const noop = new Proxy({}, { get: () => () => {} });
    window.HTMLCanvasElement.prototype.getContext = () => noop;
    const { renderLayerPanel } = await import('../paint/layers.js');
    const doc = window.document;
    const canvas = doc.createElement('canvas');
    const base = { visible: true, opacity: 1, blendMode: 'source-over', canvas };
    const layers = [
      { ...base, id: 1, name: 'Background', kind: 'pixel' },
      { ...base, id: 2, name: 'Color Fill 1', kind: 'fill', fill: { type: 'solid' } }
    ];
    const calls = [];
    const callbacks = new Proxy(
      {},
      { get: (_, key) => (key === 'maskTarget' ? false : (...args) => calls.push([key, ...args])) }
    );
    const container = doc.getElementById('layers');
    renderLayerPanel(layers, 1, container, callbacks);

    const thumb = container.querySelector('.layer-row[data-index="1"] .layer-thumb');
    thumb.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.deepEqual(calls.at(-1), ['onEditFill', 1]);
    thumb.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(calls.at(-1), ['onTargetMask', 1]);

    container.querySelector('.layer-footer-btn[data-action="adjustment"]').click();
    const items = [...doc.querySelectorAll('.layer-popup-menu .action-menu-item')];
    assert.deepEqual(
      items.slice(0, 4).map((b) => b.textContent),
      ['Solid Color…', 'Gradient…', 'Pattern…', 'Brightness / Contrast']
    );
    items[1].click();
    assert.deepEqual(calls.at(-1), ['onNewFill', 'gradient']);
  } finally {
    globalThis.document = stubDocument;
  }
});

test('the fill dialog previews every edit and hands the edited fill to OK', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const { initFillLayerDialog } = await import('../paint/fill-layer-dialog.js');
  const dialog = initFillLayerDialog({
    doc: window.document,
    swatches: () => ['#ff0000', '#0000ff']
  });
  const previews = [];
  let ok = null;
  dialog.open(defaultFill('gradient'), {
    onPreview: (f) => previews.push(f),
    onOk: (f) => (ok = f)
  });
  assert.equal(dialog.modal.getAttribute('aria-label'), 'Gradient Fill');
  const angle = dialog.modal.querySelector('[data-field="angle"]');
  angle.value = '45';
  angle.dispatchEvent(new window.Event('input'));
  assert.equal(previews.at(-1).angle, 45);
  const preset = dialog.modal.querySelector('[data-field="preset"]');
  preset.value = 'Foreground to Background';
  preset.dispatchEvent(new window.Event('change'));
  assert.deepEqual(previews.at(-1).stops, [
    [0, '#ff0000'],
    [1, '#0000ff']
  ]);
  dialog.modal.querySelector('#fill-layer-ok').click();
  assert.equal(ok.angle, 45);
  assert.ok(dialog.modal.classList.contains('hidden'));
  // The rendered pixels follow the edited fill: red at the bottom-left end of the 45° ramp.
  const img = renderFill(ok, 4, 4);
  assert.ok(px(img, 0, 3)[0] > px(img, 3, 0)[0]);
});
