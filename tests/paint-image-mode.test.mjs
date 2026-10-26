import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  docColor,
  docModeTag,
  grayscaleImageData,
  grayscaleLayers,
  normalizeDocMode
} from '../paint/image-mode.js';
import { maskLevel } from '../paint/layer-mask.js';
import { docTabText } from '../paint/doc-tab.js';
import { isStackUndoLabel } from '../paint/stack-history.js';
import { COMMANDS } from '../paint/commands.js';
import { buildMenuBar } from '../paint/menu-bar.js';
import { TOOLS } from '../paint/tools.js';

// layers.js / project.js need document.createElement('canvas'). A byte-backed stub keeps the
// conversion and the round trip browser-free.
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

const { createLayer, createAdjustmentLayer } = await import('../paint/layers.js');
const { serializeProject, deserializeProject } = await import('../paint/project.js');

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

test('Grayscale is Rec. 601 luma per pixel and keeps alpha', () => {
  const img = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 10, 20, 200, 0])
  };
  grayscaleImageData(img);
  assert.deepEqual([...img.data], [76, 76, 76, 255, 150, 150, 150, 128, 38, 38, 38, 0]);
  assert.equal(img.data[0], maskLevel('#ff0000'));
});

test('converting the stack grays every pixel layer and leaves adjustment layers alone', () => {
  const a = createLayer('A', 2, 1);
  a.ctx.putImageData({ data: new Uint8ClampedArray([200, 100, 0, 255, 0, 0, 255, 255]) });
  const b = createLayer('B', 2, 1);
  b.ctx.putImageData({ data: new Uint8ClampedArray([0, 255, 0, 255, 30, 60, 90, 40]) });
  const adj = createAdjustmentLayer('Photo Filter', 'photoFilter', { density: 25 }, 2, 1);
  const params = { ...adj.params };

  grayscaleLayers([a, adj, b]);

  assert.deepEqual([...a.canvas.pixels], [119, 119, 119, 255, 29, 29, 29, 255]);
  assert.deepEqual([...b.canvas.pixels], [150, 150, 150, 255, 54, 54, 54, 40]);
  assert.deepEqual(adj.params, params);
  for (const label of ['Grayscale', 'RGB Color']) assert.ok(isStackUndoLabel(label), label);
});

test('color picks clamp to gray in Grayscale and pass through in RGB', () => {
  assert.equal(docColor('grayscale', '#ff0000'), '#4c4c4c');
  assert.equal(docColor('grayscale', '#336699'), '#5d5d5d');
  assert.equal(docColor('rgb', '#ff0000'), '#ff0000');

  // The Eyedropper goes through state.pickColor, as paint.js wires it.
  const state = { docMode: 'grayscale', color: '#000000' };
  state.pickColor = (hex) => docColor(state.docMode, hex);
  const ctx = { getImageData: () => ({ data: [0, 0, 255, 255] }) };
  TOOLS.eyedropper.onDown(ctx, null, state, 0, 0, false);
  assert.equal(state.color, '#1d1d1d');
  assert.equal(state.activeColor, '#1d1d1d');
  state.docMode = 'rgb';
  TOOLS.eyedropper.onDown(ctx, null, state, 0, 0, true);
  assert.equal(state.bgColor, '#0000ff');
});

test('the swatch grid shows its colors as gray in Grayscale', async () => {
  const { showPaletteMode } = await import('../paint/ui.js');
  const { document } = new JSDOM(
    '<div><button class="color-swatch" data-color="#ff0000"></button></div>'
  ).window;
  const sw = document.querySelector('.color-swatch');
  showPaletteMode('grayscale', document);
  assert.equal(sw.style.background, 'rgb(76, 76, 76)');
  showPaletteMode('rgb', document);
  assert.equal(sw.style.background, 'rgb(255, 0, 0)');
});

test('Image › Mode radio-checks the document mode and 8 Bits/Channel', () => {
  const { document } = new JSDOM(html).window;
  const calls = [];
  const state = { docMode: 'rgb' };
  const refresh = buildMenuBar(document.getElementById('menu-bar'), COMMANDS, {
    state,
    ctx: { setDocMode: (m) => calls.push(m) },
    mac: false
  });
  const sub = document.querySelector(
    '.has-submenu[data-menu-path="Image > Mode"] > .action-submenu'
  );
  const labels = [...sub.querySelectorAll('.menu-label')].map((el) => el.textContent);
  assert.deepEqual(labels, [
    'Bitmap',
    'Grayscale',
    'Indexed Color',
    'RGB Color',
    '8 Bits/Channel',
    'Color Table…'
  ]);
  const item = (id) => sub.querySelector(`[data-command="${id}"]`);
  for (const id of ['image.mode.grayscale', 'image.mode.rgb', 'image.mode.bits8']) {
    assert.equal(item(id).getAttribute('role'), 'menuitemradio');
  }

  refresh();
  assert.equal(item('image.mode.rgb').getAttribute('aria-checked'), 'true');
  assert.equal(item('image.mode.grayscale').getAttribute('aria-checked'), 'false');
  assert.equal(item('image.mode.bits8').getAttribute('aria-checked'), 'true');

  item('image.mode.grayscale').click();
  assert.deepEqual(calls, ['grayscale']);
  state.docMode = 'grayscale';
  refresh();
  assert.equal(item('image.mode.grayscale').getAttribute('aria-checked'), 'true');
  assert.equal(item('image.mode.rgb').getAttribute('aria-checked'), 'false');
});

test('the doc tab reads Gray/8 in Grayscale', () => {
  assert.equal(docModeTag('grayscale'), 'Gray/8');
  assert.equal(docModeTag(undefined), 'RGB/8');
  assert.equal(docTabText('Beach', 1, false, 'grayscale'), 'Beach @ 100% (Gray/8)');
  assert.equal(docTabText('Beach', 1), 'Beach @ 100% (RGB/8)');
});

test('docMode round-trips through .paintproj; an older file opens as RGB', async () => {
  const state = {
    docName: 'Beach',
    docMode: 'grayscale',
    bgColor: '#ffffff',
    color: '#000000',
    layers: [],
    objects: []
  };
  const data = JSON.parse(JSON.stringify(serializeProject(state, 4, 4)));
  assert.equal(data.docMode, 'grayscale');
  let out = null;
  await deserializeProject(data, (o) => (out = o));
  assert.equal(out.docMode, 'grayscale');

  delete data.docMode;
  await deserializeProject(data, (o) => (out = o));
  assert.equal(out.docMode, 'rgb');
  assert.equal(normalizeDocMode('cmyk'), 'rgb');
});
