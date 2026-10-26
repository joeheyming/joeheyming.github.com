import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildMenuBar } from '../paint/menu-bar.js';
import { COMMANDS } from '../paint/commands.js';

import {
  applyLayerMask,
  newLayerMask,
  maskLevel,
  maskGrayHex,
  maskToRgba,
  maskFromRgba,
  cropMask,
  encodeMask,
  decodeMask
} from '../paint/layer-mask.js';
import { historyIconName } from '../paint/history.js';
import { ICONS } from '../paint/icons.js';

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

const { createLayer } = await import('../paint/layers.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');

test('applyLayerMask multiplies alpha by mask / 255 and keeps RGB', () => {
  const img = {
    width: 4,
    height: 1,
    data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 200, 1, 2, 3, 101])
  };
  const out = applyLayerMask(img, Uint8Array.from([255, 0, 128, 255]));
  assert.deepEqual(Array.from(out.data), [
    10,
    20,
    30,
    255,
    40,
    50,
    60,
    0,
    70,
    80,
    90,
    Math.round((200 * 128) / 255),
    1,
    2,
    3,
    101
  ]);
  assert.equal(img.data[7], 255, 'the source is not modified');
  assert.equal(out.width, 4);
  assert.equal(out.height, 1);
});

test('applyLayerMask with a null mask returns the pixels unchanged', () => {
  const img = { width: 1, height: 2, data: new Uint8ClampedArray([5, 6, 7, 8, 9, 10, 11, 12]) };
  const out = applyLayerMask(img, null);
  assert.deepEqual(Array.from(out.data), Array.from(img.data));
  assert.notEqual(out.data, img.data);
});

test('newLayerMask builds Reveal All, Hide All, and Reveal Selection masks', () => {
  const all = newLayerMask('revealAll', 3, 2);
  assert.equal(all.length, 6);
  assert.ok(all instanceof Uint8Array);
  assert.ok(all.every((v) => v === 255));

  const none = newLayerMask('hideAll', 3, 2);
  assert.equal(none.length, 6);
  assert.ok(none.every((v) => v === 0));

  const sel = Uint8Array.from([0, 1, 1, 0, 0, 1]);
  assert.deepEqual(
    Array.from(newLayerMask('revealSelection', 3, 2, sel)),
    [0, 255, 255, 0, 0, 255]
  );
  assert.throws(() => newLayerMask('bogus', 1, 1));
});

test('painting a mask writes the color luminance (Rec. 601)', () => {
  assert.equal(maskLevel('#ffffff'), 255);
  assert.equal(maskLevel('#000000'), 0);
  assert.equal(maskLevel('#ff0000'), 76);
  assert.equal(maskGrayHex('#00ff00'), '#969696');
});

test('the gray edit surface reads back to the same mask; erased pixels take the background', () => {
  const mask = Uint8Array.from([0, 17, 128, 255]);
  assert.deepEqual(Array.from(maskFromRgba(maskToRgba(mask))), Array.from(mask));
  const erased = new Uint8ClampedArray([200, 200, 200, 0, 100, 100, 100, 255]);
  assert.deepEqual(Array.from(maskFromRgba(erased, 255)), [255, 100]);
});

test('cropMask takes a window and reveals area outside the source', () => {
  const mask = Uint8Array.from([1, 2, 3, 4, 5, 6]); // 3 x 2
  assert.deepEqual(Array.from(cropMask(mask, 3, 2, 1, 0, 2, 2)), [2, 3, 5, 6]);
  assert.deepEqual(Array.from(cropMask(mask, 3, 2, 0, 0, 4, 1)), [1, 2, 3, 255]);
});

test('encodeMask / decodeMask round trip long runs and noise', () => {
  const mask = new Uint8Array(1000);
  mask.fill(255, 0, 600);
  for (let p = 600; p < 1000; p++) mask[p] = (p * 37) % 256;
  assert.deepEqual(Array.from(decodeMask(encodeMask(mask), 1000)), Array.from(mask));
});

test('the Layer menu holds the layer mask commands', () => {
  const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');
  const { document } = new JSDOM(html).window;
  const state = { layers: [{ mask: null }], activeLayerIdx: 0 };
  const refresh = buildMenuBar(document.getElementById('menu-bar'), COMMANDS, { state });
  const menu = document.getElementById('layer-menu-list');
  assert.ok(menu, '#layer-menu-list missing');
  const item = (k) => menu.querySelector(`[data-layer="${k}"]`);
  const sub = menu.querySelector('.has-submenu[data-menu-path="Layer > Layer Mask"]');
  assert.ok(sub, 'Layer Mask submenu missing');
  // PhotoCraft's Layer › Layer Mask order.
  assert.deepEqual(
    [...sub.querySelectorAll('[data-layer]')].map((el) => [
      el.dataset.layer,
      el.querySelector('.menu-label').textContent
    ]),
    [
      ['mask-reveal-all', 'Reveal All'],
      ['mask-hide-all', 'Hide All'],
      ['mask-reveal-selection', 'Reveal Selection'],
      ['mask-hide-selection', 'Hide Selection'],
      ['mask-from-transparency', 'From Transparency'],
      ['mask-delete', 'Delete'],
      ['mask-apply', 'Apply'],
      ['mask-toggle', 'Enable Layer Mask']
    ]
  );
  const disabled = (k) => item(k).disabled;
  assert.deepEqual(['mask-reveal-all', 'mask-delete', 'mask-apply', 'mask-toggle'].map(disabled), [
    false,
    true,
    true,
    true
  ]);
  state.layers[0] = { mask: new Uint8Array(1), maskEnabled: true };
  refresh();
  assert.deepEqual(['mask-reveal-all', 'mask-delete', 'mask-apply', 'mask-toggle'].map(disabled), [
    true,
    false,
    false,
    false
  ]);
  assert.equal(item('mask-toggle').getAttribute('role'), 'menuitemcheckbox');
  assert.equal(item('mask-toggle').getAttribute('aria-checked'), 'true');
  state.layers[0].maskEnabled = false;
  refresh();
  assert.equal(item('mask-toggle').getAttribute('aria-checked'), 'false');
  // An adjustment layer keeps its mask; it can only be disabled.
  state.layers[0] = { kind: 'adjustment', mask: new Uint8Array(1) };
  refresh();
  assert.deepEqual(['mask-delete', 'mask-apply', 'mask-toggle'].map(disabled), [true, true, false]);
});

test('layer mask history rows use the layer-mask icon', () => {
  assert.ok(ICONS['layer-mask'], 'layer-mask icon missing');
  for (const label of [
    'Add Layer Mask',
    'Disable Layer Mask',
    'Enable Layer Mask',
    'Apply Layer Mask',
    'Delete Layer Mask'
  ]) {
    assert.equal(historyIconName(label), 'layer-mask', label);
  }
});

test('.paintproj round-trips a layer mask and its enabled flag', async () => {
  const W = 4,
    H = 3;
  const masked = createLayer('Masked', W, H);
  masked.mask = Uint8Array.from({ length: W * H }, (_, p) => (p < 6 ? 255 : p * 20));
  masked.maskEnabled = false;
  const plain = createLayer('Plain', W, H);
  const state = {
    bgColor: '#ffffff',
    color: '#000000',
    activeLayerIdx: 0,
    layers: [masked, plain],
    objects: []
  };
  const data = JSON.parse(JSON.stringify(serializeProject(state, W, H)));
  assert.equal(typeof data.layers[0].mask, 'string');
  assert.equal(data.layers[1].mask, undefined);

  let restored = null;
  await deserializeProject(data, (out) => {
    restored = out;
  });
  const [a, b] = restored.layers;
  assert.deepEqual(Array.from(a.mask), Array.from(masked.mask));
  assert.equal(a.maskEnabled, false);
  assert.ok(a.maskCtx, 'the mask edit surface is rebuilt');
  assert.equal(b.mask, null);
  assert.equal(b.maskEnabled, true);
});
