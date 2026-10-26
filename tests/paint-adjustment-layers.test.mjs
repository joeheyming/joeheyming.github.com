import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS } from '../paint/commands.js';

import { ADJUSTMENT_LAYER_IDS, defaultAdjustmentParams } from '../paint/adjustment-layers.js';
import { compositeTreeBytes } from '../paint/layer-groups.js';
import { newLayerMask } from '../paint/layer-mask.js';
import { historyIconName } from '../paint/history.js';

// layers.js / project.js need document.createElement('canvas'). A byte-backed stub
// keeps the round trip browser-free.
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

globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    return fakeCanvas();
  }
};

const { createLayer, createAdjustmentLayer, canMergeDown } = await import('../paint/layers.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');

const W = 2,
  H = 1;

let nextId = 1;
// An opaque pixel layer: two pixels, (10, 20, 30) and (200, 100, 0).
function pixelLayer() {
  return {
    id: nextId++,
    kind: 'pixel',
    visible: true,
    opacity: 1,
    mask: null,
    data: new Uint8ClampedArray([10, 20, 30, 255, 200, 100, 0, 255])
  };
}

function adjustmentLayer(id, extra = {}) {
  return {
    id: nextId++,
    kind: 'adjustment',
    adjustmentId: id,
    params: defaultAdjustmentParams(id),
    visible: true,
    opacity: 1,
    mask: newLayerMask('revealAll', W, H),
    maskEnabled: true,
    ...extra
  };
}

test('an Invert adjustment layer over an opaque pixel layer inverts the composite', () => {
  const out = compositeTreeBytes([pixelLayer(), adjustmentLayer('invert')], W, H, null);
  assert.deepEqual(Array.from(out), [245, 235, 225, 255, 55, 155, 255, 255]);
});

test('opacity 0.5 mixes the adjustment halfway', () => {
  const layers = [pixelLayer(), adjustmentLayer('invert', { opacity: 0.5 })];
  const out = compositeTreeBytes(layers, W, H, null);
  // 10 + (245 - 10) / 2 = 127.5 → 128; 200 + (55 - 200) / 2 = 127.5 → 128.
  assert.deepEqual(Array.from(out), [128, 128, 128, 255, 128, 128, 128, 255]);
});

test('the mask limits the adjustment per pixel, and a hide-all mask is a no-op', () => {
  const base = Array.from(pixelLayer().data);
  const hidden = adjustmentLayer('invert', { mask: newLayerMask('hideAll', W, H) });
  assert.deepEqual(Array.from(compositeTreeBytes([pixelLayer(), hidden], W, H)), base);
  const half = adjustmentLayer('invert', { mask: Uint8Array.from([255, 0]) });
  const out = compositeTreeBytes([pixelLayer(), half], W, H);
  assert.deepEqual(Array.from(out), [245, 235, 225, 255, 200, 100, 0, 255]);
  // A disabled mask reveals everything.
  const off = adjustmentLayer('invert', {
    mask: newLayerMask('hideAll', W, H),
    maskEnabled: false
  });
  assert.deepEqual(
    Array.from(compositeTreeBytes([pixelLayer(), off], W, H)).slice(0, 3),
    [245, 235, 225]
  );
});

test('a hidden adjustment layer leaves the composite unchanged', () => {
  const layers = [pixelLayer(), adjustmentLayer('invert', { visible: false })];
  assert.deepEqual(
    Array.from(compositeTreeBytes(layers, W, H)),
    Array.from(pixelLayer().data)
  );
});

test('an adjustment layer below a pixel layer does not apply to it', () => {
  const layers = [adjustmentLayer('invert'), pixelLayer()];
  assert.deepEqual(
    Array.from(compositeTreeBytes(layers, W, H)),
    Array.from(pixelLayer().data)
  );
  // Over the background only: white inverts to black, then the opaque layer covers it.
  const bgOnly = compositeTreeBytes([adjustmentLayer('invert')], W, H, '#ffffff');
  assert.deepEqual(Array.from(bgOnly), [0, 0, 0, 255, 0, 0, 0, 255]);
});

test('adjustment layers reuse the ADJUSTMENTS pixel functions (Threshold, Posterize)', () => {
  // Rec. 601 luma: 19.0 and 118.5, split at level 100.
  const level = adjustmentLayer('threshold', { params: { level: 100 } });
  const thr = compositeTreeBytes([pixelLayer(), level], W, H);
  assert.deepEqual(Array.from(thr), [0, 0, 0, 255, 255, 255, 255, 255]);
  const post = adjustmentLayer('posterize', { params: { levels: 2 } });
  const out = compositeTreeBytes([pixelLayer(), post], W, H);
  assert.deepEqual(Array.from(out), [0, 0, 0, 255, 255, 0, 0, 255]);
});

test('pixel layers composite source-over with opacity and their mask', () => {
  const top = {
    id: nextId++,
    kind: 'pixel',
    visible: true,
    opacity: 0.5,
    mask: Uint8Array.from([255, 0]),
    data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255])
  };
  const out = compositeTreeBytes([pixelLayer(), top], W, H);
  assert.deepEqual(Array.from(out), [133, 138, 143, 255, 200, 100, 0, 255]);
});

test('createAdjustmentLayer holds an id, params, and a Reveal All mask; nothing merges into it', () => {
  const layer = createAdjustmentLayer('Levels', 'levels', defaultAdjustmentParams('levels'), 3, 2);
  assert.equal(layer.kind, 'adjustment');
  assert.equal(layer.adjustmentId, 'levels');
  assert.deepEqual(layer.params, defaultAdjustmentParams('levels'));
  assert.deepEqual([layer.params.black, layer.params.gamma, layer.params.white], [0, 1, 255]);
  assert.deepEqual([layer.params.outBlack, layer.params.outWhite], [0, 255]);
  assert.deepEqual(Array.from(layer.mask), [255, 255, 255, 255, 255, 255]);
  assert.equal(layer.canvas.style.display, 'none');
  const pixel = createLayer('Pixels', 3, 2);
  assert.equal(canMergeDown([layer, pixel], 1), false);
  assert.equal(canMergeDown([pixel, layer], 1), true);
});

test('the Layer menu has New Adjustment Layer with every adjustment layer kind', () => {
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
    const group = menu.querySelector('.has-submenu[data-menu-path="Layer > New Adjustment Layer"]');
    assert.ok(group, 'New Adjustment Layer submenu missing');
    const items = [...group.querySelectorAll('[data-layer^="adjust-"]')];
    const ids = items.map((el) => el.dataset.layer.slice('adjust-'.length));
    assert.deepEqual([...ids].sort(), [...ADJUSTMENT_LAYER_IDS].sort());
    // PhotoCraft's catalog order.
    assert.deepEqual(
      items.map((el) => el.querySelector('.menu-label').textContent.replace('…', '')),
      [
        'Brightness/Contrast',
        'Levels',
        'Curves',
        'Exposure',
        'Vibrance',
        'Hue/Saturation',
        'Color Balance',
        'Black & White',
        'Photo Filter',
        'Channel Mixer',
        'Color Lookup',
        'Invert',
        'Posterize',
        'Threshold',
        'Gradient Map',
        'Selective Color'
      ]
    );
  } finally {
    globalThis.document = prevDoc;
  }
});

test('adjustment layer history rows use the sliders-horizontal icon', () => {
  assert.equal(historyIconName('New Adjustment Layer'), 'sliders-horizontal');
  assert.equal(historyIconName('Edit Adjustment Layer'), 'sliders-horizontal');
});

test('.paintproj round-trips an adjustment layer id, params, opacity, visibility, and mask', async () => {
  const w = 4,
    h = 3;
  const pixels = createLayer('Background', w, h);
  const adj = createAdjustmentLayer('Posterize', 'posterize', { levels: 6 }, w, h);
  adj.opacity = 0.4;
  adj.visible = false;
  adj.mask = Uint8Array.from({ length: w * h }, (_, p) => p * 20);
  adj.maskEnabled = false;
  const state = {
    bgColor: '#ffffff',
    color: '#000000',
    activeLayerIdx: 1,
    layers: [pixels, adj],
    objects: []
  };
  const data = JSON.parse(JSON.stringify(serializeProject(state, w, h)));
  assert.equal(data.layers[1].kind, 'adjustment');
  assert.equal(data.layers[1].dataUrl, undefined);
  assert.equal(data.layers[0].kind, undefined);

  let restored = null;
  await deserializeProject(data, (out) => {
    restored = out;
  });
  const [a, b] = restored.layers;
  assert.equal(a.kind, 'pixel');
  assert.equal(b.kind, 'adjustment');
  assert.equal(b.adjustmentId, 'posterize');
  assert.deepEqual(b.params, { levels: 6 });
  assert.equal(b.opacity, 0.4);
  assert.equal(b.visible, false);
  assert.deepEqual(Array.from(b.mask), Array.from(adj.mask));
  assert.equal(b.maskEnabled, false);
});
