import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { COMMANDS } from '../paint/commands.js';
import { buildMenuBar } from '../paint/menu-bar.js';
import { ADJUSTMENTS } from '../paint/adjustments.js';

const html = readFileSync(new URL('../paint/index.html', import.meta.url), 'utf8');

function load() {
  const { window } = new JSDOM(html);
  const document = window.document;
  const opened = [];
  const ctx = { openAdjust: (id) => opened.push(id) };
  buildMenuBar(document.getElementById('menu-bar'), COMMANDS, { ctx, mac: false });
  return { window, document, opened };
}

const menu = (document, name) =>
  [...document.querySelectorAll('#menu-bar .menu-bar-btn')]
    .find((b) => b.textContent.trim() === name)
    .closest('.menu-bar-menu');

const labels = (list) =>
  [...list.children]
    .filter((el) => el.matches('button.action-menu-item'))
    .map((b) => b.querySelector('.menu-label').textContent);

const submenu = (document, path) =>
  document.querySelector(`.has-submenu[data-menu-path="${path}"] > .action-submenu`);

test('Filter holds PhotoCraft submenus in catalog order', () => {
  const { document } = load();
  const list = menu(document, 'Filter').querySelector('.action-menu-list');
  const subs = [...list.children]
    .filter((el) => el.classList.contains('has-submenu'))
    .map((el) => el.dataset.menuPath.split(' > ').pop());
  // PhotoCraft's catalog names the last submenu "Other…".
  assert.deepEqual(subs, [
    'Blur',
    'Blur Gallery',
    'Distort',
    'Noise',
    'Pixelate',
    'Render',
    'Sharpen',
    'Stylize',
    'Video',
    'Other…'
  ]);
  assert.equal(list.querySelector(':scope > .action-menu-field'), null);
  assert.ok(!list.textContent.includes('Filters are in'));
});

test('Blur and Stylize list filters in catalog order with catalog labels', () => {
  const { document } = load();
  assert.deepEqual(labels(submenu(document, 'Filter > Blur')), [
    'Average',
    'Blur',
    'Blur More',
    'Box Blur…',
    'Gaussian Blur…',
    'Lens Blur…',
    'Motion Blur…',
    'Radial Blur…',
    'Shape Blur…',
    'Smart Blur…',
    'Surface Blur…'
  ]);
  assert.deepEqual(labels(submenu(document, 'Filter > Stylize')), [
    'Diffuse…',
    'Emboss…',
    'Extrude…',
    'Find Edges',
    'Oil Paint…',
    'Solarize',
    'Tiles…',
    'Trace Contour…',
    'Wind…'
  ]);
  assert.deepEqual(labels(submenu(document, 'Filter > Pixelate')), [
    'Color Halftone…',
    'Crystallize…',
    'Facet',
    'Fragment',
    'Mezzotint…',
    'Mosaic…',
    'Pointillize…'
  ]);
  assert.ok(labels(submenu(document, 'Filter > Distort')).includes('Polar Coordinates…'));
});

test('Relight sits under Render right after Lighting Effects', () => {
  const { document } = load();
  const render = labels(submenu(document, 'Filter > Render'));
  assert.deepEqual(render, [
    'Clouds',
    'Difference Clouds',
    'Fibers…',
    'Lens Flare…',
    'Lighting Effects…',
    'Relight…'
  ]);
  // Flame / Picture Frame / Tree are absent, so their separator is dropped.
  assert.equal(
    submenu(document, 'Filter > Render').querySelector(':scope > .action-menu-sep'),
    null
  );
});

test('filter items open their adjustment', () => {
  const { window, document, opened } = load();
  const click = (id) =>
    document
      .querySelector(`[data-command="${id}"]`)
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  click('filter.blur.gaussianBlur');
  click('filter.pixelate.mosaic');
  click('filter.noise.dustAndScratches');
  click('filter.render.relight');
  assert.deepEqual(opened, ['gaussianBlur', 'pixelate', 'dustScratches', 'relight']);
  for (const c of COMMANDS.filter((c) => c.menu[0] === 'Filter')) {
    assert.ok(c.id.startsWith('filter.'), c.id);
  }
});

test('no filter is left in the Image menu and nothing is labelled Sepia', () => {
  const { document } = load();
  const image = menu(document, 'Image').textContent;
  const filterLabels = COMMANDS.filter((c) => c.menu[0] === 'Filter').map((c) => c.label);
  const adjLabels = labels(submenu(document, 'Image > Adjustments'));
  for (const label of filterLabels) {
    const bare = label.replace(/…$/, '');
    assert.ok(!adjLabels.includes(bare), `${bare} still in Image › Adjustments`);
    assert.ok(!adjLabels.includes(label), `${label} still in Image › Adjustments`);
  }
  for (const id of ['gaussianBlur', 'emboss', 'twirl', 'clouds', 'pixelate', 'relight']) {
    assert.ok(!adjLabels.includes(ADJUSTMENTS[id].label), id);
  }
  assert.ok(!adjLabels.includes('Grayscale'), 'Desaturate replaced Grayscale');
  assert.ok(!/Sepia/.test(document.getElementById('menu-bar').textContent));
  assert.ok(!image.includes('Sepia'));
  assert.equal(ADJUSTMENTS.sepia, undefined);
});
