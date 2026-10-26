import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  buildPalette,
  quantizeIndexed,
  recolorTable,
  toBitmap,
  uniformPalette
} from '../paint/indexed-mode.js';
import {
  initBitmapDialog,
  initColorTableDialog,
  initIndexedColorDialog
} from '../paint/indexed-mode-dialog.js';
import { docColor, docModeTag, normalizeDocMode } from '../paint/image-mode.js';
import { isStackUndoLabel } from '../paint/stack-history.js';
import { COMMANDS } from '../paint/commands.js';
import { buildMenuBar } from '../paint/menu-bar.js';
import { serializeProject, deserializeProject } from '../paint/project.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

/** An opaque W x H image from [r, g, b] per pixel. */
function image(W, H, colorAt) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    data.set([...colorAt(p % W, Math.floor(p / W)), 255], p * 4);
  }
  return { width: W, height: H, data };
}

const pixels = (img) => {
  const out = [];
  for (let i = 0; i < img.data.length; i += 4) out.push([...img.data.slice(i, i + 3)]);
  return out;
};

const unique = (img) => new Set(pixels(img).map((c) => c.join(',')));

test('Exact keeps an image with 3 colors exactly', () => {
  const colors = [
    [200, 30, 40],
    [10, 120, 250],
    [90, 90, 10]
  ];
  const img = image(6, 4, (x, y) => colors[(x + y) % 3]);
  const before = pixels(img);
  const { indices, table } = quantizeIndexed(img, { palette: 'exact', dither: 'diffusion' });
  assert.equal(table.length, 3);
  assert.deepEqual(new Set(table), new Set(['#c81e28', '#0a78fa', '#5a5a0a']));
  assert.deepEqual(pixels(img), before);
  // Each index points at its pixel's color.
  pixels(img).forEach((c, p) => {
    const hex = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    assert.equal(table[indices[p]], hex);
  });
});

test('Exact refuses an image with more than 256 colors', () => {
  const img = image(32, 16, (x, y) => [x * 8, y * 16, 0]);
  assert.throws(() => quantizeIndexed(img, { palette: 'exact' }), /512 colors/);
});

test('Adaptive with 2 colors yields 2 table entries and only those colors', () => {
  // Dark reds on the left, light blues on the right: median cut splits them.
  const img = image(8, 8, (x, y) => (x < 4 ? [100 + y * 4, 10, 20] : [30, 160, 230 + (y % 3)]));
  const { indices, table } = quantizeIndexed(img, {
    palette: 'adaptive',
    colors: 2,
    dither: 'none'
  });
  assert.equal(table.length, 2);
  const used = unique(img);
  assert.equal(used.size, 2);
  const left = indices[0];
  const right = indices[7];
  assert.notEqual(left, right);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) assert.equal(indices[y * 8 + x], x < 4 ? left : right);
  }
  // The table entries are the weighted means of the two halves.
  const [r] = table[left].match(/\w\w/g).map((h) => parseInt(h, 16));
  assert.equal(r, 114);
});

test('Uniform is an equal-step grid and Diffusion dithers a flat gray between entries', () => {
  assert.deepEqual(
    buildPalette(
      image(1, 1, () => [0, 0, 0]),
      'uniform',
      8
    ),
    uniformPalette(8)
  );
  assert.deepEqual(uniformPalette(8), [
    [0, 0, 0],
    [0, 0, 255],
    [0, 255, 0],
    [0, 255, 255],
    [255, 0, 0],
    [255, 0, 255],
    [255, 255, 0],
    [255, 255, 255]
  ]);
  const flat = () => image(16, 16, () => [128, 128, 128]);
  const plain = flat();
  quantizeIndexed(plain, { palette: 'uniform', colors: 8, dither: 'none' });
  assert.deepEqual([...unique(plain)], ['255,255,255']);
  const dithered = flat();
  quantizeIndexed(dithered, { palette: 'uniform', colors: 8, dither: 'diffusion', amount: 100 });
  const whites = pixels(dithered).filter((c) => c[0] === 255).length;
  assert.ok(unique(dithered).size >= 2);
  assert.ok(whites > 96 && whites < 160, `about half white, got ${whites}`);
});

test('Color Table recolors every pixel of an entry and leaves the others', () => {
  const img = image(
    3,
    1,
    (x) =>
      [
        [255, 0, 0],
        [0, 0, 255],
        [255, 0, 0]
      ][x]
  );
  recolorTable(img, ['#ff0000', '#0000ff'], ['#00ff00', '#0000ff']);
  assert.deepEqual(pixels(img), [
    [0, 255, 0],
    [0, 0, 255],
    [0, 255, 0]
  ]);
});

test('Bitmap output is only 0 or 255', () => {
  const ramp = () => image(32, 8, (x) => [x * 8, x * 8, x * 8]);
  const t = toBitmap(ramp(), 'threshold');
  for (let i = 0; i < t.data.length; i += 4) {
    const x = (i / 4) % 32;
    assert.equal(t.data[i], x * 8 >= 128 ? 255 : 0);
    assert.equal(t.data[i + 3], 255);
  }
  const d = toBitmap(ramp(), 'diffusion');
  const values = new Set([...d.data].filter((_, i) => i % 4 !== 3));
  assert.deepEqual(
    [...values].sort((a, b) => a - b),
    [0, 255]
  );
  // Dithered coverage follows the tone: the right half is much whiter than the left.
  let left = 0;
  let right = 0;
  for (let p = 0; p < 32 * 8; p++) {
    if (d.data[p * 4]) p % 32 < 16 ? left++ : right++;
  }
  assert.ok(right > left * 2, `${left} vs ${right}`);
});

test('modes clamp picked colors and tag the doc tab', () => {
  assert.equal(docColor('indexed', '#f01010', ['#000000', '#ff0000']), '#ff0000');
  assert.equal(docColor('bitmap', '#a0a0a0'), '#ffffff');
  assert.equal(docColor('bitmap', '#404040'), '#000000');
  assert.equal(docModeTag('indexed'), 'Indexed/8');
  assert.equal(docModeTag('bitmap'), 'Bitmap/8');
  assert.equal(normalizeDocMode('bitmap'), 'bitmap');
  for (const label of ['Indexed Color', 'Bitmap', 'Color Table']) {
    assert.ok(isStackUndoLabel(label), label);
  }
});

test('Image › Mode lists PhotoCraft order; Bitmap needs Grayscale, Color Table needs Indexed', () => {
  const { document } = new JSDOM(html).window;
  const calls = [];
  const state = { docMode: 'rgb', colorTable: null };
  const refresh = buildMenuBar(document.getElementById('menu-bar'), COMMANDS, {
    state,
    ctx: {
      bitmapMode: () => calls.push('bitmap'),
      indexedColor: () => calls.push('indexed'),
      colorTable: () => calls.push('table')
    },
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
  refresh();
  assert.equal(item('image.mode.bitmap').disabled, true);
  assert.equal(item('image.mode.colorTable').disabled, true);
  assert.equal(item('image.mode.indexedColor').disabled, false);
  item('image.mode.indexedColor').click();

  state.docMode = 'grayscale';
  refresh();
  assert.equal(item('image.mode.bitmap').disabled, false);
  item('image.mode.bitmap').click();

  state.docMode = 'indexed';
  state.colorTable = ['#000000', '#ffffff'];
  refresh();
  assert.equal(item('image.mode.colorTable').disabled, false);
  assert.equal(item('image.mode.indexedColor').getAttribute('aria-checked'), 'true');
  assert.equal(item('image.mode.rgb').getAttribute('aria-checked'), 'false');
  item('image.mode.colorTable').click();
  assert.deepEqual(calls, ['indexed', 'bitmap', 'table']);
});

test('the Indexed Color and Bitmap dialogs hand their choices to OK', () => {
  const { document } = new JSDOM(html).window;
  const got = [];
  const indexed = initIndexedColorDialog({ onOk: (p) => got.push(p) }, document);
  indexed.open();
  document.getElementById('indexed-palette').value = 'uniform';
  document.getElementById('indexed-colors').value = '999';
  document.getElementById('indexed-dither').value = 'none';
  document.getElementById('indexed-ok').click();
  assert.deepEqual(got.pop(), { palette: 'uniform', colors: 256, dither: 'none', amount: 75 });
  assert.ok(document.getElementById('indexed-color-modal').classList.contains('hidden'));

  const bitmap = initBitmapDialog({ onOk: (p) => got.push(p) }, document);
  bitmap.open();
  document.getElementById('bitmap-method').value = 'threshold';
  document.getElementById('bitmap-ok').click();
  assert.deepEqual(got.pop(), { method: 'threshold' });
});

test('Color Table shows the table as swatches; a click edits that entry for OK', () => {
  const { document, Event } = new JSDOM(html).window;
  const got = [];
  const dialog = initColorTableDialog({ onOk: (t) => got.push(t) }, document);
  const table = ['#ff0000', '#00ff00', '#0000ff'];
  dialog.open(table);
  const swatches = () => [...document.querySelectorAll('#color-table-grid .color-table-swatch')];
  assert.deepEqual(
    swatches().map((s) => s.style.background),
    ['rgb(255, 0, 0)', 'rgb(0, 255, 0)', 'rgb(0, 0, 255)']
  );
  const picker = document.getElementById('color-table-picker');
  swatches()[1].click();
  assert.equal(picker.value, '#00ff00');
  picker.value = '#123456';
  picker.dispatchEvent(new Event('change'));
  assert.equal(swatches()[1].style.background, 'rgb(18, 52, 86)');
  document.getElementById('color-table-ok').click();
  assert.deepEqual(got, [['#ff0000', '#123456', '#0000ff']]);
  assert.deepEqual(table, ['#ff0000', '#00ff00', '#0000ff']);

  // Cancel drops the edits.
  dialog.open(table);
  swatches()[0].click();
  picker.value = '#ffffff';
  picker.dispatchEvent(new Event('change'));
  document.getElementById('color-table-cancel').click();
  assert.equal(got.length, 1);
});

test('the color table round-trips through .paintproj, only for an indexed document', async () => {
  const state = {
    docName: 'Beach',
    docMode: 'indexed',
    colorTable: ['#000000', '#FFAA00'],
    bgColor: '#ffffff',
    color: '#000000',
    layers: [],
    objects: []
  };
  const data = JSON.parse(JSON.stringify(serializeProject(state, 4, 4)));
  let out = null;
  await deserializeProject(data, (o) => (out = o));
  assert.equal(out.docMode, 'indexed');
  assert.deepEqual(out.colorTable, ['#000000', '#ffaa00']);
  data.docMode = 'rgb';
  await deserializeProject(data, (o) => (out = o));
  assert.equal(out.colorTable, null);
  delete data.colorTable;
  delete data.docMode;
  await deserializeProject(data, (o) => (out = o));
  assert.equal(out.colorTable, null);
});
