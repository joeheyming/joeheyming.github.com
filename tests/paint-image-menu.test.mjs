import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { COMMANDS, commandForKey } from '../paint/commands.js';
import { buildMenuBar } from '../paint/menu-bar.js';
import { ADJUSTMENTS, applyDesaturate } from '../paint/adjustments.js';
import { flipImageData } from '../paint/transform.js';
import { isStackUndoLabel } from '../paint/stack-history.js';
import { FALLBACK_HISTORY_ICON, historyIconName } from '../paint/history.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function load(state = {}) {
  const { window } = new JSDOM(html);
  const document = window.document;
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args) =>
          calls.push([name, ...args])
    }
  );
  const refresh = buildMenuBar(document.getElementById('menu-bar'), COMMANDS, {
    state,
    ctx,
    mac: false
  });
  return { window, document, calls, refresh };
}

// A list's direct entries: item labels, submenu names, and '---' for separators.
const entries = (list) =>
  [...list.children].map((el) => {
    if (el.classList.contains('action-menu-sep')) return '---';
    if (el.classList.contains('has-submenu')) return `> ${el.dataset.menuPath.split(' > ').pop()}`;
    return el.querySelector('.menu-label').textContent;
  });

const submenu = (document, path) =>
  document.querySelector(`.has-submenu[data-menu-path="${path}"] > .action-submenu`);

test('the Image menu follows PhotoCraft order', () => {
  const { document } = load();
  assert.deepEqual(entries(document.getElementById('image-menu-list')), [
    '> Mode',
    '---',
    '> Adjustments',
    '---',
    'Auto Tone',
    'Auto Contrast',
    'Auto Color',
    '---',
    'Image Size…',
    'Canvas Size…',
    '> Image Rotation',
    'Crop',
    'Trim…',
    '---',
    '> Analysis'
  ]);
});

test('Image › Analysis lists Set Measurement Scale… and Count Tool in catalog order', () => {
  const { document } = load();
  assert.deepEqual(entries(submenu(document, 'Image > Analysis')), [
    'Set Measurement Scale…',
    '---',
    'Count Tool'
  ]);
});

test('Image › Adjustments lists the catalog adjustments in catalog order', () => {
  const { document } = load();
  assert.deepEqual(entries(submenu(document, 'Image > Adjustments')), [
    'Brightness/Contrast…',
    'Levels…',
    'Curves…',
    'Exposure…',
    'Vibrance…',
    'Hue/Saturation…',
    'Color Balance…',
    'Black & White…',
    'Photo Filter…',
    'Channel Mixer…',
    'Color Lookup…',
    '---',
    'Invert',
    'Posterize…',
    'Threshold…',
    'Gradient Map…',
    'Selective Color…',
    '---',
    'Shadows/Highlights…',
    '---',
    'Desaturate',
    'Replace Color…',
    'Equalize'
  ]);
  const desat = document.querySelector('[data-command="image.adjustments.desaturate"]');
  assert.equal(desat.querySelector('.menu-shortcut').textContent, 'Ctrl+Shift+U');
  assert.equal(
    document.querySelector('[data-command="image.adjustments.levels"] .menu-shortcut').textContent,
    'Ctrl+L'
  );
});

test('dialog adjustments open the dialog; Invert, Desaturate and Equalize apply at once', () => {
  const { window, document, calls } = load();
  const click = (id) =>
    document
      .querySelector(`[data-command="${id}"]`)
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  click('image.adjustments.hueSaturation');
  click('image.adjustments.invert');
  click('image.adjustments.desaturate');
  click('image.adjustments.shadowsHighlights');
  click('image.adjustments.replaceColor');
  click('image.adjustments.equalize');
  assert.deepEqual(calls, [
    ['openAdjust', 'hsl'],
    ['applyAdjustmentNow', 'invert'],
    ['applyAdjustmentNow', 'desaturate'],
    ['openAdjust', 'shadowsHighlights'],
    ['openAdjust', 'replaceColor'],
    ['applyAdjustmentNow', 'equalize']
  ]);
  const cmd = commandForKey({ code: 'KeyU', key: 'U', ctrlKey: true, shiftKey: true });
  assert.equal(cmd.id, 'image.adjustments.desaturate');
});

test('Grayscale is gone; Desaturate is an adjustment without fields', () => {
  assert.equal(ADJUSTMENTS.grayscale, undefined);
  assert.equal(ADJUSTMENTS.desaturate.label, 'Desaturate');
  assert.deepEqual(ADJUSTMENTS.desaturate.fields, []);
  assert.ok(!/Grayscale/.test(html));
});

test('Desaturate maps pure red to equal R=G=B and leaves alpha alone', () => {
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 128, 0, 0, 255, 77]) };
  applyDesaturate(img, null);
  const [r, g, b, a] = img.data.slice(0, 4);
  assert.equal(r, g);
  assert.equal(g, b);
  assert.equal(r, Math.round(0.299 * 255));
  assert.equal(a, 128);
  assert.deepEqual([...img.data.slice(4)], [29, 29, 29, 77]);
});

test('Desaturate skips pixels outside the mask', () => {
  const img = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255])
  };
  applyDesaturate(img, new Uint8Array([0, 1]));
  assert.deepEqual([...img.data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...img.data.slice(4)], [150, 150, 150, 255]);
});

test('Image Rotation: turns, Arbitrary, then the Flip Canvas pair', () => {
  const { window, document, calls } = load();
  assert.deepEqual(entries(submenu(document, 'Image > Image Rotation')), [
    '180°',
    '90° Clockwise',
    '90° Counter Clockwise',
    'Arbitrary…',
    '---',
    'Flip Canvas Horizontal',
    'Flip Canvas Vertical'
  ]);
  for (const id of ['flipCanvasHorizontal', 'flipCanvasVertical']) {
    document
      .querySelector(`[data-command="image.imageRotation.${id}"]`)
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  }
  assert.deepEqual(calls, [
    ['flipCanvas', true],
    ['flipCanvas', false]
  ]);
  for (const label of ['Flip Canvas Horizontal', 'Flip Canvas Vertical']) {
    assert.ok(isStackUndoLabel(label), label);
    assert.notEqual(historyIconName(label), FALLBACK_HISTORY_ICON);
  }
});

test('flipImageData mirrors rows or columns', () => {
  // 2 × 2: pixel value = its index, in the red byte.
  const img = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  for (let p = 0; p < 4; p++) img.data.set([p, 0, 0, 10 + p], p * 4);
  const red = (out) => [0, 1, 2, 3].map((p) => out.data[p * 4]);
  assert.deepEqual(red(flipImageData(img, true)), [1, 0, 3, 2]);
  assert.deepEqual(red(flipImageData(img, false)), [2, 3, 0, 1]);
  assert.equal(flipImageData(img, true).data[3], 11);
  assert.deepEqual(red(img), [0, 1, 2, 3], 'source untouched');
});

test('Crop is enabled only with a selection', () => {
  const state = { sel: { mode: 'none', x: 0, y: 0, w: 0, h: 0 } };
  const { document, refresh } = load(state);
  const crop = document.querySelector('[data-command="image.crop"]');
  assert.equal(crop.querySelector('.menu-label').textContent, 'Crop');
  assert.equal(crop.disabled, true);
  Object.assign(state.sel, { mode: 'active', x: 2, y: 2, w: 10, h: 8 });
  refresh();
  assert.equal(crop.disabled, false);
});
